import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pilotCases, pilotCaseUrl, resolvePilotCase } from '../src/config/pilotCases.js';
import { resolveFlightUrl } from '../src/config/flightUrls.js';
import { createRealtimePacer } from '../src/arena/realtimePacer.js';

test('all built-in case links select the exact mission, profile and seed independently of preferences', () => {
  const rows = pilotCases();
  assert.ok(rows.length >= 12);
  assert.equal(new Set(rows.map(row => pilotCaseUrl(row))).size, rows.length);
  for (const row of rows) {
    const url = new URL(pilotCaseUrl(row));
    assert.deepEqual(resolvePilotCase(url.search), row);
    assert.equal(url.searchParams.get('pilotArena'), '1');
    assert.deepEqual(resolveFlightUrl(url.search, { airport: 'lukla', aircraft: 'F16', scenario: 'cruise' }),
      { airport: row.airport ?? 'coastal', aircraft: row.aircraft ?? 'B738',
        scenario: row.scenario ?? (row.type === 'takeoff' ? 'runway' : row.type === 'landing' ? 'approach' : 'cruise') });
    assert.ok(pilotCaseUrl(row, 'http://localhost:5173/sub/').startsWith('http://localhost:5173/sub/?'));
  }
});

test('unknown cases never select arbitrary source or silently start a different test', () => {
  for (const query of ['', '?pilotCase=__proto__', '?pilotCase=landing-mild-99', '?pilotCase=data:text/javascript,evil']) {
    assert.equal(resolvePilotCase(query), null);
  }
  assert.throws(() => pilotCaseUrl({ id: 'unknown' }), /Unknown/);
});

test('real-time pacing yields to display frames while preserving 120 physics ticks per second', async () => {
  let wallMs = 0, frames = 0;
  const pace = createRealtimePacer({ now: () => wallMs,
    nextFrame: async () => { wallMs += 1000 / 60; frames++; } });
  for (let tick = 1; tick <= 1200; tick++) {
    await pace(tick, 120);
    assert.ok(wallMs >= tick / 120 * 1000);
    assert.ok(wallMs - tick / 120 * 1000 < 17);
  }
  assert.ok(frames >= 600 && frames <= 601);
});

test('worker and foreground frame stalls rebase playback instead of fast-forwarding the next interval', async () => {
  for (const stall of ['worker', 'frame']) {
    let wallMs = 0, frames = 0, delayFrame = false;
    const pace = createRealtimePacer({ now: () => wallMs,
      nextFrame: async () => { wallMs += delayFrame ? 200 : 1000 / 60; delayFrame = false; frames++; } });
    for (let tick = 1; tick <= 24; tick++) await pace(tick, 120);
    if (stall === 'worker') wallMs += 200;
    else delayFrame = true;
    await pace(25, 120);
    const before = frames, elapsed = wallMs;
    for (let tick = 26; tick <= 48; tick++) await pace(tick, 120);
    assert.ok(frames - before >= 10, `${stall}: subsequent steps must yield to the display`);
    assert.ok(wallMs - elapsed >= 175, `${stall}: no 0.2s catch-up burst`);
  }
});
