import { createHeadlessSimulation } from '../core/HeadlessSimulation.js';
import { stepPhysics } from '../core/physicsTiming.js';
import { Atmosphere } from '../physics/Atmosphere.js';

export const DEFAULT_ENVELOPE_DURATION_SEC = 240;
export const DEFAULT_MIN_SPEC_FRACTION = 0.8;
export const DEFAULT_MAX_SPEC_FRACTION = 1.25;
const PHYSICS_HZ = 120;

function measuredSpeed(sim, metric) {
  if (metric === 'mach') return sim.aero.mach || 0;
  return sim.telemetry.iasKnots || Atmosphere.msToKnots(Atmosphere.tasToIas(
    sim.linearVelocity.length(),
    Atmosphere.getConditions(sim.position.y).densityRatio,
  ));
}

/**
 * Runs a headless level-acceleration flight at fixed altitude and verifies
 * that the aircraft approaches its declared maximum-speed spec without crashing.
 */
export function verifyAircraftPerformanceEnvelope(aircraftId, envelope, { airportId = 'coastal' } = {}) {
  const metric = Number.isFinite(envelope.maxMach) ? 'mach' : 'iasKnots';
  const spec = metric === 'mach' ? envelope.maxMach : envelope.vneKnots;
  const durationSec = envelope.durationSec ?? DEFAULT_ENVELOPE_DURATION_SEC;
  const minSpecFraction = envelope.minSpecFraction ?? DEFAULT_MIN_SPEC_FRACTION;
  const maxSpecFraction = envelope.maxSpecFraction ?? DEFAULT_MAX_SPEC_FRACTION;

  const sim = createHeadlessSimulation({ aircraftId, airportId });
  sim.setPreset('cruise');
  sim.position.set(0, envelope.cruiseAltitudeM, 0);
  sim.quaternion.identity();
  sim.linearVelocity.set(0, 0, -Atmosphere.knotsToMs(envelope.startTasKnots));
  sim.controls.throttle = 1;
  sim.engines.setThrottle(1);
  sim.gear.setGearTarget(false);
  sim.gear.gearState = 0;
  sim.aero.flapsIndex = 0;
  sim.aero.currentFlapAngle = 0;
  sim.aero.spoilers = 0;
  sim.aero.pitchTrim = 0;
  sim.controls.pitchTrim = 0;
  sim.angularVelocity.set(0, 0, 0);
  sim.lastOnGround = false;
  sim.airborneTime = 60;
  if (envelope.useReheat && typeof sim.engines.setReheat === 'function') {
    sim.engines.setReheat(true);
  }

  const totalTicks = Math.max(1, Math.round(durationSec * PHYSICS_HZ));
  let peak = 0;
  for (let tick = 0; tick < totalTicks; tick++) {
    stepPhysics(sim);
    peak = Math.max(peak, measuredSpeed(sim, metric));
    sim.position.y = envelope.cruiseAltitudeM;
    sim.linearVelocity.y = 0;
    if (sim.isCrashed) break;
  }

  const crashed = Boolean(sim.isCrashed);
  const ratio = spec > 0 ? peak / spec : 0;
  const errors = [];
  if (crashed) {
    errors.push(`${aircraftId} crashed during performanceEnvelope acceleration (${sim.crashResult?.type ?? 'unknown'})`);
  }
  if (!Number.isFinite(peak) || peak < spec * minSpecFraction) {
    errors.push(
      `${aircraftId} peak ${peak.toFixed(2)} ${metric} is only ${(ratio * 100).toFixed(0)}% of spec ${spec} `
      + `(minimum ${Math.round(minSpecFraction * 100)}%)`,
    );
  }
  if (!Number.isFinite(peak) || peak >= spec * maxSpecFraction) {
    errors.push(
      `${aircraftId} peak ${peak.toFixed(2)} ${metric} exceeds ${Math.round(maxSpecFraction * 100)}% of spec ${spec}`,
    );
  }

  return {
    ok: errors.length === 0,
    crashed,
    metric,
    spec,
    peak,
    ratio,
    durationSec,
    errors,
  };
}
