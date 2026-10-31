import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pilotCases, pilotCaseUrl, resolvePilotCase } from '../src/config/pilotCases.js';
import { resolveFlightUrl } from '../src/config/flightUrls.js';
import { createRealtimePacer } from '../src/arena/realtimePacer.js';

test('all 12 built-in case links select the exact mission, profile and seed independently of preferences', () => {
  const rows = pilotCases();
  assert.equal(rows.length, 12);
  assert.equal(new Set(rows.map(row => pilotCaseUrl(row))).size, 12);
  const docs = readFileSync(new URL('../docs/flight-urls.md', import.meta.url), 'utf8');
  for (const row of rows) {
    const url = new URL(pilotCaseUrl(row));
    assert.deepEqual(resolvePilotCase(url.search), row);
    assert.equal(url.searchParams.get('pilotArena'), '1');
    assert.deepEqual(resolveFlightUrl(url.search, { airport: 'lukla', aircraft: 'F16', scenario: 'cruise' }),
      { airport: 'coastal', aircraft: 'B738', scenario: row.type === 'takeoff' ? 'runway' : 'approach' });
    assert.ok(docs.includes(url.href), `missing documented case: ${row.id}`);
    const documentedRow = docs.split('\n').find(line => line.includes(url.href));
    assert.ok(documentedRow.includes(`/src/pilot/examples/${row.type}.js`), `wrong pilot code for ${row.id}`);
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
