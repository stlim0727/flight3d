import { Quaternion, Vector3, MathUtils } from 'three';
import { AirToAirMissileSystem, BanditTarget } from '../../src/weapons/AirToAirMissileSystem.js';
import { MISSILE_TYPES } from '../../src/weapons/missileSpecs.js';

const dt = 1 / 120;

/**
 * Runs a single parameterized air-to-air engagement scenario for F-16 combat.
 *
 * Parameters:
 * - type: 'AIM9X' | 'AIM120C'
 * - rangeM: initial distance between shooter and target in meters
 * - aspectDeg: target aspect angle in degrees
 *     0°: tail chase (shooter behind target)
 *     90°: beam / notch (target crossing perpendicularly)
 *     180°: head-on (target closing head-to-head)
 * - shooterAltM: altitude of shooter in meters
 * - targetAltM: altitude of target in meters
 * - shooterSpeedMps: true airspeed of shooter
 * - targetSpeedMps: true airspeed of target
 * - targetBehavior: 'straight' | 'orbit' | 'break_turn' | 'evasive_ai'
 * - offBoresightDeg: shooter heading offset relative to target line-of-sight
 * - countermeasures: boolean, whether bandit drops chaff/flares
 * - terrainHeight: optional terrain elevation function
 * - maxSimTimeSec: maximum simulation duration before timeout
 */
