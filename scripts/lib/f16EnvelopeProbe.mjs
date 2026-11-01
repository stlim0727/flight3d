import * as THREE from 'three';
import { createPilotMissionSimulation } from '../../tests/helpers/pilotMissionFlight.js';
import { solveTrim } from '../../src/physics/TrimSolver.js';

/** Host-only attitude fixture used to measure the production F-16 response.
 * It commands control surfaces only: no terrain, no navigation, no course and no
 * aircraft model of its own. Every number it reports is what the shared physics
 * plant actually did, so a saturated surface or a diverging loop shows up as a
 * measured limit instead of an assumed one. This is a measuring instrument, not
 * a candidate pilot and not course-following intelligence. */

const RAD = Math.PI / 180, DEG = 180 / Math.PI, DT = 1 / 120;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const AXES = ['elevator', 'aileron', 'rudder', 'throttle', 'brakes'];

export function createProbeSimulation() {
  const sim = createPilotMissionSimulation({ aircraftId: 'F16', airportId: 'coastal' });
  sim.controls.clearVirtualInputs();
  sim.controls.releaseAllKeys();
  sim.autopilot.disengage();
  sim.gear.setGearTarget(false); sim.gear.gearState = 0; sim.gear.resetContacts();
  sim.aero.setFlapPosition(0); sim.aero.currentFlapAngle = 0; sim.aero.spoilers = 0;
  sim.engines.setReverser(false, false);
  sim.controls.setParkingBrake(false);
  sim.windField = null; sim.windTimeSeconds = 0; sim.aero.windWorld.set(0, 0, 0);
  sim.aero.massProperties.setConfiguration(0, 0); sim.aero.syncMassProperties();
  return sim;
}

