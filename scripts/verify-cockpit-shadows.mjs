import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Cockpit interior sunlight acceptance for issue #90.
// Start the dev server and a headless Chrome on the page first, see docs/development/ci.md
// (use any free port for Vite; the script only needs a Chrome already sitting on the page):
//   npm run dev -- --host 127.0.0.1 --port 5196 --strictPort
//   google-chrome-stable --headless=new --user-data-dir=/tmp/flight3d-deck-sun \
//     --remote-debugging-port=9471 --window-size=1280,720 \
//     --use-gl=angle --use-angle=vulkan --no-first-run http://127.0.0.1:5196/
const cdpPort = process.env.CDP_PORT || 9471;
const dir = process.env.ARTIFACT_DIR || path.resolve('review-artifacts/issue90');
fs.mkdirSync(dir, { recursive: true });

const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const pageErrors = [];
const resourceErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  // Record which asset 404s instead of failing on it: a missing optional texture is a
  // packaging question, not a lighting regression.
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') resourceErrors.push(`${m.params.entry.text} <- ${m.params.entry.url}`);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timeout = setTimeout(() => reject(new Error(`timeout ${method}`)), 120000);
  pending.set(id, (m) => {
    clearTimeout(timeout);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await call('Runtime.enable');
await call('Log.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
// Reload so the page under test is the source on disk, then wait for the interior GLB.
await call('Page.enable');
await call('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 3000));
for (let attempt = 0; attempt < 120; attempt++) {
  if (await evaluate('Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)')) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const gpu = await evaluate(`(() => {
  const gl = window.simulator.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
})()`);

// Freeze the loop, enter the 3D cockpit and hold a pose we choose, so every captured
// frame is a deterministic function of time of day, heading, bank and cloud cover.
await evaluate(`(() => {
  const sim = window.simulator;
  sim.demoDirector.stop();
  sim.gameFlow.enterFlight();
  const savedAnimate = sim.animate;
  window.deckSunReview = { savedAnimate, calls: 0 };
  sim.animate = () => {};
  sim.cameraSystem.photoCockpit = false;
  sim.cameraSystem.lookYaw = 0;
  sim.cameraSystem.lookPitch = 0;
  sim.cameraSystem.setMode(0);
  return true;
})()`);

// A single staged frame: pose, sky, physics-free display update, then read the deck.
const stage = async ({ hour, heading, bank = 0, cloud = 0, frames = 4 }) => await evaluate(`(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const sim = window.simulator;
  const sky = sim.sky;
  sim.position.set(0, 900, 0);
  sim.aircraft.group.position.copy(sim.position);
  const euler = new THREE.Euler(THREE.MathUtils.degToRad(${bank}), THREE.MathUtils.degToRad(${heading}), 0, 'YXZ');
  sim.quaternion.setFromEuler(euler);
  sim.aircraft.group.quaternion.copy(sim.quaternion);
  sky.setCloudCover(${cloud});
  sky.setTimeOfDay(${hour}, sim.position, sim.camera.position);
  for (let i = 0; i < ${frames}; i++) {
    sim.aircraft.setCockpitMode(true, true);
    sim.aircraft.group.updateMatrixWorld(true);
    sim.cameraSystem.update(1 / 60, sim.aircraft.group, sim.telemetry,
      (x, z) => sim.currentTerrain.getHeight(x, z));
    const daylight = sim.sky.updateCockpitSun({
      position: sim.aircraft.group.position,
      quaternion: sim.aircraft.group.quaternion,
      cockpitActive: true,
      dt: i === 0 ? 1 : 1 / 60, // Settle camera-entry lighting before the static capture.
      casterState: 'static-review',
    });
    sim.aircraft.cockpit.syncDaylight(daylight);
    sim.renderScene();
  }
  const rig = sky.cockpitSun;
  const stats = (() => {
    const gl = sim.renderer.getContext();
    const w = 360, h = 220;
    const x = Math.floor((gl.drawingBufferWidth - w) / 2);
    const y = Math.floor((gl.drawingBufferHeight - h) / 2) - 40;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, sum2 = 0, n = w * h;
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
      sum += l; sum2 += l * l;
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2) };
  })();
  const cookie = (() => {
    if (!rig.canvas) return null;
    const size = rig.canvas.width;
    const data = rig.canvas.getContext('2d').getImageData(0, 0, size, size).data;
    let lit = 0, u = 0, v = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const p = (py * size + px) * 4;
        const level = data[p] / 255;
        if (level > 0.5) { lit++; u += px; v += py; }
      }
    }
    return lit ? { lit: lit / (size * size), cx: u / lit / size, cy: v / lit / size } : { lit: 0, cx: 0, cy: 0 };
  })();
  return {
    stats,
    cookie,
    sunLocal: {
      elevDeg: +(Math.asin(Math.min(1, Math.max(-1, rig.pose.sunDirLocal.y))) * 180 / Math.PI).toFixed(1),
      bearingDeg: +(Math.atan2(rig.pose.sunDirLocal.x, -rig.pose.sunDirLocal.z) * 180 / Math.PI).toFixed(1),
    },
    intensity: rig.light.intensity,
    daylight: rig.daylight,
    facing: rig.pose.facing,
    modeFactor: rig.modeFactor,
    sunIntensity: sky.sunLight.intensity,
    sunAttenuation: sky.sunAttenuation,
    shadowIntensity: rig.light.shadow.intensity,
    floods: sim.aircraft.cockpit.floods.map((f) => +f.intensity.toFixed(4)),
    mapDirty: rig.light.shadow.needsUpdate,
    angleDeg: +(rig.light.angle * 180 / Math.PI).toFixed(3),
    deckSunOverSun: rig.light.intensity / Math.max(sky.sunLight.intensity, 1e-6),
  };
})()`);

const snapshot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.writeFileSync(path.join(dir, `${name}.png`), buf);
  return `${(buf.length / 1024).toFixed(0)}KB`;
};

const rigFacts = await evaluate(`(() => {
  const rig = window.simulator.sky.cockpitSun;
  return {
    isSpot: !!rig.light.isSpotLight,
    decay: rig.light.decay,
    distance: rig.light.distance,
    castShadow: rig.light.castShadow,
    autoUpdate: rig.light.shadow.autoUpdate,
    mapSize: rig.light.shadow.mapSize.toArray(),
    hasCookie: !!rig.light.map,
    cookieClass: rig.light.map?.constructor?.name,
    cookieSize: rig.canvas?.width ?? null,
    cookieMipmaps: rig.light.map?.generateMipmaps ?? null,
    shadowMapSize: rig.light.shadow.mapSize.toArray(),
    mainSunMapSize: window.simulator.sky.sunLight.shadow.mapSize.toArray(),
    mainSunCasts: window.simulator.sky.sunLight.castShadow,
    exteriorShadowProxy: window.simulator.aircraft.gltfShadowProxy?.castShadow ?? null,
    sceneChildren: window.simulator.scene.children.length,
    exteriorVisible: window.simulator.aircraft.group.visible,
  };
})()`);

// The sun bearing in the deck frame is what drives the pattern. SkyAtmosphere puts the sun
// at azimuth theta = 180 + 45 cos((hour - 6)/24 turns) and elevation 65 sin of the same
// angle, with theta 180 pointing down the -Z axis; a heading of theta - 180 therefore means
// sun dead ahead, theta means sun dead astern, and theta - 270 / theta - 90 mean sun abeam
// left / right. 09:00 -> theta 211.8 elevation 46; 12:30 -> theta 174 elevation 65;
// 17:00 -> theta 136.5 elevation 17.
const cells = {
  morning: { hour: 7.0, heading: 20 },
  noon: { hour: 12.5, heading: -6 },
  golden: { hour: 16.8, heading: 0 },
  night: { hour: 21.0, heading: 20 },
  leftSun: { hour: 9.0, heading: 302 },
  rightSun: { hour: 9.0, heading: 122 },
  bankLeft: { hour: 9.0, heading: 302, bank: -35 },
  bankRight: { hour: 9.0, heading: 302, bank: 35 },
  overcast: { hour: 12.5, heading: -6, cloud: 0.8 },
  astern: { hour: 17.0, heading: 136.5 },
};
const results = {};
for (const [name, cell] of Object.entries(cells)) {
  results[name] = await stage(cell);
  const r = results[name];
  const size = await snapshot(`deck-sun-${name}`);
  console.log(`${name.padEnd(10)} sun ${String(r.sunLocal.bearingDeg).padStart(6)}deg elev ${String(r.sunLocal.elevDeg).padStart(5)}`
    + ` | mean ${r.stats.mean.toFixed(1)} std ${r.stats.std.toFixed(1)} | I ${r.intensity.toFixed(3)} face ${r.facing.toFixed(2)}`
    + ` | cookie ${(r.cookie?.lit ?? 0).toFixed(3)} @${(r.cookie?.cx ?? 0).toFixed(3)},${(r.cookie?.cy ?? 0).toFixed(3)}`
    + ` | floods [${r.floods.join(', ')}] ${size}`);
}

// Side-by-side evidence on the strongest cell: the same staged frame with the deck sun
// multiplied out. The comparison is restricted to the instrument panel, because the sky and
// cloud layers advance their own time uniforms per render call and would swamp the numbers
// and the picture with unrelated change.
await stage(cells.leftSun);
const ablation = await evaluate(`(() => {
  const sim = window.simulator, rig = sim.sky.cockpitSun;
  const gl = sim.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const grab = () => {
    sim.renderScene();
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const luma = (b, i) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
  // Two renders of the unchanged frame give the noise floor: sky, cloud and water layers
  // advance their own time uniforms per call, so a raw frame difference is not evidence.
  const a = grab();
  const b = grab();
  const lit = grab();
  const saved = rig.light.intensity;
  rig.light.intensity = 0;
  const dark = grab();
  rig.light.intensity = saved;
  grab();
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  let changed = 0, sx = 0, sy = 0, sum = 0, max = 0, still = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const j = ((H - 1 - y) * W + x) * 4;
      const flicker = Math.abs(luma(a, j) - luma(b, j));
      const d = luma(lit, j) - luma(dark, j);
      const v = flicker > 2 ? 40 : Math.max(0, Math.min(255, 128 + d * 12));
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      if (flicker <= 2) {
        still++;
        sum += d;
        if (Math.abs(d) > 6) { changed++; sx += x; sy += y; }
        if (Math.abs(d) > max) max = Math.abs(d);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // Split the same difference by what the pixel is, read off the review frames: the world
  // outside must stay untouched while the deck surfaces take the pattern.
  const boxes = {
    outside: [0.30, 0.17, 0.20, 0.19],
    glareshield: [0.47, 0.42, 0.43, 0.13],
    panel: [0.52, 0.60, 0.45, 0.23],
    pedestal: [0.69, 0.83, 0.24, 0.14],
  };
  const zones = {};
  for (const [name, f] of Object.entries(boxes)) {
    const x0 = Math.round(f[0] * W), y0 = Math.round(f[1] * H);
    const x1 = x0 + Math.round(f[2] * W), y1 = y0 + Math.round(f[3] * H);
    let sum = 0, n = 0, moved = 0, peak = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const j = ((H - 1 - y) * W + x) * 4;
        const d = luma(lit, j) - luma(dark, j);
        sum += d; n++;
        if (Math.abs(d) > 6) moved++;
        if (Math.abs(d) > peak) peak = Math.abs(d);
      }
    }
    zones[name] = { meanDelta: +(sum / Math.max(1, n)).toFixed(2), movedShare: +(moved / Math.max(1, n)).toFixed(3), maxDelta: +peak.toFixed(1) };
  }
  return {
    changed: +(changed / (W * H)).toFixed(4),
    staticShare: +(still / (W * H)).toFixed(3),
    meanDelta: +(sum / Math.max(1, still)).toFixed(2),
    maxDelta: +max.toFixed(1),
    centroid: changed ? { x: +(sx / changed / W).toFixed(3), y: +(sy / changed / H).toFixed(3) } : null,
    zones,
    png: canvas.toDataURL('image/png').split(',')[1],
  };
})()`);
fs.writeFileSync(path.join(dir, 'deck-sun-leftSun-diff.png'), Buffer.from(ablation.png, 'base64'));

// Two identical staged frames must not repaint the shadow map.
const repeat = await evaluate(`(() => {
  const sim = window.simulator;
  const rig = sim.sky.cockpitSun;
  sim.stepSimulation(1 / 60);
  sim.renderScene();
  const settled = rig.light.shadow.needsUpdate;
  sim.sky.setTimeOfDay(9.4, sim.position, sim.camera.position);
  sim.stepSimulation(1 / 60);
  const moved = rig.light.shadow.needsUpdate;
  return { settled, moved };
})()`);

// Frame cost with the map frozen versus forced every frame, in the cockpit.
const perf = await evaluate(`(() => {
  const sim = window.simulator;
  const rig = sim.sky.cockpitSun;
  const time = (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { sim.stepSimulation(1 / 60); sim.renderScene(); }
    sim.renderer.getContext().finish();
    return (performance.now() - t0) / n;
  };
  time(10);
  const frozen = time(40);
  rig.light.shadow.autoUpdate = true;
  const forced = time(40);
  rig.light.shadow.autoUpdate = false;
  return { frozen: +frozen.toFixed(2), forced: +forced.toFixed(2) };
})()`);

// Independently remove local-sun frame casting and AO from one frozen frame. Removing
// sunlight alone cannot establish that a pillar casts, or that contact AO works.
await stage({ ...cells.golden, frames: 12 });
const contrast = {};
const readDeck = async () => evaluate(`(() => {
  const sim = window.simulator;
  sim.renderScene();
  const gl = sim.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const bytes = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  window.contrastPixels ??= bytes;
  const boxes = { deck: [0.25, 0.4, 0.75, 0.6], outside: [0.33, 0.18, 0.16, 0.17],
    display: [0.547, 0.682, 0.025, 0.035] };
  const result = {};
  for (const [name, [x, y, width, height]] of Object.entries(boxes)) {
    let moved = 0, sum = 0, peak = 0, count = 0;
    for (let py = Math.floor(y * h); py < Math.floor((y + height) * h); py++) {
      for (let px = Math.floor(x * w); px < Math.floor((x + width) * w); px++) {
        const i = ((h - 1 - py) * w + px) * 4;
        let delta = 0;
        for (let k = 0; k < 3; k++) delta += Math.abs(bytes[i + k] - window.contrastPixels[i + k]) / 3;
        if (delta > 3) moved++;
        sum += delta; peak = Math.max(peak, delta); count++;
      }
    }
    result[name] = { moved, mean: +(sum / count).toFixed(4), peak: +peak.toFixed(2) };
  }
  return result;
})()`);
await evaluate('delete window.contrastPixels');
await readDeck();
contrast.noise = await readDeck();
await snapshot('contrast-final');
await evaluate(`(() => {
  const sim = window.simulator;
  const frame = sim.aircraft.cockpit.gltfCockpitModel.getObjectByName('Body020_Material008_0');
  if (!frame) throw new Error('Native window frame missing');
  window.frameShadowHooks = [frame.onBeforeShadow, frame.onAfterShadow];
  frame.onBeforeShadow = function (...args) {
    window.frameShadowHooks[0].apply(this, args);
    if (args[3].userData.cockpitSun) args[4].setDrawRange(0, 0);
  };
  frame.onAfterShadow = function (...args) {
    args[4].setDrawRange(0, Infinity);
    window.frameShadowHooks[1].apply(this, args);
  };
  sim.sky.cockpitSun.light.shadow.needsUpdate = true;
})()`);
contrast.frameOff = await readDeck();
await snapshot('contrast-frame-casting-off');
await evaluate(`(() => {
  const sim = window.simulator;
  const frame = sim.aircraft.cockpit.gltfCockpitModel.getObjectByName('Body020_Material008_0');
  [frame.onBeforeShadow, frame.onAfterShadow] = window.frameShadowHooks;
  delete window.frameShadowHooks;
  sim.sky.cockpitSun.light.shadow.needsUpdate = true;
  sim.cockpitOcclusion.enabled = false;
})()`);
contrast.aoOff = await readDeck();
await snapshot('contrast-ao-off');
await evaluate('window.simulator.cockpitOcclusion.enabled = true; delete window.contrastPixels;');
console.log('contrast', JSON.stringify(contrast));

const aoDepth = await evaluate(`(() => {
  const ao = window.simulator.cockpitOcclusion;
  return {
    near: ao.aoCamera.near, far: ao.aoCamera.far,
    ssaoNear: ao.pass.ssaoMaterial.uniforms.cameraNear.value,
    ssaoFar: ao.pass.ssaoMaterial.uniforms.cameraFar.value,
    depthNear: ao.pass.depthRenderMaterial.uniforms.cameraNear.value,
    depthFar: ao.pass.depthRenderMaterial.uniforms.cameraFar.value,
    minDistance: ao.pass.minDistance, maxDistance: ao.pass.maxDistance,
  };
})()`);

await evaluate('window.simulator.animate = window.deckSunReview.savedAnimate;');
ws.close();

const report = { gpu, rigFacts, results, repeat, perf, contrast, aoDepth, pageErrors, resourceErrors,
  ablation: { ...ablation, png: undefined } };
fs.writeFileSync(path.join(dir, 'deck-sun-report.json'), JSON.stringify(report, null, 2));

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
check(rigFacts.isSpot && rigFacts.decay === 0 && rigFacts.distance === 0, 'Deck sun must be a falloff-free spot');
check(rigFacts.hasCookie && rigFacts.cookieSize === 256 && rigFacts.cookieMipmaps === false, 'Deck sun must carry a 256px cookie without mipmaps');
check(rigFacts.castShadow && rigFacts.autoUpdate === false, 'Deck sun must cast with a manually updated map');
check(rigFacts.shadowMapSize.join() === '1024,1024', `Deck sun map must be 1024², got ${rigFacts.shadowMapSize}`);
check(rigFacts.mainSunMapSize.join() === '2048,2048' && rigFacts.mainSunCasts && rigFacts.exteriorShadowProxy === true,
  'The exterior sun and airframe shadow proxy must be untouched');
check(!pageErrors.length, `Page errors: ${pageErrors.join(' | ')}`);
check(aoDepth.far === 8 && aoDepth.ssaoFar === aoDepth.far && aoDepth.depthFar === aoDepth.far &&
  aoDepth.ssaoNear === aoDepth.near && aoDepth.depthNear === aoDepth.near,
  'AO depth linearization uniforms must match the cockpit camera range');
check(Math.abs(aoDepth.minDistance * (aoDepth.far - aoDepth.near) - 0.003) < 1e-9 &&
  Math.abs(aoDepth.maxDistance * (aoDepth.far - aoDepth.near) - 0.45) < 1e-9,
  'AO rejection distances must remain in cockpit metres');
if (resourceErrors.length) console.log('resource errors (not lighting):', resourceErrors.join(' | '));

for (const name of ['morning', 'golden', 'leftSun', 'rightSun']) {
  check(results[name].intensity > 0.3, `${name}: daytime sun must reach the deck, got ${results[name].intensity}`);
  check(results[name].cookie.lit > 0.002, `${name}: cookie must carry windshield openings`);
}
for (const name of ['morning', 'golden']) {
  check(results[name].floods.every((f) => f < 1), `${name}: floods must dim while the sun lights the deck`);
}
// The ablation multiplies the deck sun out of an otherwise identical frame and keeps only
// pixels that repeat-render stable, so a delta here is the rig's own work on the deck.
check(ablation.staticShare > 0.5,
  `Most of the deck must be static enough to measure, static share ${(ablation.staticShare * 100).toFixed(1)}%`);
check(ablation.changed > 0.02,
  `Deck sun must repaint a deck-sized share of the frame, got ${(ablation.changed * 100).toFixed(1)}%`);
check(ablation.maxDelta > 8, `Deck sun must produce visible bands, max delta ${ablation.maxDelta}`);
check(ablation.centroid && ablation.centroid.y > 0.5,
  `Deck-sun pixels must land on the deck below the horizon, centroid ${JSON.stringify(ablation.centroid)}`);
check(ablation.zones.outside.maxDelta <= 2,
  `Deck sun must leave the world outside the windshield alone, max delta ${ablation.zones.outside.maxDelta}`);
for (const name of ['glareshield', 'pedestal']) {
  check(ablation.zones[name].meanDelta > 1 && ablation.zones[name].maxDelta > 12,
    `Deck sun must band the ${name}, got ${JSON.stringify(ablation.zones[name])}`);
}
check(results.noon.intensity < results.morning.intensity,
  `A 65-degree sun dead ahead must be raked off the deck by the windshield compared with low morning sun: ${results.noon.intensity} vs ${results.morning.intensity}`);
check(results.night.intensity < 0.05, `Night must leave no deck sun, got ${results.night.intensity}`);
check(results.night.floods.every((f) => f >= 0.15), 'Floods must keep the night glow');
check(results.astern.intensity < 0.05, `Sun astern must admit nothing, got ${results.astern.intensity}`);
check(results.overcast.intensity < results.noon.intensity * 0.45, 'Overcast must wash the deck sun out');
check(results.overcast.shadowIntensity < 1, 'Overcast must soften deck shadows');
check(results.leftSun.intensity > 0.3 && results.rightSun.intensity > 0.3, 'Sun abeam must still light the deck');
const offset = (cell) => [cell.cookie.cx - 0.5, cell.cookie.cy - 0.5];
const spread = (a, b) => Math.hypot(offset(a)[0] - offset(b)[0], offset(a)[1] - offset(b)[1]);
check(spread(results.leftSun, results.rightSun) > 0.02,
  `Sun from opposite sides must move the pattern: ${JSON.stringify(offset(results.leftSun))} vs ${JSON.stringify(offset(results.rightSun))}`);
check(spread(results.bankLeft, results.bankRight) > 0.02,
  `Bank must slide the pattern across the deck: ${JSON.stringify(offset(results.bankLeft))} vs ${JSON.stringify(offset(results.bankRight))}`);
check(spread(results.morning, results.golden) > 0.02,
  `Morning and golden-hour sun must land in different places: ${JSON.stringify(offset(results.morning))} vs ${JSON.stringify(offset(results.golden))}`);
for (const name of Object.keys(results)) {
  check(results[name].deckSunOverSun <= 3.21, `${name}: deck sun over its share of ambient`);
}
check(contrast.noise.deck.moved < 16 && contrast.noise.deck.mean < 0.001,
  'Repeated static cockpit renders must have negligible pixel noise');
check(contrast.frameOff.deck.moved > 1000 && contrast.frameOff.deck.peak > 12,
  'Window frame must cast measurable bands through the localized sun alone');
check(contrast.aoOff.deck.moved > 1000 && contrast.aoOff.deck.peak > 6,
  'Contact AO must shade a visible set of deck pixels');
for (const name of ['frameOff', 'aoOff']) {
  check(contrast[name].outside.peak <= 1, `${name}: cockpit effect must leave the exterior alone`);
  check(contrast[name].display.peak <= 1, `${name}: instrument display must stay readable`);
}
check(repeat.settled === false, 'Frozen shadow map must stay clean across identical frames');
check(repeat.moved === true, 'A moved sun must mark the shadow map dirty');
check(perf.forced > perf.frozen, `Forcing the sun map every frame must cost more than freezing it: ${perf.frozen} vs ${perf.forced} ms`);

console.log('\ngpu', gpu);
console.log('rig', JSON.stringify(rigFacts));
console.log('repeat', JSON.stringify(repeat), 'perf', JSON.stringify(perf), 'ms/frame');
console.log('ablation', JSON.stringify({ staticShare: ablation.staticShare, changed: ablation.changed,
  meanDelta: ablation.meanDelta, maxDelta: ablation.maxDelta, centroid: ablation.centroid, zones: ablation.zones }));
if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\n✅ issue #90 cockpit sunlight acceptance passed (${Object.keys(cells).length} views in ${dir})`);
