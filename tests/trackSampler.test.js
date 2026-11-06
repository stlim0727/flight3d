import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleTrack, findSpan, trackDuration } from '../src/replay/TrackSampler.js';

function pose(overrides = {}) {
  return {
    timeSec: 0, x: 0, y: 100, z: 0, quat: [0, 0, 0, 1],
    elevator: 0, aileron: 0, rudder: 0, pitchTrim: 0, throttle: 0.5,
    flapDegree: 0, flapIndex: 0, spoilers: 0, gearState: 1,
    compressions: { nose: 0, mainLeft: 0, mainRight: 0 },
    gearDamage: { nose: 'normal' }, bodyDamage: { belly: 0 },
    iasKnots: 120, tasKnots: 130, groundSpeedKnots: 125, vsiFpm: 0, radioAltFt: 300,
    mach: 0.2, gForce: 1, pitchDeg: 0, rollDeg: 0, headingDeg: 90,
    engine1: { n1: 60, n2: 70, egt: 400, ff: 300, failed: false },
    engine2: { n1: 60, n2: 70, egt: 400, ff: 300, failed: false },
    onGround: true, isTransit: false, touchdown: false, isStalled: false, isPreStall: false,
    isStallWarning: false, reverserActive: false, apEngaged: false, parkBrake: false,
    selectedHeading: 90, selectedAltitude: 1000, selectedSpeed: 120,
    ...overrides,
  };
}

function two(from, to) {
  return { intervalSec: 0.2, durationSec: to.timeSec, metadata: {}, samples: [from, to] };
}

test('sampling returns the endpoints exactly and clamps outside the track instead of extrapolating', () => {
  const track = two(pose({ timeSec: 0, x: 10 }), pose({ timeSec: 2, x: 20 }));
  assert.equal(sampleTrack(track, 0).x, 10);
  assert.equal(sampleTrack(track, 2).x, 20);
  assert.equal(sampleTrack(track, -5).x, 10, 'a seek before the first sample clamps forward');
  assert.equal(sampleTrack(track, 900).x, 20, 'a seek past the end clamps at the last sample');
  assert.ok(Math.abs(sampleTrack(track, 1).x - 15) < 1e-9);
  assert.equal(sampleTrack(track, 1).timeSec, 1);
});

test('interpolated scalars, derived altitude and quaternion all agree at the midpoint', () => {
  const track = two(
    pose({ timeSec: 0, x: 0, y: 100, elevator: -1, iasKnots: 100, quat: [0, 0, 0, 1] }),
    pose({ timeSec: 1, x: 8, y: 200, elevator: 1, iasKnots: 200, quat: [0.1, 0, 0, 0.995] }));
  const mid = sampleTrack(track, 0.5);
  assert.equal(mid.x, 4);
  assert.equal(mid.y, 150);
  assert.ok(Math.abs(mid.altitudeFt - 150 * 3.28084) < 1e-3, 'altitude is derived from interpolated y');
  assert.equal(mid.elevator, 0);
  assert.equal(mid.iasKnots, 150);
  assert.ok(Math.abs(mid.quat[0] - 0.050125) < 1e-3);
  assert.ok(Math.abs(Math.hypot(...mid.quat) - 1) < 1e-6, 'interpolated attitude stays a unit quaternion');
});

test('heading takes the short way round instead of spinning through the whole compass', () => {
  const across = two(pose({ timeSec: 0, headingDeg: 359 }), pose({ timeSec: 1, headingDeg: 1 }));
  assert.ok(Math.abs(sampleTrack(across, 0.5).headingDeg - 0) < 1e-9);
  const back = two(pose({ timeSec: 0, headingDeg: 1 }), pose({ timeSec: 1, headingDeg: 359 }));
  assert.ok(Math.abs(sampleTrack(back, 0.5).headingDeg - 0) < 1e-9);
  const wide = two(pose({ timeSec: 0, headingDeg: 10 }), pose({ timeSec: 1, headingDeg: 30 }));
  assert.ok(Math.abs(sampleTrack(wide, 0.5).headingDeg - 20) < 1e-9);
});

test('a negated quaternion is the same attitude, so slerp must not rotate through 180 degrees', () => {
  const track = two(pose({ timeSec: 0, quat: [0, 0, 0, 1] }), pose({ timeSec: 1, quat: [0, 0, 0, -1] }));
  const mid = sampleTrack(track, 0.5);
  assert.ok(Math.abs(Math.hypot(...mid.quat) - 1) < 1e-6);
  assert.ok(Math.abs(Math.abs(mid.quat[3]) - 1) < 1e-6, `w ${mid.quat[3]}`);
  assert.equal(mid.quat[0], 0);
});

