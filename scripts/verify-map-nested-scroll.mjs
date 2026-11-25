// Hardware-Chrome evidence that a touch drag starting on the lobby map can
// still scroll the panel that contains it, without losing map pan/zoom.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

// Fail before the harness launches Chrome: a GPU preflight inside the session
// would be too late to prevent an unauthorized software-rendered browser.
const gpuAngle = detectGpuAngle();
if (gpuAngle === 'swiftshader' || process.env.FORCE_GPU === '0') {
  throw new Error('Hardware GPU acceleration is required; software rendering is not valid evidence');
}
process.env.GPU_ANGLE = gpuAngle;
console.log('Detected GPU angle:', gpuAngle);

const artifacts = path.resolve('.cache/map-nested-scroll');
await mkdir(artifacts, { recursive: true });

const touchPoint = (id, x, y) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 });
const dispatchTouch = (send, type, touchPoints) => send('Input.dispatchTouchEvent', { type, touchPoints });
const boxValues = box => box.split(/\s+/).map(Number);
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

await withBrowserSession({ width: 390, height: 844, mobile: true, deviceScaleFactor: 2, path: '/index.html', timeoutMs: 120000 }, async session => {
  const { evaluate, send, exceptions, cdpPort } = session;
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: path.join(artifacts, 'gpu.json') },
    stdio: 'inherit',
    timeout: 180000,
  });

  for (let i = 0; i < 300; i++) {
    if (await evaluate('Boolean(window.sim?.startupReady)')) break;
    await settle();
  }
  assert.ok(await evaluate('Boolean(window.sim?.startupReady)'), 'simulator startup did not finish');
  await evaluate("document.querySelector('#lobby-tab-scenario')?.click()");
  await evaluate("document.querySelector('#lobby-place-picker > summary')?.click()");
  for (let i = 0; i < 60; i++) {
    if (await evaluate("document.getElementById('lobby-map-search').checkVisibility()")) break;
    await settle();
  }
  assert.ok(await evaluate("document.getElementById('lobby-map-search').checkVisibility()"), 'mobile map dialog did not open');
  assert.ok(await evaluate("document.getElementById('lobby-map-dialog').open"), 'location picker must open as a modal');
  assert.ok(await evaluate("document.getElementById('lobby-destination').checkVisibility()"), 'destination selector must be reachable in the modal');
  await settle();
  await settle();
  const state = () => evaluate(`(() => {
    const panel = document.querySelector('.lobby-map-dialog-body');
    const svg = document.getElementById('lobby-map-svg');
    const rect = svg.getBoundingClientRect();
    return {
      scrollTop: panel.scrollTop,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      touchAction: getComputedStyle(svg).touchAction,
      viewBox: svg.getAttribute('viewBox'),
      centre: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
    };
  })()`);

  const before = await state();
  assert.equal(before.touchAction, 'pan-y', 'map must leave vertical touch scrolling to the modal body');
  const { x: cx, y: cy } = before.centre;

  await dispatchTouch(send, 'touchStart', [touchPoint(1, cx, cy)]);
  for (let i = 1; i <= 6; i++) {
    await dispatchTouch(send, 'touchMove', [touchPoint(1, cx, cy - i * 30)]);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await dispatchTouch(send, 'touchEnd', []);
  await settle();
  const afterScroll = await state();
  assert.deepEqual(boxValues(afterScroll.viewBox), boxValues(before.viewBox), 'one-finger drag must not pan the map vertically');

  await evaluate("document.getElementById('lobby-map-zoom-in').click()");
  await settle();
  const afterZoom = await state();
  const widthOf = box => Number(box.split(/\s+/)[2]);
  assert.ok(widthOf(afterZoom.viewBox) < widthOf(before.viewBox), 'map zoom control must still zoom the modal map');
  const beforePinch = await state();
  await dispatchTouch(send, 'touchStart', [touchPoint(1, cx - 40, cy), touchPoint(2, cx + 40, cy)]);
  for (let i = 1; i <= 4; i++) {
    await dispatchTouch(send, 'touchMove', [touchPoint(1, cx - 40 - i * 15, cy), touchPoint(2, cx + 40 + i * 15, cy)]);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await dispatchTouch(send, 'touchEnd', []);
  await settle();
  const afterPinch = await state();
  assert.ok(widthOf(afterPinch.viewBox) < widthOf(beforePinch.viewBox), 'two-finger pinch must still zoom the modal map');

  const beforePan = await state();
  await dispatchTouch(send, 'touchStart', [touchPoint(1, cx, cy)]);
  for (let i = 1; i <= 6; i++) {
    await dispatchTouch(send, 'touchMove', [touchPoint(1, cx + i * 25, cy)]);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await dispatchTouch(send, 'touchEnd', []);
  await settle();
  const afterPan = await state();
  const xOf = box => Number(box.split(/\s+/)[0]);
  assert.ok(xOf(afterPan.viewBox) < xOf(beforePan.viewBox), 'one-finger horizontal drag must still pan the modal map');


  await evaluate(() => {
    const input = document.getElementById('lobby-map-search');
    input.value = 'Gimpo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let found = false;
  for (let i = 0; i < 40; i++) {
    found = await evaluate("Boolean(document.querySelector('#lobby-map-results button[data-place-id=\"RKSS\"]'))");
    if (found) break;
    await settle();
  }
  assert.ok(found, 'search dropdown did not show RKSS');
  const dropdownLayout = await evaluate(() => {
    const status = document.querySelector('.lobby-map-status-row').getBoundingClientRect();
    const results = document.getElementById('lobby-map-results').getBoundingClientRect();
    return { statusBottom: status.bottom, resultsTop: results.top };
  });
  assert.ok(dropdownLayout.resultsTop >= dropdownLayout.statusBottom, 'search dropdown must not cover the retry status row');
  await evaluate("document.querySelector('#lobby-map-results button[data-place-id=\"RKSS\"]').click()");
  for (let i = 0; i < 20; i++) {
    if (!(await evaluate("document.getElementById('lobby-map-dialog').open"))) break;
    await settle();
  }
  assert.equal(await evaluate("document.getElementById('lobby-map-dialog').open"), false, 'choosing a result must close the modal');
  assert.equal(await evaluate("(window.simulator || window.sim)?.lobby?.mapPlan?.airportCode"), 'RKSS', 'choosing a result must apply the map plan');
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({
    gpu: 'hardware Vulkan preflight passed',
    scrollTop: { before: before.scrollTop, after: afterScroll.scrollTop },
    viewBox: { before: before.viewBox, afterZoom: afterZoom.viewBox },
  }, null, 2));
});
