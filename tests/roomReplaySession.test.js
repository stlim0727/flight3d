import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomReplaySession } from '../src/replay/RoomReplaySession.js';
import { RoomReplayRecorder } from '../src/core/RoomReplayRecorder.js';
import { ReplayStore } from '../src/replay/ReplayStore.js';
import { encodeTrack, decodeTrack, toBase64 } from '../src/replay/ReplayCodec.js';
import { sampleTrack, sampleRemote, roomStateAt } from '../src/replay/TrackSampler.js';
import { ROOM_REPLAY_ENABLED } from '../src/replay/replayConfig.js';

const metadata = { airport: 'coastal', aircraft: 'C172', scenario: 'cruise',
  room: { code: 'ABC123', local: { name: 'Local', slot: 0, aircraft: 'C172' } } };
const pilots = [{ name: 'Wing', slot: 1, aircraft: 'C172' }];
const quaternion = { x: 0, y: 0, z: 0, w: 1 };
function pose(x, local = {}, remote = {}) {
  return { telemetry: { x, z: 0, altitudeFt: 3000, iasKnots: 100, gForce: 1,
    pitchDeg: 0, rollDeg: 0, headingDeg: 0 }, quaternion, segment: '1:0', local,
  remotes: [{ p: [x + 100, 900, 0], q: [0, 0, 0, 1], round: 1, epoch: 0,
    gear: 1, flaps: 0, crashed: false, held: false, stale: false, ...remote }] };
}
function fixture(options = {}) {
  let now = 0;
  const saved = [], results = [];
  const session = new RoomReplaySession({ saveRoomAuto(track) { saved.push(track); return { entry: { id: 'room' }, error: null }; } },
    { now: () => now, onSaved: result => results.push(result), ...options });
  return { session, saved, results, tick(dt, observation) { now += dt * 1000; session.observe(observation); },
    advance(dt) { now += dt * 1000; } };
}

test('room integration remains disabled until the multi-aircraft viewer ships', () => {
  assert.equal(ROOM_REPLAY_ENABLED, false);
});

test('room clock continues through local hold, crash, respawn and round restart; saves exactly once', () => {
  const f = fixture(); f.session.start(metadata, pilots);
  for (let i = 1; i <= 20; i++) f.tick(0.2, pose(i));
  for (let i = 21; i <= 30; i++) f.tick(0.2, pose(20, { held: true }, { p: [i + 100, 900, 0] }));
  f.tick(0.2, pose(20, { crashed: true, crash: { type: 'WATER', speedKnots: 80 } }, { crashed: true }));
  const firstCrash = f.session.recorder.elapsed;
  for (let i = 0; i < 10; i++) f.tick(0.2, { ...pose(5000), segment: '1:1' });
  f.session.start(metadata, pilots); // host restarts: no new clock or recorder
  f.tick(0.2, { ...pose(0, {}, { round: 2 }), segment: '2:0' });
  f.tick(0.2, { ...pose(0, { crashed: true, crash: { type: 'TERRAIN' } }), segment: '2:0' });
  f.session.finish('peer-left'); f.session.finish('pagehide');
  assert.equal(f.saved.length, 1); assert.equal(f.results.length, 1);
  const track = decodeTrack(encodeTrack(f.saved[0]));
  assert.ok(track.durationSec > 8);
  assert.equal(track.metadata.room.endReason, 'peer-left');
  assert.equal(roomStateAt(track, 0, 5).held, true);
  assert.ok(sampleRemote(track, 0, 5).x > 120, 'remote keeps moving while local is held');
  assert.equal(roomStateAt(track, 0, firstCrash + 0.01).crash.type, 'WATER');
  assert.equal(roomStateAt(track, 0, 7).crashed, false);
  assert.equal(roomStateAt(track, 0, track.durationSec).crash.type, 'TERRAIN');
  const out = {};
  sampleTrack(track, firstCrash, out);
  sampleTrack(track, 7, out);
  assert.equal(out.crashed, false);
  assert.equal(out.crash, undefined, 'seeking past respawn clears old crash details');
});

test('suspended clock records a gap, never interpolates the jump, and keeps shared timestamps', () => {
  const f = fixture(); f.session.start(metadata, pilots);
  for (let i = 0; i < 30; i++) f.tick(0.2, pose(10));
  f.tick(20, pose(5000));
  for (let i = 0; i < 10; i++) f.tick(0.2, pose(5000));
  f.session.finish('left');
  const track = decodeTrack(encodeTrack(f.saved[0]));
  assert.ok(track.durationSec >= 28 - 1e-6);
  assert.equal(sampleTrack(track, 15).visible, false);
  assert.equal(sampleRemote(track, 0, 15).visible, false);
  assert.equal(sampleTrack(track, 20).x, 10, 'gap has no fabricated in-between position');
  assert.equal(sampleTrack(track, 26.01).x, 5000);
  assert.equal(sampleTrack(track, 26.01).visible, true);
  assert.deepEqual(track.samples.map(s => s.timeSec), track.remotes[0].samples.map(s => s.timeSec));
});

