import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CinematicCameraDirector,
  CINEMATIC_SHOTS,
} from '../src/cameras/CinematicCameraDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { BOEING_737_800, F16_FALCON, CESSNA_172 } from '../src/config/aircraftConfigs.js';

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

test('CinematicCameraDirector enforces fuselage clearance for all shot types', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  const planePos = new THREE.Vector3(500, 1000, -2000);
  const planeQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);

  const shotsToTest = [
    CINEMATIC_SHOTS.COCKPIT_HERO,
    CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY,
    CINEMATIC_SHOTS.HIGH_G_BANK_HERO,
    CINEMATIC_SHOTS.LEAD_IN_TRACKING,
    CINEMATIC_SHOTS.TELEPHOTO_FLYBY,
    CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM,
    CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER,
  ];

  for (const shot of shotsToTest) {
    director.switchShot(shot);
    director.update({
      dt: 0.016,
      camera,
      planePos,
      planeQuat,
      flightState: { iasKnots: 250, gForce: 1.0, onGround: false },
    });

    // Check camera position in aircraft local coordinates
    const rel = camera.position.clone().sub(planePos);
    const local = rel.applyQuaternion(planeQuat.clone().invert());

    const radX = director.fuselageRadiusX;
    const radY = director.fuselageRadiusY;
    const halfLen = director.fuselageLength * 0.5;

    if (local.z >= -halfLen && local.z <= halfLen) {
      const normX = local.x / radX;
      const normY = (local.y - director.fuselageCenterY) / radY;
      const distSq = normX * normX + normY * normY;
      assert.ok(
        distSq >= 0.98,
        `Shot ${shot} camera must be outside fuselage (distSq was ${distSq.toFixed(3)}, local=[${local.x.toFixed(2)}, ${local.y.toFixed(2)}, ${local.z.toFixed(2)}])`
      );
    }
  }

  // Also test all 4 wing hardpoints of WINGTIP_ACTION
  for (let hp = 0; hp < 4; hp++) {
    director.currentShotType = CINEMATIC_SHOTS.WINGTIP_ACTION;
    director.wingHardpointIndex = hp;
    director.snapNextFrame = true;
    director.update({
      dt: 0.016,
      camera,
      planePos,
      planeQuat,
      flightState: { iasKnots: 250, gForce: 1.0, onGround: false },
    });

    const rel = camera.position.clone().sub(planePos);
    const local = rel.applyQuaternion(planeQuat.clone().invert());
    const radX = director.fuselageRadiusX;
    const radY = director.fuselageRadiusY;
    const halfLen = director.fuselageLength * 0.5;

    if (local.z >= -halfLen && local.z <= halfLen) {
      const normX = local.x / radX;
      const normY = (local.y - director.fuselageCenterY) / radY;
      const distSq = normX * normX + normY * normY;
      assert.ok(
        distSq >= 0.98,
        `WINGTIP_ACTION hardpoint ${hp} camera must be outside fuselage (distSq was ${distSq.toFixed(3)}, local=[${local.x.toFixed(2)}, ${local.y.toFixed(2)}, ${local.z.toFixed(2)}])`
      );
    }
  }
});

test('enforceFuselageClearance pushes interior points outside fuselage boundary', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  const planePos = new THREE.Vector3(100, 500, 200);
  const planeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.1));

  // Point at center of fuselage
  const centerPoint = planePos.clone();
  director.enforceFuselageClearance(centerPoint, planePos, planeQuat);

  const localCenter = centerPoint.clone().sub(planePos).applyQuaternion(planeQuat.clone().invert());
  const normX0 = localCenter.x / director.fuselageRadiusX;
  const normY0 = (localCenter.y - director.fuselageCenterY) / director.fuselageRadiusY;
  assert.ok(
    normX0 * normX0 + normY0 * normY0 >= 1.0,
    'Center point must be pushed outside fuselage boundary'
  );

  // Point in cabin at z = -10, y = 0.5 (where old cockpit_hero clipped)
  const cabinPoint = planePos.clone().add(
    new THREE.Vector3(0, 0.5, -10).applyQuaternion(planeQuat)
  );
  director.enforceFuselageClearance(cabinPoint, planePos, planeQuat);

  const localCabin = cabinPoint.clone().sub(planePos).applyQuaternion(planeQuat.clone().invert());
  const normXC = localCabin.x / director.fuselageRadiusX;
  const normYC = (localCabin.y - director.fuselageCenterY) / director.fuselageRadiusY;
  assert.ok(
    normXC * normXC + normYC * normYC >= 1.0,
    'Cabin interior point must be pushed outside fuselage boundary'
  );
});

