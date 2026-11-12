import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTrack, decodeTrack, toBase64, fromBase64, decodedByteLength, combatByteLength,
  REPLAY_TRACK_VERSION, ROOM_TRACK_VERSION, COMBAT_TRACK_VERSION, COMBAT_EVENT_BYTES } from '../src/replay/ReplayCodec.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';
import { RECORD_BYTES, HEADER_BYTES, REPLAY_BUDGET, REPLAY_INTERVAL_LADDER,
  maxSamplesFor, maxTrackSeconds, base64ByteLength } from '../src/replay/replayConfig.js';

const UNIT_QUAT = (() => {
  const raw = [0.0123, 0.9876, -0.1234, 0.0869];
  const norm = Math.hypot(...raw);
  return raw.map(value => value / norm);
})();

function sample(timeSec, index = 0) {
  return {
    timeSec,
    x: 1200.5 + index, y: 1829.375, z: -440.125,
    quat: [...UNIT_QUAT],
    elevator: -0.35, aileron: 0.12, rudder: -0.05, pitchTrim: 0.2,
    throttle: 0.84, flapDegree: 15, flapIndex: 2, spoilers: 0.4, gearState: 1,
    compressions: { nose: 0.12, mainLeft: 0.31, mainRight: 0.29 },
    gearDamage: { nose: 'normal', mainLeft: 'damaged', mainRight: 'collapsed' },
    bodyDamage: { belly: 0.5, wingL: 0, engineL: 0.9 },
    iasKnots: 254.3, tasKnots: 291.6, groundSpeedKnots: 268.4, vsiFpm: -640,
    radioAltFt: 1420.5, mach: 0.742, gForce: 1.27,
    pitchDeg: 3.55, rollDeg: -8.25, headingDeg: 274.6,
    engine1: { n1: 87.4, n2: 94.1, egt: 612, ff: 1180, failed: false },
    engine2: { n1: 86.9, n2: 93.8, egt: 608, ff: 1172, failed: true },
    onGround: false, isTransit: false, touchdown: false, isStalled: false, isPreStall: true,
    isStallWarning: false, reverserActive: false, apEngaged: true, parkBrake: false,
    selectedHeading: 275, selectedAltitude: 6000, selectedSpeed: 250,
  };
}

function track(sampleCount = 300, intervalSec = 0.2) {
  const samples = [];
  for (let index = 0; index < sampleCount; index++) samples.push(sample(index * intervalSec, index));
  return { intervalSec, durationSec: (sampleCount - 1) * intervalSec, overflow: false,
    metadata: { airport: 'coastal', aircraft: 'B738', scenario: 'approach', gearIds: ['nose', 'mainLeft', 'mainRight'],
      bodyIds: ['belly', 'wingL', 'engineL'] },
    samples,
    gearIds: ['nose', 'mainLeft', 'mainRight'],
    bodyIds: ['belly', 'wingL', 'engineL'] };
}

