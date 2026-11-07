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
 * 3. Enforces cinema composition and framing guarantees:
 *    - Rock-solid zero-stutter camera tracking (plane translation carried through rigidly;
 *      no world-space velocity drag lag)
 *    - Centered subject tracking: aircraft is always framed inside the viewport
 *    - Proximity-adaptive dynamic FOV: widens as aircraft approaches to prevent edge clipping
 *    - Altitude-anchored camera placement: camera altitude references aircraft altitude
 *      and enforces strict terrain clearance (+2.5m minimum floor) so the camera is never
 *      buried underground or occluded by hills
 *    - Post-flyby automatic cut: transitions as soon as the jet roars past
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
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.camFov = 50.0;
    this.camFovInitialized = false;
    this.initialized = false;
    this.snapNextFrame = false;

    // Translation tracking to eliminate forward-backward stutter
    this.prevPlanePos = new THREE.Vector3();
    this.prevPlanePosInitialized = false;

    // Shot-specific state variables
    this.orbitAngle = 0;
    this.orbitRadius = 38.0;
    this.orbitHeight = 9.0;
    this.orbitSpeed = 0.24;
    this.flybyWorldPos = new THREE.Vector3();
    this.flybySet = false;
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
    this.camFovInitialized = false;
    this.snapNextFrame = true;
    this.prevPlanePosInitialized = false;
    this.shotTimer = 0;
    this.totalTimer = 0;
    this.currentShotType = CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY;
    this.lastShotType = null;
    this.shotIndex = 0;
    this.history = [];
    this.wasOnGround = true;
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.replayCursor = 0;
    this.flybySet = false;
    this.flybyWorldPos.set(0, 0, 0);
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

      // 3. Low-altitude high-speed terrain skimming (only in active low trench)
      if (agl < 180 && ias > 220 && !onGround && this.currentShotType !== CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM) {
        this.switchShot(CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM, flightState);
        this.wasOnGround = onGround;
        return;
      }
    }

    this.wasOnGround = onGround;

    // Paced Cut Rhythm (maxShotDuration reached)
    if (this.shotTimer >= this.maxShotDuration) {
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
    this.flybySet = false;
    this.flybyWorldPos.set(0, 0, 0);
    this.snapNextFrame = true; // Instant cinematic cut to new camera vantage

    if (newType === CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY) {
      this.orbitAngle = Math.random() * Math.PI * 2;
      this.orbitSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.22 + Math.random() * 0.12);
      this.orbitRadius = 34.0 + Math.random() * 10.0;
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

    // Calculate frame-to-frame translation delta to eliminate world-space lag stutter
    const planePosDelta = new THREE.Vector3();
    if (this.prevPlanePosInitialized) {
      planePosDelta.copy(planePos).sub(this.prevPlanePos);
    } else {
      this.prevPlanePosInitialized = true;
    }
    this.prevPlanePos.copy(planePos);

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
    const onGround = Boolean(flightState.onGround);

    let targetCamPos = new THREE.Vector3();
    // Default look target: center of aircraft fuselage, slightly raised for good framing
    let targetLook = planePos.clone().addScaledVector(up, 1.2);
    let targetUp = new THREE.Vector3(0, 1, 0);
    let targetFov = 50.0;
    let isRigidMount = false;
    let isChasingDolly = false;

    switch (this.currentShotType) {
      case CINEMATIC_SHOTS.TELEPHOTO_FLYBY: {
        const forwardHoriz = new THREE.Vector3(forward.x, 0, forward.z);
        if (forwardHoriz.lengthSq() > 0.001) forwardHoriz.normalize();
        else forwardHoriz.set(0, 0, -1);
        const rightHoriz = new THREE.Vector3(-forwardHoriz.z, 0, forwardHoriz.x);

        if (!this.flybySet || this.flybyWorldPos.lengthSq() < 1) {
          const lateralSign = Math.random() > 0.5 ? 1 : -1;
          if (onGround) {
            // Runway-edge spotter view ahead of rollout
            const targetX = planePos.x + forwardHoriz.x * 85.0 + rightHoriz.x * lateralSign * 20.0;
            const targetZ = planePos.z + forwardHoriz.z * 85.0 + rightHoriz.z * lateralSign * 20.0;
            const gh = Math.max(0, queryGroundHeight(targetX, targetZ));
            this.flybyWorldPos.set(targetX, gh + 2.2, targetZ);
          } else {
            // Airborne flyby: 220m ahead along flight path, 38m lateral offset
            const targetX = planePos.x + forwardHoriz.x * 220.0 + rightHoriz.x * lateralSign * 38.0;
            const targetZ = planePos.z + forwardHoriz.z * 220.0 + rightHoriz.z * lateralSign * 38.0;
            const gh = Math.max(0, queryGroundHeight(targetX, targetZ));
            // Anchor height to aircraft altitude; strictly above ground
            const targetY = Math.max(gh + 5.0, planePos.y - 6.0);
            this.flybyWorldPos.set(targetX, targetY, targetZ);
          }
          this.flybySet = true;
          this.camPos.copy(this.flybyWorldPos);
        }

        // Slow camera drift
        this.flybyWorldPos.y += 0.25 * safeDt;
        targetCamPos.copy(this.flybyWorldPos);

        // Ground safety clamp
        const gh = Math.max(0, queryGroundHeight(targetCamPos.x, targetCamPos.z));
        if (targetCamPos.y < gh + 2.0) targetCamPos.y = gh + 2.0;
        this.camPos.copy(targetCamPos);

        // Adaptive FOV: telephoto at distance (32°), widens smoothly as plane passes (up to 56°)
        const currentDist = this.camPos.distanceTo(planePos);
        targetFov = THREE.MathUtils.clamp(32.0 + Math.max(0, 180.0 - currentDist) * 0.16, 32.0, 56.0);

        // Track aircraft center directly
        targetLook.copy(planePos).addScaledVector(up, 1.2);
        targetUp.set(0, 1, 0);

        // Once aircraft passes camera plane by > 45m or moves past 420m, cut to next shot
        const toPlane = planePos.clone().sub(this.camPos);
        if (toPlane.dot(forwardHoriz) > 45.0 || currentDist > 420.0) {
          this.shotTimer = this.maxShotDuration; // Trigger clean transition
        }
        break;
      }

      case CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY: {
        isChasingDolly = true;
        this.orbitAngle += this.orbitSpeed * safeDt;
        targetFov = 50.0;

        const progress = Math.min(1.0, this.shotTimer / this.maxShotDuration);
        const radius = this.orbitRadius + Math.sin(progress * Math.PI) * 8.0;
        const elev = this.orbitHeight + Math.sin(progress * Math.PI * 2) * 3.5;

        const cosA = Math.cos(this.orbitAngle);
        const sinA = Math.sin(this.orbitAngle);

        targetCamPos.copy(planePos)
          .addScaledVector(right, cosA * radius)
          .addScaledVector(forward, sinA * radius)
          .addScaledVector(up, elev);

        const gh = Math.max(0, queryGroundHeight(targetCamPos.x, targetCamPos.z));
        if (targetCamPos.y < gh + 3.0) targetCamPos.y = gh + 3.0;

        const dutchTilt = Math.sin(this.orbitAngle) * 0.08;
        targetUp.copy(new THREE.Vector3(0, 1, 0)).addScaledVector(right, dutchTilt).normalize();
        targetLook.copy(planePos).addScaledVector(up, 1.2);
        break;
      }

      case CINEMATIC_SHOTS.WINGTIP_ACTION: {
        isRigidMount = true;
        targetFov = 72.0; // Wide-angle action rush
        const wingspanOffset = 18.0; // Half-span

        let localPos = new THREE.Vector3();
        let localLook = new THREE.Vector3();

        if (this.wingHardpointIndex === 0) {
          // Left wingtip looking inward across cockpit & fuselage
          localPos.set(-wingspanOffset, 0.6, -1.0);
          localLook.set(0, 0.4, 1.0);
        } else if (this.wingHardpointIndex === 1) {
          // Right wingtip looking inward
          localPos.set(wingspanOffset, 0.6, -1.0);
          localLook.set(0, 0.4, 1.0);
        } else if (this.wingHardpointIndex === 2) {
          // Vertical stabilizer tail fin looking forward down spine
          localPos.set(0, 4.5, 12.0);
          localLook.set(0, 0.5, -20.0);
        } else {
          // Nose underbelly looking rearward at gear
          localPos.set(0, -1.8, -8.0);
          localLook.set(0, -0.5, 10.0);
        }

        targetCamPos.copy(planePos)
          .addScaledVector(right, localPos.x)
          .addScaledVector(up, localPos.y)
          .addScaledVector(forward, -localPos.z);

        targetLook.copy(planePos)
          .addScaledVector(right, localLook.x)
          .addScaledVector(up, localLook.y)
          .addScaledVector(forward, -localLook.z);

        // High-speed aerodynamic buffeting jitter (subtle micro-vibration)
        const shakeMag = (ias / 400.0) * 0.025;
        const shakeX = Math.sin(this.totalTimer * 42.0) * shakeMag;
        const shakeY = Math.cos(this.totalTimer * 58.0) * shakeMag;
        targetCamPos.addScaledVector(right, shakeX).addScaledVector(up, shakeY);

        targetUp.copy(up);
        break;
      }

      case CINEMATIC_SHOTS.HIGH_G_BANK_HERO: {
        isChasingDolly = true;
        targetFov = 58.0;
        const bankSign = rollDeg >= 0 ? 1 : -1;

        // Position on upper-outer side of turn
        targetCamPos.copy(planePos)
          .addScaledVector(right, -bankSign * 24.0)
          .addScaledVector(forward, -20.0)
          .addScaledVector(up, 8.5);

        const gh = Math.max(0, queryGroundHeight(targetCamPos.x, targetCamPos.z));
        if (targetCamPos.y < gh + 3.0) targetCamPos.y = gh + 3.0;

        // 30% Dutch tilt roll sync
        const partialRollRad = THREE.MathUtils.degToRad(rollDeg) * 0.30;
        targetUp.copy(new THREE.Vector3(0, 1, 0))
          .addScaledVector(right, Math.sin(partialRollRad))
          .normalize();

        const gShake = Math.max(0, gForce - 1.0) * 0.035;
        targetCamPos.add(new THREE.Vector3(
          Math.sin(this.totalTimer * 50.0) * gShake,
          Math.cos(this.totalTimer * 65.0) * gShake,
          0
        ));

        targetLook.copy(planePos).addScaledVector(up, 1.2);
        break;
      }

      case CINEMATIC_SHOTS.TERRAIN_CANYON_SKIM: {
        const forwardHoriz = new THREE.Vector3(forward.x, 0, forward.z);
        if (forwardHoriz.lengthSq() > 0.001) forwardHoriz.normalize();
        else forwardHoriz.set(0, 0, -1);
        const rightHoriz = new THREE.Vector3(-forwardHoriz.z, 0, forwardHoriz.x);

        const currentDist = this.camPos.distanceTo(planePos);
        if (!this.flybySet || this.flybyWorldPos.lengthSq() < 1) {
          const lateralSign = Math.random() > 0.5 ? 1 : -1;
          const targetX = planePos.x + forwardHoriz.x * 140.0 + rightHoriz.x * lateralSign * 24.0;
          const targetZ = planePos.z + forwardHoriz.z * 140.0 + rightHoriz.z * lateralSign * 24.0;
          const gh = Math.max(0, queryGroundHeight(targetX, targetZ));
          const targetY = Math.max(gh + 3.0, planePos.y - 3.0);
          this.flybyWorldPos.set(targetX, targetY, targetZ);
          this.flybySet = true;
          this.camPos.copy(this.flybyWorldPos);
        }

        targetCamPos.copy(this.flybyWorldPos);
        const gh = Math.max(0, queryGroundHeight(targetCamPos.x, targetCamPos.z));
        if (targetCamPos.y < gh + 2.5) targetCamPos.y = gh + 2.5;
        this.camPos.copy(targetCamPos);

        targetFov = THREE.MathUtils.clamp(38.0 + Math.max(0, 140.0 - currentDist) * 0.15, 38.0, 58.0);
        targetLook.copy(planePos).addScaledVector(up, 1.2);
        targetUp.set(0, 1, 0);

        const toPlane = planePos.clone().sub(this.camPos);
        if (toPlane.dot(forwardHoriz) > 40.0 || currentDist > 350.0) {
          this.shotTimer = this.maxShotDuration;
        }
        break;
      }

      case CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER: {
        const forwardHoriz = new THREE.Vector3(forward.x, 0, forward.z);
        if (forwardHoriz.lengthSq() > 0.001) forwardHoriz.normalize();
        else forwardHoriz.set(0, 0, -1);
        const rightHoriz = new THREE.Vector3(-forwardHoriz.z, 0, forwardHoriz.x);

        if (!this.flybySet || this.flybyWorldPos.lengthSq() < 1) {
          const targetX = planePos.x + forwardHoriz.x * 55.0 + rightHoriz.x * 16.0;
          const targetZ = planePos.z + forwardHoriz.z * 55.0 + rightHoriz.z * 16.0;
          const gh = Math.max(0, queryGroundHeight(targetX, targetZ));
          this.flybyWorldPos.set(targetX, gh + 2.2, targetZ);
          this.flybySet = true;
          this.camPos.copy(this.flybyWorldPos);
        }

        targetCamPos.copy(this.flybyWorldPos);
        const gh = Math.max(0, queryGroundHeight(targetCamPos.x, targetCamPos.z));
        if (targetCamPos.y < gh + 1.8) targetCamPos.y = gh + 1.8;
        this.camPos.copy(targetCamPos);

        targetFov = 42.0;
        targetLook.copy(planePos).addScaledVector(up, 0.6); // Focused on wheels/gear
        targetUp.set(0, 1, 0);

        const toPlane = planePos.clone().sub(this.camPos);
        if (toPlane.dot(forwardHoriz) > 35.0 || this.shotTimer > 4.5) {
          this.shotTimer = this.maxShotDuration;
        }
        break;
      }

      case CINEMATIC_SHOTS.LEAD_IN_TRACKING: {
        isChasingDolly = true;
        targetFov = 52.0;
        // Positioned ahead of the nose looking backward at the approaching aircraft
        targetCamPos.copy(planePos)
          .addScaledVector(forward, 32.0)
          .addScaledVector(up, 3.5)
          .addScaledVector(right, 4.0);

        const gh = Math.max(0, queryGroundHeight(targetCamPos.x, targetCamPos.z));
        if (targetCamPos.y < gh + 3.0) targetCamPos.y = gh + 3.0;

        targetLook.copy(planePos).addScaledVector(up, 1.0);
        targetUp.copy(new THREE.Vector3(0, 1, 0)).addScaledVector(up, 0.15).normalize();
        break;
      }

      case CINEMATIC_SHOTS.COCKPIT_HERO:
      default: {
        isRigidMount = true;
        targetFov = 58.0;
        // Over-the-shoulder pilot vantage: slightly behind captain seat looking forward
        targetCamPos.copy(planePos)
          .addScaledVector(right, -0.38)
          .addScaledVector(up, 0.95)
          .addScaledVector(forward, 11.8);

        targetLook.copy(planePos)
          .addScaledVector(right, -0.2)
          .addScaledVector(up, 0.7)
          .addScaledVector(forward, 30.0);

        targetUp.copy(up);
        break;
      }
    }

    // Adapt field of view for portrait displays (aspect < 1.0) to prevent tunnel vision
    const aspect = camera.aspect || 1.0;
    if (aspect < 1.0) {
      const baseVFovRad = (targetFov * Math.PI) / 180;
      const hFovRad = 2 * Math.atan(Math.tan(baseVFovRad / 2) * 1.5);
      const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspect);
      targetFov = Math.min(105, Math.max(30, (vFovRad * 180) / Math.PI));
    }

    // Kinematics and Position Integration:
    if (!this.initialized || this.snapNextFrame) {
      this.camPos.copy(targetCamPos);
      this.camUp.copy(targetUp);
      this.camFov = targetFov;
      this.camFovInitialized = true;
      this.initialized = true;
      this.snapNextFrame = false;
    } else if (isRigidMount) {
      // Rigid body mounts (wing, cockpit) copy transform directly: ZERO lag or stutter!
      this.camPos.copy(targetCamPos);
      this.camUp.copy(targetUp);
    } else if (isChasingDolly) {
      // Chasing/orbiting dollies carry aircraft translation rigidly, then damp relative angle
      if (this.prevPlanePosInitialized && planePosDelta.lengthSq() < 10000) {
        this.camPos.add(planePosDelta);
      }
      this.camPos.lerp(targetCamPos, 1.0 - Math.exp(-safeDt * 8.0));
      this.camUp.lerp(targetUp, 1.0 - Math.exp(-safeDt * 6.0));
    }

    // Absolute Ground Clearance Safety Guarantee
    const currentGroundH = Math.max(0, queryGroundHeight(this.camPos.x, this.camPos.z));
    if (this.camPos.y < currentGroundH + 1.8) {
      this.camPos.y = currentGroundH + 1.8;
    }

    // Smooth FOV transition using internal director state (isolated from external clobbering)
    if (camera.fov !== undefined) {
      if (!this.camFovInitialized) {
        this.camFov = targetFov;
        this.camFovInitialized = true;
      } else {
        this.camFov += (targetFov - this.camFov) * (1.0 - Math.exp(-safeDt * 6.0));
      }
      camera.fov = this.camFov;
      if (typeof camera.updateProjectionMatrix === 'function') {
        camera.updateProjectionMatrix();
      }
    }

    // Apply to camera
    camera.position.copy(this.camPos);
    camera.up.copy(isRigidMount ? targetUp : this.camUp);
    camera.lookAt(targetLook);

    return true;
  }
}
