import { Euler, MathUtils, Vector3 } from 'three';
import { createHeadlessSimulation } from '../../src/core/HeadlessSimulation.js';
import { ReplayRecorder } from '../../src/core/ReplayRecorder.js';
import { Atmosphere } from '../../src/physics/Atmosphere.js';
import { createSortie } from '../../src/replay/ReplayStore.js';
import { AirToAirMissileSystem } from '../../src/weapons/AirToAirMissileSystem.js';
import { analyzeCombatEngagement } from '../../src/weapons/engagementAnalysis.js';
import { createAttackSkill } from '../../src/pilot/CombatSkills.js';
import {
  OBSERVATION_MODES,
  createContactObservation,
  createPilotObservation,
} from '../../src/pilot/ObservationContract.js';

function classifyShotOutcome(missile, killedMissileIds) {
  if (missile.alive) return 'unresolved';
  if (killedMissileIds.has(missile.id) || missile.finalOutcome?.outcome === 'kill') return 'kill';
  const outcome = missile.finalOutcome?.outcome;
  const reason = missile.finalOutcome?.reason;
  if (outcome === 'survived_fuze_blast' || reason === 'fuze_burst') return 'survived_fuze_blast';
  if (outcome === 'ground_impact' || reason === 'surface_collision') return 'ground_impact';
  if (outcome === 'expired' || reason === 'life_expiry') return 'expired';
  return 'other';
}

function guideCoastalPilot(sim, { headingRad, altitudeM, speedMps }) {
  sim.euler.setFromQuaternion(sim.quaternion, 'YXZ');
  const forward = sim.forward.set(0, 0, -1).applyQuaternion(sim.quaternion);
  const currentHeading = Math.atan2(forward.x, -forward.z);
  const headingErr = Math.atan2(Math.sin(headingRad - currentHeading), Math.cos(headingRad - currentHeading));
  const aero = sim.aero;
  const g0 = Atmosphere.G0;
  const availableLoad = aero.qDyn * aero.wingArea * (aero.CL0_clean + aero.CLa * 12 * Math.PI / 180) / (aero.mass * g0);
  const bankLimit = MathUtils.radToDeg(Math.acos(1 / Math.max(1, Math.min(7, availableLoad))));
  const targetRollDeg = MathUtils.clamp(MathUtils.radToDeg(headingErr) * 2.5, -bankLimit, bankLimit);
  const rollDeg = -MathUtils.radToDeg(sim.euler.z);
  const rollRate = sim.angularVelocity.z;
  const desiredRollRate = -MathUtils.clamp(MathUtils.degToRad(targetRollDeg - rollDeg) * 2.5, -1.8, 1.8);
  const rollAcc = (desiredRollRate - rollRate) * 4.5;
  const qSb = Math.max(1, aero.qDyn * aero.wingArea * aero.wingspan);
  const pHat = rollRate * aero.wingspan / (2 * Math.max(10, aero.tas));
  const coeffRoll = -aero.Ixx * rollAcc / qSb;
  const aileron = (coeffRoll - aero.Cl_b * aero.beta - Math.abs(aero.Cl_p) * pHat) / (aero.Cl_da * 1.05 * MathUtils.degToRad(20));
  sim.controls.setVirtualInput('aileron', MathUtils.clamp(aileron, -1, 1));

  const altErr = altitudeM - sim.position.y;
  const hSpeed = Math.max(30, Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z));
  const tas = Math.max(30, aero.tas);
  const targetVz = MathUtils.clamp(altErr * 0.15, -35, 35);
  const gamma = Math.atan2(sim.linearVelocity.y, hSpeed);
  const bank = -sim.euler.z;
  const vertAcc = MathUtils.clamp((targetVz - sim.linearVelocity.y) * 1.0, -15, 15);
  const load = MathUtils.clamp((Math.cos(gamma) + vertAcc / g0) / Math.max(0.2, Math.cos(bank)), -1.5, 7);
  const requiredCl = load * aero.mass * g0 / Math.max(1, aero.qDyn * aero.wingArea);
  const targetAlpha = MathUtils.clamp((requiredCl - aero.CL0_clean) / aero.CLa, -6 * Math.PI / 180, 14 * Math.PI / 180);
  const desiredPitchRate = (load - Math.cos(bank) * Math.cos(gamma)) * g0 / tas + (targetAlpha - aero.alpha) * 2.5;
  const desiredMoment = aero.Iyy * (desiredPitchRate - sim.angularVelocity.x) * 6.0;
  const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
  const qHat = sim.angularVelocity.x * aero.meanChord / (2 * tas);
  const requiredCm = desiredMoment / qSc;
  const effectiveElevRad = (requiredCm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de;
  const stickElev = (effectiveElevRad - MathUtils.degToRad(aero.pitchTrim) * 0.25) / MathUtils.degToRad(20);
  sim.controls.setVirtualInput('elevator', MathUtils.clamp(stickElev, -0.9, 0.9));

  const density = Atmosphere.getConditions(sim.position.y).densityRatio;
  const targetIas = Atmosphere.msToKnots(speedMps * Math.sqrt(density));
  const iasKnots = Atmosphere.msToKnots(aero.ias);
  sim.controls.setVirtualInput('throttle', MathUtils.clamp(0.55 + (targetIas - iasKnots) * 0.025, 0.05, 1.0));
  sim.controls.setVirtualInput('rudder', MathUtils.clamp(aero.beta * 2 + sim.angularVelocity.y * 0.6, -0.6, 0.6));
}

