/** Renderer-free, deterministic pilot experiment; not a browser/UI acceptance test. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3, Euler } from 'three';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { BanditFlightModel } from '../src/weapons/BanditFlightModel.js';
import { AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { evaluateSeekerObservation } from '../src/weapons/MissileSeeker.js';
const dir = process.env.ARTIFACT_DIR || '.cache/cruise-combat';
mkdirSync(dir, { recursive: true });
const results = [];
const dt = 1 / 120;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());

function save(status = 'running', error = null) {
  const metadata = { status, error, commit, dirty, dt, simulationSeconds: 100, wallSeconds: (performance.now() - started) / 1000 };
  writeFileSync(`${dir}/report.json`, JSON.stringify({ ...metadata, results }, null, 2));
  // A small versioned record excludes the per-second trajectory samples.
  writeFileSync(`${dir}/summary.json`, JSON.stringify({ ...metadata,
    results: results.map(({ samples, missileSamples, ...r }) => ({ ...r,
      minSampledRangeM: Math.min(...samples.map(s => s.rangeM ?? Infinity)),
      maxSampledLock: Math.max(...samples.map(s => s.lock)),
    })) }, null, 2));
}

export function guidePlayer(pilot, target, commandedSpeed) {
  const heading = Math.atan2(target.position.x - pilot.position.x, -(target.position.z - pilot.position.z));
  const command = BanditFlightModel.prototype.computeGuidance.call(
    pilot, heading, Math.max(750, target.position.y), commandedSpeed);
  for (const axis of ['elevator', 'aileron', 'rudder', 'throttle']) {
    pilot.controls.setVirtualInput(axis, command[axis]);
  }
}

export function experiment(policy, countermeasures, commandedSpeed, { maxSeconds = 100 } = {}) {
  assert.ok(['locked', 'close-locked', 'near-locked'].includes(policy));
  assert.ok(Number.isFinite(commandedSpeed) && commandedSpeed > 0);
  assert.ok(Number.isFinite(maxSeconds) && maxSeconds > 0);
  // Production player integrator, controls and preset; only rendering is omitted.
  const pilot = createHeadlessSimulation({ aircraftId: 'F16', airportId: 'coastal' });
  pilot.setPreset('cruise');
  const terrainHeight = pilot.currentTerrain.getHeight.bind(pilot.currentTerrain);
  // Reuse the existing force-model pursuit controller through virtual controls.
  pilot.euler = new Euler();
  pilot.forward = new Vector3();
  pilot.result = pilot._aeroResult;
  const combat = new AirToAirMissileSystem();
  const world = { active: true, onGround: false, position: pilot.position, velocity: pilot.linearVelocity,
    quaternion: pilot.quaternion, terrainHeight };
  combat.update(dt, world);
  const initial = { position: pilot.position.toArray(), velocity: pilot.linearVelocity.toArray(),
    quaternion: pilot.quaternion.toArray(),
    targets: combat.targets.map(t => ({ callsign: t.callsign, position: t.position.toArray(),
      observation: evaluateSeekerObservation(combat.nextMissileType(), world, t, world, 28) })) };
  const shots = [], events = {}, samples = [], transitions = [], missileSamples = [];
  let crashed = false, minClearanceM = Infinity, firstLockSeconds = null, launchState = null;
  let lastPhase = null;
  for (let tick = 0; tick < maxSeconds * 120; tick++) {
    const time = tick * dt;
    if (!countermeasures) for (const t of combat.targets) { t.flare.remaining = 0; t.chaff.remaining = 0; }
    let target = combat.selectedTarget();
    if (!target) { combat.selectNextTarget(); target = combat.selectedTarget(); }
    if (target) {
      // An instrumented pursuit pilot: truth is used only for steering, never sensor/guidance override.
      guidePlayer(pilot, target, commandedSpeed);
    }
    pilot.integratePhysics(dt);
    world.onGround = Boolean(pilot.telemetry.onGround);
    const clearance = pilot.position.y - Math.max(0, terrainHeight(pilot.position.x, pilot.position.z));
    minClearanceM = Math.min(minClearanceM, clearance);
    assert.ok([...pilot.position.toArray(), ...pilot.linearVelocity.toArray(), ...pilot.quaternion.toArray()].every(Number.isFinite));
    if (clearance <= 1 || pilot.isCrashed) { crashed = true; break; }
    const locked = Boolean(combat.lockedTarget?.alive && combat.lockProgress >= 1);
    if (locked && firstLockSeconds === null) firstLockSeconds = time;
    const rangeLimitM = policy === 'locked' ? Infinity : policy === 'close-locked' ? 2500 : 1500;
    const ready = locked && combat.lockedTarget.position.distanceTo(pilot.position) <= rangeLimitM;
    // Isolate one locked IR shot; a second shot at the same soon-dead target
    // would turn a successful first shot into a misleading extra 'miss'.
    if (ready && combat.remaining && time < 75 && shots.length === 0) {
      const m = combat.fire(world);
      if (m) {
        assert.equal(m.launchLocked, true);
        launchState = { position: pilot.position.toArray(), velocity: pilot.linearVelocity.toArray(),
          quaternion: pilot.quaternion.toArray(), targetPosition: target.position.toArray(),
          targetVelocity: target.velocity.toArray(), targetQuaternion: target.quaternion.toArray(),
          targetAspectDeg: Math.acos(Math.max(-1, Math.min(1, new Vector3(0, 0, 1).applyQuaternion(target.quaternion)
            .dot(pilot.position.clone().sub(target.position).normalize())))) * 180 / Math.PI,
          time, rangeM: target.position.distanceTo(pilot.position),
          observation: evaluateSeekerObservation(m.spec, world, target, world, m.spec.seekerFovDeg) };
        shots.push({ missile: m, launchTime: time, type: m.typeId, locked: m.launchLocked,
          rangeM: target?.position.distanceTo(pilot.position), states: {}, guidance: {},
          target, firstTrackTime: null, controlLimitedSeconds: 0, decoyTransferEventCount: 0, transferEvents: [] });
      }
    }
    for (const e of combat.update(dt, world)) {
      events[e.type] = (events[e.type] || 0) + 1;
      if (e.type === 'decoy_transfer') { const shot = shots.find(s => s.missile === e.missile); if (shot) {
        // These are confirmed transitions on current main; one event is not
        // necessarily a successful escape or an independent engagement.
        shot.decoyTransferEventCount++;
        shot.transferEvents.push({ time, fromType: e.prevTarget?.type, toType: e.decoyType,
          fromId: e.prevTarget?.id, toId: e.decoy?.id });
      } }
    }
    for (const shot of shots) {
      const m = shot.missile;
      const phase = `${m.seeker.state}:${m.seeker.target?.type ?? 'none'}:${m.lastGuidance.reason ?? 'active'}`;
      const phaseChanged = phase !== lastPhase;
      if (phaseChanged || tick % 24 === 0 || !m.alive) {
        const los = shot.target.position.clone().sub(m.position), range = los.length();
        const sample = { time, sinceLaunch: time - shot.launchTime, phase, alive: m.alive,
          rangeM: range, missileSpeedMps: m.velocity.length(), propellant: m.propellant,
          losAngleDeg: Math.acos(Math.max(-1, Math.min(1, m.velocity.dot(los)
            / Math.max(1e-9, m.velocity.length() * range)))) * 180 / Math.PI,
          requestedMps2: m.flight.requestedLateralMps2, availableMps2: m.flight.availableLateralMps2,
          qBarPa: m.flight.dynamicPressurePa, observation: m.seeker.lastObservation,
          targetPosition: shot.target.position.toArray(), missilePosition: m.position.toArray() };
        missileSamples.push(sample);
        if (phaseChanged) transitions.push(sample);
        lastPhase = phase;
      }
      if (!m.alive) continue;
      shot.states[m.seeker.state] = (shot.states[m.seeker.state] || 0) + dt;
      if (m.seeker.state === 'track' && shot.firstTrackTime === null) shot.firstTrackTime = time;
      // lastObservation can be retained while searching, so don't label it a
      // fresh successful observation. Record actual guidance commands instead.
      const reason = m.lastGuidance.active ? 'active' : m.lastGuidance.reason || 'inactive';
      shot.guidance[reason] = (shot.guidance[reason] || 0) + dt;
      if (m.flight.requestedLateralMps2 > m.flight.availableLateralMps2 + 1e-6) shot.controlLimitedSeconds += dt;
    }
    if (tick % 120 === 0) samples.push({ time, rangeM: target?.position.distanceTo(pilot.position),
      lock: combat.lockProgress, observation: target ? evaluateSeekerObservation(combat.nextMissileType() || combat.specs.AIM9X, world, target, world, 28) : null,
      altitudeM: pilot.position.y, speedMps: pilot.linearVelocity.length() });
    if (shots.length && !shots[0].missile.alive) break;
  }
  const serialized = shots.map(({ missile: m, target, ...shot }) => ({ ...shot, outcome: m.finalOutcome,
    alive: m.alive, closest: Object.values(m.closestApproaches), terminalSpeedMps: m.velocity.length() }));
  const terminal = !shots.length ? crashed ? 'pilot-crash-before-launch' : 'withheld-no-lock-or-range'
    : shots[0].missile.alive ? 'unresolved' : combat.splashCount > 0 ? 'kill'
      : shots[0].missile.finalOutcome?.reason === 'fuze_burst' ? 'nonlethal-burst'
        : shots[0].missile.finalOutcome?.reason ?? 'other';
  return { policy, countermeasures, commandedSpeed, initial, launchState, firstLockSeconds,
    terminal, shots: serialized, events, samples, transitions, missileSamples,
    crashed, minClearanceM, kills: combat.splashCount, remaining: combat.remaining,
    targets: combat.targets.map(t => ({ callsign: t.callsign, alive: t.alive, damage: t.damage, damageState: t.damageState })) };
}

const started = performance.now();
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
try {
save();
for (const speed of [Math.hypot(96, 49), 180, 250]) {
  for (const countermeasures of [true, false]) {
    for (const policy of ['locked', 'close-locked', 'near-locked']) {
      const r = experiment(policy, countermeasures, speed);
      results.push(r);
      save();
      console.log(JSON.stringify({ policy, countermeasures, speed, terminal: r.terminal, shots: r.shots.length,
        locked: r.shots.filter(s => s.locked).length, bursts: r.shots.filter(s => s.outcome?.reason === 'fuze_burst').length,
        kills: r.kills, decoyEvents: r.shots.reduce((n,s) => n + s.decoyTransferEventCount, 0), crashed: r.crashed }));
    }
  }
}
assert.equal(results.length, 18);
for (const row of results.filter(r => r.countermeasures)) {
  const control = results.find(r => !r.countermeasures && r.policy === row.policy && r.commandedSpeed === row.commandedSpeed);
  assert.deepEqual(row.launchState, control.launchState, 'countermeasure controls must share actual launch state');
}
console.log(`Saved ${dir}/report.json; ${(performance.now() - started).toFixed(0)} ms`);
save('complete');
} catch (error) { save('incomplete', error.message); throw error; }
}
