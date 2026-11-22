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
  assert.ok(await waitFor(session, 'sim.mapPlaces?.airports?.length > 10'), 'map catalog did not load');

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
  assert.ok(await waitFor(session, "window.sim?.lobby?.mapPlan?.state === 'runway' && window.sim?.lobby?.mapPlan?.airportCode === 'RKSS'"), 'airport selection did not leave cruise state');

  assert.deepEqual(exceptions, []);
  await screenshot(path.join(artifacts, 'bookmarks.png'));
  console.log(JSON.stringify({
    gpu: 'hardware Vulkan preflight passed',
    resultCount: results.length,
    view: { before: beforeView, after: afterView },
    bookmark: 'RKSS persisted and restored from the same session',
  }, null, 2));
});
