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
async function nativeClick(selector, touch) {
  const point = await ev(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}); if(node.closest('.flight-toolbar, .ap-panel')) node.scrollIntoView({block:'nearest',inline:'nearest'}); const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  await new Promise(resolve => setTimeout(resolve, 150));
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
// Integration regression: the merged #104 removed the quality select before initUI.
assert.deepEqual(exceptions, [], 'startup has no uncaught exceptions');
assert.ok(await ev(`document.querySelector('#lobby-settings #render-quality') && !document.querySelector('#open-environment')`), 'settings initialize inside the main menu, not the flight toolbar');
const frameBefore = await ev('window.simulator.renderer.info.render.frame');
for (let n = 0; n < 60; n++) {
  if (await ev('window.simulator.renderer.info.render.frame') > frameBefore) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(await ev('window.simulator.renderer.info.render.frame') > frameBefore, 'animation renders frames after startup');
const originalQuality = await ev('window.simulator.renderQuality');
await ev(`const select = document.querySelector('#render-quality'); select.value = 'performance'; select.dispatchEvent(new Event('change'))`);
assert.equal(await ev('window.simulator.renderQuality'), 'performance', 'quality control remains wired');
await ev(`window.simulator.setRenderQuality(${JSON.stringify(originalQuality)})`);
assert.equal(await ev(`document.querySelectorAll('.hud-strip .hud-item').length`), 10, 'every readout lives in the top strip');
assert.equal(await ev(`!document.querySelector('.hud-details') && !document.querySelector('#panel-instruments')`), true, 'the instruments trigger and drawer are gone');
const out = path.resolve(process.env.ARTIFACT_DIR || 'review-artifacts/issue92');
fs.mkdirSync(out, { recursive: true });
const results = [];
const layouts = [
  ['portrait-small', 320, 568, true],
  ['portrait', 390, 844, true],
  ['portrait-short', 320, 480, true],
  ['portrait-tiny', 320, 400, true],
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
    const selectors = '.flight-toolbar,.hud-strip,.touch-throttle-card,.touch-stick-card,.touch-rudder-card,#touch-btn-brake,#menu-toggle,.ap-bar';
    return [...document.querySelectorAll(selectors)]
      .filter(node => node.getBoundingClientRect().width && getComputedStyle(node).visibility !== 'hidden')
      .map(node => {
        const r = node.getBoundingClientRect();
        return { id: node.id || node.className, x: r.x, y: r.y, w: r.width, h: r.height,
          bad: r.x < -.5 || r.y < -.5 || r.right > innerWidth + .5 || r.bottom > innerHeight + .5 };
      });
  })()`);
  const cells = await ev(`(() => {
    const items = [...document.querySelectorAll('.hud-strip .hud-item')];
    const clipped = items.map(item => {
      const box = item.getBoundingClientRect();
      const text = [...item.querySelectorAll('.hud-label, .hud-val')].map(n => n.getBoundingClientRect());
      return { id: item.querySelector('[id]').id, cell: +box.width.toFixed(1),
        text: +Math.max(...text.map(r => r.width)).toFixed(1),
        bad: text.some(r => r.left < box.left - .5 || r.right > box.right + .5) };
    }).filter(c => c.bad);
    return { rows: new Set(items.map(i => Math.round(i.getBoundingClientRect().top))).size, clipped };
  })()`);
  assert.equal(cells.rows, 1, `${name}: the flattened strip renders on one row`);
  assert.deepEqual(cells.clipped, [], `${name}: telemetry text fits each cell`);
  const direct = await ev(`(() => {
    const strip = document.querySelector('.flight-toolbar').getBoundingClientRect();
    const home = document.querySelector('#menu-toggle').getBoundingClientRect();
    const ap = document.querySelector('.ap-bar').getBoundingClientRect();
    return { stripButtons: [...document.querySelectorAll('.flight-toolbar button')].map(b => b.id),
      rows: new Set([...document.querySelectorAll('.flight-toolbar button')].map(b => Math.round(b.getBoundingClientRect().top))).size,
      buttons: [...document.querySelectorAll('.flight-toolbar button:not(#open-camera):not(#btn-mute)')].map(node => {
      const r = node.getBoundingClientRect();
      return { id: node.id, reachable: node.contains(document.elementFromPoint(r.left+r.width/2, r.top+r.height/2)), height: r.height };
    }), collapsed: document.querySelector('#btn-ap-toggle').getAttribute('aria-expanded') === 'false',
      anchor: ap.toJSON(), telemetryGap: strip.top - document.querySelector('.hud-strip').getBoundingClientRect().bottom, apGap: ap.top - strip.bottom, homeGap: home.top - strip.bottom, homeTarget: home.width >= 44 && home.height >= 44, alignedEdges: Math.abs(home.left - strip.left) < 1 && Math.abs(ap.right - strip.right) < 1 };
  })()`);
  assert.deepEqual(direct.stripButtons, ['open-camera', 'btn-mute', 'btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser'], `${name}: one strip in the requested order`);
  assert.equal(direct.rows, 1, `${name}: controls stay on one concise row`);
  assert.equal(direct.buttons.length, 5, `${name}: all Aircraft controls are flattened`);
  assert.ok(direct.buttons.every(b => b.reachable && b.height >= 44), `${name}: all Aircraft controls have reachable 44px targets`);
  assert.ok(direct.collapsed && direct.homeTarget && direct.alignedEdges && Math.abs(direct.telemetryGap - 4) < 1 && Math.abs(direct.apGap - 4) < 1 && Math.abs(direct.homeGap - 4) < 1, `${name}: upper strips and Home/AP use 4px gaps: ${JSON.stringify(direct)}`);
  await nativeClick('#btn-ap-toggle', touch);
  assert.equal(await ev(`document.querySelector('#btn-ap-toggle').getAttribute('aria-expanded')`), 'true', `${name}: native tap expands AP`);
  const expanded = await ev(`(() => {
    const trigger = document.querySelector('#btn-ap-toggle').getBoundingClientRect();
    const panel = document.querySelector('#ap-panel').getBoundingClientRect();
    const toolbarTargets = [...document.querySelectorAll('.flight-toolbar button')].map(node => {
      const r = node.getBoundingClientRect();
      return { id: node.id, reachable: node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) };
    });
    const touchTargets = ['#touch-btn-brake', '.touch-stick-zone', '.touch-rudder-track', '.touch-throttle-track'].map(selector => {
      const node = document.querySelector(selector), r = node.getBoundingClientRect();
      return { selector, reachable: node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) };
    });
    const targets = [...document.querySelectorAll('#ap-panel button')].map(node => {
      node.scrollIntoView({block:'nearest'});
      const r = node.getBoundingClientRect();
      return { id: node.id, width: r.width, height: r.height,
        reachable: node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) };
    });
    document.querySelector('#ap-panel').scrollTop = 0;
    return { trigger: trigger.toJSON(), panel: panel.toJSON(), visible: !document.querySelector('#ap-panel').hidden, toolbarTargets, touchTargets, targets };
  })()`);
  assert.ok(expanded.visible && Math.abs(expanded.trigger.x - direct.anchor.x) < 1 && Math.abs(expanded.trigger.y - direct.anchor.y) < 1, `${name}: AP trigger stays fixed when expanded`);
  const panelRightAligned = name === 'landscape-small'
    ? Math.abs(expanded.panel.right - (width - 8)) < 1
    : Math.abs(expanded.panel.right - expanded.trigger.right) < 1;
  assert.ok(panelRightAligned && Math.abs(expanded.panel.top - expanded.trigger.bottom - 4) < 1, `${name}: AP panel opens 4px below in its safe-area alignment`);
  assert.ok(expanded.toolbarTargets.every(b => b.reachable), `${name}: toolbar controls remain reachable while AP is expanded: ${JSON.stringify(expanded.toolbarTargets)}`);
  if (name === 'landscape-small') assert.ok(expanded.touchTargets.every(target => target.reachable), `${name}: touch brake, stick, rudder and throttle remain reachable while AP is expanded: ${JSON.stringify(expanded.touchTargets)}`);
  assert.ok(expanded.panel.left >= 0 && expanded.panel.bottom <= height && expanded.targets.length === 5 && expanded.targets.every(b => b.reachable && b.width >= 44 && b.height >= 44), `${name}: all expanded AP controls fit and are reachable`);
  await nativeClick('#btn-ap', touch);
  assert.ok(await ev(`window.simulator.autopilot.master && document.querySelector('#btn-ap-toggle').classList.contains('ap-active') && !document.querySelector('#ap-panel').hidden`), `${name}: native master toggle keeps panel open and trigger green`);
  if (name === 'landscape-small') {
    const activeTouchTargets = await ev(`['#touch-btn-brake', '.touch-stick-zone', '.touch-rudder-track', '.touch-throttle-track'].map(selector => { const node=document.querySelector(selector),r=node.getBoundingClientRect();return {selector,reachable:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))} })`);
    assert.ok(activeTouchTargets.every(target => target.reachable), `${name}: touch flight controls remain reachable with active AP modes: ${JSON.stringify(activeTouchTargets)}`);
  }
  await nativeClick('#btn-ap-hdg', touch);
  assert.equal(await ev('window.simulator.autopilot.lateralMode'), 'HDG', `${name}: native heading mode works from dropdown`);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/${name}-ap-expanded.png`, Buffer.from(r.data, 'base64')));
  await nativeClick('#btn-ap', touch);
  assert.equal(await ev('window.simulator.autopilot.master'), false, `${name}: native master toggle disengages AP`);
  direct.expanded = expanded;
  await nativeClick('#btn-ap-toggle', touch);
  assert.equal(await ev(`document.querySelector('#btn-ap-toggle').getAttribute('aria-expanded')`), 'false', `${name}: native tap collapses AP`);
  await nativeClick('#btn-ap-toggle', touch);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.ok(await ev(`document.querySelector('#ap-panel').hidden && document.body.dataset.flow === 'flight'`), `${name}: Escape closes AP without pausing flight`);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, 'base64')));
  await ev(`document.querySelector('#menu-toggle').click()`);
  const panel = await ev(`(() => {
    const card = document.querySelector('.lobby-card');
    const settings = document.querySelector('#lobby-settings');
    document.querySelector('#btn-sound').click();
    document.querySelector('#btn-sound').click();
    card.scrollTop = 999;
    const fly = document.querySelector('#btn-fly').getBoundingClientRect();
    return { open: document.body.dataset.flow === 'lobby', scroll: card.scrollTop, scrollable: card.scrollHeight > card.clientHeight,
      flyVisible: fly.y >= 0 && fly.bottom <= innerHeight, settingsBottom: settings.getBoundingClientRect().bottom,
      cardTouch: getComputedStyle(card).touchAction,
      hitTargets: [...settings.querySelectorAll('button, select')].flatMap(node => {
        const r = node.getBoundingClientRect();
        const clip = card.getBoundingClientRect();
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
  if (showTouch && (width <= 600 || (width <= 1024 && height <= 500))) {
    const controlsTop = Math.min(...bounds.filter(b => ['touch-throttle-card', 'touch-stick-card', 'touch-rudder-card', 'touch-btn-brake'].includes(b.id)).map(b => b.y));
    assert.ok(height - controlsTop <= 150, `${name}: compact controls occupy at most the bottom 150px`);
    panel.controlBandHeight = height - controlsTop;
  }
  assert.ok(bounds.every(b => !b.bad), `${name}: primary controls are in bounds`);
  assert.ok(panel.open && panel.flyVisible && panel.cardTouch === 'pan-y', `${name}: settings menu stays open with a scrollable card`);
  assert.ok(panel.hitTargets.length > 0, `${name}: visible settings controls were hit-tested`);
  assert.ok(panel.hitTargets.every(hit => hit.reachable), `${name}: settings obscured: ${JSON.stringify(panel.hitTargets.filter(hit => !hit.reachable))}`);
  if (showTouch && width > 1024) {
    await nativeClick('#btn-help', touch);
    assert.ok(await ev(`document.querySelector('#help-modal').classList.contains('visible')`), `${name}: native input reaches Flight guide from the menu`);
    panel.nativeGuideClick = true;
    await ev(`document.querySelector('#btn-help-close').click()`);
  }
  await ev(`document.querySelector('#btn-diag').scrollIntoView({block: 'center'})`);
  await nativeClick('#btn-diag', touch);
  assert.ok(await ev(`document.querySelector('#diagnostics-panel').classList.contains('visible') && document.body.dataset.flow === 'lobby'`), `${name}: Physics opens over the menu`);
  assert.ok(await ev(`(() => {
    const node = document.querySelector('#diag-close');
    const r = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })()`), `${name}: inspector close is reachable above menu`);
  await nativeClick('#diag-close', touch);
  assert.equal(await ev(`document.querySelector('#diagnostics-panel').classList.contains('visible')`), false, `${name}: native input closes inspector`);
  await ev(`document.querySelector('#menu-toggle').click()`);
  if (showTouch) {
    assert.ok(await ev(`window.simulator.audio.volume <= 1 && window.simulator.audio.getVolumeState().level <= 1`), `${name}: audio has no boost modes`);
    const nextCamera = await ev(`(()=>{const c=window.simulator.cameraSystem;return ((c.autoSwitch ? 7 : (c.savedMode ?? c.mode)) + 1) % 8})()`);
    await nativeClick('#open-camera', touch);
    assert.equal(await ev(`window.simulator.cameraSystem.mode`), nextCamera, `${name}: toolbar camera button cycles views`);
    assert.equal(await ev(`!document.querySelector('#panel-camera')`), true, `${name}: no camera panel opens`);
    await ev(`window.simulator.cameraSystem.setMode(0, true); window.simulator.audio.setVolume(1.0); window.simulator.updateAudioUI()`);
    const muteTarget = await ev(`(()=>{const node=document.querySelector('#btn-mute'),r=node.getBoundingClientRect();return {width:r.width,height:r.height,reachable:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);
    assert.ok(muteTarget.width >= 44 && muteTarget.height >= 44 && muteTarget.reachable, `${name}: mute has a reachable 44px touch target`);
    await nativeClick('#btn-mute', touch);
    assert.ok(await ev(`window.simulator.audio.isMuted && window.simulator.audio.effectiveVolume === 0 && document.querySelector('#btn-mute').getAttribute('aria-pressed') === 'true' && document.querySelector('#btn-sound').classList.contains('muted')`), `${name}: one tap mutes and synchronizes settings`);
    if (name === 'portrait-small') await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/portrait-small-muted.png`, Buffer.from(r.data, 'base64')));
    await nativeClick('#btn-mute', touch);
    assert.ok(await ev(`!window.simulator.audio.isMuted && window.simulator.audio.volume === 1.0 && document.querySelector('#btn-mute').getAttribute('aria-pressed') === 'false'`), `${name}: one tap unmutes and restores normal volume`);
    panel.quickCamera = true;
    panel.oneTapMute = true;
    panel.restoresVolume = true;
  }
  console.log(`${name}: layout, telemetry and inspector passed`);
  results.push({ name, width, height, touch, showTouch, bounds, cells, direct, panel });
}
console.log(`${results.length} viewport/input layouts passed`);
fs.writeFileSync(`${out}/layout-results.json`, JSON.stringify(results, null, 2));

await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await ev(`window.simulator.touchControls.disable(); window.simulator.demoDirector.start(); window.simulator.demoDirector.closeBanner()`);
await new Promise(resolve => setTimeout(resolve, 2800));
const demoPill = await ev(`(()=>{const node=document.querySelector('#btn-demo-open'),r=node.getBoundingClientRect(),t=document.querySelector('.flight-toolbar').getBoundingClientRect();return {visible:getComputedStyle(node).display!=='none',top:r.top,toolbarBottom:t.bottom,reachable:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);
assert.ok(demoPill.visible && demoPill.top >= demoPill.toolbarBottom + 4 && demoPill.reachable, `desktop: demo reopen pill is clear and reachable below toolbar: ${JSON.stringify(demoPill)}`);
await nativeClick('#btn-demo-open', false);
assert.ok(await ev(`getComputedStyle(document.querySelector('#demo-banner')).display!=='none' && getComputedStyle(document.querySelector('#btn-demo-open')).display==='none'`), 'desktop: demo guide reopens from its pill');
await ev(`window.simulator.demoDirector.stop()`);
await nativeClick('#btn-ap-toggle', false);
await nativeClick('#btn-ap', false);
await nativeClick('#btn-ap-hdg', false);
await ev(`document.querySelector('#hud-stall').style.display='block'`);
const stallWarning = await ev(`(()=>{const node=document.querySelector('#hud-stall'),r=node.getBoundingClientRect(),t=document.querySelector('.flight-toolbar').getBoundingClientRect(),p=document.querySelector('#ap-panel').getBoundingClientRect();return {top:r.top,bottom:r.bottom,toolbarBottom:t.bottom,panelBottom:p.bottom,reachable:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),height:r.height,modes:document.querySelector('#hud-ap-modes').textContent}})()`);
assert.ok(stallWarning.top >= stallWarning.toolbarBottom + 4 && stallWarning.top >= stallWarning.panelBottom + 4 && stallWarning.reachable && stallWarning.height > 0 && stallWarning.modes, `desktop: stall warning sits below expanded AP modes and remains reachable: ${JSON.stringify(stallWarning)}`);
await ev(`document.querySelector('#hud-stall').style.display='none'`);
await nativeClick('#btn-ap', false);
await nativeClick('#btn-ap-toggle', false);
console.log('Desktop demo pill and stall alert reachability passed');

const strip = await ev(`(() => {
  const items = [...document.querySelectorAll('.hud-strip .hud-item')];
  const s = document.querySelector('.hud-strip').getBoundingClientRect();
  const t = document.querySelector('.flight-toolbar').getBoundingClientRect();
  return { items: items.length, rows: new Set(items.map(i => Math.round(i.getBoundingClientRect().top))).size,
    crowdsToolbar: !(s.bottom <= t.top + .5 || s.top >= t.bottom - .5) };
})()`);
assert.equal(strip.items, 10, 'all ten readouts render in the top strip');
assert.equal(strip.rows, 1, 'the flattened readouts stay on one row');
assert.equal(strip.crowdsToolbar, false, 'the strip does not crowd the toolbar');
// Exercise the same live controls after resizing, using native input for gestures and keys.
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setDeviceMetricsOverride', { width: 568, height: 320, deviceScaleFactor: 1, mobile: true });
await ev(`window.simulator.demoDirector.stop(); window.simulator.gameFlow.enterFlight(); window.simulator.setPreset('runway'); window.simulator.touchControls.enable(); document.activeElement?.blur()`);
await new Promise(r => setTimeout(r, 200));
await nativeClick('#btn-flaps-ext', true);
await nativeClick('#btn-flaps-ext', true);
assert.equal(await ev(`!document.querySelector('#panel-aircraft') && !document.querySelector('#open-aircraft') && window.simulator.aero.flapsIndex === 4`), true, 'repeated native flap changes work directly without a drawer');
await nativeClick('#btn-ap-toggle', true);
await nativeClick('#open-camera', true);
assert.ok(await ev(`document.querySelector('#ap-panel').hidden`), 'native outside tap closes AP while camera remains usable');
const cycleFrom = await ev(`window.simulator.cameraSystem.mode`);
await ev(`document.querySelector('#open-camera').click(); document.querySelector('#open-camera').click()`);
assert.equal(await ev(`window.simulator.cameraSystem.mode`), (cycleFrom + 2) % 8, 'repeated toolbar taps keep cycling cameras');
await ev('document.activeElement?.blur()');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
await new Promise(r => setTimeout(r, 150));
assert.equal(await ev(`window.simulator.cameraSystem.mode`), 1, 'digit keys still select a camera directly');
assert.match(await ev(`document.querySelector('#open-camera').textContent`), /Chase/, 'keyboard camera state appears on the toolbar button');
await ev(`document.querySelector('#menu-toggle').click(); document.querySelector('.lobby-card').scrollTop = 0`);
const before = await ev(`(()=>{const r=document.querySelector('.lobby-card').getBoundingClientRect();const c=window.simulator.cameraSystem;return {x:r.x+6,y:r.bottom-12,yaw:c.chaseYaw,pitch:c.chasePitch}})()`);
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x, y: before.y }] });
for (let n = 1; n <= 8; n++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.x, y: before.y - n * 10 }] });
  await new Promise(r => setTimeout(r, 30));
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await new Promise(r => setTimeout(r, 200));
const after = await ev(`(()=>{const c=window.simulator.cameraSystem;return {scroll:document.querySelector('.lobby-card').scrollTop,yaw:c.chaseYaw,pitch:c.chasePitch}})()`);
assert.ok(after.scroll > 0, 'native touch gesture scrolls the menu card');
assert.equal(after.yaw, before.yaw, 'menu scroll leaves camera yaw unchanged');
assert.equal(after.pitch, before.pitch, 'menu scroll leaves camera pitch unchanged');
await ev(`document.querySelector('#btn-touch-toggle').click()`);
assert.equal(await ev('window.simulator.touchControls.enabled'), false, 'touch mode can be disabled from shared settings');
await ev(`document.querySelector('#btn-touch-toggle').click(); document.querySelector('#lobby-lang-ko').click()`);
await new Promise(r => setTimeout(r, 100));
assert.equal(await ev(`document.querySelector('.lobby-settings .lobby-label').textContent`), '설정', 'language change refreshes menu settings labels');
assert.equal(await ev(`document.body.dataset.flow`), 'lobby', 'language change keeps the menu open');
await ev(`document.querySelector('#menu-toggle').click()`);
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
await new Promise(r => setTimeout(r, 150));
assert.equal(await ev(`document.querySelectorAll('.flight-toolbar button:not(#open-camera):not(#btn-mute)').length`), 5, 'rotation retains the five direct Aircraft controls');
await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/portrait-aircraft-ko.png`, Buffer.from(r.data, 'base64')));
await ev(`document.querySelector('#lobby-lang-en').click()`);
fs.writeFileSync(`${out}/interaction-results.json`, JSON.stringify({ repeatedFlaps: true, directCamera: true, keyboardCamera: true, demoClosesPanel: true, nativeTouchScroll: after, cameraBefore: before, touchModeToggle: true, languageChange: true, rotation: true }, null, 2));
console.log('Interaction scenarios passed');

await ev(`window.simulator.controls.onSelectCamera(7)`);
await new Promise(r => setTimeout(r, 100));
const hudRow = await ev(`(() => {
  const strip = document.querySelector('.hud-strip').getBoundingClientRect();
  const toolbar = document.querySelector('.flight-toolbar').getBoundingClientRect();
  const cam = document.querySelector('#hud-cam');
  const cell = cam.closest('.hud-item').getBoundingClientRect();
  return { rows: new Set([...document.querySelectorAll('.hud-strip .hud-item')].map(i => Math.round(i.getBoundingClientRect().top))).size,
    cameraText: cam.textContent, cellWidth: +cell.width.toFixed(1), textWidth: +cam.getBoundingClientRect().width.toFixed(1),
    inViewport: strip.left >= -.5 && strip.right <= innerWidth + .5,
    coversToolbar: !(strip.bottom <= toolbar.top + .5 || strip.top >= toolbar.bottom - .5) };
})()`);
fs.writeFileSync(`${out}/flattened-strip.json`, JSON.stringify(hudRow, null, 2));
assert.equal(hudRow.rows, 1, 'the compact strip keeps every readout on one row');
assert.equal(hudRow.inViewport, true, 'the compact strip stays inside the viewport');
assert.equal(hudRow.coversToolbar, false, 'the compact strip does not overlap the toolbar');
await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/portrait-hud-strip.png`, Buffer.from(r.data, 'base64')));
// Verify the smaller controls still accept real pointer input in both phone orientations.
const compactInputs = [];
for (const [width, height] of [[320, 568], [568, 320]]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await ev(`window.simulator.setPreset('runway'); window.simulator.controls.throttle = 0`);
  await new Promise(resolve => setTimeout(resolve, 150));
  async function drag(selector, from, to, expression) {
    const r = await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.left + r.width * from[0], y: r.top + r.height * from[1] }] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.left + r.width * to[0], y: r.top + r.height * to[1] }] });
    const held = await ev(expression);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return { held, released: await ev(expression) };
  }
  const throttle = await drag('#touch-throttle-track', [.5, .9], [.5, .1], 'window.simulator.controls.throttle');
  assert.ok(throttle.held > .8 && throttle.released > .8, 'small throttle responds and retains setting');
  const stick = await drag('#touch-stick-zone', [.5, .5], [.8, .2], '[window.simulator.controls.touchElevator, window.simulator.controls.touchAileron]');
  assert.ok(stick.held[0] < -.2 && stick.held[1] > .2, 'small stick responds on both axes');
  assert.deepEqual(stick.released, [0, 0], 'small stick centers after release');
  const rudder = await drag('#touch-rudder-track', [.5, .5], [.8, .5], 'window.simulator.controls.touchRudder');
  assert.ok(rudder.held > .2, 'small rudder responds');
  assert.equal(rudder.released, 0, 'rudder centers after release');
  const brake = await drag('#touch-btn-brake', [.5, .5], [.5, .5], 'window.simulator.controls.touchBrakes');
  assert.equal(brake.held, 1, 'small brake engages while held');
  assert.equal(brake.released, 0, 'small brake releases');
  compactInputs.push({ width, height, throttle, stick, rudder, brake });
}
fs.writeFileSync(`${out}/compact-input-results.json`, JSON.stringify(compactInputs, null, 2));
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
await ev('window.simulator.controls.throttle = 0');
await new Promise(resolve => setTimeout(resolve, 150));
console.log('Compact throttle, stick, rudder, and brake input passed');

