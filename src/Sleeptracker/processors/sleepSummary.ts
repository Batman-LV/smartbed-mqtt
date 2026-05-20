import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { logInfo } from '@utils/logger';
import { buildEntityConfig } from '../buildEntityConfig';
import {
  AwakeTimeSensor,
  DeepSleepSensor,
  LightSleepSensor,
  REMSleepSensor,
} from '../entities/SleepStages/StageSensors';
import {
  AwakeningsSensor,
  HeartRateAvgSensor,
  RespirationRateAvgSensor,
  SleepEfficiencySensor,
  SleepLatencySensor,
  SleepScoreSensor,
} from '../entities/SleepStages/ScalarSensors';
import { SleepHistorySensor } from '../entities/SleepStages/SleepHistorySensor';
import { SleepSummaryDiagnosticSensor } from '../entities/SleepStages/SleepSummaryDiagnosticSensor';
import { TotalSleepMinutesSensor } from '../entities/SleepStages/TotalSleepMinutesSensor';
import { TotalSleepTimeSensor } from '../entities/SleepStages/TotalSleepTimeSensor';
import { getSleepSummary } from '../requests/getSleepSummary';
import { importSleepStatistics } from '../statistics/importStatistics';
import { Bed } from '../types/Bed';
import { SleepSensor } from '../types/SleepSensor';

const sensorClasses = [
  { key: 'sleepTotalMinutes', label: 'Sleep Minutes', Cls: TotalSleepMinutesSensor },
  { key: 'sleepTotalTime', label: 'Sleep', Cls: TotalSleepTimeSensor },
  { key: 'sleepREM', label: 'REM Sleep', Cls: REMSleepSensor },
  { key: 'sleepDeep', label: 'Deep Sleep', Cls: DeepSleepSensor },
  { key: 'sleepLight', label: 'Light Sleep', Cls: LightSleepSensor },
  { key: 'sleepAwake', label: 'Awake Time', Cls: AwakeTimeSensor },
  { key: 'sleepScore', label: 'Sleep Score', Cls: SleepScoreSensor },
  { key: 'sleepEfficiency', label: 'Sleep Efficiency', Cls: SleepEfficiencySensor },
  { key: 'sleepLatency', label: 'Sleep Latency', Cls: SleepLatencySensor },
  { key: 'sleepAwakenings', label: 'Awakenings', Cls: AwakeningsSensor },
  { key: 'sleepHeartRate', label: 'Average Heart Rate', Cls: HeartRateAvgSensor },
  { key: 'sleepRespirationRate', label: 'Average Respiration Rate', Cls: RespirationRateAvgSensor },
  { key: 'sleepSummaryRaw', label: 'Sleep Summary Raw', Cls: SleepSummaryDiagnosticSensor },
  { key: 'sleepHistory', label: 'Sleep History', Cls: SleepHistorySensor },
] as const;

export const processSleepSummary = async (
  mqtt: IMQTTConnection,
  bed: Bed,
  sleepSensor: SleepSensor & { sideName: string; user?: Bed['primaryUser'] }
) => {
  const credentials = sleepSensor.user ?? bed.primaryUser;
  const summary = await getSleepSummary(
    bed.processorId,
    sleepSensor.unitNumber,
    sleepSensor.sensorID,
    credentials
  );
  if (!summary) {
    logInfo(`[Sleeptracker] No sleep summary returned for unit ${sleepSensor.unitNumber}`);
    return;
  }

  for (const { key, label, Cls } of sensorClasses) {
    const entityKey = `${key}.${sleepSensor.sideName}`;
    let entity = bed.entities[entityKey] as InstanceType<typeof Cls> | undefined;
    if (!entity) {
      entity = new Cls(mqtt, bed.deviceData, buildEntityConfig(label, sleepSensor.sideName));
      bed.entities[entityKey] = entity;
      entity.setOnline();
    }
    entity.setState(summary);
  }

  // Backfill / refresh Home Assistant long-term statistics from the full
  // nightly history. Fire-and-forget — self-throttled and never throws.
  void importSleepStatistics(summary.history, sleepSensor.sideName);
};
