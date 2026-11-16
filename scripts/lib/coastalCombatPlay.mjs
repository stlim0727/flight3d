import { Euler, MathUtils, Vector3 } from 'three';
import { createHeadlessSimulation } from '../../src/core/HeadlessSimulation.js';
import { Atmosphere } from '../../src/physics/Atmosphere.js';
import { AirToAirMissileSystem } from '../../src/weapons/AirToAirMissileSystem.js';
import { createAttackSkill } from '../../src/pilot/CombatSkills.js';
import {
  OBSERVATION_MODES,
  createContactObservation,
  createPilotObservation,
} from '../../src/pilot/ObservationContract.js';

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
export function runCoastalCombatPlay(config, progress = () => {}) {
  const dt = 1 / 120;
  const pilot = createHeadlessSimulation({ aircraftId: 'F16', airportId: 'coastal' });
  pilot.setPreset('cruise');
  pilot.euler = new Euler(); pilot.forward = new Vector3(); pilot.result = pilot._aeroResult;
  const terrainHeight = pilot.currentTerrain.getHeight.bind(pilot.currentTerrain);
  const combat = new AirToAirMissileSystem({ evasionSkill: config.skills.evasion.id,
    countermeasurePolicy: config.skills.countermeasure.id });
  const attack = createAttackSkill(config.skills.attack.id);
  const world = { active: true, onGround: false, position: pilot.position, velocity: pilot.linearVelocity,
    quaternion: pilot.quaternion, terrainHeight };
  combat.update(dt, world);
  combat.selectNextTarget();
  const initialState = { position: pilot.position.toArray(), velocity: pilot.linearVelocity.toArray(),
    targets: combat.targets.map(t => t.position.toArray()) };
  const shots = [], events = {}, samples = [];
  let contact = null, command = null, crashed = false, elapsedSeconds = 0, firstLockSeconds = null;
  for (let tick = 0; tick < Math.ceil(config.seconds * 120); tick++) {
    const time = tick * dt;
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
    if (pilot.isCrashed || pilot.position.y <= terrainHeight(pilot.position.x, pilot.position.z) + 1) { crashed = true; break; }
    // One unresolved shot at a time avoids wasting the loadout on a dying target.
    if (command?.fire && target?.alive && combat.lockedTarget === target && combat.lockProgress >= 1 &&
        combat.remaining && !shots.some(s => s.missile.alive)) {
      const missile = combat.fire(world);
      if (missile) shots.push({ missile, time, rangeM: target.position.distanceTo(pilot.position) });
    }
    for (const event of combat.update(dt, world)) events[event.type] = (events[event.type] ?? 0) + 1;
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
  const result = { variant: 'coastal-play', type: 'mixed-loadout', observationMode: OBSERVATION_MODES.LIMITED,
    skills: config.skills, initialState,
    elapsedSeconds, termination, crashed, firstLockSeconds, kills: combat.splashCount, remaining: combat.remaining,
    shots: shots.map(({ missile, ...shot }) => ({ ...shot, type: missile.typeId, locked: missile.launchLocked,
      unresolved: missile.alive, outcome: missile.finalOutcome })), events, samples };
  progress(1);
  return { results: [result], summary: [{ variant: result.variant, type: result.type,
    observationMode: OBSERVATION_MODES.LIMITED, total: 1,
    launched: shots.length, kills: result.kills, noLock: firstLockSeconds === null ? 1 : 0,
    noLaunch: shots.length === 0, crashed, elapsedSeconds, termination, remaining: combat.remaining,
    unresolved: shots.filter(s => s.missile.alive).length }] };
}
