import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomReplayRecorder } from '../src/core/RoomReplayRecorder.js';
import { ReplayStore } from '../src/replay/ReplayStore.js';
import { encodeTrack, decodeTrack, decodedByteLength, REPLAY_TRACK_VERSION,
  ROOM_TRACK_VERSION } from '../src/replay/ReplayCodec.js';
import { sampleTrack, sampleRemote } from '../src/replay/TrackSampler.js';
import { RECORD_BYTES, REMOTE_RECORD_BYTES, HEADER_BYTES, REPLAY_INTERVAL_LADDER,
  base64ByteLength, frameBytes } from '../src/replay/replayConfig.js';

const TICK = 1 / 60;

class MockStorage {
  constructor() { this.store = new Map(); }
  getItem(key) { return this.store.get(key) ?? null; }
  setItem(key, value) { this.store.set(key, String(value)); }
  removeItem(key) { this.store.delete(key); }
}
const QUAT = { x: 0, y: 0.6, z: 0, w: 0.8 };
const METADATA = { airport: 'coastal', aircraft: 'C172', scenario: 'cruise', timeOfDay: 12 };
const PILOTS = [{ name: 'Wing', aircraft: 'C172', slot: 1 }];

function telemetry(x) {
  return { x, z: -200, altitudeFt: 3000, iasKnots: 110, gForce: 1, pitchDeg: 2, rollDeg: 0, headingDeg: 90,
    gearState: 1, flapDegree: 0, engine1: { n1: 80, n2: 0, egt: 600, ff: 30 } };
}

function remote(x, { round = 1, epoch = 0, crashed = false, held = false, stale = false } = {}) {
  return { p: [x, 900, 60], q: [0, 0.6, 0, 0.8], v: [50, 0, 0], gear: 0.5, flaps: 10,
    crashed, held, stale, talking: false, round, epoch, seq: 1 };
}

/** Flies `seconds` of 60 Hz frames, letting `frame(time)` describe the room at each tick. */
function fly(recorder, seconds, frame) {
  let time = recorder.elapsed;
  for (let tick = 0; tick < Math.round(seconds / TICK); tick++) {
    time += TICK;
    const { x = time * 50, ...room } = frame(time);
    recorder.update(TICK, telemetry(x), QUAT, room);
  }
}

function started(pilots = PILOTS, options) {
  const recorder = new RoomReplayRecorder(options);
  recorder.start(METADATA, pilots);
  return recorder;
}

test('every frame holds the local aircraft and each remote pilot at the same instant', () => {
  const recorder = started();
  fly(recorder, 6, time => ({ segment: '1:0', remotes: [remote(1000 + time * 40)] }));
  const track = recorder.finish();
  assert.equal(track.remotes.length, 1);
  assert.equal(track.remotes[0].name, 'Wing');
  assert.deepEqual(track.metadata.remotes, PILOTS, 'the pilot list survives as library metadata');
  const pose = track.remotes[0].samples;
  assert.equal(pose.length, track.samples.length);
  for (let index = 0; index < pose.length; index++) {
    assert.equal(pose[index].timeSec, track.samples[index].timeSec, 'one shared clock');
    assert.ok(Math.abs(pose[index].x - (1000 + pose[index].timeSec * 40)) < 1e-6);
  }
  assert.equal(pose[3].visible, true);
  assert.equal(pose[3].gearState, 0.5);
  assert.equal(pose[3].flapDegree, 10);
  assert.ok(!('remotes' in track.samples[0]), 'local samples keep the solo shape');
  assert.equal(recorder.finish(), track, 'finish stays idempotent');
});

test('an unseen pilot is recorded as a gap rather than a pose', () => {
  const recorder = started();
  fly(recorder, 6, time => ({ remotes: [time > 2 && time < 3 ? null : remote(1000)] }));
  const pose = recorder.finish().remotes[0].samples;
  const gap = pose.filter(sample => !sample.visible);
  assert.ok(gap.length >= 4 && gap.every(sample => sample.timeSec > 2 && sample.timeSec < 3.01));
  assert.ok(pose.filter(sample => sample.visible).every(sample => sample.x === 1000));
});

