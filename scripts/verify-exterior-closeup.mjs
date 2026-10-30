import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';
import { assertHardwareDraw } from './verify-browser-gpu.mjs';

// Windows uses native D3D11; Linux must expose a hardware Vulkan device.
if (process.platform === 'win32') {
  process.env.GPU_ANGLE ||= 'd3d11';
  process.env.CHROME_PATH ||= 'C:/Program Files/Google/Chrome/Application/chrome.exe';
}
assert.notEqual(detectGpuAngle(), 'swiftshader', 'Hardware GPU is required');
const output = process.env.ARTIFACT_DIR || 'review-artifacts/issue-325';
await mkdir(output, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
try {
  await withBrowserSession({ origin: vite.resolvedUrls.local[0], path: '/', timeoutMs: 60000 },
    async ({ evaluate, send, screenshot, delay, exceptions }) => {
      const gpu = await evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const gl = canvas.getContext('webgl2');
        if (!gl) return { webgl2: false };
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const program = gl.createProgram();
        for (const [type, source] of [
          [gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p[3]=vec2[](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));gl_Position=vec4(p[gl_VertexID],0.,1.);}'],
          [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.,0.,0.,1.);}'],
        ]) {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader);
        }
        gl.linkProgram(program); gl.useProgram(program);
        gl.viewport(0, 0, 16, 16); gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixel = new Uint8Array(4);
        gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const report = { webgl2: true, renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), pixel: [...pixel], error: gl.getError() };
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return report;
      });
      assertHardwareDraw(gpu);
      for (let i = 0; i < 240; i++) {
        if (await evaluate(() => Boolean(window.simulator?.startupReady && !document.body.classList.contains('booting')))) break;
        await delay(500);
      }
      assert.ok(await evaluate(() => window.simulator?.startupReady), 'startup completed before camera evidence');
      await evaluate(() => {
        const s = window.simulator;
        s.demoDirector?.stop(); s.gameFlow?.enterFlight();
        s.integratePhysics = () => {};
        s.position.set(-520, 300, 720);
        s.cameraSystem.enableCursorTrack = false;
        s.cameraSystem.enableEdgePan = false;
      });
      const results = [];
      const state = () => evaluate(() => {
        const s = window.simulator, c = s.cameraSystem;
        return { zoom: c.opticalZoom, fov: s.camera.fov, distance: c.mode === 1 ? c.chaseDistance : c.droneDistance,
          height: c.mode === 1 ? c.chaseHeight : c.droneHeight };
      });
      const wheel = async deltaY => {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 400, deltaX: 0, deltaY });
        await delay(60);
      };
      for (const aircraft of ['B738', 'C172', 'F16']) {
        await evaluate(id => window.simulator.setAircraft(id), aircraft);
        await delay(1500);
        for (const mode of [1, 6]) {
          await evaluate(mode => window.simulator.cameraSystem.setMode(mode, true), mode);
          await delay(1500);
          const before = await state();
          await screenshot(join(output, `${aircraft}-${mode}-1x.png`));
          await wheel(-3000);
          await delay(500);
          const closeup = await state();
          assert.equal(closeup.zoom, 6);
          assert.equal(closeup.distance, before.distance);
          assert.equal(closeup.height, before.height);
          assert.ok(closeup.fov < before.fov / 4);
          await screenshot(join(output, `${aircraft}-${mode}-6x.png`));
          // Reverse through the same wheel handler, then native two-finger touch input.
          await wheel(3000);
          await delay(300);
          assert.equal((await state()).zoom, 0.5);
          await screenshot(join(output, `${aircraft}-${mode}-0.5x.png`));
          await evaluate(() => window.simulator.cameraSystem.resetLook());
          await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
          const points = d => [{ id: 1, x: 720 - d, y: 400 }, { id: 2, x: 720 + d, y: 400 }];
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(40) });
          for (let d = 60; d <= 320; d += 20) {
            await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(d) });
          }
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await delay(200);
          const pinch = await state();
          assert.ok(pinch.zoom > 4, `native pinch magnifies in mode ${mode}: ${pinch.zoom}`);
          // Actual double click restores the view.
          for (const type of ['mousePressed', 'mouseReleased']) {
            await send('Input.dispatchMouseEvent', { type, x: 720, y: 400, button: 'left', clickCount: 2 });
          }
          await delay(200);
          assert.equal((await state()).zoom, 1);
          results.push({ aircraft, mode, before, closeup, pinch });
        }
      }
      assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
      await writeFile(join(output, 'results.json'), JSON.stringify({ gpu, results, exceptions }, null, 2));
      console.log(JSON.stringify({ gpu, results }, null, 2));
    });
} finally {
  await vite.close();
}
