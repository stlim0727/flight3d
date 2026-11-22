// Hardware-Chrome evidence for issue #944: distant base regions are unmounted
// visually while their altitude/collision surfaces and anchor switching remain.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const artifacts = path.resolve('.cache/region-lazy-mount');
await mkdir(artifacts, { recursive: true });

function checkGpu(cdpPort) {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: path.join(artifacts, 'gpu.json') },
    stdio: 'inherit',
    timeout: 180000,
  });
}

async function waitFor(session, expression, tries = 300, delayMs = 100) {
  for (let i = 0; i < tries; i++) {
    if (await session.evaluate(expression)) return true;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

const snapshot = `(() => {
  const world = sim.world;
  const ids = ['incheon', 'jeju', 'lukla', 'coastal', 'neon', 'valley'];
  const jeju = world.offsets.get('jeju');
  const probe = [jeju[0] + 10, jeju[1] + 10];
  return {
    anchor: world.anchor,
    active: sim.activeAirport,
    mounted: Object.fromEntries(ids.map(id => [id, {
      mounted: world.isMounted(id),
      registered: world.regions.has(id),
      inScene: world.regions.get(id)?.group?.parent === sim.scene,
    }])),
    jejuSurface: {
      height: world.getHeight(...probe),
      runway: world.isOnRunway(...probe),
      region: world.regionNameKey(...probe),
    },
    guidance: {
      synthetic: world.destinationInfo(0, 0, 'jeju')?.synthetic,
      bearing: world.destinationInfo(0, 0, 'jeju')?.bearingDeg,
    },
  };
})()`;

await withBrowserSession({ path: '/index.html?terrain=incheon&aircraft=C172&scenario=runway&fly=1&telemetry=0', timeoutMs: 120000 }, async session => {
  const { evaluate, screenshot, cdpPort, exceptions } = session;
  checkGpu(cdpPort);
  assert.ok(await waitFor(session, 'Boolean(window.sim?.startupReady)'), 'simulator did not boot');
  assert.ok(await waitFor(session, 'sim.activeAirport === "incheon"'), 'Incheon anchor not active');
  assert.ok(await waitFor(session, 'sim.world.regions.has("jeju")'), 'Jeju region did not preload');
  await new Promise(resolve => setTimeout(resolve, 1000));

  const initial = await evaluate(snapshot);
  assert.equal(initial.mounted.incheon.mounted, true);
  assert.equal(initial.mounted.incheon.inScene, true);
  for (const id of ['jeju', 'lukla', 'neon', 'valley']) {
    assert.equal(initial.mounted[id].mounted, false, `${id} should start unmounted`);
    assert.equal(initial.mounted[id].inScene, false, `${id} group should be out of the scene`);
  }

  // Freeze the flight loop so teleport probes are deterministic.
  await evaluate(`(() => {
    sim.gameFlow.pause?.();
    sim.linearVelocity.set(0, 0, 0);
  })()`);
  const approach = await evaluate(`(() => {
    const [x, z] = sim.world.offsets.get('jeju');
    sim.position.set(x + 10, 800, z + 10);
    sim.updateRegionMounting();
    return ${snapshot};
  })()`);
  assert.equal(approach.mounted.jeju.mounted, true, 'Jeju must mount on approach');
  assert.equal(approach.mounted.jeju.inScene, true);
  assert.deepEqual(approach.jejuSurface, initial.jejuSurface, 'surface queries changed while mounting');
  await screenshot(path.join(artifacts, 'jeju-mounted.png'));

  const retreat = await evaluate(`(() => {
    sim.position.set(0, 800, 0);
    sim.updateRegionMounting();
    return ${snapshot};
  })()`);
  assert.equal(retreat.mounted.jeju.mounted, false, 'Jeju must unmount after retreat');
  assert.equal(retreat.mounted.jeju.inScene, false);
  assert.deepEqual(retreat.jejuSurface, initial.jejuSurface, 'surface queries changed while unmounting');

  // Anchor switching must remount the selected region and keep real guidance.
  await evaluate(`sim.gameFlow.resume?.()`);
  await evaluate(`sim.setAirport('jeju')`);
  assert.ok(await waitFor(session, 'sim.activeAirport === "jeju" && !sim.airportLoading'), 'Jeju anchor switch failed');
  const switched = await evaluate(snapshot);
  assert.equal(switched.anchor, 'jeju');
  assert.equal(switched.mounted.jeju.mounted, true);
  assert.equal(switched.mounted.jeju.inScene, true);
  assert.equal(switched.guidance.synthetic, false, 'non-Incheon anchor must use real threshold guidance');
  await screenshot(path.join(artifacts, 'jeju-anchor.png'));

  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({
    gpu: 'hardware Vulkan preflight passed',
    initial, approach, retreat, switched,
  }, null, 2));
});
