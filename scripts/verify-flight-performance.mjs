import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

if (detectGpuAngle() === 'swiftshader') throw new Error('Hardware GPU required');
await mkdir('.cache/flight-performance', { recursive: true });
await withBrowserSession({ timeoutMs: 20000 }, async ({ origin, cdpPort, send, evaluate, delay, exceptions }) => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`],
    { stdio: 'inherit', timeout: 30000 });
  await send('Page.navigate', { url: `${origin}/?telemetry=0` });
  await send('Page.bringToFront');
  const waitFor = async expression => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await waitFor('window.sim?.startupReady');
  // Enable just the monitor after installing an in-memory sink; never send probe data to PostHog.
  await evaluate(`window.perfReports = []; sim.flightPerformance.emit = r => perfReports.push(r);
    sim.performanceTelemetryEnabled = true; sim.flightPerformance.intervalMs = 15000; sim.fly();`);
  await waitFor("sim.gameFlow.state === 'flight' && !sim.startingFlight && perfReports.length > 0");
  await evaluate(`sim.setBrowserActive(false); window.reportCount = perfReports.length;`);
  await delay(500);
  assert.equal(await evaluate('perfReports.length === reportCount'), true);
  await evaluate(`sim.setBrowserActive(true); sim.flightPerformance.flush('test-resume');`);
  await waitFor('perfReports.length > reportCount');
  const report = await evaluate(`({ reports: perfReports, fps: sim.lastFrameDelta > 0 ? 1 / sim.lastFrameDelta : null,
    gpuSupported: Boolean(sim.flightGpuTimer?.extension), glError: sim.renderer.getContext().getError() })`);
  await writeFile('.cache/flight-performance/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.ok(report.fps > 0);
  assert.ok(report.reports.some(r => r.frames > 1 && r.frameMs.p95 > 0 && r.renderSubmitMs.mean > 0));
  assert.ok(report.reports.some(r => r.drawCalls.mean > 0 && r.triangles.mean > 0));
  if (report.gpuSupported) assert.ok(report.reports.some(r => r.gpuMs.samples > 0), 'GPU timer available but no samples');
  assert.equal(report.glError, 0);
  assert.deepEqual(exceptions, []);
});
