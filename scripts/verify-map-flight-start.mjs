// Hardware-Chrome evidence for issue #922 step 3: map-based start states.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const artifacts = path.resolve('.cache/map-flight-start');
await mkdir(artifacts, { recursive: true });

function checkGpu(cdpPort) {
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: path.join(artifacts, 'gpu.json') },
    stdio: 'inherit',
    timeout: 180000,
  });
}

async function waitFor(session, expression, tries = 300, delayMs = 100) {
  for (let i = 0; i < tries; i++) {
    if (await session.evaluate(expression)) return true;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

await withBrowserSession({ path: '/index.html', timeoutMs: 120000 }, async session => {
  const { evaluate, screenshot, cdpPort, exceptions } = session;
  checkGpu(cdpPort);
  assert.ok(await waitFor(session, 'Boolean(window.sim?.gameFlow?.state)'), 'simulator did not boot');
  if (!await waitFor(session, 'sim.mapPlaces?.airports?.length > 10')) {
    console.log('catalog diagnostics', await evaluate('({mapPlaces: sim.mapPlaces?.airports?.length ?? null, error: sim.mapPlacesError ?? null})'), exceptions.slice(-8));
  }
  assert.ok(await waitFor(session, 'sim.mapPlaces?.airports?.length > 10'), 'map airport catalog did not load');

  const results = {};
  for (const state of ['runway', 'cruise', 'approach']) {
    await evaluate(`(async () => {
      sim.gameFlow.returnToLobby(false);
      const set = (id, value) => {
        const select = document.getElementById(id);
        if (!select) return;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('lobby-map-departure', '');
      set('lobby-map-state', ${JSON.stringify(state)});
      if (${JSON.stringify(state)} === 'cruise') set('lobby-map-point', 'jamsil');
      else {
        set('lobby-map-airport', 'RKSS');
        const runway = document.getElementById('lobby-map-runway');
        set('lobby-map-runway', runway?.options?.[1]?.value ?? '');
      }
      await sim.fly();
      return true;
    })()`);
    const settled = await waitFor(session, 'sim.gameFlow.state === "flight" && !sim.startingFlight');
    if (!settled) console.log('start state', await evaluate('({flow: sim.gameFlow.state, starting: sim.startingFlight, preset: sim.lobby.preset, plan: sim.lobby.mapPlan, mapPlaces: sim.mapPlaces?.airports?.length})'), exceptions.slice(-3));
    assert.ok(settled, `${state} start did not settle`);
    if (state !== 'cruise') {
      assert.ok(await waitFor(session, 'sim.airportStreamer?.status?.state === "ready"'), `${state} airport did not stream`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    results[state] = await evaluate(`({
      state: sim.lobby.mapPlan?.state,
      departure: sim.lobby.mapPlan?.departure,
      scenario: sim.lobby.preset,
      x: sim.position.x, y: sim.position.y, z: sim.position.z,
      speed: Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z),
      onGround: sim.telemetry.onGround,
      stream: sim.airportStreamer?.status?.state ?? null,
    })`);
    assert.equal(results[state].state, state);
    assert.equal(results[state].departure, '', 'departure must stay optional');
    assert.equal(results[state].scenario, state);
    if (state === 'runway') assert.equal(results[state].onGround, true);
    if (state === 'cruise') assert.ok(results[state].y > 1000 && results[state].speed > 90);
    if (state === 'approach') assert.ok(results[state].y > 20 && results[state].speed > 60);
    await screenshot(path.join(artifacts, `map-${state}.png`));
  }

  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ gpu: 'hardware Vulkan preflight passed', results }, null, 2));
});