test('Director adapts to different aircraft configurations (B738, F16, C172)', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });

  const planePos = new THREE.Vector3(0, 300, 0);
  const planeQuat = new THREE.Quaternion();

  // Test F16
  director.loadAircraftConfig(F16_FALCON);
  assert.equal(director.wingspan, F16_FALCON.aerodynamics.wingspanM);
  assert.equal(director.fuselageLength, 15.0);

  director.switchShot(CINEMATIC_SHOTS.COCKPIT_HERO);
  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState: {} });

  const relF16 = camera.position.clone().sub(planePos);
  assert.ok(relF16.y > director.fuselageRadiusY, 'F16 canopy cam must be mounted above fuselage');
  assert.ok(camera.position.z < planePos.z, 'F16 canopy cam must be in cockpit region');

  // Test C172
  director.loadAircraftConfig(CESSNA_172);
  assert.equal(director.wingspan, CESSNA_172.aerodynamics.wingspanM);
  assert.equal(director.fuselageLength, 8.5);

  director.switchShot(CINEMATIC_SHOTS.COCKPIT_HERO);
  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState: {} });

  const relC172 = camera.position.clone().sub(planePos);
  assert.ok(relC172.y > director.fuselageRadiusY, 'C172 canopy cam must be mounted above fuselage');

  // Test B738
  director.loadAircraftConfig(BOEING_737_800);
  assert.equal(director.wingspan, BOEING_737_800.aerodynamics.wingspanM);
  assert.equal(director.fuselageLength, 39.0);

  director.switchShot(CINEMATIC_SHOTS.COCKPIT_HERO);
  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState: {} });

  const relB738 = camera.position.clone().sub(planePos);
  assert.ok(relB738.y > director.fuselageRadiusY, 'B738 canopy cam must be mounted above fuselage');
});

test('Camera on ground maintains ground clearance and fuselage clearance simultaneously', () => {
  const camera = new THREE.PerspectiveCamera();
  const groundElevation = () => 0;
  const director = new CinematicCameraDirector({ camera, queryGroundHeight: groundElevation });

  // Aircraft on runway with gear touching ground (fuselage center ~2.8m above ground)
  const planePos = new THREE.Vector3(0, 2.8, 0);
  const planeQuat = new THREE.Quaternion();

  for (const shot of [CINEMATIC_SHOTS.WINGTIP_ACTION, CINEMATIC_SHOTS.COCKPIT_HERO, CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY]) {
    director.switchShot(shot);
    director.update({
      dt: 0.016,
      camera,
      planePos,
      planeQuat,
      flightState: { onGround: true, iasKnots: 0 },
      queryGroundHeight: groundElevation,
    });

    assert.ok(camera.position.y >= 1.5, `Camera y (${camera.position.y}) must stay >= ground + 1.5m`);

    const rel = camera.position.clone().sub(planePos);
    const radX = director.fuselageRadiusX;
    const radY = director.fuselageRadiusY;
    const normX = rel.x / radX;
    const normY = rel.y / radY;
    assert.ok(
      normX * normX + normY * normY >= 0.98,
      `Camera must be clear of fuselage on ground (distSq was ${(normX * normX + normY * normY).toFixed(3)})`
    );
  }
});

function fakeMissile({ id = 1, position, velocity, target = null, alive = true } = {}) {
  return {
    id,
    alive,
    position: position.clone(),
    prevPosition: position.clone(),
    velocity: velocity.clone(),
    target,
  };
}

test('Director cuts to missile launch, follows the missile, then shows the bandit POV', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();
  const flightState = { iasKnots: 260, gForce: 1.0, rollDeg: 0, onGround: false };
  const target = {
    id: 7,
    alive: true,
    position: new THREE.Vector3(0, 1000, -3000),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 41,
    position: new THREE.Vector3(5, 1000, 2),
    velocity: new THREE.Vector3(0, 0, -400),
    target,
  });

  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState, missiles: [], targets: [target] });
  assert.notEqual(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH, 'No launch before a missile exists');

  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [target] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH, 'Fresh rail release cuts immediately');
  assert.ok(camera.position.distanceTo(planePos) < 20, 'Launch camera rides beside the launcher');

  for (let frame = 0; frame < 12; frame++) {
    missile.position.z -= 40;
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK, 'Launch beat hands off to the missile follow');
  assert.ok(
    camera.position.distanceTo(missile.position) < 25,
    `Follow camera must ride the missile, was ${camera.position.distanceTo(missile.position).toFixed(1)}m away`,
  );

  for (let frame = 0; frame < 30 && director.currentShotType !== CINEMATIC_SHOTS.BANDIT_POV; frame++) {
    missile.position.z -= 120;
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Close missile hands off to the bandit POV');
  const banditRange = camera.position.distanceTo(target.position);
  assert.ok(
    banditRange > 12 && banditRange < 50,
    `Bandit shot frames the airframe instead of sitting inside it, was ${banditRange.toFixed(1)}m away`,
  );

  const toMissile = missile.position.clone().sub(camera.position).normalize();
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  assert.ok(viewDir.dot(toMissile) > 0.9, 'Bandit shot looks down the incoming missile bearing');
});

