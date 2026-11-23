// Hardware-Chrome evidence for issue #944 item 2: worldwide airport search,
// map selection reuse, and a visible index-load failure state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const artifacts = path.resolve('.cache/global-airport-search');
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

const searchFor = query => `(() => {
  const input = document.getElementById('lobby-map-search');
  input.value = ${JSON.stringify(query)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

await withBrowserSession({ path: '/index.html', timeoutMs: 120000 }, async session => {
  const { evaluate, send, screenshot, cdpPort, exceptions } = session;
  checkGpu(cdpPort);
  assert.ok(await waitFor(session, 'Boolean(window.sim?.startupReady)'), 'simulator did not boot');
  assert.ok(await waitFor(session, 'window.sim?.mapPlaces?.airports?.length > 10'), 'local catalog did not load');
  await evaluate("document.querySelector('#lobby-place-picker > summary').click()");
  assert.ok(await waitFor(session, "document.getElementById('lobby-map-search').checkVisibility()"), 'place browser did not open');

  // First input loads the compact global index; the status element reports it.
  await evaluate(searchFor('KJFK'));
  assert.ok(await waitFor(session, `
    [...document.querySelectorAll('#lobby-map-results button')]
      .some(button => button.dataset.placeId === 'KJFK' && button.dataset.placeSource === 'global')
  `), 'ICAO query did not find KJFK in the global index');
  await screenshot(path.join(artifacts, 'icao-search.png'));

  await evaluate(searchFor('JFK'));
  assert.ok(await waitFor(session, `
    [...document.querySelectorAll('#lobby-map-results button')]
      .some(button => button.dataset.placeId === 'KJFK' && button.dataset.placeSource === 'global')
  `), 'IATA query did not find KJFK in the global index');

  await evaluate(searchFor('Heathrow'));
  assert.ok(await waitFor(session, `
    [...document.querySelectorAll('#lobby-map-results button')]
      .some(button => button.dataset.placeId === 'EGLL' && button.dataset.placeSource === 'global')
  `), 'name query did not find EGLL in the global index');

  // A global result resolves its full tile record through the existing flow.
  await evaluate(searchFor('KJFK'));
  assert.ok(await waitFor(session, `
    document.querySelector('#lobby-map-results button[data-place-id="KJFK"][data-place-source="global"]')
  `), 'KJFK global result missing after reselection');
  await evaluate("document.querySelector('#lobby-map-results button[data-place-id=\"KJFK\"][data-place-source=\"global\"]').click()");
  assert.ok(await waitFor(session, "sim.lobby.mapPlan?.airportCode === 'KJFK'"), 'global result did not set the map plan');
  const plan = await evaluate(`({
    airport: sim.lobby.mapPlan.airportCode,
    registered: sim.mapPlaces.airports.some(airport => airport.code === 'KJFK'),
    runways: sim.mapPlaces.airports.find(airport => airport.code === 'KJFK')?.runways?.length ?? 0,
  })`);
  assert.equal(plan.registered, true, 'global airport was not registered as an external destination');
  assert.ok(plan.runways > 0, 'global airport lost its runways during selection');

  // Reload with only the search artifact failing: the UI must show a distinct
  // error state while keeping the local catalog usable.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (url.includes('search.json')) return Promise.reject(new Error('simulated search index failure'));
      return nativeFetch(...args);
    };
  })()` });
  await send('Page.reload', { ignoreCache: true });
  assert.ok(await waitFor(session, 'Boolean(window.sim?.startupReady)'), 'simulator did not restart');
  assert.ok(await waitFor(session, 'window.sim?.mapPlaces?.airports?.length > 10'), 'local catalog did not survive reload');
  await evaluate("document.querySelector('#lobby-place-picker > summary').click()");
  await evaluate(searchFor('KJFK'));
  assert.ok(await waitFor(session, `(() => {
    const text = document.getElementById('lobby-map-search-status').textContent;
    return text.includes('unavailable') || text.includes('색인을 불러오지');
  })()`), 'index load failure was not shown in the search status');
  await screenshot(path.join(artifacts, 'index-error.png'));
  await evaluate(searchFor('Gimpo'));
  assert.ok(await waitFor(session, `
    [...document.querySelectorAll('#lobby-map-results button')]
      .some(button => button.dataset.placeId === 'RKSS' && button.dataset.placeSource === 'local')
  `), 'local results were lost after a global index failure');

  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({
    gpu: 'hardware Vulkan preflight passed',
    globalSearch: 'ICAO, IATA and name queries found KJFK/EGLL',
    plan,
    failureState: 'search.json rejection surfaced in aria-live status; local RKSS result still available',
  }, null, 2));
});
