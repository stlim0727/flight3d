import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateValley } from '../src/arena/generatedValley.js';
import { SlalomMissionAdapter } from '../src/arena/SlalomMissionAdapter.js';
import { GeneratedValleyTerrain } from '../src/environment/GeneratedValleyTerrain.js';
import { createMountedSlalomSimulation } from './helpers/slalomFlight.js';

/** A wall the pilot can fly through is a judged excursion nobody can see coming, and
 * a corridor that kills a wingtip before the edge is drawn is just as wrong. These
 * cover the mounted path - the coarse world grid plus its corridor ribbon - because
 * the headless slalom sim never installs a mesh, so nothing else proves collision and
 * rendering query one terrain. */

const MAX_SECONDS_TO_WALL = 6;

function flyIntoWall(seed) {
  const sim = createMountedSlalomSimulation(seed);
  const adapter = new SlalomMissionAdapter(sim);
  const { terrain } = generateValley({ seed });
  return adapter.prepare({ seed, environmentProfile: 'mild-disturbance-v1', noise: false })
    .then(({ manifest }) => {
      adapter.acquire();
      const throttle = manifest.configuration.trimThrottle;
      const limit = MAX_SECONDS_TO_WALL * 120;
      let maxCleanCross = 0, crossAtCrash = null, tick = 0;
      for (; tick < limit && !sim.isCrashed; tick++) {
        // Hold a hard bank toward one wall and let the turn carry the aircraft out
        // of the corridor: the way a pilot actually loses this line.
        const aileron = Math.max(-0.25, Math.min(0.25, (25 - (sim.telemetry.rollDeg ?? 0)) * 0.012));
        adapter.apply({ elevator: 0, aileron, rudder: 0, throttle, brakes: 0 });
        adapter.step();
        const cross = Math.abs(terrain.project(sim.position.x, sim.position.z).crossM);
        if (sim.isCrashed) crossAtCrash = cross;
        else maxCleanCross = Math.max(maxCleanCross, cross);
      }
      const outcome = { crash: sim.crashResult, crossAtCrash, maxCleanCross, tick,
        halfWidthM: terrain.project(sim.position.x, sim.position.z).halfWidthM,
        aglM: sim.position.y - terrain.getHeight(sim.position.x, sim.position.z) };
      adapter.release();
      return outcome;
    });
}

test('a mounted valley routes collision through the terrain that draws the corridor', async () => {
  for (const seed of [101, 202]) {
    const sim = createMountedSlalomSimulation(seed);
    const adapter = new SlalomMissionAdapter(sim);
    try {
      await adapter.prepare({ seed, environmentProfile: 'mild-disturbance-v1', noise: false });
      assert.ok(sim.currentTerrain instanceof GeneratedValleyTerrain,
        `seed ${seed}: valley was not mounted`);
      assert.ok(sim.currentTerrain.ribbonMesh, `seed ${seed}: corridor drawn without its ribbon`);
      assert.equal(sim.collisionDetector.terrain, sim.currentTerrain,
        `seed ${seed}: collision queries a different terrain than the one that is drawn`);
    } finally {
      adapter.release();
    }
    assert.ok(!(sim.currentTerrain instanceof GeneratedValleyTerrain),
      `seed ${seed}: valley still mounted after release`);
    assert.equal(sim.collisionDetector.terrain, sim.currentTerrain,
      `seed ${seed}: collision queries a stale terrain after release`);
  }
});

test('banking into a valley wall crashes on the drawn face, not past it', async () => {
  for (const seed of [101, 102, 103]) {
    const { crash, crossAtCrash, maxCleanCross, tick, halfWidthM, aglM } = await flyIntoWall(seed);
    assert.ok(crash, `seed ${seed}: flew into the plateau with ${MAX_SECONDS_TO_WALL}s of bank and never crashed`);
    assert.equal(crash.type, 'TERRAIN', `seed ${seed}: ${crash.type} instead of terrain`);
    assert.ok(crossAtCrash >= 68,
      `seed ${seed}: killed at cross ${crossAtCrash.toFixed(1)}m, inside the ${halfWidthM.toFixed(1)}m corridor the pilot sees`);
    assert.ok(crossAtCrash <= halfWidthM + 25,
      `seed ${seed}: passed ${crossAtCrash.toFixed(1)}m from the centreline with the corridor edge at ${halfWidthM.toFixed(1)}m`);
    assert.ok(maxCleanCross >= 60,
      `seed ${seed}: never reached the corridor edge (max clean cross ${maxCleanCross.toFixed(1)}m)`);
    assert.ok(aglM > 0 && aglM < 400,
      `seed ${seed}: hit at ${aglM.toFixed(0)}m above the floor after ${(tick / 120).toFixed(1)}s`);
  }
});
