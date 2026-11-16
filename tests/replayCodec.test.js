import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTrack, decodeTrack, toBase64, fromBase64, decodedByteLength, combatByteLength,
  REPLAY_TRACK_VERSION, ROOM_TRACK_VERSION, COMBAT_TRACK_VERSION, COMBAT_EVENT_BYTES,
  REPLAY_CONTAINER_MAGIC, REPLAY_CONTAINER_VERSION, CONTAINER_HEADER_BYTES,
  inspectContainerHeader, encodeReplayContainer, decodeReplayContainer,
  compressGzip, decompressGzip, encodeCompressedContainer, decodeCompressedContainer,
  isGzipBytes, isContainerBytes } from '../src/replay/ReplayCodec.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';
import { RECORD_BYTES, HEADER_BYTES, REPLAY_BUDGET, REPLAY_INTERVAL_LADDER,
  maxSamplesFor, maxSamplesForTrack, maxTrackSeconds, base64ByteLength, resolveReplayBudget } from '../src/replay/replayConfig.js';

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

test('combat v5 preserves bandit attitude and v4 heading-only tracks still decode', () => {
  const source = track(2);
  source.combat = {
    version: 5,
    targets: [{ callsign: 'BANDIT' }],
    banditSamples: [{ timeSec: 0, targets: [{ x: 1, y: 3000, z: -50, headingRad: 0.7,
      alive: true, quaternion: UNIT_QUAT }] }],
    missileSamples: [], events: [],
  };
  const bytes = encodeTrack(source);
  const target = decodeTrack(bytes).combat.banditSamples[0].targets[0];
  target.quaternion.forEach((value, index) => assert.ok(Math.abs(value - UNIT_QUAT[index]) < 1 / 32767));
  // The v4 wire format has the same header/pose data, without the final 8-byte attitude.
  const legacy = bytes.slice(0, -8);
  legacy[5] = 4;
  const view = new DataView(legacy.buffer);
  const poseEnd = HEADER_BYTES + view.getUint16(16) + source.samples.length * RECORD_BYTES;
  view.setUint32(poseEnd, view.getUint32(poseEnd) - 8);
  const decoded = decodeTrack(legacy);
  assert.equal(decoded.version, 4);
  assert.equal(decoded.combat.banditSamples[0].targets[0].headingRad, 0.7);
  assert.equal(decoded.combat.banditSamples[0].targets[0].quaternion, undefined);
});

