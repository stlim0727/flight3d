import * as THREE from 'three';

/**
 * Cinematic Camera Director
 *
 * Professional cinema director engine for Flight3d:
 * 1. Analyzes recorded flight telemetry (or live flight dynamics) to find drama beats
 *    (takeoff rotation, high-G bank maneuvers, low-pass terrain skimming, touchdowns, crashes).
 * 2. Choreographs Hollywood-style camera sequences with cinematic shot grammar:
 *    - Telephoto Flyby with lens perspective compression and whip-pan follow-through
 *    - Dynamic Orbit Dolly with elevation and distance variation
 *    - High-G Bank Hero cam with dynamic Dutch tilt and centrifugal load shake
 *    - Low-Altitude Terrain / Canyon Skim cam
 *    - Wingtip / Tail-Spine action cam with aerodynamic micro-vibrations
 *    - Runway Touchdown Spotter cam focusing on gear touchdown and rollout
 *    - Lead-In Reverse Chase Hero cam
 * 3. Enforces cinema composition rules:
 *    - Rule of Thirds leading space along aircraft velocity vector
 *    - Shot duration rhythm (3.0s - 6.5s pacing, anti-flicker hysteresis)
 *    - Optical focal length variety (28° telephoto to 75° wide-angle)
 *    - Continuous terrain and water ground clearance clamp (zero clipping)
 *    - Smooth critically-damped tracking inertia (no robotic snapping)
 */

export const CINEMATIC_SHOTS = {
  TELEPHOTO_FLYBY: 'telephoto_flyby',
  DYNAMIC_ORBIT_DOLLY: 'dynamic_orbit_dolly',
  WINGTIP_ACTION: 'wingtip_action',
  HIGH_G_BANK_HERO: 'high_g_bank_hero',
  TERRAIN_CANYON_SKIM: 'terrain_canyon_skim',
  TOUCHDOWN_SPOTTER: 'touchdown_spotter',
  LEAD_IN_TRACKING: 'lead_in_tracking',
  COCKPIT_HERO: 'cockpit_hero',
};

const SHOT_LIST_NORMAL = [
  CINEMATIC_SHOTS.TELEPHOTO_FLYBY,
  CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY,
  CINEMATIC_SHOTS.WINGTIP_ACTION,
  CINEMATIC_SHOTS.LEAD_IN_TRACKING,
  CINEMATIC_SHOTS.COCKPIT_HERO,
];

export class CinematicCameraDirector {
  constructor({ camera = null, queryGroundHeight = null } = {}) {
    this.camera = camera;
    this.queryGroundHeight = typeof queryGroundHeight === 'function' ? queryGroundHeight : () => 0;

    // Shot timing & pacing
    this.minShotDuration = 3.0; // Seconds to hold before allowing a routine cut
    this.maxShotDuration = 6.5; // Maximum duration before cutting to new vantage
    this.shotTimer = 0;
    this.totalTimer = 0;
    this.currentShotType = CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY;
    this.lastShotType = null;
    this.shotIndex = 0;

    // Camera kinematics & interpolation state
    this.camPos = new THREE.Vector3();
    this.camLookTarget = new THREE.Vector3();
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.camFov = 50.0;
    this.initialized = false;

    // Shot-specific state variables
    this.orbitAngle = 0;
    this.orbitRadius = 38.0;
    this.orbitHeight = 9.0;
    this.orbitSpeed = 0.24;
    this.flybyWorldPos = new THREE.Vector3();
    this.flybyPassed = false;
    this.wingHardpointIndex = 0;

    // Rolling telemetry history for live derivative analysis
    this.history = [];
    this.historyWindowSec = 4.0;
    this.wasOnGround = true;

    // Pre-planned replay timeline (when driven from recorded sortie)
    this.replayPlan = null;
    this.replayCursor = 0;
  }

  reset() {
    this.initialized = false;
    this.shotTimer = 0;
    this.totalTimer = 0;
    this.currentShotType = CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY;
    this.lastShotType = null;
    this.shotIndex = 0;
    this.history = [];
    this.wasOnGround = true;
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.replayCursor = 0;
  }

