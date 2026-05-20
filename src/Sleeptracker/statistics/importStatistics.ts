import { logError, logInfo } from '@utils/logger';
import { NightSummary } from '../types/SleepSummary';

// `ws` is a dependency of `mqtt` and is also declared explicitly in
// package.json. Loaded via require so the integration does not need the
// @types/ws dev dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket: any = require('ws');

// Home Assistant long-term statistics can only be backfilled via the
// websocket API (`recorder/import_statistics` is not a callable service).
// Add-ons can reach the HA websocket through the Supervisor proxy and
// authenticate with the auto-provided SUPERVISOR_TOKEN.
const HA_WS_URL = 'ws://supervisor/core/websocket';

// The Sleeptracker API returns the full nightly history on every fetch, so
// re-importing keeps statistics complete and current. import_statistics is
// idempotent (a repeated `start` overwrites), so this is safe to run
// repeatedly — throttled to once an hour to avoid needless work.
const IMPORT_INTERVAL_MS = 60 * 60 * 1000;
const WS_TIMEOUT_MS = 30000;

let lastImportMs = 0;

const secsToMin = (s?: number): number | undefined =>
  typeof s === 'number' ? Math.round(s / 60) : undefined;

type MetricDef = {
  key: string;
  name: string;
  unit: string;
  value: (n: NightSummary) => number | undefined;
};

const METRICS: MetricDef[] = [
  { key: 'sleep_score', name: 'Sleep Score', unit: 'pts', value: (n) => n.sleepScore },
  { key: 'sleep_minutes', name: 'Sleep Minutes', unit: 'min', value: (n) => n.sleepMinutes },
  {
    key: 'sleep_efficiency',
    name: 'Sleep Efficiency',
    unit: '%',
    value: (n) => n.sleepEfficiencyPercent,
  },
  { key: 'rem_minutes', name: 'REM Minutes', unit: 'min', value: (n) => secsToMin(n.remSecs) },
  { key: 'deep_minutes', name: 'Deep Minutes', unit: 'min', value: (n) => secsToMin(n.deepSecs) },
  { key: 'light_minutes', name: 'Light Minutes', unit: 'min', value: (n) => secsToMin(n.lightSecs) },
  { key: 'awake_minutes', name: 'Awake Minutes', unit: 'min', value: (n) => secsToMin(n.awakeSecs) },
];

// Long-term statistics buckets are hourly; align each night's timestamp to the
// hour. Falls back to midnight UTC of the recorded day.
const startISO = (night: NightSummary): string | undefined => {
  if (typeof night.summaryTimeSecs === 'number' && night.summaryTimeSecs > 0) {
    const hour = Math.floor(night.summaryTimeSecs / 3600) * 3600;
    return new Date(hour * 1000).toISOString();
  }
  if (/^\d{8}$/.test(night.dayYYYYMMDD)) {
    const day = night.dayYYYYMMDD;
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
};

const sideKey = (sideName: string): string => {
  const trimmed = sideName.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : 'main';
};

// Pushes the nightly history to HA long-term statistics as external
// statistics (ids like `sleeptracker:sleep_score_left`). Fire-and-forget:
// never throws, never blocks the refresh loop.
export const importSleepStatistics = async (
  history: NightSummary[] | undefined,
  sideName: string
): Promise<void> => {
  if (!history || history.length === 0) return;

  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    logInfo(
      '[Sleeptracker] statistics import skipped: no SUPERVISOR_TOKEN (not running as a Home Assistant add-on)'
    );
    return;
  }

  const now = Date.now();
  if (now - lastImportMs < IMPORT_INTERVAL_MS) return;
  lastImportMs = now;

  const side = sideKey(sideName);
  const nights = [...history].sort(
    (a, b) => (a.summaryTimeSecs ?? 0) - (b.summaryTimeSecs ?? 0)
  );

  await new Promise<void>((resolve) => {
    let settled = false;
    let ws: any;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    const timeout = setTimeout(() => {
      logError('[Sleeptracker] statistics import timed out');
      finish();
    }, WS_TIMEOUT_MS);

    try {
      ws = new WebSocket(HA_WS_URL);
    } catch (err) {
      logError('[Sleeptracker] statistics import could not open websocket', err);
      clearTimeout(timeout);
      finish();
      return;
    }

    let msgId = 1;
    let pending = 0;
    let imported = 0;

    ws.on('error', (err: unknown) => {
      logError('[Sleeptracker] statistics import websocket error', err);
      clearTimeout(timeout);
      finish();
    });

    ws.on('message', (raw: unknown) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        return;
      }

      if (msg.type === 'auth_invalid') {
        logError('[Sleeptracker] statistics import authentication rejected');
        clearTimeout(timeout);
        finish();
        return;
      }

      if (msg.type === 'auth_ok') {
        for (const metric of METRICS) {
          const stats = nights
            .map((night) => {
              const start = startISO(night);
              const value = metric.value(night);
              if (start === undefined || value === undefined) return undefined;
              return { start, mean: value, min: value, max: value };
            })
            .filter(
              (s): s is { start: string; mean: number; min: number; max: number } =>
                s !== undefined
            );
          if (stats.length === 0) continue;
          pending++;
          ws.send(
            JSON.stringify({
              id: msgId++,
              type: 'recorder/import_statistics',
              metadata: {
                has_mean: true,
                has_sum: false,
                name: metric.name,
                source: 'sleeptracker',
                statistic_id: `sleeptracker:${metric.key}_${side}`,
                unit_of_measurement: metric.unit,
              },
              stats,
            })
          );
        }
        if (pending === 0) {
          clearTimeout(timeout);
          finish();
        }
        return;
      }

      if (msg.type === 'result') {
        pending--;
        if (msg.success) {
          imported++;
        } else {
          logError(
            `[Sleeptracker] statistics import rejected: ${JSON.stringify(msg.error)}`
          );
        }
        if (pending <= 0) {
          clearTimeout(timeout);
          logInfo(
            `[Sleeptracker] statistics import complete: ${imported}/${METRICS.length} series x ${nights.length} nights`
          );
          finish();
        }
        return;
      }
    });
  });
};