export function simulateCombatSituation({
  type = 'AIM9X',
  rangeM = 3000,
  aspectDeg = 0,
  shooterAltM = 3000,
  targetAltM = 3000,
  shooterSpeedMps = 250,
  targetSpeedMps = 200,
  targetBehavior = 'orbit',
  offBoresightDeg = 0,
  countermeasures = false,
  terrainHeight = () => 0,
  maxSimTimeSec = 25,
}) {
  const targetPos = new Vector3(0, targetAltM, 0);

  // Target base heading is along -Z (north).
  // 0° aspect: shooter is at +Z (behind target).
  // 180° aspect: shooter is at -Z (in front of target).
  // 90° aspect: shooter is at +X (beam).
  const aspectRad = MathUtils.degToRad(aspectDeg);
  const altDiff = targetAltM - shooterAltM;
  const horizontalDist = Math.sqrt(Math.max(0, rangeM * rangeM - altDiff * altDiff));

  const shooterOffsetX = Math.sin(aspectRad) * horizontalDist;
  const shooterOffsetZ = Math.cos(aspectRad) * horizontalDist;
  const shooterOffsetY = shooterAltM - targetAltM;

  const shooterPos = targetPos.clone().add(new Vector3(shooterOffsetX, shooterOffsetY, shooterOffsetZ));

  // Shooter pointing towards target, optionally offset by offBoresightDeg
  const toTarget = targetPos.clone().sub(shooterPos).normalize();
  const shooterDir = toTarget.clone();
  if (offBoresightDeg !== 0) {
    shooterDir.applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(offBoresightDeg));
  }
  const shooterQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), shooterDir);
  const shooterVel = shooterDir.clone().multiplyScalar(shooterSpeedMps);

  let target;
  if (targetBehavior === 'straight') {
    target = new BanditTarget({
      callsign: 'BANDIT-STRAIGHT',
      position: targetPos,
      velocity: new Vector3(0, 0, -targetSpeedMps),
      evasion: false,
    });
    target.velocity.set(0, 0, -targetSpeedMps);
    target.quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), target.velocity.clone().normalize());
  } else if (targetBehavior === 'break_turn') {
    const orbitRadiusM = 450;
    target = new BanditTarget({
      callsign: 'BANDIT-BREAK',
      position: targetPos,
      velocity: new Vector3(0, 0, -targetSpeedMps),
      orbit: {
        center: new Vector3(-orbitRadiusM, targetAltM, 0),
        radius: orbitRadiusM,
        angle: 0,
        omega: targetSpeedMps / orbitRadiusM,
        altitudeM: targetAltM,
      },
      evasion: false,
    });
  } else if (targetBehavior === 'evasive_ai') {
    const orbitRadiusM = 1000;
    target = new BanditTarget({
      callsign: 'BANDIT-AI',
      position: targetPos,
      velocity: new Vector3(0, 0, -targetSpeedMps),
      orbit: {
        center: new Vector3(-orbitRadiusM, targetAltM, 0),
        radius: orbitRadiusM,
        angle: 0,
        omega: targetSpeedMps / orbitRadiusM,
        altitudeM: targetAltM,
      },
      evasion: true,
    });
  } else {
    const orbitRadiusM = 1200;
    target = new BanditTarget({
      callsign: 'BANDIT-ORBIT',
      position: targetPos,
      velocity: new Vector3(0, 0, -targetSpeedMps),
      orbit: {
        center: new Vector3(-orbitRadiusM, targetAltM, 0),
        radius: orbitRadiusM,
        angle: 0,
        omega: targetSpeedMps / orbitRadiusM,
        altitudeM: targetAltM,
      },
      evasion: false,
    });
  }

  if (!countermeasures) {
    target.flare.remaining = 0;
    target.chaff.remaining = 0;
  }

  const combat = new AirToAirMissileSystem({
    stations: [{ id: 'STA_TEST', type, position: [-5.04, 0.04, 2.45] }],
    banditEvasion: targetBehavior === 'evasive_ai',
  });
  combat.addTarget(target);

  const world = {
    active: true,
    onGround: false,
    position: shooterPos.clone(),
    velocity: shooterVel.clone(),
    quaternion: shooterQuat.clone(),
    terrainHeight,
  };

  // Lock acquisition window (up to 1.5s = 180 steps)
  let locked = false;
  for (let i = 0; i < 180; i++) {
    const currentToTarget = target.position.clone().sub(world.position).normalize();
    const currentDir = currentToTarget.clone();
    if (offBoresightDeg !== 0) {
      currentDir.applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(offBoresightDeg));
    }
    world.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), currentDir);
    world.velocity.copy(currentDir).multiplyScalar(shooterSpeedMps);
    combat.update(dt, world);
    if (combat.lockedTarget && combat.lockProgress >= 1) {
      locked = true;
      break;
    }
  }

  if (!locked) {
    return {
      type,
      rangeM,
      aspectDeg,
      shooterAltM,
      targetAltM,
      targetBehavior,
      offBoresightDeg,
      countermeasures,
      launched: false,
      terminal: 'no-lock',
      terminalSeconds: 0,
      minSeparationM: Number(target.position.distanceTo(shooterPos).toFixed(2)),
      terminalSpeedMps: 0,
      controlLimitedSec: 0,
      maxMissileLateralG: 0,
      maxTargetG: 0,
      decoyTransfers: 0,
      damageInflicted: 0,
      guidanceLossReasons: ['no_lock'],
      seekerLossReasons: combat.targets[0] ? ['lock_not_acquired'] : [],
    };
  }

  const missile = combat.fire(world);
  if (!missile) {
    return {
      type,
      rangeM,
      aspectDeg,
      shooterAltM,
      targetAltM,
      targetBehavior,
      offBoresightDeg,
      countermeasures,
      launched: false,
      terminal: 'fire-failed',
      terminalSeconds: 0,
      minSeparationM: Number(target.position.distanceTo(shooterPos).toFixed(2)),
      terminalSpeedMps: 0,
      controlLimitedSec: 0,
      maxMissileLateralG: 0,
      maxTargetG: 0,
      decoyTransfers: 0,
      damageInflicted: 0,
      guidanceLossReasons: [combat.lastFireError || 'fire_failed'],
      seekerLossReasons: [],
    };
  }

  let minSeparationM = Infinity;
  let terminal = 'timeout';
  let terminalSeconds = 0;
  let controlLimitedSec = 0;
  let maxMissileLateralG = 0;
  let maxTargetG = 0;
  let decoyTransfers = 0;
  let damageInflicted = 0;
  const guidanceLossReasons = new Set();
  const seekerLossReasons = new Set();

  const maxSteps = Math.round(maxSimTimeSec / dt);
  for (let step = 0; step < maxSteps; step++) {
    world.position.addScaledVector(world.velocity, dt);

    const events = combat.update(dt, world);
    terminalSeconds = (step + 1) * dt;

    if (missile.alive) {
      const dist = missile.position.distanceTo(target.position);
      if (dist < minSeparationM) minSeparationM = dist;

      const flight = missile.flight;
      if (flight.requestedLateralMps2 > flight.availableLateralMps2 + 1e-4) {
        controlLimitedSec += dt;
      }
      const g = flight.deliveredLateralMps2 / 9.80665;
      if (g > maxMissileLateralG) maxMissileLateralG = g;

      if (!missile.lastGuidance?.active && missile.lastGuidance?.reason) {
        guidanceLossReasons.add(missile.lastGuidance.reason);
      }
      if (missile.seeker?.lastObservation?.lossReason) {
        seekerLossReasons.add(missile.seeker.lastObservation.lossReason);
      }
    }

    if (target.flight?.aero?.gForce && target.flight.aero.gForce > maxTargetG) {
      maxTargetG = target.flight.aero.gForce;
    }

    for (const ev of events) {
      if (ev.type === 'decoy_transfer') decoyTransfers++;
      if (ev.type === 'damage' && ev.target === target) {
        damageInflicted = Math.max(damageInflicted, ev.damage);
      }
      if (ev.type === 'kill' && ev.target === target) {
        damageInflicted = 1.0;
        terminal = 'hit';
        break;
      }
    }
    if (terminal === 'hit') break;

    if (!target.alive) {
      terminal = 'target-destroyed';
      break;
    }

    if (!missile.alive) {
      if (events.some(e => e.type === 'expire')) {
        terminal = 'miss-expired';
      } else if (events.some(e => e.type === 'detonation' && e.surface)) {
        terminal = 'miss-ground';
      } else if (events.some(e => e.type === 'detonation' && !e.surface)) {
        // Airburst fuze detonation that did not kill target
        terminal = 'detonation-non-lethal';
      } else {
        terminal = 'miss-other';
      }
      break;
    }
  }

  return {
    type,
    rangeM,
    aspectDeg,
    shooterAltM,
    targetAltM,
    targetBehavior,
    offBoresightDeg,
    countermeasures,
    launched: true,
    terminal,
    terminalSeconds: Number(terminalSeconds.toFixed(3)),
    minSeparationM: Number(minSeparationM.toFixed(2)),
    terminalSpeedMps: Number(missile.velocity.length().toFixed(1)),
    controlLimitedSec: Number(controlLimitedSec.toFixed(3)),
    maxMissileLateralG: Number(maxMissileLateralG.toFixed(1)),
    maxTargetG: Number(maxTargetG.toFixed(1)),
    decoyTransfers,
    damageInflicted: Number(damageInflicted.toFixed(3)),
    guidanceLossReasons: Array.from(guidanceLossReasons),
    seekerLossReasons: Array.from(seekerLossReasons),
  };
}