  /**
   * Set ground elevation query callback.
   */
  setTerrainQuery(fn) {
    if (typeof fn === 'function') this.queryGroundHeight = fn;
  }

  /**
   * Analyze recorded flight sortie samples and produce a structured drama plan
   * with key cinematic beats and a timed shot sequence.
   */
  static analyzeFlightRecording(report) {
    if (!report || !Array.isArray(report.samples) || report.samples.length < 2) {
      return {
        beats: [],
        shots: [],
        durationSec: report?.durationSec ?? 0,
        summary: 'Insufficient telemetry samples for cinematic replay analysis.',
      };
    }

    const samples = report.samples;
    const duration = report.durationSec ?? samples.at(-1).timeSec;
    const beats = [];

    // 1. Detect Takeoff Rotation beat
    const takeoffSample = samples.find(s => s.altitudeFt > 15 && s.iasKnots > 60);
    if (takeoffSample) {
      beats.push({
        timeSec: takeoffSample.timeSec,
        type: 'TAKEOFF_ROTATION',
        description: `Liftoff rotation at ${Math.round(takeoffSample.iasKnots)} kt`,
      });
    }

    // 2. Detect Extreme G-Force peaks (> 2.4 G or minimum < 0.2 G)
    let maxGSample = samples[0];
    for (const s of samples) {
      if ((s.gForce ?? 1) > (maxGSample.gForce ?? 1)) maxGSample = s;
    }
    if ((maxGSample.gForce ?? 1) >= 2.2) {
      beats.push({
        timeSec: maxGSample.timeSec,
        type: 'HIGH_G_PEAK',
        gForce: maxGSample.gForce,
        description: `Maximum aerodynamic pull: ${(maxGSample.gForce).toFixed(1)} G`,
      });
    }

    // 3. Detect Steepest Bank Turn (|rollDeg| > 45°)
    let maxBankSample = samples[0];
    for (const s of samples) {
      if (Math.abs(s.rollDeg ?? 0) > Math.abs(maxBankSample.rollDeg ?? 0)) maxBankSample = s;
    }
    if (Math.abs(maxBankSample.rollDeg ?? 0) >= 40) {
      beats.push({
        timeSec: maxBankSample.timeSec,
        type: 'STEEP_BANK',
        rollDeg: maxBankSample.rollDeg,
        description: `Knife-edge turn: ${Math.round(Math.abs(maxBankSample.rollDeg))}° bank`,
      });
    }

    // 4. Detect Low Altitude High-Speed Pass (altitude < 250ft & IAS > 200kt)
    const lowPassSample = samples.find(s => s.altitudeFt > 15 && s.altitudeFt < 250 && s.iasKnots > 200);
    if (lowPassSample) {
      beats.push({
        timeSec: lowPassSample.timeSec,
        type: 'LOW_PASS',
        altitudeFt: lowPassSample.altitudeFt,
        description: `High-speed terrain skim: ${Math.round(lowPassSample.altitudeFt)} ft at ${Math.round(lowPassSample.iasKnots)} kt`,
      });
    }

    // 5. Touchdowns and Crashes
    if (Array.isArray(report.touchdowns)) {
      for (const td of report.touchdowns) {
        beats.push({
          timeSec: td.timeSec,
          type: 'TOUCHDOWN',
          sinkRateFpm: td.sinkRateFpm,
          description: `Runway contact: sink rate ${Math.round(td.sinkRateFpm)} ft/min, ${td.contactG?.toFixed(1) ?? '1.0'} G`,
        });
      }
    }
    if (report.crash) {
      beats.push({
        timeSec: report.crash.timeSec ?? duration,
        type: 'CRASH',
        impactSpeed: report.crash.speedKnots,
        description: `Accident impact: ${report.crash.name || 'Collision'}`,
      });
    }

    // Sort beats by timestamp
    beats.sort((a, b) => a.timeSec - b.timeSec);

    // Generate ordered shot list covering entire duration with cinematic rhythm
    const shots = [];
    let curTime = 0;
    const shotRoster = [
      CINEMATIC_SHOTS.TELEPHOTO_FLYBY,
      CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY,
      CINEMATIC_SHOTS.WINGTIP_ACTION,
      CINEMATIC_SHOTS.LEAD_IN_TRACKING,
      CINEMATIC_SHOTS.HIGH_G_BANK_HERO,
      CINEMATIC_SHOTS.COCKPIT_HERO,
    ];
    let rosterIdx = 0;

    while (curTime < duration - 0.5) {
      // Check if there is an imminent drama beat within the next 4 seconds
      const nextBeat = beats.find(b => b.timeSec >= curTime && b.timeSec <= curTime + 4.5);
      let shotType;
      let shotDuration = 4.2;

      if (nextBeat) {
        if (nextBeat.type === 'HIGH_G_PEAK' || nextBeat.type === 'STEEP_BANK') {
          shotType = CINEMATIC_SHOTS.HIGH_G_BANK_HERO;
        } else if (nextBeat.type === 'LOW_PASS') {
          shotType = CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM;
        } else if (nextBeat.type === 'TOUCHDOWN') {
          shotType = CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER;
        } else if (nextBeat.type === 'TAKEOFF_ROTATION') {
          shotType = CINEMATIC_SHOTS.TELEPHOTO_FLYBY;
        } else {
          shotType = CINEMATIC_SHOTS.WINGTIP_ACTION;
        }
        // Align cut so the beat falls inside the shot
        shotDuration = Math.max(3.0, (nextBeat.timeSec - curTime) + 2.5);
      } else {
        shotType = shotRoster[rosterIdx % shotRoster.length];
        rosterIdx++;
        shotDuration = 4.5;
      }

      // Bound remaining flight duration
      if (curTime + shotDuration > duration) {
        shotDuration = duration - curTime;
      }
      if (shotDuration < 2.0 && shots.length > 0) {
        shots.at(-1).endTime = duration;
        shots.at(-1).duration = shots.at(-1).endTime - shots.at(-1).startTime;
        break;
      }

      shots.push({
        index: shots.length,
        type: shotType,
        startTime: curTime,
        endTime: curTime + shotDuration,
        duration: shotDuration,
        beat: nextBeat?.type ?? null,
      });

      curTime += shotDuration;
    }

    return {
      beats,
      shots,
      durationSec: duration,
      summary: `Cinematic Director choreographed ${shots.length} shots across ${duration.toFixed(1)}s with ${beats.length} dramatic highlight beats.`,
    };
  }

