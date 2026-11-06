import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayRecorder } from '../src/core/ReplayRecorder.js';
import { encodeTrack, decodeTrack } from '../src/replay/ReplayCodec.js';
import { REPLAY_BUDGET, REPLAY_MIN_DURATION_SEC, REPLAY_INTERVAL_LADDER, RECORD_BYTES, HEADER_BYTES,
  base64ByteLength, maxSamplesFor } from '../src/replay/replayConfig.js';

const quat = { x: 0.01, y: 0.7, z: -0.02, w: 0.7139 };
const TELEMETRY = {
  x: 500, z: -800, altitudeFt: 4000, iasKnots: 180, gForce: 1.2, pitchDeg: 2.5, rollDeg: -4,
  headingDeg: 270, onGround: false, elevator: -0.2, aileron: 0.1, rudder: 0, pitchTrim: 0.05,
  throttle: 0.75, flapDegree: 10, flapIndex: 1, spoilers: 0, gearState: 1,
  tasKnots: 195, groundSpeedKnots: 188, vsiFpm: 250, radioAltFt: 3800, mach: 0.32,
  compressions: { nose: 0.1, mainLeft: 0.2, mainRight: 0.2 },
  gearDamage: { nose: 'normal', mainLeft: 'normal', mainRight: 'damaged' },
  bodyDamage: { belly: 0, wingL: 0.6, engineR: 0 },
  engine1: { n1: 80, n2: 88, egt: 520, ff: 900, failed: false },
  engine2: { n1: 79, n2: 87, egt: 515, ff: 890, failed: false },
  isTransit: false, touchdown: false, isStalled: false, isPreStall: false, isStallWarning: false,
  reverserActive: false, apEngaged: true, parkBrake: false,
  selectedHeading: 270, selectedAltitude: 4000, selectedSpeed: 180,
};
const METADATA = { airport: 'coastal', aircraft: 'B738', scenario: 'approach', timeOfDay: 14 };
const TICK = 1 / 120;

function record(seconds, recorder, telemetry = TELEMETRY, quaternion = quat) {
  for (let tick = 0; tick < Math.round(seconds * 120); tick++) recorder.update(TICK, telemetry, quaternion);
}

function started(options) {
  const recorder = new ReplayRecorder(options);
  recorder.start(METADATA);
  return recorder;
}

/** The grid opens on the first valid tick and finish() appends the final frame, so counts are ranged. */
function assertCount(samples, seconds, interval = 0.2) {
  const nominal = Math.floor((seconds - TICK) / interval) + 2;
  assert.ok(samples.length >= nominal - 1 && samples.length <= nominal + 1,
    `${samples.length} samples for ${seconds} s at ${interval} s, expected near ${nominal}`);
}

test('sampling follows simulation time only and captures the pose fields the renderer needs', () => {
  const recorder = started();
  record(5, recorder);
  assert.ok(Math.abs(recorder.elapsed - 5) < 1e-9, 'five seconds of 120 Hz ticks is five simulation seconds');
  const track = recorder.finish();
  assert.ok(Math.abs(track.durationSec - 5) < 1e-9);
  assert.equal(track.intervalSec, 0.2);
  assert.equal(track.overflow, false);
  assertCount(track.samples, 5);
  assert.equal(track.metadata.airport, 'coastal');
  assert.equal(track.samples[0].timeSec, TICK, 'the first pose is the first valid tick');
  assert.equal(track.samples.at(-1).timeSec, track.durationSec, 'the endpoint is always present');
  const first = track.samples[0];
  assert.ok(Math.abs(first.y - 4000 / 3.28084) < 1e-6, 'world y is recovered from altitude');
  assert.deepEqual(first.quat, [quat.x, quat.y, quat.z, quat.w]);
  assert.equal(first.gearDamage.mainRight, 'damaged');
  assert.deepEqual(track.metadata.gearIds, ['nose', 'mainLeft', 'mainRight']);
  assert.deepEqual(track.metadata.bodyIds, ['belly', 'wingL', 'engineR']);
  assert.equal(first.selectedAltitude, 4000);
  assert.equal(recorder.finish(), track, 'finish is idempotent and freezes the sortie');
  assert.equal(recorder.finish().samples.length, track.samples.length);
});

test('the track survives a real encode and decode cycle with its attitude intact', () => {
  const recorder = started();
  record(6, recorder);
  const decoded = decodeTrack(encodeTrack(recorder.finish()));
  assertCount(decoded.samples, 6);
  assert.equal(decoded.metadata.bodyIds.length, 3);
  const sample = decoded.samples[7];
  assert.ok(Math.abs(sample.iasKnots - 180) < 0.06);
  assert.ok(Math.abs(Math.hypot(...sample.quat) - 1) < 1e-4, 'decoded attitude is a unit quaternion');
  assert.equal(decoded.samples[0].bodyDamage.wingL, 0.3, 'present-but-not-absent body damage round trips');
  assert.equal(decoded.samples[0].bodyDamage.belly, 0);
  assert.equal(decoded.samples[0].gearDamage.mainRight, 'damaged');
});

test('a sortie too short or too degraded to be worth replaying yields no track', () => {
  assert.equal(started().finish(), null, 'no ticks, no track');
  const single = started();
  record(1, single);
  assert.equal(single.samples.length, 5);
  assert.equal(single.finish(), null, 'one second is not a replayable sortie');
  const partial = started();
  record(REPLAY_MIN_DURATION_SEC - 0.1, partial);
  assert.equal(partial.finish(), null);
  const enough = started();
  record(REPLAY_MIN_DURATION_SEC, enough);
  assert.ok(enough.finish().samples.length >= 25);
  const invalid = started();
  record(30, invalid, { ...TELEMETRY, altitudeFt: NaN });
  assert.ok(Math.abs(invalid.elapsed - 30) < 1e-8, 'observation time runs whether or not data is usable');
  assert.equal(invalid.validDuration, 0);
  assert.equal(invalid.finish(), null, 'sixty seconds of unusable frames is still no track');
});

