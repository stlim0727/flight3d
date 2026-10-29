/** Bounded airborne physics check, without renderer or contact solver.
 * Uses shipped DEM, aerodynamic/engine models and the production integration
 * equations. Browser acceptance remains scripts/verify-f16-lukla.mjs.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';

const data = fs.readFileSync(new URL('../public/terrain/lukla_dem.bin', import.meta.url));
const terrain = Object.assign(Object.create(LuklaTerrain.prototype), {
  size: 44000, gridSize: 1025, shiftX: 0, shiftZ: 0,
  runwayLength: 527, runwayWidth: 30, runwayGradient: 0.1176,
  midElevation: 2836, isLoaded: true,
  elevations: new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4),
});
const input = {};
const sim = {
  activeAirport: 'lukla', currentAircraftId: 'F16', scene: new THREE.Scene(),
  lobby: { demoProfile: 'canyon-chase' },
  position: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
  angularVelocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
  currentTerrain: terrain, aircraft: { group: new THREE.Group(), modelLoaded: true },
  aero: new Aerodynamics(F16_FALCON), engines: new EngineModel(F16_FALCON),
  gear: new LandingGear(F16_FALCON),
  telemetry: { pitchDeg: 0, rollDeg: 0, headingDeg: 238, iasKnots: 420, onGround: false },
  controls: {
    throttle: 1,
    setVirtualInput(key, value) { input[key] = value; },
    clearVirtualInputs() {}, setParkingBrake() {},
  },
  setPreset() {}, applyComputedTrim() {}, cameraSystem: { setMode() {} },
};
const director = new DemoFlightDirector(sim);
director.start('lukla', 'canyon-chase');
const dt = 1 / 120;
for (let i = 0; i < 180 * 120 && director.isActive; i++) {
  director.update(dt);
  const { aero, engines, position, linearVelocity: velocity, angularVelocity: omega, quaternion } = sim;
  // Match the virtual-stick attenuation and surface slew in FlightControls.
  const stiffness = Math.max(0.40, 1 - Math.max(0, (sim.telemetry.iasKnots - 140) / 220) * 0.55);
  for (const [axis, rate] of [['elevator', 0.55], ['aileron', 0.85], ['rudder', 0.60]]) {
    const error = (input[axis] ?? 0) * stiffness - aero[axis];
    aero[axis] += Math.sign(error) * Math.min(Math.abs(error), rate * dt);
  }
  engines.setThrottle(input.throttle ?? 1);
  const engine = engines.update(dt, position.y, velocity.length(), Atmosphere.getConditions(position.y).densityRatio);
  const forces = aero.computeAero(dt, sim.aircraft.group, velocity, omega, position.y,
    position.y - terrain.getHeight(position.x, position.z), engine.totalThrust, 0);
  const thrust = new THREE.Vector3(0, 0, -engine.totalThrust).applyQuaternion(quaternion);
  const acceleration = forces.forceWorld.clone().add(thrust).divideScalar(aero.mass);
  acceleration.y -= Atmosphere.G0;
  velocity.addScaledVector(acceleration, dt);
  const moment = forces.momentBody;
  omega.addScaledVector(new THREE.Vector3(moment.x / aero.Iyy, moment.y / aero.Izz, moment.z / aero.Ixx), dt);
  omega.multiplyScalar(1 - dt * 0.35);
  quaternion.multiply(new THREE.Quaternion(omega.x * dt * 0.5, omega.y * dt * 0.5, omega.z * dt * 0.5, 1).normalize()).normalize();
  position.addScaledVector(velocity, dt);
  sim.aircraft.group.quaternion.copy(quaternion);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  Object.assign(sim.telemetry, {
    pitchDeg: euler.x * 180 / Math.PI, rollDeg: -euler.z * 180 / Math.PI,
    headingDeg: (Math.atan2(forward.x, -forward.z) * 180 / Math.PI + 360) % 360,
    iasKnots: forces.iasKnots,
  });
  assert.ok(position.toArray().every(Number.isFinite), 'finite physical position');
  assert.ok(!forces.isStalled, 'no aerodynamic stall');
}
const result = director.f16CanyonScenario.result;
assert.equal(result.status, 'completed');
assert.ok(result.minClearanceM > 50, 'terrain clearance');
assert.ok(result.maxG >= 7.5 && result.maxG < 10, 'physical high-G pull-up');
assert.ok(result.invertedSeconds > 2, 'sustained inverted crossing');
assert.ok(result.rollTravelDeg > 700, 'barrel roll and half rolls');
console.log('PASS', result);
