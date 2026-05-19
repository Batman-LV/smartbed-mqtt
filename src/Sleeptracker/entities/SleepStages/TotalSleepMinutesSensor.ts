import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

// Total sleep time in minutes. This is what the original Reddit dashboard
// charts as `sensor.sleep_minutes` for the daily column chart.
export class TotalSleepMinutesSensor extends JsonSleepStageSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, { ...config, valueField: 'sleepMinutes' });
  }

  mapState(state?: SleepSummary | undefined) {
    const base = super.mapState(state) as Record<string, unknown>;
    const sleepMinutes =
      state && typeof state.totalSleepSecs === 'number'
        ? Math.round(state.totalSleepSecs / 60)
        : null;
    return { ...base, sleepMinutes };
  }

  discoveryState() {
    return {
      ...super.discoveryState(),
      state_class: 'measurement',
      unit_of_measurement: 'min',
      icon: 'mdi:sleep',
    };
  }
}