test('malformed input is skipped without inventing pose, while simulation time still advances', () => {
  const recorder = started();
  recorder.update(NaN, TELEMETRY, quat);
  recorder.update(-1, TELEMETRY, quat);
  recorder.update(0, TELEMETRY, quat);
  record(0.25, recorder, { ...TELEMETRY, altitudeFt: NaN }, quat);
  record(0.25, recorder, { ...TELEMETRY, iasKnots: Infinity }, quat);
  assert.equal(recorder.samples.length, 0, 'a tick without valid altitude or airspeed records nothing');
  record(0.25, recorder, TELEMETRY, { x: NaN, y: 0, z: 0, w: 1 });
  record(0.25, recorder, TELEMETRY, null);
  assert.equal(recorder.samples.length, 0, 'a missing quaternion is not recoverable from attitude angles');
  assert.ok(Math.abs(recorder.elapsed - 1) < 1e-9, 'observation time is independent of data validity');
  assert.equal(recorder.validDuration, 0);
  record(6, recorder);
  assert.ok(recorder.samples.length >= 2, 'recording resumes as soon as valid frames return');
  assert.ok(recorder.validDuration > 5.9);
  assert.ok(Math.abs(recorder.samples[0].timeSec - (1 + TICK)) < 1e-9,
    'the grid restarts on the first valid frame after the gap');
});

test('the byte budget, not a sample count, drives the decimation ladder', () => {
  // A budget sized for five samples forces every rung of the ladder to be exercised in seconds.
  const budget = base64ByteLength(HEADER_BYTES + RECORD_BYTES * 5);
  const recorder = new ReplayRecorder({ maxBase64Bytes: budget });
  recorder.start(METADATA);
  record(10, recorder);
  assert.equal(recorder.interval, REPLAY_INTERVAL_LADDER.at(-1), 'the ladder climbs to its coarsest rung');
  assert.equal(recorder.overflow, true, 'past the coarsest rung the recorder refuses rather than truncates');
  const track = recorder.finish();
  assert.equal(track.overflow, true);
  assert.equal(track.intervalSec, 1.6);
  assert.ok(track.samples.length <= maxSamplesFor(budget, 0));
  assert.ok(Math.abs(track.durationSec - 10) < 1e-9, 'thinning the grid never shortens the sortie');
  const times = track.samples.map(sample => sample.timeSec);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'sample times stay monotonic after decimation');
  const decoded = decodeTrack(encodeTrack(track));
  assert.equal(decoded.intervalSec, 1.6, 'the coarsened interval is what gets stored');
});

test('an ordinary long sortie stays on the fine grid inside the real budget', () => {
  const recorder = started();
  record(240, recorder);
  const track = recorder.finish();
  assert.equal(track.intervalSec, 0.2, 'four minutes needs no decimation at the production budget');
  assert.equal(recorder.overflow, false);
  assertCount(track.samples, 240);
  assert.ok(track.samples.length <= maxSamplesFor(REPLAY_BUDGET.entryBase64Bytes, 0));
  assert.ok(base64ByteLength(encodeTrack(track).length) <= REPLAY_BUDGET.entryBase64Bytes,
    'a four minute sortie must be storable');
});

test('missing optional telemetry degrades to zeros instead of poisoning the track', () => {
  const sparse = { x: 10, z: 20, altitudeFt: 500, iasKnots: 90, gForce: 1, pitchDeg: 0, rollDeg: 0, headingDeg: 90 };
  const recorder = started();
  record(6, recorder, sparse, { x: 0, y: 0, z: 0, w: 1 });
  const track = recorder.finish();
  assertCount(track.samples, 6);
  assert.equal(track.samples[0].elevator, undefined);
  assert.deepEqual(track.samples[0].compressions, { nose: 0, mainLeft: 0, mainRight: 0 });
  assert.deepEqual(track.samples[0].engine1, { n1: 0, n2: 0, egt: 0, ff: 0, failed: false });
  assert.deepEqual(track.metadata.gearIds, []);
  const decoded = decodeTrack(encodeTrack(track));
  assert.equal(decoded.samples[0].iasKnots, 90);
  assert.equal(decoded.samples[0].spoilers, 0, 'undefined fields encode as zero, not NaN');
  assert.ok(Number.isFinite(decoded.samples[0].throttle));
  assert.ok(Number.isFinite(decoded.samples[0].selectedAltitude));
});

test('a fresh start discards the previous sortie instead of appending to it', () => {
  const recorder = started();
  record(6, recorder);
  const first = recorder.finish();
  const firstCount = first.samples.length;
  recorder.start({ ...METADATA, aircraft: 'F16' });
  record(5, recorder);
  const second = recorder.finish();
  assert.equal(second.metadata.aircraft, 'F16');
  assert.equal(first.metadata.aircraft, 'B738', 'the finished track is not mutated by the next sortie');
  assert.ok(Math.abs(second.durationSec - 5) < 1e-9);
  assert.ok(Math.abs(first.durationSec - 6) < 1e-9);
  assert.ok(second.samples.length < firstCount, 'the new track holds only the new sortie');
  assert.equal(first.samples.length, firstCount);
  assert.equal(second.samples[0].timeSec, TICK, 'elapsed time restarts with the new start');
});
