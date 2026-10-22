// Controlled production-airport comparison; see docs/development/pavement.md.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const dir = process.env.ARTIFACT_DIR || '.cache/pavement-review';
fs.mkdirSync(dir, { recursive: true });
const sources = JSON.parse(fs.readFileSync('public/textures/pavement/sources.json'));
for (const source of sources) {
  const data = fs.readFileSync(`public/textures/pavement/${source.file}`);
  assert.equal(data.length, source.bytes);
  assert.equal(createHash('sha256').update(data).digest('hex'), source.sha256);
}
const pages = await (await fetch(`${process.env.CDP_URL || 'http://127.0.0.1:9488'}/json`)).json();
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 60000);
    pending.set(id, m => {
      clearTimeout(timeout);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const results = [];
try {
  await call('Runtime.enable');
  await call('Page.enable');
  // Empty same-origin page avoids booting the flight simulation during timing.
  await call('Page.navigate', { url: `${process.env.SIM_URL || 'http://127.0.0.1:5188'}/.cache/pavement-review.html` });
  await new Promise(resolve => setTimeout(resolve, 1500));
  await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const version of process.env.BASELINE_PREFIX ? ['before', 'after'] : ['after']) {
    const prefix = version === 'before' ? process.env.BASELINE_PREFIX : '/src/environment';
    for (const airportName of ['Airport', 'LuklaAirport']) {
      await evaluate(`(async () => {
        const THREE = await import('/node_modules/three/build/three.module.js');
        const { ${airportName}: AirportClass } = await import(${JSON.stringify(`${prefix}/${airportName}.js`)});
        // Building-kit replacement is unrelated and would change timing asynchronously.
        class ControlledAirport extends AirportClass { async loadBuildings() { return false; } }
        const airport = new ControlledAirport();
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(1200, 800); renderer.setPixelRatio(1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        document.body.replaceChildren(renderer.domElement); document.body.style = 'margin:0';
        const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb5ccdc);
        const hemi = new THREE.HemisphereLight(0xd6e8ff, 0x62654a, 2); scene.add(hemi);
        const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(-0.4, 0.7, -0.3); scene.add(sun);
        scene.add(airport.group);
        if ('${airportName}' === 'Airport') {
          const { Terrain } = await import('/src/environment/Terrain.js');
          scene.add(new Terrain(20000, 128).mesh);
        }
        await new Promise((resolve, reject) => {
          const start = performance.now();
          const poll = () => {
            const materials = new Set(); airport.group.traverse(o => { if (o.material?.name.startsWith('pavement-')) materials.add(o.material); });
            if (materials.size && [...materials].every(m => m.map && m.normalMap && m.roughnessMap)) resolve();
            else if (performance.now() - start > 20000) reject(new Error('Pavement texture loading failed'));
            else setTimeout(poll, 50);
          }; poll();
        });
        const camera = new THREE.PerspectiveCamera(55, 1.5, 0.1, 30000);
        if (airport.papiLights) {
          for (const [angle, white] of [[2, 0], [3, 2], [4, 4], [2, 0]]) {
            airport.update(0, new THREE.Vector3(-2250, airport.elevation + Math.tan(angle * Math.PI / 180) * 1000, 0));
            if (airport.papiLights.filter(p => p.lensMat.color.getHex() === 0xffffff).length !== white) throw new Error('PAPI transition failed');
          }
          if (!airport.approachLight || airport.approachLight.intensity !== 8) throw new Error('Approach strobes inactive');
          const strobeClock = performance.now.bind(performance);
          performance.now = () => 1000;
          airport.update(0);
          const strobeA = airport.approachLight.position.clone();
          performance.now = () => 1100;
          airport.update(0);
          const strobeB = airport.approachLight.position.clone();
          performance.now = strobeClock;
          if (!airport.approachStrobes.some(p => strobeA.equals(p)) || strobeA.equals(strobeB)) throw new Error('Approach strobes not sequenced');
        }
        window.review = { THREE, renderer, scene, camera, airport, hemi, sun };
      })()`);
      for (const view of ['approach', 'close', 'apron', 'night']) {
        const result = await evaluate(`(async () => {
          const { THREE, renderer, scene, camera, airport, hemi, sun } = window.review;
          const runway = airport.group.getObjectByName('runway-pavement');
          airport.group.updateMatrixWorld(true);
          let position, target;
          if ('${airportName}' === 'Airport') {
            [position, target] = '${view}' === 'close' ? [[-982, 15, 17], [-955, 12.06, 17]] :
              '${view}' === 'apron' ? [[-650, 35, 320], [-520, 12, 265]] : [[-1900, 28, 0], [-850, 12, 0]];
            camera.position.fromArray(position); camera.lookAt(...target);
          } else {
            [position, target] = '${view}' === 'close' ? [[8.4, 3, 180], [8.4, 0, 153]] :
              '${view}' === 'apron' ? [[45, 20, 30], [45, 0, -70]] : [[0, 10, 410], [0, 0, -70]];
            camera.position.copy(runway.localToWorld(new THREE.Vector3(...position)));
            camera.lookAt(runway.localToWorld(new THREE.Vector3(...target)));
          }
          const night = '${view}' === 'night'; hemi.intensity = night ? 0.12 : 2; sun.intensity = night ? 0 : 3;
          scene.background.set(night ? 0x121c30 : 0xb5ccdc);
          // Freeze airport strobes/beacons, retaining the real benchmark clock.
          const clock = performance.now.bind(performance);
          performance.now = () => 12500;
          airport.update?.(0, camera.position, 12.5);
          performance.now = clock;
          renderer.compile(scene, camera);
          for (let i = 0; i < 20; i++) renderer.render(scene, camera);
          const gl = renderer.getContext(); gl.finish();
          const samples = [];
          for (let i = 0; i < 45; i++) {
            const start = performance.now(); renderer.render(scene, camera); gl.finish();
            samples.push(performance.now() - start);
          }
          samples.sort((a, b) => a - b);
          const textures = new Set(), pavement = new Set();
          airport.group.traverse(o => {
            if (!o.material) return;
            for (const slot of ['map','normalMap','roughnessMap']) {
              const t = o.material[slot]; if (t) textures.add(t);
              if (t && /^(pavement-|runway-repair)/.test(o.material.name)) pavement.add(t);
            }
          });
          const textureBytes = [...textures].reduce((sum,t) => sum + (t.image?.width || 0) * (t.image?.height || 0) * 4 * 4/3, 0);
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return { version: '${version}', airport: '${airportName}', view: '${view}',
            calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            medianMs: samples[22], p95Ms: samples[42], estimatedAirportTextureBytes: Math.round(textureBytes),
            pavementMaps: pavement.size, textures: renderer.info.memory.textures,
            gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            browser: navigator.userAgent,
            programs: renderer.info.programs.map(p => p.diagnostics?.runnable ?? true) };
        })()`);
        results.push(result);
        const shot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(dir, `${version}-${airportName}-${view}.png`), Buffer.from(shot.data, 'base64'));
      }
      await evaluate(`(() => {
        const { renderer, scene } = window.review;
        scene.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
        renderer.dispose();
      })()`);
    }
  }
  assert.ok(results.length >= 8);
  assert.ok(results.every(r => r.pavementMaps === 6 && r.programs.length && r.programs.every(Boolean)));
  assert.equal(errors.length, 0, JSON.stringify(errors));
} finally {
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ assetBytes: sources.reduce((s, a) => s + a.bytes, 0), results, errors }, null, 2));
  ws.close();
}
console.log(`Verified ${results.length} airport views; results in ${dir}`);
