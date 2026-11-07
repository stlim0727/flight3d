import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorClass } from './helpers/simulatorClass.js';

test('frame preparation waits for assets, warms once per prepared model, and leaves active wreckage alone', async () => {
  const aircraft = { loadingGltf: true };
  const root = {};
  let prepared, builds = 0, compiles = 0;
  const sim = Object.assign(Object.create(SimulatorClass.prototype), {
    aircraft, camera: {}, scene: {},
    aircraftBreakup: {
      preparedRoot: root,
      prepare(model) {
        builds++;
        if (prepared === model) return false;
        prepared = model;
        return true;
      },
    },
    renderer: {
      compileAsync(object, camera, scene) {
        assert.equal(object, root);
        assert.equal(camera, sim.camera);
        assert.equal(scene, sim.scene);
        compiles++;
        return Promise.resolve();
      },
    },
  });
  sim.prepareCrashVisuals();
  assert.equal(builds, 0, 'incomplete aircraft must not be cached');
  aircraft.loadingGltf = false;
  sim.prepareCrashVisuals();
  await sim.crashShaderWarmup;
  sim.prepareCrashVisuals();
  assert.equal(compiles, 1, 'ordinary frames must not repeat shader warmup');
  sim.isCrashed = true;
  sim.aircraft = {};
  sim.prepareCrashVisuals();
  assert.equal(builds, 2, 'an active crash must keep ownership of its debris');
  sim.isCrashed = false;
  sim.prepareCrashVisuals();
  await sim.crashShaderWarmup;
  assert.equal(compiles, 2, 'a changed aircraft needs its own prepared programs');
});
