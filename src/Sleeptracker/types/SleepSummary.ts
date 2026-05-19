// Sleep summary data returned from the Sleeptracker cloud, normalized into
// the fields that the Sleeptracker app exposes per its app-store description:
//
//   - REM sleep, light sleep, deep sleep, awake time (durations)
//   - Time fell asleep / woke up
//   - Number of awakenings
//   - Continuous respiration rate
//   - Continuous heart rate
//   - Sleep quality metric (scale of 0-100)
//   - Sleep efficiency
//   - Time to fall asleep
//
// The exact field names on the wire are not known from public sources. We
// fetch the raw response, store it on a diagnostic sensor for inspection,
// and extract fields by trying a list of plausible names — so the integration
// is resilient to naming differences between API versions and bed types.

export type SleepSummary = {
  // Per-side identification
  unitNumber: 0 | 1;
  sensorID?: number;

  // Total sleep
  totalSleepSecs?: number;
  totalTimeInBedSecs?: number;
  sleepEfficiencyPercent?: number;
  sleepScore?: number; // 0-100
  sleepLatencySecs?: number; // time to fall asleep
  awakeningsCount?: number;

  // Stage durations (seconds)
  remSecs?: number;
  deepSecs?: number;
  lightSecs?: number;
  awakeSecs?: number;

  // Times (unix epoch seconds, GMT)
  bedtimeGMTSecs?: number;
  wakeTimeGMTSecs?: number;

  // Vitals (averages across the night)
  avgHeartRateBpm?: number;
  avgRespirationRateBpm?: number;

  // The raw payload as received from the cloud — published to a diagnostic
  // sensor so the user can inspect unknown fields and write template sensors.
  raw?: Record<string, unknown>;

  // GMT seconds when this summary was uploaded by the bed; used to detect
  // stale data.
  lastUpdatedGMTSecs?: number;
};
