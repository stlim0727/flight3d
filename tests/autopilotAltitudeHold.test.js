import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import {
  createSimulatorAutopilot,
  elevatorFeedforwardRelativeToTrim,
} from '../src/physics/Autopilot.js';

const DT = 1 / 120;

function trimmedCruise(aircraftId) {
  const sim = createHeadlessSimulation({ aircraftId, airportId: 'coastal' });
  sim.setPreset('cruise');
  sim._apEuler = new THREE.Euler();
  sim._apForward = new THREE.Vector3();
  sim._apState = {};
  sim.autopilot = createSimulatorAutopilot(sim);
  for (let step = 0; step < 120; step++) sim.integratePhysics(DT);
  return sim;
}

const altitudeFt = sim => Atmosphere.metersToFeet(sim.position.y);

describe('production autopilot altitude hold', () => {
  it('subtracts installed pitch trim from the solved elevator feedforward', () => {
    const aero = { pitchTrim: 2, tuning: {} };
    const solution = { feasible: true, elevator: 0.25 };
    const relative = elevatorFeedforwardRelativeToTrim(aero, solution);
    // 2° of trim is 2/20 of full elevator travel; the AP must command the rest.
    assert.ok(Math.abs(relative.elevator - 0.15) < 1e-9, `feedforward ${relative.elevator}`);
    assert.strictEqual(solution.elevator, 0.25, 'must not mutate the solver result');
    assert.strictEqual(elevatorFeedforwardRelativeToTrim(aero, { feasible: false, elevator: 0.25 }).elevator, 0.25);
  });

  it('holds a trimmed cruise altitude without throttle hunting', () => {
    for (const aircraftId of ['B738', 'C172']) {
      const sim = trimmedCruise(aircraftId);
      const targetAlt = altitudeFt(sim);
      const targetIas = sim.telemetry.iasKnots;
      sim.autopilot.engage('ALT', sim.readAutopilotState());
      sim.autopilot.engage('SPD', sim.readAutopilotState());

      const altitudes = [];
      const throttles = [];
      for (let step = 0; step < 60 / DT; step++) {
        sim.integratePhysics(DT);
        if (step >= 20 / DT) {
          altitudes.push(altitudeFt(sim));
          throttles.push(sim.controls.throttle);
        }
      }
      const meanErr = altitudes.reduce((a, b) => a + b, 0) / altitudes.length - targetAlt;
      const p2p = Math.max(...altitudes) - Math.min(...altitudes);
      const throttleRange = Math.max(...throttles) - Math.min(...throttles);
      assert.ok(Math.abs(meanErr) < 10, `${aircraftId}: altitude bias ${meanErr.toFixed(1)} ft`);
      assert.ok(p2p < 10, `${aircraftId}: altitude p2p ${p2p.toFixed(1)} ft`);
      assert.ok(throttleRange < 0.2, `${aircraftId}: throttle range ${throttleRange.toFixed(3)}`);
      assert.ok(Math.abs(sim.telemetry.iasKnots - targetIas) < 3,
        `${aircraftId}: speed ${sim.telemetry.iasKnots.toFixed(1)} kt vs ${targetIas.toFixed(1)} kt`);
    }
  });

  it('clears altitude and speed integrators on disengage', () => {
    const sim = trimmedCruise('B738');
    const snapshot = sim.readAutopilotState();
    sim.autopilot.engage('ALT', snapshot);
    sim.autopilot.engage('SPD', snapshot);
    for (let step = 0; step < 5 / DT; step++) sim.integratePhysics(DT);
    sim.autopilot._altIntegral = 5000;
    sim.autopilot._speedIntegral = 12;
    sim.autopilot.disengage();
    assert.strictEqual(sim.autopilot._altIntegral, 0);
    assert.strictEqual(sim.autopilot._speedIntegral, 0);
    assert.strictEqual(sim.autopilot._altIntegralActive, false);
    assert.strictEqual(sim.autopilot._speedIntegralActive, false);
  });

  it('recovers from a speed target step without steady altitude error or windup', () => {
    const sim = trimmedCruise('B738');
    const targetAlt = altitudeFt(sim);
    const targetIas = sim.telemetry.iasKnots;
    sim.autopilot.engage('ALT', sim.readAutopilotState());
    sim.autopilot.engage('SPD', sim.readAutopilotState());
    for (let step = 0; step < 30 / DT; step++) sim.integratePhysics(DT);

    sim.autopilot.targets.iasKnots = targetIas + 20;
    for (let step = 0; step < 240 / DT; step++) sim.integratePhysics(DT);

    assert.ok(Math.abs(sim.telemetry.iasKnots - targetIas - 20) < 2,
      `speed ${sim.telemetry.iasKnots.toFixed(1)} kt after step`);
    assert.ok(Math.abs(altitudeFt(sim) - targetAlt) < 10,
      `altitude ${altitudeFt(sim).toFixed(1)} ft vs ${targetAlt.toFixed(1)} ft`);
    assert.ok(Math.abs(sim.autopilot._speedIntegral) < 10,
      `speed integral ${sim.autopilot._speedIntegral.toFixed(1)} kt·s`);
  });
});