/** Actual F16/Coastal/Cruise plant and weapons, with an idealized contact sensor.
 * Contact positions are sampled at 5 Hz within 12 km and terrain line of sight.
 * This sensor is an experiment assumption, not a modeled F16 radar/visual system.
 */
export function runCoastalCombatPlay(config, progress = () => {}, { setupEncounter } = {}) {
  const dt = 1 / 120;
  const pilot = createHeadlessSimulation({ aircraftId: 'F16', airportId: 'coastal' });
  pilot.setPreset('cruise');
  pilot.euler = new Euler(); pilot.forward = new Vector3(); pilot.result = pilot._aeroResult;
  const terrainHeight = pilot.currentTerrain.getHeight.bind(pilot.currentTerrain);
  const combat = new AirToAirMissileSystem({
    evasionSkill: config.skills.evasion.id,
    countermeasurePolicy: config.skills.countermeasure.id,
    ...(config.banditCount !== undefined ? { banditCount: config.banditCount } : {}),
  });
  const attack = createAttackSkill(config.skills.attack.id);
  const world = { active: true, onGround: false, position: pilot.position, velocity: pilot.linearVelocity,
    quaternion: pilot.quaternion, terrainHeight };
  combat.update(dt, world);
  setupEncounter?.({ combat, world });
  combat.selectNextTarget();
  const initialState = { position: pilot.position.toArray(), velocity: pilot.linearVelocity.toArray(),
    targets: combat.targets.map(t => t.position.toArray()) };
  const caseId = 'coastal-0';
  const recorder = config.recordDiagnostics ? new ReplayRecorder() : null;
  if (recorder) recorder.start({ airport: 'coastal', aircraft: 'F16', scenario: 'cruise' });
  const localTargetIds = new Map();
  const localMissileIds = new Map();
  const trackMissileIds = {};
  const localTargetId = rawId => {
    if (!localTargetIds.has(rawId)) localTargetIds.set(rawId, localTargetIds.size + 1);
    return localTargetIds.get(rawId);
  };
  const localMissileId = rawId => {
    if (!localMissileIds.has(rawId)) {
      const id = localMissileIds.size + 1;
      localMissileIds.set(rawId, id);
      trackMissileIds[id] = rawId & 255;
    }
    return localMissileIds.get(rawId);
  };
  const activeLifeByTarget = new Map();
  const lifeCounts = new Map();
  const targetLifecycles = [];
  const ensureLifecycle = (target, timeSec) => {
    if (!target || !target.alive) return null;
    if (activeLifeByTarget.has(target.id)) return activeLifeByTarget.get(target.id);
    const targetId = localTargetId(target.id);
    const lifeIndex = (lifeCounts.get(targetId) ?? 0) + 1;
    lifeCounts.set(targetId, lifeIndex);
    const life = {
      targetId,
      lifeIndex,
      spawnTimeSec: timeSec,
      killedTimeSec: null,
      killedByMissileId: null,
      peakDamage: target.damage ?? 0,
      flaresDispensed: 0,
      chaffDispensed: 0,
      shotsAtTarget: 0,
      outcome: 'survived',
    };
    activeLifeByTarget.set(target.id, life);
    targetLifecycles.push(life);
    return life;
  };
  for (const t of combat.targets) ensureLifecycle(t, 0);

  const initialAltitudeM = pilot.position.y;
  const initialSpeedMps = pilot.linearVelocity.length();
  const initialSpecificEnergyM = initialAltitudeM + (initialSpeedMps ** 2) / (2 * Atmosphere.G0);
  let minAltitudeM = initialAltitudeM, maxAltitudeM = initialAltitudeM;
  let minSpeedMps = initialSpeedMps, maxSpeedMps = initialSpeedMps;
  let controlLossEvents = 0, controlLossTotalSeconds = 0, maxRecoverySeconds = 0;
  let controlLossStartSec = null;

  const shots = [], events = {}, samples = [];
  const killedMissileIds = new Set();
  let contact = null, command = null, crashed = false, elapsedSeconds = 0, firstLockSeconds = null;
  for (let tick = 0; tick < Math.ceil(config.seconds * 120); tick++) {
    const time = tick * dt;
    for (const t of combat.targets) {
      if (t.alive) {
        const life = ensureLifecycle(t, time);
        if (life) life.peakDamage = Math.max(life.peakDamage, t.damage ?? 0);
      } else if (activeLifeByTarget.has(t.id)) {
        const life = activeLifeByTarget.get(t.id);
        life.outcome = 'terrain_crash';
        activeLifeByTarget.delete(t.id);
      }
    }
    let target = combat.selectedTarget();
    if (!target?.alive) { combat.selectNextTarget(); target = combat.selectedTarget(); contact = null; command = null; }
    if (tick % 24 === 0) {
      contact = null;
      if (target?.alive && target.position.distanceTo(pilot.position) <= 12000) {
        let visible = true;
        for (let i = 1; i < 20; i++) {
          const p = pilot.position.clone().lerp(target.position, i / 20);
          if (p.y <= terrainHeight(p.x, p.z)) { visible = false; break; }
        }
        if (visible) {
          const rangeM = target.position.distanceTo(pilot.position);
          contact = createContactObservation({
            x: target.position.x,
            y: target.position.y,
            z: target.position.z,
            rangeM,
            observedAt: time,
            ttlSeconds: 0.45,
            quality: Math.max(0.2, Math.min(1, 1 - rangeM / 15000)),
            status: 'active',
          });
        }
      }
      const forward = new Vector3(0, 0, -1).applyQuaternion(pilot.quaternion);
      command = attack.update(createPilotObservation({
        mode: OBSERVATION_MODES.LIMITED,
        time,
        own: {
          x: pilot.position.x,
          y: pilot.position.y,
          z: pilot.position.z,
          headingRad: Math.atan2(forward.x, -forward.z),
        },
        contact,
        locked: Boolean(target?.alive && combat.lockedTarget === target && combat.lockProgress >= 1),
        speedMps: 250,
      }));
    }
    if (command) guideCoastalPilot(pilot, command);
    pilot.integratePhysics(dt);
    if (![...pilot.position.toArray(), ...pilot.linearVelocity.toArray()].every(Number.isFinite)) throw new Error('Non-finite pilot state');
    world.onGround = Boolean(pilot.telemetry.onGround);
    elapsedSeconds = (tick + 1) * dt;
    const altM = pilot.position.y;
    const spdMps = pilot.linearVelocity.length();
    if (altM < minAltitudeM) minAltitudeM = altM;
    if (altM > maxAltitudeM) maxAltitudeM = altM;
    if (spdMps < minSpeedMps) minSpeedMps = spdMps;
    if (spdMps > maxSpeedMps) maxSpeedMps = spdMps;
    const outOfControl = Boolean(
      pilot.telemetry?.isStalled || pilot.telemetry?.pilot?.isGLOC || pilot.telemetry?.pilot?.isGLoc,
    );
    if (outOfControl) {
      if (controlLossStartSec === null) {
        controlLossEvents += 1;
        controlLossStartSec = time;
      }
      controlLossTotalSeconds += dt;
    } else if (controlLossStartSec !== null) {
      maxRecoverySeconds = Math.max(maxRecoverySeconds, elapsedSeconds - controlLossStartSec);
      controlLossStartSec = null;
    }
    if (pilot.isCrashed || pilot.position.y <= terrainHeight(pilot.position.x, pilot.position.z) + 1) { crashed = true; break; }
    // One unresolved shot at a time avoids wasting the loadout on a dying target.
    if (command?.fire && target?.alive && combat.lockedTarget === target && combat.lockProgress >= 1 &&
        combat.remaining && !shots.some(s => s.missile.alive)) {
      const missile = combat.fire(world);
      if (missile) {
        const life = ensureLifecycle(target, time);
        if (life) life.shotsAtTarget += 1;
        shots.push({
          shotIndex: shots.length,
          missile,
          missileId: localMissileId(missile.id),
          targetId: localTargetId(target.id),
          targetLifeIndex: life?.lifeIndex ?? 1,
          duplicateFollowUp: Boolean((life?.shotsAtTarget ?? 1) > 1 || !target.alive),
          time,
          rangeM: target.position.distanceTo(pilot.position),
        });
      }
    }
    const stepEvents = combat.update(dt, world);
    if (recorder) recorder.update(dt, pilot.telemetry, pilot.quaternion, combat);
    for (const event of stepEvents) {
      events[event.type] = (events[event.type] ?? 0) + 1;
      if (event.type === 'flare_dispense' && event.target) {
        const life = activeLifeByTarget.get(event.target.id);
        if (life) life.flaresDispensed += 1;
      } else if (event.type === 'chaff_dispense' && event.target) {
        const life = activeLifeByTarget.get(event.target.id);
        if (life) life.chaffDispensed += 1;
      } else if (event.type === 'kill' && event.target) {
        if (event.missile?.id != null) killedMissileIds.add(event.missile.id);
        const life = activeLifeByTarget.get(event.target.id);
        if (life) {
          life.outcome = 'killed';
          life.killedTimeSec = elapsedSeconds;
          life.killedByMissileId = event.missile?.id != null ? localMissileId(event.missile.id) : null;
          life.peakDamage = Math.max(life.peakDamage, event.target.damage ?? 0);
          activeLifeByTarget.delete(event.target.id);
        }
      }
      if (recorder) recorder.recordCombatEvent({ ...event, timeSec: elapsedSeconds });
    }
    if (combat.lockProgress >= 1 && firstLockSeconds === null) firstLockSeconds = time;
    if (tick % 120 === 0) {
      if (config.recordTrajectory) samples.push({ time, position: pilot.position.toArray(), lock: combat.lockProgress,
        contact: contact ? { ...contact } : null, command: command ? { ...command } : null,
        remaining: combat.remaining, kills: combat.splashCount });
      progress(Math.min(time / config.seconds, 0.99));
    }
    if (!combat.remaining && !shots.some(s => s.missile.alive)) break;
  }
  attack.abort();
  const termination = crashed ? 'pilot-crash' : combat.remaining ? 'simulation-limit'
    : shots.some(s => s.missile.alive) ? 'simulation-limit' : 'loadout-resolved';
  const serializedShots = shots.map(({ missile, ...shot }) => ({
    ...shot,
    type: missile.typeId,
    locked: missile.launchLocked,
    unresolved: missile.alive,
    outcomeCategory: classifyShotOutcome(missile, killedMissileIds),
    outcome: missile.finalOutcome,
  }));
  const shotBreakdown = {
    noLockCount: firstLockSeconds === null ? 1 : 0,
    noLaunch: serializedShots.length === 0,
    lockedLaunches: serializedShots.filter(s => s.locked).length,
    unlockedLaunches: serializedShots.filter(s => !s.locked).length,
    duplicateFollowUpShots: serializedShots.filter(s => s.duplicateFollowUp).length,
    kills: serializedShots.filter(s => s.outcomeCategory === 'kill').length,
    survivedFuzeBlasts: serializedShots.filter(s => s.outcomeCategory === 'survived_fuze_blast').length,
    groundImpacts: serializedShots.filter(s => s.outcomeCategory === 'ground_impact').length,
    expiredMisses: serializedShots.filter(s => s.outcomeCategory === 'expired').length,
    unresolved: serializedShots.filter(s => s.outcomeCategory === 'unresolved').length,
  };
  const uniqueOpponentsKilled = new Set(targetLifecycles.filter(l => l.outcome === 'killed').map(l => l.targetId)).size;
  const finalAltitudeM = pilot.position.y;
  const finalSpeedMps = pilot.linearVelocity.length();
  const finalSpecificEnergyM = finalAltitudeM + (finalSpeedMps ** 2) / (2 * Atmosphere.G0);
  const metrics = {
    survived: !crashed,
    crashed,
    elapsedSeconds,
    kills: combat.splashCount,
    uniqueOpponentsKilled,
    uniqueOpponentsTotal: combat.targets.length,
    selfDamage: {
      structuralDamage: pilot.telemetry?.structuralDamage ?? 0,
      gLocCount: pilot.telemetry?.pilot?.glocIncidents ?? pilot.telemetry?.pilot?.gLocCount ?? 0,
      bodyDamagedParts: Object.values(pilot.telemetry?.bodyDamage ?? {}).filter(v => v && v !== 'normal').length,
      gearDamagedParts: Object.values(pilot.telemetry?.gearDamage ?? {}).filter(v => v && v !== 'normal').length,
    },
    expenditure: {
      missilesFired: serializedShots.length,
      missilesRemaining: combat.remaining,
      banditFlaresDispensed: events.flare_dispense ?? 0,
      banditChaffDispensed: events.chaff_dispense ?? 0,
    },
    energyAndAltitude: {
      initialAltitudeM,
      finalAltitudeM,
      minAltitudeM,
      maxAltitudeM,
      initialSpeedMps,
      finalSpeedMps,
      minSpeedMps,
      maxSpeedMps,
      initialSpecificEnergyM,
      finalSpecificEnergyM,
      specificEnergyDeltaM: finalSpecificEnergyM - initialSpecificEnergyM,
    },
    controlLoss: {
      controlLossEvents,
      controlLossTotalSeconds,
      maxRecoverySeconds,
    },
  };
  let diagnostics = null;
  if (recorder) {
    if (crashed) {
      recorder.markCrash(pilot.crashResult ?? { type: 'terrain', speedKnots: pilot.telemetry?.iasKnots ?? 0 });
    }
    const track = recorder.finish();
    const sortie = track ? createSortie({
      label: 'F16 · coastal · combat',
      reason: termination,
      durationSec: elapsedSeconds,
      metadata: track.metadata,
    }, track) : null;
    const analysis = track ? analyzeCombatEngagement(sortie ?? track) : null;
    diagnostics = { caseId, trackMissileIds, analysis, sortie };
  }
  const result = { caseId, variant: 'coastal-play', type: 'mixed-loadout', observationMode: OBSERVATION_MODES.LIMITED,
    skills: config.skills, initialState,
    elapsedSeconds, termination, crashed, firstLockSeconds, kills: combat.splashCount,
    uniqueOpponentsKilled, remaining: combat.remaining,
    shots: serializedShots, shotBreakdown, targetLifecycles, metrics, events, samples, diagnostics };
  progress(1);
  return { results: [result], summary: [{ variant: result.variant, type: result.type,
    observationMode: OBSERVATION_MODES.LIMITED, caseIds: [caseId], total: 1,
    launched: serializedShots.length, kills: result.kills, uniqueOpponentsKilled,
    noLock: shotBreakdown.noLockCount, noLaunch: shotBreakdown.noLaunch,
    crashed, elapsedSeconds, termination, remaining: combat.remaining,
    unresolved: shotBreakdown.unresolved, shotBreakdown, metrics }] };
}
