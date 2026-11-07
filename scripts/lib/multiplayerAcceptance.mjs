import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { until, delay } from './cdpClient.mjs';

/** Full simulator acceptance; hosted CI separately checks transport and modal DOM. */
export async function verifyMultiplayerSimulator({ page, cdpPort, browsers }) {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`]);
  console.log(stdout.trim());
  await mkdir('review-artifacts/multiplayer', { recursive: true });
  const ready = 'Boolean(window.sim?.multiplayer && window.sim?.startupReady)';
  const host = await page('/?aircraft=C172&terrain=coastal&scenario=runway', ready);
  let guest = await page('/?aircraft=C172&terrain=coastal&scenario=runway', ready);
  for (const c of [host, guest]) {
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await c.evaluate('sim.setRenderQuality("ultraLow"); sim.setBrowserActive(true)');
  }
  async function open(c) {
    await c.evaluate(`if (!sim.multiplayer.modalOpen) {
      if (!sim.multiplayer.active && sim.gameFlow.state !== 'lobby') sim.gameFlow.returnToLobby(true);
      document.getElementById(sim.multiplayer.active ? 'mp-room-menu' : 'mp-open').click();
    }`);
    assert.equal(await c.evaluate('document.getElementById("mp-dialog").matches(":modal")'), true);
    assert.equal(await c.evaluate('sim.controls.inputBlocked'), true);
  }
  async function capture(c, name) {
    await c.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`review-artifacts/multiplayer/${name}.png`, Buffer.from(data, 'base64'));
  }
  async function create(airport = 'coastal', aircraft = 'C172', scenario = 'runway') {
    for (const c of [host, guest]) await open(c);
    await host.evaluate('document.getElementById("mp-choose-host").click()');
    await host.evaluate(`document.getElementById('mp-airport').value=${JSON.stringify(airport)}; document.getElementById('mp-aircraft').value=${JSON.stringify(aircraft)}; document.getElementById('mp-scenario').value=${JSON.stringify(scenario)}; document.getElementById('mp-name').value='Lead'; document.getElementById('mp-create').click()`);
    await until(() => host.evaluate('sim.multiplayer.room?.registered'), 'creator registered');
    return host.evaluate('({code:sim.multiplayer.room.room,invite:document.getElementById("mp-invite").value})');
  }
  async function join(code) {
    await guest.evaluate('document.getElementById("mp-choose-join").click()');
    await guest.evaluate(`document.getElementById('mp-room').value=${JSON.stringify(code)}; document.getElementById('mp-name').value='Wing'; document.getElementById('mp-join').click()`);
    for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room?.session.state === "connected"'), 'two pilots connected');
  }
  async function start() {
    await host.evaluate('document.getElementById("mp-start").click()');
    for (const c of [host, guest]) {
      await until(() => c.evaluate('sim.multiplayer.room?.session.state === "flying" && sim.gameFlow.state === "flight"'), 'shared start', 90000);
      assert.equal(await c.evaluate('sim.multiplayer.modalOpen || sim.controls.inputBlocked'), false, 'flight starts after modal closes');
      await until(() => c.evaluate('sim.multiplayer.remote?.group.visible'), 'remote aircraft drawing');
    }
  }
  async function leave() {
    await open(guest); await guest.evaluate('document.getElementById("mp-leave").click()');
    await until(() => host.evaluate('sim.multiplayer.room.closed'), 'peer departure');
    for (const c of [host, guest]) {
      assert.equal(await c.evaluate('!sim.multiplayer.remote && sim.multiplayer.voice.closed'), true);
      if (await c.evaluate('sim.multiplayer.modalOpen')) await c.evaluate('document.getElementById("mp-dialog-close").click()');
    }
  }

  await open(host); await capture(host, 'modal-setup');
  await host.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 640, deviceScaleFactor: 1, mobile: true });
  await capture(host, 'mobile-setup');
  await host.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  async function swipeDialog(selector, direction) {
    const point = await host.evaluate(`(() => { const d=document.getElementById('mp-dialog'); d.scrollTop=${direction < 0 ? '0' : 'd.scrollHeight'}; const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:Math.max(120,Math.min(innerHeight-120,r.y+r.height/2))}; })()`);
    const before = await host.evaluate('document.getElementById("mp-dialog").scrollTop');
    await host.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    assert.equal(await host.evaluate('sim.cameraSystem.isDragging || sim.cameraSystem.isPinching'), false, 'dialog touch must never start camera look');
    for (let step = 1; step <= 10; step++) {
      await host.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + direction * step * 18, id: 1 }] });
      await delay(20);
    }
    await host.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(async () => {
      const after = await host.evaluate('document.getElementById("mp-dialog").scrollTop');
      return direction < 0 ? after > before + 30 : after < before - 30;
    }, 'native dialog touch scroll', 3000);
  }
  await swipeDialog('#mp-host-title', -1);
  await swipeDialog('#mp-host-panel', 1);
  await capture(host, 'mobile-scrolled');
  await host.evaluate('document.getElementById("mp-dialog").scrollTop=0');
  await host.evaluate('document.getElementById("mp-choose-join").click()');
  await capture(host, 'mobile-join');
  assert.equal(await host.evaluate('document.getElementById("mp-host-panel").hidden && !document.getElementById("mp-join-panel").hidden'), true, 'joining hides host-only stage and aircraft choices');
  await host.evaluate('document.getElementById("mp-choose-host").click()');
  const setupBounds = await host.evaluate('(() => { const d=document.getElementById("mp-dialog"),r=d.getBoundingClientRect(); return {left:r.left,right:r.right,w:innerWidth,scroll:d.scrollWidth,client:d.clientWidth}; })()');
  assert.ok(setupBounds.left >= 0 && setupBounds.right <= setupBounds.w && setupBounds.scroll <= setupBounds.client + 2, 'host/join setup fits phone width');
  await host.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const invite = await create();
  assert.match(invite.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  const url = new URL(invite.invite); assert.equal(url.searchParams.get('r'), invite.code); assert.equal(url.searchParams.size, 1);
  const deadline = await host.evaluate('sim.multiplayer.room.waitingLease.deadline');
  await delay(200); await host.evaluate('document.getElementById("mp-keep-waiting").click()');
  assert.ok(await host.evaluate('sim.multiplayer.room.waitingLease.deadline') > deadline, 'only creator button extends waiting');
  await capture(host, 'modal-waiting');
  await host.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  const keepBounds = await host.evaluate('(() => { const r=document.getElementById("mp-keep-waiting").getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:innerHeight}; })()');
  assert.ok(keepBounds.top >= 0 && keepBounds.bottom <= keepBounds.height, 'creator renewal button visible on short landscape screen');
  await capture(host, 'waiting-landscape');
  await host.evaluate('document.getElementById("mp-keep-waiting").click()');
  await host.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await join(`${invite.code.slice(0, 3).toLowerCase()}-${invite.code.slice(3).toLowerCase()}`);
  assert.equal(await host.evaluate('!sim.multiplayer.room.waiting && document.getElementById("mp-waiting").hidden'), true, 'friend admission stops the waiting countdown');
  await start();
  const hp = await host.evaluate('sim.position.toArray()'), gp = await guest.evaluate('sim.position.toArray()');
  assert.ok(Math.hypot(...hp.map((n, i) => n - gp[i])) > 70, 'non-overlapping runway slots');
  await host.evaluate('sim.camera.position.copy(sim.multiplayer.remote.group.position).add(new THREE.Vector3(22,12,26)); sim.camera.lookAt(sim.multiplayer.remote.group.position); sim.camera.updateMatrixWorld(true); sim.multiplayer.update(); sim.renderScene()');
  await capture(host, 'remote-aircraft');

  // Opening room management holds the plane and excludes all other simulator UI.
  await open(host);
  const held = await host.evaluate('sim.position.toArray()');
  const camera = await host.evaluate('sim.cameraSystem.mode');
  await host.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2' });
  await host.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2' });
  await host.evaluate('sim.stepSimulation(1)');
  assert.deepEqual(await host.evaluate('sim.position.toArray()'), held, 'no physics behind modal');
  assert.equal(await host.evaluate('sim.cameraSystem.mode'), camera, 'no background shortcut behind modal');
  await until(() => guest.evaluate('sim.multiplayer.room.session.track.sample(performance.now())?.held'), 'peer sees modal hold');
  await until(() => host.evaluate('sim.multiplayer.voice.talking'), 'microphone automatically enabled');
  await host.evaluate('document.getElementById("mp-microphone").click()');
  assert.equal(await host.evaluate('sim.multiplayer.voice.muted && !sim.multiplayer.voice.talking'), true);
  await host.evaluate('document.getElementById("mp-microphone").click()');
  assert.equal(await host.evaluate('sim.multiplayer.voice.talking'), true);
  await host.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await capture(host, 'mobile-modal');
  const bounds = await host.evaluate('(() => { const d=document.getElementById("mp-dialog"),r=d.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,scroll:d.scrollWidth,client:d.clientWidth}; })()');
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.w && bounds.top >= 0 && bounds.bottom <= bounds.h && bounds.scroll <= bounds.client + 2, 'modal fits phone viewport');
  await host.evaluate('document.getElementById("mp-dialog-close").click()');
  assert.equal(await host.evaluate('sim.gameFlow.state === "flight" && !sim.controls.inputBlocked'), true);
  assert.equal(await host.evaluate('sim.multiplayer.voice.talking'), true, 'voice continues after closing room controls');

  // Movement, personal reset and host restart still work with the modal lifecycle.
  await guest.evaluate('sim.controls.setParkingBrake(false); sim.controls.throttle=.8');
  const before = await host.evaluate('sim.multiplayer.room.session.track.samples.at(-1).p');
  await until(async () => { const after = await host.evaluate('sim.multiplayer.room.session.track.samples.at(-1)?.p'); return after && Math.hypot(...after.map((n,i)=>n-before[i])) > 3; }, 'flight movement replicated', 30000);
  await open(guest); await guest.evaluate('document.getElementById("mp-respawn").click()');
  assert.equal(await guest.evaluate('sim.multiplayer.modalOpen'), false);
  await open(host); await start();
  await leave();

  // Navigate to the actual shared URL: joining requires no input or Join click.
  const direct = await create();
  const renew = setInterval(() => host.evaluate('sim.multiplayer.room.keepWaiting()').catch(() => {}), 3000);
  try {
    const link = new URL(direct.invite);
    guest = await page(link.pathname + link.search, ready);
    await guest.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await guest.evaluate('sim.setRenderQuality("ultraLow"); sim.setBrowserActive(true)');
    for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room?.session.state === "connected"'), 'invite URL automatically connected');
    await until(() => guest.evaluate('sim.multiplayer.modalOpen && sim.multiplayer.voice.talking'), 'invite automatically enables voice');
    await start();
    await leave();
  } finally { clearInterval(renew); }

  for (const config of [['neon', 'B738', 'cruise'], ['incheon', 'F16', 'runway'], ['coastal', 'C172', 'cruise']]) {
    const next = await create(...config); await join(next.code); await start(); await leave();
  }

  // A real sixty-second deadline before anyone joins: renew halfway, survive the
  // original deadline, then miss the next press. Later arrivals see cancellation.
  const cancelled = await create();
  await delay(30200); await host.evaluate('document.getElementById("mp-keep-waiting").click()');
  await delay(30200);
  assert.equal(await host.evaluate('sim.multiplayer.active'), true, 'creator renewal survives original deadline');
  await until(() => host.evaluate('sim.multiplayer.room.closed && sim.multiplayer.message === "cancelled"'), 'sixty-second missed press cancellation', 32000);
  assert.equal(await host.evaluate('sim.multiplayer.room.keepWaiting()'), false);
  await guest.evaluate('document.getElementById("mp-choose-join").click()');
  await guest.evaluate(`document.getElementById('mp-room').value=${JSON.stringify(cancelled.code)}; document.getElementById('mp-join').click()`);
  await until(() => guest.evaluate('sim.multiplayer.message === "cancelled" && sim.multiplayer.room.closed'), 'late join explicitly cancelled');
  assert.equal(await guest.evaluate('document.getElementById("mp-dialog").matches(":modal")'), true);
  assert.equal(await guest.evaluate('document.getElementById("mp-status").textContent.length > 0'), true);
  await capture(guest, 'cancelled-invite');
  for (const c of browsers) assert.deepEqual(c.errors, [], 'browser exceptions');
  console.log('PASS hardware Chrome: compact/manual and automatic URL invites, modal focus/physics/input isolation, continuous voice/mute, remote drawing/movement/reset/restart, three scenery/aircraft types, phone modal, creator renewal and real 60s expiry, admission ending the countdown, late guest cancellation. Evidence: review-artifacts/multiplayer/');
}
