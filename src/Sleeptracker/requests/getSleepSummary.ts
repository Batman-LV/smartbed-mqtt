import { logError, logInfo } from '@utils/logger';
import axios from 'axios';
import { Credentials } from '../options';
import { SleepSummary } from '../types/SleepSummary';
import { getAuthHeader } from './getAuthHeader';
import defaultHeaders from './shared/defaultHeaders';
import { urls } from './shared/urls';

// The Sleeptracker mobile app fetches sleep summary data via a webui-style
// endpoint on a different sub-API than the processor calls used elsewhere in
// this module. Endpoint discovered by capturing the iOS app's HTTPS traffic
// via Fiddler:
//
//   POST https://app.tsi.sleeptracker.com/actrack-client/v2/actrack/webui
//
//   Body: { command: "fetch", dataClass: "activities", ... }
//
// The response wraps everything in `summary` and `clientSlotList`. The most
// recent night's metrics live at
// `summary.sleepsDailySummary.sleepSummaryDailyDetails[0]`. We use a
// deep-search field extractor so naming variations between API versions and
// bed types do not break the integration. Any field we miss is preserved on
// the diagnostic raw sensor so the user can author template sensors for it.

// Field-name candidates per metric — first match wins. The leading entries
// are the exact field names confirmed from a live Sleeptracker daily summary
// record; the rest are fallbacks kept for resilience across API versions.
const FIELD_CANDIDATES = {
  totalSleepSecs: [
    'sleepTotalSecs',
    'totalSleepSecs',
    'totalSleepSeconds',
    'totalSleep',
    'sleepSecs',
    'sleepDurationSecs',
    'totalSleepDurationSecs',
    'sleepDurationSeconds',
    'asleepSecs',
  ],
  totalTimeInBedSecs: [
    'inBedTotalSecs',
    'totalTimeInBedSecs',
    'timeInBedSecs',
    'inBedSecs',
    'totalTimeInBed',
    'totalInBedSecs',
    'inBedDurationSecs',
  ],
  sleepEfficiencyPercent: [
    'sleepEfficiencyPercentage',
    'sleepEfficiency',
    'sleepEfficiencyPercent',
    'efficiency',
    'efficiencyPercent',
    'sleepEfficiencyPct',
  ],
  sleepScore: [
    'sleepScore',
    'score',
    'qualityScore',
    'sleepQuality',
    'sleepQualityScore',
    'sleepScoreValue',
    'overallScore',
  ],
  sleepLatencySecs: [
    'timeToSleepTotalSecs',
    'timeToSleepAvgSecs',
    'sleepLatencySecs',
    'sleepLatency',
    'timeToSleepSecs',
    'timeToFallAsleepSecs',
    'latencySecs',
    'sleepOnsetLatencySecs',
  ],
  awakeningsCount: [
    'awakeCount',
    'awakenings',
    'awakeningsCount',
    'numAwakenings',
    'wakeCount',
    'numberOfAwakenings',
    'wakeUpCount',
  ],
  remSecs: [
    'remTotalSecs',
    'remSecs',
    'remSleepSecs',
    'remSeconds',
    'rem',
    'remSleepSeconds',
    'remDurationSecs',
  ],
  deepSecs: [
    'deepTotalSecs',
    'deepSecs',
    'deepSleepSecs',
    'deepSeconds',
    'deep',
    'deepSleepSeconds',
    'deepDurationSecs',
  ],
  lightSecs: [
    'lightTotalSecs',
    'lightSecs',
    'lightSleepSecs',
    'lightSeconds',
    'light',
    'lightSleepSeconds',
    'lightDurationSecs',
  ],
  awakeSecs: [
    'awakeTotalSecs',
    'awakeSecs',
    'awakeSeconds',
    'awakeTimeSecs',
    'awake',
    'wakeSecs',
    'awakeDurationSecs',
    'wakeAfterSleepOnsetSecs',
    'wasoSecs',
  ],
  bedtimeGMTSecs: [
    'firstAsleepTimeSecs',
    'firstOnBedTimeSecs',
    'bedtimeGMTSecs',
    'bedTimeGMTSecs',
    'bedtimeGmtSecs',
    'fellAsleepGMTSecs',
    'sleepOnsetGMTSecs',
    'startTimeGmtSecs',
    'fellAsleepGmtSecs',
  ],
  wakeTimeGMTSecs: [
    'lastAwakeTimeSecs',
    'lastOffBedTimeSecs',
    'wakeTimeGMTSecs',
    'wakeUpGMTSecs',
    'wakeGmtSecs',
    'wakeupGMTSecs',
    'endTimeGmtSecs',
    'wakeUpGmtSecs',
  ],
  avgHeartRateBpm: [
    'hrAvg',
    'avgHeartRate',
    'averageHeartRate',
    'heartRateAvg',
    'avgHeartRateBpm',
    'avgHR',
    'averageHR',
  ],
  avgRespirationRateBpm: [
    'rrAvg',
    'avgRespirationRate',
    'averageRespirationRate',
    'respirationRateAvg',
    'avgBR',
    'avgBreathRate',
    'averageBreathRate',
    'avgBreathsPerMin',
  ],
  lastUpdatedGMTSecs: [
    'summaryTimeSecs',
    'lastUpdatedGMTSecs',
    'uploadedGMTSecs',
    'recordedGMTSecs',
    'createdGMTSecs',
    'modifiedGmtSecs',
    'lastModGmtSecs',
  ],
};

const pick = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
};

