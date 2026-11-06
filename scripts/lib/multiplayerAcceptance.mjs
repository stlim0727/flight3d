import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { until, delay } from './cdpClient.mjs';

/** Full simulator acceptance, only after the caller verifies hardware drawing. */
export async function verifyMultiplayerSimulator({ page, cdpPort, browsers }) {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`]);
  console.log(stdout.trim());
  await mkdir('review-artifacts/multiplayer', { recursive: true });
  const ready = 'Boolean(window.sim?.multiplayer && window.sim?.startupReady)';
  const host = await page('/?aircraft=C172&terrain=coastal&scenario=runway', ready);
  const guest = await page('/?aircraft=C172&terrain=coastal&scenario=runway', ready);
  for (const c of [host, guest]) {
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await c.evaluate('sim.setRenderQuality("ultraLow"); sim.setBrowserActive(true); document.getElementById("lobby-tab-multiplayer").click()');
  }
  await host.evaluate('document.getElementById("mp-name").value="Lead"; document.getElementById("mp-scenario").value="runway"; document.getElementById("mp-create").click()');
  await until(() => host.evaluate('sim.multiplayer.room?.registered'), 'simulator host registered');
  const invite = await host.evaluate('document.getElementById("mp-invite").value');
  assert.ok(invite.includes('?room=f3d-'));
  await guest.evaluate(`document.getElementById("mp-room").value=${JSON.stringify(invite)}; document.getElementById("mp-name").value="Wing"; document.getElementById("mp-join").click()`);
  for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room?.session.state === "connected"'), 'simulator pilots connected');
  await guest.evaluate(`(() => {
    const session = sim.multiplayer.room.session, prepare = session.prepare;
    session.prepare = async (...args) => {
      session.prepare = prepare;
      await prepare(...args);
      await new Promise(resolve => { window.releaseMultiplayerPrepare = resolve; });
    };
  })()`);
  await host.evaluate('document.getElementById("mp-start").click()');
  await until(() => host.evaluate('sim.multiplayer.room.session.localReady'), 'host ready barrier');
  await until(() => guest.evaluate('Boolean(window.releaseMultiplayerPrepare)'), 'guest delayed ready');
  const heldPosition = await host.evaluate('sim.position.toArray()');
  await host.evaluate('sim.gameFlow.resume(); sim.stepSimulation(1)');
  await delay(350);
  assert.deepEqual(await host.evaluate('sim.position.toArray()'), heldPosition, 'physics cannot bypass shared prepare barrier');
  await guest.evaluate('window.releaseMultiplayerPrepare()');
  for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room?.session.state === "flying" && sim.gameFlow.state === "flight"'), 'simulator shared flight', 60000);
  assert.equal(await host.evaluate('sim.controls.inputBlocked'), false, 'input released after shared go');
  const hp = await host.evaluate('sim.position.toArray()'), gp = await guest.evaluate('sim.position.toArray()');
  assert.ok(Math.hypot(...hp.map((n, i) => n - gp[i])) > 70, 'separated runway slots');
  for (const c of [host, guest]) {
    await until(() => c.evaluate('sim.multiplayer.remote?.group.visible && sim.multiplayer.room.session.track.seq > 3'), 'remote aircraft drawn');
  }
  // Frame the other pilot in the actual simulator camera, then capture its drawn model.
  await host.evaluate('sim.cameraSystem.setMode("chase", true); sim.camera.position.copy(sim.multiplayer.remote.group.position).add(new THREE.Vector3(22,12,26)); sim.camera.lookAt(sim.multiplayer.remote.group.position); sim.camera.updateMatrixWorld(true); sim.multiplayer.update(); sim.renderScene()');
  const capture = async (client, name) => {
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`review-artifacts/multiplayer/${name}.png`, Buffer.from(data, 'base64'));
  };
  await capture(host, 'host-runway');
  await guest.evaluate('document.getElementById("mp-respawn").click()');
  await until(() => host.evaluate('sim.multiplayer.room.session.track.epoch >= 2'), 'reset delivered');
  // Actual flight input: unpark and apply throttle; the peer must observe displacement.
  const before = await host.evaluate('sim.multiplayer.room.session.track.samples.at(-1).p');
  await guest.evaluate('sim.controls.setParkingBrake(false); sim.controls.throttle = .8; sim.setBrowserActive(true)');
  await until(async () => {
    const after = await host.evaluate('sim.multiplayer.room.session.track.samples.at(-1)?.p');
    return after && Math.hypot(...after.map((n, i) => n-before[i])) > 3;
  }, 'physics movement replicated', 30000);
  // Permission grant uses Chrome fake microphone but production getUserMedia + UI.
  await host.evaluate('document.getElementById("mp-microphone").click()');
  await until(() => host.evaluate('Boolean(sim.multiplayer.voice.microphone)'), 'microphone UI');
  await host.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyN', key: 'v' });
  assert.equal(await host.evaluate('sim.multiplayer.voice.talking'), true);
  await host.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyN', key: 'v' });
  assert.equal(await host.evaluate('sim.multiplayer.voice.talking'), false);
  await host.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyN', key: 'v' });
  await host.evaluate('window.dispatchEvent(new Event("blur"))');
  assert.equal(await host.evaluate('sim.multiplayer.voice.talking'), false);
  await host.evaluate('sim.setBrowserActive(true)');
  // Restart both into airborne flight and retain the same room.
  await host.evaluate('document.getElementById("mp-start").click()');
  for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room.session.round === 2 && sim.multiplayer.room.session.state === "flying"'), 'restart together');
  // A crash/debrief recovery only resets one slot; the other pilot keeps flying.
  const hostEpoch = await host.evaluate('sim.multiplayer.room.session.epoch');
  await guest.evaluate('sim.isCrashed=true; sim.gameFlow.endFlight(); sim.retryDebrief()');
  assert.equal(await guest.evaluate('!sim.isCrashed && sim.gameFlow.state === "flight"'), true);
  assert.equal(await host.evaluate('sim.multiplayer.room.session.epoch'), hostEpoch);
  await guest.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await capture(guest, 'mobile-controls');
  const bounds = await guest.evaluate('(() => { const r=document.getElementById("mp-controls").getBoundingClientRect(); return { left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight }; })()');
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height, 'mobile controls fit viewport');
  await guest.evaluate('document.getElementById("mp-leave").click()');
  await until(() => host.evaluate('sim.multiplayer.room.closed && !sim.multiplayer.remote && sim.multiplayer.voice.closed'), 'simulator leave cleanup');
  assert.equal(await host.evaluate('sim.gameFlow.state'), 'flight', 'solo flight continues');
  // Exercise airborne scenery/model swaps as well as the runway path.
  for (const [airport, aircraft, scenario] of [['neon', 'B738', 'cruise'], ['incheon', 'F16', 'runway'], ['coastal', 'C172', 'cruise']]) {
    await host.evaluate(`document.getElementById('mp-airport').value=${JSON.stringify(airport)}; document.getElementById('mp-aircraft').value=${JSON.stringify(aircraft)}; document.getElementById('mp-scenario').value=${JSON.stringify(scenario)}; document.getElementById('mp-create').click()`);
    await until(() => host.evaluate('sim.multiplayer.room.registered'), 'new room registered');
    const link = await host.evaluate('document.getElementById("mp-invite").value');
    await guest.evaluate(`document.getElementById('mp-room').value=${JSON.stringify(link)}; document.getElementById('mp-join').click()`);
    await until(() => host.evaluate('sim.multiplayer.room.session.state === "connected"'), 'new room connected');
    await host.evaluate('document.getElementById("mp-start").click()');
    for (const c of [host, guest]) await until(() => c.evaluate('sim.multiplayer.room.session.state === "flying" && sim.multiplayer.remote?.group.visible'), `${airport}/${aircraft}/${scenario} shared start`, 90000);
    for (const c of [host, guest]) {
      const actual = await c.evaluate('({airport:sim.activeAirport, aircraft:sim.currentAircraftId, scenario:sim.lastPresetType, crashed:sim.isCrashed, time:sim.sky.timeOfDay})');
      assert.deepEqual(actual, { airport, aircraft, scenario, crashed: false, time: 12 });
    }
    await host.evaluate('document.getElementById("mp-leave").click()');
    await until(() => guest.evaluate('sim.multiplayer.room.closed'), 'host leave ends room');
  }
  for (const c of browsers) assert.deepEqual(c.errors, [], 'simulator browser exceptions');
  console.log('PASS hardware Chrome simulator: UI invite/join, shared runway start, separated slots, remote model, actual throttle movement replication, reset, PTT key release/blur, restart, individual crash recovery, mobile controls, leave-to-solo, all three aircraft and scenery types with runway/cruise starts. Screenshots: review-artifacts/multiplayer/');
}
