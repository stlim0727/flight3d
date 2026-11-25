// Hardware-Chrome evidence that a touch drag starting on the lobby map can
// still scroll the panel that contains it, without losing map pan/zoom.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

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
  assert.ok(await evaluate("document.getElementById('lobby-map-search').checkVisibility()"), 'mobile map did not open');

  const state = () => evaluate(`(() => {
    const panel = document.querySelector('.lobby-panels');
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
  assert.equal(before.touchAction, 'pan-y', 'map must leave vertical touch scrolling to the lobby panel');
  assert.ok(before.scrollHeight > before.clientHeight, 'lobby panel must be scrollable for this check');
  const { x: cx, y: cy } = before.centre;

  await dispatchTouch(send, 'touchStart', [touchPoint(1, cx, cy)]);
  for (let i = 1; i <= 6; i++) {
    await dispatchTouch(send, 'touchMove', [touchPoint(1, cx, cy - i * 30)]);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await dispatchTouch(send, 'touchEnd', []);
  await settle();
  const afterScroll = await state();
  assert.ok(afterScroll.scrollTop > before.scrollTop + 60, 'one-finger drag on the map must scroll the lobby panel');
  assert.deepEqual(boxValues(afterScroll.viewBox), boxValues(before.viewBox), 'one-finger drag must not pan the map vertically');

  await dispatchTouch(send, 'touchStart', [touchPoint(1, cx - 40, cy), touchPoint(2, cx + 40, cy)]);
  for (let i = 1; i <= 4; i++) {
    await dispatchTouch(send, 'touchMove', [touchPoint(1, cx - 40 - i * 15, cy), touchPoint(2, cx + 40 + i * 15, cy)]);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await dispatchTouch(send, 'touchEnd', []);
  await settle();
  const afterPinch = await state();
  const widthOf = box => Number(box.split(/\s+/)[2]);
  assert.ok(widthOf(afterPinch.viewBox) < widthOf(before.viewBox), 'two-finger pinch must still zoom the map');

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
  assert.ok(xOf(afterPan.viewBox) < xOf(beforePan.viewBox), 'one-finger horizontal drag must still pan the map');

  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({
    gpu: 'hardware Vulkan preflight passed',
    scrollTop: { before: before.scrollTop, after: afterScroll.scrollTop },
    viewBox: { before: before.viewBox, afterPinch: afterPinch.viewBox, afterPan: afterPan.viewBox },
  }, null, 2));
});
