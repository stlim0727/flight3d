// Hardware-Chrome evidence for the Paris showcase (#1014).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const artifacts = path.resolve('.cache/paris-showcase');
await mkdir(artifacts, { recursive: true });
const waitFor = async (session, expression, tries = 300, delayMs = 200) => {
  for (let i = 0; i < tries; i++) {
    if (await session.evaluate(expression)) return true;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
};
const stateExpression = `({
  ready: sim.parisShowcase?.ready ?? null,
  visible: sim.parisShowcase?.tower.visible ?? null,
  towerY: sim.parisShowcase?.tower.position.y ?? null,
  sample: sim.currentTerrain?.openWorld?.sample?.(0, 0) ?? null,
  tiles: sim.currentTerrain?.openWorld?.tiles.size ?? 0,
  position: sim.position.toArray(),
  origin: sim.world?.customOrigin,
})`;

await withBrowserSession({ path: '/index.html', timeoutMs: 120000 }, async session => {
  const { evaluate, screenshot, cdpPort, exceptions } = session;
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: path.join(artifacts, 'gpu.json') },
    stdio: 'inherit',
    timeout: 180000,
  });
  assert.ok(await waitFor(session, 'Boolean(window.sim?.gameFlow?.state)'), 'simulator did not boot');
  await evaluate('(async () => { await sim.fly(); return true; })()');
  assert.ok(await waitFor(session, 'sim.gameFlow.state === "flight" && !sim.startingFlight'), 'flight did not start');

  await evaluate(`(() => {
    sim.setCustomWorldOrigin({ latitude: 48.858222, longitude: 2.2945 });
    sim.quaternion.identity();
    sim.position.set(0, 240, 1800);
    sim.linearVelocity.set(0, 0, -60);
    sim.cameraSystem.setMode(1, true);
    return true;
  })()`);
  assert.ok(await waitFor(session, 'Boolean(sim.parisShowcase)'), 'showcase object was not created');
  for (let i = 0; i < 10; i++) {
    const state = await evaluate(stateExpression);
    console.log('placement', i, JSON.stringify(state));
    if (state.ready && state.towerY > 20) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(await waitFor(session, 'sim.parisShowcase.ready === true'), 'Eiffel GLB was not placed');
  assert.ok(await waitFor(session, 'sim.parisShowcase.tower.position.y > 20'), 'tower was seated before DEM load');

  const samples = {};
  for (const [name, z, altitude] of [['far', 1800, 240], ['near', 320, 140]]) {
    await evaluate(`(() => { sim.position.set(0, ${altitude}, ${z}); return true; })()`);
    await new Promise(resolve => setTimeout(resolve, 1200));
    samples[name] = await evaluate(`({
      level: sim.parisShowcase.tower.levels[sim.parisShowcase.tower.getCurrentLevel()].object.name,
      towerY: sim.parisShowcase.tower.position.y,
      tiles: sim.currentTerrain.openWorld?.tiles.size ?? 0,
      insetLevels: [...(sim.currentTerrain.openWorld?.detailWanted?.values?.() ?? [])].slice(0, 5),
      quays: sim.parisShowcase.quays.filter(quay => quay.visible).length,
      bridge: sim.parisShowcase.bridge.visible,
    })`);
    await screenshot(path.join(artifacts, `paris-${name}.png`));
  }
  assert.ok(samples.far.bridge && samples.far.quays === 2, 'bridge and quays not placed');
  assert.notEqual(samples.far.level, samples.near.level, 'LOD did not switch along the route');
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ gpu: 'hardware Vulkan preflight passed', samples }, null, 2));
});
