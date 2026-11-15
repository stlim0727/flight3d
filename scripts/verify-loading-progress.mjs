import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

if (detectGpuAngle() === 'swiftshader') throw new Error('Hardware GPU access is required');
const artifacts = '.cache/loading-progress';
await mkdir(artifacts, { recursive: true });
await withBrowserSession({ preview: true, timeoutMs: 20000 }, async ({ origin, cdpPort, send, evaluate, delay, screenshot, exceptions }) => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`],
    { stdio: 'inherit', timeout: 30000 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('flight3d.language', 'ko');
    localStorage.setItem('flight3d.airport', 'incheon');
    window.bootShortcutLeaks = 0;
    addEventListener('keydown', event => { if (event.code === 'KeyC') bootShortcutLeaks++; });
    const nativeFrame = requestAnimationFrame.bind(window), waiting = [];
    let hold = true;
    // Hold an actual await boundary to inspect long-wait presentation without network flakiness.
    window.requestAnimationFrame = callback => nativeFrame(time => {
      if (hold && document.getElementById('startup-detail')?.dataset.task === 'startup.detail.selectedAirport') waiting.push(callback);
      else callback(time);
    });
    window.releaseLoadingProbe = () => { hold = false; waiting.splice(0).forEach(callback => nativeFrame(callback)); };
  ` });
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
  await waitFor("document.getElementById('startup-detail')?.dataset.task === 'startup.detail.selectedAirport'");
  await evaluate("document.querySelector('#startup-details summary').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor("document.getElementById('startup-details').open");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', text: 'c' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC' });
  assert.equal(await evaluate('bootShortcutLeaks'), 0, 'loading keys do not reach window flight shortcuts');

  await waitFor("!document.getElementById('startup-wait').hidden");
  await screenshot(`${artifacts}/desktop-wait.png`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(100);
  const layout = await evaluate(`(() => {
    const card = document.querySelector('.startup-card').getBoundingClientRect();
    const log = document.getElementById('startup-log');
    log.scrollTop = log.scrollHeight;
    return { card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
      scrollable: log.scrollHeight > log.clientHeight, scrolled: log.scrollTop > 0,
      elapsed: document.getElementById('startup-elapsed').textContent, rows: log.children.length };
  })()`);
  assert.ok(layout.card.left >= 0 && layout.card.right <= 390 && layout.card.top >= 0 && layout.card.bottom <= 844);
  assert.ok(layout.scrollable && layout.scrolled);
  await screenshot(`${artifacts}/mobile-wait.png`);
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await delay(100);
  assert.equal(await evaluate(`(() => {
    const rect = document.querySelector('.startup-card').getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= 390 && rect.left >= 0 && rect.right <= 844;
  })()`), true, 'short landscape card stays inside the viewport');

  await evaluate('releaseLoadingProbe()');
  await waitFor('window.sim?.startupReady');
  const completed = await evaluate(`({ timerStopped: sim.startupProgress.timer === null,
    rows: sim.startupProgress.rows.map(({ key, row }) => ({ key, state: row.dataset.state })),
    overlayHidden: document.getElementById('startup-overlay').hidden })`);
  console.log('completed', JSON.stringify(completed));
  await writeFile(`${artifacts}/completed.json`, JSON.stringify(completed, null, 2));
  assert.ok(completed.timerStopped && completed.overlayHidden);
  assert.ok(completed.rows.length > 10 && completed.rows.every(row => row.state === 'done'));
  // Exercise reset and finish through a real coordinated scene change.
  await evaluate("sim.lobby.airport = 'coastal'; sim.applyPendingScene()");
  await waitFor("sim.activeAirport === 'coastal' && !sim.startingFlight");
  const reset = await evaluate(`({ stopped: sim.startupProgress.timer === null,
    max: document.getElementById('startup-progress').max,
    count: sim.startupProgress.rows.length })`);
  assert.ok(reset.stopped && reset.max === 3 && reset.count < completed.rows.length);
  assert.deepEqual(exceptions, []);
  const report = { layout, completed, reset };
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
