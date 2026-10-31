import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SIM_CONFIG } from '../src/config/simConfig.js';
import { RenderPose } from '../src/core/RenderPose.js';
import { advancePhysicsFrame, clampFrameDelta, stepPhysics } from '../src/core/physicsTiming.js';

function createSimulation() {
  const simulation = {
    physicsDt: SIM_CONFIG.physics.fixedDt,
    physicsAccumulator: 0,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: 0,
    ticks: 0,
    inputTicks: 0,
    integratePhysics(dt) {
      assert.equal(dt, 1 / 120);
      assert.equal(this.inputTicks, this.ticks + 1);
      this.velocity += (this.ticks < 60 ? 2 : -1) * dt;
      this.position.x += this.velocity * dt;
      this.ticks++;
    },
  };
  simulation.renderPose = new RenderPose(simulation.position, simulation.quaternion);
  simulation.demoDirector = { isActive: true, update() { simulation.inputTicks++; } };
  return simulation;
}

test('debrief transition discards queued physics and blocks later deterministic ticks', () => {
  const sim = createSimulation();
  sim.gameFlow = { state: 'flight' };
  sim.updateFlightRecording = () => { sim.gameFlow.state = 'debrief'; };
  advancePhysicsFrame(sim, 0.1);
  assert.equal(sim.ticks, 1);
  assert.equal(sim.physicsAccumulator, 0);
  stepPhysics(sim);
  assert.equal(sim.ticks, 1);
  assert.equal(sim.inputTicks, 1);
});

test('frame grouping preserves fixed-step inputs, state and interpolation isolation', () => {
  const reference = createSimulation();
  for (let tick = 0; tick < 240; tick++) stepPhysics(reference);
  for (const slices of [[2], [1], [0.5], [0.25, 3.75, 1, 5]]) {
    const simulation = createSimulation();
    const mesh = new THREE.Object3D();
    let elapsedTicks = 0;
    let frame = 0;
    while (elapsedTicks < 240) {
      const ticks = Math.min(slices[frame++ % slices.length], 240 - elapsedTicks);
      advancePhysicsFrame(simulation, ticks * simulation.physicsDt);
      elapsedTicks += ticks;
      simulation.renderPose.apply(mesh, simulation.position, simulation.quaternion,
        simulation.physicsAccumulator / simulation.physicsDt);
    }
    if (simulation.ticks === 239) advancePhysicsFrame(simulation, 1e-14);
    assert.equal(simulation.ticks, 240);
    assert.equal(simulation.position.x, reference.position.x);
    assert.equal(simulation.velocity, reference.velocity);
  }
});

test('frame clamp bounds catch-up and carries only fractional time', () => {
  const simulation = createSimulation();
  advancePhysicsFrame(simulation, simulation.physicsDt / 2);
  assert.equal(simulation.ticks, 0);
  advancePhysicsFrame(simulation, 5);
  assert.equal(simulation.ticks, 12);
  assert.ok(Math.abs(simulation.physicsAccumulator - simulation.physicsDt / 2) < 1e-14);
  for (const delta of [-1, NaN, Infinity]) {
    assert.equal(clampFrameDelta(delta), 0);
    advancePhysicsFrame(simulation, delta);
  }
  assert.equal(simulation.ticks, 12);
});

test('discarding accumulator and render history prevents stale reset motion', () => {
  const simulation = createSimulation();
  advancePhysicsFrame(simulation, simulation.physicsDt * 1.5);
  simulation.position.set(100, 200, 300);
  simulation.physicsAccumulator = 0;
  simulation.renderPose.reset(simulation.position, simulation.quaternion);
  advancePhysicsFrame(simulation, simulation.physicsDt / 4);
  const mesh = new THREE.Object3D();
  simulation.renderPose.apply(mesh, simulation.position, simulation.quaternion, 0.25);
  assert.equal(simulation.ticks, 1);
  assert.deepEqual(mesh.position.toArray(), [100, 200, 300]);
});

test('developer hooks share the fixed-step path and completion discards queued steps', () => {
  const simulation = createSimulation(), calls = [];
  simulation.devRunner = {
    blocksPhysics: false,
    beforePhysics() { calls.push(['before', simulation.ticks]); },
    afterPhysics(dt) {
      calls.push(['after', simulation.ticks, dt]);
      if (simulation.ticks === 2) this.blocksPhysics = true;
    },
  };
  advancePhysicsFrame(simulation, .1);
  assert.equal(simulation.ticks, 2);
  assert.equal(simulation.physicsAccumulator, 0);
  assert.deepEqual(calls, [['before', 0], ['after', 1, 1 / 120], ['before', 1], ['after', 2, 1 / 120]]);
  stepPhysics(simulation);
  assert.equal(simulation.ticks, 2);
});

test('debris shares fixed steps only after impact and receives the current ocean surface', () => {
  const simulation = createSimulation();
  const integrate = simulation.integratePhysics;
  const calls = [];
  simulation.integratePhysics = function(dt) {
    integrate.call(this, dt);
    if (this.ticks === 60) this.isCrashed = true;
  };
  simulation.currentTerrain = { getHeight: () => -50 };
  simulation.water = { mesh: { visible: true }, waterLevel: 0 };
  simulation.aircraftBreakup = { update: (...args) => calls.push(args) };
  for (let i = 0; i < 120; i++) stepPhysics(simulation);
  assert.equal(calls.length, 60, 'no debris time is applied before or on the impact tick');
  for (const args of calls) assert.deepEqual(args, [1 / 120, simulation.currentTerrain, 0]);
  simulation.water.mesh.visible = false;
  stepPhysics(simulation);
  assert.equal(calls.at(-1)[2], null);
  simulation.devRunner = { blocksPhysics: true };
  stepPhysics(simulation);
  assert.equal(calls.length, 61, 'blocked physics must also hold debris');
});
