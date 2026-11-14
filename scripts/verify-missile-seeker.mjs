import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import config from '../vite.config.js';
import { detectGpuAngle, withBrowserSession } from './lib/browserHarness.mjs';

assert.notEqual(detectGpuAngle(), 'swiftshader', 'Hardware required; see browser-gpu.md');
const dir = path.resolve(process.env.ARTIFACT_DIR || '.cache/missile-seeker');
mkdirSync(dir, { recursive: true });
const server = await createServer({ ...config, configFile: false,
  server: { ...config.server, host: '127.0.0.1', port: 0, watch: null } });
await server.listen();
try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await withBrowserSession({ origin, startVite: false, width: 800, height: 600 }, async ({ cdpPort, send, evaluate, screenshot, delay, exceptions }) => {
    const gpuFile = path.join(dir, 'gpu.json');
    execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`],
      { env: { ...process.env, GPU_REPORT: gpuFile }, stdio: 'inherit' });
    const gpu = JSON.parse(readFileSync(gpuFile, 'utf8'));
    assert.equal(gpu.passed, true);
    await send('Page.navigate', { url: `${origin}/scripts/lib/missileSeekerScenario.mjs` });
    await send('Page.bringToFront'); await delay(200);
    const results = await evaluate(async () => {
      const scenario = await import('/scripts/lib/missileSeekerScenario.mjs');
      window.seekerScenario = scenario;
      return scenario.compareSeekerTerrainEngagements();
    });
    for (const r of results) {
      assert.equal(r.terminal, r.masking === 'permanent' ? 'miss-terrain' : 'hit');
      assert.deepEqual(r.phases, r.masking === 'open' ? ['track']
        : r.masking === 'brief' ? ['track', 'memory', 'track'] : ['track', 'memory', 'lost']);
    }
    const pose = results.find(r => r.type === 'AIM9X' && r.masking === 'brief').memoryPose;
    const drawing = await evaluate(async p => window.seekerScenario.renderSeekerPose(p), pose);
    assert.match(drawing.renderer, /Intel|NVIDIA|AMD|Radeon|GeForce/);
    assert.doesNotMatch(drawing.renderer, /swiftshader|llvmpipe|softpipe|lavapipe/i);
    assert.ok(drawing.drawnPixels > 1000); assert.equal(drawing.error, 0);
    assert.deepEqual(exceptions, []);
    await screenshot(path.join(dir, 'missile-memory-pose.png'));
    writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify({ gpu, results, drawing, exceptions }, null, 2)}\n`);
    console.log(JSON.stringify({ results, drawing }, null, 2));
  });
} finally { await server.close(); }