test('respawns and restarts start a new segment for whichever aircraft teleported', () => {
  const recorder = started();
  fly(recorder, 3, () => ({ segment: '1:0', remotes: [remote(1000)] }));
  fly(recorder, 3, () => ({ segment: '1:0', remotes: [remote(5000, { epoch: 1 })] }));
  fly(recorder, 3, () => ({ segment: '2:0', remotes: [remote(1000, { round: 2 })] }));
  const track = recorder.finish();
  const localSegments = [...new Set(track.samples.map(sample => sample.segment))];
  const remoteSegments = [...new Set(track.remotes[0].samples.map(sample => sample.segment))];
  assert.deepEqual(localSegments, [0, 1], 'the local aircraft respawned once, at the restart');
  assert.deepEqual(remoteSegments, [0, 1, 2], 'the remote pilot respawned, then the room restarted');
});

test('a room track round-trips as v3 while solo tracks stay readable by older builds', () => {
  const recorder = started();
  fly(recorder, 6, time => ({ segment: time < 3 ? 'a' : 'b',
    remotes: [time < 1 ? null : remote(1000 + time, { crashed: time > 5, held: time > 4, stale: time > 4.5 })] }));
  const track = recorder.finish();
  const bytes = encodeTrack(track);
  assert.equal(bytes[5], ROOM_TRACK_VERSION);
  assert.equal(bytes.length, decodedByteLength(track));
  const metadataLength = new DataView(bytes.buffer).getUint16(16);
  assert.equal(bytes.length, HEADER_BYTES + metadataLength + track.samples.length * (RECORD_BYTES + REMOTE_RECORD_BYTES));
  const decoded = decodeTrack(bytes);
  assert.equal(decoded.version, ROOM_TRACK_VERSION);
  assert.deepEqual(decoded.metadata.remotes, PILOTS);
  assert.deepEqual(decoded.samples.map(sample => sample.segment), track.samples.map(sample => sample.segment));
  const [source, copy] = [track.remotes[0].samples, decoded.remotes[0].samples];
  assert.equal(decoded.remotes[0].name, 'Wing');
  assert.equal(copy.length, source.length);
  for (let index = 0; index < source.length; index++) {
    for (const name of ['visible', 'crashed', 'held', 'stale', 'segment']) {
      assert.equal(copy[index][name], source[index][name], `${name} at ${index}`);
    }
    assert.equal(copy[index].timeSec, decoded.samples[index].timeSec, 'remote poses share the frame clock');
    if (!source[index].visible) continue;
    assert.ok(Math.abs(copy[index].x - source[index].x) < 1e-3);
    assert.ok(Math.abs(copy[index].gearState - 0.5) <= 1 / 255);
    assert.ok(Math.abs(copy[index].flapDegree - 10) <= 0.5);
    assert.ok(source[index].quat.every((value, axis) => Math.abs(copy[index].quat[axis] - value) < 1e-4));
  }
  // A track with no remote pilots is an ordinary solo track.
  const solo = encodeTrack({ ...track, remotes: undefined, metadata: METADATA });
  assert.equal(solo[5], REPLAY_TRACK_VERSION);
  assert.equal(decodeTrack(solo).remotes, undefined);
});

test('the frame width scales with the room so more pilots fit the same format', () => {
  const pilots = [...PILOTS, { name: 'Lead', aircraft: 'F16', slot: 2 }];
  const recorder = started(pilots);
  fly(recorder, 6, time => ({ remotes: [remote(1000), time < 3 ? null : remote(2000, { epoch: 4 })] }));
  const track = recorder.finish();
  assert.equal(frameBytes(2), RECORD_BYTES + 2 * REMOTE_RECORD_BYTES);
  const decoded = decodeTrack(encodeTrack(track));
  assert.deepEqual(decoded.remotes.map(remote => remote.name), ['Wing', 'Lead']);
  assert.ok(decoded.remotes[1].samples.at(-1).x === 2000 && decoded.remotes[0].samples.at(-1).x === 1000);
});

