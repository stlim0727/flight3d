import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { withBrowserSession } from './lib/browserHarness.mjs';

// Linux hardware path; never allow the harness to silently choose software.
if (process.platform === 'linux') {
  await access('/dev/dri/renderD128', constants.R_OK | constants.W_OK);
  process.env.GPU_ANGLE = 'vulkan';
}
const out = process.env.ARTIFACT_DIR || '.cache/flight-layout';
await mkdir(out, { recursive: true });
await withBrowserSession({}, async ({ cdpPort, origin, evaluate, send, delay, screenshot, exceptions, consoleMessages }) => {
  const gpu = JSON.parse(execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], { encoding: 'utf8' }));
  console.log('GPU', gpu);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('flight3d.renderQuality', 'ultraLow')" });
  await send('Page.navigate', { url: origin + '/?airport=coastal&aircraft=B738&scenario=runway' });
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(500);
  }
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), JSON.stringify({ exceptions, console: consoleMessages.slice(-6).map(entry => entry.args[0]?.value) }));
  await evaluate(() => {
    const s = window.simulator;
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    s.integratePhysics = () => {}; // Fixed pose, layout verification only.
  });
  let touch = false;
  const click = async (selector, minSize = 44) => {
    const point = await evaluate(sel => {
      const node = document.querySelector(sel);
      if (node.closest('.flight-more-panel, .ap-panel, .flight-toolbar')) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = node.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, w: r.width, h: r.height, hit: node.contains(document.elementFromPoint(x, y)) };
    }, selector);
    assert.ok(point.w >= minSize && point.h >= minSize && point.hit, `${selector}: reachable ${minSize}px target ${JSON.stringify(point)}`);
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
  const resize = async (width, height) => {
    touch = width < 1024;
    await send('Emulation.setDeviceMetricsOverride', { width, height, mobile: touch, deviceScaleFactor: 1 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
    await evaluate(enabled => {
      const s = window.simulator;
      enabled ? s.touchControls.enable() : s.touchControls.disable();
    }, touch);
    await delay(150);
  };
  const rects = () => evaluate(() => Object.fromEntries([
    'menu-toggle', 'btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser',
    'open-flight-more', 'btn-ap-toggle', 'btn-camera-toggle', 'ap-panel', 'hud-stall',
  ].map(id => [id, document.getElementById(id).getBoundingClientRect().toJSON()])));
  for (const [width, height] of [[320, 568], [390, 660], [568, 320], [667, 360], [926, 428], [1440, 900]]) {
    await resize(width, height);
    const before = await rects();
    const expectedOneRow = width >= 667;
    assert.equal(before['btn-gear'].top === before['menu-toggle'].top, expectedOneRow, 'expected row arrangement');
    for (const [id, bounds] of Object.entries(before)) {
      if (!bounds.width) continue;
      assert.ok(bounds.left >= 0 && bounds.right <= width, `${width}: ${id} fits: ${JSON.stringify(bounds)}`);
    }
    if (width === 320) {
      await evaluate(() => {
        const sim = window.simulator;
        sim.autopilot.master = true;
        sim.updateAutopilotUI();
        sim.cameraSystem.setGazeTarget({ kind: 'tower', label: 'Test target', position: sim.position.clone().addScalar(100) });
      });
    }
    await click('#btn-ap-toggle', 32);
    if (width === 320) {
      assert.ok(await evaluate(() => window.simulator.autopilot.master), 'AP panel does not disengage the master');
      await click('#btn-gaze-exit', 32);
      assert.ok(await evaluate(() => !window.simulator.cameraSystem.isGazeActive()), 'gaze can clear while AP is open');
    }
    const after = await rects();
    for (const id of ['btn-gear', 'btn-flaps-ext', 'btn-camera-toggle']) assert.deepEqual(after[id], before[id]);
    assert.ok(after['ap-panel'].width > 0, 'AP panel opens without replacing primary controls');
    if (width === 667) {
      const overlap = await evaluate(() => {
        const stall = document.getElementById('hud-stall');
        const warning = window.simulator.updateHUD;
        window.simulator.updateHUD = () => {};
        stall.style.display = 'block';
        const warningBox = stall.getBoundingClientRect();
        const panelBox = document.getElementById('ap-panel').getBoundingClientRect();
        stall.style.display = '';
        window.simulator.updateHUD = warning;
        return { warningLeft: warningBox.left, warningRight: warningBox.right, panelLeft: panelBox.left, panelHeight: panelBox.height };
      });
      assert.ok(overlap.warningLeft >= 0 && overlap.warningRight <= overlap.panelLeft && overlap.panelHeight <= 184, JSON.stringify(overlap));
    }
    await click('#btn-camera-toggle', 32);
    assert.equal(await evaluate(() => document.getElementById('ap-panel').hidden), true);
    assert.equal(await evaluate(() => document.querySelectorAll('#camera-strip [data-camera-mode]').length), 10);
    await click('#btn-cam-chase');
    assert.equal(await evaluate(() => document.getElementById('camera-strip').hidden), true);
    await click('#open-flight-more', 32);
    assert.equal(await evaluate(() => document.querySelector('#flight-more-panel #flight-park-brake') !== null), true);
    await click('#flight-more-panel .flight-strip-close', 32);
    if (!touch) {
      await click('#btn-fullscreen');
      assert.ok(await evaluate(() => Boolean(document.fullscreenElement)), 'enters fullscreen');
      await click('#btn-fullscreen');
      assert.ok(await evaluate(() => !document.fullscreenElement), 'exits fullscreen');
      await click('#open-flight-more');
      const trim = await evaluate(() => window.simulator.controls.pitchTrim);
      await click('#flight-trim-more');
      assert.ok(Math.abs(await evaluate(() => window.simulator.controls.pitchTrim) - trim - .2) < .001, 'trim changes');
      const brake = await evaluate(() => window.simulator.controls.parkingBrake);
      await click('#flight-park-brake');
      assert.equal(await evaluate(() => window.simulator.controls.parkingBrake), !brake);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      assert.ok(await evaluate(() => document.getElementById('flight-more-panel').hidden && document.body.dataset.flow === 'flight'));
    }
    if (touch) {
      await click('.flight-display-toggle', 32);
      assert.equal(await evaluate(() => document.getElementById('btn-mute').parentElement.id), 'flight-display-panel');
      const muted = await evaluate(() => window.simulator.audio.isMuted);
      await click('#btn-mute');
      assert.equal(await evaluate(() => window.simulator.audio.isMuted), !muted);
      await click('#btn-hud-fold');
      await click('#btn-hud-unfold', 32);
    }
    await screenshot(`${out}/${width}x${height}-strip-v2.png`);
    results.push({ width, height, bounds: before });
  }
  const chooseToolbar = async shown => {
    await evaluate(shown => {
      for (const input of document.querySelectorAll('#toolbar-options [data-toolbar-item]')) {
        if (input.checked !== shown.includes(input.dataset.toolbarItem)) input.click();
      }
    }, shown);
    await delay(150);
  };
  await chooseToolbar(['cam-chase']);
  await click('#btn-camera-toggle');
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('#camera-strip [data-camera-mode]:not([hidden])')].map(n => n.id)), ['btn-cam-chase']);
  await click('#btn-cam-chase');
  await evaluate(() => document.getElementById('toolbar-options-reset').click());
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
  await resize(390, 660);
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
  const heldPosition = await evaluate('window.simulator.position.toArray()');
  await click('#menu-toggle', 32);
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'lobby', 'menu button opens main menu directly');
  assert.ok(await evaluate('!document.getElementById("btn-lobby-resume").hidden'), 'main menu offers resume');
  // The menu button is a one-click toggle (1b46d29f): from the main menu it resumes
  // the held sortie rather than starting a new one.
  await evaluate(() => document.getElementById('menu-toggle').click());
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'flight', 'repeated menu press resumes the held flight');
  assert.deepEqual(await evaluate('window.simulator.position.toArray()'), heldPosition, 'menu toggle resume preserves held position');
  await click('#menu-toggle', 32);
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'lobby', 'menu button reopens main menu');
  await click('#btn-lobby-resume');
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'flight', 'resume returns to flight');
  assert.deepEqual(await evaluate('window.simulator.position.toArray()'), heldPosition, 'resume preserves held position');
  await click('#menu-toggle', 32);
  await evaluate(() => {
    const s = window.simulator;
    s.lobby.airport = s.activeAirport;
    s.lobby.aircraft = s.currentAircraftId;
    s.lobby.preset = 'runway';
    s.lobbyScreen.refresh();
    const respawn = s.setPreset;
    s.setPreset = function (...args) { this.__menuStarts = (this.__menuStarts || 0) + 1; return respawn.apply(this, args); };
  });
  // With a held sortie the menu replaces "start new" with an explicit restart
  // (UI state contract, 9596335a).
  assert.ok(await evaluate('document.getElementById("btn-fly").hidden'), 'held sortie hides start new');
  await click('#btn-lobby-restart');
  assert.equal(await evaluate('window.simulator.gameFlow.state'), 'flight', 'restart leaves main menu');
  assert.equal(await evaluate('window.simulator.__menuStarts'), 1, 'restart explicitly respawns');
  // A saved selection is restored by startup, before any option is touched.
  await chooseToolbar(['cam-chase', 'cam-cockpit']);
  await send('Page.reload');
  await delay(1000);
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)').catch(() => false)) break;
    await delay(500);
  }
  const restored = await evaluate(() => ({
    cameras: [...document.querySelectorAll('#camera-strip [data-camera-mode]')].filter(n => !n.hidden).map(n => n.id),
    fullscreenHidden: document.getElementById('btn-fullscreen').hidden,
    checked: [...document.querySelectorAll('#toolbar-options [data-toolbar-item]')].filter(n => n.checked).map(n => n.dataset.toolbarItem),
  }));
  assert.deepEqual(restored, { cameras: ['btn-cam-chase', 'btn-cam-cockpit'], fullscreenHidden: true, checked: ['cam-chase', 'cam-cockpit'] },
    `reload restores the selection: ${JSON.stringify(restored)}`);
  assert.deepEqual(exceptions, [], 'no browser exceptions');
  await writeFile(`${out}/results.json`, JSON.stringify({ gpu, results }, null, 2));
});
