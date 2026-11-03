import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CinematicCameraDirector,
  CINEMATIC_SHOTS,
} from '../src/cameras/CinematicCameraDirector.js';

test('CinematicCameraDirector initializes with defaults and reset() cleans state', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  assert.equal(director.minShotDuration, 3.0);
  assert.equal(director.maxShotDuration, 6.5);
  assert.equal(director.shotTimer, 0);
  assert.equal(director.initialized, false);

  director.shotTimer = 5.0;
  director.totalTimer = 20.0;
  director.initialized = true;
  director.reset();

  assert.equal(director.shotTimer, 0);
  assert.equal(director.totalTimer, 0);
  assert.equal(director.initialized, false);
});

test('CinematicCameraDirector.analyzeFlightRecording extracts drama beats and sequences shots', () => {
  const dummyReport = {
    durationSec: 60.0,
    peaks: { altitudeFt: 5000, iasKnots: 350, gForce: 4.2 },
    touchdowns: [
      { timeSec: 45.0, sinkRateFpm: 180, contactG: 1.3 },
    ],
    samples: [
      { timeSec: 0.0, x: 0, z: 0, altitudeFt: 5, iasKnots: 20, gForce: 1.0, pitchDeg: 0, rollDeg: 0, headingDeg: 0 },
      { timeSec: 5.0, x: 0, z: -400, altitudeFt: 80, iasKnots: 140, gForce: 1.2, pitchDeg: 12, rollDeg: 0, headingDeg: 0 },
      { timeSec: 15.0, x: 200, z: -1500, altitudeFt: 180, iasKnots: 260, gForce: 1.5, pitchDeg: 2, rollDeg: 15, headingDeg: 20 },
      { timeSec: 25.0, x: 500, z: -3000, altitudeFt: 1500, iasKnots: 320, gForce: 4.2, pitchDeg: 8, rollDeg: 65, headingDeg: 90 },
      { timeSec: 45.0, x: 1000, z: -5000, altitudeFt: 10, iasKnots: 130, gForce: 1.3, pitchDeg: 3, rollDeg: 0, headingDeg: 180 },
      { timeSec: 60.0, x: 1000, z: -5500, altitudeFt: 5, iasKnots: 0, gForce: 1.0, pitchDeg: 0, rollDeg: 0, headingDeg: 180 },
    ],
    crash: null,
  };

  const analysis = CinematicCameraDirector.analyzeFlightRecording(dummyReport);

  assert.ok(analysis.beats.length >= 3, `Expected at least 3 drama beats, got ${analysis.beats.length}`);
  assert.ok(analysis.beats.some(b => b.type === 'TAKEOFF_ROTATION'), 'Should detect takeoff rotation');
  assert.ok(analysis.beats.some(b => b.type === 'HIGH_G_PEAK'), 'Should detect high G peak');
  assert.ok(analysis.beats.some(b => b.type === 'STEEP_BANK'), 'Should detect steep bank');
  assert.ok(analysis.beats.some(b => b.type === 'TOUCHDOWN'), 'Should detect touchdown');

  assert.ok(analysis.shots.length >= 5, `Expected multiple shots covering 60s, got ${analysis.shots.length}`);
  // Check continuity: shots cover entire duration without gaps
  for (let i = 0; i < analysis.shots.length - 1; i++) {
    assert.equal(analysis.shots[i].endTime, analysis.shots[i + 1].startTime, `Shot ${i} and ${i + 1} should be contiguous`);
  }
  assert.equal(analysis.shots[0].startTime, 0);
  assert.ok(Math.abs(analysis.shots.at(-1).endTime - 60.0) < 0.1, 'Last shot should reach end of duration');
});