/**
 * Sweep an augmented situation matrix covering physical, kinematic,
 * tactical, sensor, and countermeasure parameter combinations.
 */
export function sweepCombatSituationMatrix({
  types = ['AIM9X', 'AIM120C'],
  ranges = [400, 800, 1500, 2500, 4000, 6000, 8000, 10000],
  aspects = [0, 45, 90, 135, 180],
  altitudes = [1500, 8000],
  behaviors = ['straight', 'orbit', 'break_turn', 'evasive_ai'],
  cms = [false, true],
} = {}) {
  const results = [];
  for (const type of types) {
    for (const rangeM of ranges) {
      for (const aspectDeg of aspects) {
        for (const targetBehavior of behaviors) {
          for (const countermeasures of cms) {
            for (const alt of altitudes) {
              results.push(simulateCombatSituation({
                type,
                rangeM,
                aspectDeg,
                shooterAltM: alt,
                targetAltM: alt,
                targetBehavior,
                countermeasures,
              }));
            }
          }
        }
      }
    }
  }
  return results;
}

/**
 * Analyzes engagement outcomes to detect missile anomalies:
 * - Always-hit anomalies (impossible/unrealistic hit conditions)
 * - Always-miss anomalies (conditions where missile unexpectedly fails)
 * - Hard boundaries (e.g. off-boresight rail lock cliff)
 * - Proximity fuze non-lethal detonations
 */
