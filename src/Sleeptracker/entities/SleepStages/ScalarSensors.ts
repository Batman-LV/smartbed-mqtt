import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { EntityConfig } from '@ha/base/Entity';
import { JsonSleepStageSensor } from './JsonSleepStageSensor';
import { SleepSummary } from '../../types/SleepSummary';

type FieldKey = Exclude<keyof SleepSummary, 'unitNumber' | 'sensorID' | 'raw'>;

class ScalarSensor extends JsonSleepStageSensor {
  private fieldKey: FieldKey;
  private discoveryExtras: Record<string, unknown>;

  constructor(
    mqtt: IMQTTConnection,
    deviceData: IDeviceData,
    config: EntityConfig,
    fieldKey: FieldKey,
    discoveryExtras: Record<string, unknown>
  ) {
    super(mqtt, deviceData, { ...config, valueField: 'value' });
    this.fieldKey = fieldKey;
    this.discoveryExtras = discoveryExtras;
  }

  mapState(state?: SleepSummary | undefined) {
    const base = super.mapState(state) as Record<string, unknown>;
    const value = state ? state[this.fieldKey] : undefined;
    return { ...base, value: typeof value === 'number' ? value : null };
  }

  discoveryState() {
    return { ...super.discoveryState(), ...this.discoveryExtras };
  }
}

export class SleepScoreSensor extends ScalarSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'sleepScore', {
      state_class: 'measurement',
      unit_of_measurement: 'pts',
      icon: 'mdi:star-circle',
    });
  }
}

export class SleepEfficiencySensor extends ScalarSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'sleepEfficiencyPercent', {
      state_class: 'measurement',
      unit_of_measurement: '%',
      icon: 'mdi:gauge',
    });
  }
}

export class SleepLatencySensor extends ScalarSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'sleepLatencySecs', {
      state_class: 'measurement',
      unit_of_measurement: 's',
      device_class: 'duration',
      icon: 'mdi:timer-sand',
    });
  }
}

export class AwakeningsSensor extends ScalarSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'awakeningsCount', {
      state_class: 'measurement',
      icon: 'mdi:eye',
    });
  }
}

export class HeartRateAvgSensor extends ScalarSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'avgHeartRateBpm', {
      state_class: 'measurement',
      unit_of_measurement: 'bpm',
      icon: 'mdi:heart-pulse',
    });
  }
}

export class RespirationRateAvgSensor extends ScalarSensor {
  constructor(mqtt: IMQTTConnection, deviceData: IDeviceData, config: EntityConfig) {
    super(mqtt, deviceData, config, 'avgRespirationRateBpm', {
      state_class: 'measurement',
      unit_of_measurement: 'br/min',
      icon: 'mdi:lungs',
    });
  }
}
