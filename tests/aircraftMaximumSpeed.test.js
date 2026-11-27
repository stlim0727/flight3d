import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { stepPhysics } from '../src/core/physicsTiming.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { registerAddonAircraft } from '../src/config/aircraftConfigs.js';
import { aircraftPackFromProfile } from '../src/addons/aircraftPackBinding.js';

const CONCORDE_MANIFEST = new URL(
  './fixtures/concorde-addon.json',
  import.meta.url,
);

// A spec maximum-speed target must be measurably approached in headless
// physics, not only declared in configuration. The 80% floor leaves room for
// atmospheric and configuration differences while still catching aircraft
// whose thrust/drag model makes their published limit unreachable.
const MIN_SPEC_FRACTION = 0.8;
const CASES = [
  { id: 'B738', altitudeM: 11000, startKt: 260, metric: 'mach', spec: 0.82 },
  { id: 'C172', altitudeM: 3000, startKt: 120, metric: 'iasKnots', spec: 163 },
  { id: 'F16', altitudeM: 15000, startKt: 450, metric: 'mach', spec: 2.05 },
  { id: 'concorde', altitudeM: 18300, startKt: 520, metric: 'mach', spec: 2.0 },
];

function registerConcordeAddon() {
  const manifest = JSON.parse(readFileSync(CONCORDE_MANIFEST, 'utf8'));
  const sha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, sha256, manifest }],
  }, manifest.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);
}

function measuredValue(sim, metric) {
  if (metric === 'mach') return sim.aero.mach || 0;
  return sim.telemetry.iasKnots || Atmosphere.msToKnots(Atmosphere.tasToIas(
    sim.linearVelocity.length(), Atmosphere.getConditions(sim.position.y).densityRatio));
}

for (const entry of CASES) {
  test(`${entry.id} reaches at least ${MIN_SPEC_FRACTION * 100}% of its spec maximum speed`, t => {
    if (entry.id === 'concorde') registerConcordeAddon();
    const sim = createHeadlessSimulation({ aircraftId: entry.id, airportId: 'coastal' });
    sim.setPreset('cruise');
    sim.position.set(0, entry.altitudeM, 0);
    sim.quaternion.identity();
    sim.linearVelocity.set(0, 0, -Atmosphere.knotsToMs(entry.startKt));
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
    if (entry.id === 'concorde') sim.engines.setReheat(true);

    let peak = 0;
    for (let tick = 0; tick < 240 * 120; tick++) {
      stepPhysics(sim);
      peak = Math.max(peak, measuredValue(sim, entry.metric));
      sim.position.y = entry.altitudeM;
      sim.linearVelocity.y = 0;
      if (sim.isCrashed) break;
    }
    assert.equal(Boolean(sim.isCrashed), false, `${entry.id} crashed during acceleration`);
    assert.ok(peak >= entry.spec * MIN_SPEC_FRACTION,
      `${entry.id} peak ${peak.toFixed(2)} is only ${(peak / entry.spec * 100).toFixed(0)}% of spec ${entry.spec}`);
    assert.ok(Number.isFinite(peak) && peak < entry.spec * 1.25, `${entry.id} peak ${peak.toFixed(2)} inconsistent with spec ${entry.spec}`);
    t.diagnostic(`${entry.id}: spec ${entry.spec} ${entry.metric}, peak ${peak.toFixed(2)}, ${(peak / entry.spec * 100).toFixed(0)}% of spec`);
  });
}
