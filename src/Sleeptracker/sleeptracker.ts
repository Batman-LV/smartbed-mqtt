import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { Dictionary } from '@utils/Dictionary';
import { getSideNameFunc } from '@utils/getSideNameFunc';
import { logError, logInfo } from '@utils/logger';
import { minutes } from '@utils/minutes';
import { buildEntityConfig } from 'Sleeptracker/buildEntityConfig';
import { buildMQTTDeviceData } from './buildMQTTDeviceData';
import { DeviceInfoSensor } from './entities/DeviceInfoSensor';
import { HelloDataSensor } from './entities/InfoSensor';
import { SleepSensorInfoSensor } from './entities/SensorMapInfoSensor';
import { getRefreshFrequency, getUsers } from './options';
import { processBedPositionSensors } from './processors/bedPositionSensors';
import { processEnvironmentSensors } from './processors/environmentSensors';
import { setupMassageButtons } from './processors/massageButtons';
import { processMassageSensors } from './processors/massageSensors';
import { setupPresetButtons } from './processors/presetButtons';
import { processSafetyLightSwitches } from './processors/safetyLightSwitches';
import { processSleepSummary } from './processors/sleepSummary';
import { processSnoreReliefSwitches } from './processors/snoreReliefSwitches';
import { getDevices } from './requests/getDevices';
import { getHelloData } from './requests/getHelloData';
import { getSleepSensors } from './requests/getSleepSensors';
import { sendAdjustableBaseCommand } from './requests/sendAdjustableBaseCommand';
import { Bed } from './types/Bed';
import { Commands } from './types/Commands';
import { setupMotorEntities } from './processors/motorEntities';

const beds: Dictionary<Bed> = {};

export const sleeptracker = async (mqtt: IMQTTConnection) => {
  const users = getUsers();
  if (!users.length) return logInfo('[Sleeptracker] No users configured');
  for (const user of users) {
    const devices = await getDevices(user);
    if (devices.length === 0) {
      return logError('[Sleeptracker] Could not load devices');
    }
    for (const device of devices) {
      const { sleeptrackerProcessorID: processorId } = device;
      let bed = beds[processorId];

      const helloData = await getHelloData(processorId, user);
      if (!helloData) {
        logError('[Sleeptracker] Could not load helloData');
        continue;
      }

      if (!bed) {
        const {
          baseSmartCableSupported: isSmartBed,
          powerBase: { antiSnorePresetSupported, headAngleTicksPerDegree, footAngleTicksPerDegree },
        } = device;
        const deviceData = buildMQTTDeviceData(device);
        bed = beds[processorId] = {
          processorId,
          deviceData,
          primaryUser: user,
          controllers: [],
          sensors: [],
          supportedFeatures: {
            smartBedControls: isSmartBed,
            antiSnorePreset: antiSnorePresetSupported,
            environmentSensors: helloData.productFeatures.includes('env_sensors'),
            motors: helloData.productFeatures.includes('motors'),
          },
          data: { headAngleTicksPerDegree, footAngleTicksPerDegree },
          entities: {
            deviceInfo: new DeviceInfoSensor(mqtt, deviceData).setState(device),
            helloData: new HelloDataSensor(mqtt, deviceData).setState(helloData),
          },
        };
      }
      const capabilities = helloData.motorMeta.capabilities;
      const sleepSensors = await getSleepSensors(bed.processorId, user);
      const sideNameFunc = getSideNameFunc(sleepSensors, (s) => s.unitNumber);
      for (const sleepSensor of sleepSensors) {
        const { unitNumber: side } = sleepSensor;
        const sideName = sideNameFunc(sleepSensor);
        bed.sensors[side] = { ...sleepSensor, sideName };

        const entityKey = `sleepSensor.${sideName}`;
        let sleepSensorInfo = bed.entities[entityKey] as SleepSensorInfoSensor;
        if (!sleepSensorInfo) {
          sleepSensorInfo = bed.entities[entityKey] = new SleepSensorInfoSensor(
            mqtt,
            bed.deviceData,
            buildEntityConfig('Sleep Sensor', sideName)
          )
            .setState(sleepSensor)
            .setOnline();
        }
        if (sleepSensor.self) {
          bed.sensors[side] = { ...sleepSensor, sideName, user };
          sleepSensorInfo.setState(sleepSensor);
          const capability =
            capabilities.length === 1 ? capabilities[0] : capabilities.find((c) => c.side === sleepSensor.unitNumber);
          const sideNameFunc = getSideNameFunc(capabilities, (c) => c.side);
          if (!capability || bed.controllers.find((s) => s.side === capability.side)) continue;

          bed.controllers.push({
            user,
            side: capability.side,
            sideName: sideNameFunc(capability),
            capability,
            entities: {},
          });
        }
      }
    }
  }

  const refreshDeviceData = async () => {
    for (const bed of Object.values(beds)) {
      logInfo('[Sleeptracker] Fetching data for bed', bed.processorId);
      const { smartBedControls, environmentSensors, motors } = bed.supportedFeatures;
      if (smartBedControls) {
        const snapshots = await sendAdjustableBaseCommand(Commands.Status, bed.primaryUser);
        for (const controller of bed.controllers) {
          await setupPresetButtons(mqtt, bed, controller);
          await setupMassageButtons(mqtt, bed, controller);
          if (motors) await setupMotorEntities(mqtt, bed, controller);

          await processSnoreReliefSwitches(mqtt, bed, controller);

          const snapshot = snapshots.find((s) => s.side === controller.side);
          if (!snapshot) continue;

          await processBedPositionSensors(mqtt, bed, controller, snapshot);
          await processMassageSensors(mqtt, bed, controller, snapshot);

          await processSafetyLightSwitches(mqtt, bed, controller, snapshot);
        }
      }
      if (environmentSensors) await processEnvironmentSensors(mqtt, bed);

      // Sleep summary — fetch per side whose owning user we have credentials for.
      for (const sleepSensor of bed.sensors) {
        if (!sleepSensor || !sleepSensor.self || !sleepSensor.sideName) continue;
        await processSleepSummary(mqtt, bed, sleepSensor as any);
      }
    }
  };
  await refreshDeviceData();
  setInterval(refreshDeviceData, minutes(getRefreshFrequency()));
};