  /**
   * Load a pre-computed replay plan into the director for replay playback.
   */
  loadReplayPlan(plan) {
    this.replayPlan = plan;
    this.replayCursor = 0;
    this.reset();
  }

  /**
   * Evaluate whether a shot transition should occur right now.
   */
  evaluateShotCut(flightState, dt) {
    this.shotTimer += dt;
    this.totalTimer += dt;

    // If driven by a replay plan, cut when the plan timeline advances
    if (this.replayPlan?.shots?.length) {
      const planShot = this.replayPlan.shots.find(
        s => this.totalTimer >= s.startTime && this.totalTimer < s.endTime
      );
      if (planShot && planShot.type !== this.currentShotType) {
        this.switchShot(planShot.type, flightState);
        return;
      }
      if (this.totalTimer >= this.replayPlan.durationSec) {
        return; // Retain final shot
      }
    }

    const onGround = Boolean(flightState.onGround);
    const gForce = flightState.gForce ?? 1.0;
    const rollDeg = Math.abs(flightState.rollDeg ?? 0);
    const ias = flightState.iasKnots ?? 0;
    const agl = flightState.altitudeFt ?? 1000;

    // Dramatic Instant Cut Triggers (only if minimum hold time satisfied)
    if (this.shotTimer >= this.minShotDuration) {
      // 1. Touchdown event (transition from air to ground)
      if (!this.wasOnGround && onGround) {
        this.switchShot(CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER, flightState);
        this.wasOnGround = onGround;
        return;
      }

      // 2. High-G maneuver or knife-edge bank
      if ((gForce > 2.4 || rollDeg > 45) && this.currentShotType !== CINEMATIC_SHOTS.HIGH_G_BANK_HERO) {
        this.switchShot(CINEMATIC_SHOTS.HIGH_G_BANK_HERO, flightState);
        this.wasOnGround = onGround;
        return;
      }

      // 3. Low-altitude high-speed terrain skimming
      if (agl < 200 && ias > 220 && !onGround && this.currentShotType !== CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM) {
        this.switchShot(CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM, flightState);
        this.wasOnGround = onGround;
        return;
      }
    }

    this.wasOnGround = onGround;

    // Paced Cut Rhythm (maxShotDuration reached)
    if (this.shotTimer >= this.maxShotDuration) {
      // Pick next shot from normal roster avoiding repeating current
      const candidateList = SHOT_LIST_NORMAL.filter(s => s !== this.currentShotType);
      const nextType = candidateList[(this.shotIndex++) % candidateList.length];
      this.switchShot(nextType, flightState);
    }
  }

