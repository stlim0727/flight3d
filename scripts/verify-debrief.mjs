// Start Vite and an isolated hardware Chrome with CDP; see browser-gpu.md.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertHardwareDraw } from './verify-browser-gpu.mjs';

const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9432';
const url = process.env.SIM_URL || 'http://127.0.0.1:5232/';
const output = resolve(process.env.ARTIFACT_DIR || 'review-artifacts/debrief');
await mkdir(output, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = event => {
  const result = JSON.parse(event.data);
  if (result.method === 'Runtime.exceptionThrown') exceptions.push(result.params.exceptionDetails);
  if (!result.id) return;
  const request = pending.get(result.id);
  if (!request) return;
  clearTimeout(request.timer); pending.delete(result.id);
  if (result.error) request.reject(result.error); else request.resolve(result.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
}
async function ev(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(selector) {
  const point = await ev(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'));
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const gpu = await ev(`(() => {
    const gl=document.createElement('canvas').getContext('webgl2');
    if(!gl) return {webgl2:false};
    const p=gl.createProgram();
    for(const [type,source] of [[gl.VERTEX_SHADER,'#version 300 es\\nvoid main(){vec2 p[3]=vec2[](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));gl_Position=vec4(p[gl_VertexID],0.,1.);}'],[gl.FRAGMENT_SHADER,'#version 300 es\\nprecision highp float;out vec4 c;void main(){c=vec4(1.,0.,0.,1.);}']]) {
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);gl.attachShader(p,s);
    }
    gl.linkProgram(p);gl.useProgram(p);gl.viewport(0,0,16,16);gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);gl.finish();
    const pixel=new Uint8Array(4);gl.readPixels(8,8,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return {webgl2:true,renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),pixel:[...pixel],error:gl.getError()};
  })()`);
  assertHardwareDraw(gpu);
  await writeFile(resolve(output, 'gpu.json'), JSON.stringify(gpu, null, 2));
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  for (let n = 0; n < 180; n++) {
    if (await ev('!!window.simulator && !document.body.classList.contains("booting")')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(await ev('!!window.simulator'), true, 'simulator initialized');
  assert.equal(await ev('!document.body.classList.contains("booting")'), true, 'startup completed');
  await click('#menu-toggle');
  await ev(`window.s=window.simulator;s.lobby.airport='coastal';s.lobby.aircraft='C172';s.lobby.preset='cruise';s.lobbyScreen.refresh();`);
  await click('#btn-fly');
  for (let n = 0; n < 120; n++) {
    if (await ev('s.gameFlow.state === "flight" && !s.startingFlight')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await ev(`(await import('/src/i18n/index.js')).setLanguage('ko');s.gameFlow.pause();s.stepSimulation(6);`);
  assert.equal(await ev('s.currentAircraftId'), 'C172');
  // Deterministic stepping deliberately runs while paused; record only live-flight ticks.
  const before = await ev('s.flightRecorder.elapsed');
  await ev(`s.gameFlow.resume();s.stepSimulation(8);s.gameFlow.pause();`);
  assert.ok(await ev('s.flightRecorder.elapsed') >= before + 7.9);
  await click('#btn-pause-end');
  assert.equal(await ev('s.gameFlow.state'), 'debrief');
  assert.equal(await ev('document.activeElement.id'), 'debrief-tab-summary');
  assert.equal(await ev('s.debriefReport.sufficient'), true);
  const duration = await ev('s.debriefReport.durationSec');
  await ev('s.stepSimulation(2)');
  assert.equal(await ev('s.debriefReport.durationSec'), duration);
  await shot('summary');
  await click('#debrief-tab-record');
  await ev(`document.querySelector('#debrief-scrub').value=10;document.querySelector('#debrief-scrub').dispatchEvent(new Event('input'));`);
  assert.match(await ev('document.querySelector("#debrief-sample").textContent'), /FT.*KT.*G/);
  await shot('record');
  await click('#debrief-tab-share');
  await send('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'granted', origin: new URL(url).origin });
  await send('Browser.setPermission', { permission: { name: 'clipboard-read' }, setting: 'granted', origin: new URL(url).origin });
  await click('#debrief-copy');
  // Clipboard writes resolve asynchronously; wait for the status instead of racing it.
  for (let n = 0; n < 20 && !(await ev('document.querySelector("#debrief-status").textContent')); n++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.match(await ev('document.querySelector("#debrief-status").textContent'), /복사했습니다/);
  assert.match(await ev('await navigator.clipboard.readText()'), /Flight3d.*\nCessna/s);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await click('#debrief-export');
  let exported;
  for (let n = 0; n < 20; n++) {
    try { exported = JSON.parse(await readFile(resolve(output, 'flight3d-C172-flight.json'), 'utf8')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(exported?.metadata.aircraft, 'C172');
  assert.ok(exported?.samples.length > 1);
  await shot('share');
  await ev(`navigator.clipboard.writeText=async()=>{throw new Error('Denied')};`);
  await click('#debrief-copy');
  assert.match(await ev('document.querySelector("#debrief-status").textContent'), /권한/);
  await shot('copy-failed');
  for (const [width, height] of [[390, 844], [320, 568], [844, 390], [568, 320]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    for (const name of ['summary', 'record', 'share']) {
      await click(`#debrief-tab-${name}`);
      assert.equal(await ev(`document.querySelector('.debrief-card').getBoundingClientRect().right <= innerWidth`), true);
      await shot(`${name}-${width}x${height}`);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await click('#debrief-tab-summary');
  await click('#debrief-retry');
  await ev('s.gameFlow.pause()');
  assert.equal(await ev('s.flightRecorder.elapsed < 5'), true);
  assert.equal(await ev('s.currentAircraftId'), 'C172');
  await click('#btn-pause-end');
  assert.equal(await ev('s.debriefReport.sufficient'), false);
  assert.equal(await ev('document.querySelector("#debrief-copy").disabled'), true);
  assert.deepEqual(await ev('(h => [h.classList.contains("is-truncated"), h.tabIndex])(document.querySelector("#debrief-outcome"))'), [false, -1], 'short headlines stay plain');
  assert.equal(await ev('getComputedStyle(document.querySelector("#hud-warning")).display'), 'none');
  assert.equal(await ev('getComputedStyle(document.querySelector("#toast-msg")).display'), 'none');
  await shot('insufficient');
  await click('#debrief-lobby');
  assert.equal(await ev('s.gameFlow.canResumeFromLobby()'), false);
  // A completed sortie must never leak samples into the next one, including crash exits.
  await ev(`s.lobby.preset='cruise';s.startFlight();s.triggerCrash({type:'TERRAIN',name:'Terrain',description:'Verification impact',point:s.position.clone(),speedKnots:100});s.stepSimulation(.02);`);
  assert.equal(await ev('s.gameFlow.state'), 'flight', 'show crash scene before debrief');
  assert.equal(await ev('s.debriefReport.reason'), 'crash');
  const crashReport = await ev('JSON.stringify(s.debriefReport)');
  assert.equal(await ev('!!s.cameraSystem.crashView && s.aircraftBreakup.pieces.length > 0'), true);
  assert.equal(await ev('s.flightRecorder.active'), false);
  assert.equal(await ev('getComputedStyle(document.querySelector("#debrief-overlay")).display'), 'none');
  assert.equal(await ev('getComputedStyle(document.querySelector("#crash-overlay")).display'), 'flex');
  const debrisBefore = await ev('s.aircraftBreakup.pieces[0].object.position.toArray()');
  await shot('crash-observation');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await ev('s.gameFlow.state'), 'flight');
  assert.notDeepEqual(await ev('s.aircraftBreakup.pieces[0].object.position.toArray()'), debrisBefore, 'wreckage moves during observation');
  await ev('s.gameFlow.pause();window.crashRemaining=s.crashDebriefRemaining');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await ev('s.crashDebriefRemaining === window.crashRemaining'), true);
  await ev('s.gameFlow.resume()');
  for (let n = 0; n < 100 && await ev('s.gameFlow.state !== "debrief"'); n++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await ev('s.gameFlow.state'), 'debrief');
  assert.equal(await ev('JSON.stringify(s.debriefReport)'), crashReport);
  assert.equal(await ev('document.activeElement.id'), 'debrief-tab-summary');
  // Issue #365: the debrief carries the collision that ended the sortie.
  assert.deepEqual(await ev('[s.debriefReport.version, s.debriefReport.crash.type, s.debriefReport.crash.speedKnots]'), [2, 'TERRAIN', 100]);
  assert.equal(await ev('getComputedStyle(document.querySelector("#debrief-crash")).display'), 'flex');
  assert.equal(await ev('document.querySelector("#debrief-crash-name").textContent'), 'Terrain', 'short records name the collision in the block');
  assert.equal(await ev('document.querySelector("#debrief-crash-desc").textContent'), 'Verification impact');
  assert.equal(await ev('document.querySelector("#debrief-events li:last-child").classList.contains("debrief-impact")'), true);
  assert.equal(await ev('getComputedStyle(document.querySelector("#debrief-impact-marker")).display'), 'inline', 'impact marker is rendered');
  await shot('crash-debrief');

  // Menu entry cancels the pending transition; retry starts a clean sortie.
  await click('#debrief-retry');
  await ev(`s.triggerCrash({type:'TERRAIN',name:'Terrain',description:'Second impact',point:s.position.clone(),speedKnots:100});s.stepSimulation(.02);s.toggleMainMenu();`);
  assert.equal(await ev('s.crashDebriefRemaining'), null);
  await new Promise(resolve => setTimeout(resolve, 3200));
  assert.equal(await ev('s.gameFlow.state'), 'lobby');
  assert.equal(await ev('document.querySelector("#btn-lobby-end").hidden'), false);
  await click('#btn-lobby-end');
  assert.equal(await ev('s.gameFlow.state'), 'debrief');
  assert.equal(await ev('s.debriefReport.reason'), 'crash');
  await click('#debrief-retry');
  await ev('s.gameFlow.pause()');
  assert.equal(await ev('s.crashDebriefRemaining'), null);
  assert.equal(await ev('s.flightRecorder.active && !s.isCrashed'), true);

  // Issue #370: a long headline stays on one line; hover, focus and tap reveal the full text.
  const longName = '기체 지면 접촉 (TERRAIN / BODY STRIKE)';
  await ev(`s.gameFlow.resume();s.stepSimulation(6);s.triggerCrash({type:'TERRAIN',name:${JSON.stringify(longName)},description:'Long headline',point:s.position.clone(),speedKnots:100});s.stepSimulation(.02);`);
  for (let n = 0; n < 100 && await ev('s.gameFlow.state !== "debrief"'); n++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await ev('s.debriefReport.sufficient'), true);
  const headline = `document.querySelector("#debrief-outcome")`;
  const tipShown = `getComputedStyle(document.querySelector("#debrief-outcome-tip")).display !== "none"`;
  const headlineState = () => ev(`(h => ({ text: h.textContent, truncated: h.classList.contains("is-truncated"), overflowing: h.scrollWidth > h.clientWidth,
    height: h.getBoundingClientRect().height, tabIndex: h.tabIndex,
    panelOverflow: (p => p.scrollHeight - p.clientHeight)(document.querySelector(".debrief-panels")) }))(${headline})`);
  for (const [width, height] of [[1280, 720], [390, 844], [844, 390], [320, 568]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await new Promise(resolve => setTimeout(resolve, 150));
    const state = await headlineState();
    assert.equal(state.text, longName, 'the DOM keeps the full headline for assistive technology');
    assert.ok(state.truncated && state.overflowing && state.tabIndex === 0, `${width}x${height} long headline is truncated and focusable`);
    assert.ok(state.height < 30, `${width}x${height} headline is one line`);
    if (width === 1280) assert.ok(state.panelOverflow <= 0, '1280x720 summary fits without scrolling');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await ev(tipShown), false);
  const center = await ev(`(r => ({ x: r.x + 40, y: r.y + r.height / 2 }))(${headline}.getBoundingClientRect())`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
  assert.equal(await ev(tipShown), true, 'hover opens the tooltip');
  assert.deepEqual(await ev('(t => [t.textContent, t.getAttribute("aria-hidden")])(document.querySelector("#debrief-outcome-tip"))'), [longName, 'true']);
  assert.equal(await ev(`(t => (c => t.left >= c.left && t.right <= c.right)(document.querySelector(".debrief-card").getBoundingClientRect()))(document.querySelector("#debrief-outcome-tip").getBoundingClientRect())`), true, 'tooltip stays inside the card');
  await shot('headline-tooltip');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 400 });
  assert.equal(await ev(tipShown), false, 'leaving the headline closes the tooltip');
  await ev(`${headline}.focus()`);
  assert.equal(await ev(tipShown), true, 'keyboard focus opens the tooltip');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await ev(tipShown), false, 'Escape closes the tooltip');
  assert.equal(await ev('s.gameFlow.state'), 'debrief', 'Escape on the tooltip does not reach the flight menu');
  await ev(`${headline}.blur()`);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await ev(`window.tapTypes=[];${headline}.addEventListener('pointerdown',e=>tapTypes.push(e.pointerType));
    window.tapPrevented=[];window.addEventListener('touchstart',e=>{if(e.target.closest?.('.debrief-card'))tapPrevented.push(e.defaultPrevented)});`);
  const tap = async point => {
    await send('Input.synthesizeTapGesture', { ...point, gestureSourceType: 'touch' });
    await new Promise(resolve => setTimeout(resolve, 150));
  };
  await tap(center);
  assert.deepEqual(await ev('tapTypes'), ['touch'], 'the tap arrives as a touch pointer');
  assert.deepEqual(await ev('[tapPrevented, s.cameraSystem.isDragging]'), [[false], false], 'debrief touches are UI, not camera drags');
  assert.equal(await ev(tipShown), true, 'tapping the headline opens the tooltip');
  await tap({ x: 900, y: 400 });
  assert.equal(await ev(tipShown), false, 'tapping elsewhere closes the tooltip');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  assert.deepEqual(exceptions, [], 'no browser exceptions');
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ gpu, durationSec: duration,
    scenarios: ['manual end', 'pause exclusion', 'tabs', 'scrub', 'clipboard success/failure', 'JSON download', 'responsive', 'retry', 'insufficient data', 'main menu', 'crash observation', 'moving wreckage', 'crash pause exclusion', 'immutable impact report', 'delayed debrief', 'crash report in debrief', 'crash menu cancellation', 'crash retry', 'long headline ellipsis and tooltip'], exceptions }, null, 2));
  console.log(JSON.stringify({ passed: true, output, gpu, durationSec: duration }));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