test('every recorded field survives the round trip inside its quantization bound', () => {
  const decoded = decodeTrack(encodeTrack(track()));
  assert.equal(decoded.samples.length, 300);
  const a = decoded.samples[0];
  const b = sample(0, 0);
  assert.ok(Math.abs(a.x - b.x) < 1e-3, `x ${a.x}`);
  assert.ok(Math.abs(a.y - b.y) < 1e-3);
  assert.ok(Math.abs(a.z - b.z) < 1e-3);
  for (let index = 0; index < 4; index++) assert.ok(Math.abs(a.quat[index] - b.quat[index]) < 1e-4);
  assert.ok(Math.abs(a.elevator - b.elevator) < 0.008);
  assert.ok(Math.abs(a.aileron - b.aileron) < 0.008);
  assert.ok(Math.abs(a.rudder - b.rudder) < 0.008);
  assert.ok(Math.abs(a.pitchTrim - b.pitchTrim) < 0.008);
  assert.ok(Math.abs(a.throttle - b.throttle) < 0.004);
  assert.ok(Math.abs(a.spoilers - b.spoilers) < 0.004);
  assert.ok(Math.abs(a.gearState - b.gearState) < 0.004);
  assert.equal(a.flapDegree, b.flapDegree);
  assert.equal(a.flapIndex, b.flapIndex);
  assert.ok(Math.abs(a.compressions.nose - b.compressions.nose) < 0.006);
  assert.ok(Math.abs(a.compressions.mainLeft - b.compressions.mainLeft) < 0.006);
  assert.ok(Math.abs(a.compressions.mainRight - b.compressions.mainRight) < 0.006);
  assert.ok(Math.abs(a.iasKnots - b.iasKnots) < 0.06);
  assert.ok(Math.abs(a.tasKnots - b.tasKnots) < 0.06);
  assert.ok(Math.abs(a.groundSpeedKnots - b.groundSpeedKnots) < 0.06);
  assert.ok(Math.abs(a.vsiFpm - b.vsiFpm) < 0.6);
  assert.ok(Math.abs(a.radioAltFt - b.radioAltFt) < 0.3);
  assert.ok(Math.abs(a.mach - b.mach) < 0.0006);
  assert.ok(Math.abs(a.gForce - b.gForce) < 0.006);
  assert.ok(Math.abs(a.pitchDeg - b.pitchDeg) < 0.006);
  assert.ok(Math.abs(a.rollDeg - b.rollDeg) < 0.006);
  assert.ok(Math.abs(a.headingDeg - b.headingDeg) < 0.006);
  assert.ok(Math.abs(a.engine1.n1 - b.engine1.n1) < 0.26, `n1 ${a.engine1.n1}`);
  assert.ok(Math.abs(a.engine1.n2 - b.engine1.n2) < 0.26);
  assert.ok(Math.abs(a.engine1.egt - b.engine1.egt) < 2.01, `egt ${a.engine1.egt}`);
  assert.ok(Math.abs(a.engine1.ff - b.engine1.ff) < 5.01, `ff ${a.engine1.ff}`);
  assert.ok(a.engine1.egt <= 1000, 'EGT stays inside its byte range');
  assert.ok(Math.abs(a.selectedAltitude - b.selectedAltitude) < 4.1);
  assert.ok(Math.abs(a.selectedSpeed - b.selectedSpeed) < 0.06);
  assert.equal(a.gearDamage.mainLeft, 'damaged', 'gear damage states are preserved per leg');
  assert.equal(a.gearDamage.mainRight, 'collapsed');
  assert.equal(a.gearDamage.nose, 'normal');
  assert.equal(a.bodyDamage.belly, 0.3, 'body damage is preserved as present, not as magnitude');
  assert.equal(a.bodyDamage.wingL, 0);
  assert.equal(a.bodyDamage.engineL, 0.3);
});

test('flags and metadata survive, and reserved bits stay clear', () => {
  const decoded = decodeTrack(encodeTrack(track(3)));
  const first = decoded.samples[0];
  assert.equal(first.isPreStall, true);
  assert.equal(first.apEngaged, true);
  assert.equal(first.onGround, false);
  assert.equal(first.engine2.failed, true, 'per-engine failure is kept separate from the scalar dials');
  assert.equal(first.engine1.failed, false);
  assert.equal(first.parkBrake, false);
  assert.equal(decoded.metadata.airport, 'coastal');
  assert.equal(decoded.metadata.gearIds.length, 3);
  assert.equal(decoded.intervalSec, 0.2);
  assert.ok(Math.abs(decoded.durationSec - 0.4) < 1e-3);
  assert.equal(decoded.version, REPLAY_TRACK_VERSION);
});

test('base64 round trip is exact and survives the standard alphabet', () => {
  const bytes = encodeTrack(track(12));
  assert.equal(fromBase64(toBase64(bytes)).length, bytes.length);
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
  const standard = toBase64(bytes).replace(/-/g, '+').replace(/_/g, '/');
  assert.deepEqual([...fromBase64(standard)], [...bytes]);
  assert.equal(toBase64(bytes).length, base64ByteLength(bytes.length));
  assert.ok(!toBase64(bytes).includes('='), 'the compact form carries no padding');
});

test('a non-unit quaternion is rebuilt to unit length rather than skewing the pose', () => {
  const skewed = track(2);
  skewed.samples[0].quat = [0.5, 0.5, 0.5, 0.5001];
  const decoded = decodeTrack(encodeTrack(skewed));
  const length = Math.hypot(...decoded.samples[0].quat);
  assert.ok(Math.abs(length - 1) < 1e-3, `quat length ${length}`);
});

