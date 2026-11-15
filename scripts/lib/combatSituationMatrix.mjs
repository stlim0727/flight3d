import { Euler, Quaternion, Vector3, MathUtils } from 'three';
import { AirToAirMissileSystem, BanditTarget } from '../../src/weapons/AirToAirMissileSystem.js';
import { MISSILE_TYPES } from '../../src/weapons/missileSpecs.js';
import { CombatDiagnosticEvents } from './combatDiagnosticEvents.mjs';

export const COMBAT_MATRIX_TIMESTEP_S = 1 / 120;
const dt = COMBAT_MATRIX_TIMESTEP_S;

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
 * - countermeasures: default inventory permission for both decoy types
 * - chaff / flares: independently override inventory permission
 * - threatResponseEnabled: warning/reaction override on the same flight fixture
 * - recordTrajectory: retain 5 Hz observed target/missile state, plus terminal state
 * - recordDiagnostics: retain transition events and feed the shared engagement analyzer
 * - recordDetail: retain 120 Hz seeker/guidance/energy state for diagnosis
 * - manualFlareAtSeconds: diagnostic intervention, dispense one flare without evasion
 * - flareObservationCutoffSeconds: diagnostic intervention, hide flares after this age
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
  chaff = countermeasures,
  flares = countermeasures,
  threatResponseEnabled = targetBehavior === 'evasive_ai',
  recordTrajectory = false,
  recordDetail = false,
  recordDiagnostics = false,
  manualFlareAtSeconds = null,
  flareObservationCutoffSeconds = null,
  rwr = true,
  tvc = true,
  terrainHeight = () => 0,
  maxSimTimeSec = 25,
}) {
  if (!Number.isFinite(rangeM) || rangeM <= 0 ||
      !Number.isFinite(shooterAltM) || !Number.isFinite(targetAltM) ||
      Math.abs(targetAltM - shooterAltM) > rangeM) {
    throw new RangeError('Range must be positive and at least the absolute altitude difference');
  }
  const inputs = { type, rangeM, aspectDeg, shooterAltM, targetAltM,
    shooterSpeedMps, targetSpeedMps, targetBehavior, offBoresightDeg,
    countermeasures, chaff, flares, threatResponseEnabled, recordTrajectory, recordDiagnostics,
    recordDetail, manualFlareAtSeconds, flareObservationCutoffSeconds, rwr, tvc, maxSimTimeSec };
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
      rwr,
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
        omega: -targetSpeedMps / orbitRadiusM,
        altitudeM: targetAltM,
      },
      evasion: false,
      rwr,
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
        omega: -targetSpeedMps / orbitRadiusM,
        altitudeM: targetAltM,
      },
      evasion: true,
      rwr,
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
        omega: -targetSpeedMps / orbitRadiusM,
        altitudeM: targetAltM,
      },
      evasion: false,
      rwr,
    });
  }

  // Keep warning/reaction and inventory independent for paired experiments.
  // The straight fixture has no flight controller and cannot react to warnings.
  if (threatResponseEnabled && !target.flight) {
    throw new TypeError('Threat response requires a physical flight target');
  }
  target.threatResponse.enabled = threatResponseEnabled;
  if (!flares) target.flare.remaining = 0;
  if (!chaff) target.chaff.remaining = 0;

  const specs = tvc
    ? MISSILE_TYPES
    : {
        ...MISSILE_TYPES,
        [type]: { ...MISSILE_TYPES[type], tvc: false },
      };

  const combat = new AirToAirMissileSystem({
    stations: [{ id: 'STA_TEST', type, position: [-5.04, 0.04, 2.45] }],
    specs,
    banditEvasion: threatResponseEnabled,
    banditRwr: rwr,
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
    world.position.addScaledVector(world.velocity, dt);
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
      inputs,
      launchState: null,
      defense: null,
      trajectory: null,
      diagnostics: null,
      detail: null,
      decoyTransferSeconds: [],
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

  const launchState = {
    elapsedSeconds: combat.elapsed,
    rangeM: world.position.distanceTo(target.position),
    shooterPosition: world.position.toArray(),
    targetPosition: target.position.toArray(),
    shooterVelocity: world.velocity.toArray(),
    targetVelocity: target.velocity.toArray(),
  };
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
      inputs,
      launchState: null,
      defense: null,
      trajectory: null,
      diagnostics: null,
      detail: null,
      decoyTransferSeconds: [],
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

  const diagnosticRecorder = recordDiagnostics ? new CombatDiagnosticEvents(missile, target) : null;
  let minSeparationM = Infinity;
  let terminal = 'timeout';
  let terminalSeconds = 0;
  let controlLimitedSec = 0;
  let maxMissileLateralG = 0;
  let maxTargetG = 0;
  let decoyTransfers = 0;
  let damageInflicted = 0;
  const defense = { chaffDispensed: 0, flaresDispensed: 0,
    firstWarningSeconds: null, firstConfirmedThreatSeconds: null,
    firstEvasionSeconds: null, evasionSeconds: 0 };
  const trajectory = recordTrajectory ? [] : null;
  const attitude = new Euler(0, 0, 0, 'YXZ');
  const sampleTrajectory = () => {
    if (!trajectory) return;
    const bankDeg = target.quaternion
      ? -MathUtils.radToDeg(attitude.setFromQuaternion(target.quaternion, 'YXZ').z) : null;
    trajectory.push({ seconds: terminalSeconds,
      targetPosition: target.position.toArray(), targetVelocity: target.velocity.toArray(),
      targetSpeedMps: target.velocity.length(), targetG: target.flight?.aero.gForce ?? null,
      targetBankDeg: bankDeg, warningPhase: target.threatResponse.phase,
      responseWeight: target.threatResponse.weight,
      missilePosition: missile.position.toArray(), missileSpeedMps: missile.velocity.length(),
      seekerState: missile.seeker?.state ?? null,
      seekerTargetType: missile.seeker?.target?.type ?? null,
    });
  };
  sampleTrajectory();
  const guidanceLossReasons = new Set();
  const seekerLossReasons = new Set();
  const detail = recordDetail ? [] : null;
  const decoyTransferSeconds = [];
  let manualFlareDispensed = false;
  const sampleDetail = () => {
    if (!detail || !missile.alive) return;
    const range = missile.position.distanceTo(target.position);
    const speed = missile.velocity.length();
    const los = target.position.clone().sub(missile.position);
    const losAngleDeg = speed > 1e-6 ? Math.acos(Math.max(-1, Math.min(1,
      missile.velocity.dot(los) / (speed * range)))) * (180 / Math.PI) : 180;
    const closing = range > 1e-6
      ? -los.dot(target.velocity.clone().sub(missile.velocity)) / range : 0;
    const seeker = missile.seeker;
    const estimateErrorM = seeker?.hasEstimate && seeker.target
      ? seeker.estimate.position.distanceTo(seeker.target.position) : null;
    // Estimate-referenced LOS: the angle the guidance gimbal check actually uses.
    // The bandit-referenced losAngleDeg above cannot reveal a decoy-induced gimbal
    // trigger because the seeker estimate follows the decoy, not the aircraft.
    const seekerEstimateRangeM = seeker?.hasEstimate
      ? seeker.estimate.position.distanceTo(missile.position) : null;
    const seekerLosAngleDeg = seekerEstimateRangeM > 1e-6 && speed > 1e-6
      ? Math.acos(Math.max(-1, Math.min(1, missile.velocity.dot(
        seeker.estimate.position.clone().sub(missile.position)) / (speed * seekerEstimateRangeM)
      ))) * (180 / Math.PI) : null;
    const flight = missile.flight;
    detail.push({
      seconds: terminalSeconds,
      targetPosition: target.position.toArray(),
      targetVelocity: target.velocity.toArray(),
      targetSpeedMps: target.velocity.length(),
      targetG: target.flight?.aero.gForce ?? null,
      warningPhase: target.threatResponse.phase,
      responseWeight: target.threatResponse.weight,
      missilePosition: missile.position.toArray(),
      missileVelocity: missile.velocity.toArray(),
      missileSpeedMps: speed,
      propellant: missile.propellant,
      rangeM: range,
      losAngleDeg,
      seekerLosAngleDeg,
      seekerEstimateRangeM,
      closingMps: closing,
      seekerState: seeker?.state ?? null,
      seekerTargetType: seeker?.target?.type ?? null,
      seekerTargetId: seeker?.target?.id ?? null,
      observationLossReason: seeker?.lastObservation?.lossReason ?? null,
      observationRangeM: seeker?.lastObservation?.rangeM ?? null,
      observationQuality: seeker?.lastObservation?.signalQuality ?? null,
      estimateErrorM,
      estimatePosition: seeker?.hasEstimate ? seeker.estimate.position.toArray() : null,
      guidanceActive: missile.lastGuidance?.active ?? null,
      guidanceReason: missile.lastGuidance?.reason ?? null,
      requestedLateralMps2: flight.requestedLateralMps2,
      availableLateralMps2: flight.availableLateralMps2,
      deliveredLateralMps2: flight.deliveredLateralMps2,
      dynamicPressurePa: flight.dynamicPressurePa,
      flares: combat.flares.map(flare => ({
        id: flare.id,
        age: flare.age,
        rangeM: flare.position.distanceTo(missile.position),
        emission: flare.infraredEmission,
        position: flare.position.toArray(),
      })),
    });
  };

  const maxSteps = Math.round(maxSimTimeSec / dt);
  for (let step = 0; step < maxSteps; step++) {
    const stepSeconds = (step + 1) * dt;
    if (manualFlareAtSeconds !== null && !manualFlareDispensed
      && stepSeconds + 1e-9 >= manualFlareAtSeconds) {
      const flare = target.flare.dispense(target.position, target.velocity, { sourceId: target.id });
      if (flare) {
        target.flareThreatIds.add('manual');
        combat.flares.push(flare);
        defense.flaresDispensed++;
        diagnosticRecorder?.recordEvent({ type: 'flare_dispense', flare, target,
          remaining: target.flare.remaining, intervention: true }, combat.elapsed);
      }
      manualFlareDispensed = true;
    }
    if (flareObservationCutoffSeconds !== null) {
      for (const flare of combat.flares) {
        if (flare.alive && flare.age + 1e-9 >= flareObservationCutoffSeconds) {
          diagnosticRecorder?.emit('diagnostic_intervention', terminalSeconds,
            { reason: 'flare_observation_cutoff', decoyId: diagnosticRecorder.id(flare) });
          flare.alive = false;
        }
      }
    }
    world.position.addScaledVector(world.velocity, dt);

    const events = combat.update(dt, world);
    terminalSeconds = stepSeconds;
    diagnosticRecorder?.observe(combat.elapsed, events);
    sampleDetail();
    const response = target.threatResponse;
    if (response.observedId !== null && defense.firstWarningSeconds === null) {
      defense.firstWarningSeconds = terminalSeconds;
    }
    if (response.confirmedId !== null && defense.firstConfirmedThreatSeconds === null) {
      defense.firstConfirmedThreatSeconds = terminalSeconds;
    }
    if (response.weight > 0.01) {
      if (defense.firstEvasionSeconds === null) defense.firstEvasionSeconds = terminalSeconds;
      defense.evasionSeconds += dt;
    }

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
      if (ev.type === 'chaff_dispense' && ev.target === target) defense.chaffDispensed++;
      if (ev.type === 'flare_dispense' && ev.target === target) defense.flaresDispensed++;
      if (ev.type === 'decoy_transfer') {
        decoyTransfers++;
        decoyTransferSeconds.push(terminalSeconds);
      }
      if (ev.type === 'damage' && ev.target === target) {
        damageInflicted = Math.max(damageInflicted, ev.damage);
      }
      if (ev.type === 'kill' && ev.target === target) {
        damageInflicted = 1.0;
        terminal = 'hit';
        break;
      }
    }
    // Fixed 5 Hz history plus terminal state; no simulation state is changed.
    if ((step + 1) % 24 === 0 || terminal === 'hit' || !target.alive || !missile.alive || step === maxSteps - 1) {
      sampleTrajectory();
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

  // Incorporate terminal closest approach recorded by the continuous fuze or final outcome
  const terminalCpa = missile.closestApproaches?.[target.id]?.distanceM;
  if (Number.isFinite(terminalCpa) && terminalCpa < minSeparationM) {
    minSeparationM = terminalCpa;
  }
  if (Number.isFinite(missile.finalOutcome?.distanceM) && missile.finalOutcome.distanceM < minSeparationM) {
    minSeparationM = missile.finalOutcome.distanceM;
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
    inputs,
    launchState,
    defense,
    trajectory,
    detail,
    decoyTransferSeconds,
    diagnostics: diagnosticRecorder?.finish(combat.elapsed) ?? null,
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
  rwr = true,
  tvc = true,
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
                rwr,
                tvc,
              }));
            }
          }
        }
      }
    }
  }
  return results;
}

