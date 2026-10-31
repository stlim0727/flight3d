import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand, validateEnvelope, createEnvelope, validatePlainData, createBriefing } from '../src/pilot/PilotProtocol.js';
const valid = { elevator: 0, aileron: -1, rudder: 1, throttle: 0.8, brakes: 0 };
test('commands require every finite bounded axis and never partially sanitize invalid commands', () => {
  assert.deepEqual(validateCommand({ ...valid, future: true }), { ok: true, command: valid });
  for (const value of [NaN, Infinity, '0', null, 1.01, undefined]) assert.equal(validateCommand({ ...valid, elevator: value }).ok, false);
  assert.equal(validateCommand({ elevator: 0 }).ok, false);
  assert.equal(validateCommand({ ...valid, throttle: -0.1 }).ok, false);
});
test('plain-data boundary rejects getters, cycles, prototypes, depth and bytes', () => {
  let invoked = false;
  const accessor = { get elevator() { invoked = true; return 0; } };
  assert.equal(validateCommand(accessor).ok, false);
  assert.equal(invoked, false);
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [cyclic, new Date(), { x: () => 0 }, { x: undefined }, { x: Symbol() }, { x: BigInt(1) }]) assert.equal(validatePlainData(value).ok, false);
  assert.equal(validatePlainData({ x: '한글' }, { maxBytes: 10 }).ok, false);
  assert.equal(validatePlainData({ x: { y: 1 } }, { maxDepth: 1 }).ok, false);
  assert.equal(validatePlainData({ x: [1, null, true, 'ok'] }).ok, true);
});
test('envelopes reject wrong session, stale sequence, unknown types and protocol majors', () => {
  const meta = { sessionId: 'abc', sequence: 2, sampleTick: 24 };
  const msg = createEnvelope('command', meta, valid);
  assert.equal(validateEnvelope(msg, { type: 'command', sessionId: 'abc', sequence: 2 }).ok, true);
  for (const expected of [{ type: 'ready' }, { sessionId: 'old' }, { sequence: 1 }]) assert.equal(validateEnvelope(msg, expected).ok, false);
  assert.equal(validateEnvelope({ ...msg, type: 'execute' }).ok, false);
  assert.equal(validateEnvelope({ ...msg, meta: { ...msg.meta, protocolVersion: '2.0.0' } }).ok, false);
  assert.equal(validateEnvelope({ ...msg, meta: { ...msg.meta, sampleTick: NaN } }).ok, false);
  assert.equal(validateEnvelope({ ...msg, meta: { ...msg.meta, protocolVersion: '1.4.2' } }).ok, true);
});
test('briefing removes evaluator seed, world geometry and mutable references', () => {
  const manifest = { missionId: 'takeoff-basic-v1', sensorSeed: 99, spawn: { x: 100 }, runway: { id: 'test', headingDeg: 90, lengthM: 3000, widthM: 45, elevationM: 20, threshold: { x: 100 } }, configuration: { flaps: 5 } };
  const briefing = createBriefing(manifest);
  assert.equal(briefing.sensorSeed, undefined);
  assert.equal(briefing.spawn, undefined);
  assert.equal(briefing.runway.threshold, undefined);
  briefing.configuration.flaps = 30;
  assert.equal(manifest.configuration.flaps, 5);
});
