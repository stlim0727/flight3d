// Run under chrome-session with a GPU Chrome already listening on CDP_URL.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.SIM_URL || 'http://127.0.0.1:5261';
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9222';
const dir = process.env.ARTIFACT_DIR || '.cache/runway-markings';
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync('.cache/runway-markings.html', '<!doctype html><title>Runway marking verification</title>');
const target = await (await fetch(`${cdp}/json/new?${encodeURIComponent(`${origin}/.cache/runway-markings.html`)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), errors = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 60000);
    pending.set(id, message => {
      clearTimeout(timer);
      message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await call('Runtime.enable');
  const response = await call('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(${async function verify() {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { Airport } = await import('/src/environment/Airport.js');
      const { LuklaAirport } = await import('/src/environment/LuklaAirport.js');
      const { createRunwayMarkingMaterial } = await import('/src/environment/RunwayMarkings.js');
      class Coastal extends Airport { async loadBuildings() { return false; } }
      const width = 618, height = 1140;
      const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
      renderer.setSize(width, height);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      const images = {}, rows = [], compatibility = [];
      const read = () => {
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const white = (pixels, i) => pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200;
      const green = (pixels, i) => pixels[i] < 60 && pixels[i + 1] > 100 && pixels[i + 2] < 60;
      for (const [name, Class] of [['coastal', Coastal], ['lukla', LuklaAirport]]) {
        const airport = new Class(), scene = new THREE.Scene();
        scene.background = new THREE.Color(0x243040);
        scene.add(new THREE.AmbientLight(0xffffff, 3), airport.group);
        const runway = airport.group.getObjectByName('runway-pavement');
        const markings = airport.group.getObjectByName('runway-markings');
        if (!runway || !markings) throw Error(name + ': missing production runway or markings');
        const markingMeshes = new Set();
        markings.traverse(o => { if (o.isMesh) markingMeshes.add(o); });
        airport.group.traverse(o => {
          if (o.isMesh && o !== runway && !markingMeshes.has(o)) o.visible = false;
          if (o.isLight) o.visible = false;
        });
        const materials = new Map();
        for (const mesh of markingMeshes) materials.set(mesh.material, mesh.material.onBeforeCompile);
        const plane = runway.parent;
        const cube = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 5), new THREE.MeshBasicMaterial({ color: 0x00aa00 }));
        cube.position.set(name === 'coastal' ? -1320 : 0, name === 'coastal' ? airport.elevation + 0.46 : 0.4, name === 'coastal' ? 0 : 170);
        plane.add(cube);
        airport.group.updateMatrixWorld(true);
        const camera = new THREE.PerspectiveCamera(58, width / height, 0.08, 45000);
        const home = name === 'coastal' ? new THREE.Vector3(-1397, 35.5, -27) : new THREE.Vector3(-12, 18, 245);
        const aim = name === 'coastal' ? new THREE.Vector3(-1305, 12.5, 0) : new THREE.Vector3(0, 0, 130);
        if (name === 'lukla') { plane.localToWorld(home); plane.localToWorld(aim); }
        const originalY = markings.position.y;
        for (const stress of [false, true]) {
          // Worst-case separation loss: coincident planes, no native polygon
          // offset. This is an explicit stress case, not an Android GPU claim.
          markings.position.y = stress ? runway.position.y : originalY;
          runway.material.polygonOffset = !stress;
          for (const material of materials.keys()) material.polygonOffset = !stress;
          for (let frame = 0; frame < 8; frame++) {
            camera.position.copy(home).add(new THREE.Vector3(frame * 0.003, frame * 0.001, 0));
            camera.lookAt(aim);
            // Reference retains foreground occlusion but removes pavement.
            runway.visible = false;
            renderer.render(scene, camera);
            const reference = read();
            runway.visible = true;
            const mask = [];
            for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
              const i = (y * width + x) * 4;
              if ([-width - 1, -width, -width + 1, -1, 0, 1, width - 1, width, width + 1].every(offset => white(reference, i + offset * 4))) mask.push(i);
            }
            const row = { airport: name, stress, frame, paintPixels: mask.length };
            let beforePixels;
            for (const variant of ['before', 'after']) {
              for (const [material, hook] of materials) {
                material.onBeforeCompile = variant === 'after' ? hook : () => {};
                material.customProgramCacheKey = () => 'runway-verification-' + variant;
                material.needsUpdate = true;
              }
              renderer.render(scene, camera);
              const pixels = read();
              row[variant + 'Missing'] = mask.filter(i => !white(pixels, i)).length;
              row[variant + 'OccluderPixels'] = 0;
              for (let i = 0; i < pixels.length; i += 4) if (green(pixels, i)) row[variant + 'OccluderPixels']++;
              if (variant === 'before') beforePixels = pixels;
              else {
                row.occluderInteriorLost = 0;
                for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
                  const i = (y * width + x) * 4;
                  if ([-width - 1, -width, -width + 1, -1, 0, 1, width - 1, width, width + 1].every(offset => green(beforePixels, i + offset * 4)) && !green(pixels, i)) row.occluderInteriorLost++;
                }
              }
              if (frame === 0) images[name + '-' + (stress ? 'stress-' : 'normal-') + variant] = renderer.domElement.toDataURL();
            }
            rows.push(row);
          }
        }
        scene.traverse(o => { o.geometry?.dispose(); for (const material of [o.material].flat()) material?.dispose(); });
      }
      // Exercise the shader's two no-op paths as actual WebGL programs too.
      for (const mode of ['orthographic', 'ordinary-perspective']) {
        const ordinary = mode === 'ordinary-perspective';
        const testRenderer = ordinary ? new THREE.WebGLRenderer({ preserveDrawingBuffer: true }) : renderer;
        testRenderer.setSize(128, 128);
        const camera = ordinary ? new THREE.PerspectiveCamera(58, 1, 0.08, 100) : new THREE.OrthographicCamera(-2, 2, 2, -2, 0.08, 100);
        camera.position.set(0, 4, 2); camera.lookAt(0, 0, 0);
        const scene = new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff, 3));
        const material = createRunwayMarkingMaterial();
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material); scene.add(mesh);
        const hook = material.onBeforeCompile, context = testRenderer.getContext();
        const frames = [];
        for (const patched of [false, true]) {
          material.onBeforeCompile = patched ? hook : () => {};
          material.customProgramCacheKey = () => 'compatibility-' + patched;
          material.needsUpdate = true; testRenderer.render(scene, camera);
          const pixels = new Uint8Array(128 * 128 * 4);
          context.readPixels(0, 0, 128, 128, context.RGBA, context.UNSIGNED_BYTE, pixels); frames.push(pixels);
        }
        compatibility.push({ mode, litPixels: frames[1].filter((value, i) => i % 4 === 0 && value > 100).length, changedChannels: frames[0].reduce((sum, value, i) => sum + Number(value !== frames[1][i]), 0), shaderErrors: testRenderer.info.programs.filter(p => p.diagnostics?.runnable === false).length });
        material.dispose(); mesh.geometry.dispose(); if (ordinary) testRenderer.dispose();
      }
      const shaderErrors = renderer.info.programs.filter(p => p.diagnostics?.runnable === false).length;
      renderer.dispose();
      return { gpu, browser: navigator.userAgent, shaderErrors, compatibility, rows, images };
    }.toString()})()`
  });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  const report = response.result.value;
  for (const [name, data] of Object.entries(report.images)) fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  delete report.images;
  report.errors = errors;
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(errors.length, 0, 'browser errors');
  assert.equal(report.shaderErrors, 0, 'shader errors');
  assert.equal(report.rows.length, 32, 'both airports and all frames required');
  assert.equal(report.compatibility.length, 2);
  for (const row of report.compatibility) {
    assert.ok(row.litPixels > 100, 'nonempty compatibility render');
    assert.equal(row.shaderErrors, 0);
    assert.equal(row.changedChannels, 0, row.mode + ' keeps ordinary projection depth');
  }
  for (const row of report.rows) {
    assert.ok(row.paintPixels > 100, 'nonempty interior paint mask');
    // Allow subpixel coverage differences in the distant canvas-number edges.
    assert.ok(row.afterMissing / row.paintPixels < 0.001, JSON.stringify(row));
    assert.ok(row.afterOccluderPixels > 10, 'foreground object remains visible');
    assert.equal(row.occluderInteriorLost, 0, 'bias must preserve foreground occlusion');
  }
  assert.ok(report.rows.some(row => row.stress && row.beforeMissing > 100), 'baseline must fail the stress case');
  console.log(JSON.stringify({ gpu: report.gpu, frames: report.rows.length, baselineMissing: Math.max(...report.rows.map(r => r.beforeMissing)), afterMissing: Math.max(...report.rows.map(r => r.afterMissing)), artifacts: dir }));
} finally {
  ws.close();
  await fetch(`${cdp}/json/close/${target.id}`);
}
