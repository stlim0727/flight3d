import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { playbackDurations, resolveSortieDestination } from '../scripts/record-flight-video.mjs';
import {
  approachPhase,
  decelerationThrottle,
  rolloutReason,
  nextRolloutPitch,
  streamedApproach, terrainAltitudeAhead,
} from '../scripts/lib/recordedSortieController.js';

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

describe('Gimpo sortie destination', () => {
  it('routes the rkss option to a streamed Gimpo landing and its own mp4', () => {
    const destination = resolveSortieDestination('rkss');
    assert.equal(destination.lobby, 'RKSS');
    assert.equal(destination.controller, 'RKSS');
    assert.equal(destination.output, 'f16-icn-gimpo.mp4');
    assert.equal(resolveSortieDestination('jeju').controller, 'jeju');
    assert.throws(() => resolveSortieDestination('london'), /Unknown destination/);
  });

  it('derives the streamed runway course and threshold elevation for approach guidance', () => {
    const heading = 135.8, length = 3200, d = Math.PI / 180;
    const a = { x: 100, z: 200, elevationM: 10.36 };
    const b = { x: a.x + Math.sin(heading * d) * length,
      z: a.z - Math.cos(heading * d) * length, elevationM: 12.5 };
    const data = streamedApproach({ terrain: { runways: [{ ends: [
      { threshold: a }, { threshold: b },
    ] }] } });
    assert.ok(Math.abs(data.headingDeg - heading) < 0.01, `course ${data.headingDeg}`);
    assert.deepEqual(data.threshold, { x: a.x, z: a.z });
    assert.ok(Math.abs(data.elevationFt - 10.36 / 0.3048) < 0.01);
    assert.equal(data.gsAngleDeg, 3);
    assert.equal(streamedApproach({ terrain: { runways: [] } }), null);
  });
  it('samples terrain along the flown bearing rather than the Jeju corridor', () => {
    const surface = { getHeight: x => (x >= 1500 ? 500 : 0) };
    const altitude = terrainAltitudeAhead({ x: 0, z: 0 }, { x: 3000, z: 0 }, surface);
    assert.equal(altitude, 560);
  });
});
