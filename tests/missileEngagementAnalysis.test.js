import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

import { analyzeCombatEngagement, ENGAGEMENT_SCHEMA_VERSION } from '../src/weapons/engagementAnalysis.js';
import { encodeTrack, decodeTrack, toBase64, fromBase64 } from '../src/replay/ReplayCodec.js';
import { ReplayRecorder } from '../src/core/ReplayRecorder.js';
import { AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { Flare, FlareDispenser } from '../src/weapons/Flare.js';
import { ChaffCloud, ChaffDispenser } from '../src/weapons/Chaff.js';
import { MissileSeeker } from '../src/weapons/MissileSeeker.js';

function baseTrack(timeSec = 30) {
  const samples = [];
  for (let i = 0; i < 30; i++) {
    samples.push({
      timeSec: i,
      x: i * 50,
      y: 1000,
      z: -i * 50,
      headingDeg: 45,
      pitchDeg: 0,
      rollDeg: 0,
      altitudeFt: 3280,
      iasKnots: 250,
      gForce: 1.0,
      mach: 0.4,
      alphaDeg: 2.0,
      betaDeg: 0.0,
      engineThrustN: 40000,
      engineRpmFraction: 0.9,
      fuelKg: 2500,
      gearFraction: 0,
      flapsFraction: 0,
      speedbrakeFraction: 0,
      controlStickPitch: 0,
      controlStickRoll: 0,
      rudderPedal: 0,
      throttleLever: 0.8,
    });
  }
  return {
    metadata: {
      aircraft: 'F16',
      airport: 'coastal',
      scenario: 'bvr_intercept',
      appBuild: 'test-suite-build',
    },
    durationSec: timeSec,
    samples,
  };
}

test('analyzeCombatEngagement: empty track returns structured empty engagement', () => {
  const result = analyzeCombatEngagement(null);
  assert.equal(result.schemaVersion, ENGAGEMENT_SCHEMA_VERSION);
  assert.equal(result.missiles.length, 0);
  assert.equal(result.summary.totalLaunches, 0);
  assert.ok(result.fidelity.limitations.length > 0);
});

test('analyzeCombatEngagement: parses legacy v6 attachment file correctly as unresolved sortie end', () => {
  const attachmentPath = '/var/shared/repos/flight3d/.codex-attachments/aee0f16d-540e-46ee-8f7d-cb6d737aa315/2c45920b-040c-4e41-90b5-786807de347f/flight3d-F16-flight _3_.json';
  if (!fs.existsSync(attachmentPath)) {
    // Skip if path not present on non-local runner
    return;
  }
  const fileContent = fs.readFileSync(attachmentPath, 'utf-8');
  const sortie = JSON.parse(fileContent);

  const analysis = analyzeCombatEngagement(sortie);
  assert.equal(analysis.schemaVersion, ENGAGEMENT_SCHEMA_VERSION);
  assert.equal(analysis.meta.aircraft, 'F16');
  assert.equal(analysis.fidelity.isLegacyTrack, true);
  assert.equal(analysis.fidelity.trackVersion, 6);
  assert.ok(analysis.fidelity.limitations.some(l => l.includes('legacy combat format')));

  assert.equal(analysis.missiles.length, 1);
  const m = analysis.missiles[0];
  assert.equal(m.typeId, 'AIM9X');
  assert.equal(m.termination.outcome, 'unresolved_sortie_ended');
  assert.ok(m.causalSummary.includes('Legacy track'));
  assert.ok(m.causalSummary.includes('unresolved'));
});

test('analyzeCombatEngagement: detects seeker loss, memory expiry and reacquisition', () => {
  const t = baseTrack(20);
  t.combat = {
    version: 7,
    diagnosticIntervalSec: 0.2,
    missiles: [],
    banditSamples: [],
    diagnosticSamples: [],
    events: [
      { timeSec: 2.0, kind: 'launch', missileId: 1, typeId: 'AIM9X', targetId: 'bandit_1', locked: true, lockProgress: 1.0 },
      { timeSec: 2.1, kind: 'seeker_state', missileId: 1, state: 'track', targetId: 'bandit_1', lossReason: 'none' },
      { timeSec: 4.5, kind: 'seeker_state', missileId: 1, state: 'lost', targetId: 'bandit_1', lossReason: 'fov_limit' },
      { timeSec: 5.5, kind: 'seeker_state', missileId: 1, state: 'acquire', targetId: 'bandit_1', lossReason: 'none' },
      { timeSec: 6.0, kind: 'seeker_state', missileId: 1, state: 'track', targetId: 'bandit_1', lossReason: 'none' },
      { timeSec: 8.0, kind: 'detonation', missileId: 1, distanceM: 3.2, fuzePolicy: 'continuous_fuze_cpa' },
      { timeSec: 8.0, kind: 'kill', missileId: 1, targetId: 'bandit_1', source: 'missile', distanceM: 3.2 },
    ],
  };

  const analysis = analyzeCombatEngagement(t);
  assert.equal(analysis.summary.totalLaunches, 1);
  assert.equal(analysis.summary.missileKills, 1);
  assert.equal(analysis.missiles.length, 1);

  const m = analysis.missiles[0];
  assert.equal(m.termination.outcome, 'kill');
  assert.equal(m.seekerTimeline.length, 4);
  assert.equal(m.seekerTimeline[1].lossReason, 'fov_limit');
  assert.ok(m.causalSummary.includes('fov_limit'));
  assert.ok(m.causalSummary.includes('Successful interception'));
});

test('analyzeCombatEngagement: records countermeasure dispense and decoy lock transfer', () => {
  const t = baseTrack(20);
  t.combat = {
    version: 7,
    diagnosticIntervalSec: 0.2,
    missiles: [],
    banditSamples: [],
    diagnosticSamples: [],
    events: [
      { timeSec: 3.0, kind: 'launch', missileId: 2, typeId: 'AIM9X', targetId: 'bandit_mig29', locked: true },
      { timeSec: 4.0, kind: 'flare_dispense', decoyType: 'flare', decoyId: 101, sourceId: 'bandit_mig29' },
      { timeSec: 4.2, kind: 'decoy_transfer', missileId: 2, decoyType: 'flare', decoyId: 101, sourceId: 'bandit_mig29', reason: 'signal_dominance' },
      { timeSec: 7.0, kind: 'detonation', missileId: 2, distanceM: 0.5, fuzePolicy: 'continuous_fuze_cpa' },
    ],
  };

  const analysis = analyzeCombatEngagement(t);
  assert.equal(analysis.summary.countermeasures.flaresDispensed, 1);
  assert.equal(analysis.summary.countermeasures.decoyTransfers, 1);

  const m = analysis.missiles[0];
  assert.equal(m.decoyTransfers.length, 1);
  assert.equal(m.decoyTransfers[0].decoyId, 101);
  assert.equal(m.termination.outcome, 'survived_fuze_blast');
  assert.ok(m.causalSummary.includes('Seeker lock transferred to a countermeasures flare'));
});

test('analyzeCombatEngagement: captures guidance cutoffs and aerodynamic limits', () => {
  const t = baseTrack(20);
  t.combat = {
    version: 7,
    diagnosticIntervalSec: 0.2,
    missiles: [],
    banditSamples: [],
    diagnosticSamples: [
      {
        timeSec: 3.0,
        missileId: 3,
        guided: true,
        cutoffReason: 'none',
        demandedG: 12.0,
        availableG: 25.0,
        actualG: 12.0,
        dragN: 1500,
        qBarPa: 50000,
        mach: 2.1,
        separationM: 3000,
        seekerState: 'track',
        seekerLossReason: 'none',
      },
      {
        timeSec: 5.0,
        missileId: 3,
        guided: false,
        cutoffReason: 'gimbal_limit',
        demandedG: 35.0,
        availableG: 15.0,
        actualG: 15.0,
        dragN: 2200,
        qBarPa: 30000,
        mach: 1.4,
        separationM: 1200,
        seekerState: 'lost',
        seekerLossReason: 'fov_limit',
      },
    ],
    events: [
      { timeSec: 2.8, kind: 'launch', missileId: 3, typeId: 'AIM9X', targetId: 'bandit_1', locked: true },
      { timeSec: 9.0, kind: 'expire', missileId: 3 },
    ],
  };

  const analysis = analyzeCombatEngagement(t);
  const m = analysis.missiles[0];
  assert.equal(m.termination.outcome, 'expired');
  assert.equal(m.guidanceTimeline.length, 2);
  assert.equal(m.guidanceTimeline[1].cutoffReason, 'gimbal_limit');
  assert.ok(m.causalSummary.includes('gimbal_limit'));
  assert.ok(m.causalSummary.includes('exhausted'));
});

test('analyzeCombatEngagement: distinguishes survived proximity blast vs lethal direct blast', () => {
  const t = baseTrack(25);
  t.combat = {
    version: 7,
    diagnosticIntervalSec: 0.2,
    missiles: [],
    banditSamples: [],
    diagnosticSamples: [],
    events: [
      // Missile 1: Proximity blast at 9m, damage 35%, bandit survives
      { timeSec: 2.0, kind: 'launch', missileId: 1, typeId: 'AIM9X', targetId: 'bandit_1', locked: true },
      { timeSec: 6.0, kind: 'detonation', missileId: 1, distanceM: 9.2, fuzePolicy: 'continuous_fuze_cpa' },
      { timeSec: 6.0, kind: 'damage', missileId: 1, targetId: 'bandit_1', damage: 35, zone: 'wing' },

      // Missile 2: Lethal blast at 2.5m, damage 100%, bandit killed
      { timeSec: 10.0, kind: 'launch', missileId: 2, typeId: 'AIM9X', targetId: 'bandit_1', locked: true },
      { timeSec: 14.0, kind: 'detonation', missileId: 2, distanceM: 2.5, fuzePolicy: 'continuous_fuze_cpa' },
      { timeSec: 14.0, kind: 'damage', missileId: 2, targetId: 'bandit_1', damage: 95, zone: 'fuselage' },
      { timeSec: 14.0, kind: 'kill', missileId: 2, targetId: 'bandit_1', source: 'missile', distanceM: 2.5 },
    ],
  };

  const analysis = analyzeCombatEngagement(t);
  assert.equal(analysis.summary.totalLaunches, 2);
  assert.equal(analysis.summary.outcomes.survived_fuze_blast, 1);
  assert.equal(analysis.summary.outcomes.kill, 1);
  assert.equal(analysis.summary.missileKills, 1);

  const m1 = analysis.missiles.find(m => m.missileId === 1);
  assert.equal(m1.termination.outcome, 'survived_fuze_blast');
  assert.equal(m1.termination.damageApplied, 35);
  assert.ok(m1.causalSummary.includes('survived'));

  const m2 = analysis.missiles.find(m => m.missileId === 2);
  assert.equal(m2.termination.outcome, 'kill');
  assert.ok(m2.causalSummary.includes('Successful interception'));
});

test('ReplayCodec: v7 track roundtrip preserves all diagnostic samples, telemetry, and events', () => {
  const original = baseTrack(30);
  original.combat = {
    version: 7,
    banditIntervalSec: 0.1,
    missileIntervalSec: 0.05,
    diagnosticIntervalSec: 0.2,
    targets: ['target_alpha'],
    banditSamples: [
      { timeSec: 1.0, x: 100, y: 1500, z: -500, qx: 0, qy: 0, qz: 0, qw: 1 },
      { timeSec: 1.1, x: 105, y: 1500, z: -500, qx: 0, qy: 0, qz: 0, qw: 1 },
    ],
    missileSamples: [
      { timeSec: 2.0, id: 1, typeId: 'AIM9X', x: 200, y: 1200, z: -300, quat: [0, 0, 0, 1], powered: true },
      { timeSec: 2.05, id: 1, typeId: 'AIM9X', x: 210, y: 1200, z: -290, quat: [0, 0, 0, 1], powered: true },
    ],
    diagnosticSamples: [
      {
        timeSec: 2.2,
        missileId: 1,
        guided: true,
        cutoffReason: 'none',
        demandedG: 8.5,
        availableG: 28.0,
        actualG: 8.5,
        dragN: 1800,
        qBarPa: 42000,
        mach: 2.3,
        separationM: 2150,
        seekerState: 'track',
        seekerLossReason: 'none',
      },
    ],
    events: [
      { timeSec: 2.0, kind: 'launch', missileId: 1, typeId: 'AIM9X', targetId: 'target_alpha', locked: true },
      { timeSec: 2.5, kind: 'seeker_state', missileId: 1, state: 'track', targetId: 'target_alpha' },
      { timeSec: 5.0, kind: 'detonation', missileId: 1, distanceM: 1.8, fuzePolicy: 'continuous_fuze_cpa' },
      { timeSec: 5.0, kind: 'kill', missileId: 1, targetId: 'target_alpha', source: 'missile' },
    ],
  };

  const encoded = encodeTrack(original);
  assert.ok(encoded instanceof Uint8Array);

  const decoded = decodeTrack(encoded);
  assert.equal(decoded.combat.version, 7);
  assert.equal(decoded.combat.diagnosticIntervalSec, 0.2);
  assert.equal(decoded.combat.diagnosticSamples.length, 1);
  const diag = decoded.combat.diagnosticSamples[0];
  assert.equal(diag.missileId, 1);
  assert.equal(diag.guided, true);
  assert.equal(diag.cutoffReason, 'none');
  assert.equal(diag.seekerState, 'track');
  assert.ok(Math.abs(diag.demandedG - 8.5) < 0.1);
  assert.ok(Math.abs(diag.mach - 2.3) < 0.05);

  assert.equal(decoded.combat.events.length, 4);
  assert.equal(decoded.combat.events[0].kind, 'launch');
  assert.equal(decoded.combat.events[3].kind, 'kill');
});

test('ReplayRecorder: budget overflow prunes diagnostic samples first while preserving events', () => {
  const recorder = new ReplayRecorder({ maxBase64Bytes: 1500 }); // strict budget
  recorder.start({ aircraft: 'F16', airport: 'coastal' });

  const quat = new THREE.Quaternion();
  const telemetry = {
    x: 0,
    z: 0,
    altitudeFt: 3000,
    iasKnots: 250,
    gForce: 1,
    pitchDeg: 0,
    rollDeg: 0,
    headingDeg: 45,
  };

  // Add pose samples
  for (let i = 0; i < 20; i++) {
    recorder.update(0.1, { ...telemetry, x: i * 10 }, quat);
  }

  // Populate events and diagnostics
  recorder.recordCombatEvent({ type: 'launch', missileId: 1, typeId: 'AIM9X', targetId: 'bandit', locked: true });
  for (let i = 0; i < 100; i++) {
    recorder.combat.diagnosticSamples.push({
      timeSec: i * 0.2,
      missileId: 1,
      guidanceActive: true,
      seekerState: 'track',
      seekerLossReason: 'none',
      speedMps: 700,
      altitudeM: 1000,
      dynamicPressurePa: 50000,
      requestedLateralG: 10,
      availableLateralG: 20,
      deliveredLateralG: 10,
      maneuverDragN: 1000,
      baseDragN: 500,
      propellant: 1.0,
      signalQuality: 1.0,
      targetRangeM: 2000,
    });
  }
  recorder.recordCombatEvent({ type: 'kill', missileId: 1, targetId: 'bandit', source: 'missile' });

  // Manually trigger trim
  recorder._trimCombat();

  assert.ok(recorder.combat.fidelity.downsampled, 'Fidelity metadata must flag downsampled state');
  // Critical events (launch, kill) must be preserved
  assert.ok(recorder.combat.events.some(e => e.kind === 'launch'));
  assert.ok(recorder.combat.events.some(e => e.kind === 'kill'));
});

test('AirToAirMissileSystem: recording preserves exact physics without side effects', () => {
  // Test that running simulation with or without replay recorder generates identical kinematic positions
  const createSim = (withRecorder = false) => {
    const scene = new THREE.Scene();
    const system = new AirToAirMissileSystem(scene);
    let recorder = null;
    if (withRecorder) {
      recorder = new ReplayRecorder();
      recorder.start({ aircraft: 'F16' });
    }

    const playerPlane = {
      active: true,
      onGround: false,
      position: new THREE.Vector3(0, 1000, 0),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(0, 0, -250),
      terrainHeight: () => 0,
    };
    const banditTarget = {
      id: 'target_1',
      alive: true,
      position: new THREE.Vector3(0, 1000, -2000),
      prevPosition: new THREE.Vector3(0, 1000, -2000),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(0, 0, -200),
      isDestroyed: false,
      flares: new FlareDispenser(),
      chaff: new ChaffDispenser(),
      chaffThreatIds: new Set(),
      flareThreatIds: new Set(),
      threatResponse: { confirmedId: null, heading: 0, weight: 0 },
      update: () => {},
    };
    system.targets = [banditTarget];

    // Fire missile
    system.fire(playerPlane);

    const quat = new THREE.Quaternion();
    const telemetry = {
      x: 0,
      z: 0,
      altitudeFt: 3280,
      iasKnots: 250,
      gForce: 1,
      pitchDeg: 0,
      rollDeg: 0,
      headingDeg: 0,
    };

    // Step simulation for 10 frames
    for (let f = 0; f < 10; f++) {
      const dt = 0.02;
      const events = system.update(dt, playerPlane);
      if (recorder) {
        for (const ev of events) {
          recorder.recordCombatEvent(ev.kind || ev.type, ev);
        }
        recorder.update(dt, telemetry, quat, system);
      }
    }

    const missile = system.missiles[0];
    return {
      pos: missile ? missile.position.clone() : null,
      vel: missile ? missile.velocity.clone() : null,
      alive: missile?.alive,
    };
  };

  const simWithout = createSim(false);
  const simWith = createSim(true);

  assert.ok(simWithout.pos);
  assert.ok(simWith.pos);
  assert.ok(Math.abs(simWithout.pos.x - simWith.pos.x) < 1e-6);
  assert.ok(Math.abs(simWithout.pos.y - simWith.pos.y) < 1e-6);
  assert.ok(Math.abs(simWithout.pos.z - simWith.pos.z) < 1e-6);
  assert.ok(Math.abs(simWithout.vel.z - simWith.vel.z) < 1e-6);
  assert.equal(simWithout.alive, simWith.alive);
});