test('discrete channels jump at the half-way mark and are never blended', () => {
  const track = two(
    pose({ timeSec: 0, flapIndex: 1, selectedAltitude: 1000, onGround: true, parkBrake: true,
      gearDamage: { nose: 'normal' }, bodyDamage: { belly: 0 }, engine1: { n1: 50, n2: 60, egt: 300, ff: 200, failed: false } }),
    pose({ timeSec: 1, flapIndex: 3, selectedAltitude: 4000, onGround: false, parkBrake: false,
      gearDamage: { nose: 'collapsed' }, bodyDamage: { belly: 0.8 }, engine1: { n1: 90, n2: 95, egt: 700, ff: 900, failed: true } }));
  const early = sampleTrack(track, 0.4);
  assert.equal(early.flapIndex, 1);
  assert.equal(early.selectedAltitude, 1000);
  assert.equal(early.onGround, true);
  assert.equal(early.parkBrake, true);
  assert.equal(early.gearDamage.nose, 'normal');
  assert.equal(early.bodyDamage.belly, 0);
  assert.equal(early.engine1.failed, false);
  const late = sampleTrack(track, 0.6);
  assert.equal(late.flapIndex, 3);
  assert.equal(late.selectedAltitude, 4000);
  assert.equal(late.onGround, false);
  assert.equal(late.gearDamage.nose, 'collapsed');
  assert.equal(late.bodyDamage.belly, 0.8);
  assert.equal(late.engine1.failed, true, 'an engine failure must not smear across the boundary');
  // Engine scalars are dials, so they do blend.
  assert.ok(late.engine1.n1 > 60 && late.engine1.n1 < 90);
});

test('seeking backwards and then forwards returns the identical pose for the same time', () => {
  const samples = [];
  for (let index = 0; index < 40; index++) {
    samples.push(pose({ timeSec: index * 0.2, x: index * 3, headingDeg: (index * 20) % 360,
      quat: [Math.sin(index / 8) * 0.2, 0, 0, Math.cos(index / 8) * 0.98] }));
  }
  const track = { intervalSec: 0.2, durationSec: samples.at(-1).timeSec, metadata: {}, samples };
  const state = {};
  const out = {};
  const forward = t => structuredClone(sampleTrack(track, t, out, state));
  for (let index = 0; index < 40; index++) forward(index * 0.2);
  const seekBack = forward(5.0);
  const again = forward(3.0);
  const revisited = forward(5.0);
  assert.deepEqual(seekBack, revisited, 'a backwards seek must not change what the same time resolves to');
  assert.ok(Math.abs(again.x - 45) < 1e-9, `x ${again.x}`);
  const scrub = [];
  for (let index = 0; index < 12; index++) scrub.push(forward(7.4 - index * 0.6).x);
  assert.deepEqual(scrub, [...scrub].sort((a, b) => b - a), 'scrubbing backwards is monotonic');
});

test('unanswerable requests return null rather than a fabricated pose', () => {
  const track = two(pose({ timeSec: 0 }), pose({ timeSec: 1 }));
  for (const time of [NaN, Infinity, -Infinity, undefined, null, '1']) {
    assert.equal(sampleTrack(track, time), null, `${time} cannot be sampled`);
  }
  assert.equal(sampleTrack({ samples: [pose({ timeSec: 0 })] }, 0.5), null, 'one sample is not a track');
  assert.equal(sampleTrack({ samples: [] }, 0.5), null);
  assert.equal(sampleTrack(undefined, 0.5), null);
  assert.equal(sampleTrack({ samples: 'nope' }, 0.5), null);
});

test('findSpan tracks forward playback without rescanning and re-seeds after a backwards seek', () => {
  const samples = [];
  for (let index = 0; index < 100; index++) samples.push(pose({ timeSec: index * 0.2 }));
  assert.equal(findSpan(samples, 0), 0);
  assert.equal(findSpan(samples, 19.8), 98, 'never returns the final index');
  assert.equal(findSpan(samples, 999, 50), 98);
  assert.equal(findSpan(samples, 5.0, 50), 25, 'a stale hint ahead of the time is ignored');
  assert.equal(findSpan(samples, 5.0, 10), 25);
  assert.equal(findSpan(samples, 5.1, 25), 25, 'an in-span hint is reused');
  assert.equal(findSpan(samples, -3), 0);
  assert.equal(findSpan([{ timeSec: 0 }], 1), 0, 'a single sample cannot form a span');
  assert.ok(trackDuration({ durationSec: 3, samples }) === 19.8, 'duration comes from the last sample');
  assert.equal(trackDuration({ samples: [] }), 0);
  assert.equal(trackDuration({}), 0);
});

test('the output object is reused without leaking stale engine state between calls', () => {
  const track = two(pose({ timeSec: 0, x: 0 }), pose({ timeSec: 1, x: 10 }));
  const out = {};
  const state = {};
  const first = sampleTrack(track, 0.25, out, state);
  assert.equal(first, out, 'the caller-owned object is returned');
  const second = sampleTrack(track, 0.75, out, state);
  assert.equal(second, out);
  assert.equal(out.x, 7.5);
  assert.equal(Object.keys(out.engine1).sort().join(','), 'egt,failed,ff,n1,n2');
});

test('a track that has not been through the codec yet still samples finite', () => {
  const bare = { samples: [{ timeSec: 0, x: 0, y: 0, z: 0, quat: [0, 0, 0, 1] },
    { timeSec: 1, x: 10, y: 5, z: -2, quat: [0, 0, 0, 1] }] };
  const mid = sampleTrack(bare, 0.5);
  assert.ok(mid, 'a bare pose track is still sampleable');
  assert.equal(mid.x, 5);
  for (const name of ['elevator', 'iasKnots', 'altitudeFt', 'headingDeg', 'gForce', 'selectedAltitude']) {
    assert.ok(Number.isFinite(mid[name]), `${name} is ${mid[name]}`);
  }
  assert.ok(mid.quat.every(Number.isFinite));
  assert.ok(Number.isFinite(mid.compressions.nose));
  assert.ok(Number.isFinite(mid.engine1.egt));
  assert.equal(mid.onGround, false, 'absent flags read as false, not undefined');
  assert.equal(mid.engine1.failed, false);
});