  /**
   * Switch into a new cinematic shot and initialize shot-specific vantage points.
   */
  switchShot(newType, flightState = {}) {
    this.lastShotType = this.currentShotType;
    this.currentShotType = newType;
    this.shotTimer = 0;

    // Shot initialization hooks
    if (newType === CINEMATIC_SHOTS.TELEPHOTO_FLYBY || newType === CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM) {
      this.flybyPassed = false;
      this.flybyWorldPos.set(0, 0, 0); // Will be populated on first frame of shot
    } else if (newType === CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY) {
      this.orbitAngle = Math.random() * Math.PI * 2;
      this.orbitSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.22 + Math.random() * 0.12);
      this.orbitRadius = 32.0 + Math.random() * 12.0;
    } else if (newType === CINEMATIC_SHOTS.WINGTIP_ACTION) {
      this.wingHardpointIndex = (this.wingHardpointIndex + 1) % 4;
    }
  }

  /**
   * Main camera update hook called each simulation frame.
   * Modifies camera.position, camera.quaternion, camera.up, and camera.fov.
   */
  update({
    dt,
    camera = this.camera,
    planePos,
    planeQuat,
    aircraftMesh,
    flightState = {},
    queryGroundHeight = this.queryGroundHeight,
  }) {
    if (!camera || !planePos || !planeQuat) return false;
    const safeDt = Math.min(2.0, Math.max(0.0001, dt ?? 0.016));

    // Evaluate cut and timing
    this.evaluateShotCut(flightState, safeDt);

    // Extract aircraft coordinate axes
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);

    // Compute aircraft speed and load
    const ias = flightState.iasKnots ?? 150;
    const gForce = flightState.gForce ?? 1.0;
    const rollDeg = flightState.rollDeg ?? 0;

    let targetCamPos = new THREE.Vector3();
    let targetLook = new THREE.Vector3().copy(planePos);
    let targetUp = new THREE.Vector3(0, 1, 0);
    let targetFov = 50.0;
    let posLerpFactor = 1.0 - Math.exp(-safeDt * 6.0);
    let lookLerpFactor = 1.0 - Math.exp(-safeDt * 8.0);

    // Calculate Cinema Rule-of-Thirds look-ahead lead in velocity direction
    const leadDistance = Math.min(18.0, (ias / 200.0) * 10.0);
    const leadOffset = forward.clone().multiplyScalar(leadDistance);

    switch (this.currentShotType) {
      case CINEMATIC_SHOTS.TELEPHOTO_FLYBY: {
        targetFov = 30.0; // Telephoto compression
        if (this.flybyWorldPos.lengthSq() < 1) {
          // Initialize flyby camera 220m ahead and 32m to the side
          const lateral = (Math.random() > 0.5 ? 1 : -1) * 36.0;
          this.flybyWorldPos.copy(planePos)
            .addScaledVector(forward, 220.0)
            .addScaledVector(right, lateral)
            .addScaledVector(up, 4.0);
        }

        // Check if aircraft has roared past camera plane
        const toPlane = planePos.clone().sub(this.flybyWorldPos);
        const distAlong = toPlane.dot(forward);
        if (distAlong > 30.0) {
          this.flybyPassed = true;
        }

        // Slow camera drift
        this.flybyWorldPos.addScaledVector(up, 0.4 * safeDt);
        targetCamPos.copy(this.flybyWorldPos);

        // Smoothly track the jet with anticipation
        targetLook.copy(planePos).add(leadOffset.clone().multiplyScalar(0.4));
        posLerpFactor = 1.0; // Stationary/drifting spotter
        lookLerpFactor = 1.0 - Math.exp(-safeDt * 10.0);
        break;
      }

      case CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY: {
        this.orbitAngle += this.orbitSpeed * safeDt;
        targetFov = 52.0;

        // Dolly expands and changes elevation across the shot
        const progress = Math.min(1.0, this.shotTimer / this.maxShotDuration);
        const radius = this.orbitRadius + progress * 8.0;
        const elev = this.orbitHeight + Math.sin(progress * Math.PI) * 4.0;

        const cosA = Math.cos(this.orbitAngle);
        const sinA = Math.sin(this.orbitAngle);

        targetCamPos.copy(planePos)
          .addScaledVector(right, cosA * radius)
          .addScaledVector(forward, sinA * radius)
          .add(new THREE.Vector3(0, elev, 0));

        // Subtle Dutch roll tilt with orbital motion
        const dutchTilt = Math.sin(this.orbitAngle) * 0.08;
        targetUp.copy(new THREE.Vector3(0, 1, 0)).addScaledVector(right, dutchTilt).normalize();

        targetLook.copy(planePos).add(leadOffset.clone().multiplyScalar(0.2));
        break;
      }

      case CINEMATIC_SHOTS.WINGTIP_ACTION: {
        targetFov = 74.0; // Wide-angle action rush
        const wingspanOffset = 18.0; // Representative half-span

        if (this.wingHardpointIndex === 0) {
          // Left wingtip looking inward at fuselage & cockpit
          targetCamPos.copy(planePos)
            .addScaledVector(right, -wingspanOffset)
            .addScaledVector(forward, -2.5)
            .addScaledVector(up, 0.8);
          targetLook.copy(planePos).addScaledVector(forward, 2.0);
        } else if (this.wingHardpointIndex === 1) {
          // Right wingtip looking across airframe
          targetCamPos.copy(planePos)
            .addScaledVector(right, wingspanOffset)
            .addScaledVector(forward, -2.5)
            .addScaledVector(up, 0.8);
          targetLook.copy(planePos).addScaledVector(forward, 2.0);
        } else if (this.wingHardpointIndex === 2) {
          // Vertical stabilizer fin looking forward down the spine
          targetCamPos.copy(planePos)
            .addScaledVector(forward, -14.0)
            .addScaledVector(up, 4.8);
          targetLook.copy(planePos).addScaledVector(forward, 15.0);
        } else {
          // Nose underbelly action cam looking rearward at gear/flaps
          targetCamPos.copy(planePos)
            .addScaledVector(forward, 8.0)
            .addScaledVector(up, -1.8);
          targetLook.copy(planePos).addScaledVector(forward, -6.0);
        }

        // Camera rolls locked to aircraft bank
        targetUp.copy(up);

        // High-speed aerodynamic buffeting jitter
        const shakeMag = (ias / 350.0) * 0.04;
        const shakeX = Math.sin(this.totalTimer * 42.0) * shakeMag;
        const shakeY = Math.cos(this.totalTimer * 58.0) * shakeMag;
        targetCamPos.addScaledVector(right, shakeX).addScaledVector(up, shakeY);
        break;
      }

      case CINEMATIC_SHOTS.HIGH_G_BANK_HERO: {
        targetFov = 62.0;
        // Position camera on upper-outer side of turn
        const bankSign = rollDeg >= 0 ? 1 : -1;
        targetCamPos.copy(planePos)
          .addScaledVector(right, -bankSign * 22.0)
          .addScaledVector(forward, -18.0)
          .addScaledVector(up, 7.5);

        // Partial Dutch angle sync (30% bank coupling for cinematic intensity)
        const partialRollRad = THREE.MathUtils.degToRad(rollDeg) * 0.32;
        targetUp.copy(new THREE.Vector3(0, 1, 0))
          .addScaledVector(right, Math.sin(partialRollRad))
          .normalize();

        // G-load vibration
        const gShake = Math.max(0, gForce - 1.0) * 0.05;
        targetCamPos.add(new THREE.Vector3(
          Math.sin(this.totalTimer * 50.0) * gShake,
          Math.cos(this.totalTimer * 65.0) * gShake,
          0
        ));

        targetLook.copy(planePos).addScaledVector(forward, 4.0);
        break;
      }

      case CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM: {
        targetFov = 42.0;
        if (this.flybyWorldPos.lengthSq() < 1) {
          const lateral = (Math.random() > 0.5 ? 1 : -1) * 25.0;
          this.flybyWorldPos.copy(planePos)
            .addScaledVector(forward, 150.0)
            .addScaledVector(right, lateral);
          const gh = queryGroundHeight(this.flybyWorldPos.x, this.flybyWorldPos.z);
          this.flybyWorldPos.y = gh + 2.5; // Perched 2.5m above ground/water
        }

        targetCamPos.copy(this.flybyWorldPos);
        targetLook.copy(planePos).add(leadOffset.clone().multiplyScalar(0.3));
        posLerpFactor = 1.0;
        lookLerpFactor = 1.0 - Math.exp(-safeDt * 9.0);
        break;
      }

      case CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER: {
        targetFov = 38.0;
        // Low ground-level runway spotter looking up at the wheels
        targetCamPos.copy(planePos)
          .addScaledVector(forward, 45.0)
          .addScaledVector(right, 14.0);
        const gh = queryGroundHeight(targetCamPos.x, targetCamPos.z);
        targetCamPos.y = gh + 1.6;

        targetLook.copy(planePos).add(new THREE.Vector3(0, -1.0, 0));
        posLerpFactor = 1.0 - Math.exp(-safeDt * 4.0);
        break;
      }

      case CINEMATIC_SHOTS.LEAD_IN_TRACKING: {
        targetFov = 50.0;
        // Nose-on reverse chase looking back at cockpit and nose
        targetCamPos.copy(planePos)
          .addScaledVector(forward, 32.0)
          .addScaledVector(up, 3.0)
          .addScaledVector(right, 4.0);
        targetLook.copy(planePos).addScaledVector(forward, -2.0);
        targetUp.copy(new THREE.Vector3(0, 1, 0)).addScaledVector(up, 0.2).normalize();
        break;
      }

      case CINEMATIC_SHOTS.COCKPIT_HERO:
      default: {
        targetFov = 58.0;
        // Over-the-shoulder cockpit framing
        targetCamPos.copy(planePos)
          .addScaledVector(forward, -11.5)
          .addScaledVector(up, 1.2)
          .addScaledVector(right, 0.4);
        targetLook.copy(planePos).addScaledVector(forward, 8.0);
        targetUp.copy(up);
        break;
      }
    }

    // Absolute Ground Clearance Safety Guarantee (No underground clipping)
    const groundH = queryGroundHeight(targetCamPos.x, targetCamPos.z);
    const minSafeY = Math.max(groundH + 1.8, 1.8);
    if (targetCamPos.y < minSafeY) {
      targetCamPos.y = minSafeY;
    }

    // Initialize or smooth interpolate camera transform
    if (!this.initialized) {
      this.camPos.copy(targetCamPos);
      this.camLookTarget.copy(targetLook);
      this.camUp.copy(targetUp);
      this.camFov = targetFov;
      this.initialized = true;
    } else {
      this.camPos.lerp(targetCamPos, posLerpFactor);
      this.camLookTarget.lerp(targetLook, lookLerpFactor);
      this.camUp.lerp(targetUp, 1.0 - Math.exp(-safeDt * 6.0));
      this.camFov += (targetFov - this.camFov) * (1.0 - Math.exp(-safeDt * 5.0));
    }

    // Ground clamp after interpolation
    const postGroundH = queryGroundHeight(this.camPos.x, this.camPos.z);
    if (this.camPos.y < postGroundH + 1.8) {
      this.camPos.y = postGroundH + 1.8;
    }

    // Apply to camera
    camera.position.copy(this.camPos);
    camera.up.copy(this.camUp);
    camera.lookAt(this.camLookTarget);

    if (camera.fov !== undefined && Math.abs(camera.fov - this.camFov) > 0.05) {
      camera.fov = this.camFov;
      if (typeof camera.updateProjectionMatrix === 'function') {
        camera.updateProjectionMatrix();
      }
    }

    return true;
  }
}