test('corrupt, truncated and foreign payloads are rejected instead of playing noise', () => {
  const bytes = encodeTrack(track(5));
  assert.throws(() => decodeTrack(bytes.subarray(0, bytes.length - 10)), /does not match/);
  assert.throws(() => decodeTrack(bytes.subarray(0, 8)), /truncated/);
  const foreign = new Uint8Array(bytes);
  foreign[0] = 'X'.charCodeAt(0);
  assert.throws(() => decodeTrack(foreign), /not a flight3d replay track/);
  const future = new Uint8Array(bytes);
  future[5] = COMBAT_TRACK_VERSION + 1;
  assert.throws(() => decodeTrack(future), /unsupported replay track version/);
  const badMeta = new Uint8Array(bytes);
  badMeta[HEADER_BYTES + 1] = 0xff;
  assert.throws(() => decodeTrack(badMeta), /metadata is corrupt/);
  assert.throws(() => fromBase64('not base64 !!!'), /not base64/);
  assert.throws(() => fromBase64(''), /empty/);
  assert.throws(() => decodeTrack('a string'), /requires bytes/);
  assert.throws(() => encodeTrack({ samples: 'nope' }), /samples array/);
});

test('track size is predictable from the sample count alone', () => {
  const one = encodeTrack(track(1));
  assert.equal(decodedByteLength(track(1)), one.length);
  const hundred = encodeTrack(track(100));
  assert.equal(hundred.length - one.length, 99 * RECORD_BYTES);
});

test('the sample budget keeps an entry inside the localStorage budget and a long flight still fits', () => {
  const metadataBytes = decodedByteLength(track(1)) - HEADER_BYTES - RECORD_BYTES;
  const budgetSamples = maxSamplesFor(REPLAY_BUDGET.entryBase64Bytes, metadataBytes);
  assert.ok(budgetSamples > 0);
  assert.equal(budgetSamples, Math.floor(
    (REPLAY_BUDGET.entryBase64Bytes * 3 / 4 - HEADER_BYTES - metadataBytes) / RECORD_BYTES));
  assert.ok(base64ByteLength(encodeTrack(track(budgetSamples)).length) <= REPLAY_BUDGET.entryBase64Bytes,
    'a full-budget track must actually fit the budget it was sized for');
  // The ladder's real capacity, not an aspiration: each rung holds maxSamples × its interval.
  for (const interval of REPLAY_INTERVAL_LADDER) {
    const seconds = budgetSamples * interval;
    const atLimit = track(budgetSamples, interval);
    const overLimit = track(budgetSamples + 1, interval);
    assert.ok(base64ByteLength(encodeTrack(atLimit).length) <= REPLAY_BUDGET.entryBase64Bytes,
      `${interval} s rung holds ${Math.round(seconds)} s`);
    assert.ok(base64ByteLength(encodeTrack(overLimit).length) > REPLAY_BUDGET.entryBase64Bytes,
      `${interval} s rung overflows past ${Math.round(seconds)} s`);
  }
  assert.ok(maxTrackSeconds() > 35 * 60, 'the coarsest rung must outlast a realistic long sortie');
});

test('valid-length imports reject corrupt timing, metadata and nonfinite poses', () => {
  const source = track(3);
  const bytes = encodeTrack(source);
  const badTime = bytes.slice();
  new DataView(badTime.buffer).setFloat32(12, NaN);
  assert.throws(() => decodeTrack(badTime), /timing is corrupt/);
  const duplicateTimes = { ...source, samples: [source.samples[0], source.samples[0]] };
  assert.throws(() => decodeTrack(encodeTrack(duplicateTimes)), /sample is corrupt/);
  // Replace the encoded empty object with JSON null of the same byte length as "null".
  const nullBytes = encodeTrack({ ...source, metadata: 'xx' });
  nullBytes.set(new TextEncoder().encode('null'), HEADER_BYTES);
  assert.throws(() => decodeTrack(nullBytes), /metadata is corrupt/);
  const badPose = bytes.slice();
  const firstRecord = HEADER_BYTES + new DataView(bytes.buffer).getUint16(16);
  new DataView(badPose.buffer).setFloat32(firstRecord + 4, NaN);
  assert.throws(() => decodeTrack(badPose), /sample is corrupt/);
});

