/** Renderer-free, deterministic pilot experiment; not a browser/UI acceptance test. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

function save() {
  const metadata = { commit, dt, simulationSeconds: 100, wallSeconds: (performance.now() - started) / 1000 };
  writeFileSync(`${dir}/report.json`, JSON.stringify({ ...metadata, results }, null, 2));
  // A small versioned record excludes the per-second trajectory samples.
  writeFileSync(`${dir}/summary.json`, JSON.stringify({ ...metadata,
    results: results.map(({ samples, ...r }) => ({ ...r,
      minSampledRangeM: Math.min(...samples.map(s => s.rangeM ?? Infinity)),
      maxSampledLock: Math.max(...samples.map(s => s.lock)),
    })) }, null, 2));
}

function experiment(policy, countermeasures, commandedSpeed) {
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
  const shots = [], events = {}, samples = [];
  let lastShot = -100, crashed = false, minClearanceM = Infinity;
  for (let tick = 0; tick < 100 * 120; tick++) {
    const time = tick * dt;
    if (!countermeasures) for (const t of combat.targets) { t.flare.remaining = 0; t.chaff.remaining = 0; }
    let target = combat.selectedTarget();
    if (!target) { combat.selectNextTarget(); target = combat.selectedTarget(); }
    if (target) {
      // An instrumented pursuit pilot: truth is used only for steering, never sensor/guidance override.
      const heading = Math.atan2(target.position.x - pilot.position.x, -(target.position.z - pilot.position.z));
      BanditFlightModel.prototype.guide.call(pilot, heading, Math.max(750, target.position.y), commandedSpeed);
    }
    pilot.integratePhysics(dt);
    const clearance = pilot.position.y - Math.max(0, terrainHeight(pilot.position.x, pilot.position.z));
    minClearanceM = Math.min(minClearanceM, clearance);
    assert.ok([...pilot.position.toArray(), ...pilot.linearVelocity.toArray(), ...pilot.quaternion.toArray()].every(Number.isFinite));
    if (clearance <= 1 || pilot.isCrashed) { crashed = true; break; }
    const ready = policy === 'immediate' ? time >= shots.length * .35
      : combat.lockedTarget?.alive && combat.lockProgress >= 1 && time - lastShot >= 4
        && (policy !== 'close-locked' || combat.lockedTarget.position.distanceTo(pilot.position) <= 2500);
    // Isolate one locked IR shot; a second shot at the same soon-dead target
    // would turn a successful first shot into a misleading extra 'miss'.
    if (ready && combat.remaining && time < 75 && (policy === 'immediate' || shots.length === 0)) {
      const m = combat.fire(world);
      if (m) {
        shots.push({ missile: m, launchTime: time, type: m.typeId, locked: m.launchLocked,
          rangeM: target?.position.distanceTo(pilot.position), states: {}, guidance: {},
          firstTrackTime: null, controlLimitedSeconds: 0, decoyTransferEventCount: 0, transferEvents: [] });
        lastShot = time;
      }
    }
    for (const e of combat.update(dt, world)) {
      events[e.type] = (events[e.type] || 0) + 1;
      if (e.type === 'decoy_transfer') { const shot = shots.find(s => s.missile === e.missile); if (shot) {
        // Raw emitted events can repeat during confirmation: these are NOT
        // independently confirmed lock transfers or independent engagements.
        shot.decoyTransferEventCount++;
        shot.transferEvents.push({ time, fromType: e.prevTarget?.type, toType: e.decoyType,
          fromId: e.prevTarget?.id, toId: e.decoy?.id });
      } }
    }
    for (const shot of shots) if (shot.missile.alive) {
      const m = shot.missile;
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
  }
  const serialized = shots.map(({ missile: m, ...shot }) => ({ ...shot, outcome: m.finalOutcome,
    alive: m.alive, closest: Object.values(m.closestApproaches), terminalSpeedMps: m.velocity.length() }));
  assert.ok(serialized.every(s => !s.alive), 'all fired missiles must finish inside experiment');
  return { policy, countermeasures, commandedSpeed, initial, shots: serialized, events, samples,
    crashed, minClearanceM, kills: combat.splashCount, remaining: combat.remaining,
    targets: combat.targets.map(t => ({ callsign: t.callsign, alive: t.alive, damage: t.damage, damageState: t.damageState })) };
}

const started = performance.now();
for (const speed of [Math.hypot(96, 49), 250]) {
  for (const countermeasures of [true, false]) {
    for (const policy of ['immediate', 'locked', 'close-locked']) {
      const r = experiment(policy, countermeasures, speed);
      results.push(r);
      save();
      console.log(JSON.stringify({ policy, countermeasures, speed, shots: r.shots.length,
        locked: r.shots.filter(s => s.locked).length, bursts: r.shots.filter(s => s.outcome?.reason === 'fuze_burst').length,
        kills: r.kills, decoyEvents: r.shots.reduce((n,s) => n + s.decoyTransferEventCount, 0), crashed: r.crashed }));
    }
  }
}
assert.equal(results.length, 12);
console.log(`Saved ${dir}/report.json; ${(performance.now() - started).toFixed(0)} ms`);
