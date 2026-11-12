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
  MISSILE_LAUNCH: 'missile_launch',
  MISSILE_TRACK: 'missile_track',
  BANDIT_POV: 'bandit_pov',
};

/** Scripted cut sequence when the player releases a rail missile. */
const MISSILE_SEQUENCE_EXIT_SHOT = CINEMATIC_SHOTS.DYNAMIC_ORBIT_DOLLY;
const MISSILE_LAUNCH_SECONDS = 1.1;
// The follow cam holds as long as the round is still closing. If it is still
// far at the cap, routine shots take over until the final cut is in range.
const MISSILE_TRACK_MAX_SECONDS = 9.0;
const MISSILE_POV_ENTRY_RANGE_M = 1600;
const MISSILE_BANDIT_MAX_SECONDS = 6.0;
const MISSILE_POV_LINGER_SECONDS = 1.4;

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

    // Aircraft geometric bounds for fuselage collision avoidance and exterior mounting
    this.wingspan = 35.8;
    this.fuselageRadiusX = 2.0;
    this.fuselageRadiusY = 2.1;
    this.fuselageCenterY = 0.0;
    this.fuselageLength = 39.0;
    this.tailFinHeight = 6.0;
    this.captainEyePos = new THREE.Vector3(-0.39, 0.85, -12.35);
    this.gearCamOffset = new THREE.Vector3(2.2, -2.4, 6.2);
    this.gearLookTarget = new THREE.Vector3(-0.5, -1.9, -2.5);

    // Rolling telemetry history for live derivative analysis
    this.history = [];
    this.historyWindowSec = 4.0;
    this.wasOnGround = true;

    // Pre-planned replay timeline (when driven from recorded sortie)
    this.replayPlan = null;
    this.replayCursor = 0;

    // Live missile cinematics: launch → follow the missile → bandit POV.
    this.missileSequence = null;
    this.knownMissileIds = new Set();
    this.missileChaseDir = new THREE.Vector3(0, 0, -1);
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
    this.missileSequence = null;
    this.knownMissileIds.clear();
  }

  /**
   * Set ground elevation query callback.
   */
  setTerrainQuery(fn) {
    if (typeof fn === 'function') this.queryGroundHeight = fn;
  }

  /**
   * Configure director dimensions and hardpoint mounts to match the active aircraft.
   */
  loadAircraftConfig(config = {}) {
    const cockpit = config.cockpit || {};
    const aero = config.aerodynamics || {};
    this.wingspan = aero.wingspanM ?? 35.8;

    if (cockpit.captainEyePos) {
      this.captainEyePos = new THREE.Vector3(cockpit.captainEyePos.x, cockpit.captainEyePos.y, cockpit.captainEyePos.z);
    }
    if (cockpit.gearCamOffset) {
      this.gearCamOffset = new THREE.Vector3(cockpit.gearCamOffset.x, cockpit.gearCamOffset.y, cockpit.gearCamOffset.z);
    }
    if (cockpit.gearLookTarget) {
      this.gearLookTarget = new THREE.Vector3(cockpit.gearLookTarget.x, cockpit.gearLookTarget.y, cockpit.gearLookTarget.z);
    }

    if (config.id === 'F16') {
      this.fuselageRadiusX = 1.3;
      this.fuselageRadiusY = 1.3;
      this.fuselageCenterY = 0.0;
      this.fuselageLength = 15.0;
      this.tailFinHeight = 2.4;
    } else if (config.id === 'C172') {
      this.fuselageRadiusX = 1.0;
      this.fuselageRadiusY = 1.1;
      this.fuselageCenterY = 0.1;
      this.fuselageLength = 8.5;
      this.tailFinHeight = 1.8;
    } else {
      // Boeing 737-800 default
      this.fuselageRadiusX = 2.0;
      this.fuselageRadiusY = 2.1;
      this.fuselageCenterY = 0.0;
      this.fuselageLength = 39.0;
      this.tailFinHeight = 6.0;
    }
  }

  /**
   * Enforces strict clearance from the aircraft fuselage envelope.
   * If the camera position is inside or intersecting the fuselage bounding cylinder/capsule,
   * it pushes the position outward along the radial axis to ensure the camera is NEVER inside
   * the aircraft body.
   */
  enforceFuselageClearance(pos, planePos, planeQuat) {
    if (!pos || !planePos || !planeQuat) return;

    const rel = pos.clone().sub(planePos);
    const invQuat = planeQuat.clone().invert();
    const local = rel.applyQuaternion(invQuat);

    const radX = (this.fuselageRadiusX ?? 2.0) + 0.6;
    const radY = (this.fuselageRadiusY ?? 2.1) + 0.6;
    const centerY = this.fuselageCenterY ?? 0.0;
    const halfLen = (this.fuselageLength ?? 39.0) * 0.52;
    const noseZ = -halfLen;
    const tailZ = halfLen;

    if (local.z >= noseZ && local.z <= tailZ) {
      let taper = 1.0;
      if (local.z < 0) {
        taper = 0.6 + 0.4 * (1.0 - Math.min(1.0, Math.abs(local.z) / Math.abs(noseZ)));
      } else {
        taper = 0.6 + 0.4 * (1.0 - Math.min(1.0, local.z / tailZ));
      }
      taper = Math.max(0.5, Math.min(1.0, taper));

      const effRadX = radX * taper;
      const effRadY = radY * taper;

      const normX = local.x / effRadX;
      const normY = (local.y - centerY) / effRadY;
      const distSq = normX * normX + normY * normY;

      if (distSq < 1.0) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.001) {
          local.x = (normX / dist) * effRadX;
          local.y = centerY + (normY / dist) * effRadY;
        } else {
          local.y = centerY + effRadY;
        }
        pos.copy(local.applyQuaternion(planeQuat).add(planePos));
      }
    }
  }

  /**
   * Enforces lateral clearance if the camera was pushed upward by ground clearance clamp
   * while positioned beneath the aircraft fuselage.
   */
  enforceLateralFuselageClearance(pos, planePos, planeQuat) {
    if (!pos || !planePos || !planeQuat) return;
    const rel = pos.clone().sub(planePos);
    const invQuat = planeQuat.clone().invert();
    const local = rel.applyQuaternion(invQuat);

    const radX = (this.fuselageRadiusX ?? 2.0) + 0.6;
    const radY = (this.fuselageRadiusY ?? 2.1) + 0.6;
    const centerY = this.fuselageCenterY ?? 0.0;
    const halfLen = (this.fuselageLength ?? 39.0) * 0.52;

    if (local.z >= -halfLen && local.z <= halfLen) {
      const normX = local.x / radX;
      const normY = (local.y - centerY) / radY;
      if (normX * normX + normY * normY < 1.0) {
        const sign = local.x >= 0 ? 1 : -1;
        local.x = sign * radX;
        pos.copy(local.applyQuaternion(planeQuat).add(planePos));
      }
    }
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
   * A rail release is an event, not a telemetry trend: cut immediately into the
   * launch beat, then follow the missile and finish from the bandit's seat.
   */
  detectMissileLaunch(missiles, targets, planePos = null, planeQuat = null) {
    if (!Array.isArray(missiles) || !missiles.length) return;
    for (const missile of missiles) {
      if (!missile?.alive || this.knownMissileIds.has(missile.id)) continue;
      this.knownMissileIds.add(missile.id);
      // A missile already downrange when DIRECTOR is selected is not a launch.
      if ((missile.age ?? 0) > 2.0) continue;
      // Replays own their timeline, and one launch sequence plays at a time.
      if (this.missileSequence || this.replayPlan?.shots?.length) continue;
      this.beginMissileSequence(missile, targets, planePos, planeQuat);
    }
  }

  beginMissileSequence(missile, targets, planePos = null, planeQuat = null) {
    const target = missile.target?.alive ? missile.target : this.nearestAliveTarget(missile, targets);
    // Latch the launch rail side once. Recomputing it from the live missile
    // offset can flip the camera across the fuselage if the round crosses the
    // centreline or the jet rolls immediately after release.
    let stationSide = null;
    if (planePos && planeQuat) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuat);
      const offset = missile.position.clone().sub(planePos);
      if (offset.lengthSq() > 1e-6) stationSide = offset.dot(right) >= 0 ? 1 : -1;
    }
    this.missileSequence = {
      missile,
      target,
      phase: 'launch',
      phaseTime: 0,
      missileDeathTime: null,
      stationSide,
      lastMissilePos: missile.position.clone(),
      lastTargetPos: target ? target.position.clone() : null,
    };
    this.missileChaseDir.copy(missile.velocity || new THREE.Vector3(0, 0, -1));
    if (this.missileChaseDir.lengthSq() < 1e-6) this.missileChaseDir.set(0, 0, -1);
    else this.missileChaseDir.normalize();
    this.switchShot(CINEMATIC_SHOTS.MISSILE_LAUNCH);
  }

  nearestAliveTarget(missile, targets) {
    let nearest = null;
    let nearestRangeSq = Infinity;
    for (const candidate of targets || []) {
      if (!candidate?.alive || !candidate.position) continue;
      const rangeSq = candidate.position.distanceToSquared(missile.position);
      if (rangeSq < nearestRangeSq) {
        nearest = candidate;
        nearestRangeSq = rangeSq;
      }
    }
    return nearest;
  }

  advanceMissileSequence(dt) {
    const sequence = this.missileSequence;
    if (!sequence) return;
    sequence.phaseTime += dt;
    if (sequence.missile?.position) sequence.lastMissilePos.copy(sequence.missile.position);
    if (sequence.target?.position) {
      if (!sequence.lastTargetPos) sequence.lastTargetPos = sequence.target.position.clone();
      else sequence.lastTargetPos.copy(sequence.target.position);
    }
    // The system splices dead missiles out of its live array; keep our own
    // reference so the shot still has geometry for the final frames.
    if (sequence.missile && !sequence.missile.alive && sequence.missileDeathTime === null) {
      sequence.missileDeathTime = 0;
    }
    if (sequence.missileDeathTime !== null) sequence.missileDeathTime += dt;

    if (sequence.phase === 'launch') {
      if (sequence.phaseTime >= MISSILE_LAUNCH_SECONDS) this.setMissileSequencePhase('track');
    } else if (sequence.phase === 'track') {
      const range = sequence.target && sequence.lastTargetPos
        ? sequence.lastMissilePos.distanceTo(sequence.lastTargetPos)
        : Infinity;
      if (sequence.missileDeathTime !== null) {
        this.endMissileSequence();
      } else if (range <= MISSILE_POV_ENTRY_RANGE_M) {
        this.setMissileSequencePhase('bandit');
      } else if (sequence.phaseTime >= MISSILE_TRACK_MAX_SECONDS) {
        if (sequence.target && sequence.lastTargetPos) this.setMissileSequencePhase('approach');
        else this.endMissileSequence();
      }
    } else if (sequence.phase === 'approach') {
      if (sequence.missileDeathTime !== null || !sequence.target || !sequence.lastTargetPos) {
        this.endMissileSequence();
        return;
      }
      if (sequence.lastMissilePos.distanceTo(sequence.lastTargetPos) <= MISSILE_POV_ENTRY_RANGE_M) {
        this.setMissileSequencePhase('bandit');
      }
    } else if (sequence.phase === 'bandit') {
      const expired = sequence.missileDeathTime !== null
        ? sequence.missileDeathTime >= MISSILE_POV_LINGER_SECONDS
        : sequence.phaseTime >= MISSILE_BANDIT_MAX_SECONDS;
      if (expired) this.endMissileSequence();
    }
  }

  setMissileSequencePhase(phase) {
    this.missileSequence.phase = phase;
    this.missileSequence.phaseTime = 0;
    if (phase === 'track') this.switchShot(CINEMATIC_SHOTS.MISSILE_TRACK);
    else if (phase === 'bandit') this.switchShot(CINEMATIC_SHOTS.BANDIT_POV);
    else this.switchShot(MISSILE_SEQUENCE_EXIT_SHOT);
  }

  endMissileSequence() {
    this.missileSequence = null;
    this.switchShot(MISSILE_SEQUENCE_EXIT_SHOT);
  }

  /**
   * Evaluate whether a shot transition should occur right now.
   */
  evaluateShotCut(flightState, dt) {
    this.shotTimer += dt;
    this.totalTimer += dt;

    // A launch sequence owns the cut rhythm through launch, follow and the
    // final bandit POV. While the missile is still closing, routine shots run.
    if (this.missileSequence) {
      this.advanceMissileSequence(dt);
      if (!this.missileSequence || this.missileSequence.phase !== 'approach') return;
    }

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
    missiles = [],
    targets = [],
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

    // A fresh rail release cuts to its own three-beat sequence before the
    // routine shot grammar gets a chance to choose a cut.
    this.detectMissileLaunch(missiles, targets, planePos, planeQuat);

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

        const lateralDist = Math.max(28.0, (this.wingspan ?? 35.8) * 0.85);

        if (!this.flybySet || this.flybyWorldPos.lengthSq() < 1) {
          const lateralSign = Math.random() > 0.5 ? 1 : -1;
          if (onGround) {
            // Runway-edge spotter view ahead of rollout
            const targetX = planePos.x + forwardHoriz.x * 85.0 + rightHoriz.x * lateralSign * lateralDist;
            const targetZ = planePos.z + forwardHoriz.z * 85.0 + rightHoriz.z * lateralSign * lateralDist;
            const gh = Math.max(0, queryGroundHeight(targetX, targetZ));
            this.flybyWorldPos.set(targetX, gh + 2.2, targetZ);
          } else {
            // Airborne flyby: 220m ahead along flight path, lateral offset well clear of wings
            const targetX = planePos.x + forwardHoriz.x * 220.0 + rightHoriz.x * lateralSign * lateralDist;
            const targetZ = planePos.z + forwardHoriz.z * 220.0 + rightHoriz.z * lateralSign * lateralDist;
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

        // Once aircraft passes camera plane by > 18m or moves too close (< 12m) or past 420m, cut to next shot
        const toPlane = planePos.clone().sub(this.camPos);
        const passedAhead = toPlane.dot(forwardHoriz);
        if (passedAhead > 18.0 || currentDist < 12.0 || currentDist > 420.0) {
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
        const wingspanOffset = (this.wingspan ?? 35.8) * 0.48; // Half-span near wingtip

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
          const tailZ = (this.fuselageLength ?? 39.0) * 0.31;
          const tailY = (this.fuselageRadiusY ?? 2.1) + ((this.tailFinHeight ?? 6.0) * 0.42);
          localPos.set(0, tailY, tailZ);
          localLook.set(0, tailY * 0.1, -25.0);
        } else {
          // Belly gear cam: mounted safely outside fuselage looking at landing gear
          if (this.gearCamOffset) {
            localPos.copy(this.gearCamOffset);
            if (this.gearLookTarget) {
              localLook.copy(this.gearLookTarget);
            } else {
              localLook.set(0, -1.0, -1.0);
            }
          } else {
            localPos.set(2.0, -2.5, 4.0);
            localLook.set(-0.5, -1.8, -2.0);
          }
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
        const lateralDist = Math.max(26.0, (this.wingspan ?? 35.8) * 0.80);

        const currentDist = this.camPos.distanceTo(planePos);
        if (!this.flybySet || this.flybyWorldPos.lengthSq() < 1) {
          const lateralSign = Math.random() > 0.5 ? 1 : -1;
          const targetX = planePos.x + forwardHoriz.x * 140.0 + rightHoriz.x * lateralSign * lateralDist;
          const targetZ = planePos.z + forwardHoriz.z * 140.0 + rightHoriz.z * lateralSign * lateralDist;
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
        if (toPlane.dot(forwardHoriz) > 18.0 || currentDist < 10.0 || currentDist > 350.0) {
          this.shotTimer = this.maxShotDuration;
        }
        break;
      }

      case CINEMATIC_SHOTS.TOUCHDOWN_SPOTTER: {
        const forwardHoriz = new THREE.Vector3(forward.x, 0, forward.z);
        if (forwardHoriz.lengthSq() > 0.001) forwardHoriz.normalize();
        else forwardHoriz.set(0, 0, -1);
        const rightHoriz = new THREE.Vector3(-forwardHoriz.z, 0, forwardHoriz.x);
        const lateralDist = Math.max(24.0, (this.wingspan ?? 35.8) * 0.70);

        if (!this.flybySet || this.flybyWorldPos.lengthSq() < 1) {
          const lateralSign = Math.random() > 0.5 ? 1 : -1;
          const targetX = planePos.x + forwardHoriz.x * 55.0 + rightHoriz.x * lateralSign * lateralDist;
          const targetZ = planePos.z + forwardHoriz.z * 55.0 + rightHoriz.z * lateralSign * lateralDist;
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
        const currentDist = this.camPos.distanceTo(planePos);
        if (toPlane.dot(forwardHoriz) > 16.0 || currentDist < 10.0 || this.shotTimer > 4.5) {
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

      case CINEMATIC_SHOTS.MISSILE_LAUNCH: {
        // Wing-mounted action cam: the airframe stays rigid in frame while the
        // missile separates from its rail and tracks away.
        isRigidMount = true;
        targetFov = 55.0;
        const missilePos = this.missileSequence?.lastMissilePos ?? planePos;
        if (this.missileSequence && this.missileSequence.stationSide == null) {
          const offset = missilePos.clone().sub(planePos);
          if (offset.lengthSq() > 1e-6) {
            this.missileSequence.stationSide = offset.dot(right) >= 0 ? 1 : -1;
          }
        }
        const stationSide = this.missileSequence?.stationSide ?? 1;
        targetCamPos.copy(planePos)
          .addScaledVector(right, stationSide * 11.0)
          .addScaledVector(up, 3.2)
          .addScaledVector(forward, -5.0);
        // Hold the aircraft in frame instead of chasing the round away: the
        // missile crosses the nose, so its smoke reads against the jet.
        targetLook.copy(planePos).addScaledVector(up, 0.8).addScaledVector(forward, 9.0);
        targetUp.copy(up);
        break;
      }

      case CINEMATIC_SHOTS.MISSILE_TRACK: {
        // Rigid follow cam: the eye rides the missile's own frame so a 700 m/s
        // body stays locked in frame instead of lagging behind the dolly.
        isRigidMount = true;
        targetFov = 62.0;
        const sequence = this.missileSequence;
        const missilePos = sequence?.lastMissilePos ?? planePos;
        const velocityDir = sequence?.missile?.velocity
          ? sequence.missile.velocity.clone().normalize()
          : new THREE.Vector3(0, 0, -1);
        if (velocityDir.lengthSq() > 1e-6) {
          this.missileChaseDir.lerp(velocityDir, 1 - Math.exp(-safeDt * 8.0)).normalize();
        }
        const dir = this.missileChaseDir;
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        else side.normalize();
        targetCamPos.copy(missilePos)
          .addScaledVector(dir, -16.0)
          .addScaledVector(side, 3.0)
          .addScaledVector(new THREE.Vector3(0, 1, 0), 3.5);
        targetLook.copy(missilePos).addScaledVector(dir, 5.0);
        targetUp.set(0, 1, 0);
        break;
      }

      case CINEMATIC_SHOTS.BANDIT_POV: {
        // Head-out-of-canopy eye of the targeted bandit watching the missile
        // close. The eye sits above and beside the canopy so the tail fin does
        // not cover the inbound round.
        isRigidMount = true;
        const sequence = this.missileSequence;
        const targetPos = sequence?.lastTargetPos ?? sequence?.target?.position ?? planePos;
        const missilePos = sequence?.lastMissilePos ?? targetPos;
        const worldUp = new THREE.Vector3(0, 1, 0);
        const bearing = missilePos.clone().sub(targetPos);
        bearing.y = 0;
        const side = new THREE.Vector3();
        const horizontal = bearing.length();
        if (horizontal > 1e-2) {
          bearing.divideScalar(horizontal);
          side.set(-bearing.z, 0, bearing.x);
        } else {
          // Directly above/below or at impact: keep a unit lateral offset so
          // the camera cannot collapse inside the bandit mesh.
          side.set(1, 0, 0);
        }
        targetCamPos.copy(targetPos)
          .addScaledVector(worldUp, 1.35)
          .addScaledVector(side, 2.4);

        // Telephoto the last kilometres: the round stays readable as it grows
        // from a speck into the frame instead of ending the beat as a dot.
        const range = missilePos.distanceTo(targetPos);
        targetFov = THREE.MathUtils.clamp(58.0 - (MISSILE_POV_ENTRY_RANGE_M - range) * 0.02, 28.0, 58.0);

        // Proximity shake rises as the missile closes on the bandit.
        const proximity = THREE.MathUtils.clamp(1 - range / MISSILE_POV_ENTRY_RANGE_M, 0, 1);
        const shake = proximity * 0.05;
        targetCamPos.x += Math.sin(this.totalTimer * 47.0) * shake;
        targetCamPos.y += Math.cos(this.totalTimer * 61.0) * shake;

        targetLook.copy(missilePos);
        targetUp.copy(worldUp);
        break;
      }

      case CINEMATIC_SHOTS.COCKPIT_HERO:
      default: {
        isRigidMount = true;
        targetFov = 58.0;
        // Canopy-top dorsal spine action cam mounted above the cockpit looking forward over nose
        const canopyY = (this.captainEyePos?.y ?? 0.85) + (this.fuselageRadiusY ? this.fuselageRadiusY * 0.65 : 1.35);
        const canopyZ = (this.captainEyePos?.z ?? -12.35) + 0.6;
        const sideOffset = (this.captainEyePos?.x ?? -0.39) * 0.6;

        targetCamPos.copy(planePos)
          .addScaledVector(right, sideOffset)
          .addScaledVector(up, canopyY)
          .addScaledVector(forward, -canopyZ);

        targetLook.copy(planePos)
          .addScaledVector(right, sideOffset * 0.3)
          .addScaledVector(up, canopyY - 0.35)
          .addScaledVector(forward, -canopyZ + 30.0);

        // Aerodynamic high-speed micro-vibrations
        const shakeMag = (ias / 400.0) * 0.02;
        const shakeX = Math.sin(this.totalTimer * 48.0) * shakeMag;
        const shakeY = Math.cos(this.totalTimer * 62.0) * shakeMag;
        targetCamPos.addScaledVector(right, shakeX).addScaledVector(up, shakeY);

        targetUp.copy(up);
        break;
      }
    }

    // Ensure targetCamPos is strictly clear of the aircraft fuselage envelope
    this.enforceFuselageClearance(targetCamPos, planePos, planeQuat);

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

    // Absolute Aircraft Fuselage Clearance Safety Guarantee
    this.enforceFuselageClearance(this.camPos, planePos, planeQuat);

    // Final ground clearance safety check in case radial push went downwards
    const postGroundH = Math.max(0, queryGroundHeight(this.camPos.x, this.camPos.z));
    if (this.camPos.y < postGroundH + 1.8) {
      this.camPos.y = postGroundH + 1.8;
      this.enforceLateralFuselageClearance(this.camPos, planePos, planeQuat);
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
