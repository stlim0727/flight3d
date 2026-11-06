import test from 'node:test';
import assert from 'node:assert/strict';
import { installPhysicsIntegrator } from '../src/core/PhysicsIntegrator.js';

class Harness {}
installPhysicsIntegrator(Harness);

/**
 * A simulator that fails loudly the moment the physics loop reads any state, so a test can
 * tell "this frame belongs to somebody else" apart from "this frame is mine to integrate".
 */
function poisoned(poseDrivers) {
  return new Proxy(new Harness(), {
    get(target, key) {
      if (key === 'poseDrivers') return poseDrivers;
      if (key in target) return Reflect.get(target, key);
      throw new Error(`physics touched ${String(key)}`);
    },
  });
}

const idle = { active: false };
const claiming = { active: true };

test('an unclaimed frame belongs to physics, however many idle drivers are registered', () => {
  const withoutRegistry = poisoned(undefined);
  const withIdleDrivers = poisoned([idle, idle]);
  assert.equal(withoutRegistry.activePoseDriver(), null);
  assert.equal(withIdleDrivers.activePoseDriver(), null);
  for (const sim of [withoutRegistry, withIdleDrivers]) {
    assert.throws(() => sim.integratePhysics(1 / 120), /physics touched aircraft/,
      'a live sortie must still be integrated');
  }
});

test('the claimed frame stops physics at the gate instead of partway through a substep', () => {
  for (const drivers of [[claiming, idle], [claiming], [idle, claiming]]) {
    const sim = poisoned(drivers);
    assert.doesNotThrow(() => sim.integratePhysics(1 / 120));
    assert.equal(sim.integratePhysics(1 / 120), undefined, 'the owner wrote the pose, not physics');
  }
});

test('registry order decides priority, so the developer rig wins over a replay', () => {
  const shadow = { name: 'shadow', active: true };
  const replay = { name: 'replay', active: true };
  assert.equal(poisoned([shadow, replay]).activePoseDriver(), shadow);
  assert.equal(poisoned([replay, shadow]).activePoseDriver(), replay);
  assert.equal(poisoned([null, undefined, replay]).activePoseDriver(), replay, 'holes are tolerated');
});

test('a stepped sequence hands each frame to exactly one owner', () => {
  const shadow = { name: 'shadow', active: false };
  const replay = { name: 'replay', active: false };
  const sim = poisoned([shadow, replay]);
  const frames = [];
  for (let index = 0; index < 600; index++) {
    if (index === 120) shadow.active = true;
    if (index === 240) { shadow.active = false; replay.active = true; }
    if (index === 360) replay.active = false;
    const owner = sim.activePoseDriver();
    if (owner) {
      assert.doesNotThrow(() => sim.integratePhysics(1 / 120));
      frames.push(owner.name);
    } else {
      assert.throws(() => sim.integratePhysics(1 / 120), /physics touched aircraft/);
      frames.push('physics');
    }
  }
  assert.deepEqual(frames, [
    ...Array(120).fill('physics'), ...Array(120).fill('shadow'),
    ...Array(120).fill('replay'), ...Array(240).fill('physics'),
  ]);
});
