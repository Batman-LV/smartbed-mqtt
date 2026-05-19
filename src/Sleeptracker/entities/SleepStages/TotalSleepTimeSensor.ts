import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

const formatHMS = (totalSecs: number): string => {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

// Total sleep formatted as HH:MM:SS — matches `sensor.sleep` from the
// reference dashboard. Useful for the "Total Sleep" tile.
export class TotalSleepTimeSensor extends JsonSleepStageSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, { ...config, valueField: 'sleepTime' });
  }

  mapState(state?: SleepSummary | undefined) {
    const base = super.mapState(state) as Record<string, unknown>;
    const sleepTime =
      state && typeof state.totalSleepSecs === 'number' ? formatHMS(state.totalSleepSecs) : null;
    return { ...base, sleepTime };
  }

  discoveryState() {
    return {
      ...super.discoveryState(),
      icon: 'mdi:bed-clock',
    };
  }
}