test('container round-trips solo, combat, and multiplayer room tracks with independent container version', async () => {
  // 1. Solo v2 track with Unicode UTF-8 report
  const soloTrack = track(25);
  const soloReport = { label: '김포 · Approach ✈️', reason: 'landed', durationSec: soloTrack.durationSec,
    samples: [{ timeSec: 0, altitudeFt: 3000, gForce: 1.0 }, { timeSec: 4.8, altitudeFt: 100, gForce: 1.3 }] };
  const container = encodeReplayContainer({ report: soloReport, track: soloTrack });
  assert.equal(isContainerBytes(container), true);
  assert.equal(String.fromCharCode(...container.subarray(0, 4)), REPLAY_CONTAINER_MAGIC);
  assert.equal(container[4], REPLAY_CONTAINER_VERSION);
  const header = inspectContainerHeader(container);
  assert.equal(header.version, REPLAY_CONTAINER_VERSION);
  assert.equal(header.totalByteLength, container.byteLength);
  assert.equal(container.byteLength, CONTAINER_HEADER_BYTES + header.reportByteLength + header.trackByteLength);
  const decodedRaw = decodeReplayContainer(container);
  assert.equal(decodedRaw.version, REPLAY_CONTAINER_VERSION);
  assert.equal(decodedRaw.track.version, REPLAY_TRACK_VERSION);
  assert.deepEqual(decodedRaw.report, soloReport);
  assert.equal(decodedRaw.track.samples.length, 25);

  // Gzip compressed solo container
  const gzSolo = await encodeCompressedContainer({ report: soloReport, track: soloTrack });
  assert.equal(isGzipBytes(gzSolo), true);
  const decGzSolo = await decodeCompressedContainer(gzSolo);
  assert.equal(decGzSolo.version, REPLAY_CONTAINER_VERSION);
  assert.equal(decGzSolo.track.version, REPLAY_TRACK_VERSION);
  assert.deepEqual(decGzSolo.report, soloReport);
  assert.ok(Math.abs(decGzSolo.track.samples[10].x - soloTrack.samples[10].x) < 1e-3);

  // 2. Combat v8 track
  const combatTrack = track(15);
  combatTrack.metadata.aircraft = 'F16';
  combatTrack.combat = {
    version: COMBAT_TRACK_VERSION,
    banditIntervalSec: 0.5,
    missileIntervalSec: 0.05,
    targets: [{ id: 9, callsign: 'BANDIT 1' }],
    banditSamples: [{ timeSec: 0, rails: 0x3e, targets: [{ x: 100, y: 3000, z: -5000, headingRad: 1.1, alive: true, damage: 0.4, damageZones: { wingL: 0.5 } }] }],
    missileSamples: [{ timeSec: 0.2, id: 1, typeId: 'AIM9X', x: 50, y: 3000, z: -100, quat: [...UNIT_QUAT], powered: true }],
    events: [{ timeSec: 0.2, kind: 'launch', missileId: 1, targetId: 9, locked: true, x: 50, y: 3000, z: -100 }],
  };
  const decCombat = await decodeCompressedContainer(await encodeCompressedContainer({ report: { label: 'Combat' }, track: combatTrack }));
  assert.equal(decCombat.version, REPLAY_CONTAINER_VERSION);
  assert.equal(decCombat.track.version, COMBAT_TRACK_VERSION);
  assert.equal(decCombat.track.combat.targets[0].id, 9);
  assert.equal(decCombat.track.combat.events[0].kind, 'launch');
  assert.equal(decCombat.track.combat.events[0].targetId, 9);

  // 3. Multiplayer room v3 track
  const roomTrack = {
    intervalSec: 0.2,
    durationSec: 2,
    metadata: {
      airport: 'coastal', aircraft: 'C172', scenario: 'cruise',
      room: { code: 'ROOM1', rounds: 1, endReason: 'left', partial: false, sessionDurationSec: 2, startOffsetSec: 0,
        local: { name: 'Lead', slot: 0, aircraft: 'C172' },
        timeline: [{ timeSec: 0, states: [
          { visible: true, held: false, crashed: false, stale: false, segment: 0 },
          { visible: true, held: false, crashed: false, stale: false, segment: 0 },
        ] }] },
    },
    samples: Array.from({ length: 10 }, (_, idx) => ({ ...sample(idx * 0.2, idx), segment: 0 })),
    remotes: [{
      name: 'Wing', slot: 1, aircraft: 'C172',
      samples: Array.from({ length: 10 }, (_, idx) => ({
        timeSec: idx * 0.2, x: 200 + idx, y: 900, z: 0, quat: [...UNIT_QUAT],
        gearState: 1, flapDegree: 0, visible: true, crashed: false, held: false, stale: false, segment: 0,
      })),
    }],
  };
  const decRoom = await decodeCompressedContainer(await encodeCompressedContainer({ report: { label: 'Room' }, track: roomTrack }));
  assert.equal(decRoom.version, REPLAY_CONTAINER_VERSION);
  assert.equal(decRoom.track.version, ROOM_TRACK_VERSION);
  assert.deepEqual(decRoom.track.metadata.room, roomTrack.metadata.room);
  assert.equal(decRoom.track.remotes[0].samples.length, 10);
});

test('container rejects truncated, corrupt, wrong-version, and oversized header payloads before decoding', () => {
  const valid = encodeReplayContainer({ report: { label: 'test' }, track: track(5) });
  assert.throws(() => inspectContainerHeader(valid.subarray(0, CONTAINER_HEADER_BYTES - 1)), /truncated/);
  const badMagic = valid.slice();
  badMagic[0] = 0x58;
  assert.throws(() => decodeReplayContainer(badMagic), /not a flight3d replay container/);

  for (const version of [0, REPLAY_CONTAINER_VERSION + 1]) {
    const badVer = valid.slice();
    badVer[4] = version;
    assert.throws(() => decodeReplayContainer(badVer), /unsupported replay container version/);
  }

  // Oversized length prefix in header must fail before allocation or JSON/track decoding.
  const hugeReport = valid.slice();
  new DataView(hugeReport.buffer).setUint32(5, 0xffffffff);
  assert.throws(() => inspectContainerHeader(hugeReport), /exceeds decompressed size limit/);
  const hugeTrack = valid.slice();
  new DataView(hugeTrack.buffer).setUint32(9, 0xffffffff);
  assert.throws(() => inspectContainerHeader(hugeTrack), /exceeds decompressed size limit/);

  assert.throws(() => decodeReplayContainer(valid.subarray(0, valid.length - 3)), /truncated/);
  const trailing = new Uint8Array(valid.length + 2);
  trailing.set(valid);
  assert.throws(() => decodeReplayContainer(trailing), /does not match/);

  // Non-object report JSON and invalid UTF-8 bytes are rejected.
  const arrayReport = encodeReplayContainer({ report: { label: 'a' }, track: track(2) });
  const view = new DataView(arrayReport.buffer);
  const repLen = view.getUint32(5);
  arrayReport.set(new TextEncoder().encode('[' + ' '.repeat(repLen - 2) + ']'), CONTAINER_HEADER_BYTES);
  assert.throws(() => decodeReplayContainer(arrayReport), /report is corrupt/);

  const badUtf8 = valid.slice();
  badUtf8[CONTAINER_HEADER_BYTES] = 0xff;
  assert.throws(() => decodeReplayContainer(badUtf8), /report is corrupt/);

  const noTrack = encodeReplayContainer({ report: { label: 'only report' }, track: null });
  assert.equal(decodeReplayContainer(noTrack).track, null);
  assert.throws(() => decodeReplayContainer(noTrack, { requireTrack: true }), /no track/);
});