test('combat tracks append a compact section and round-trip targets, missiles and markers', () => {
  const source = track(20);
  source.combat = {
    banditIntervalSec: 0.5,
    missileIntervalSec: 0.05,
    targets: [{ id: 3, callsign: 'BANDIT 1' }, { id: 7, callsign: 'BANDIT 2' }],
    banditSamples: Array.from({ length: 8 }, (_, index) => ({
      timeSec: index * 0.5,
      rails: 0b111110,
      targets: [
        { x: 100 + index, y: 3000, z: -5000, headingRad: 1.25, alive: true },
        { x: -100, y: 3100, z: -5100, headingRad: -0.5, alive: index < 4 },
      ],
    })),
    missileSamples: Array.from({ length: 10 }, (_, index) => ({
      timeSec: index * 0.05, id: 1, typeId: 'AIM9X',
      x: 1 + index, y: 3001, z: -20 - index, quat: [...UNIT_QUAT], powered: index < 6,
    })),
    events: [{ timeSec: 1.5, kind: 'detonation', missileId: 1, surface: false,
      x: 10, y: 3000, z: -4000, vx: 700, vy: 0, vz: 0 }],
  };
  const bytes = encodeTrack(source);
  assert.equal(bytes.length, decodedByteLength(source));
  assert.ok(bytes.length > encodeTrack(track(20)).length);
  const decoded = decodeTrack(bytes);
  assert.equal(decoded.version, COMBAT_TRACK_VERSION);
  assert.equal(decoded.combat.targets[0].callsign, 'BANDIT 1');
  assert.equal(decoded.combat.targets[1].callsign, 'BANDIT 2');
  assert.equal(decoded.combat.banditSamples.length, 8);
  assert.equal(decoded.combat.banditSamples[0].rails, 0b111110);
  assert.ok(Math.abs(decoded.combat.banditSamples[2].targets[0].x - 102) < 1e-3);
  assert.equal(decoded.combat.banditSamples[2].targets[1].alive, true);
  assert.equal(decoded.combat.banditSamples[5].targets[1].alive, false);
  assert.ok(Math.abs(decoded.combat.banditSamples[0].targets[0].headingRad - 1.25) < 1e-3);
  assert.equal(decoded.combat.missileSamples.length, 10);
  assert.equal(decoded.combat.missileSamples[0].powered, true);
  assert.ok(Math.abs(decoded.combat.missileSamples[0].quat[3] - UNIT_QUAT[3]) < 1e-3);
  assert.equal(decoded.combat.events[0].kind, 'detonation');
  assert.equal(decoded.combat.events[0].missileId, 1);
  assert.ok(Math.abs(decoded.combat.events[0].vx - 700) < 1e-3);
  assert.equal(combatByteLength(source.combat), bytes.length - encodeTrack(track(20)).length);
  const corrupt = bytes.slice(0, bytes.length - COMBAT_EVENT_BYTES - 2);
  assert.throws(() => decodeTrack(corrupt), /combat section length is corrupt/);
});

test('selected cruise altitude covers the airliner range without saturation', () => {
  for (const altitude of [6000, 13000, 35000, 41000]) {
    const source = track(2);
    source.samples[0].selectedAltitude = altitude;
    const decoded = decodeTrack(encodeTrack(source));
    assert.ok(Math.abs(decoded.samples[0].selectedAltitude - altitude) <= 4);
  }
});

test('pitch trim retains the full degree range used by the trim wheels', () => {
  for (const trim of [-5, -2.5, 2, 6.37, 12]) {
    const source = track(2); source.samples[0].pitchTrim = trim;
    assert.ok(Math.abs(decodeTrack(encodeTrack(source)).samples[0].pitchTrim - trim) <= .051);
  }
});

test('v2 fuel flow covers every supported aircraft maximum without changing record size', () => {
  const flows = [0, 350, 2550, 2551, 4500];
  for (const config of Object.values(AIRCRAFT_REGISTRY)) {
    assert.ok(Number.isFinite(config.propulsion.maxFuelFlowKgPerHour));
    flows.push(config.propulsion.maxFuelFlowKgPerHour);
  }
  for (const flow of flows) {
    const source = track(2);
    source.samples[0].engine1.ff = flow;
    source.samples[0].engine2.ff = flow;
    const bytes = encodeTrack(source);
    assert.equal(bytes.length, decodedByteLength(source));
    const decoded = decodeTrack(bytes);
    assert.equal(decoded.version, 2);
    for (const engine of ['engine1', 'engine2']) {
      assert.ok(Math.abs(decoded.samples[0][engine].ff - flow) <= 5, `${engine}: ${flow}`);
    }
  }
});

test('v1 files still decode their original one-byte fuel flow', () => {
  const source = track(2);
  source.samples[0].engine1.ff = 1180;
  source.samples[0].engine2.ff = 2550;
  const legacy = encodeTrack(source);
  legacy[5] = 1;
  const view = new DataView(legacy.buffer);
  const base = HEADER_BYTES + view.getUint16(16);
  // A genuine v1 record has zero-filled reserved bytes, not the v2 extension.
  for (let i = 0; i < source.samples.length; i++) legacy.fill(0, base + i * RECORD_BYTES + 73, base + (i + 1) * RECORD_BYTES);
  const decoded = decodeTrack(legacy);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.samples[0].engine1.ff, 1180);
  assert.equal(decoded.samples[0].engine2.ff, 2550);
});
