import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Browser acceptance for the sortie state machine (issues #112 part 3, #130, #140, #322).
// The app boots straight into the flight HUD. From a flight the top-left toggle (or ESC)
// PAUSES the sortie: physics stop, the aircraft is handed to a slow drone orbit, the engine
// bus goes silent, and the pause card offers 계속하기 / 재시작 / 메인 메뉴. Resume gives
// back the exact camera the pilot was flying with.
// The main menu never touches the live scene: airport, aircraft and scenario picks stay
// pending until Fly, which rebuilds behind the loading card and then starts the sortie.
// A pick that changed nothing just releases the held flight. Desktop + mobile screenshots.

const PORT = Number(process.env.LOBBY_PORT) || 5179;
const CDP_PORT = Number(process.env.LOBBY_CDP_PORT) || 9469;
const SIM_URL = `http://localhost:${PORT}/`;
const ART_DIR = process.env.LOBBY_ART_DIR || '/tmp/lobby-artifacts';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testLobbyFlow() {
  mkdirSync(ART_DIR, { recursive: true });
  // A fixed port silently borrowed from another agent's dev server tests the
  // wrong build (and was the classic "flaky boot" here), so refuse to start.
  let squatted = false;
  try { squatted = (await fetch(SIM_URL)).ok; } catch (e) {}
  if (squatted) throw new Error(`Port ${PORT} already has a server; rerun with LOBBY_PORT=<free port>`);
  console.log('🚀 Starting Vite dev server on port ' + PORT);
  // detached + group kill: SIGKILLing the npx wrapper alone leaves the real
  // vite child running and squatting the port for the next run.
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });

  let serving = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { serving = (await fetch(SIM_URL)).ok; if (serving) break; } catch (e) {}
  }
  const killTree = (p) => {
    if (!p) return;
    try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { try { p.kill('SIGKILL'); } catch (e2) {} }
  };
  if (!serving) { killTree(vite); throw new Error(`Vite did not come up on port ${PORT}`); }

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
  ], { stdio: 'ignore', detached: true });

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
    const look = (label, state) => console.log(`🔍 ${label}:`, JSON.stringify(state));
    // One read covers every flow surface, so a renamed id or a moved field fails here
    // loudly instead of quietly returning undefined and asserting against a stale value.
    const simRead = (extra = '') => evalJs(`(() => {
      const sim = window.simulator, cam = sim.cameraSystem, M = cam.constructor.MODES;
      const gl = sim.renderer.getContext();
      const gpu = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        flow: document.body.dataset.flow,
        gpu: gpu ? String(gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL)).slice(0, 48) : 'unknown',
        lobbyVisible: getComputedStyle(document.getElementById('lobby-screen')).display !== 'none',
        pauseVisible: getComputedStyle(document.getElementById('pause-menu')).display !== 'none',
        toggleOpen: document.getElementById('menu-toggle').classList.contains('is-open'),
        toggleLabel: document.getElementById('menu-toggle').getAttribute('aria-label'),
        loadingVisible: !document.getElementById('startup-overlay').hidden,
        airport: sim.activeAirport, aircraft: sim.currentAircraftId, preset: sim.lastPresetType,
        wantAirport: sim.lobby.airport, wantAircraft: sim.lobby.aircraft, wantPreset: sim.lobby.preset,
        briefing: document.getElementById('lobby-briefing').textContent,
        storedAirport: localStorage.getItem('flight3d.airport'),
        storedAircraft: localStorage.getItem('flight3d.aircraft'),
        resumable: sim.gameFlow.canResumeFromLobby(),
        frozen: sim.gameFlow.isPhysicsFrozen(),
        demoActive: sim.demoDirector.isActive,
        blocked: sim.controls.inputBlocked,
        crashed: sim.isCrashed,
        alt: sim.telemetry.altitudeFt,
        camMode: cam.mode, camName: cam.getModeName(),
        camDrone: cam.mode === M.DRONE, camUserPicked: cam.userModeSelected, camAuto: cam.autoSwitch,
        camPos: cam.camera.position.toArray().map(v => Math.round(v)),
        audioPaused: !!sim.audio.isPaused,
        // The bus is ramped with setTargetAtTime, so the AudioParam value only follows once
        // the audio clock runs. Headless has no gesture-driven context; assert the target.
        audioTarget: sim.audio.effectiveVolume,
        audioCtx: sim.audio.ctx ? sim.audio.ctx.state : 'none',
        ${extra}
      };
    })()`);

    await send('Page.enable');
    await send('Runtime.enable');
    console.log('⏳ Waiting for simulator boot...');
    // "Booted" = first rendered frame: the .booting gate (which parks the HUD
    // over the black canvas) is only lifted right after renderer.render().
    let booted = false;
    for (let i = 0; i < 30 && !booted; i++) {
      booted = await evalJs(`!!(window.simulator && window.simulator.gameFlow
        && !document.body.classList.contains('booting'))`).catch(() => false);
      if (!booted) await sleep(1000);
    }
    if (!booted) throw new Error('Simulator never rendered its first frame');
    await sleep(1500);

    // 1. Boot lands straight in the flight HUD (#130): menu and pause card hidden,
    // no cinematic, the toggle reads as closed, and the sortie is not on the pause rig.
    const boot = await simRead();
    look('boot', boot);
    if (boot.flow !== 'flight') throw new Error('App must boot directly into the flight HUD');
    if (boot.lobbyVisible || boot.pauseVisible) throw new Error('Menu and pause card must be hidden at boot');
    if (boot.demoActive || boot.frozen || boot.blocked) throw new Error('Boot flight must be live, not held');
    if (boot.toggleOpen) throw new Error('Menu toggle must read as closed while flying');
    if (boot.camDrone) throw new Error('A flown sortie must not be framed by the pause rig');
    await screenshot('01-boot-flight');

    // 2. Keyboard steers the sim while flying.
    const flyingKey = await evalJs(`(() => {
      const sim = window.simulator;
      const before = sim.controls.throttle;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Equal', key: '=', bubbles: true }));
      sim.integratePhysics(0.1);
      const after = sim.controls.throttle;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Equal', key: '=' }));
      return { before, after, blocked: sim.controls.inputBlocked };
    })()`);
    look('flight input', flyingKey);
    if (flyingKey.blocked || !(flyingKey.after > flyingKey.before)) throw new Error('Throttle key must work in flight');

    // 3. The toggle PAUSES the sortie instead of opening the menu: the pause card is up,
    // physics stop, the aircraft goes to the drone rig and the bus goes silent.
    const beforePause = await simRead();
    await evalJs(`document.getElementById('menu-toggle').click()`);
    await sleep(400);
    const paused = await simRead('elev: sim.controls.elevator');
    look('toggle→pause', paused);
    if (paused.flow !== 'paused' || !paused.pauseVisible) throw new Error('The toggle must pause the sortie with the pause card up');
    if (paused.lobbyVisible) throw new Error('The toggle must open the pause card, not the main menu');
    if (!paused.frozen || !paused.blocked || paused.resumable) throw new Error('Pausing must freeze physics and block input');
    if (!paused.camDrone) throw new Error(`A paused sortie must be watched from the drone rig (${paused.camName})`);
    if (!paused.toggleOpen || paused.toggleLabel === beforePause.toggleLabel) {
      throw new Error('The toggle must read as open and re-labelled while paused');
    }
    if (!paused.audioPaused) throw new Error('Pausing must duck the audio bus');
    if (paused.audioGain !== null && paused.audioGain > 0.001) {
      throw new Error(`Paused audio leaked (master gain ${paused.audioGain})`);
    }
    await screenshot('02-pause-drone');

    // 3b. The rig keeps orbiting the frozen airframe: the camera moves, the aircraft does not.
    const orbitStart = paused.camPos;
    await sleep(3000);
    const orbit = await simRead();
    const moved = Math.hypot(orbit.camPos[0] - orbitStart[0], orbit.camPos[2] - orbitStart[2]);
    look('drone orbit', { moved, camPos: orbit.camPos, alt: [paused.alt, orbit.alt] });
    if (moved < 1) throw new Error(`Drone rig stopped with the sim (moved ${moved} m in 3s)`);
    if (Math.abs(orbit.alt - paused.alt) > 1.5) throw new Error('Physics not frozen while paused');
    if (!orbit.audioPaused) throw new Error('Pause must stay silent while the rig orbits');

    // 4. 계속하기 releases the hold, brings the sound back and hands the camera over.
    await evalJs(`document.getElementById('btn-pause-resume').click()`);
    let resumed = await simRead('elev: sim.controls.elevator');
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      resumed = await simRead('elev: sim.controls.elevator');
      if (resumed.flow === 'flight' && !resumed.blocked && Math.abs(resumed.elev) <= 0.05) break;
    }
    look('resume', resumed);
    if (resumed.flow !== 'flight' || resumed.blocked) throw new Error('Resume failed');
    if (Math.abs(resumed.elev) > 0.05) throw new Error(`Elevator did not neutralize after resume: ${resumed.elev}`);
    if (resumed.camDrone) throw new Error(`Resume left the sortie on the pause rig (${resumed.camName})`);
    if (resumed.camMode !== beforePause.camMode || resumed.camAuto !== beforePause.camAuto) {
      throw new Error(`Resume did not restore the view (${resumed.camName} ≠ ${beforePause.camName})`);
    }
    if (resumed.audioPaused) throw new Error('Resume must bring the sound back');
    if (resumed.audioGain !== null && resumed.audioGain < 0.5) {
      throw new Error(`Resume left the bus ducked (master gain ${resumed.audioGain})`);
    }
    await screenshot('03-resumed-flight');

    // 5. ESC pauses a pilot-chosen view, and ESC again restores that exact view.
    const picked = await evalJs(`(() => {
      const sim = window.simulator;
      sim.cameraSystem.setMode(sim.cameraSystem.constructor.MODES.WING, true);
      return { mode: sim.cameraSystem.mode, user: sim.cameraSystem.userModeSelected };
    })()`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(300);
    const escPaused = await simRead();
    look('esc pause', escPaused);
    if (escPaused.flow !== 'paused' || !escPaused.camDrone) throw new Error('ESC must pause onto the drone rig');
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(300);
    const escResumed = await simRead();
    look('esc resume', escResumed);
    if (escResumed.flow !== 'flight') throw new Error('ESC while paused must resume');
    if (escResumed.camMode !== picked.mode || !escResumed.camUserPicked) {
      throw new Error(`Resume did not restore the pilot's own view (${escResumed.camName})`);
    }

    // 6. Pause → 메인 메뉴 holds the sortie behind the menu: frozen, still framed by the
    // drone rig, silent, and with no cinematic replaying over it.
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(200);
    await evalJs(`document.getElementById('btn-pause-lobby').click()`);
    await sleep(400);
    const heldMenu = await simRead();
    look('pause→menu (held)', heldMenu);
    if (heldMenu.flow !== 'lobby' || !heldMenu.resumable || !heldMenu.frozen) {
      throw new Error('Returning to the menu must hold the flight (resumable + frozen)');
    }
    if (!heldMenu.lobbyVisible || heldMenu.pauseVisible || !heldMenu.toggleOpen) {
      throw new Error('Menu overlay must show, the pause card must close, toggle must read open');
    }
    if (!heldMenu.camDrone) throw new Error('A held sortie must stay framed by the drone rig while the menu is up');
    if (!heldMenu.audioPaused) throw new Error('A held sortie must be silent');
    if (heldMenu.demoActive) throw new Error('Cinematic must not replay while a flight is held');
    await screenshot('04-lobby-held');

    // 7. ESC inside the menu is a no-op.
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(150);
    if ((await simRead()).flow !== 'lobby') throw new Error('ESC must be ignored in the menu');

    // 8. Menu picks stay PENDING: the live scene, the flown scenario and storage all keep
    // their old values, the hold survives them, and the menu itself shows the wish.
    await evalJs(`document.getElementById('lobby-airport-lukla').click()`);
    await evalJs(`document.getElementById('lobby-aircraft-c172').click()`);
    await sleep(400);
    const wanted = await simRead('demoButton: getComputedStyle(document.getElementById("lobby-preset-demo")).display');
    look('pending picks', wanted);
    if (wanted.wantAirport !== 'lukla' || wanted.wantAircraft !== 'C172') {
      throw new Error('The menu did not record the requested airport and aircraft');
    }
    if (wanted.airport !== boot.airport || wanted.aircraft !== boot.aircraft || wanted.preset !== boot.preset) {
      throw new Error(`A menu pick touched the live scene (${wanted.airport}/${wanted.aircraft}/${wanted.preset})`);
    }
    if (wanted.storedAirport === 'lukla') throw new Error('An unflied pick must not be persisted');
    if (!wanted.resumable || !wanted.frozen || !wanted.camDrone || !wanted.audioPaused) {
      throw new Error('Browsing the menu must keep holding the sortie (frozen, drone, silent)');
    }
    if (!/24|tenzing|hilla|lukla/i.test(wanted.briefing)) {
      throw new Error('The menu briefing did not follow the pending airport: ' + wanted.briefing);
    }
    await screenshot('05-lobby-pending');

    // 9. Fly rebuilds behind the loading card, then hands over to the new sortie.
    // The card must be seen before the swap: under swiftshader the main thread can go
    // ~10s between frames while lukla terrain generates, so the waits budget minutes;
    // run with FORCE_GPU=1 (Vulkan) to make the whole scenario finish in seconds.
    await evalJs(`document.getElementById('btn-fly').click()`);
    const loading = await simRead();
    look('loading', { loadingVisible: loading.loadingVisible, camDrone: loading.camDrone });
    if (!loading.loadingVisible) throw new Error('Fly must raise the loading card before rebuilding the scene');
    let flown = await simRead();
    for (let i = 0; i < 960; i++) {
      await sleep(500);
      flown = await simRead();
      if (flown.flow === 'flight' && flown.airport === 'lukla' && !flown.loadingVisible) break;
    }
    look('after fly', flown);
    if (flown.flow !== 'flight' || flown.airport !== 'lukla' || flown.aircraft !== 'C172') {
      throw new Error(`Fly did not rebuild the scene for the pending selection (${flown.airport}/${flown.aircraft})`);
    }
    if (flown.loadingVisible) throw new Error('The loading card was left up after the start');
    if (flown.storedAirport !== 'lukla' || flown.storedAircraft !== 'C172') {
      throw new Error('The flown selection was not persisted for the next boot');
    }
    if (flown.camDrone || flown.audioPaused || flown.frozen || flown.blocked) {
      throw new Error('The new sortie did not take over camera, audio and input');
    }
    if (flown.crashed) throw new Error('The pending start spawned into a crash');
    await screenshot('06-lukla-flight');

    // 10. Same menu, nothing changed: Fly just releases the held sortie — no loading
    // card and no re-spawn, because the scene already matches the menu.
    await evalJs(`document.getElementById('menu-toggle').click()`);
    await sleep(300);
    await evalJs(`document.getElementById('btn-pause-lobby').click()`);
    await sleep(400);
    const heldAgain = await simRead();
    if (heldAgain.flow !== 'lobby' || !heldAgain.resumable) throw new Error('Menu did not hold the Lukla sortie');
    await evalJs(`document.getElementById('btn-fly').click()`);
    const noopStart = await simRead();
    await sleep(400);
    const released = await simRead();
    look('unchanged fly', { loadingVisible: noopStart.loadingVisible, flow: released.flow, alt: [heldAgain.alt, released.alt] });
    if (noopStart.loadingVisible) throw new Error('An unchanged menu must not raise the loading card');
    if (released.flow !== 'flight' || released.frozen || released.resumable) {
      throw new Error('Fly with nothing changed must resume the held flight');
    }
    if (Math.abs(released.alt - heldAgain.alt) > 5) throw new Error('Unchanged Fly respawned instead of resuming');
    if (released.airport !== 'lukla') throw new Error('Unchanged Fly rebuilt the scene it was holding');

    // 11. Scenario picks are pending too, and a scenario-only start needs no rebuild:
    // the demo waits for Fly, then takes over the same airport.
    await evalJs(`document.getElementById('menu-toggle').click()`);
    await sleep(300);
    await evalJs(`document.getElementById('btn-pause-lobby').click()`);
    await sleep(400);
    if (wanted.demoButton === 'none') throw new Error('Demo scenario is not offered at Lukla with a C172');
    await evalJs(`document.getElementById('lobby-preset-demo').click()`);
    const demoPending = await simRead();
    look('demo pending', { want: demoPending.wantPreset, flown: demoPending.preset, airport: demoPending.airport });
    if (demoPending.wantPreset !== 'demo' || demoPending.preset === 'demo') {
      throw new Error('A scenario pick must stay pending until Fly');
    }
    if (!demoPending.resumable) throw new Error('A scenario pick must not drop the held sortie');
    await evalJs(`document.getElementById('btn-fly').click()`);
    const demoStart = await simRead();
    if (demoStart.loadingVisible) throw new Error('A scenario-only change must not raise the scene-rebuild card');
    let demoFlight = await simRead('banner: getComputedStyle(document.getElementById("demo-banner")).display');
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      demoFlight = await simRead('banner: getComputedStyle(document.getElementById("demo-banner")).display');
      if (demoFlight.flow === 'flight' && (demoFlight.demoActive || demoFlight.banner !== 'none')) break;
    }
    look('demo flight', { flow: demoFlight.flow, demo: demoFlight.demoActive, banner: demoFlight.banner, airport: demoFlight.airport });
    if (demoFlight.flow !== 'flight' || (!demoFlight.demoActive && demoFlight.banner === 'none')) {
      throw new Error('Fly did not start the demo scenario');
    }
    if (demoFlight.airport !== 'lukla') throw new Error('The demo start changed the airport');
    await screenshot('07-demo-flight');

    // 12. Pausing the demo holds it the same way: frozen, silent, on the drone rig.
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(400);
    const demoPaused = await simRead();
    look('demo paused', { flow: demoPaused.flow, cam: demoPaused.camName, audio: demoPaused.audioPaused });
    if (demoPaused.flow !== 'paused' || !demoPaused.frozen || !demoPaused.camDrone || !demoPaused.audioPaused) {
      throw new Error('ESC during a demo flight must pause it onto the drone rig');
    }
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(300);

    // 13. Mobile portrait: the lobby renders as a bottom sheet with a touch-sized Fly.
    await evalJs(`document.getElementById('menu-toggle').click()`);   // flight -> pause
    await sleep(200);
    await evalJs(`document.getElementById('btn-pause-lobby').click()`);
    await sleep(400);
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
    look('mobile lobby', mobile);
    if (!mobile.cardVisible) throw new Error('Lobby card not rendered on mobile');
    if (mobile.flyH < 40) throw new Error('Fly button too small for touch');
    await screenshot('08-lobby-mobile');

    console.log('✅ ALL LOBBY/PAUSE FLOW CHECKS PASSED');
    ws.close();
  } finally {
    killTree(chrome);
    killTree(vite);
  }
}

testLobbyFlow().catch(err => {
  console.error('❌ Lobby flow verification failed:', err);
  process.exit(1);
});