test('gzip streaming validates compressed limits, corrupt streams, and decompressed limits early', async () => {
  const validGz = await encodeCompressedContainer({ report: { label: 'flight' }, track: track(10) });
  await assert.rejects(() => decompressGzip(new Uint8Array(0)), /empty/);
  await assert.rejects(() => decompressGzip(new TextEncoder().encode('{"kind":"json"}')), /not gzip/);
  await assert.rejects(() => decompressGzip(validGz.subarray(0, validGz.length - 4)), /corrupt or truncated/);

  const badCrc = validGz.slice();
  badCrc[badCrc.length - 6] ^= 0xff;
  await assert.rejects(() => decompressGzip(badCrc), /corrupt or truncated/);

  const trailingGz = new Uint8Array(validGz.length + 4);
  trailingGz.set(validGz);
  trailingGz.set([1, 2, 3, 4], validGz.length);
  await assert.rejects(() => decompressGzip(trailingGz), /corrupt or truncated/);

  // Oversized compressed input (and Blob) rejected against maxCompressedBytes.
  await assert.rejects(
    () => decompressGzip(validGz, { maxCompressedBytes: validGz.byteLength - 1 }),
    /compressed size limit/,
  );
  const bigBlob = new Blob([validGz], { type: 'application/gzip' });
  await assert.rejects(
    () => decompressGzip(bigBlob, { maxCompressedBytes: validGz.byteLength - 1 }),
    /compressed size limit/,
  );

  // Zip bomb: small gzip payload that expands past maxDecompressedBytes aborts during streaming.
  const bombPlain = new Uint8Array(200_000);
  const bombGz = await compressGzip(bombPlain);
  assert.ok(bombGz.byteLength < 2_000, 'highly compressible payload stays small on wire');
  await assert.rejects(
    () => decompressGzip(bombGz, { maxCompressedBytes: 10_000, maxDecompressedBytes: 32_768 }),
    /decompressed size limit/,
  );

  // Malicious container inside valid gzip declaring huge header sizes aborts at first 13 bytes.
  const spoofedHeader = new Uint8Array(100);
  spoofedHeader.set([0x46, 0x33, 0x44, 0x43, REPLAY_CONTAINER_VERSION]);
  new DataView(spoofedHeader.buffer).setUint32(5, 50_000_000);
  const spoofedGz = await compressGzip(spoofedHeader);
  await assert.rejects(
    () => decodeCompressedContainer(spoofedGz),
    /decompressed size limit/,
  );
});

test('resolveReplayBudget separates compressed and decompressed limits cleanly', () => {
  assert.ok(REPLAY_BUDGET.entryTrackBytes === 120_000);
  assert.ok(REPLAY_BUDGET.entryCompressedBytes === 120_000);
  assert.ok(REPLAY_BUDGET.entryDecompressedBytes > REPLAY_BUDGET.entryTrackBytes);
  assert.equal(maxSamplesForTrack(REPLAY_BUDGET.entryTrackBytes, 0), maxSamplesFor(REPLAY_BUDGET.entryBase64Bytes, 0));
  const custom = resolveReplayBudget({ entryCompressedBytes: 50_000, totalCompressedBytes: 250_000, entryDecompressedBytes: 180_000 });
  assert.equal(custom.entryCompressedBytes, 50_000);
  assert.equal(custom.totalCompressedBytes, 250_000);
  assert.equal(custom.entryDecompressedBytes, 180_000);
});
