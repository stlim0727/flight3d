import assert from 'node:assert/strict';
import fs from 'node:fs';

// Run under chrome-session --project flight3d against a production preview.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const aircraft = process.env.AIRCRAFT || 'B738';
const draco = process.env.INTERIOR_VARIANT === 'draco';
const url = process.env.APP_URL || 'http://127.0.0.1:5291/';
const artifacts = process.env.ARTIFACT_DIR || '.cache/startup-performance';
fs.mkdirSync(artifacts, { recursive: true });
const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let id = 0;
const pending = new Map(), errors = [], warnings = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') warnings.push(message.params.args.map(arg => arg.description || arg.value));
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  message.error ? request.reject(message.error) : request.resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (draco) await send('Network.setBlockedURLs', { urls: ['*b737-cockpit-medium.glb'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('flight3d.aircraft', ${JSON.stringify(aircraft)});
    window.startupProbe = { tasks: [], ready: null };
    new PerformanceObserver(list => startupProbe.tasks.push(...list.getEntries().map(e => ({start: e.startTime, duration: e.duration}))))
      .observe({type: 'longtask', buffered: true});
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (!document.body.classList.contains('booting') && startupProbe.ready === null) {
          startupProbe.ready = performance.now();
          startupProbe.aircraft = [...sim.aircraftInstances.keys()];
        }
      }).observe(document.body, {attributes: true, attributeFilter: ['class']});
    });
  ` });
  await send('Page.navigate', { url });
  const deadline = Date.now() + 120000;
  let ready;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    ready = await evaluate('window.startupProbe?.ready');
    if (ready) break;
    assert.notEqual(await evaluate("document.getElementById('startup-retry')?.hidden"), false, 'startup failed');
  }
  assert.ok(ready, 'startup completes within 120 seconds');
  const report = await evaluate(`({ ...startupProbe,
    resources: performance.getEntriesByType('resource').map(e => ({name: e.name.split('/').slice(-2).join('/'), start: e.startTime, duration: e.duration})),
    bake: sim.aircraft.cockpit?.lightingBakeStatus, coverage: sim.aircraft.cockpit?.lightTransfer?.coverage,
    renderer: sim.renderer.getContext().getParameter(sim.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)
  })`);
  report.tasks = report.tasks.filter(task => task.start < report.ready);
  report.longTaskTotal = report.tasks.reduce((sum, task) => sum + task.duration, 0);
  report.longTaskMax = Math.max(0, ...report.tasks.map(task => task.duration));
  report.errors = errors;
  report.warnings = warnings;
  fs.writeFileSync(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${artifacts}/ready.png`, Buffer.from(screenshot.data, 'base64'));
  assert.equal(errors.length, 0);
  if (aircraft === 'B738') {
    assert.equal(report.bake, 'ready');
    assert.equal(report.coverage, 1);
  }
  if (process.env.EXPECT_SELECTED_ONLY) assert.deepEqual(report.aircraft, [aircraft]);
  console.log(JSON.stringify({ready: report.ready, longTaskMax: report.longTaskMax, longTaskTotal: report.longTaskTotal, aircraft: report.aircraft, renderer: report.renderer}));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${tab.id}`);
}
