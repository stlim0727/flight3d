import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const port = Number(process.env.CDP_PORT || 9478);
const vitePort = Number(process.env.VITE_PORT || 5198);
const profile = await mkdtemp(join(tmpdir(), 'flight3d-verify-restore-'));

// 1. Start Vite
const vite = spawn('npx', ['vite', '--port', String(vitePort), '--strictPort'], {
  stdio: 'pipe',
  cwd: process.cwd(),
});
vite.stderr.on('data', data => console.error(`vite err: ${data}`));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Wait for Vite server
let viteReady = false;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${vitePort}`);
    if (res.ok) {
      viteReady = true;
      break;
    }
  } catch {
    /* wait */
  }
  await delay(100);
}
assert.ok(viteReady, 'Vite server started');

// 2. Start Chrome
const chrome = spawn('google-chrome', [
  '--headless=new',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--window-size=1280,800',
  '--no-first-run',
  '--no-default-browser-check',
  '--use-gl=angle',
  '--use-angle=vulkan',
  'about:blank',
], { stdio: 'ignore' });

let socket;
let verificationFailed = false;
let nextId = 1;
const pending = new Map();

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`${method} timed out`));
  }, 60000);
  pending.set(id, {
    resolve: r => { clearTimeout(timer); resolve(r); },
    reject: e => { clearTimeout(timer); reject(e); },
  });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async fn => {
  const expr = typeof fn === 'function' ? `(${fn})()` : fn;
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
};

try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find(t => t.type === 'page');
    } catch {
      /* waiting */
    }
    if (!target) await delay(100);
  }
  assert.ok(target, 'Chrome page target found');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');

  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.consoleAPICalled') {
      console.log('BROWSER CONSOLE:', m.params.type, m.params.args.map(a => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console.error('BROWSER EXCEPTION:', m.params.exceptionDetails);
    }
    const req = pending.get(m.id);
    if (!req) return;
    pending.delete(m.id);
    if (m.error) req.reject(new Error(m.error.message));
    else req.resolve(m.result);
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` });

  const waitForSimReady = async () => {
    for (let i = 0; i < 200; i++) {
      // An in-flight navigation makes Runtime.evaluate reject with "Inspected target
      // navigated or closed"; that just means the reload has not booted yet.
      let ready = false;
      try {
        ready = await evaluate(() => Boolean(window.simulator?.startupReady));
      } catch {
        ready = false;
      }
      if (ready) return;
      await delay(200);
    }
    throw new Error('Timed out waiting for simulator ready');
  };

  await waitForSimReady();
  console.log('Simulator booted initially');

  // A menu pick is a wish, not a change (#322): nothing may touch the live scene or
  // storage until Fly rebuilds the sortie, so a reload can never restore a flight
  // that was only ever clicked at.
  const pick = async (buttonIds, want) => {
    await evaluate(`(() => {
      for (const id of ${JSON.stringify(buttonIds)}) document.getElementById(id)?.click();
      return true;
    })()`);
    await delay(200);
    const state = await evaluate(() => ({
      liveAirport: window.simulator.activeAirport,
      liveAircraft: window.simulator.currentAircraftId,
      wantAirport: window.simulator.lobby.airport,
      wantAircraft: window.simulator.lobby.aircraft,
      wantPreset: window.simulator.lobby.preset,
      storedAirport: localStorage.getItem('flight3d.airport'),
    }));
    assert.equal(state.wantAirport, want.airport, 'The menu did not record the picked airport');
    assert.equal(state.wantAircraft, want.aircraft, 'The menu did not record the picked aircraft');
    assert.equal(state.wantPreset, want.preset, 'The menu did not record the picked scenario');
    assert.notEqual(state.storedAirport, want.airport, 'An unflied pick must not be persisted');
    return state;
  };

  const startAndSettle = async (expect) => {
    await evaluate(`document.getElementById('btn-fly').click()`);
    for (let i = 0; i < 200; i++) {
      const state = await evaluate(() => ({
        airport: window.simulator.activeAirport,
        aircraft: window.simulator.currentAircraftId,
        preset: window.simulator.lastPresetType,
        starting: window.simulator.startingFlight,
        loading: !document.getElementById('startup-overlay').hidden,
      }));
      if (!state.starting && !state.loading && state.airport === expect.airport
        && state.aircraft === expect.aircraft && state.preset === expect.preset) return state;
      await delay(200);
    }
    throw new Error(`Fly did not apply the pending selection ${JSON.stringify(expect)}`);
  };

  // Verify initial defaults (first visit)
  const initial = await evaluate(() => ({
    airport: window.simulator.activeAirport,
    aircraft: window.simulator.currentAircraftId,
    scenario: window.simulator.lobby.preset,
  }));
  assert.equal(initial.airport, 'coastal', 'Default airport is coastal');
  assert.equal(initial.aircraft, 'B738', 'Default aircraft is B738');
  assert.equal(initial.scenario, 'runway', 'Default scenario is runway');
  console.log('Initial defaults verified:', initial);

  // Select airport = 'lukla', aircraft = 'C172', scenario = 'approach' via Lobby UI buttons
  const pending1 = await pick(
    ['lobby-airport-lukla', 'lobby-aircraft-c172', 'lobby-preset-app'],
    { airport: 'lukla', aircraft: 'C172', preset: 'approach' },
  );
  assert.equal(pending1.liveAirport, 'coastal', 'A pick must not rebuild the live scene');
  assert.equal(pending1.liveAircraft, 'B738', 'A pick must not swap the live aircraft');

  // Fly is what applies it; only then is the selection worth persisting.
  await startAndSettle({ airport: 'lukla', aircraft: 'C172', preset: 'approach' });

  // Verify localStorage contains the saved values
  const stored = await evaluate(() => ({
    airport: localStorage.getItem('flight3d.airport'),
    aircraft: localStorage.getItem('flight3d.aircraft'),
    plane: localStorage.getItem('flight3d.plane'),
    scenario: localStorage.getItem('flight3d.scenario'),
    preset: localStorage.getItem('flight3d.preset'),
  }));
  assert.equal(stored.airport, 'lukla');
  assert.equal(stored.aircraft, 'C172');
  assert.equal(stored.plane, 'C172');
  assert.equal(stored.scenario, 'approach');
  assert.equal(stored.preset, 'approach');
  console.log('LocalStorage correctly saved selection:', stored);

  // Reload the page
  console.log('Reloading page...');
  await evaluate(() => { window.simulator = null; });
  await send('Page.reload');
  await waitForSimReady();
  console.log('Simulator ready after first reload');

  // Verify state restored on page reload
  const restored1 = await evaluate(() => ({
    airport: window.simulator.activeAirport,
    aircraft: window.simulator.currentAircraftId,
    lobbyAirport: window.simulator.lobby.airport,
    lobbyAircraft: window.simulator.lobby.aircraft,
    lobbyScenario: window.simulator.lobby.preset,
    lastPreset: window.simulator.lastPresetType,
    luklaButtonActive: document.getElementById('lobby-airport-lukla')?.classList.contains('active'),
    c172ButtonActive: document.getElementById('lobby-aircraft-c172')?.classList.contains('active'),
    appButtonActive: document.getElementById('lobby-preset-app')?.classList.contains('active'),
  }));
  console.log('Restored state 1:', restored1);
  assert.equal(restored1.airport, 'lukla', 'Airport restored to lukla');
  assert.equal(restored1.aircraft, 'C172', 'Aircraft restored to C172');
  assert.equal(restored1.lobbyAirport, 'lukla', 'Lobby airport restored to lukla');
  assert.equal(restored1.lobbyAircraft, 'C172', 'Lobby aircraft restored to C172');
  assert.equal(restored1.lobbyScenario, 'approach', 'Lobby scenario restored to approach');
  assert.equal(restored1.lastPreset, 'approach', 'Last preset restored to approach');
  assert.equal(restored1.luklaButtonActive, true, 'Lukla button has active class');
  assert.equal(restored1.c172ButtonActive, true, 'C172 button has active class');
  assert.equal(restored1.appButtonActive, true, 'Approach button has active class');

  // Now change selection to neon, F16, cruise
  const pending2 = await pick(
    ['lobby-airport-neon', 'lobby-aircraft-f16', 'lobby-preset-cru'],
    { airport: 'neon', aircraft: 'F16', preset: 'cruise' },
  );
  assert.equal(pending2.liveAirport, 'lukla', 'A pick must not rebuild the flown scene');
  assert.equal(pending2.liveAircraft, 'C172', 'A pick must not swap the flown aircraft');
  await startAndSettle({ airport: 'neon', aircraft: 'F16', preset: 'cruise' });

  const stored2 = await evaluate(() => ({
    airport: localStorage.getItem('flight3d.airport'),
    aircraft: localStorage.getItem('flight3d.aircraft'),
    scenario: localStorage.getItem('flight3d.scenario'),
  }));
  assert.equal(stored2.airport, 'neon');
  assert.equal(stored2.aircraft, 'F16');
  assert.equal(stored2.scenario, 'cruise');
  console.log('Second selection saved to localStorage:', stored2);

  // Reload the page a second time
  console.log('Reloading page second time...');
  await evaluate(() => { window.simulator = null; });
  await send('Page.reload');
  await waitForSimReady();
  console.log('Simulator ready after second reload');

  const restored2 = await evaluate(() => ({
    airport: window.simulator.activeAirport,
    aircraft: window.simulator.currentAircraftId,
    lobbyAirport: window.simulator.lobby.airport,
    lobbyAircraft: window.simulator.lobby.aircraft,
    lobbyScenario: window.simulator.lobby.preset,
    lastPreset: window.simulator.lastPresetType,
    neonButtonActive: document.getElementById('lobby-airport-neon')?.classList.contains('active'),
    f16ButtonActive: document.getElementById('lobby-aircraft-f16')?.classList.contains('active'),
    cruButtonActive: document.getElementById('lobby-preset-cru')?.classList.contains('active'),
  }));
  console.log('Restored state 2:', restored2);
  assert.equal(restored2.airport, 'neon', 'Airport restored to neon');
  assert.equal(restored2.aircraft, 'F16', 'Aircraft restored to F16');
  assert.equal(restored2.lobbyAirport, 'neon', 'Lobby airport restored to neon');
  assert.equal(restored2.lobbyAircraft, 'F16', 'Lobby aircraft restored to F16');
  assert.equal(restored2.lobbyScenario, 'cruise', 'Lobby scenario restored to cruise');
  assert.equal(restored2.lastPreset, 'cruise', 'Last preset restored to cruise');
  assert.equal(restored2.neonButtonActive, true, 'Neon button has active class');
  assert.equal(restored2.f16ButtonActive, true, 'F16 button has active class');
  assert.equal(restored2.cruButtonActive, true, 'Cruise button has active class');

  // Now change selection to incheon, B738, runway
  const pending3 = await pick(
    ['lobby-airport-incheon', 'lobby-aircraft-b738', 'lobby-preset-rwy'],
    { airport: 'incheon', aircraft: 'B738', preset: 'runway' },
  );
  assert.equal(pending3.liveAirport, 'neon', 'A pick must not rebuild the flown scene');
  assert.equal(pending3.liveAircraft, 'F16', 'A pick must not swap the flown aircraft');
  await startAndSettle({ airport: 'incheon', aircraft: 'B738', preset: 'runway' });

  const stored3 = await evaluate(() => ({
    airport: localStorage.getItem('flight3d.airport'),
    aircraft: localStorage.getItem('flight3d.aircraft'),
    scenario: localStorage.getItem('flight3d.scenario'),
  }));
  assert.equal(stored3.airport, 'incheon');
  assert.equal(stored3.aircraft, 'B738');
  assert.equal(stored3.scenario, 'runway');
  console.log('Third selection saved to localStorage:', stored3);

  // Reload the page a third time
  console.log('Reloading page third time (Incheon)...');
  await evaluate(() => { window.simulator = null; });
  await send('Page.reload');
  await waitForSimReady();
  console.log('Simulator ready after third reload');

  const restored3 = await evaluate(() => ({
    airport: window.simulator.activeAirport,
    aircraft: window.simulator.currentAircraftId,
    lobbyAirport: window.simulator.lobby.airport,
    lobbyAircraft: window.simulator.lobby.aircraft,
    lobbyScenario: window.simulator.lobby.preset,
    lastPreset: window.simulator.lastPresetType,
    incheonButtonActive: document.getElementById('lobby-airport-incheon')?.classList.contains('active'),
    b738ButtonActive: document.getElementById('lobby-aircraft-b738')?.classList.contains('active'),
    rwyButtonActive: document.getElementById('lobby-preset-rwy')?.classList.contains('active'),
  }));
  console.log('Restored state 3:', restored3);
  assert.equal(restored3.airport, 'incheon', 'Airport restored to incheon');
  assert.equal(restored3.aircraft, 'B738', 'Aircraft restored to B738');
  assert.equal(restored3.lobbyAirport, 'incheon', 'Lobby airport restored to incheon');
  assert.equal(restored3.lobbyAircraft, 'B738', 'Lobby aircraft restored to B738');
  assert.equal(restored3.lobbyScenario, 'runway', 'Lobby scenario restored to runway');
  assert.equal(restored3.lastPreset, 'runway', 'Last preset restored to runway');
  assert.equal(restored3.incheonButtonActive, true, 'Incheon button has active class');
  assert.equal(restored3.b738ButtonActive, true, 'B738 button has active class');
  assert.equal(restored3.rwyButtonActive, true, 'Runway button has active class');

  console.log('All browser verification checks PASSED successfully!');
} catch (error) {
  // The cleanup below force-exits, so without this the failure would vanish with it.
  console.error('VERIFICATION FAILED:', error);
  verificationFailed = true;
} finally {
  if (socket) socket.close();
  chrome.kill('SIGKILL');
  vite.kill('SIGKILL');
  await delay(1000);
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* ignore cleanup error on tmpdir */
  }
  process.exit(verificationFailed ? 1 : 0);
}