test('Approach keeps routine shots until the missile is close, then holds the bandit POV through detonation', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();
  const mission = {
    id: 9,
    alive: true,
    position: new THREE.Vector3(0, 1000, -5200),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 52,
    position: new THREE.Vector3(4, 1000, 2),
    velocity: new THREE.Vector3(0, 0, -450),
    target: mission,
  });

  director.update({ dt: 0.05, camera, planePos, planeQuat, missiles: [missile], targets: [mission] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH);

  while (director.currentShotType !== CINEMATIC_SHOTS.MISSILE_TRACK) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, missiles: [missile], targets: [mission] });
  }
  // Hold the round far from the bandit so the follow cam times out first.
  for (let frame = 0; frame < 92; frame++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, missiles: [missile], targets: [mission] });
  }
  assert.notEqual(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Far missile leaves the routine shots alone');
  assert.equal(director.missileSequence.phase, 'approach');

  // Close to the bandit: the final POV cuts in, then holds through the hit.
  missile.position.copy(mission.position).add(new THREE.Vector3(0, 0, 1200));
  director.update({ dt: 0.05, camera, planePos, planeQuat, missiles: [missile], targets: [mission] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Close missile cuts to the bandit seat');

  missile.alive = false;
  director.update({ dt: 0.05, camera, planePos, planeQuat, missiles: [], targets: [mission] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Detonation lingers in the bandit POV');

  for (let frame = 0; frame < 16; frame++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, missiles: [], targets: [mission] });
  }
  assert.equal(director.missileSequence, null, 'Sequence ends after the detonation lingers');
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.DOGFIGHT_PLAYER_TO_BANDIT, 'Director returns to player-to-bandit dogfight framing');
});

test('CameraSystem DIRECTOR mode forwards live combat state to the director', () => {
  const camera = new THREE.PerspectiveCamera();
  const cameraSystem = new CameraSystem(camera);
  const missiles = [];
  cameraSystem.setCombatStateProvider(() => ({ missiles, targets: [] }));
  cameraSystem.setMode(CameraSystem.MODES.DIRECTOR, true);

  const mesh = {
    position: new THREE.Vector3(0, 1200, 0),
    quaternion: new THREE.Quaternion(),
    matrixWorld: new THREE.Matrix4(),
  };
  cameraSystem.update(0.016, mesh, {});

  missiles.push(fakeMissile({
    id: 77,
    position: new THREE.Vector3(5, 1200, 2),
    velocity: new THREE.Vector3(0, 0, -400),
  }));
  cameraSystem.update(0.016, mesh, {});

  assert.equal(
    cameraSystem.cinematicDirector.currentShotType,
    CINEMATIC_SHOTS.MISSILE_LAUNCH,
    'Combat feed reaches the director through CameraSystem',
  );
});

test('launch camera latches the rail side instead of flipping across the centreline', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 3,
    alive: true,
    position: new THREE.Vector3(0, 1000, -3000),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 61,
    position: new THREE.Vector3(5, 1000, 2),
    velocity: new THREE.Vector3(0, 0, -400),
    target,
  });

  director.update({ dt: 0.016, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH);
  assert.ok(camera.position.x > 0, 'launch camera starts on the occupied rail side');
  assert.equal(director.missileSequence.stationSide, 1);

  // The round crosses the fuselage immediately after release. The latched side
  // must keep the camera on the same wing instead of jumping 22 m.
  missile.position.x = -5;
  director.update({ dt: 0.016, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH);
  assert.ok(camera.position.x > 0, 'launch camera does not cross the centreline');
});

test('bandit POV keeps a unit lateral offset when the missile is directly overhead', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 4,
    alive: true,
    position: new THREE.Vector3(0, 1000, -3000),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 62,
    position: new THREE.Vector3(4, 1000, 2),
    velocity: new THREE.Vector3(0, 0, -450),
    target,
  });
  const state = { missile, target, camera, planePos, planeQuat, missiles: [missile], targets: [target] };

  director.update({ dt: 0.05, ...state });
  for (let frame = 0; frame < 20 && director.currentShotType !== CINEMATIC_SHOTS.MISSILE_TRACK; frame++) {
    director.update({ dt: 0.1, ...state });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK);

  // Zero horizontal bearing: the missile is directly above the bandit.
  missile.position.copy(target.position).add(new THREE.Vector3(0, 800, 0));
  director.update({ dt: 0.05, ...state });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV);

  const horizontal = Math.hypot(
    camera.position.x - target.position.x,
    camera.position.z - target.position.z,
  );
  assert.ok(horizontal > 2.0, `bandit eye keeps the 2.4 m lateral offset, was ${horizontal.toFixed(2)}`);
});

