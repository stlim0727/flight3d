import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

// Start Vite and an isolated Chrome with CDP first; see review-artifacts/issue92/README.md.
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9492';
const url = process.env.SIM_URL || 'http://127.0.0.1:5192/';
const target = (await (await fetch(`${cdp}/json`)).json()).find(t => t.type === 'page');
assert.ok(target, 'Chrome has a page target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(message.error);
  else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(requestId, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function ev(expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(() => { return eval(${JSON.stringify(expression)}); })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw result.exceptionDetails;
  return result.result.value;
}
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
const token = String(Date.now());
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__responsiveVerificationToken = ${JSON.stringify(token)}` });
await send('Page.navigate', { url });
for (let n = 0; n < 120; n++) {
  if (await ev(`window.__responsiveVerificationToken === ${JSON.stringify(token)} && !!window.simulator`)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(await ev(`window.__responsiveVerificationToken === ${JSON.stringify(token)} && !!window.simulator`), 'new simulator initialized');
const out = path.resolve(process.env.ARTIFACT_DIR || 'review-artifacts/issue92');
fs.mkdirSync(out, { recursive: true });
const results = [];
const layouts = [
  ['portrait-small', 320, 568, true],
  ['portrait', 390, 844, true],
  ['portrait-short', 320, 480, true],
  ['landscape-small', 568, 320, true],
  ['landscape', 844, 390, true],
  ['desktop', 1440, 900, false],
  ['desktop-narrow', 800, 700, false],
  ['desktop-small', 1025, 700, false],
  ['tablet-touch', 1280, 800, true],
  ['desktop-touch-enabled', 1440, 900, false, true],
];
for (const [name, width, height, touch, showTouch = touch] of layouts) {
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
  await ev(`window.simulator.touchControls.${showTouch ? 'enable' : 'disable'}()`);
  await new Promise(resolve => setTimeout(resolve, 400));
  const bounds = await ev(`(() => {
    const selectors = '.flight-toolbar button,.hud-strip,.hud-details,.touch-throttle-card,.touch-stick-card,.touch-rudder-card,#touch-btn-brake';
    return [...document.querySelectorAll(selectors)]
      .filter(node => node.getBoundingClientRect().width && getComputedStyle(node).visibility !== 'hidden')
      .map(node => {
        const r = node.getBoundingClientRect();
        return { id: node.id || node.className, x: r.x, y: r.y, w: r.width, h: r.height,
          bad: r.x < -.5 || r.y < -.5 || r.right > innerWidth + .5 || r.bottom > innerHeight + .5 };
      });
  })()`);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, 'base64')));
  await ev(`document.querySelector('#open-environment').click()`);
  const panel = await ev(`(() => {
    const p = document.querySelector('#panel-environment');
    const body = p.querySelector('.flight-panel-body');
    document.querySelector('#btn-sound').click();
    document.querySelector('#btn-sound').click();
    body.scrollTop = 999;
    const close = p.querySelector('.panel-close').getBoundingClientRect();
    return { open: !p.hidden, scroll: body.scrollTop, scrollable: body.scrollHeight > body.clientHeight,
      closeVisible: close.y >= 0 && close.bottom <= innerHeight, panelBottom: p.getBoundingClientRect().bottom,
      bodyTouch: getComputedStyle(body).touchAction,
      hitTargets: [...p.querySelectorAll('button, select')].flatMap(node => {
        const r = node.getBoundingClientRect();
        const clip = node.closest('.flight-panel-body')?.getBoundingClientRect() || p.getBoundingClientRect();
        const y = r.top + r.height / 2;
        if (!r.width || !r.height || y <= clip.top || y >= clip.bottom) return [];
        return [r.left + 8, r.left + r.width / 2, r.right - 8].map(x => {
          const hit = document.elementFromPoint(x, y);
          return { id: node.id || node.className, x, y, reachable: node.contains(hit),
            hit: hit?.id || hit?.className || hit?.tagName };
        });
      }) };

  })()`);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/${name}-settings.png`, Buffer.from(r.data, 'base64')));
  for (let a = 0; a < bounds.length; a++) {
    for (let b = a + 1; b < bounds.length; b++) {
      const x = bounds[a], y = bounds[b];
      const overlap = Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x) > .5 &&
        Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y) > .5;
      assert.equal(overlap, false, `${name}: ${x.id} overlaps ${y.id}`);
    }
  }
  assert.ok(bounds.every(b => !b.bad), `${name}: primary controls are in bounds`);
  assert.ok(panel.open && panel.closeVisible && panel.bodyTouch === 'pan-y', `${name}: volume panel remains open with reachable close`);
  assert.ok(panel.hitTargets.length > 0, `${name}: visible settings controls were hit-tested`);
  assert.ok(panel.hitTargets.every(hit => hit.reachable), `${name}: settings obscured: ${JSON.stringify(panel.hitTargets.filter(hit => !hit.reachable))}`);
  if (showTouch && width > 1024) {
    const point = await ev(`(()=>{const r=document.querySelector('#btn-help').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await ev(`document.querySelector('#help-modal').classList.contains('visible')`), `${name}: native input reaches Flight guide above the yoke`);
    panel.nativeGuideClick = true;
    await ev(`document.querySelector('#btn-help-close').click()`);
  } else {
    await ev(`document.querySelector('#panel-environment .panel-close').click()`);
  }
  results.push({ name, width, height, touch, showTouch, bounds, panel });
}
console.log(`${results.length} viewport/input layouts passed`);
fs.writeFileSync(`${out}/layout-results.json`, JSON.stringify(results, null, 2));

await ev(`document.querySelector('#open-instruments').click()`);
assert.equal(await ev(`!document.querySelector('#panel-instruments').hidden && [...document.querySelectorAll('#panel-instruments .hud-item')].length === 6`), true, 'secondary instruments use a separate panel');
assert.ok(await ev(`(()=>{const panel=document.querySelector('#panel-instruments').getBoundingClientRect();const toolbar=document.querySelector('.flight-toolbar').getBoundingClientRect();return panel.bottom <= toolbar.top || panel.top >= toolbar.bottom})()`), 'instruments do not crowd toolbar');
await ev(`document.querySelector('#panel-instruments .panel-close').click()`);
// Exercise the same live controls after resizing, using native input for gestures and keys.
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setDeviceMetricsOverride', { width: 568, height: 320, deviceScaleFactor: 1, mobile: true });
await ev(`window.simulator.demoDirector.stop(); window.simulator.setPreset('runway'); window.simulator.touchControls.enable(); document.activeElement?.blur()`);
await new Promise(r => setTimeout(r, 200));
await ev(`document.querySelector('#open-aircraft').click(); document.querySelector('#btn-flaps-ext').click(); document.querySelector('#btn-flaps-ext').click()`);
assert.equal(await ev(`!document.querySelector('#panel-aircraft').hidden && window.simulator.aero.flapsIndex === 4`), true, 'repeated flap changes keep Aircraft open');
await ev(`document.querySelector('#panel-aircraft .panel-close').click(); document.querySelector('#open-camera').click(); const select = document.querySelector('#camera-select'); select.value = '6'; select.dispatchEvent(new Event('change'))`);
assert.equal(await ev('window.simulator.cameraSystem.mode'), 6, 'direct camera selection');
await ev('document.activeElement?.blur()');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
await new Promise(r => setTimeout(r, 150));
assert.equal(await ev(`document.querySelector('#camera-select').value`), '1', 'keyboard camera state appears in selector');
await ev(`document.querySelector('#panel-camera .panel-close').click(); document.querySelector('#open-flight').click(); document.querySelector('#btn-preset-rwy').click()`);
assert.equal(await ev(`document.querySelector('#panel-flight').hidden`), true, 'preset closes Flight settings');
await ev(`document.querySelector('#open-environment').click(); document.querySelector('#panel-environment .flight-panel-body').scrollTop = 0`);
const before = await ev(`(()=>{const r=document.querySelector('#panel-environment .flight-panel-body').getBoundingClientRect();const c=window.simulator.cameraSystem;return {x:r.x+6,y:r.bottom-12,yaw:c.chaseYaw,pitch:c.chasePitch}})()`);
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x, y: before.y }] });
for (let n = 1; n <= 8; n++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.x, y: before.y - n * 10 }] });
  await new Promise(r => setTimeout(r, 30));
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await new Promise(r => setTimeout(r, 200));
const after = await ev(`(()=>{const c=window.simulator.cameraSystem;return {scroll:document.querySelector('#panel-environment .flight-panel-body').scrollTop,yaw:c.chaseYaw,pitch:c.chasePitch}})()`);
assert.ok(after.scroll > 0, 'native touch gesture scrolls panel');
assert.equal(after.yaw, before.yaw, 'panel scroll leaves camera yaw unchanged');
assert.equal(after.pitch, before.pitch, 'panel scroll leaves camera pitch unchanged');
await ev(`document.querySelector('#btn-touch-toggle').click()`);
assert.equal(await ev('window.simulator.touchControls.enabled'), false, 'touch mode can be disabled from shared settings');
await ev(`document.querySelector('#btn-touch-toggle').click(); const language = document.querySelector('#language-select'); language.value = 'ko'; language.dispatchEvent(new Event('change'))`);
await new Promise(r => setTimeout(r, 100));
assert.equal(await ev(`document.querySelector('#open-environment').textContent`), '환경 설정', 'language change refreshes panel labels');
assert.equal(await ev(`!document.querySelector('#panel-environment').hidden`), true, 'language change retains open panel');
await ev(`document.querySelector('#panel-environment .panel-close').click(); document.querySelector('#open-aircraft').click()`);
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
await new Promise(r => setTimeout(r, 150));
assert.equal(await ev(`!document.querySelector('#panel-aircraft').hidden`), true, 'rotation retains Aircraft panel');
await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/portrait-aircraft-ko.png`, Buffer.from(r.data, 'base64')));
await ev(`document.querySelector('#panel-aircraft .panel-close').click(); const language = document.querySelector('#language-select'); language.value = 'en'; language.dispatchEvent(new Event('change'))`);
fs.writeFileSync(`${out}/interaction-results.json`, JSON.stringify({ repeatedFlaps: true, directCamera: true, keyboardCamera: true, presetClosesPanel: true, nativeTouchScroll: after, cameraBefore: before, touchModeToggle: true, languageChange: true, rotation: true }, null, 2));
console.log('Interaction scenarios passed');

