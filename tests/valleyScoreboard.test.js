import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValleyScoreboard, sanitizeCallsign, valleyAttempt } from '../src/arena/ValleyScoreboard.js';

class MockStorage {
  constructor() { this.store = new Map(); }
  getItem(key) { return this.store.get(key) ?? null; }
  setItem(key, value) { this.store.set(key, String(value)); }
  removeItem(key) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

test('sanitizeCallsign cleans and formats callsigns correctly', () => {
  assert.equal(sanitizeCallsign('mav'), 'MAV');
  assert.equal(sanitizeCallsign('  top_gun  '), 'TOP_GUN');
  assert.equal(sanitizeCallsign('abcdefghijk'), 'ABCDEFGH');
  assert.equal(sanitizeCallsign('!@#$%^'), 'MAV');
  assert.equal(sanitizeCallsign(''), 'MAV');
  assert.equal(sanitizeCallsign(null), 'MAV');
});

test('ValleyScoreboard saves, ranks and retrieves leaderboard attempts', () => {
  const storage = new MockStorage();
  const scoreboard = new ValleyScoreboard(storage);

  assert.equal(scoreboard.getSavedCallsign(), 'MAV');
  scoreboard.saveCallsign('VIPER');
  assert.equal(scoreboard.getSavedCallsign(), 'VIPER');

  const record1 = {
    pilotKind: 'human',
    status: 'succeeded',
    reason: 'completed',
    tick: 4800, // 40s
    manifest: { id: 'valley-low-v1', type: 'valley', physicsHz: 120, rulesVersion: '1.4.0' },
    result: { metrics: { finalScore: 14500, meanIasKnots: 560 } },
  };

  const record2 = {
    pilotKind: 'ai',
    status: 'succeeded',
    reason: 'completed',
    tick: 4680, // 39s
    manifest: { id: 'valley-low-v1', type: 'valley', physicsHz: 120, rulesVersion: '1.4.0' },
    result: { metrics: { finalScore: 15200, meanIasKnots: 575 } },
  };

  const attempt1 = scoreboard.add(record1, { callsign: 'VIPER' });
  const attempt2 = scoreboard.add(record2, { callsign: 'BOT_ACE' });

  assert.equal(attempt1.callsign, 'VIPER');
  assert.equal(attempt2.callsign, 'BOT_ACE');

  const leaderboard = scoreboard.getLeaderboard(5);
  assert.equal(leaderboard.length, 2);
  assert.equal(leaderboard[0].rank, 1);
  assert.equal(leaderboard[0].callsign, 'BOT_ACE');
  assert.equal(leaderboard[0].score, 15200);

  assert.equal(leaderboard[1].rank, 2);
  assert.equal(leaderboard[1].callsign, 'VIPER');
  assert.equal(leaderboard[1].score, 14500);

  // Test updating callsign
  const updated = scoreboard.updateCallsign(attempt1.id, 'ROOSTER');
  assert.equal(updated, true);
  const updatedLeaderboard = scoreboard.getLeaderboard(5);
  assert.equal(updatedLeaderboard[1].callsign, 'ROOSTER');
});

test('ValleyScoreboard handles corrupted storage gracefully', () => {
  const storage = new MockStorage();
  storage.setItem('flight3d.valley-attempts.v1', '{ corrupt json');
  const scoreboard = new ValleyScoreboard(storage);

  const rows = scoreboard.read();
  assert.deepEqual(rows, []);
  assert.match(scoreboard.error, /JSON/i);

  const leaderboard = scoreboard.getLeaderboard(5);
  assert.deepEqual(leaderboard, []);
});
