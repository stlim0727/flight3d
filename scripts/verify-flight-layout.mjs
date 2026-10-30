import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { withBrowserSession } from './lib/browserHarness.mjs';

// Linux hardware path; never allow the harness to silently choose software.
if (process.platform === 'linux') {
  await access('/dev/dri/renderD128', constants.R_OK | constants.W_OK);
  process.env.GPU_ANGLE = 'vulkan';
}
const out = process.env.ARTIFACT_DIR || '.cache/flight-layout';
await mkdir(out, { recursive: true });
await withBrowserSession({ path: '/?airport=coastal&aircraft=B738&scenario=runway' }, async ({ evaluate, send, delay, screenshot, exceptions }) => {
  const gpu = await evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debug) throw new Error('Renderer diagnostics unavailable');
    const renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    if (/swiftshader|llvmpipe|softpipe|lavapipe|software/i.test(renderer)) throw new Error(renderer);
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}'],
      [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1,0,0,1);}'],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { renderer, pixel: [...pixel] };
  });
  assert.deepEqual(gpu.pixel, [255, 0, 0, 255], 'hardware shader drawing and readback');
  console.log('GPU', gpu);
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(500);
  }
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), 'startup');
  await evaluate(() => {
    const s = window.simulator;
    s.demoDirector.stop(); s.gameFlow.enterFlight();
    s.integratePhysics = () => {}; // Fixed-pose layout evidence, not flight acceptance.
  });
  let touch = false;
  const click = async selector => {
    const point = await evaluate(sel => {
      const node = document.querySelector(sel);
      if (node.closest('.flight-more-panel, .ap-panel')) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = node.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, w: r.width, h: r.height, hit: node.contains(document.elementFromPoint(x, y)) };
    }, selector);
    assert.ok(point.w >= 44 && point.h >= 44 && point.hit, `${selector}: reachable 44px target ${JSON.stringify(point)}`);
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    await delay(100);
  };
  const results = [];
  for (const [width, height] of [[1440, 900], [926, 428], [390, 660], [390, 844], [320, 568], [568, 320], [320, 400]]) {
    touch = width <= 1024;
    await send('Emulation.setDeviceMetricsOverride', { width, height, mobile: touch, deviceScaleFactor: 1 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
    await evaluate(enabled => { const s = window.simulator; enabled ? s.touchControls.enable() : s.touchControls.disable(); }, touch);
    let baseline;
    for (const mode of [1, 0, 8, 6, 4, 2, 3, 5, 0]) {
      await evaluate(mode => window.simulator.controls.onSelectCamera(mode), mode);
      await delay(150);
      const bounds = await evaluate(() => {
        const selectors = ['.menu-toggle', '.hud-strip', '#btn-ap-toggle', '#btn-mute', '.flight-toolbar', ...[...document.querySelectorAll('.flight-toolbar button:not(#btn-skip-demo)')].map(n => `#${n.id}`)];
        return selectors.map(sel => { const n = document.querySelector(sel), r = n.getBoundingClientRect(); return { sel, x: r.x, y: r.y, w: r.width, h: r.height }; });
      });
      assert.ok(bounds.every(r => r.x >= 0 && r.x + r.w <= width + 1 && r.y >= 0 && r.y + r.h <= height), JSON.stringify(bounds));
      assert.ok(bounds.every(r => r.h >= 44 && (r.sel === '.hud-strip' || r.w >= 44)), 'minimum targets');
      // Camera, fullscreen and overflow form one right-anchored group; the
      // aircraft controls that takeover reveals unfold to its left.
      const visible = await evaluate(() => [...document.querySelectorAll('.flight-toolbar button')]
        .filter(node => getComputedStyle(node).display !== 'none').map(node => node.id));
      assert.deepEqual(visible.slice(-3), ['open-camera', 'btn-fullscreen', 'open-flight-more'], `primary group order: ${visible}`);
      const row = bounds.find(r => r.sel === '.flight-toolbar');
      assert.ok(width - (row.x + row.w) <= 16, `toolbar hugs the right edge: ${JSON.stringify(row)}`);
      if (baseline) assert.deepEqual(bounds, baseline, `stable controls across camera ${mode}`);
      const targets = bounds.filter(r => r.sel !== '.flight-toolbar');
      for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i], b = targets[j];
        assert.ok(a.x + a.w <= b.x + .5 || b.x + b.w <= a.x + .5 || a.y + a.h <= b.y + .5 || b.y + b.h <= a.y + .5, `${a.sel} overlaps ${b.sel}`);
      }
      baseline = bounds;
      if ([0, 8].includes(mode)) await screenshot(`${out}/${width}x${height}-camera-${mode}.png`);
    }
    await click('#btn-ap-toggle');
    assert.ok(await evaluate('!document.getElementById("ap-panel").hidden'), 'AP opens');
    await click('#btn-ap');
    assert.ok(await evaluate('window.simulator.autopilot.master'), 'AP master accepts native input inside relocated panel');
    const warning = await evaluate(() => {
      const alert = document.getElementById('hud-warning');
      alert.textContent = 'STALL — LOWER NOSE'; alert.hidden = false;
      const a = alert.getBoundingClientRect(), p = document.getElementById('ap-panel').getBoundingClientRect();
      const result = { top: a.top, bottom: a.bottom, panelTop: p.top, toolbarBottom: document.querySelector('.flight-toolbar').getBoundingClientRect().bottom };
      alert.hidden = true;
      return result;
    });
    assert.ok(warning.top >= warning.toolbarBottom + 4 && warning.panelTop >= warning.bottom + 4, `urgent warning clears toolbar and AP: ${JSON.stringify(warning)}`);
    await click('#btn-ap');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert.ok(await evaluate('document.getElementById("ap-panel").hidden && document.body.dataset.flow === "flight"'), 'Escape closes AP without pausing');
    await click('#btn-fullscreen');
    await delay(150);
    assert.ok(await evaluate('Boolean(document.fullscreenElement)'), 'native click enters fullscreen');
    await screenshot(`${out}/${width}x${height}-fullscreen.png`);
    await click('#btn-fullscreen');
    await delay(150);
    assert.ok(await evaluate('!document.fullscreenElement'), 'native click exits fullscreen');
    await click('#open-flight-more');
    assert.equal(await evaluate('document.querySelector("#flight-more-panel button").id'), 'flight-trim-less', 'trim is the first overflow action');
    const trim = await evaluate('window.simulator.aero.pitchTrim');
    await click('#flight-trim-more');
    assert.ok(Math.abs(await evaluate('window.simulator.controls.pitchTrim') - trim - .2) < .001, 'trim');
    await click('#flight-park-brake');
    assert.ok(await evaluate('window.simulator.controls.parkingBrake'), 'parking brake');
    await click('#flight-park-brake');
    await screenshot(`${out}/${width}x${height}-more.png`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert.ok(await evaluate('document.getElementById("flight-more-panel").hidden && document.body.dataset.flow === "flight"'), 'Escape closes more without pausing');
    const muted = await evaluate('window.simulator.audio.isMuted');
    await click('#btn-mute');
    assert.equal(await evaluate('window.simulator.audio.isMuted'), !muted, 'mute');
    await click('#btn-mute');
    if (touch) {
      for (const [selector, expression] of [
        ['#touch-rudder-track', 'window.simulator.controls.touchRudder'],
        ['#touch-stick-zone', 'window.simulator.controls.touchAileron'],
      ]) {
        const r = await evaluate(selector => document.querySelector(selector).getBoundingClientRect().toJSON(), selector);
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width * .8, y: r.y + r.height / 2 }] });
        assert.ok(await evaluate(expression) > .2, `${selector} remains uncovered and responds`);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await evaluate(expression), 0, `${selector} centers on release`);
      }
    }
    await evaluate(() => { window.simulator.demoDirector.start('coastal'); window.simulator.cameraSystem.setMode(1); window.simulator.updateHUD(); });
    await delay(150);
    const demo = await evaluate(() => {
      const b = document.getElementById('demo-banner').getBoundingClientRect(), t = document.querySelector('.flight-toolbar').getBoundingClientRect();
      return { top: b.top, toolbarBottom: t.bottom, width: b.width, locked: document.getElementById('btn-gear').disabled && document.getElementById('flight-trim-more').disabled };
    });
    assert.ok(demo.width && demo.top >= demo.toolbarBottom + 4 && demo.locked, `demo clearance and lockout: ${JSON.stringify(demo)}`);
    await screenshot(`${out}/${width}x${height}-demo.png`);
    // Both the expanded and collapsed guide must yield to a warning without
    // taking the primary takeover action with them.
    await evaluate(() => {
      const s = window.simulator;
      s.telemetry.warnings = [{ text: 'BANK ANGLE', priority: 50 }];
      s.updateHUD();
    });
    await evaluate(() => window.simulator.demoDirector.closeBanner());
    await screenshot(`${out}/${width}x${height}-warning-takeover.png`);
    await click('#btn-skip-demo');
    await evaluate(() => { window.simulator.telemetry.warnings = []; window.simulator.updateHUD(); });
    assert.ok(await evaluate('!window.simulator.demoDirector.isActive'), 'take control is reachable');
    results.push({ width, height, cameraModes: 8, bounds: baseline, demo });
    console.log(`${width}x${height}: camera parity, AP, more, trim/brake, mute and demo passed`);
  }
  // Preserve HUD selection across aircraft resets and menu transitions.
  for (const aircraft of ['C172', 'F16', 'B738']) {
    await evaluate(aircraft => {
      const s = window.simulator;
      s.controls.onSelectCamera(8); s.setAircraft(aircraft); s.setPreset('runway');
    }, aircraft);
    assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 8);
  }
  await evaluate(() => window.simulator.gameFlow.returnToLobby(true));
  assert.equal(await evaluate('getComputedStyle(document.getElementById("hud-view")).display'), 'none');
  await evaluate(() => { window.simulator.gameFlow.enterFlight(); window.simulator.updateHUD(); });
  assert.notEqual(await evaluate('getComputedStyle(document.getElementById("hud-view")).display'), 'none');
  // Reproduce the user's F16 Sihwa-demo portrait screen with the new controls.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 660, mobile: true, deviceScaleFactor: 1 });
  await evaluate(async () => {
    const s = window.simulator;
    s.setAircraft('F16'); await s.setAirport('incheon');
    s.demoDirector.start('incheon', 'sihwa-tour');
    s.controls.onSelectCamera(1);
    document.getElementById('lobby-lang-ko').click();
  });
  await delay(500);
  await screenshot(`${out}/390x660-f16-sihwa-demo-ko.png`);
  await click('#btn-skip-demo');
  assert.ok(await evaluate('!window.simulator.demoDirector.isActive'), 'Korean take-control in Sihwa demo');
  assert.deepEqual(exceptions, [], 'no browser exceptions');
  await writeFile(`${out}/results.json`, JSON.stringify({ gpu, results }, null, 2));
});
