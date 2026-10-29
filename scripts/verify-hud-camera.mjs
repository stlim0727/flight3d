import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run via chrome-session --project flight3d. Own only this tab, never the browser.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5300/?airport=coastal&aircraft=B738&scenario=runway';
const dir = process.env.ARTIFACT_DIR || '.cache/hud-camera';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0, useTouch = false;
const pending = new Map(), errors = [], checks = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
  pending.set(id, result => { clearTimeout(timer); result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const capture = async name => {
  await wait(200);
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
const click = async id => {
  const point = await evaluate(`(() => {
    const r = document.getElementById('${id}').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width:r.width, height:r.height };
  })()`);
  assert.ok(point.width >= 40 && point.height >= 40, `${id} hit target`);
  if (useTouch) {
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } else {
    await call('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
    await call('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
  }
  await wait(400);
};
const key = async (key, code) => {
  await call('Input.dispatchKeyEvent', { type:'keyDown', key, code });
  await call('Input.dispatchKeyEvent', { type:'keyUp', key, code });
  await wait(400);
};
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) { ready = true; break; }
    await wait(500);
  }
  assert.ok(ready, 'startup completed');
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop(); s.gameFlow.enterFlight();
    // Fixed-pose visual/interaction check; no claim of a simulated flight.
    s.integratePhysics = () => {};
    s.position.set(-520, 500, 720); s.quaternion.identity();
    s.renderPose.reset(s.position,s.quaternion);
    Object.assign(s.telemetry,{iasKnots:145,altitudeFt:1640,headingDeg:0,pitchDeg:0,rollDeg:0,vsiFpm:0});
    s.controls.throttle = 0;
  })()`);
  await key('9', 'Digit9');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 8);
  assert.ok(await evaluate('!document.getElementById("hud-view").hidden && getComputedStyle(document.querySelector(".hud-strip")).display !== "none"'));
  assert.equal(await evaluate('document.querySelectorAll("#hud-view .hud-unavailable:disabled").length'), 0);
  assert.ok(await evaluate('window.simulator.aircraft.group.visible'), 'render visibility restored after HUD render');
  await capture('desktop-level'); checks.push('digit9 and no disabled placeholders');
  await click('open-flight-more');
  const trim = await evaluate('window.simulator.aero.pitchTrim');
  await click('flight-trim-more');
  assert.ok(Math.abs(await evaluate('window.simulator.controls.pitchTrim') - trim - .2) < .001);
  await click('flight-park-brake');
  assert.equal(await evaluate('window.simulator.controls.parkingBrake'), true);
  await click('flight-park-brake');
  assert.equal(await evaluate('window.simulator.controls.parkingBrake'), false);
  await click('open-flight-more');
  await click('btn-ap-toggle');
  assert.ok(await evaluate('!document.getElementById("ap-panel").hidden'));
  await capture('desktop-ap');
  await click('btn-ap-toggle');
  assert.ok(await evaluate('document.getElementById("ap-panel").hidden'), 'AP trigger closes panel');
  await click('open-flight-more');
  assert.ok(await evaluate('!document.getElementById("flight-more-panel").hidden'));
  await capture('desktop-systems');
  await key('Escape','Escape');
  assert.ok(await evaluate('document.getElementById("flight-more-panel").hidden'));
  checks.push('trim brake AP and systems interactions');
  for (const [name, pitch, roll] of [['climb-bank',15,30], ['descent-bank',-12,-35]]) {
    await evaluate(`(() => {
      const s = window.simulator;
      const p = ${pitch}*Math.PI/180, r = ${roll}*Math.PI/180;
      // Camera axes are X pitch and Z roll; compose without loading Three into page.
      s.quaternion.set(Math.sin(p/2)*Math.cos(r/2),-Math.sin(p/2)*Math.sin(r/2),Math.cos(p/2)*Math.sin(r/2),Math.cos(p/2)*Math.cos(r/2));
      s.renderPose.reset(s.position,s.quaternion);
      Object.assign(s.telemetry,{pitchDeg:${pitch},rollDeg:${roll},vsiFpm:${pitch}*40});
    })()`);
    await capture(`desktop-${name}`);
  }
  await evaluate('window.simulator.controls.onSelectCamera(0)');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 0);
  await key('c','KeyC');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 8);
  await click('open-camera');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 1);
  assert.ok(await evaluate('document.getElementById("hud-view").hidden && getComputedStyle(document.querySelector(".hud-strip")).display !== "none"'));
  assert.equal(await evaluate('document.activeElement.id'),'open-camera','camera exit restores visible focus');
  checks.push('HUD cockpit chase cycle restores original UI and keyboard focus');
  await key('9','Digit9');
  await evaluate('window.simulator.setPreset("runway"); window.simulator.cameraSystem.resetLook()');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 8);
  checks.push('reset retains selected HUD mode');
  await evaluate(`(() => {
    const s = window.simulator;
    s.quaternion.identity(); s.renderPose.reset(s.position,s.quaternion);
    Object.assign(s.telemetry,{pitchDeg:0,rollDeg:0,vsiFpm:0});
    document.getElementById('toast-msg').classList.remove('visible');
  })()`);
  for (const [name,width,height,touch] of [['mobile-portrait',390,844,false],['mobile-touch',390,844,true],['mobile-landscape',844,390,true]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await call('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:2});
    useTouch = touch;
    await evaluate(`document.body.classList.toggle('touch-mode',${touch})`);
    await wait(250);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'),'no horizontal overflow');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".flight-toolbar")).display'),'flex','shared toolbar stays visible in touch mode');
    const footerOverlap = await evaluate(`(() => {
      const a = document.querySelector('.flight-toolbar').getBoundingClientRect();
      return [...document.querySelectorAll('.touch-throttle-card,.touch-stick-card,.touch-rudder-card')].some(node => {
        if (!node.getClientRects().length) return false;
        const b = node.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      });
    })()`);
    assert.equal(footerOverlap,false,'shared toolbar clears touch controls');
    await capture(name);
    await click('open-flight-more');
    await capture(`${name}-systems`);
    await click('open-flight-more');
    checks.push(name);
  }
  await evaluate('window.simulator.gameFlow.returnToLobby(true)');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("hud-view")).display'),'none');
  await evaluate('window.simulator.gameFlow.enterFlight()');
  assert.notEqual(await evaluate('getComputedStyle(document.getElementById("hud-view")).display'),'none');
  useTouch = false;
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setTouchEmulationEnabled',{enabled:false});
  await evaluate("document.body.classList.remove('touch-mode')");
  for (const aircraft of ['C172','F16','B738']) {
    await evaluate(`window.simulator.setAircraft('${aircraft}'); window.simulator.setPreset('runway')`);
    await evaluate('window.simulator.telemetry.fuelKg = window.simulator.engines.fuelKg');
    await wait(500);
    assert.equal(await evaluate('window.simulator.cameraSystem.mode'),8);
    assert.ok(await evaluate('window.simulator.aircraft.group.visible'),'aircraft visibility retained after HUD render');
    await capture(`aircraft-${aircraft}`);
  }
  checks.push('C172 F16 B738 swaps preserve HUD');
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.start('coastal');
    s.cameraSystem.setMode(8,true);
    s.demoDirector.onUserCameraChange();
    s.updateHUD();
  })()`);
  const demoTrim = await evaluate('window.simulator.controls.pitchTrim');
  assert.ok(await evaluate('document.getElementById("flight-trim-more").disabled && document.getElementById("btn-flaps-ext").disabled && document.getElementById("flight-park-brake").disabled'));
  await evaluate('document.getElementById("flight-trim-more").click(); window.simulator.cameraSystem.setMode(0); window.simulator.cameraSystem.showTemporaryView(5,4)');
  assert.equal(await evaluate('window.simulator.controls.pitchTrim'),demoTrim);
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'),8);
  await evaluate('window.simulator.demoDirector.stop(); window.simulator.updateHUD()');
  assert.ok(await evaluate('!document.getElementById("flight-trim-more").disabled'));
  checks.push('demo disables controls and cannot replace manual HUD selection; stop restores controls');
  assert.equal(errors.length,0,JSON.stringify(errors));
  checks.push('lobby hides HUD and flight restores it');
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({passed:true,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks,dir}));
} finally {
  ws.close(); await fetch(`${endpoint}/json/close/${target.id}`);
}
