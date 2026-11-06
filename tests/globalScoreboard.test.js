import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTop } from '../scripts/lib/leaderboard-core.mjs';
import { sha256Hex, rowsForComparison } from '../src/arena/GlobalLeaderboard.js';
import { dailySeed } from '../src/arena/dailySeed.js';

const row = (overrides) => ({
  mission: 'valley-slalom-v1', comparisonKeyHash: 'k1', callsign: 'MAV', pilotKind: 'human',
  score: 1000, durationSeconds: 60, recordedAt: '2026-11-06T00:00:00Z', ...overrides,
});

test('groupTop ranks per condition key, drops unscored rows and caps the list', () => {
  const boards = groupTop([
    row({ score: 1000 }), row({ score: 3000, callsign: 'VIPER', durationSeconds: 50 }),
    row({ score: 2000, callsign: 'AI', pilotKind: 'ai' }), row({ score: 0 }),
    row({ score: null }), row({ callsign: 'NOSCORE' }),
    row({ comparisonKeyHash: 'k2', mission: 'takeoff-basic-v1', score: 8000 }),
    row({ score: 999, callsign: 'X'.repeat(3) }),
  ], { limit: 3 });
  assert.equal(boards.length, 2);
  const valley = boards.find(b => b.comparisonKeyHash === 'k1');
  assert.deepEqual(valley.top.map(r => r.callsign), ['VIPER', 'AI', 'MAV']);
  assert.deepEqual(valley.top.map(r => r.rank), [1, 2, 3]);
  assert.equal(valley.top[0].score, 3000);
});

test('ties on score rank by shorter duration', () => {
  const boards = groupTop([row({ callsign: 'SLOW', durationSeconds: 70 }), row({ callsign: 'FAST', durationSeconds: 55 })]);
  assert.deepEqual(boards[0].top.map(r => r.callsign), ['FAST', 'SLOW']);
});

test('rowsForComparison only serves a snapshot made under the current fingerprint', () => {
  const board = { fingerprintHash: 'fp', boards: [{ comparisonKeyHash: 'k1', top: [{ callsign: 'MAV', score: 1 }] }] };
  assert.equal(rowsForComparison(board, 'k1', 'fp').length, 1);
  assert.deepEqual(rowsForComparison(board, 'k1', 'other'), []);
  assert.deepEqual(rowsForComparison(board, 'k2', 'fp'), []);
  assert.deepEqual(rowsForComparison(null, 'k1', 'fp'), []);
  assert.deepEqual(rowsForComparison({ boards: 'nonsense' }, 'k1', 'fp'), []);
});

test('sha256Hex matches the known digest', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('dailySeed is the UTC day number and shared by every clock zone', () => {
  const day = new Date('2026-11-06T12:00:00Z');
  assert.equal(dailySeed(day), dailySeed(new Date('2026-11-06T23:59:59+09:00')));
  assert.equal(Number.isSafeInteger(dailySeed(day)), true);
  assert.equal(dailySeed(new Date('2026-11-07T00:00:00Z')), dailySeed(day) + 1);
});
