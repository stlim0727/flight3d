import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Browser acceptance for the lobby/pause flow (issue #112 part 3).
// Boots the page, verifies menu gating, Fly handoff, ESC pause, lobby return
// (pause menu and HUD toolbar button), demo loop-restart, airport switching —
// plus desktop + mobile screenshots.

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

    // 8. Pause → return to lobby; the cinematic must re-arm and restart.
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(200);
    await evalJs(`document.getElementById('btn-pause-lobby').click()`);
    const lobbyBack = await evalJs(`document.body.dataset.flow`);
    if (lobbyBack !== 'lobby') throw new Error('Return to lobby failed');
    let restarted = false;
    for (let i = 0; i < 60 && !restarted; i++) {
      await sleep(500);
      restarted = await evalJs(`window.simulator.demoDirector.isActive`);
    }
    if (!restarted) throw new Error('Demo did not restart behind the lobby within 30s');
    const backdropAirport = await evalJs(`window.simulator.demoDirector.activeDemoAirport`);
    if (backdropAirport !== 'coastal') throw new Error(`Backdrop should replay coastal, got ${backdropAirport}`);
    console.log('🔍 lobby loop restart OK (coastal)');
    await screenshot('05-lobby-loop');

    // 9. ESC inside the lobby is a no-op.
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(150);
    if (await evalJs(`document.body.dataset.flow`) !== 'lobby') throw new Error('ESC must be ignored in lobby');

    // 10. HUD toolbar "Main menu" button returns to the lobby directly from flight.
    await evalJs(`document.getElementById('btn-fly').click()`);
    await sleep(600);
    const hudMenu = await evalJs(`(() => {
      const btn = document.getElementById('btn-hud-menu');
      return {
        flow: document.body.dataset.flow,
        toolbarVisible: btn ? getComputedStyle(btn).display !== 'none' : false,
        label: btn ? btn.textContent : '',
      };
    })()`);
    console.log('🔍 hud menu in flight:', JSON.stringify(hudMenu));
    if (hudMenu.flow !== 'flight' || !hudMenu.toolbarVisible || !hudMenu.label.includes('🏠')) {
      throw new Error('Main menu button must be visible in the flight toolbar');
    }
    await evalJs(`document.getElementById('btn-hud-menu').click()`);
    const hudLobby = await evalJs(`(() => {
      const sim = window.simulator;
      return {
        flow: document.body.dataset.flow,
        blocked: sim.controls.inputBlocked,
        lobbyVisible: getComputedStyle(document.getElementById('lobby-screen')).display !== 'none',
        toolbarHidden: getComputedStyle(document.querySelector('.flight-toolbar')).display === 'none',
      };
    })()`);
    console.log('🔍 hud return:', JSON.stringify(hudLobby));
    if (hudLobby.flow !== 'lobby' || !hudLobby.blocked || !hudLobby.lobbyVisible || !hudLobby.toolbarHidden) {
      throw new Error('HUD main-menu button did not return to the lobby');
    }
    let hudRestarted = false;
    for (let i = 0; i < 60 && !hudRestarted; i++) {
      await sleep(500);
      hudRestarted = await evalJs(`window.simulator.demoDirector.isActive`);
    }
    if (!hudRestarted) throw new Error('Demo did not restart after HUD return to lobby within 30s');
    console.log('🔍 HUD lobby return + loop restart OK');
    await screenshot('06-hud-return-lobby');

    // 11. Mobile portrait: lobby renders as a bottom sheet.
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