const deepPick = (obj: unknown, keys: string[]): number | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepPick(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  const shallow = pick(record, keys);
  if (shallow !== undefined) return shallow;
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const nested = deepPick(value, keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
};

const todayYYYYMMDD = (): string => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

const daysAgoYYYYMMDD = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

const normalize = (
  data: Record<string, unknown>,
  unitNumber: 0 | 1,
  sensorID: number | undefined
): SleepSummary => {
  // Most recent daily record holds the metrics we care about. Fall back to
  // searching the entire response if the expected path is empty.
  const summary = (data as any)?.summary;
  const dailies =
    summary?.sleepsDailySummary?.sleepSummaryDailyDetails ||
    summary?.dailies ||
    [];
  const latest = Array.isArray(dailies) && dailies.length > 0 ? dailies[0] : data;

  const lastUpdated =
    deepPick(latest, FIELD_CANDIDATES.lastUpdatedGMTSecs) ??
    (typeof (data as any)?.currentServerTimeGmtMs === 'number'
      ? Math.floor((data as any).currentServerTimeGmtMs / 1000)
      : undefined);

  return {
    unitNumber,
    sensorID,
    totalSleepSecs: deepPick(latest, FIELD_CANDIDATES.totalSleepSecs),
    totalTimeInBedSecs: deepPick(latest, FIELD_CANDIDATES.totalTimeInBedSecs),
    sleepEfficiencyPercent: deepPick(latest, FIELD_CANDIDATES.sleepEfficiencyPercent),
    sleepScore: deepPick(latest, FIELD_CANDIDATES.sleepScore),
    sleepLatencySecs: deepPick(latest, FIELD_CANDIDATES.sleepLatencySecs),
    awakeningsCount: deepPick(latest, FIELD_CANDIDATES.awakeningsCount),
    remSecs: deepPick(latest, FIELD_CANDIDATES.remSecs),
    deepSecs: deepPick(latest, FIELD_CANDIDATES.deepSecs),
    lightSecs: deepPick(latest, FIELD_CANDIDATES.lightSecs),
    awakeSecs: deepPick(latest, FIELD_CANDIDATES.awakeSecs),
    bedtimeGMTSecs: deepPick(latest, FIELD_CANDIDATES.bedtimeGMTSecs),
    wakeTimeGMTSecs: deepPick(latest, FIELD_CANDIDATES.wakeTimeGMTSecs),
    avgHeartRateBpm: deepPick(latest, FIELD_CANDIDATES.avgHeartRateBpm),
    avgRespirationRateBpm: deepPick(latest, FIELD_CANDIDATES.avgRespirationRateBpm),
    lastUpdatedGMTSecs: lastUpdated,
    // Expose the latest daily record (not the entire wrapping envelope) on the
    // diagnostic sensor so the user can write template sensors for any
    // unparsed fields.
    raw: latest as Record<string, unknown>,
  };
};

export const getSleepSummary = async (
  _processorId: number,
  unitNumber: 0 | 1,
  sensorID: number | undefined,
  credentials: Credentials
): Promise<SleepSummary | null> => {
  const authHeader = await getAuthHeader(credentials);
  if (!authHeader) return null;

  const { appHost, fpcsiotBaseUrl } = urls(credentials);
  // The webui endpoint lives under /actrack, not /fpcsiot/processor. Build it
  // by replacing the fpcsiot segment of the shared base URL.
  const actrackBaseUrl = fpcsiotBaseUrl.replace('/fpcsiot', '/actrack');
  const url = `${actrackBaseUrl}/webui`;

  const headers = {
    ...defaultHeaders,
    Host: appHost,
    Authorization: authHeader,
  };

  const today = todayYYYYMMDD();
  const startOfRange = daysAgoYYYYMMDD(60);

  // Mirrors the request body captured from the iOS app, with a 60-day window
  // and no modAfterGmtSecs so we always get the most recent record back.
  const body = {
    command: 'fetch',
    dataClass: 'activities',
    clientID: 'sleeptracker-ios-tsi',
    clientVersion: 'H-3.2.0.421',
    id: `smartbed-mqtt:${Date.now()}`,
    includeSleepsDailySummary: true,
    includeSleepsDailySummaryDeletedAndPendingRecordings: true,
    includeSleepsWeeklySummary: true,
    includeSleepsMonthlySummary: true,
    sleepZSleepsSummaries: true,
    includeSleepFailures: false,
    currentRecordingStatus: true,
    newestToOldest: true,
    resultLimitSize: 20,
    sleepsDailyStartDayYYYYMMDD: startOfRange,
    sleepsDailyEndDayYYYYMMDD: today,
    sleepsWeeklyStartDayYYYYMMDD: startOfRange,
    sleepsWeeklyEndDayYYYYMMDD: today,
    sleepsMonthlyStartDayYYYYMMDD: startOfRange,
    sleepsMonthlyEndDayYYYYMMDD: today,
    sleepFailuresStartDayYYYYMMDD: startOfRange,
    sleepFailuresEndDayYYYYMMDD: today,
  };

  try {
    const response = await axios.request({
      method: 'POST',
      url,
      headers,
      data: body,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      logError(
        `[Sleeptracker] sleep-summary HTTP ${response.status} on ${url}`,
        response.data
      );
      return null;
    }

    const data = response.data;
    if (!data || typeof data !== 'object') {
      logInfo('[Sleeptracker] sleep-summary empty or non-JSON response');
      return null;
    }

    const dailiesLen =
      (data as any)?.summary?.sleepsDailySummary?.sleepSummaryDailyDetails?.length ?? 0;
    logInfo(
      `[Sleeptracker] sleep-summary fetched OK; daily records returned: ${dailiesLen}`
    );

    return normalize(data as Record<string, unknown>, unitNumber, sensorID);
  } catch (err) {
    logError('[Sleeptracker] sleep-summary request error', err);
    return null;
  }
};