test('stale remote and round preparation are gaps even after pose thinning', () => {
  const f = fixture({ recorder: new RoomReplayRecorder({ maxBase64Bytes: 6000 }) });
  f.session.start(metadata, pilots);
  for (let i = 0; i < 70; i++) f.tick(0.2, pose(1));
  const gapAt = f.session.recorder.elapsed + 0.2;
  f.tick(0.2, pose(1, { visible: false, held: true }, { stale: true }));
  f.tick(0.2, pose(4000));
  for (let i = 0; i < 12; i++) f.tick(0.2, pose(4000));
  f.session.finish('left');
  const track = decodeTrack(encodeTrack(f.saved[0]));
  const t = gapAt - track.metadata.room.startOffsetSec;
  assert.equal(sampleTrack(track, t + 0.01).visible, false);
  assert.equal(sampleRemote(track, 0, t + 0.01).visible, false);
  assert.ok(track.intervalSec > 0.2);
});

test('long room trims state history with poses, retaining initial crash state within byte budget', () => {
  const budget = 6000;
  const f = fixture({ recorder: new RoomReplayRecorder({ maxBase64Bytes: budget }) });
  f.session.start(metadata, pilots);
  for (let i = 0; i < 1200; i++) f.tick(0.2, pose(i, { crashed: true, crash: { type: 'SHIP' } }));
  f.session.finish('timeout');
  const track = f.saved[0];
  assert.equal(track.metadata.room.partial, true);
  assert.ok(track.metadata.room.startOffsetSec > 0);
  assert.ok(Math.abs(track.metadata.room.sessionDurationSec - 240) < 1e-6);
  assert.equal(track.samples[0].timeSec, 0);
  assert.equal(track.metadata.room.timeline[0].timeSec, 0);
  assert.equal(roomStateAt(track, 0, 0).crash.type, 'SHIP');
  assert.ok(toBase64(encodeTrack(track)).length <= budget);
});

test('rapid state changes bound history by shortening the same pose window', () => {
  const budget = 6000;
  const f = fixture({ recorder: new RoomReplayRecorder({ maxBase64Bytes: budget }) });
  f.session.start(metadata, pilots);
  for (let i = 0; i < 300; i++) f.tick(0.2, pose(i, { held: i % 2 === 0 }));
  f.session.finish('left');
  const track = f.saved[0];
  assert.equal(track.metadata.room.partial, true);
  assert.ok(toBase64(encodeTrack(track)).length <= budget);
  assert.equal(track.metadata.room.timeline[0].timeSec, 0);
  assert.ok(track.metadata.room.timeline.every(event => event.timeSec <= track.durationSec));
});

test('unstarted or mostly unobserved rooms never replace a valid save', () => {
  const f = fixture();
  assert.doesNotThrow(() => f.session.gap(), 'blur before the first room is harmless');
  assert.equal(f.session.finish('cancelled'), null);
  f.session.start(metadata, pilots);
  f.tick(0.2, pose(0)); f.tick(60, pose(1));
  assert.equal(f.session.finish('pagehide'), null);
  assert.equal(f.saved.length, 0);
});

test('unobserved tail remains hidden through the real session end and a new room starts fresh', () => {
  const f = fixture(); f.session.start(metadata, pilots);
  for (let i = 0; i < 30; i++) f.tick(0.2, pose(i));
  f.advance(10); f.session.finish('timeout');
  const track = decodeTrack(encodeTrack(f.saved[0]));
  assert.equal(sampleTrack(track, 15).visible, false);
  assert.equal(sampleRemote(track, 0, 15).visible, false);
  assert.doesNotThrow(() => f.session.gap(), 'blur after finalization leaves the frozen track alone');
  f.session.start(metadata, pilots);
  for (let i = 0; i < 30; i++) f.tick(0.2, pose(i));
  f.session.finish('left');
  assert.equal(f.saved.length, 2);
  assert.ok(f.saved[1].durationSec < 6.1);
  assert.equal(f.saved[1].metadata.room.partial, false);
});

test('save errors reach the caller and survive as a next-visit notice when storage allows it', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, removeItem: key => data.delete(key),
    setItem(key, value) { if (key.startsWith('flight3d.replay.')) throw new Error('quota'); data.set(key, value); } };
  const store = new ReplayStore(storage);
  const f = fixture(); f.session.store = store; f.session.start(metadata, pilots);
  for (let i = 0; i < 30; i++) f.tick(0.2, pose(i));
  const result = f.session.finish('pagehide');
  assert.equal(result.entry, null); assert.ok(result.error);
  assert.equal(f.results.length, 1);
  assert.equal(store.consumeRoomSaveFailure(), true);
  assert.equal(store.consumeRoomSaveFailure(), false);
});

test('room timeline and partial metadata survive unified export/import; corrupt states are rejected', () => {
  const f = fixture(); f.session.start(metadata, pilots);
  for (let i = 0; i < 30; i++) f.tick(0.2, pose(i, { held: i > 15 }));
  f.session.finish('left');
  const data = new Map();
  const store = new ReplayStore({ getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) });
  const first = store.saveRoomAuto(f.saved[0]).entry;
  const json = store.exportJson(first.id);
  assert.equal(JSON.parse(json).kind, 'flight3d.sortie.v1');
  const imported = store.importJson(json).entry;
  assert.deepEqual(store.get(imported.id).track.metadata.room, f.saved[0].metadata.room);
  assert.equal(imported.auto, undefined);
  const broken = structuredClone(f.saved[0]);
  broken.metadata.room.timeline[0].states = [];
  assert.throws(() => decodeTrack(encodeTrack(broken)), /timeline is corrupt/);
});
