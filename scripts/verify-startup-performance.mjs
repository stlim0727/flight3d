import assert from 'node:assert/strict';
import fs from 'node:fs';

// Run under chrome-session --project flight3d against a production preview.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const aircraft = process.env.AIRCRAFT || 'B738';
const airport = process.env.AIRPORT || 'coastal';
const checkScenery = Boolean(process.env.CHECK_SCENERY);
const delayDem = checkScenery && airport === 'lukla';
const scenario = process.env.SCENARIO || (delayDem ? 'demo' : 'runway');
const draco = process.env.INTERIOR_VARIANT === 'draco';
const url = process.env.APP_URL || 'http://127.0.0.1:5291/';
const artifacts = process.env.ARTIFACT_DIR || '.cache/startup-performance';
fs.mkdirSync(artifacts, { recursive: true });
const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let id = 0;
let heldDem;
const pending = new Map(), errors = [], warnings = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') heldDem = message.params.requestId;
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
  if (delayDem) await send('Fetch.enable', { patterns: [{ urlPattern: '*/terrain/lukla_dem.bin', requestStage: 'Request' }] });
  if (draco) await send('Network.setBlockedURLs', { urls: ['*b737-cockpit-medium.glb'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('flight3d.aircraft', ${JSON.stringify(aircraft)});
    localStorage.setItem('flight3d.airport', ${JSON.stringify(airport)});
    localStorage.setItem('flight3d.scenario', ${JSON.stringify(scenario)});
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
  if (delayDem) {
    assert.ok(heldDem, 'Lukla requests its DEM when initially selected');
    assert.deepEqual(await evaluate(`({ loaded: sim.luklaTerrain.isLoaded,
      waiting: sim.demoDirector.waitingForTerrain })`), { loaded: false, waiting: true });
    await send('Fetch.continueRequest', { requestId: heldDem });
    await send('Fetch.disable');
    const resumed = Date.now() + 30000;
    while (await evaluate('!sim.luklaTerrain.isLoaded || sim.demoDirector.waitingForTerrain')) {
      assert.ok(Date.now() < resumed, 'Lukla demo resumes after deferred DEM arrives');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (checkScenery && airport === 'coastal') await evaluate('sim.ships.ready.then(() => true)');
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
  if (checkScenery) {
    const scenery = await evaluate(`(async () => {
      const initial = { airport: sim.activeAirport, lukla: Boolean(sim.luklaTerrain),
        ships: [...sim.ships.vessels, ...sim.ships.speedboats].map(v => v.assetStatus) };
      // Hangang must remain usable without ever constructing Lukla.
      await sim.setAirport('hangang');
      sim.setPreset('hangang');
      const hangang = sim.hangang.active;
      await sim.setAirport('lukla');
      const terrain = sim.luklaTerrain, airport = sim.luklaAirport;
      const deadline = performance.now() + 30000;
      while (!terrain.isLoaded && !terrain.loadError && performance.now() < deadline) await new Promise(r => setTimeout(r, 100));
      const loaded = terrain.isLoaded;
      await sim.setAirport('coastal');
      const hidden = !terrain.mesh.visible && !airport.group.visible;
      await sim.setAirport('lukla');
      return { initial, hangang, loaded, hidden,
        reused: sim.luklaTerrain === terrain && sim.luklaAirport === airport,
        visible: terrain.mesh.visible && airport.group.visible,
        collision: sim.collisionDetector.terrain === terrain };
    })()`);
    fs.writeFileSync(`${artifacts}/scenery.json`, JSON.stringify(scenery, null, 2));
    assert.equal(scenery.initial.airport, airport);
    assert.equal(scenery.initial.lukla, airport === 'lukla');
    if (airport !== 'lukla') assert.ok(!report.resources.some(r => /lukla_(dem|satellite)/.test(r.name)));
    const shipResources = report.resources.filter(r => /ships\/.*\.glb/.test(r.name));
    if (airport === 'coastal') {
      assert.equal(shipResources.length, 4);
      assert.ok(shipResources.every(r => r.start >= report.ready), 'ship GLBs start after overlay removal');
    } else {
      assert.equal(shipResources.length, 0);
      assert.ok(scenery.initial.ships.every(status => status === 'deferred'));
    }
    for (const key of ['hangang', 'loaded', 'hidden', 'reused', 'visible', 'collision']) assert.equal(scenery[key], true, key);
    assert.equal(errors.length, 0, 'scenery transitions have no runtime exceptions');
  }
  console.log(JSON.stringify({ready: report.ready, longTaskMax: report.longTaskMax, longTaskTotal: report.longTaskTotal, aircraft: report.aircraft, renderer: report.renderer}));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${tab.id}`);
}
