import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

if (detectGpuAngle() === 'swiftshader') throw new Error('Hardware GPU access is required');
const artifacts = '.cache/frame-transitions';
await mkdir(artifacts, { recursive: true });
await withBrowserSession({ preview: true, timeoutMs: 20000 }, async session => {
  const { origin, cdpPort, send, evaluate, delay, screenshot, exceptions } = session;
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`],
    { stdio: 'inherit', timeout: 30000 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('flight3d.airport', 'incheon');
    localStorage.setItem('flight3d.aircraft', 'B738');
  ` });
  await send('Page.navigate', { url: `${origin}/?telemetry=0` });
  await send('Page.bringToFront');
  const waitFor = async (expression, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await waitFor('window.sim?.startupReady');
  await evaluate(`window.transitionReports = [];
    sim.frameTransitions.emit = report => transitionReports.push(report);
    sim.fly()`);
  await waitFor("sim.gameFlow.state === 'flight' && !sim.startingFlight");
  // Exercise the actual pause-menu and lobby Resume controls repeatedly.
  for (let repeat = 0; repeat < 2; repeat++) {
    await evaluate("sim.gameFlow.pause(); document.getElementById('btn-pause-resume').click()");
    await waitFor(`transitionReports.filter(r => r.kind === 'resume').length === ${repeat * 2 + 1}`);
    await evaluate('sim.toggleMainMenu(); sim.resumeFlight()');
    await waitFor(`transitionReports.filter(r => r.kind === 'resume').length === ${repeat * 2 + 2}`);
  }
  await evaluate(`const select = document.getElementById('render-quality');
    select.value = 'performance'; select.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("transitionReports.some(r => r.kind === 'quality-change')");
  // An interrupted return must not report time spent outside the app as rendering latency.
  const before = await evaluate('transitionReports.length');
  await evaluate('sim.gameFlow.pause(); sim.gameFlow.resume(); sim.setBrowserActive(false)');
  await delay(100);
  assert.equal(await evaluate('transitionReports.length'), before);
  await evaluate('sim.setBrowserActive(true)');
  await delay(100);
  assert.equal(await evaluate('transitionReports.length'), before);
  const report = await evaluate(`({ reports: transitionReports, marks: sim.inputLatency.state.marks,
    state: sim.gameFlow.state, quality: sim.renderQuality })`);
  assert.equal(report.reports.length, 5);
  assert.deepEqual(report.reports.filter(r => r.kind === 'resume').map(r => r.from),
    ['paused', 'lobby', 'paused', 'lobby']);
  for (const item of report.reports) {
    assert.ok(item.firstFrameMs >= 0 && item.renderMs >= 0);
    assert.ok(item.paintOpportunityMs >= item.firstFrameMs);
    assert.ok(item.longTasks && Number.isFinite(item.longTasks.maxMs));
  }
  assert.equal(report.state, 'flight');
  assert.equal(report.quality, 'performance');
  assert.deepEqual(exceptions, []);
  await screenshot(`${artifacts}/flight.png`);
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
