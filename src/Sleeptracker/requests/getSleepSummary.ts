import { logError, logInfo } from '@utils/logger';
import axios, { AxiosResponse } from 'axios';
import { Credentials } from '../options';
import { SleepSummary } from '../types/SleepSummary';
import { getAuthHeader } from './getAuthHeader';
import defaultHeaders from './shared/defaultHeaders';
import { buildDefaultPayload } from './shared/defaultPayload';
import { urls } from './shared/urls';

// The Sleeptracker mobile app shows REM/Deep/Light/Awake + total sleep + HR +
// respiration + sleep score, so the data is reachable somewhere on the
// app.tsi.sleeptracker.com cloud. The exact endpoint name and response shape
// are not documented publicly. This module tries a sequence of plausible
// endpoints and stops at the first 2xx response with a parseable body, logging
// each attempt so the working one becomes obvious in the supervisor logs.
//
// If none of the candidates here works, capture HTTPS traffic from the official
// Sleeptracker app (HTTP Toolkit on Android, Proxyman/mitmproxy on iOS) while
// you scroll the daily sleep view, find the request whose body contains a
// `sleeptrackerProcessorID` and a date range, and add its path + payload to
// the CANDIDATE_PATHS / extra payload below.
const CANDIDATE_PATHS = [
  '/latestSleepSummary',
  '/getLatestSleepSummary',
  '/sleepSummary',
  '/getSleepSummary',
  '/getDailySleep',
  '/getSleepHistory',
  '/getSleepActivity',
  '/latestActivityData',
  '/getSleepData',
  '/getSleepSession',
];

// Field-name candidates per metric — first match wins. Add more as you
// discover them in the raw payload published to the diagnostic sensor.
const FIELD_CANDIDATES = {
  totalSleepSecs: ['totalSleepSecs', 'totalSleepSeconds', 'totalSleep', 'sleepSecs', 'sleepDurationSecs'],
  totalTimeInBedSecs: ['totalTimeInBedSecs', 'timeInBedSecs', 'inBedSecs', 'totalTimeInBed'],
  sleepEfficiencyPercent: ['sleepEfficiency', 'sleepEfficiencyPercent', 'efficiency', 'efficiencyPercent'],
  sleepScore: ['sleepScore', 'score', 'qualityScore', 'sleepQuality'],
  sleepLatencySecs: ['sleepLatencySecs', 'sleepLatency', 'timeToSleepSecs', 'timeToFallAsleepSecs'],
  awakeningsCount: ['awakenings', 'awakeningsCount', 'numAwakenings', 'wakeCount'],
  remSecs: ['remSecs', 'remSleepSecs', 'remSeconds', 'rem'],
  deepSecs: ['deepSecs', 'deepSleepSecs', 'deepSeconds', 'deep'],
  lightSecs: ['lightSecs', 'lightSleepSecs', 'lightSeconds', 'light'],
  awakeSecs: ['awakeSecs', 'awakeSeconds', 'awakeTimeSecs', 'awake', 'wakeSecs'],
  bedtimeGMTSecs: ['bedtimeGMTSecs', 'bedTimeGMTSecs', 'bedtimeGmtSecs', 'fellAsleepGMTSecs', 'sleepOnsetGMTSecs'],
  wakeTimeGMTSecs: ['wakeTimeGMTSecs', 'wakeUpGMTSecs', 'wakeGmtSecs', 'wakeupGMTSecs'],
  avgHeartRateBpm: ['avgHeartRate', 'averageHeartRate', 'heartRateAvg', 'avgHeartRateBpm', 'avgHR'],
  avgRespirationRateBpm: ['avgRespirationRate', 'averageRespirationRate', 'respirationRateAvg', 'avgBR', 'avgBreathRate'],
  lastUpdatedGMTSecs: ['lastUpdatedGMTSecs', 'uploadedGMTSecs', 'recordedGMTSecs', 'createdGMTSecs'],
};

const pick = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) return Number(value);
  }
  return undefined;
};

