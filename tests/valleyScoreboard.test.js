import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValleyScoreboard, sanitizeCallsign, valleyAttempt, SCORE_RULES_FINGERPRINT } from '../src/arena/ValleyScoreboard.js';
import { VALLEY_SLALOM_RULES } from '../src/arena/generatedValley.js';
import { TAKEOFF_SCORE_RULES } from '../src/arena/TakeoffMission.js';
import { LANDING_SCORE_RULES } from '../src/arena/LandingMission.js';

const FINGERPRINT_KEY = 'flight3d.valley-attempts.rules-fingerprint.v1';
const CURRENT_FINGERPRINT = SCORE_RULES_FINGERPRINT;

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
  storage.setItem(FINGERPRINT_KEY, CURRENT_FINGERPRINT);
  const scoreboard = new ValleyScoreboard(storage);

  assert.equal(scoreboard.getSavedCallsign(), 'MAV');
  scoreboard.saveCallsign('VIPER');
  assert.equal(scoreboard.getSavedCallsign(), 'VIPER');

  const record1 = {
    pilotKind: 'human',
    status: 'succeeded',
    reason: 'completed',
    tick: 4800, // 40s
    manifest: { id: 'valley-low-v1', type: 'valley', physicsHz: 120, rulesVersion: '1.5.0' },
    result: { metrics: { finalScore: 14500, meanIasKnots: 560 } },
  };

  const record2 = {
    pilotKind: 'ai',
    status: 'succeeded',
    reason: 'completed',
    tick: 4680, // 39s
    manifest: { id: 'valley-low-v1', type: 'valley', physicsHz: 120, rulesVersion: '1.5.0' },
    result: { metrics: { finalScore: 15200, meanIasKnots: 575 } },
  };

  const attempt1 = scoreboard.add(record1, { callsign: 'VIPER' });
  const attempt2 = scoreboard.add(record2, { callsign: 'BOT_ACE' });

  assert.equal(attempt1.callsign, 'VIPER');
  // An AI flight is never attributed to a person, whatever callsign is offered.
  assert.equal(attempt2.callsign, 'AI');

  const leaderboard = scoreboard.getLeaderboard(5);
  assert.equal(leaderboard.length, 2);
  assert.equal(leaderboard[0].rank, 1);
  assert.equal(leaderboard[0].callsign, 'AI');
  assert.equal(leaderboard[0].score, 15200);

  assert.equal(leaderboard[1].rank, 2);
  assert.equal(leaderboard[1].callsign, 'VIPER');
  assert.equal(leaderboard[1].score, 14500);

  // Test updating callsign: the human row takes a new name, the AI row refuses.
  assert.equal(scoreboard.updateCallsign(attempt2.id, 'CYBER'), false);
  assert.equal(scoreboard.read().find(r => r.id === attempt2.id).callsign, 'AI');
  const updated = scoreboard.updateCallsign(attempt1.id, 'ROOSTER');
  assert.equal(updated, true);
  const updatedLeaderboard = scoreboard.getLeaderboard(5);
  assert.equal(updatedLeaderboard[1].callsign, 'ROOSTER');
});

test('ValleyScoreboard handles corrupted storage gracefully', () => {
  const storage = new MockStorage();
  storage.setItem(FINGERPRINT_KEY, CURRENT_FINGERPRINT);
  storage.setItem('flight3d.valley-attempts.v1', '{ corrupt json');
  const scoreboard = new ValleyScoreboard(storage);

  const rows = scoreboard.read();
  assert.deepEqual(rows, []);
  assert.match(scoreboard.error, /JSON/i);

  const leaderboard = scoreboard.getLeaderboard(5);
  assert.deepEqual(leaderboard, []);
});

test('changed rules characteristics discard every stored attempt', () => {
  const storage = new MockStorage();
  const scoreboard = new ValleyScoreboard(storage);
  const record = {
    pilotKind: 'human',
    status: 'succeeded',
    reason: 'completed',
    tick: 4800,
    manifest: { id: 'valley-slalom-v1', type: 'valley-slalom', physicsHz: 120, rulesVersion: VALLEY_SLALOM_RULES.version },
    result: { metrics: { finalScore: 12000 } },
  };
  scoreboard.add(record, { callsign: 'VIPER' });
  assert.equal(scoreboard.read().length, 1);

  storage.setItem(FINGERPRINT_KEY, JSON.stringify(
    [{ ...VALLEY_SLALOM_RULES, wallRiseM: [550, 800] }, TAKEOFF_SCORE_RULES, LANDING_SCORE_RULES]));
  assert.deepEqual(scoreboard.read(), []);
  assert.equal(storage.getItem('flight3d.valley-attempts.v1'), '[]');
  assert.equal(storage.getItem(FINGERPRINT_KEY), CURRENT_FINGERPRINT);
  assert.deepEqual(scoreboard.getLeaderboard(5), []);
});

test('takeoff and landing attempts are recorded; other mission types are not', () => {
  const storage = new MockStorage();
  const scoreboard = new ValleyScoreboard(storage);
  const takeoff = {
    pilotKind: 'ai', status: 'succeeded', reason: 'completed', tick: 1440,
    manifest: { id: 'takeoff-basic-v1', type: 'takeoff', physicsHz: 120, rulesVersion: '1.0.0' },
    result: { metrics: { finalScore: 8100 } },
  };
  const attempt = scoreboard.add(takeoff);
  assert.equal(attempt.callsign, 'AI');
  assert.equal(attempt.metrics.finalScore, 8100);
  assert.equal(scoreboard.getLeaderboard(5)[0].score, 8100);
  assert.equal(valleyAttempt({ ...takeoff, manifest: { ...takeoff.manifest, type: 'cruise' } }), null);
});
