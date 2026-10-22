import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Browser acceptance for the lobby/pause flow (issue #112 part 3).
// Boots the page, verifies menu gating, Fly handoff, ESC pause, and the top-left
// menu toggle: opening it from a flight holds that flight (frozen, no cinematic)
// and the same toggle resumes it; airport switching abandons the held flight so
// the toggle launches the new selection. Also checks the boot-menu loop restart
// and airport switching, plus desktop + mobile screenshots.

const PORT = 5179;
const CDP_PORT = 9469;
const SIM_URL = `http://localhost:${PORT}/`;
const ART_DIR = process.env.LOBBY_ART_DIR || '/tmp/lobby-artifacts';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testLobbyFlow() {
  mkdirSync(ART_DIR, { recursive: true });
  console.log('🚀 Starting Vite dev server on port ' + PORT);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });

  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { if ((await fetch(SIM_URL)).ok) break; } catch (e) {}
  }

  const profileDir = `/tmp/chrome-lobby-flow-${Date.now()}`;
  const chrome = spawn('google-chrome-stable', [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1440,900',
    '--use-gl=angle',
    process.env.FORCE_GPU === '1' ? '--use-angle=vulkan' : '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    SIM_URL,
  ], { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {}
    }
    if (!pageTarget) throw new Error('CDP target not found');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res?.exceptionDetails) {
        throw new Error(`Browser JS Error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
      }
      return res?.result?.value;
    };
    const screenshot = async (name) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${ART_DIR}/${name}.png`, Buffer.from(shot.data, 'base64'));
      console.log(`📸 ${ART_DIR}/${name}.png`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    console.log('⏳ Waiting 4s for simulator boot...');
    await sleep(4000);

    // 1. Boot lands in the lobby with the cinematic demo running.
    const boot = await evalJs(`(() => {
      const sim = window.simulator;
      const hudStrip = document.querySelector('.hud-strip');
      return {
        flow: document.body.dataset.flow,
        lobbyDisplay: getComputedStyle(document.getElementById('lobby-screen')).display,
        hudStripVisible: hudStrip ? getComputedStyle(hudStrip).display !== 'none' : false,
        demoActive: sim.demoDirector.isActive,
        briefing: document.getElementById('lobby-briefing').textContent,
        flyLabel: document.getElementById('btn-fly').textContent,
      };
    })()`);
    console.log('🔍 boot:', JSON.stringify(boot));
    if (boot.flow !== 'lobby' || boot.lobbyDisplay === 'none') throw new Error('Lobby must be visible at boot');
    if (boot.hudStripVisible) throw new Error('HUD must be hidden in the lobby');
    if (!boot.demoActive) throw new Error('Cinematic demo must be playing behind the lobby');
    if (!/090/.test(boot.briefing)) throw new Error(`Coastal briefing missing runway data: ${boot.briefing}`);
    await screenshot('01-lobby-coastal');

    // 2. Keyboard input must not steer the sim while the lobby is up.
    const gated = await evalJs(`(() => {
      const sim = window.simulator;
      const before = sim.controls.throttle;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Equal', key: '=', bubbles: true }));
      const after = sim.controls.throttle;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Equal', key: '=' }));
      return { before, after, blocked: sim.controls.inputBlocked };
    })()`);
    console.log('🔍 input gating:', JSON.stringify(gated));
    if (!gated.blocked || gated.after !== gated.before) throw new Error('Throttle key must be blocked in lobby');

    // 3. The lobby only offers the coastal airport; clicking it must keep the
    // lobby and backdrop scoped to coastal.
    await evalJs(`document.getElementById('lobby-airport-coastal').click()`);
    await sleep(1200);
    const coastal = await evalJs(`(() => {
      const sim = window.simulator;
      return {
        airport: sim.activeAirport,
        lobbyAirport: sim.lobby.airport,
        briefing: document.getElementById('lobby-briefing').textContent,
        cliffHidden: document.getElementById('lobby-preset-cliff').style.display === 'none',
      };
    })()`);
    console.log('🔍 coastal:', JSON.stringify(coastal));
    if (coastal.airport !== 'coastal' || !/090/.test(coastal.briefing) || !coastal.cliffHidden) {
      throw new Error('Coastal lobby state/briefing mismatch');
    }
    await screenshot('02-lobby-coastal');

    // 4. Spawn preset pick is pending (demo keeps playing), Fly applies it.
    // setAirport stops the scenario; the flow controller re-arms it after a 1.5s
    // countdown measured in clamped frame deltas (~0.1s/frame), which takes
    // noticeably longer than wall-clock under swiftshader — budget 30s.
    let backdropPlaying = false;
    for (let i = 0; i < 60 && !backdropPlaying; i++) {
      await sleep(500);
      backdropPlaying = await evalJs(`window.simulator.demoDirector.isActive`);
    }
    if (!backdropPlaying) {
      const diag = await evalJs(`(() => {
        const sim = window.simulator, gf = sim.gameFlow;
        return {
          flow: document.body.dataset.flow,
          gf: { state: gf.state, countdown: gf._countdown, demoWasActive: gf._demoWasActive,
                restartPending: gf._restartPending, fastEnds: gf._fastEnds,
                lastRestartAt: gf._lastRestartAt, elapsed: gf._elapsed, loopCap: gf.isLoopCapTripped() },
          demo: { active: sim.demoDirector.isActive, waiting: sim.demoDirector.waitingForTerrain },
          sim: { crashed: sim.isCrashed, airport: sim.activeAirport },
        };
      })()`);
      throw new Error('Backdrop demo did not restart after airport switch: ' + JSON.stringify(diag, null, 1));
    }
    await evalJs(`document.getElementById('lobby-preset-cru').click()`);
    const pendingCheck = await evalJs(`(() => {
      const sim = window.simulator;
      return { pending: sim.lobby.preset, demoActive: sim.demoDirector.isActive };
    })()`);
    if (pendingCheck.pending !== 'cruise' || !pendingCheck.demoActive) {
      throw new Error('Preset pick must stay pending while the demo plays');
    }
    await evalJs(`document.getElementById('btn-fly').click()`);
    await sleep(600);
    const flight = await evalJs(`(() => {
      const sim = window.simulator;
      return {
        flow: document.body.dataset.flow,
        demoActive: sim.demoDirector.isActive,
        hudVisible: getComputedStyle(document.querySelector('.hud-strip')).display !== 'none',
        lobbyHidden: getComputedStyle(document.getElementById('lobby-screen')).display === 'none',
        ias: sim.telemetry.iasKnots,
        alt: sim.telemetry.altitudeFt,
        gearDown: sim.gear.gearState > 0.5,
        crashed: sim.isCrashed,
      };
    })()`);
    console.log('🔍 after fly:', JSON.stringify(flight));
    if (flight.flow !== 'flight' || flight.demoActive || flight.lobbyHidden === false) {
      throw new Error('Fly did not hand over to flight');
    }
    if (flight.alt < 1000 || flight.gearDown) {
      throw new Error(`Coastal cruise preset not applied (alt ${flight.alt}, gearDown ${flight.gearDown})`);
    }
    await screenshot('03-in-flight');

    // 5. Keyboard works again in flight.
    const flying = await evalJs(`(() => {
      const sim = window.simulator;
      const before = sim.controls.throttle;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Equal', key: '=' }));
      sim.integratePhysics(0.1);
      const after = sim.controls.throttle;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Equal', key: '=' }));
      return { before, after, blocked: sim.controls.inputBlocked };
    })()`);
    if (flying.blocked || !(flying.after > flying.before)) throw new Error('Throttle key must work in flight');

    // 6. ESC pauses: physics frozen, menu up; held keys released.
    await evalJs(`(() => {
      const sim = window.simulator;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    })()`);
    await sleep(300);
    const paused = await evalJs(`(() => {
      const sim = window.simulator;
      const alt = sim.telemetry.altitudeFt;
      return { flow: document.body.dataset.flow, alt, blocked: sim.controls.inputBlocked, elev: sim.controls.elevator };
    })()`);
    await sleep(700);
    const stillFrozen = await evalJs(`(() => {
      const sim = window.simulator;
      return { alt: sim.telemetry.altitudeFt, elev: sim.controls.elevator, pitchHeld: !!sim.controls.keys['KeyW'] };
    })()`);
    console.log('🔍 paused:', JSON.stringify({ ...paused, ...stillFrozen }));
    if (paused.flow !== 'paused' || !paused.blocked) throw new Error('ESC did not open the pause menu');
    if (Math.abs(stillFrozen.alt - paused.alt) > 1.5) throw new Error('Physics not frozen while paused');
    if (stillFrozen.pitchHeld) throw new Error('Held keys must be released on pause');
    // Physics is frozen, so the slewed elevator cannot decay yet — but it must be
    // stuck (no input processing) and must spring back to neutral after resume.
    if (Math.abs(stillFrozen.elev - paused.elev) > 0.02) throw new Error('Elevator moved while paused');
    await screenshot('04-pause');

    // 7. Resume restores flight; released stick returns to center.
    await evalJs(`document.getElementById('btn-pause-resume').click()`);
    let resumed = { flow: 'paused', blocked: true, elev: 1 };
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      resumed = await evalJs(`(() => ({
        flow: document.body.dataset.flow,
        blocked: window.simulator.controls.inputBlocked,
        elev: window.simulator.controls.elevator,
      }))()`);
      if (resumed.flow === 'flight' && !resumed.blocked && Math.abs(resumed.elev) <= 0.05) break;
    }
    console.log('🔍 resumed:', JSON.stringify(resumed));
    if (resumed.flow !== 'flight' || resumed.blocked) throw new Error('Resume failed');
    if (Math.abs(resumed.elev) > 0.05) throw new Error(`Elevator did not neutralize after resume: ${resumed.elev}`);

    // 8. Pause → main menu HOLDS the live flight (frozen, no cinematic); the
    // top-left toggle then drops straight back into the same aircraft.
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(200);
    await evalJs(`document.getElementById('btn-pause-lobby').click()`);
    await sleep(400);
    const heldMenu = await evalJs(`(() => {
      const sim = window.simulator, gf = sim.gameFlow;
      return {
        flow: document.body.dataset.flow,
        resumable: gf.canResumeFromLobby(),
        frozen: gf.isPhysicsFrozen(),
        demoActive: sim.demoDirector.isActive,
        lobbyVisible: getComputedStyle(document.getElementById('lobby-screen')).display !== 'none',
        toggleOpen: document.getElementById('menu-toggle').classList.contains('is-open'),
        alt: sim.telemetry.altitudeFt,
      };
    })()`);
    console.log('🔍 pause→menu (held):', JSON.stringify(heldMenu));
    if (heldMenu.flow !== 'lobby' || !heldMenu.resumable || !heldMenu.frozen) {
      throw new Error('Returning to the menu must hold the flight (resumable + frozen)');
    }
    if (!heldMenu.lobbyVisible || !heldMenu.toggleOpen) throw new Error('Menu overlay + open-state toggle must show');
    if (heldMenu.demoActive) throw new Error('Cinematic must not replay while a flight is held');
    if (heldMenu.alt < 1000) throw new Error('Held aircraft fell out of cruise while in the menu');
    await screenshot('05-lobby-held');

    // 8a. Same toggle closes the menu and resumes the held aircraft (no respawn).
    await evalJs(`document.getElementById('menu-toggle').click()`);
    await sleep(300);
    const resumedFlight = await evalJs(`(() => {
      const sim = window.simulator, gf = sim.gameFlow;
      return {
        flow: document.body.dataset.flow,
        frozen: gf.isPhysicsFrozen(),
        resumable: gf.canResumeFromLobby(),
        toggleOpen: document.getElementById('menu-toggle').classList.contains('is-open'),
        alt: sim.telemetry.altitudeFt,
      };
    })()`);
    console.log('🔍 toggle→flight:', JSON.stringify(resumedFlight));
    if (resumedFlight.flow !== 'flight' || resumedFlight.frozen || resumedFlight.resumable) {
      throw new Error('Toggle did not resume the held flight');
    }
    if (resumedFlight.toggleOpen) throw new Error('Toggle should read as closed once flying');
    if (resumedFlight.alt < 1000) throw new Error('Toggle respawned to the runway instead of resuming');

    // 8b. Open the menu via the toggle; the demo scenario is selectable and Fly starts it.
    await evalJs(`document.getElementById('menu-toggle').click()`);   // flight -> held menu
    await sleep(300);
    await evalJs(`document.getElementById('lobby-preset-demo').click()`);
    const demoPending = await evalJs(`(() => ({
      pending: window.simulator.lobby.preset,
      active: document.getElementById('lobby-preset-demo').classList.contains('active'),
      briefing: document.getElementById('lobby-briefing').textContent,
    }))()`);
    if (demoPending.pending !== 'demo' || !demoPending.active || !/demo flight/i.test(demoPending.briefing)) {
      throw new Error('Demo scenario not selectable in menu: ' + JSON.stringify(demoPending));
    }
    await evalJs(`document.getElementById('btn-fly').click()`);
    await sleep(800);
    const demoFlight = await evalJs(`(() => {
      const sim = window.simulator;
      return {
        flow: document.body.dataset.flow,
        active: sim.demoDirector.isActive,
        bannerVisible: getComputedStyle(document.getElementById('demo-banner')).display !== 'none',
      };
    })()`);
    console.log('🔍 demo scenario:', JSON.stringify(demoFlight));
    if (demoFlight.flow !== 'flight' || !demoFlight.active || !demoFlight.bannerVisible) {
      throw new Error('Demo scenario did not start a demo flight');
    }
    await screenshot('05b-demo-flight');

    // 9. ESC inside the menu is a no-op.
    await evalJs(`document.getElementById('menu-toggle').click()`);   // open menu (holds demo)
    await sleep(300);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(150);
    if (await evalJs(`document.body.dataset.flow`) !== 'lobby') throw new Error('ESC must be ignored in the menu');

    // 10. The top-left toggle holds the flight; switching airport abandons the
    //     hold so the toggle falls back to launching the newly selected scenario.
    await evalJs(`document.getElementById('menu-toggle').click()`);   // resume demo flight
    await sleep(300);
    await evalJs(`document.getElementById('menu-toggle').click()`);   // flight -> held menu
    await sleep(300);
    const hudHeld = await evalJs(`(() => {
      const sim = window.simulator, gf = sim.gameFlow;
      return {
        flow: document.body.dataset.flow,
        blocked: sim.controls.inputBlocked,
        resumable: gf.canResumeFromLobby(),
        toolbarHidden: getComputedStyle(document.querySelector('.flight-toolbar')).display === 'none',
      };
    })()`);
    console.log('🔍 hud return (held):', JSON.stringify(hudHeld));
    if (hudHeld.flow !== 'lobby' || !hudHeld.blocked || !hudHeld.resumable) {
      throw new Error('Menu toggle must return to the menu holding the flight');
    }
    if (!hudHeld.toolbarHidden) throw new Error('Toolbar must be hidden in the menu');

    // Changing the airport re-spawns the aircraft, so the held flight is released.
    await evalJs(`document.getElementById('lobby-airport-lukla').click()`);
    await sleep(600);
    const afterSwitch = await evalJs(`(() => {
      const sim = window.simulator, gf = sim.gameFlow;
      return { airport: sim.activeAirport, resumable: gf.canResumeFromLobby(), frozen: gf.isPhysicsFrozen() };
    })()`);
    console.log('🔍 airport switch abandons hold:', JSON.stringify(afterSwitch));
    if (afterSwitch.airport !== 'lukla' || afterSwitch.resumable || afterSwitch.frozen) {
      throw new Error('Airport switch must abandon the held flight and unfreeze the menu');
    }
    await screenshot('06-menu-abandon-on-switch');

    // With no flight held, the toggle now launches the selected scenario.
    await evalJs(`document.getElementById('menu-toggle').click()`);
    await sleep(400);
    if (await evalJs(`document.body.dataset.flow`) !== 'flight') {
      throw new Error('Toggle from a non-held menu must launch the flight');
    }
    console.log('🔍 toggle-launch-from-fresh-menu OK');

    // 11. Mobile portrait: lobby renders as a bottom sheet.
    await evalJs(`document.getElementById('menu-toggle').click()`);   // back into the menu
    await sleep(300);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(600);
    const mobile = await evalJs(`(() => {
      const card = document.querySelector('.lobby-card');
      const btn = document.getElementById('btn-fly').getBoundingClientRect();
      return { cardVisible: card.getBoundingClientRect().height > 100, flyH: btn.height };
    })()`);
    console.log('🔍 mobile lobby:', JSON.stringify(mobile));
    if (!mobile.cardVisible) throw new Error('Lobby card not rendered on mobile');
    if (mobile.flyH < 40) throw new Error('Fly button too small for touch');
    await screenshot('07-lobby-mobile');

    console.log('✅ ALL LOBBY/PAUSE FLOW CHECKS PASSED');
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    vite.kill('SIGKILL');
  }
}

testLobbyFlow().catch(err => {
  console.error('❌ Lobby flow verification failed:', err);
  process.exit(1);
});
