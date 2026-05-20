import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

// Publishes every night the Sleeptracker API returned (typically the last
// ~20-120 days) as a `history` attribute. The state is the number of nights.
//
// This exists so Home Assistant long-term statistics can be backfilled in one
// pass — the per-metric sensors only ever hold the most recent night, so
// without this the dashboard charts would take weeks to accumulate history.
// A consumer reads the `history` attribute and imports each night into the
// recorder via the `recorder.import_statistics` service.
export class SleepHistorySensor extends JsonSleepStageSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, { ...config, category: 'diagnostic', valueField: 'nights' });
  }

  mapState(state?: SleepSummary | undefined) {
    const history = state?.history ?? [];
    return {
      nights: history.length,
      history,
    };
  }

  discoveryState() {
    return {
      ...super.discoveryState(),
      icon: 'mdi:history',
    };
  }
}