/** Truth-state sampling for the fixture. The measured pilot never sees this. */
function state(sim) {
  const euler = new THREE.Euler().setFromQuaternion(sim.quaternion, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(sim.quaternion);
  const air = sim.linearVelocity.clone().sub(sim.aero.windWorld);
  return {
    iasKnots: sim.aero.ias * 1.943844,
    tasMs: air.length(),
    altitudeM: sim.position.y,
    pitchDeg: euler.x * DEG,
    rollDeg: -euler.z * DEG,
    headingDeg: (Math.atan2(forward.x, -forward.z) * DEG + 360) % 360,
    vzMs: sim.linearVelocity.y,
    pitchRateDegS: sim.angularVelocity.x * DEG,
    rollRateDegS: -sim.angularVelocity.z * DEG,
    alphaDeg: sim.aero.alpha * DEG,
    separation: sim.aero.separation,
    throttle: sim.controls.throttle,
    elevator: sim.controls.elevator,
    aileron: sim.controls.aileron,
    gForce: sim.aero.gForce,
  };
}

/** Cascaded attitude loops: a bank plus altitude (or airspeed) command produces
 * body-rate commands, and rate errors produce surface commands that saturate at
 * the production authority limits. Holding altitude is the pitch task at a fixed
 * throttle, so airspeed settles wherever the plant's thrust/drag balance puts
 * it; holding airspeed is the pitch task at a pinned throttle, so altitude
 * settles instead. Either way the reported value is the aircraft's own
 * equilibrium, not a prediction of it. */
export class AttitudeFixture {
  constructor(sim, { bankDeg = 0, hold = 'altitude', iasKnots = 240, throttle = 0,
    alphaRefDeg = 0, flightPathAngleDeg = 0, sinkRateMs = 0 }) {
    this.sim = sim;
    this.bankCmd = bankDeg;
    this.holdMode = hold;
    this.iasCmd = iasKnots;
    this.throttleCmd = throttle;
    this.alphaRefDeg = alphaRefDeg;
    this.fpaCmdDeg = flightPathAngleDeg;
    this.sinkCmdMs = sinkRateMs;
    this.altitudeRef = null;
    this.altitudeIntegrator = 0;
    this.speedIntegrator = 0;
    this.sinkIntegrator = 0;
    this.saturated = { elevator: 0, aileron: 0, throttle: 0 };
    this.ticks = 0;
  }

  command(sample) {
    if (this.altitudeRef === null) this.altitudeRef = sample.altitudeM;
    const rollRateCmd = clamp(2.5 * (this.bankCmd - sample.rollDeg), -120, 120);
    const aileron = clamp(0.012 * (rollRateCmd - sample.rollRateDegS), -1, 1);
    let pitchCmdDeg, throttleCmd = this.throttleCmd;
    if (this.holdMode === 'altitude') {
      const errorM = this.altitudeRef - sample.altitudeM;
      this.altitudeIntegrator = clamp(this.altitudeIntegrator + errorM * DT, -120, 120);
      pitchCmdDeg = this.alphaRefDeg
        + clamp(0.05 * errorM + 0.01 * this.altitudeIntegrator - 0.3 * sample.vzMs, -12, 18);
    } else if (this.holdMode === 'path') {
      // Attitude target only: whether the aircraft can keep its speed there is
      // the answer to the climb/descent question, so nothing closes the loop.
      pitchCmdDeg = this.alphaRefDeg + this.fpaCmdDeg;
    } else {
      // Over-speed is bled into altitude, so the nose rises when fast.
      const overSpeedKt = sample.iasKnots - this.iasCmd;
      this.speedIntegrator = clamp(this.speedIntegrator + overSpeedKt * DT, -60, 60);
      pitchCmdDeg = this.alphaRefDeg + clamp(0.15 * overSpeedKt + 0.15 * this.speedIntegrator, -14, 20);
      if (this.holdMode === 'energy') {
        // Speed-on-pitch, path-on-throttle: the actuator pairing an altitude
        // requirement actually tests. Throttle has no negative authority, so a
        // path the engines cannot hold shows up as idle saturation plus a
        // residual airspeed drift instead of a silent assumption.
        const sinkErrorMs = -this.sinkCmdMs - sample.vzMs;
        this.sinkIntegrator = clamp(this.sinkIntegrator + 0.02 * sinkErrorMs * DT, -0.5, 0.5);
        throttleCmd = clamp(0.1 + 0.02 * sinkErrorMs + this.sinkIntegrator, 0, 1);
      }
    }
    const pitchRateCmd = clamp(2 * (pitchCmdDeg - sample.pitchDeg), -60, 60);
    const elevator = clamp(0.012 * (pitchRateCmd - sample.pitchRateDegS), -1, 1);
    if (Math.abs(elevator) > 0.999999) this.saturated.elevator++;
    if (Math.abs(aileron) > 0.999999) this.saturated.aileron++;
    if (throttleCmd <= 1e-6 || throttleCmd >= 1 - 1e-6) this.saturated.throttle++;
    this.ticks++;
    return { elevator, aileron, rudder: 0, throttle: throttleCmd, brakes: 0 };
  }

  step() {
    const sample = state(this.sim);
    const command = this.command(sample);
    for (const axis of AXES) this.sim.controls.setVirtualInput(axis, command[axis]);
    this.sim.totalSimTime += DT;
    this.sim.integratePhysics(DT);
    return sample;
  }
}

function spawnTrimmed(sim, { iasKnots, altitudeMeters, headingDeg, spoilers }) {
  const solution = solveTrim(sim.aero, sim.engines, { iasKnots, altitudeMeters,
    flightPathAngleDeg: 0, flapsIndex: 0, gearState: 0, spoilers });
  if (!solution.feasible) throw new Error(`trim-infeasible: ${solution.reason} at ${iasKnots} kt`);
  sim.aero.spoilers = spoilers;
  sim.position.set(0, altitudeMeters, 0);
  sim.angularVelocity.set(0, 0, 0);
  const heading = headingDeg * RAD;
  sim.quaternion.setFromEuler(new THREE.Euler(solution.alphaDeg * RAD, -heading, 0, 'YXZ'));
  sim.linearVelocity.set(Math.sin(heading) * solution.tas, 0, -Math.cos(heading) * solution.tas);
  sim.controls.pitchTrim = sim.aero.pitchTrim = solution.handsOffTrimDeg;
  sim.controls.throttle = solution.throttle;
  sim.engines.setThrottle(solution.throttle);
  sim.engines.settleSpool();
  sim.aircraft.group.position.copy(sim.position);
  sim.aircraft.group.quaternion.copy(sim.quaternion);
  sim.aircraft.group.updateMatrixWorld(true);
  return solution;
}

function statistics(samples) {
  const mean = key => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const spread = key => {
    const average = mean(key);
    return Math.sqrt(samples.reduce((sum, s) => sum + (s[key] - average) ** 2, 0) / samples.length);
  };
  return { mean, spread };
}

/** Trim into the requested condition, hold it for `seconds` and average the
 * window after `settleSeconds`. The spread columns say whether the plant really
 * settled: a wide spread means the requested point is not an equilibrium and
 * must not be used as a sizing number. */
export function probe({ altitudeMeters = 2100, iasKnots = 240, headingDeg = 180, bankDeg = 0,
  hold = 'altitude', throttle = 0, spoilers = 0, flightPathAngleDeg = 0, sinkRateMs = 0,
  seconds = 36, settleSeconds = 18 } = {}) {
  const sim = createProbeSimulation();
  const solution = spawnTrimmed(sim, { iasKnots, altitudeMeters, headingDeg, spoilers });
  const fixture = new AttitudeFixture(sim, { bankDeg, hold, iasKnots, throttle,
    alphaRefDeg: solution.alphaDeg, flightPathAngleDeg, sinkRateMs });
  const totalTicks = Math.round(seconds / DT);
  const settleTicks = Math.round(settleSeconds / DT);
  const samples = [];
  let previousHeading = state(sim).headingDeg, headingTravel = 0;
  for (let tick = 0; tick < totalTicks; tick++) {
    const sample = fixture.step();
    if (tick < settleTicks) { previousHeading = sample.headingDeg; continue; }
    headingTravel += Math.abs(((sample.headingDeg - previousHeading + 540) % 360) - 180);
    previousHeading = sample.headingDeg;
    samples.push(sample);
  }
  const windowSeconds = (totalTicks - settleTicks) * DT;
  const { mean, spread } = statistics(samples);
  const slope = key => {
    const meanX = (samples.length - 1) * DT / 2;
    const meanY = mean(key);
    let numerator = 0, denominator = 0;
    samples.forEach((sample, index) => {
      numerator += (index * DT - meanX) * (sample[key] - meanY);
      denominator += (index * DT - meanX) ** 2;
    });
    return numerator / denominator;
  };
  const turnRateDegS = headingTravel / windowSeconds;
  const tasMs = mean('tasMs');
  return {
    input: { altitudeMeters, iasKnots, bankDeg, hold, throttle, spoilers, flightPathAngleDeg, sinkRateMs },
    achieved: {
      iasKnots: mean('iasKnots'), iasSpreadKt: spread('iasKnots'),
      iasDriftKtPerS: slope('iasKnots'),
      bankDeg: mean('rollDeg'), bankSpreadDeg: spread('rollDeg'),
      altitudeDriftM: mean('altitudeM') - samples[0].altitudeM,
      altitudeSpreadM: spread('altitudeM'),
      climbRateMs: mean('vzMs'), climbRateSpreadMs: spread('vzMs'),
      flightPathAngleDeg: Math.atan2(mean('vzMs'), tasMs) * DEG,
      turnRateDegS,
      turnRadiusM: turnRateDegS > 0.05 ? tasMs / (turnRateDegS * RAD) : Infinity,
      alphaDeg: mean('alphaDeg'), separation: mean('separation'), gForce: mean('gForce'),
      throttleMean: mean('throttle'), elevatorMean: mean('elevator'), aileronMean: mean('aileron'),
      saturatedPct: Object.fromEntries(Object.entries(fixture.saturated)
        .map(([axis, ticks]) => [axis, 100 * ticks / fixture.ticks])),
      crashed: Boolean(sim.isCrashed),
    },
  };
}

/** Roll from wings level toward `bankDeg` with the production surface-rate
 * limits in the loop; the columns are the airframe's own roll response. */
export function probeRollResponse({ altitudeMeters = 2100, iasKnots = 240, bankDeg = 60,
  throttle = 0, seconds = 14 } = {}) {
  const sim = createProbeSimulation();
  const solution = spawnTrimmed(sim, { iasKnots, altitudeMeters, headingDeg: 180, spoilers: 0 });
  const fixture = new AttitudeFixture(sim, { bankDeg, hold: 'altitude', iasKnots, throttle,
    alphaRefDeg: solution.alphaDeg });
  const times = { to15Deg: null, to30Deg: null, to45Deg: null, to60Deg: null, settled: null };
  let peakRateDegS = 0;
  for (let tick = 0; tick < Math.round(seconds / DT); tick++) {
    const sample = fixture.step();
    const time = tick * DT;
    if (times.to15Deg === null && sample.rollDeg >= 15) times.to15Deg = time;
    if (times.to30Deg === null && sample.rollDeg >= 30) times.to30Deg = time;
    if (times.to45Deg === null && sample.rollDeg >= 45) times.to45Deg = time;
    if (times.to60Deg === null && sample.rollDeg >= 60) times.to60Deg = time;
    if (times.settled === null && time > 1 && Math.abs(sample.rollDeg - bankDeg) < 3) times.settled = time;
    peakRateDegS = Math.max(peakRateDegS, sample.rollRateDegS);
  }
  return { input: { iasKnots, bankDeg, throttle }, roll: { ...times, peakRateDegS } };
}
