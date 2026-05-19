import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

// Publishes the full raw response from the Sleeptracker cloud as attributes so
// any fields we don't already parse can still be reached via template sensors.
// State shows the lastUpdatedGMTSecs (when known) so the entity updates
// visibly each night.
export class SleepSummaryDiagnosticSensor extends JsonSleepStageSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, { ...config, category: 'diagnostic', valueField: 'lastUpdatedGMTSecs' });
  }

  mapState(state?: SleepSummary | undefined) {
    if (!state) return {};
    const { raw, lastUpdatedGMTSecs } = state;
    return {
      lastUpdatedGMTSecs: lastUpdatedGMTSecs ?? null,
      ...(raw ?? {}),
    };
  }
}