test('Director shot pacing follows the supplied replay clock', () => {
  const camera = new THREE.PerspectiveCamera();
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1000, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 21,
    alive: true,
    position: new THREE.Vector3(0, 1000, -4000),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 91,
    position: new THREE.Vector3(4, 1000, 2),
    velocity: new THREE.Vector3(0, 0, -450),
    target,
  });

  director.update({ dt: 0.016, clockDt: 0.016, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH);

  // A paused replay freezes the launch beat instead of letting wall-clock time finish it.
  for (let frame = 0; frame < 100; frame++) {
    director.update({ dt: 0.016, clockDt: 0, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH, 'Paused clock holds the launch shot');

  // A 2x replay advances two seconds of shot time per second of frame time.
  for (let frame = 0; frame < 6; frame++) {
    director.update({ dt: 0.016, clockDt: 0.2, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK, 'Scaled clock advances the sequence');
});

test('bandit shot keeps the target airframe and the inbound round in frame', () => {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const targetPos = new THREE.Vector3(0, 1000, -3000);
  const target = {
    id: 5,
    alive: true,
    position: targetPos.clone(),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = {
    id: 66,
    alive: true,
    age: 4.0,
    position: targetPos.clone().add(new THREE.Vector3(0, 0, -900)),
    velocity: new THREE.Vector3(0, 0, 450),
    target,
  };
  director.missileSequence = {
    missile, target, phase: 'bandit', phaseTime: 0, missileDeathTime: null, stationSide: null,
    lastMissilePos: missile.position.clone(), lastTargetPos: targetPos.clone(),
  };
  director.switchShot(CINEMATIC_SHOTS.BANDIT_POV);
  director.update({
    dt: 1 / 60, camera, planePos: new THREE.Vector3(0, 500, 0), planeQuat: new THREE.Quaternion(),
    missiles: [missile], targets: [target], flightState: {},
  });
  camera.updateMatrixWorld(true);

  const distance = camera.position.distanceTo(targetPos);
  assert.ok(distance > 12 && distance < 50, `bandit airframe fills a readable close-up (${distance.toFixed(1)} m)`);
  const projectedTarget = targetPos.clone().project(camera);
  assert.ok(Math.abs(projectedTarget.x) < 0.85 && Math.abs(projectedTarget.y) < 0.85,
    'the target airframe is inside the frame');
  const projectedMissile = missile.position.clone().project(camera);
  assert.ok(Math.abs(projectedMissile.x) < 1 && Math.abs(projectedMissile.y) < 1,
    'the inbound missile is inside the frame');
});

test('follow-up salvo missile takes over BANDIT_POV when decoyed lead missile times out (#782)', () => {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 2,
    alive: true,
    position: new THREE.Vector3(0, 2000, -1400),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const lead = {
    id: 5,
    alive: true,
    age: 0.05,
    position: new THREE.Vector3(0, 1500, -50),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  };
  const followup = {
    id: 6,
    alive: true,
    age: 0.05,
    position: new THREE.Vector3(0, 1500, -50),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  };

  // Lead missile launches and enters BANDIT_POV at t=1.2s.
  director.update({ dt: 0.1, clockDt: 0.1, camera, planePos, planeQuat, missiles: [lead], targets: [target] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH);
  for (let i = 0; i < 12; i++) {
    lead.age += 0.1;
    director.update({ dt: 0.1, clockDt: 0.1, camera, planePos, planeQuat, missiles: [lead], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV);

  // Follow-up missile launches while lead is still in BANDIT_POV.
  for (let i = 0; i < 32; i++) {
    lead.age += 0.1;
    director.update({ dt: 0.1, clockDt: 0.1, camera, planePos, planeQuat, missiles: [lead], targets: [target] });
  }
  director.update({ dt: 0.1, clockDt: 0.1, camera, planePos, planeQuat, missiles: [lead, followup], targets: [target] });

  // Advance until lead's 6.0s BANDIT_POV expires; even if followup's seeker transfers
  // to a flare while queued, BANDIT_POV still frames the original bandit target.
  followup.target = { id: 99, type: 'flare', alive: true, position: new THREE.Vector3(500, 1800, -500) };
  followup.position.set(0, 2000, -600);
  for (let i = 0; i < 28; i++) {
    lead.age += 0.1;
    followup.age += 0.1;
    director.update({ dt: 0.1, clockDt: 0.1, camera, planePos, planeQuat, missiles: [lead, followup], targets: [target] });
  }
  assert.equal(director.missileSequence?.missile?.id, 6, 'Follow-up missile takes over the sequence');
  assert.equal(director.missileSequence?.target?.id, 2, 'Queued handoff preserves the bandit target over decoys');
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Camera stays in BANDIT_POV for follow-up kill');
});

test('Dogfight mode alternates between player-to-bandit and bandit-to-player shots', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const bandit = {
    id: 11,
    alive: true,
    position: new THREE.Vector3(200, 1600, -1800),
    velocity: new THREE.Vector3(0, 0, 180),
  };
  const flightState = { onGround: false, iasKnots: 380, gForce: 4.0, rollDeg: 65, altitudeFt: 5000 };

  // Advance past initial 0.25s entry window: dogfight mode cuts to player->bandit.
  for (let i = 0; i < 6; i++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, targets: [bandit] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.DOGFIGHT_PLAYER_TO_BANDIT);
  camera.updateMatrixWorld(true);
  const viewDir1 = new THREE.Vector3();
  camera.getWorldDirection(viewDir1);
  const playerToBandit = bandit.position.clone().sub(planePos).normalize();
  assert.ok(viewDir1.dot(playerToBandit) > 0.9, 'Player-to-bandit shot looks toward the bandit');

  // Advance past maxShotDuration (6.5s): alternates to bandit->player.
  for (let i = 0; i < 70; i++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, targets: [bandit] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.DOGFIGHT_BANDIT_TO_PLAYER);
  camera.updateMatrixWorld(true);
  const viewDir2 = new THREE.Vector3();
  camera.getWorldDirection(viewDir2);
  const banditToPlayer = planePos.clone().sub(bandit.position).normalize();
  assert.ok(viewDir2.dot(banditToPlayer) > 0.9, 'Bandit-to-player shot looks toward the player');
});

test('MISSILE_TRACK rides right behind missile tail fins looking down its flight path', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 12,
    alive: true,
    position: new THREE.Vector3(0, 1500, -4000),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 101,
    position: new THREE.Vector3(5, 1500, -10),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });

  director.update({ dt: 0.05, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_LAUNCH);

  for (let i = 0; i < 12; i++) {
    missile.position.z -= 60;
    director.update({ dt: 0.1, camera, planePos, planeQuat, missiles: [missile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK);
  const distToMissile = camera.position.distanceTo(missile.position);
  assert.ok(distToMissile < 5.0, `Tail-fin POV sits close behind missile (${distToMissile.toFixed(2)}m)`);
  camera.updateMatrixWorld(true);
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  assert.ok(viewDir.dot(new THREE.Vector3(0, 0, -1)) > 0.95, 'Tail-fin POV looks straight down missile flight path');
});

test('BANDIT_POV zooms out when bandit dispenses chaff and flares to keep trajectories in frame', () => {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const targetPos = new THREE.Vector3(0, 1500, -3000);
  const target = {
    id: 13,
    alive: true,
    position: targetPos.clone(),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 102,
    position: targetPos.clone().add(new THREE.Vector3(0, 0, 900)),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });
  director.missileSequence = {
    missile, target, phase: 'bandit', phaseTime: 0, missileDeathTime: null, stationSide: null,
    lastMissilePos: missile.position.clone(), lastTargetPos: targetPos.clone(),
    lastTargetDamage: 0, lastTargetAlive: true, hitDetected: false, hitTime: 0, hitPos: null,
  };
  director.switchShot(CINEMATIC_SHOTS.BANDIT_POV);

  director.update({
    dt: 0.016, camera, planePos: new THREE.Vector3(0, 1500, 0), planeQuat: new THREE.Quaternion(),
    missiles: [missile], targets: [target], flares: [], chaffClouds: [],
  });
  const baseDist = camera.position.distanceTo(targetPos);
  const baseFov = camera.fov;

  const flares = [
    { id: 1, sourceId: 13, alive: true, position: targetPos.clone().add(new THREE.Vector3(-40, -30, 120)) },
  ];
  const chaffClouds = [
    { id: 2, sourceId: 13, alive: true, position: targetPos.clone().add(new THREE.Vector3(50, -20, 140)) },
  ];
  for (let i = 0; i < 10; i++) {
    director.update({
      dt: 0.1, camera, planePos: new THREE.Vector3(0, 1500, 0), planeQuat: new THREE.Quaternion(),
      missiles: [missile], targets: [target], flares, chaffClouds,
    });
  }
  const decoyDist = camera.position.distanceTo(targetPos);
  assert.ok(decoyDist > baseDist + 15, `Camera zooms out for decoys (${baseDist.toFixed(1)}m -> ${decoyDist.toFixed(1)}m)`);
  assert.ok(camera.fov > baseFov + 3, `FOV widens for decoys (${baseFov.toFixed(1)} -> ${camera.fov.toFixed(1)})`);
});

test('BANDIT_POV follows burning wreck on hit, frames trailing fire, and returns to player-to-bandit', () => {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 14,
    alive: true,
    damage: 0,
    position: new THREE.Vector3(0, 1500, -2500),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const spareBandit = {
    id: 15,
    alive: true,
    position: new THREE.Vector3(800, 1500, -3500),
    velocity: new THREE.Vector3(0, 0, -180),
  };
  const missile = fakeMissile({
    id: 103,
    position: new THREE.Vector3(0, 1500, -1700),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });
  director.missileSequence = {
    missile, target, phase: 'bandit', phaseTime: 0, missileDeathTime: null, stationSide: null,
    lastMissilePos: missile.position.clone(), lastTargetPos: target.position.clone(),
    lastTargetDamage: 0, lastTargetAlive: true, hitDetected: false, hitTime: 0, hitPos: null,
  };
  director.switchShot(CINEMATIC_SHOTS.BANDIT_POV);

  // Impact: target killed, wreck mesh tumbles forward & downward in targetViews.
  target.alive = false;
  missile.alive = false;
  missile.position.copy(target.position);
  const wreckPos = target.position.clone().add(new THREE.Vector3(0, -30, -220));
  const targetViews = new Map([
    [14, { wreck: { age: 1.0 }, mesh: { position: wreckPos } }],
  ]);

  director.update({
    dt: 0.1, camera, planePos, planeQuat,
    missiles: [], targets: [target, spareBandit], targetViews,
  });
  assert.equal(director.missileSequence.hitDetected, true, 'Hit is detected on kill');
  assert.ok(
    camera.position.distanceTo(wreckPos) < 60,
    `Camera follows moving wreck position (${camera.position.distanceTo(wreckPos).toFixed(1)}m away)`,
  );

  // At 2.0s after impact (> 1.4s normal linger), hit linger keeps BANDIT_POV active.
  for (let i = 0; i < 19; i++) {
    wreckPos.z -= 15;
    director.update({
      dt: 0.1, camera, planePos, planeQuat,
      missiles: [], targets: [target, spareBandit], targetViews,
    });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Extended hit linger holds BANDIT_POV past 1.4s');

  // After 3.2s hit linger finishes, returns to player-to-bandit framing.
  for (let i = 0; i < 15; i++) {
    director.update({
      dt: 0.1, camera, planePos, planeQuat,
      missiles: [], targets: [target, spareBandit], targetViews,
    });
  }
  assert.equal(director.missileSequence, null);
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.DOGFIGHT_PLAYER_TO_BANDIT);
});

test('After killing the only bandit, user POV observes the crashing wreck before exiting dogfight', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 16,
    alive: true,
    damage: 0,
    position: new THREE.Vector3(0, 1500, -2500),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const missile = fakeMissile({
    id: 104,
    position: new THREE.Vector3(0, 1500, -1700),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });
  director.missileSequence = {
    missile, target, phase: 'bandit', phaseTime: 0, missileDeathTime: null, stationSide: null,
    lastMissilePos: missile.position.clone(), lastTargetPos: target.position.clone(),
    lastTargetDamage: 0, lastTargetAlive: true, hitDetected: false, hitTime: 0, hitPos: null,
  };
  director.switchShot(CINEMATIC_SHOTS.BANDIT_POV);

  target.alive = false;
  missile.alive = false;
  missile.position.copy(target.position);
  const wreckPos = target.position.clone().add(new THREE.Vector3(300, -250, -300));
  const targetViews = new Map([
    [16, { wreck: { age: 1.0 }, mesh: { position: wreckPos } }],
  ]);

  // Finish the 3.2s hit linger with no other alive bandits.
  for (let i = 0; i < 34; i++) {
    wreckPos.y -= 10;
    director.update({
      dt: 0.1, camera, planePos, planeQuat,
      missiles: [], targets: [target], targetViews,
    });
  }
  assert.equal(director.missileSequence, null);
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.DOGFIGHT_PLAYER_TO_BANDIT, 'Switches to user POV to watch crash');

  // Verify user POV is looking at the crashing wreck.
  camera.updateMatrixWorld(true);
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  const toWreck = wreckPos.clone().sub(planePos).normalize();
  assert.ok(viewDir.dot(toWreck) > 0.9, 'User POV looks directly at the crashing wreck');
});

test('Review fixes: stale far chaff is ignored, wreck ground position is preserved, and undamaged expiry is not a hit', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const targetPos = new THREE.Vector3(0, 1500, -3000);
  const target = {
    id: 25,
    alive: true,
    damage: 0,
    position: targetPos.clone(),
    velocity: new THREE.Vector3(0, 0, -200),
  };

  // 1. Far same-source chaff (> 450m) is ignored in collectBanditDecoys.
  director.lastCombatChaff = [
    { id: 1, sourceId: 25, alive: true, position: targetPos.clone().add(new THREE.Vector3(0, 0, 2000)) },
  ];
  const farDecoys = director.collectBanditDecoys(target, targetPos);
  assert.equal(farDecoys.count, 0, 'Far chaff beyond match radius is ignored');

  // 2. Wreck ground position is preserved after view.wreck is cleared on impact.
  target.alive = false;
  const groundWreckPos = new THREE.Vector3(100, 12, -3200);
  const view = { wreck: { age: 2.0 }, mesh: { position: groundWreckPos.clone() } };
  director.lastTargetViews = new Map([[25, view]]);
  assert.ok(director.resolveTargetPosition(target).equals(groundWreckPos));
  view.wreck = null; // Ground impact clears wreck
  assert.ok(director.resolveTargetPosition(target).equals(groundWreckPos), 'Preserves last wreck position after ground impact');

  // 3. Undamaged missile expiry within 120m does not trigger hitDetected.
  const undamagedTarget = {
    id: 26,
    alive: true,
    damage: 0,
    position: targetPos.clone(),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const missMissile = fakeMissile({
    id: 205,
    position: targetPos.clone().add(new THREE.Vector3(0, 0, 50)),
    velocity: new THREE.Vector3(0, 0, -600),
    target: undamagedTarget,
  });
  director.missileSequence = {
    missile: missMissile, target: undamagedTarget, phase: 'bandit', phaseTime: 0, missileDeathTime: null,
    stationSide: null, lastMissilePos: missMissile.position.clone(), lastTargetPos: targetPos.clone(),
    lastTargetDamage: 0, lastTargetAlive: true, hitDetected: false, hitTime: 0, hitPos: null,
  };
  missMissile.alive = false;
  director.advanceMissileSequence(0.1);
  assert.equal(director.missileSequence.hitDetected, false, 'Undamaged miss within 120m is not marked as hit');

  // 4. Replay plan retains shot ownership even when alive targets are present.
  director.loadReplayPlan({
    durationSec: 6.0,
    shots: [
      { type: CINEMATIC_SHOTS.TELEPHOTO_FLYBY, startTime: 0, endTime: 3.0 },
      { type: CINEMATIC_SHOTS.WINGTIP_ACTION, startTime: 3.0, endTime: 6.0 },
    ],
  });
  for (let i = 0; i < 10; i++) {
    director.update({
      dt: 0.1, camera, planePos: new THREE.Vector3(0, 1500, 0), planeQuat: new THREE.Quaternion(),
      targets: [undamagedTarget], flightState: { onGround: false },
    });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.TELEPHOTO_FLYBY, 'Replay plan shot is not overwritten by dogfight framing');
});

test('Director prioritizes lethal missile over dud missile when multiple missiles are launched', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const flightState = { onGround: false };
  const target = {
    id: 5,
    alive: true,
    damage: 0,
    position: new THREE.Vector3(0, 1500, -2000),
    velocity: new THREE.Vector3(0, 0, -200),
  };

  const dudMissile = fakeMissile({
    id: 101,
    position: new THREE.Vector3(-5, 1498, -10),
    velocity: new THREE.Vector3(0, 0, -500),
    target,
  });
  dudMissile.lethal = false;

  const lethalMissile = fakeMissile({
    id: 102,
    position: new THREE.Vector3(5, 1498, -10),
    velocity: new THREE.Vector3(0, 0, -500),
    target,
  });
  lethalMissile.lethal = true;

  // When both missiles are presented simultaneously, director selects the lethal one
  director.update({
    dt: 0.016, camera, planePos, planeQuat, flightState,
    missiles: [dudMissile, lethalMissile], targets: [target],
  });

  assert.equal(director.missileSequence?.missile?.id, 102, 'Director selects lethal missile over dud');

  // If dud missile was launched first, follow-up lethal missile release promotes to active sequence
  const director2 = new CinematicCameraDirector({ camera });
  director2.update({
    dt: 0.016, camera, planePos, planeQuat, flightState,
    missiles: [dudMissile], targets: [target],
  });
  assert.equal(director2.missileSequence?.missile?.id, 101);

  director2.update({
    dt: 0.016, camera, planePos, planeQuat, flightState,
    missiles: [dudMissile, lethalMissile], targets: [target],
  });
  assert.equal(director2.missileSequence?.missile?.id, 102, 'Lethal round promotes over active non-lethal sequence');
});

test('Target hit during missile track immediately cuts camera to bandit explosion', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const flightState = { onGround: false };
  const target = {
    id: 6,
    alive: true,
    damage: 0,
    position: new THREE.Vector3(0, 1500, -3000),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const missile = fakeMissile({
    id: 201,
    position: new THREE.Vector3(0, 1500, -500),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });

  // Launch and advance to track phase
  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [target] });
  for (let i = 0; i < 10; i++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK);

  // Target takes lethal damage while missile is still 2000m away
  target.alive = false;
  target.damage = 1.0;
  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [target] });

  assert.equal(director.missileSequence?.hitDetected, true, 'Hit is detected when target dies');
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.BANDIT_POV, 'Camera immediately cuts to bandit explosion, not waiting in track');
});