test('Live camera update guarantees ground clearance over undulating terrain', () => {
  const camera = new THREE.PerspectiveCamera(50, 1.77, 0.1, 10000);
  const terrainElevation = (x, z) => 40 + Math.sin(x * 0.01) * 20; // 20m to 60m terrain
  const director = new CinematicCameraDirector({ camera, queryGroundHeight: terrainElevation });

  const planePos = new THREE.Vector3(100, 45, 200); // Near terrain height
  const planeQuat = new THREE.Quaternion();

  for (let frame = 0; frame < 120; frame++) {
    planePos.z -= 5;
    director.update({
      dt: 0.016,
      camera,
      planePos,
      planeQuat,
      flightState: { iasKnots: 200, gForce: 1.0, altitudeFt: 150 },
      queryGroundHeight: terrainElevation,
    });

    const groundAtCam = terrainElevation(camera.position.x, camera.position.z);
    assert.ok(
      camera.position.y >= groundAtCam + 1.5,
      `Camera y (${camera.position.y}) must stay >= terrain (${groundAtCam}) + 1.5m at frame ${frame}`
    );
    assert.ok(Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y) && Number.isFinite(camera.position.z));
    assert.ok(Number.isFinite(camera.fov) && camera.fov > 15 && camera.fov < 100);
  }
});

test('Director respects minimum shot duration and triggers dramatic cuts on high G and touchdown', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  const planePos = new THREE.Vector3(0, 500, 0);
  const planeQuat = new THREE.Quaternion();

  // Initial shot
  director.update({
    dt: 0.1,
    camera,
    planePos,
    planeQuat,
    flightState: { onGround: false, iasKnots: 250, gForce: 1.0, rollDeg: 0 },
  });
  const firstShot = director.currentShotType;

  // Simulate extreme high-G maneuver before minShotDuration (2.0s elapsed)
  for (let t = 0; t < 19; t++) {
    director.update({
      dt: 0.1,
      camera,
      planePos,
      planeQuat,
      flightState: { onGround: false, iasKnots: 350, gForce: 3.5, rollDeg: 60 },
    });
  }
  // At 2.0s (< 3.0s min hold), shot should NOT cut immediately (anti-flicker hysteresis)
  assert.equal(director.currentShotType, firstShot, 'Must hold shot until minShotDuration');

  // Advance past 3.0s with high-G active
  for (let t = 0; t < 15; t++) {
    director.update({
      dt: 0.1,
      camera,
      planePos,
      planeQuat,
      flightState: { onGround: false, iasKnots: 350, gForce: 3.5, rollDeg: 60 },
    });
  }
  assert.equal(
    director.currentShotType,
    CINEMATIC_SHOTS.HIGH_G_BANK_HERO,
    'Should cut to HIGH_G_BANK_HERO once minShotDuration reached'
  );

  // Advance past another 3.0s and simulate touchdown
  for (let t = 0; t < 35; t++) {
    director.update({
      dt: 0.1,
      camera,
      planePos,
      planeQuat,
      flightState: { onGround: false, iasKnots: 130, gForce: 1.0, rollDeg: 0 },
    });
  }
  // Now touchdown occurs
  director.update({
    dt: 0.1,
    camera,
    planePos,
    planeQuat,
    flightState: { onGround: true, iasKnots: 120, gForce: 1.4, rollDeg: 0 },
  });
  assert.equal(
    director.currentShotType,
    CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER,
    'Touchdown should trigger TOUCHDOWN_SPOTTER'
  );
});

test('Replay plan execution advances shots deterministically based on timeline', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  const plan = {
    durationSec: 15.0,
    shots: [
      { startTime: 0.0, endTime: 5.0, type: CINEMATIC_SHOTS.TELEPHOTO_FLYBY },
      { startTime: 5.0, endTime: 10.0, type: CINEMATIC_SHOTS.WINGTIP_ACTION },
      { startTime: 10.0, endTime: 15.0, type: CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY },
    ],
  };

  director.loadReplayPlan(plan);
  const planePos = new THREE.Vector3(0, 100, 0);
  const planeQuat = new THREE.Quaternion();

  // At t = 1.0s -> TELEPHOTO_FLYBY
  director.update({ dt: 1.0, camera, planePos, planeQuat, flightState: {} });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.TELEPHOTO_FLYBY);

  // Advance to t = 6.0s -> WINGTIP_ACTION
  for (let i = 0; i < 5; i++) {
    director.update({ dt: 1.0, camera, planePos, planeQuat, flightState: {} });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.WINGTIP_ACTION);

  // Advance to t = 11.0s -> DYNAMIC_ORBIT_DOLLY
  for (let i = 0; i < 5; i++) {
    director.update({ dt: 1.0, camera, planePos, planeQuat, flightState: {} });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY);
});
