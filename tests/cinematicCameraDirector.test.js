import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CinematicCameraDirector,
  CINEMATIC_SHOTS,
} from '../src/cameras/CinematicCameraDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

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

test('CinematicCameraDirector eliminates forward-backward translation stutter at high speeds', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  director.switchShot(CINEMATIC_SHOTS.WINGTIP_ACTION);
  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();

  const relativeDistances = [];
  // Simulate fluctuating frame rates (14ms to 20ms) at 300 knots (154 m/s)
  for (let frame = 0; frame < 60; frame++) {
    const dt = 0.014 + (frame % 7) * 0.001;
    planePos.z -= 154 * dt;
    director.update({ dt, camera, planePos, planeQuat, flightState: { iasKnots: 300 } });
    relativeDistances.push(camera.position.distanceTo(planePos));
  }

  const minD = Math.min(...relativeDistances);
  const maxD = Math.max(...relativeDistances);
  assert.ok(maxD - minD < 0.2, `Wing camera must not stutter; distance variation was ${maxD - minD}m`);
});

test('Airborne flyby camera anchors altitude to aircraft altitude and centers aircraft in frame', () => {
  const camera = new THREE.PerspectiveCamera();
  const mountainElevation = () => 1500;
  const director = new CinematicCameraDirector({ camera, queryGroundHeight: mountainElevation });

  director.switchShot(CINEMATIC_SHOTS.TELEPHOTO_FLYBY);
  const planePos = new THREE.Vector3(0, 2000, 0);
  const planeQuat = new THREE.Quaternion();

  director.update({
    dt: 0.016,
    camera,
    planePos,
    planeQuat,
    flightState: { onGround: false, iasKnots: 250 },
    queryGroundHeight: mountainElevation,
  });

  assert.ok(camera.position.y >= 1950, `Airborne flyby camera (${camera.position.y}) must be near aircraft altitude (2000m)`);
  assert.ok(camera.position.y >= 1500 + 2.0, 'Camera must be above terrain');

  const toAircraft = planePos.clone().sub(camera.position).normalize();
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  assert.ok(camDir.dot(toAircraft) > 0.98, 'Camera must point directly at aircraft so it is centered in frame');
});

test('switchShot cuts instantly to target vantage point on next update frame', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();

  director.switchShot(CINEMATIC_SHOTS.TELEPHOTO_FLYBY);
  director.update({ dt: 0.016, camera, planePos, planeQuat });
  const flybyDist = camera.position.distanceTo(planePos);
  assert.ok(flybyDist > 150, `Flyby camera should be at distance > 150m, got ${flybyDist}m`);

  // Switch to DYNAMIC_ORBIT_DOLLY (orbit radius ~38m)
  director.switchShot(CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY);
  director.update({ dt: 0.016, camera, planePos, planeQuat });
  const dollyDist = camera.position.distanceTo(planePos);
  assert.ok(dollyDist < 55, `On cut, camera must immediately snap to dolly radius, got ${dollyDist}m`);
});

test('CinematicCameraDirector FOV is resilient to variable frame delta and external applyBaseFov', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.aspect = 0.46; // Portrait mobile aspect ratio
  const cameraSystem = new CameraSystem(camera);
  cameraSystem.setMode(CameraSystem.MODES.DIRECTOR, true);

  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();

  const fovHistory = [];
  // Simulate 30 frames with jittered frame times (16.6ms, 33.3ms, 8.3ms, etc.)
  const dts = [0.016, 0.033, 0.016, 0.008, 0.033, 0.016, 0.016, 0.025, 0.016];
  for (let i = 0; i < 40; i++) {
    const dt = dts[i % dts.length];
    planePos.z -= 100 * dt;
    // Simulates main.js loop: applyBaseFov called every frame before cameraSystem.update
    cameraSystem.applyBaseFov(100);
    cameraSystem.update(dt, { position: planePos, quaternion: planeQuat, matrixWorld: new THREE.Matrix4() });
    fovHistory.push(camera.fov);
  }

  // Once settled (after first 15 frames), frame-to-frame FOV changes should be tiny and smooth (< 0.2 deg)
  for (let i = 15; i < fovHistory.length - 1; i++) {
    const stepDiff = Math.abs(fovHistory[i + 1] - fovHistory[i]);
    assert.ok(
      stepDiff < 0.2,
      `FOV must not oscillate or jump on frame time jitter: frame ${i} had jump of ${stepDiff.toFixed(3)}° (fov=${fovHistory[i].toFixed(2)} -> ${fovHistory[i+1].toFixed(2)})`
    );
  }
});

test('CameraSystem.snapToTarget resets CinematicCameraDirector in DIRECTOR mode', () => {
  const camera = new THREE.PerspectiveCamera();
  const cameraSystem = new CameraSystem(camera);
  cameraSystem.setMode(CameraSystem.MODES.DIRECTOR, true);

  cameraSystem.cinematicDirector.initialized = true;
  cameraSystem.cinematicDirector.shotTimer = 4.0;
  cameraSystem.cinematicDirector.totalTimer = 10.0;

  const mockMesh = new THREE.Object3D();
  mockMesh.position.set(100, 200, 300);
  cameraSystem.snapToTarget(mockMesh);

  assert.equal(cameraSystem.cinematicDirector.initialized, false, 'Director should be reset on snapToTarget');
  assert.equal(cameraSystem.cinematicDirector.shotTimer, 0, 'Shot timer should be reset');
});