test('Respawned bandit does not cancel ongoing crash observation of the destroyed wreck', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const target = {
    id: 7,
    alive: false,
    damage: 1.0,
    position: new THREE.Vector3(0, 1500, -2500),
  };
  const wreckPos = target.position.clone().add(new THREE.Vector3(0, -50, 100));
  const targetViews = new Map([
    [7, { wreck: { age: 1.0 }, mesh: { position: wreckPos } }],
  ]);

  director.crashObserveTarget = target;
  director.crashObserveTimer = 4.0;
  director.switchShot(CINEMATIC_SHOTS.DOGFIGHT_PLAYER_TO_BANDIT);

  // Bandit respawns in the slot with alive = true and jumps to a new spawn position 5000m away
  target.alive = true;
  target.position.set(2000, 3000, 5000);

  director.update({
    dt: 0.1, camera, planePos, planeQuat,
    targets: [target], targetViews, flightState: { onGround: false },
  });

  assert.ok(director.crashObserveTimer > 3.8, 'Crash observe timer does not cancel upon target respawn');
  assert.equal(director.crashObserveTarget, target);

  // Camera should look toward the wreck position, not the newly spawned bandit position
  camera.updateMatrixWorld(true);
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  const toWreck = wreckPos.clone().sub(planePos).normalize();
  const toNewSpawn = target.position.clone().sub(planePos).normalize();
  assert.ok(viewDir.dot(toWreck) > 0.85, 'Camera looks at the crashing wreck');
  assert.ok(viewDir.dot(toNewSpawn) < 0.5, 'Camera does NOT snap to the newly spawned bandit');
});