await ev(`window.simulator.controls.onSelectCamera(7); document.querySelector('#open-instruments').click()`);
await new Promise(r => setTimeout(r, 100));
assert.ok(await ev(`document.querySelector('#hud-cam').scrollWidth <= document.querySelector('#hud-cam').clientWidth + 1`), 'long auto-camera readout wraps inside compact panel');
assert.ok(await ev(`(()=>{const panel=document.querySelector('#panel-instruments').getBoundingClientRect();const toolbar=document.querySelector('.flight-toolbar').getBoundingClientRect();return panel.top >= toolbar.bottom && panel.bottom <= innerHeight})()`), 'compact instruments do not overlap toolbar or leave viewport');
await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/portrait-instruments.png`, Buffer.from(r.data, 'base64')));
await ev(`document.querySelector('#panel-instruments .panel-close').click()`);
// Simulate reserved notch/home-indicator space; physical browser chrome still needs device testing.
await ev(`document.body.style.setProperty('--edge-left', '18px'); document.body.style.setProperty('--edge-right', '18px'); document.body.style.setProperty('--edge-top', '24px'); document.body.style.setProperty('--edge-bottom', '32px')`);
await new Promise(r => setTimeout(r, 100));
const safeArea = await ev(`(()=>{const ids = ['.flight-toolbar', '.hud-strip', '.hud-details', '.touch-throttle-card', '.touch-stick-card', '.touch-rudder-card', '#touch-btn-brake'];return ids.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})})()`);
assert.ok(safeArea.every(r => r.left >= 17.5 && r.right <= 302.5 && r.top >= 23.5 && r.bottom <= 536.5), `controls respect simulated safe-area edges: ${JSON.stringify(safeArea)}`);
await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/safe-area-portrait.png`, Buffer.from(r.data, 'base64')));
fs.writeFileSync(`${out}/safe-area-results.json`, JSON.stringify(safeArea, null, 2));
await ev(`for (const edge of ['left','right','top','bottom']) document.body.style.removeProperty('--edge-'+edge)`);
console.log('Simulated safe-area bounds passed');

assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
ws.close();
