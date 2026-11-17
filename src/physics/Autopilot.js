import { AutopilotController as CoreAutopilot } from '@stlim0727/flightsim-core/physics/Autopilot.js';
import { approachDeviation } from '../config/approachData.js';
export { wrapHeading, autopilotState } from '@stlim0727/flightsim-core/physics/Autopilot.js';

/** Supply Flight3d's airport navigation to the standalone controller. */
export class AutopilotController extends CoreAutopilot {
  constructor(options = {}) {
    super({ approachDeviation, ...options });
  }
}
