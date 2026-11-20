// Start Vite on port 5186 and Chrome with CDP (CHROME_DEBUG_PORT, default 9225).
// Compares the post-south-district main revision with the north expansion.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve(process.env.ARTIFACT_DIR || '.tmp/city-district');
const baseline = process.env.BASELINE_REF || '258c55e5b8d196227255af0dfc719df8ded4bdf5';
await mkdir(output, { recursive: true });
await mkdir('.tmp/city-district', { recursive: true });
const beforeSource = execFileSync('git', ['show', `${baseline}:src/environment/FoliageAndCities.js`], { encoding: 'utf8' });
// Inject the same seeded placement source into the baseline. Three.js object
// creation also consumes Math.random, so global seeding would shift positions.
const deterministicBefore = beforeSource.replace('constructor(terrain) {',
  'constructor(terrain, random = Math.random) { this.random = random;').replaceAll('Math.random()', 'this.random()').replaceAll("from './", "from '/src/environment/");
await writeFile('.tmp/city-district/FoliageAndCities-before.js', deterministicBefore);
await writeFile('.tmp/city-district/review.html', '<!doctype html><html><body style="margin:0"></body></html>');

const port = Number(process.env.CHROME_DEBUG_PORT || 9225);
let targetId;
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket, sequence = 0;
const pending = new Map(), errors = [], transfers = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 60000);
  pending.set(id, message => {
    clearTimeout(timer);
    message.error ? reject(Error(`${method}: ${JSON.stringify(message.error)}`)) : resolve(message.result);
  });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, arg) => {
  const result = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(arg)})`, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

try {
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); targetId = target.id; }
    catch { /* Chrome is starting. */ }
    if (target) break;
    await delay(100);
  }
  assert.ok(target, 'Chrome CDP target required');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.responseReceived' && message.params.response.url.includes('district-kit.glb')) {
      const { requestId, response } = message.params;
      transfers.set(requestId, { url: response.url, status: response.status, diskCache: !!response.fromDiskCache });
    }
    if (message.method === 'Network.loadingFinished' && transfers.has(message.params.requestId)) {
      transfers.get(message.params.requestId).encodedDataLength = message.params.encodedDataLength;
    }
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const site = process.env.SIM_URL || 'http://127.0.0.1:5186';
  await send('Page.navigate', { url: `${site}/.tmp/city-district/review.html` });
  await delay(500);

  const setup = await evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { FoliageAndCities: Before } = await import('/.tmp/city-district/FoliageAndCities-before.js');
    const { FoliageAndCities: After } = await import('/src/environment/FoliageAndCities.js');
    const { Terrain } = await import('/src/environment/Terrain.js');
    const terrain = new Terrain(22000, 256);
    terrain.excludePavement(new T.Group());
    const create = Type => {
      let seed = 12345;
      const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
      return new Type(terrain, random);
    };
    const before = create(Before), after = create(After);
    if (!(await Promise.all([before.districtReady, after.districtReady])).every(Boolean)) throw Error('District GLB failed to load');
    const unchanged = city => ({
      buildings: city.buildingData.filter(b => b.z > 0).map(({ district, ...b }) => b),
      records: city.cityArchetypes.map(a => a.records.filter(r => r.z > 0).map(r => ({
        matrix: r.matrix.toArray(), farMatrix: r.farMatrix.toArray(),
        foundation: r.foundationMatrix?.toArray(), color: r.color.toArray()
      })))
    });
    if (JSON.stringify(unchanged(before)) !== JSON.stringify(unchanged(after))) throw Error('East/south placement regression');
    const scene = new T.Scene();
    scene.background = new T.Color(0xa8bfd1);
    scene.fog = new T.FogExp2(0xa8bfd1, 0.00005);
    scene.add(terrain.mesh);
    const ambient = new T.HemisphereLight(0xffffff, 0x53615a, 2); scene.add(ambient);
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(-800, 1200, -500); scene.add(sun);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(1440, 900);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(52, 1.6, 1, 16000);
    scene.add(before.group, after.group);
    window.review = { terrain, T, before, after, scene, renderer, camera, ambient, sun };
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    const originalCenters = new Set(before.buildingData.map(building => `${building.x},${building.y},${building.z}`));
    const sameCenters = after.buildingData.filter(building => originalCenters.has(`${building.x},${building.y},${building.z}`)).length;
    return { browser: navigator.userAgent,
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      districtLoaded: after.districtLoaded, beforeBuildings: before.buildingData.length, afterBuildings: after.buildingData.length, sameCenters };
  });
  assert.ok(setup.beforeBuildings > 200 && setup.afterBuildings > 200);
  assert.ok(setup.districtLoaded);
  const cases = [
    ['north-low-day', [-1000, 420, -2090], [-1370, 285, -2370], 12],
    ['north-high-day', [-650, 1150, -1500], [-1000, 180, -2800], 12],
    ['north-low-night', [-1000, 420, -2090], [-1370, 285, -2370], 23],
    ['north-high-night', [-650, 1150, -1500], [-1000, 180, -2800], 23],
    ['south-day', [1400, 180, 1500], [900, 70, 950], 12]
  ];
  const metrics = [];
  for (const [view, position, target, hour] of cases) {
    for (const version of ['before', 'after']) {
      const result = await evaluate(async ({ version, position, target, hour }) => {
        const { T, before, after, scene, renderer, camera, ambient, sun } = window.review;
        before.group.visible = version === 'before'; after.group.visible = version === 'after';
        const night = hour === 23;
        scene.background.set(night ? 0x111827 : 0xa8bfd1);
        scene.fog.color.copy(scene.background);
        ambient.intensity = night ? 0.25 : 2;
        sun.intensity = night ? 0.06 : 3;
        before.setTimeOfDay(hour);
        before.updateCityLod(new T.Vector3(...position));
        after.setTimeOfDay(hour);
        camera.position.set(...position); camera.lookAt(...target); camera.updateMatrixWorld();
        after.updateCityLod(camera.position);
        before.update(camera.position); after.update(camera.position);
        for (let i = 0; i < 10; i++) renderer.render(scene, camera);
        const gl = renderer.getContext(), samples = [];
        for (let i = 0; i < 100; i++) {
          const start = performance.now(); renderer.render(scene, camera); gl.finish(); samples.push(performance.now() - start);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        samples.sort((a, b) => a - b);
        const textures = new Set();
        (version === 'before' ? before : after).group.traverse(node => {
          if (!node.isMesh || !node.visible) return;
          for (const material of [node.material].flat()) {
            if (material.map) textures.add(material.map);
            if (material.emissiveMap) textures.add(material.emissiveMap);
          }
        });
        return {
          calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          frameMsMedian: samples[50], frameMsP95: samples[94],
          textureCount: textures.size,
          textureBytesRGBA8: [...textures].reduce((sum, texture) =>
            sum + texture.image.width * texture.image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1), 0),
          nearInstances: version === 'after' ? after.cityArchetypes.reduce((n, a) => n + a.near.count, 0) : null,
          farInstances: version === 'after' ? after.cityArchetypes.reduce((n, a) => n + a.far.count, 0) : null
        };
      }, { version, position, target, hour });
      metrics.push({ view, version, ...result });
      const screenshot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
      await writeFile(join(output, `${view}-${version}.jpg`), Buffer.from(screenshot.data, 'base64'));
      console.log(view, version, JSON.stringify(result));
    }
  }
  assert.equal(metrics.length, cases.length * 2);
  assert.equal(errors.length, 0, `Browser exceptions: ${errors.join('; ')}`);
  for (const result of metrics.filter(metric => metric.version === 'after')) {
    assert.equal(result.nearInstances + result.farInstances, setup.afterBuildings);
    assert.ok(result.calls <= 22, 'Terrain, two roads, foliage and city batches');
    assert.ok(result.textureBytesRGBA8 < 750000, 'Two 256px RGBA8 atlases with mipmaps');
  }
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*district-kit.glb*'] });
  const fallback = await evaluate(async () => {
    const { T } = window.review;
    const { FoliageAndCities } = await import('/src/environment/FoliageAndCities.js');
    const city = new FoliageAndCities(window.review.terrain, () => .5);
    const loaded = await city.districtReady;
    city.updateCityLod(new T.Vector3(-800, 100, -2800));
    const districts = city.cityArchetypes.slice(3);
    return { loaded, error: Boolean(city.districtError), districtLoaded: Boolean(city.districtLoaded),
      districtBuildings: city.buildingData.filter(b => b.archetype >= 3).length,
      northBuildings: city.buildingData.filter(b => b.district === 'north').length,
      near: districts.map(a => a.near.count),
      northRecords: districts.map(a => a.records.filter(r => r.district === 'north').length),
      southRecords: districts.map(a => a.records.filter(r => r.district === 'south').length),
      far: districts.map(a => a.far.count),
      totalRecords: districts.map(a => a.records.length) };
  });
  await send('Network.setBlockedURLs', { urls: [] });
  assert.equal(fallback.loaded, false);
  assert.equal(fallback.districtLoaded, false);
  assert.ok(fallback.error);
  assert.equal(fallback.districtBuildings, 110 + fallback.northBuildings);
  assert.ok(fallback.northBuildings > 0);
  assert.deepEqual(fallback.near, fallback.northRecords, 'south district near geometry absent');
  assert.deepEqual(fallback.far, fallback.southRecords, 'far boxes and collision metadata retained');
  const sequences = await evaluate(async () => {
    const { T, after: city, terrain, renderer, scene, camera } = window.review;
    const { CollisionDetector } = await import('/src/physics/CollisionDetector.js');
    const b = city.buildingData.find(b => b.district === 'north');
    const metadata = JSON.stringify(city.buildingData);
    const detector = new CollisionDetector(terrain, null, city, null, null);
    const pos = new T.Vector3(b.x, b.visualY - .02, b.z);
    const probes = [{ pos, radius: 0, desc: 'north-plinth' }];
    for (const at of [pos, new T.Vector3(0, 10000, 0), pos]) {
      city.updateCityLod(at); city.update(at);
      if (JSON.stringify(city.buildingData) !== metadata) throw Error('LOD mutated collision metadata');
      if (!detector.checkCityBuildings(pos, probes)) throw Error('Plinth collision missing');
      if (city.cityArchetypes.reduce((n, a) => n + a.near.count + a.far.count, 0) !== city.buildingData.length) throw Error('LOD count mismatch');
    }
    city.setTimeOfDay(12); city.setTimeOfDay(23); city.setTimeOfDay(12);
    if (city.cityArchetypes.slice(3).some(a => a.near.material.emissiveIntensity !== 0)) throw Error('Daylight windows remain lit');
    const plan = city.northDistrict;
    const boxes = plan.lots.map(l => [l.x, l.visualY, l.z]);
    camera.position.set(b.x + 75, b.visualY + 40, b.z + 85);
    camera.lookAt(b.x, b.visualY + 4, b.z); camera.updateMatrixWorld();
    city.group.visible = true; window.review.before.group.visible = false;
    renderer.render(scene, camera);
    return { northBuildings: boxes.length, northLots: boxes, streets: plan.streets.length,
      junctions: plan.nodes.filter(n => n.degree >= 3).length, deadEnds: plan.nodes.filter(n => n.degree === 1).length,
      maxFoundation: Math.max(...plan.lots.map(l => l.visualY - l.groundY)),
      maxGrade: Math.max(...plan.streets.map(e => e.site.grade)), lodRoundTrip: true,
      daylightRoundTrip: true, plinthCollision: true, eastSouthIdentical: true };
  });
  const detail = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  await writeFile(join(output, 'north-plinth-and-junction.jpg'), Buffer.from(detail.data, 'base64'));
  for (const [name, degree] of [['dead-end', 1], ['junction', 4]]) {
    await evaluate(degree => {
      const { after, terrain, renderer, scene, camera } = window.review;
      const n = after.northDistrict.nodes.find(n => n.degree === degree);
      if (!n) throw Error(`Missing degree ${degree} road node`);
      const y = terrain.getHeight(n.x, n.z);
      camera.position.set(n.x + 70, y + 70, n.z + 80); camera.lookAt(n.x, y, n.z);
      camera.updateMatrixWorld(); renderer.render(scene, camera);
    }, degree);
    const capture = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    await writeFile(join(output, `north-${name}.jpg`), Buffer.from(capture.data, 'base64'));
  }
  const budgets = metrics.filter(m => m.version === 'after').map(m => {
    const before = metrics.find(b => b.view === m.view && b.version === 'before');
    const limit = { calls: before.calls + 4, triangles: before.triangles + 15000,
      medianMs: Math.max(before.frameMsMedian * 1.5, before.frameMsMedian + 2),
      p95Ms: Math.max(before.frameMsP95 * 2, before.frameMsP95 + 4) };
    return { view: m.view, limit, passed: m.calls <= limit.calls && m.triangles <= limit.triangles &&
      m.frameMsMedian <= limit.medianMs && m.frameMsP95 <= limit.p95Ms };
  });
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ baseline, host: { platform: platform(), cpu: cpus()[0].model }, ...setup,
    resolution: [1440, 900], seed: 12345, fallback, sequences, assetFileBytes: (await readFile('public/models/city/district-kit.glb')).length,
    network: { cacheDisabled: true, requests: [...transfers.values()] }, metrics, budgets, errors,
    note: 'Isolated city and foliage on actual 22000m/256 terrain. Frame wall time uses gl.finish after 10 warmups, 100 samples; not full-flight FPS. Texture memory estimates RGBA8 plus mipmaps. Roads are visual overlays; analytical terrain and aircraft contact are unchanged.' }, null, 2));
  assert.ok(budgets.every(b => b.passed), 'City performance budget exceeded; inspect browser-results.json');

  // Exercise the actual simulator as well as the isolated rendering harness.
  // No full-flight FPS claim is inferred from the city-only measurements above.
  errors.length = 0;
  // The normal animation loop would move the camera between an explicit render
  // and CDP capture, and add wall-clock physics between deterministic steps.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0;' });
  await send('Page.navigate', { url: `${site}/` });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await delay(250);
    try { ready = await evaluate(() => Boolean(window.simulator?.collisionDetector)); } catch { /* navigation */ }
    if (ready) break;
  }
  assert.ok(ready, 'Full simulator must initialize');
  const flight = await evaluate(async () => {
    const sim = window.simulator, T = window.THREE;
    sim.demoDirector.stop(); sim.gameFlow.enterFlight(); sim.setAirport('coastal');
    if (!await sim.foliage.districtReady) throw Error('Full scene district did not load');
    const north = sim.foliage.buildingData.filter(b => b.district === 'north');
    if (!north.length) throw Error('Full scene has no north buildings');
    sim.setPreset('cruise');
    sim.position.set(-1700, 500, -2400); sim.linearVelocity.set(100, 0, 0);
    sim.angularVelocity.set(0, 0, 0);
    sim.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI / 2);
    sim.controls.clearVirtualInputs(); sim.controls.setVirtualInput('throttle', .55);
    sim.gear.setGearTarget(false); sim.gear.gearState = 0;
    const path = [];
    for (let i = 0; i < 24; i++) {
      sim.stepSimulation(.25);
      const clearance = sim.position.y - sim.terrain.getHeight(sim.position.x, sim.position.z);
      if (sim.isCrashed || clearance < 60 || !sim.position.toArray().every(Number.isFinite)) throw Error('Unsafe north flyover');
      path.push({ position: sim.position.toArray(), clearance });
    }
    const b = north[0], p = new T.Vector3(b.x, b.visualY - .02, b.z);
    const probes = [{ pos: p, radius: 0, desc: 'foundation' }];
    if (!sim.collisionDetector.checkCityBuildings(p, probes)) throw Error('North foundation collision missing in full scene');
    sim.setAirport('lukla');
    if (sim.foliage.group.visible || sim.collisionDetector.checkCityBuildings(p, probes)) throw Error('Coastal collision leaked into Lukla');
    sim.setAirport('coastal'); sim.gameFlow.enterFlight();
    if (!sim.foliage.group.visible || !sim.collisionDetector.checkCityBuildings(p, probes)) throw Error('Coastal grid did not restore');
    sim.resetCrash();
    if (sim.isCrashed) throw Error('Restart failed');
    sim.controls.setVirtualInput('brakes', 1);
    sim.stepSimulation(2);
    if (sim.isCrashed || sim.gear.contacts.some(leg => leg.damageState !== 'normal')) throw Error('Runway parking regression');
    const snapshot = JSON.stringify(sim.foliage.buildingData);
    sim.setPreset('approach'); sim.setPreset('runway');
    if (JSON.stringify(sim.foliage.buildingData) !== snapshot) throw Error('Preset rebuild changed city');
    sim.camera.position.set(-1000, 420, -2090); sim.camera.lookAt(-1370, 285, -2370);
    sim.camera.updateMatrixWorld(); sim.foliage.updateCityLod(sim.camera.position);
    sim.foliage.update(sim.camera.position); sim.renderer.render(sim.scene, sim.camera);
    return { simulatedFlyoverSeconds: 6, path, foundationCollision: true, airportRoundTrip: true,
      restartAndParking: true, presetRoundTrip: true, northBuildings: north.length,
      renderCalls: sim.renderer.info.render.calls, triangles: sim.renderer.info.render.triangles };
  });
  const fullScene = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  await writeFile(join(output, 'north-full-scene.jpg'), Buffer.from(fullScene.data, 'base64'));
  await writeFile(join(output, 'flight-results.json'), JSON.stringify({ flight, errors,
    note: 'Full simulator flyover, collision query, airport/preset/restart sequences. No complete takeoff/landing circuit or full-flight FPS measurement.' }, null, 2));
  assert.equal(errors.length, 0, `Full simulator exceptions: ${errors.join('; ')}`);
} finally {
  socket?.close();
  if (targetId) await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}
