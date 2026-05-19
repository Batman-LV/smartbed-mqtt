import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

type StageKey = 'remSecs' | 'deepSecs' | 'lightSecs' | 'awakeSecs';

// One sensor per stage. The state is the duration in seconds; the reference
// dashboard's apexcharts donut uses `as_duration: second` on this value to
// render formatted durations. Icons mirror common HA conventions.
export class StageDurationSensor extends JsonSleepStageSensor {
  private stageKey: StageKey;
  private iconName: string;

  constructor(
    mqtt: IMQTTConnection,
    deviceData: IDeviceData,
    config: EntityConfig,
    stageKey: StageKey,
    iconName: string
  ) {
    super(mqtt, deviceData, { ...config, valueField: 'seconds' });
    this.stageKey = stageKey;
    this.iconName = iconName;
  }

  mapState(state?: SleepSummary | undefined) {
    const base = super.mapState(state) as Record<string, unknown>;
    const value = state ? state[this.stageKey] : undefined;
    return { ...base, seconds: typeof value === 'number' ? value : null };
  }

  discoveryState() {
    return {
      ...super.discoveryState(),
      state_class: 'measurement',
      unit_of_measurement: 's',
      device_class: 'duration',
      icon: this.iconName,
    };
  }
}

export class REMSleepSensor extends StageDurationSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'remSecs', 'mdi:eye-refresh');
  }
}

export class DeepSleepSensor extends StageDurationSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'deepSecs', 'mdi:wave');
  }
}

export class LightSleepSensor extends StageDurationSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'lightSecs', 'mdi:weather-night');
  }
}

export class AwakeTimeSensor extends StageDurationSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'awakeSecs', 'mdi:eye-outline');
  }
}
