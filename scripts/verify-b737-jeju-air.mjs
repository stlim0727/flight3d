import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

// Linux hardware GPU path
if (process.platform === 'linux') {
  await access('/dev/dri/renderD128', constants.R_OK | constants.W_OK);
  process.env.GPU_ANGLE = 'vulkan';
}

const output = process.env.ARTIFACT_DIR || 'review-artifacts/b737-jeju-air';
await mkdir(output, { recursive: true });

await withBrowserSession(
  { path: '/?airport=coastal&aircraft=B738&scenario=runway', timeoutMs: 60000 },
  async ({ evaluate, screenshot, delay, exceptions }) => {
    // Verify WebGL2 hardware renderer
    const gpu = await evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
      return { renderer };
    });
    console.log('GPU Renderer:', gpu.renderer);

    // Wait for B738 model to finish loading
    for (let i = 0; i < 40; i++) {
      const loaded = await evaluate('Boolean(window.simulator?.aircraft?.modelLoaded)');
      if (loaded) break;
      await delay(250);
    }
    assert.ok(await evaluate('Boolean(window.simulator?.aircraft?.modelLoaded)'), 'B738 model must be loaded');

    // Dismiss any booting overlays and enter flight mode
    await evaluate(() => {
      const s = window.simulator;
      document.body.classList.remove('booting');
      const overlay = document.getElementById('startup-overlay');
      if (overlay) overlay.hidden = true;
      s.demoDirector?.stop();
      s.gameFlow?.enterFlight();
      s.integratePhysics = () => {};
      s.cameraSystem.enableCursorTrack = false;
      s.cameraSystem.enableEdgePan = false;
    });

    const updateView = async (mode, setupFn) => {
      await evaluate((m) => {
        const s = window.simulator;
        s.cameraSystem.setMode(m, true);
      }, mode);
      if (setupFn) {
        await evaluate(setupFn);
      }
      await evaluate(() => {
        const s = window.simulator;
        s.cameraSystem.update(0.016, s.aircraft.group, s.telemetry, (x, z) => s.currentTerrain.getHeight(x, z));
        s.renderScene();
      });
      await delay(500);
    };

    const liveryInfo = await evaluate(() => {
      const b737 = window.simulator?.aircraft;
      return {
        currentAircraftId: window.simulator?.currentAircraftId,
        livery: b737?.livery,
        airline: b737?.group?.userData?.airline,
        modelLoaded: b737?.modelLoaded,
        useGltf: b737?.useGltf,
        hasJejuDecal: Boolean(b737?.gltfGroup?.getObjectByName('JejuAirLivery')),
        hasKoreanDecal: Boolean(b737?.gltfGroup?.getObjectByName('KoreanAirLivery'))
      };
    });
    console.log('Livery Status:', liveryInfo);
    assert.strictEqual(liveryInfo.currentAircraftId, 'B738');
    assert.strictEqual(liveryInfo.airline, 'Jeju Air');
    assert.strictEqual(liveryInfo.livery, 'jeju');
    assert.strictEqual(liveryInfo.hasJejuDecal, true);
    assert.strictEqual(liveryInfo.hasKoreanDecal, false);

    // 1. Chase view (mode 1) - Shows orange tailfin and winglets
    await updateView(1);
    await screenshot(join(output, 'b737-jeju-air-chase.png'));
    console.log('Captured chase view');

    // 2. Drone side view (mode 6) - Shows "JEJU air" fuselage wordmark and orange tail
    await updateView(6, () => {
      const s = window.simulator;
      s.cameraSystem.droneAzimuth = Math.PI * 0.45;
      s.cameraSystem.droneElevation = 0.08;
      s.cameraSystem.droneDistance = 32;
      s.cameraSystem.droneHeight = 3.5;
    });
    await screenshot(join(output, 'b737-jeju-air-side.png'));
    console.log('Captured side view');

    // 3. Drone front quarter view - Shows orange engines, winglets, and white nose
    await updateView(6, () => {
      const s = window.simulator;
      s.cameraSystem.droneAzimuth = Math.PI * 1.25;
      s.cameraSystem.droneElevation = 0.12;
      s.cameraSystem.droneDistance = 30;
      s.cameraSystem.droneHeight = 4;
    });
    await screenshot(join(output, 'b737-jeju-air-front.png'));
    console.log('Captured front quarter view');

    assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
    await writeFile(join(output, 'results.json'), JSON.stringify({ gpu, liveryInfo, exceptions }, null, 2));
    console.log('All screenshots saved to', output);
  }
);