/** Patterns for investigation, not proof of a defect or its physical cause. */
export function detectMissileAnomalies(results) {
  const findings = [];
  const stern = results.filter(r => r.type === 'AIM120C' &&
    r.rangeM >= 6000 && r.rangeM <= 8000 && r.aspectDeg <= 45 &&
    r.targetBehavior === 'evasive_ai' && r.countermeasures && r.launched);
  if (stern.length && stern.every(r => r.terminal === 'hit')) {
    findings.push({
      id: 'BVR_STERN_ALL_HIT', type: 'AIM120C', severity: 'investigate',
      title: 'All sampled defended BVR stern launches killed the target',
      description: 'Inspect warning, reaction, countermeasure and energy histories before assigning a cause.',
      count: stern.length, totalCohort: stern.length, sample: stern[0],
    });
  }
  for (const type of new Set(results.map(r => r.type))) {
    const cohort = results.filter(r => r.type === type && r.rangeM >= 400 &&
      r.rangeM <= 800 && r.aspectDeg === 90 && r.launched);
    // A live missile at timeout is unresolved, not a confirmed miss.
    if (cohort.length && cohort.every(r =>
      ['miss-expired', 'miss-ground', 'miss-other', 'detonation-non-lethal'].includes(r.terminal))) {
      findings.push({
        id: 'SHORT_RANGE_BEAM_ALWAYS_MISS', type, severity: 'investigate',
        title: `${type}: no kills in sampled short-range beam launches`,
        description: 'Inspect launch geometry, guidance, control limits and minimum engagement range; this pattern alone does not establish a defect.',
        count: cohort.length, totalCohort: cohort.length, hitRate: 0, sample: cohort[0],
      });
    }
  }
  // A non-lethal detonation is an outcome, not a dud. Range alone also cannot
  // establish an impossible hit; both remain visible in the report rows.
  return findings;
}
