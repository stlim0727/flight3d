import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  approachPhase,
  decelerationThrottle,
  playbackDurations,
  rolloutReason,
  nextRolloutPitch,
} from '../scripts/record-flight-video.mjs';

describe('recorded sortie guards', () => {
  it('does not start final approach while still laterally far from the runway', () => {
    // Abeam RW07: along-course distance is small, but the jet is 13 km off course.
    assert.equal(approachPhase({
      alongCourseM: 320,
      crossTrackM: -13451,
      absoluteDistanceM: 13455,
    }), 'intercept');
    assert.equal(approachPhase({
      alongCourseM: 4000,
      crossTrackM: 200,
      absoluteDistanceM: 4005,
    }), 'final');
    assert.equal(approachPhase({
      alongCourseM: 60000,
      crossTrackM: 0,
      absoluteDistanceM: 60000,
    }), 'enroute');
  });

  it('keeps thrust while decelerating with gear down', () => {
    const gearDown = decelerationThrottle({ iasKnots: 250, targetIasKnots: 145, gearDown: true });
    assert.ok(gearDown >= 0.15, `gear-down throttle ${gearDown}`);
    assert.ok(gearDown < 0.8);
    const clean = decelerationThrottle({ iasKnots: 250, targetIasKnots: 145 });
    assert.ok(clean >= 0.1);
  });

  it('applies playback speed only to encode durations', () => {
    assert.deepEqual(playbackDurations([0, 100, 250], 1), [100, 150, 150]);
    assert.deepEqual(playbackDurations([0, 100, 250], 3), [100 / 3, 50, 50]);
  });

  it('does not report a fast rollout timeout as a successful landing', () => {
    assert.equal(rolloutReason(100, 42), 'rollout-timeout');
    assert.equal(rolloutReason(5, 42), 'landed');
    assert.equal(rolloutReason(100, 10), null);
  });

  it('lowers rollout pitch target each tick instead of freezing flare input', () => {
    assert.equal(nextRolloutPitch(10, 0.05), 9.85);
    assert.equal(nextRolloutPitch(6.8, 0.05), 6.7);
    assert.equal(nextRolloutPitch(6.7, 0.05), 6.7);
  });
});
