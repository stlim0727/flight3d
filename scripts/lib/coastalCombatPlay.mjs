import { Euler, Vector3 } from 'three';
import { createHeadlessSimulation } from '../../src/core/HeadlessSimulation.js';
import { BanditFlightModel } from '../../src/weapons/BanditFlightModel.js';
import { AirToAirMissileSystem } from '../../src/weapons/AirToAirMissileSystem.js';
import { createAttackSkill } from '../../src/pilot/CombatSkills.js';

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
        if (visible) contact = { x: target.position.x, y: target.position.y, z: target.position.z,
          rangeM: target.position.distanceTo(pilot.position) };
      }
      const forward = new Vector3(0, 0, -1).applyQuaternion(pilot.quaternion);
      command = attack.update({ own: { x: pilot.position.x, y: pilot.position.y, z: pilot.position.z,
        headingRad: Math.atan2(forward.x, -forward.z) }, contact,
      locked: Boolean(target?.alive && combat.lockedTarget === target && combat.lockProgress >= 1), speedMps: 250 });
    }
    if (command) {
      BanditFlightModel.prototype.guide.call(pilot, command.headingRad, command.altitudeM, command.speedMps);
      pilot.controls.setVirtualInput('elevator', pilot.aero.elevator);
      pilot.controls.setVirtualInput('rudder', pilot.aero.rudder);
    }
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
  const result = { variant: 'coastal-play', type: 'mixed-loadout', skills: config.skills, initialState,
    elapsedSeconds, termination, crashed, firstLockSeconds, kills: combat.splashCount, remaining: combat.remaining,
    shots: shots.map(({ missile, ...shot }) => ({ ...shot, type: missile.typeId, locked: missile.launchLocked,
      unresolved: missile.alive, outcome: missile.finalOutcome })), events, samples };
  progress(1);
  return { results: [result], summary: [{ variant: result.variant, type: result.type, total: 1,
    launched: shots.length, kills: result.kills, noLock: firstLockSeconds === null ? 1 : 0,
    noLaunch: shots.length === 0, crashed, elapsedSeconds, termination, remaining: combat.remaining,
    unresolved: shots.filter(s => s.missile.alive).length }] };
}