export function detectMissileAnomalies(results) {
  const anomalies = [];

  // Anomaly A: BVR Ghost Coast Always-Hit (AIM-120C at range >= 6500m with evasion & CM)
  const bvrCoastHits = results.filter(r =>
    r.type === 'AIM120C' &&
    r.rangeM >= 6000 &&
    r.rangeM <= 8000 &&
    r.targetBehavior === 'evasive_ai' &&
    r.countermeasures &&
    r.terminal === 'hit'
  );
  if (bvrCoastHits.length > 0) {
    anomalies.push({
      id: 'BVR_GHOST_COAST_ALWAYS_HIT',
      severity: 'high',
      title: 'BVR Motor Burnout Blindness (Always Hit Anomaly)',
      description: 'AIM-120C at ranges >= 6000m burns out beyond the bandit 4000m optical detection range. Bandit AI only checks active propellant plumes and lacks RWR radar threat detection, remaining completely oblivious and defenseless against coasting active radar missiles.',
      count: bvrCoastHits.length,
      sample: bvrCoastHits[0],
    });
  }

  // Anomaly B: Short-Range Beam Always-Miss (400m - 800m beam 90°)
  const shortBeamLaunches = results.filter(r =>
    r.rangeM <= 800 &&
    r.aspectDeg === 90 &&
    r.launched
  );
  const shortBeamHits = shortBeamLaunches.filter(r => r.terminal === 'hit');
  if (shortBeamLaunches.length > 0 && shortBeamHits.length === 0) {
    anomalies.push({
      id: 'SHORT_RANGE_BEAM_ALWAYS_MISS',
      severity: 'high',
      title: 'Aerodynamic Launch Inflexibility (Always Miss Anomaly at Beam 90°)',
      description: 'At short range (400-800m), crossing targets exceed line-of-sight rate. Because missile lateral G is purely aerodynamic (proportional to q = 0.5*rho*v^2) without thrust-vectoring in early boost, the missile can only pull ~8-10G, loses gimbal lock, and suffers a 0% hit rate.',
      count: shortBeamLaunches.length,
      hitRate: 0,
      sample: shortBeamLaunches[0],
    });
  }

  // Anomaly C: Non-Lethal Fuze Detonation
  const nonLethalDetonations = results.filter(r => r.terminal === 'detonation-non-lethal');
  if (nonLethalDetonations.length > 0) {
    anomalies.push({
      id: 'FUZE_BURST_NON_LETHAL_DUD',
      severity: 'medium',
      title: 'Proximity Burst Non-Lethal Dud (Damage without Splash)',
      description: 'Missile proximity fuze triggers at up to 14m, but lethal radius is only 5m. Detonations between 10m-14m inflict only 10-30% partial damage, destroying the missile while leaving the target airborne, logged as a miss.',
      count: nonLethalDetonations.length,
      sample: nonLethalDetonations[0],
    });
  }

  // Anomaly D: Extreme Range Hit Check (>= 10,000m)
  const extremeHits = results.filter(r => r.rangeM >= 10000 && r.terminal === 'hit');
  if (extremeHits.length > 0) {
    anomalies.push({
      id: 'EXTREME_RANGE_IMPOSSIBLE_HIT',
      severity: 'critical',
      title: 'Extreme Range Out-of-Envelope Hit',
      description: 'Missile achieved a hit beyond 10,000m where physical fuel or seeker envelope should have expired.',
      count: extremeHits.length,
      sample: extremeHits[0],
    });
  }

  return anomalies;
}
