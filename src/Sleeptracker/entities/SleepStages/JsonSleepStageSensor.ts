import { JsonSensor } from '@ha/JsonSensor';
import { cleanJsonState } from '@utils/cleanJsonState';
import { SleepSummary } from '../../types/SleepSummary';

export class JsonSleepStageSensor extends JsonSensor<SleepSummary> {
  mapState(state?: SleepSummary | undefined) {
    return cleanJsonState(state);
  }
}
