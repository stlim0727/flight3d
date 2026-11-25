// Hardware-Chrome evidence for issue #922 step 4: search and bookmarks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const artifacts = path.resolve('.cache/map-search');
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
  const { evaluate, send, screenshot, cdpPort, exceptions } = session;
  checkGpu(cdpPort);
  assert.ok(await waitFor(session, 'Boolean(window.sim?.gameFlow?.state)'), 'simulator did not boot');
  assert.ok(await waitFor(session, 'window.sim?.startupReady'), 'simulator startup did not finish');
  assert.ok(await waitFor(session, 'window.sim?.mapPlaces?.airports?.length > 10'), 'map catalog did not load');

  assert.equal(await evaluate("document.getElementById('lobby-regional-cruise') === null"), true);
  assert.equal(await evaluate("document.querySelectorAll('[id^=\"lobby-airport-\"]').length"), 0, 'legacy 6 flight region buttons must be removed');
  assert.ok(await evaluate("!document.getElementById('lobby-map-search').checkVisibility()"), 'map must start collapsed');
  assert.ok(await evaluate("!document.getElementById('lobby-map-runway').checkVisibility()"), 'direction must start hidden');
  await screenshot(path.join(artifacts, 'lobby.png'));
  await evaluate("document.querySelector('#lobby-place-picker > summary').click()");
  assert.ok(await waitFor(session, "document.getElementById('lobby-map-search').checkVisibility()"), 'opening Places did not show search');

  for (const id of ['RKSI', 'RKSS', 'RKPC', 'RKPK', 'jamsil', 'suwon', 'busan', 'lukla', 'neon', 'coastal']) {
    assert.ok(await evaluate(`Boolean(document.querySelector('#lobby-map-default-bookmarks [data-place-id="${id}"]'))`), `default bookmark missing: ${id}`);
  }
  await evaluate("document.getElementById('lobby-map-default-bookmarks')?.scrollIntoView({ block: 'end' })");
  await screenshot(path.join(artifacts, 'default-bookmarks.png'));

  await evaluate(`(() => {
    const input = document.getElementById('lobby-map-search');
    input.value = 'Gimpo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const results = await evaluate("[...document.querySelectorAll('#lobby-map-results button')].map(b => ({kind: b.dataset.placeKind, id: b.dataset.placeId, text: b.textContent}))");
  assert.ok(results.some(result => result.kind === 'airport' && result.id === 'RKSS'), 'Gimpo search did not find RKSS');

  const beforeView = await evaluate("document.getElementById('lobby-map-svg').getAttribute('viewBox')");
  await evaluate("document.querySelector('#lobby-map-results button[data-place-id=\"RKSS\"]')?.click()");
  assert.ok(await waitFor(session, "sim.lobby.mapPlan?.airportCode === 'RKSS'"), 'search result did not select RKSS');
  const afterView = await evaluate("document.getElementById('lobby-map-svg').getAttribute('viewBox')");
  assert.notEqual(beforeView, afterView, 'map view did not centre on the selected airport');

  await evaluate("document.getElementById('lobby-map-bookmark-toggle')?.click()");
  assert.ok(await waitFor(session, "Boolean(document.querySelector('#lobby-map-bookmarks button[data-place-id=\"RKSS\"]'))"), 'bookmark was not rendered');

  const stored = await evaluate("localStorage.getItem('flight3d.bookmarks.v1')");
  assert.ok(stored?.includes('RKSS'), 'bookmark was not persisted to storage');
  await evaluate("document.querySelector('#lobby-map-bookmarks button[data-place-id=\"RKSS\"]')?.click()");
  assert.ok(await waitFor(session, "window.sim?.lobby?.mapPlan?.airportCode === 'RKSS'"), 'bookmark did not restore selection');

  await evaluate(`(() => {
    const input = document.getElementById('lobby-map-search');
    input.value = '잠실';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#lobby-map-results button[data-place-id="jamsil"]')?.click();
    return true;
  })()`);
  assert.ok(await waitFor(session, "window.sim?.lobby?.mapPlan?.pointId === 'jamsil' && window.sim?.lobby?.mapPlan?.state === 'cruise'"), 'Korean point search did not select cruise');
  await evaluate("document.getElementById('lobby-map-bookmark-toggle')?.click()");
  assert.ok(await waitFor(session, "Boolean(document.querySelector('#lobby-map-bookmarks button[data-place-id=\"jamsil\"]'))"), 'point bookmark was not saved');
  await evaluate("document.querySelector('#lobby-map-bookmarks button[data-place-id=\"RKSS\"]')?.click()");
  assert.ok(await waitFor(session, "window.sim?.lobby?.mapPlan?.state === 'cruise' && window.sim?.lobby?.mapPlan?.airportCode === 'RKSS'"), 'airport selection did not preserve cruise state');

  assert.equal(await evaluate("sim.lobby.mapPlan.runwayKey"), '', 'place selection must use automatic direction');
  assert.ok(await evaluate("!document.getElementById('lobby-map-runway').checkVisibility()"), 'direction must stay hidden in Places');
  await evaluate("document.getElementById('lobby-preset-app').click()");
  assert.ok(await waitFor(session, "sim.lobby.mapPlan.state === 'approach'"), 'airport must allow approach');
  const openMapModal = async () => {
    if (await evaluate("document.getElementById('lobby-map-dialog')?.open")) return;
    await evaluate("document.querySelector('#lobby-place-picker > summary')?.click()");
    assert.ok(await waitFor(session, "document.getElementById('lobby-map-dialog')?.open"), 'map modal did not reopen');
    assert.ok(await waitFor(session, "document.getElementById('lobby-map-search').checkVisibility()"), 'map modal content did not reopen');
  };
  const pickPoint = async (x, y) => {
    await openMapModal();
    return evaluate(`(() => {
      document.getElementById('lobby-map-overview').click();
      const map = document.getElementById('lobby-map-svg');
      const point = map.createSVGPoint();
      point.x = ${x};
      point.y = ${y};
      const screen = point.matrixTransform(map.getScreenCTM());
      map.querySelector('.lobby-map-backdrop').dispatchEvent(new MouseEvent('click', {
        bubbles: true, clientX: screen.x, clientY: screen.y,
      }));
    })()`);
  };
  await pickPoint(880.36, 397.68);
  const custom = await evaluate("sim.lobby.mapPlan");
  assert.equal(custom.state, 'cruise');
  assert.ok(custom.pointId.startsWith('map:'));
  assert.ok(Math.abs(custom.point.longitude - 129.5) < 0.3);
  assert.ok(await evaluate("document.getElementById('lobby-preset-rwy').disabled && document.getElementById('lobby-preset-app').disabled"), 'custom point must only allow cruise');
  await evaluate("document.getElementById('lobby-map-bookmark-toggle').click()");
  assert.ok((await evaluate("localStorage.getItem('flight3d.bookmarks.v1')")).includes(custom.pointId), 'custom bookmark did not persist');
  await pickPoint(341.33, 570.08);
  await evaluate(`[...document.querySelectorAll('#lobby-map-bookmarks button')].find(button => button.dataset.placeId === ${JSON.stringify(custom.pointId)}).click()`);
  assert.equal(await evaluate("sim.lobby.mapPlan.pointId"), custom.pointId, 'custom bookmark did not restore');
  await screenshot(path.join(artifacts, 'bookmarks.png'));
  for (const kind of ['point', 'airport']) {
    if (kind === 'airport') {
      await evaluate(`(() => {
        sim.gameFlow.returnToLobby(false);
        document.querySelector('#lobby-map-default-bookmarks [data-place-id="RKSS"]').click();
      })()`);
    }
    assert.equal(await evaluate("sim.lobby.mapPlan.state"), 'cruise');
    await evaluate("(async () => { await sim.fly(); })()");
    assert.ok(await waitFor(session, 'sim.gameFlow.state === "flight" && !sim.startingFlight'), `${kind} cruise did not start`);
    const actual = await evaluate(`(async () => {
      const { mapCruisePoint } = await import('/src/config/mapFlightPlaces.js');
      const { projectToLocal } = await import('/src/geospatial/incheon.js');
      const { BASE_OFFSETS } = await import('/src/world/UnifiedWorld.js');
      const point = mapCruisePoint(sim.lobby.mapPlan, sim.mapPlaces);
      const [x, z] = projectToLocal(point.latitude, point.longitude);
      const [anchorX, anchorZ] = BASE_OFFSETS[sim.activeAirport];
      return {
        horizontalError: Math.hypot(sim.position.x - (x - anchorX), sim.position.z - (z - anchorZ)),
        altitudeError: Math.abs(sim.position.y - point.altitudeM),
      };
    })()`);
    assert.ok(actual.horizontalError < 500, `${kind} cruise missed selected location: ${actual.horizontalError} m`);
    assert.ok(actual.altitudeError < 50, `${kind} cruise missed planned altitude: ${actual.altitudeError} m`);
  }

  await screenshot(path.join(artifacts, 'bookmarks.png'));
  await send('Page.reload', { ignoreCache: true });
  assert.ok(await waitFor(session, 'Boolean(window.sim?.startupReady)'), 'simulator did not restart after reload');
  assert.ok(await waitFor(session, 'window.sim?.mapPlaces?.airports?.length > 10'), 'map catalog did not reload');
  await evaluate("document.querySelector('#lobby-place-picker > summary').click()");
  await evaluate("document.getElementById('lobby-map-bookmark-toggle')?.click()");
  assert.ok(await waitFor(session, "Boolean(document.querySelector('#lobby-map-bookmarks button[data-place-id=\"RKSS\"]'))"), 'bookmark did not survive reload');
  const restoredStorage = await evaluate("localStorage.getItem('flight3d.bookmarks.v1')");
  assert.ok(restoredStorage?.includes('RKSS'), 'bookmark storage did not survive reload');
  await evaluate("document.querySelector('#lobby-map-bookmarks button[data-place-id=\"RKSS\"]')?.click()");
  assert.ok(await waitFor(session, "window.sim?.lobby?.mapPlan?.airportCode === 'RKSS'"), 'restored bookmark did not restore selection');
  await screenshot(path.join(artifacts, 'bookmarks-after-refresh.png'));

  // Search and select a special region (Lukla).
  await evaluate(`(() => {
    const input = document.getElementById('lobby-map-search');
    input.value = '루클라';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert.ok(await waitFor(session, "Boolean(document.querySelector('#lobby-map-results [data-place-kind=\"region\"][data-place-id=\"lukla\"]'))"), 'Korean region search did not find lukla');
  await evaluate("document.querySelector('#lobby-map-results [data-place-kind=\"region\"][data-place-id=\"lukla\"]')?.click()");
  assert.ok(await waitFor(session, "window.sim?.lobby?.airport === 'lukla' && window.sim?.lobby?.mapPlan === null"), 'selecting region:lukla did not switch airport and clear mapPlan');

  // Open Missions disclosure: all mission buttons must be visible simultaneously and auto-switch region.
  await evaluate("document.querySelector('#lobby-missions > summary').click()");
  const missionIds = ['lobby-preset-challenge', 'lobby-preset-bridge', 'lobby-preset-cliff', 'lobby-preset-valley'];
  assert.ok(
    await waitFor(session, `${JSON.stringify(missionIds)}.every(id => document.getElementById(id)?.checkVisibility())`),
    'all mission buttons must be visible simultaneously',
  );
  await screenshot(path.join(artifacts, 'missions.png'));

  await evaluate("document.getElementById('lobby-preset-bridge')?.click()");
  assert.ok(
    await waitFor(session, "window.sim?.lobby?.airport === 'neon' && window.sim?.lobby?.preset === 'bridge' && window.sim?.lobby?.aircraft === 'C172'"),
    'bridge mission did not switch to neon + C172',
  );

  await evaluate("document.getElementById('lobby-preset-valley')?.click()");
  assert.ok(
    await waitFor(session, "window.sim?.lobby?.airport === 'valley' && window.sim?.lobby?.preset === 'valley' && window.sim?.lobby?.aircraft === 'F16' && document.getElementById('lobby-aircraft-b738')?.disabled === true"),
    'valley mission did not switch to valley + F16',
  );

  await evaluate("document.getElementById('lobby-preset-rwy')?.click()");
  assert.ok(
    await waitFor(session, "window.sim?.lobby?.airport === 'incheon' && window.sim?.lobby?.preset === 'runway' && document.getElementById('lobby-aircraft-b738')?.disabled === false"),
    'runway start button did not escape valley back to incheon',
  );

  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({
    gpu: 'hardware Vulkan preflight passed',
    resultCount: results.length,
    view: { before: beforeView, after: afterView },
    bookmark: 'RKSS and custom map point persisted, restored and restored again after reload',
    cruise: 'custom point and airport starts matched their selected coordinates and altitude',
  }, null, 2));
});