// Simulate reserved notch/home-indicator space; physical browser chrome still needs device testing.
await ev(`document.body.style.setProperty('--edge-left', '18px'); document.body.style.setProperty('--edge-right', '18px'); document.body.style.setProperty('--edge-top', '24px'); document.body.style.setProperty('--edge-bottom', '32px')`);
await new Promise(r => setTimeout(r, 100));
const safeArea = await ev(`(()=>{const ids = ['.flight-toolbar', '.hud-strip', '.touch-throttle-card', '.touch-stick-card', '.touch-rudder-card', '#touch-btn-brake'];return ids.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})})()`);
assert.ok(safeArea.every(r => r.left >= 17.5 && r.right <= 302.5 && r.top >= 23.5 && r.bottom <= 536.5), `controls respect simulated safe-area edges: ${JSON.stringify(safeArea)}`);
await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/safe-area-portrait.png`, Buffer.from(r.data, 'base64')));
fs.writeFileSync(`${out}/safe-area-results.json`, JSON.stringify(safeArea, null, 2));
await ev(`for (const edge of ['left','right','top','bottom']) document.body.style.removeProperty('--edge-'+edge)`);
console.log('Simulated safe-area bounds passed');

// Review regressions: every readout remains reachable, and the inspector accepts
// tuning input while the main menu stays open.
const reviewResults = [];
for (const [width, height, touch] of [[320, 568, true], [568, 320, true], [1025, 700, false], [1440, 900, false]]) {
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
  await ev(`window.simulator.gameFlow.enterFlight(); document.querySelector('.hud-strip').scrollLeft = 0`);
  await new Promise(r => setTimeout(r, 200));
  const before = await ev(`(() => {
    const strip = document.querySelector('.hud-strip');
    const r = strip.getBoundingClientRect();
    const camera = window.simulator.cameraSystem;
    return { x: r.right - 20, y: r.top + r.height / 2, overflow: strip.scrollWidth > strip.clientWidth,
      yaw: camera.chaseYaw, pitch: camera.chasePitch };
  })()`);
  if (before.overflow && touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x, y: before.y }] });
    for (let n = 1; n <= 8; n++) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.x - n * 22, y: before.y }] });
      await new Promise(r => setTimeout(r, 30));
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await ev(`document.querySelector('.hud-strip').scrollLeft > 0`), 'native swipe scrolls telemetry');
    assert.equal(await ev('window.simulator.cameraSystem.chaseYaw'), before.yaw, 'telemetry swipe preserves camera yaw');
    assert.equal(await ev('window.simulator.cameraSystem.chasePitch'), before.pitch, 'telemetry swipe preserves camera pitch');
  }
  await ev(`document.querySelector('.hud-strip').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
  await new Promise(r => setTimeout(r, 400));
  const camera = await ev(`(() => {
    const strip = document.querySelector('.hud-strip');
    const s = strip.getBoundingClientRect(), c = document.querySelector('#hud-cam').getBoundingClientRect();
    return { end: strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1,
      visible: c.left >= s.left && c.right <= s.right, scrollLeft: strip.scrollLeft };
  })()`);
  assert.ok(camera.end && camera.visible, `keyboard End reaches the final camera readout: ${JSON.stringify(camera)}`);
  await ev(`document.querySelector('#menu-toggle').click(); document.querySelector('#btn-diag').scrollIntoView({block: 'center'})`);
  await nativeClick('#btn-diag', touch);
  await ev(`document.querySelector('#tune-elev').scrollIntoView({block: 'center'})`);
  const tuningBefore = await ev('window.simulator.aero.tuning.elevatorSensitivity');
  await nativeClick('#tune-elev', touch);
  const tuningAfter = await ev('window.simulator.aero.tuning.elevatorSensitivity');
  assert.notEqual(tuningAfter, tuningBefore, 'native input adjusts inspector tuning above the menu');
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(`${out}/inspector-${width}.png`, Buffer.from(r.data, 'base64')));
  await ev(`const slider = document.querySelector('#tune-elev'); slider.value = ${tuningBefore}; slider.dispatchEvent(new Event('input')); document.querySelector('#diag-close').scrollIntoView({block: 'center'})`);
  await nativeClick('#diag-close', touch);
  assert.equal(await ev(`document.querySelector('#diagnostics-panel').classList.contains('visible')`), false, 'scrolled inspector closes above the menu');
  await ev(`document.querySelector('#menu-toggle').click()`);
  reviewResults.push({ width, height, touch, overflow: before.overflow, camera, tuningBefore, tuningAfter });
}
fs.writeFileSync(`${out}/review-regressions.json`, JSON.stringify(reviewResults, null, 2));
console.log('Telemetry swipe/keyboard and inspector tuning regressions passed');

assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
ws.close();
