import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const dir = path.resolve('review-artifacts/g-limiter');
await mkdir(dir, { recursive: true });
// The harness must be launched on the GPU-visible host with GPU_ANGLE=vulkan
// and CHROME_PATH=/home/stlim/.local/bin/chrome-headless (Linux).
assert.equal(process.env.GPU_ANGLE, 'vulkan', 'hardware Vulkan browser required');

await withBrowserSession({
  path: '/?terrain=coastal&aircraft=F16&scenario=cruise&fly=1',
}, async ({ cdpPort, evaluate, screenshot, delay, exceptions }) => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`],
    { env: { ...process.env, GPU_REPORT: path.join(dir, 'gpu.json') } });
  console.log(stdout.trim());
  for (let i = 0; i < 240; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(250);
  }
  assert.equal(await evaluate('Boolean(window.simulator?.startupReady)'), true);
  const results = await evaluate(`(async () => {
    const { Atmosphere } = await import('/src/physics/Atmosphere.js');
    const s = window.simulator;
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    // Freeze real-time integration while stepping the same production method.
    const integrate = s.integratePhysics.bind(s);
    s.integratePhysics = () => {};
    const results = [];
    for (const enabled of [false, true]) for (const sign of [1, -1]) {
      s.setPreset('cruise');
      const limits = s.aero.gLimiterLimits;
      s.aero.gLimiterLimits = enabled ? limits : null;
      s.position.set(0, 6000, 0);
      s.quaternion.identity();
      s.angularVelocity.set(0, 0, 0);
      s.linearVelocity.set(0, 0, -Atmosphere.knotsToMs(650)
        / Math.sqrt(Atmosphere.getConditions(6000).densityRatio));
      s.controls.pitchTrim = .6;
      s.controls.throttle = .85;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 720; i++) {
        s.controls.setVirtualInput('elevator', i < 360 ? sign : 0);
        s.controls.setVirtualInput('aileron', i < 240 ? .25 : 0);
        integrate(1 / 120);
        min = Math.min(min, s.telemetry.rawGForce);
        max = Math.max(max, s.telemetry.rawGForce);
      }
      results.push({ enabled, sign, min, max, crashed: s.isCrashed });
      s.aero.gLimiterLimits = limits;
    }
    s.aircraft.group.position.copy(s.position);
    s.aircraft.group.quaternion.copy(s.quaternion);
    s.renderPose.reset(s.position, s.quaternion);
    return results;
  })()`);
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  for (const result of results) {
    assert.equal(result.crashed, false);
    if (result.enabled) {
      assert.ok(result.min >= -3 && result.max <= 9, JSON.stringify(result));
    } else if (result.sign === 1) assert.ok(result.max > 20, JSON.stringify(result));
    else assert.ok(result.min < -15, JSON.stringify(result));
  }
  assert.deepEqual(exceptions, []);
  await delay(300);
  await screenshot(path.join(dir, 'protected-flight.png'));
});
