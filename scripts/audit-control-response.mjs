import * as THREE from 'three';
import { pathToFileURL } from 'node:url';
import { FlightControls } from '../src/controls/FlightControls.js';
import { shapeTouchStick } from '../src/controls/TouchFlightControls.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';

/** Fixed-airflow snapshot, not a flight envelope or manufacturer validation.
 * Settle the live control actuator, then measure incremental moment/acceleration
 * relative to neutral. Use the live integrator's pitch/roll inertia convention.
 */
export function sampleControlResponse({ input, axis = 'roll', legacyGyro = false,
  iasKnots = 350, altitudeMeters = 3000 } = {}) {
  const previousWindow = globalThis.window;
  globalThis.window ??= { addEventListener() {} };
  try {
    const controls = new FlightControls({ addEventListener() {} });
    const normalized = legacyGyro ? input : shapeTouchStick(0, input)[1];
    controls.setTouchStick(axis === 'pitch' ? normalized : 0, axis === 'roll' ? normalized : 0);
    for (let i = 0; i < 240; i++) controls.update(1 / 120, iasKnots);
    const aero = new Aerodynamics(F16_FALCON);
    aero.pitchTrim = 0;
    const densityRatio = Atmosphere.getConditions(altitudeMeters).densityRatio;
    const tas = Atmosphere.iasToTas(Atmosphere.knotsToMs(iasKnots), densityRatio);
    const velocity = new THREE.Vector3(0, -tas * Math.sin(.05), -tas * Math.cos(.05));
    const mesh = new THREE.Object3D();
    const measure = () => {
      const result = aero.computeAero(1 / 120, mesh, velocity, new THREE.Vector3(), altitudeMeters, 1000, 0, 0);
      return axis === 'pitch' ? result.momentBody.x * aero.invIyy : -result.momentBody.z * aero.invIxx;
    };
    const neutral = measure();
    aero.elevator = controls.elevator;
    aero.aileron = controls.aileron;
    const acceleration = THREE.MathUtils.radToDeg(measure() - neutral);
    return { input, normalized, surface: axis === 'pitch' ? aero.elevator : aero.aileron,
      accelerationDegS2: acceleration };
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('F16, 350 KIAS, 3000 m, AoA 2.86 deg, fixed airflow; incremental initial acceleration after actuator settling.');
  console.log('travel_pct,shaped_input_pct,legacy_gyro_pct,pitch_accel_deg_s2,legacy_pitch_accel_deg_s2,roll_accel_deg_s2,legacy_roll_accel_deg_s2');
  for (const input of [0, .05, .1, .2, .4, .5, .6, .8, 1]) {
    const roll = sampleControlResponse({ input });
    const pitch = sampleControlResponse({ input, axis: 'pitch' });
    const legacyRoll = sampleControlResponse({ input, legacyGyro: true });
    const legacyPitch = sampleControlResponse({ input, axis: 'pitch', legacyGyro: true });
    console.log([input * 100, roll.normalized * 100, legacyRoll.normalized * 100,
      pitch.accelerationDegS2, legacyPitch.accelerationDegS2,
      roll.accelerationDegS2, legacyRoll.accelerationDegS2].map(v => v.toFixed(3)).join(','));
  }
}