// Recursively search for a key in a nested object, returning the first match.
// Sleeptracker payloads sometimes wrap the data in `dataList`, `sessions`,
// `summary`, etc. — this keeps us tolerant to shape variation without having
// to know it in advance.
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

const normalize = (
  raw: Record<string, unknown>,
  unitNumber: 0 | 1,
  sensorID?: number
): SleepSummary => ({
  unitNumber,
  sensorID,
  totalSleepSecs: deepPick(raw, FIELD_CANDIDATES.totalSleepSecs),
  totalTimeInBedSecs: deepPick(raw, FIELD_CANDIDATES.totalTimeInBedSecs),
  sleepEfficiencyPercent: deepPick(raw, FIELD_CANDIDATES.sleepEfficiencyPercent),
  sleepScore: deepPick(raw, FIELD_CANDIDATES.sleepScore),
  sleepLatencySecs: deepPick(raw, FIELD_CANDIDATES.sleepLatencySecs),
  awakeningsCount: deepPick(raw, FIELD_CANDIDATES.awakeningsCount),
  remSecs: deepPick(raw, FIELD_CANDIDATES.remSecs),
  deepSecs: deepPick(raw, FIELD_CANDIDATES.deepSecs),
  lightSecs: deepPick(raw, FIELD_CANDIDATES.lightSecs),
  awakeSecs: deepPick(raw, FIELD_CANDIDATES.awakeSecs),
  bedtimeGMTSecs: deepPick(raw, FIELD_CANDIDATES.bedtimeGMTSecs),
  wakeTimeGMTSecs: deepPick(raw, FIELD_CANDIDATES.wakeTimeGMTSecs),
  avgHeartRateBpm: deepPick(raw, FIELD_CANDIDATES.avgHeartRateBpm),
  avgRespirationRateBpm: deepPick(raw, FIELD_CANDIDATES.avgRespirationRateBpm),
  lastUpdatedGMTSecs: deepPick(raw, FIELD_CANDIDATES.lastUpdatedGMTSecs),
  raw,
});

// Cache the working endpoint between calls so we don't probe every refresh.
let workingPath: string | null = null;

export const getSleepSummary = async (
  processorId: number,
  unitNumber: 0 | 1,
  sensorID: number | undefined,
  credentials: Credentials
): Promise<SleepSummary | null> => {
  const authHeader = await getAuthHeader(credentials);
  if (!authHeader) return null;

  const { appHost, processorBaseUrl } = urls(credentials);
  const headers = { ...defaultHeaders, Host: appHost, Authorization: authHeader };
  const payload = {
    ...buildDefaultPayload('sleepSummary', credentials),
    sleeptrackerProcessorID: processorId,
    unitNumber,
    ...(sensorID !== undefined ? { sensorID } : {}),
  };

  const paths = workingPath ? [workingPath, ...CANDIDATE_PATHS.filter((p) => p !== workingPath)] : CANDIDATE_PATHS;

  for (const path of paths) {
    const url = `${processorBaseUrl}${path}`;
    let response: AxiosResponse | undefined;
    try {
      response = await axios.request({
        method: 'POST',
        url,
        headers,
        data: payload,
        validateStatus: () => true,
      });
    } catch (err) {
      logError(`[Sleeptracker] sleep-summary probe error on ${path}`, err);
      continue;
    }

    if (!response) continue;
    if (response.status < 200 || response.status >= 300) {
      logInfo(`[Sleeptracker] sleep-summary probe ${path} -> HTTP ${response.status}`);
      continue;
    }

    const body = response.data;
    if (!body || typeof body !== 'object') {
      logInfo(`[Sleeptracker] sleep-summary probe ${path} -> empty or non-JSON body`);
      continue;
    }

    workingPath = path;
    logInfo(`[Sleeptracker] sleep-summary endpoint confirmed: ${path}`);
    return normalize(body as Record<string, unknown>, unitNumber, sensorID);
  }

  logError('[Sleeptracker] No candidate sleep-summary endpoint returned data. Capture the official app traffic and add the real path to CANDIDATE_PATHS in src/Sleeptracker/requests/getSleepSummary.ts.');
  return null;
};
