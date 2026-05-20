import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

// Publishes the full raw response from the Sleeptracker cloud as attributes so
// any fields we don't already parse can still be reached via template sensors.
// State shows the lastUpdatedGMTSecs (when known) so the entity updates
// visibly each night.
// Publishes the scalar fields of the raw Sleeptracker daily record as
// attributes so any metric not parsed into a dedicated sensor can still be
// reached via a template sensor. Bulky nested arrays/objects (per-epoch cardio
// samples, sleep spans, sleep events, debrief questions, environment series)
// are stripped — they are far too large to publish as HA attributes on every
// refresh and would bloat the recorder database.
const BULKY_KEYS = new Set([
  'sleepsCardios',
  'sleepsSpans',
  'sleepEvents',
  'bedMotionEvents',
  'snoreReliefEvents',
  'sleepRecordings',
  'debriefQuestions',
  'environment',
]);

export class SleepSummaryDiagnosticSensor extends JsonSleepStageSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, { ...config, category: 'diagnostic', valueField: 'lastUpdatedGMTSecs' });
  }

  mapState(state?: SleepSummary | undefined) {
    if (!state) return {};
    const { raw, lastUpdatedGMTSecs } = state;
    const scalars: Record<string, unknown> = {};
    if (raw) {
      for (const [key, value] of Object.entries(raw)) {
        if (BULKY_KEYS.has(key) || Array.isArray(value)) continue;
        scalars[key] = value;
      }
    }
    return {
      lastUpdatedGMTSecs: lastUpdatedGMTSecs ?? null,
      ...scalars,
    };
  }
}