test('Pre-existing bandit damage does not trigger premature hit detection on fresh launch', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const flightState = { onGround: false };
  const damagedTarget = {
    id: 8,
    alive: true,
    damage: 0.6,
    position: new THREE.Vector3(0, 1500, -2000),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const missile = fakeMissile({
    id: 301,
    position: new THREE.Vector3(0, 1500, -10),
    velocity: new THREE.Vector3(0, 0, -600),
    target: damagedTarget,
  });

  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [damagedTarget] });
  assert.equal(director.missileSequence?.hitDetected, false, 'Pre-existing damage does not trigger hit on release');

  for (let i = 0; i < 10; i++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, missiles: [missile], targets: [damagedTarget] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK);
  assert.equal(director.missileSequence?.hitDetected, false, 'Pre-existing damage does not trigger hit during track');
});

test('Unpromoted queued missile does not block track timeout to approach phase', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 200000);
  const director = new CinematicCameraDirector({ camera });
  const planePos = new THREE.Vector3(0, 1500, 0);
  const planeQuat = new THREE.Quaternion();
  const flightState = { onGround: false };
  const target = {
    id: 9,
    alive: true,
    damage: 0,
    position: new THREE.Vector3(0, 1500, -10000),
    velocity: new THREE.Vector3(0, 0, -200),
  };
  const leadMissile = fakeMissile({
    id: 401,
    position: new THREE.Vector3(0, 1500, -1000),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });
  const deadQueuedMissile = fakeMissile({
    id: 402,
    position: new THREE.Vector3(0, 1500, -500),
    velocity: new THREE.Vector3(0, 0, -600),
    target,
  });
  deadQueuedMissile.alive = false;

  director.update({ dt: 0.016, camera, planePos, planeQuat, flightState, missiles: [leadMissile], targets: [target] });
  director.queuedMissiles.push({ missile: deadQueuedMissile, target });

  // Advance 1s past launch beat into track
  for (let i = 0; i < 10; i++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, missiles: [leadMissile], targets: [target] });
  }
  assert.equal(director.currentShotType, CINEMATIC_SHOTS.MISSILE_TRACK);

  // Advance 9.2s in track; with dead queued missile, timeout still fires and switches to approach
  for (let i = 0; i < 92; i++) {
    director.update({ dt: 0.1, camera, planePos, planeQuat, flightState, missiles: [leadMissile], targets: [target] });
  }
  assert.equal(director.missileSequence?.phase, 'approach', 'Track timeout switches to approach even with queued missile');
});