test('a room longer than the coarsest rung keeps its most recent frames and still saves', () => {
  // Room for 30 frames: the ladder reaches its coarsest rung after a minute, then slides.
  const budget = base64ByteLength(HEADER_BYTES + 400 + 30 * frameBytes(1));
  const recorder = started(PILOTS, { maxBase64Bytes: budget });
  fly(recorder, 240, time => ({ remotes: [remote(time)] }));
  const track = recorder.finish();
  assert.equal(track.overflow, false, 'a room is never refused for its length');
  assert.equal(track.intervalSec, REPLAY_INTERVAL_LADDER.at(-1));
  assert.ok(track.samples.length <= recorder.capacity());
  assert.equal(track.samples[0].timeSec, 0, 'playback of a trimmed room starts at zero');
  assert.ok(track.durationSec > 30 && track.durationSec < 60, `${track.durationSec} s kept`);
  const lastRemote = track.remotes[0].samples.at(-1);
  assert.ok(Math.abs(lastRemote.x - 240) < 0.1, 'the window ends at the room end');
  assert.ok(base64ByteLength(encodeTrack(track).length) <= budget, 'a full window fits its budget');
  const store = new ReplayStore(new MockStorage(),
    { budget: { entryBase64Bytes: budget, entries: 8, totalBase64Bytes: budget * 8 } });
  const { entry, error } = store.save(track);
  assert.equal(error, null);
  assert.equal(store.get(entry.id).track.remotes[0].samples.length, track.samples.length);
});

test('playback never blends across a respawn or toward an unseen pilot', () => {
  const at = (timeSec, segment, x, visible = true) => ({ timeSec, segment, x, y: 0, z: 0, quat: [0, 0, 0, 1],
    gearState: 1, flapDegree: 0, visible, crashed: false, held: false, stale: false });
  const local = [at(0, 0, 0), at(1, 0, 100), at(2, 1, 5000), at(3, 1, 5100)];
  const track = { samples: local, remotes: [{ name: 'Wing', samples: [
    at(0, 0, 0), at(1, 0, 10), at(2, 0, 0, false), at(3, 1, 900), at(4, 1, 910)] }] };
  assert.equal(sampleTrack(track, 0.5).x, 50, 'inside a segment the track interpolates');
  assert.equal(sampleTrack(track, 1.5).x, 100, 'the crash pose holds until the respawn');
  assert.equal(sampleTrack(track, 2).x, 5000);
  assert.equal(sampleTrack(track, 2.5).x, 5050);
  assert.equal(sampleRemote(track, 0, 0.5).x, 5);
  const fading = sampleRemote(track, 0, 1.5);
  assert.equal(fading.visible, true);
  assert.equal(fading.x, 10, 'no blend toward a sample with no pose');
  assert.equal(sampleRemote(track, 0, 2.5).visible, false);
  assert.equal(sampleRemote(track, 0, 3).x, 900);
  assert.equal(sampleRemote(track, 0, 3.5).x, 905);
  assert.equal(sampleRemote(track, 0, 99).x, 910, 'seeks clamp to the track');
  assert.equal(sampleRemote(track, 1, 1), null, 'an unknown pilot has no pose');
});

test('malformed room payloads are rejected rather than misread', () => {
  const recorder = started();
  fly(recorder, 6, () => ({ remotes: [remote(1000)] }));
  const track = recorder.finish();
  assert.throws(() => encodeTrack({ ...track, remotes: [{ name: 'Wing', samples: [] }] }), /share the local frames/);
  const bytes = encodeTrack(track);
  const truncated = bytes.subarray(0, bytes.length - REMOTE_RECORD_BYTES);
  assert.throws(() => decodeTrack(truncated), /does not match/);
  const asSolo = new Uint8Array(bytes);
  asSolo[5] = REPLAY_TRACK_VERSION;
  assert.throws(() => decodeTrack(asSolo), /does not match/, 'a v2 reader cannot mistake frame widths');
  const noPilots = encodeTrack({ ...track, remotes: undefined, metadata: METADATA });
  noPilots[5] = ROOM_TRACK_VERSION;
  assert.throws(() => decodeTrack(noPilots), /metadata is corrupt/);
  const badPose = new Uint8Array(bytes);
  const firstRemote = HEADER_BYTES + new DataView(bytes.buffer).getUint16(16) + RECORD_BYTES;
  new DataView(badPose.buffer).setFloat32(firstRemote, NaN);
  assert.throws(() => decodeTrack(badPose), /sample is corrupt/);
});
