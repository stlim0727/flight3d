import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { stepPhysics } from '../src/core/physicsTiming.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { solveTrim } from '../src/physics/TrimSolver.js';
import { PROFILES } from '../src/systems/FlightWarnings.js';

const iasKnots = sim => Atmosphere.msToKnots(Atmosphere.tasToIas(
  sim.linearVelocity.length(), Atmosphere.getConditions(sim.position.y).densityRatio));

// #599: a cruise preset declares a settled state, so the C172 spawn must sit
// inside its own envelope with a hands-off trim, not inherit the B738 speed.
for (const airportId of ['coastal', 'lukla']) {
  test(`${airportId} C172 cruise spawns below Vne in a hands-off trim`, () => {
    const sim = createHeadlessSimulation({ aircraftId: 'C172', airportId });
    sim.setPreset('cruise');
    const spawnIas = iasKnots(sim);
    assert.ok(spawnIas < PROFILES.C172.vne - 20, `${airportId}: spawn ${spawnIas.toFixed(1)} kt`);
    const trim = solveTrim(sim.aero, sim.engines, {
      iasKnots: spawnIas, altitudeMeters: sim.position.y,
      flightPathAngleDeg: THREE.MathUtils.radToDeg(Math.asin(sim.linearVelocity.y / sim.linearVelocity.length())),
      flapsIndex: sim.aero.flapsIndex, gearState: sim.gear.gearState, spoilers: sim.aero.spoilers,
    });
    assert.equal(trim.feasible, true, `${airportId}: ${trim.reason}`);
    assert.equal(trim.handsOffFeasible, true, `${airportId}: hands-off trim`);
    assert.ok(Math.abs(sim.controls.throttle - trim.throttle) < 1e-9, `${airportId}: computed trim installed`);

    let maxIas = spawnIas;
    for (let tick = 0; tick < 30 * 120; tick++) {
      stepPhysics(sim);
      maxIas = Math.max(maxIas, iasKnots(sim));
    }
    assert.ok(maxIas < PROFILES.C172.vne, `${airportId}: max ${maxIas.toFixed(1)} kt over 30 s`);
    assert.ok(Math.abs(iasKnots(sim) - spawnIas) < 10, `${airportId}: holds speed`);
  });
}
