import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { withBrowserSession } from './lib/browserHarness.mjs';

await withBrowserSession({ path: '/docs/development/replay.md', timeoutMs: 20000 }, async ({ cdpPort, evaluate, screenshot }) => {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`],
    { stdio: 'inherit', timeout: 30000 });
  const result = await evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { CombatReplayPlayback } = await import('/src/replay/CombatReplayPlayback.js');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18304a);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 3));
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(900, 600);
    document.body.replaceChildren(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    camera.position.set(-12, 1008, 30);
    camera.lookAt(0, 1000, 0);
    const pose = { x: 0, y: 1000, z: 0, headingRad: 0, alive: true, damage: 0, damageZones: {} };
    const playback = new CombatReplayPlayback({ scene });
    playback.load({ version: 8, targets: [{ callsign: 'DAMAGE CHECK' }], missileSamples: [],
      banditSamples: [0, 2].map(timeSec => ({ timeSec, targets: [pose] })),
      events: [{ kind: 'damage', targetId: 0, timeSec: 0.5, damage: 0.7,
        damageZones: { wingL: 0.8, engine: 0.7 } }] });
    playback.seek(0.8);
    const view = playback.view.targetViews.get(0);
    for (let frame = 0; frame < 12; frame++) playback.update(1 / 60, 0.8 + frame / 60);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(900 * 600 * 4);
    gl.readPixels(0, 0, 900, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let warmPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 100 && pixels[i] > pixels[i + 1] * 1.2 && pixels[i] > pixels[i + 2] * 1.5) warmPixels++;
    }
    const burning = { smoke: view.trail.count, fire: view.fireTrail.count,
      emitX: view.fireTrail.positions[0], warmPixels, error: gl.getError() };
    window.damageCheck = { playback, scene, camera, renderer };
    return burning;
  });
  assert.ok(result.smoke > 0 && result.fire > 0, 'localized smoke and fire emitted');
  assert.ok(result.emitX < -2, 'effect originates at damaged left wing');
  assert.ok(result.warmPixels > 0, 'fire draws warm pixels');
  assert.equal(result.error, 0);
  await screenshot('.cache/replay-damage/burning.png');
  const rewound = await evaluate(() => {
    const { playback, scene, camera, renderer } = window.damageCheck;
    playback.seek(0.1);
    renderer.render(scene, camera);
    return { damage: playback.targets[0].damage, smoke: Boolean(playback.view.targetViews.get(0).trail) };
  });
  assert.deepEqual(rewound, { damage: 0, smoke: false });
  console.log(JSON.stringify({ browser: 'Chrome', burning: result, rewound }));
});
