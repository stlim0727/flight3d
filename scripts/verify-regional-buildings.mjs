import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

assert.ok(['d3d11', 'vulkan', 'metal'].includes(process.env.GPU_ANGLE), 'Set GPU_ANGLE to a hardware backend');
const dir = resolve('.cache/regional-buildings');
await mkdir(dir, { recursive: true });
const routes = [['songdo', 37.390, 126.642], ['seongsan', 33.461, 126.932]];

async function sampleRoute(session, route) {
  const [name, lat, lon] = route;
  await session.evaluate(({ lat, lon }) => {
    sim.applyFixedPose({ lat, lon, alt: 220, heading: 0, camera: 'chase', freeze: true });
    sim.setTimeOfDay(12, { persist: false });
  }, { lat, lon });
  const state = () => session.evaluate(() => {
    const b = sim.geographicBuildingLayer;
    const t = sim.currentTerrain.openWorld;
    return { tiles: b?.tiles.size, meshes: b && [...b.tiles.values()].filter(v => v.mesh).length,
      terrain: t?.tiles.size, loading: Boolean(b?.pending || b?.pendingOverview || t?.pending.size ||
        t?.pendingDetail || t?.pendingImagery || t?.pendingWater), time: sim.totalSimTime,
      quality: sim.renderQuality, background: sim.browserBackgrounded, focus: document.hasFocus(), hidden: document.hidden };
  });
  const started = Date.now();
  let status;
  let stable = 0;
  while (Date.now() - started < 180000 && stable < 3) {
    await session.delay(1000);
    status = await state();
    stable = status.meshes > 0 && !status.loading ? stable + 1 : 0;
    if (Math.floor((Date.now() - started) / 1000) % 10 === 0) console.log(name, status);
  }
  assert.equal(stable, 3, JSON.stringify(status));
  const warmupMs = Date.now() - started;
  const samples = await session.evaluate(async () => {
    const info = sim.renderer.info;
    const original = info.autoReset;
    const frames = [];
    try {
      info.autoReset = false;
      let previous;
      for (let i = 0; i <= 120; i++) {
        const now = await new Promise(requestAnimationFrame);
        const b = sim.geographicBuildingLayer;
        const t = sim.currentTerrain.openWorld;
        if (i) frames.push({ ms: now - previous, calls: info.render.calls, triangles: info.render.triangles,
          loading: Boolean(b.pending || b.pendingOverview || t.pending.size || t.pendingDetail || t.pendingImagery || t.pendingWater) });
        info.reset();
        previous = now;
        sim.position.z = -2 * i;
        sim.renderPose.reset(sim.position, sim.quaternion);
      }
    } finally { info.autoReset = original; }
    return frames;
  });
  const end = await state();
  assert.ok(end.time > status.time);
  await session.screenshot(resolve(dir, name + '.png'));
  await writeFile(resolve(dir, name + '.json'), JSON.stringify({ route, warmupMs, status, end, samples }));
  const settled = samples.filter(frame => !frame.loading);
  assert.ok(settled.length >= 60, 'Insufficient settled frames for comparison');
  const quantile = (key, q) => settled.map(frame => frame[key]).sort((a, b) => a - b)[Math.ceil(q * settled.length) - 1];
  console.log(name, { warmupMs, loadingFrames: samples.length - settled.length, settled: settled.length,
    medianMs: quantile('ms', 0.5), p95Ms: quantile('ms', 0.95),
    medianDrawCalls: quantile('calls', 0.5), medianTriangles: quantile('triangles', 0.5), quality: status.quality });
}

await withBrowserSession({ path: '/?aircraft=C172&lat=37.390&lon=126.642&alt=220&heading=0&camera=chase&freeze=1',
  width: 1280, height: 720, timeoutMs: 90000 }, async session => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', 'http://127.0.0.1:' + session.cdpPort],
    { stdio: 'inherit', timeout: 30000, env: { ...process.env, GPU_REPORT: resolve(dir, 'gpu.json') } });
  for (let i = 0; i < 120 && !await session.evaluate('Boolean(window.sim?.startupReady)'); i++) await session.delay(500);
  assert.ok(await session.evaluate('Boolean(window.sim?.startupReady)'), JSON.stringify(session.exceptions));
  for (const route of routes) await sampleRoute(session, route);
});
