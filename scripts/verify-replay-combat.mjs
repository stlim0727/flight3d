import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const dir = process.env.ARTIFACT_DIR || '.cache/replay-combat';
fs.mkdirSync(dir, { recursive: true });

await withBrowserSession({
  path: '/?terrain=coastal&aircraft=F16&scenario=cruise&fly=1',
  width: 1440,
  height: 900,
}, async ({ gpuAngle, evaluate, screenshot, delay, exceptions }) => {
  assert.notEqual(gpuAngle, 'swiftshader', 'hardware GPU is required');
  for (let i = 0; i < 240; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(250);
  }
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), 'startup ready');
  assert.ok(await evaluate('window.simulator.replayRecorder.active'), 'sortie is recording');

  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    s.integratePhysics = () => {};
    s.setTimeOfDay(12, { persist: false, userChoice: false });
    s.position.set(0, 3000, 0);
    s.linearVelocity.set(0, 0, -250);
    s.quaternion.identity();
    s.aircraft.group.position.copy(s.position);
    s.renderPose.reset(s.position, s.quaternion);
    Object.assign(s.telemetry, {
      onGround: false, iasKnots: 350, altitudeFt: 9840, headingDeg: 0,
      pitchDeg: 0, rollDeg: 0, vsiFpm: 0,
    });
    s.missileCombat.reset();
    s.missileCombatView.clear();
    s.syncMissileLoadout();
    s.cameraSystem.setMode(1, true);
  })()`);

  for (let i = 0; i < 120; i++) {
    if (await evaluate('window.simulator.missileCombat.lockProgress >= 1')) break;
    await delay(100);
  }
  assert.ok(await evaluate('window.simulator.fireMissile()'), 'missile fired');
  for (let i = 0; i < 180; i++) {
    if (await evaluate('window.simulator.missileCombat.splashCount >= 1')) break;
    await delay(100);
  }
  assert.ok(await evaluate('window.simulator.missileCombat.splashCount >= 1'), 'bandit killed');
  await delay(4500);

  const recorded = await evaluate(`(() => {
    const s = window.simulator;
    const track = s.replayRecorder.finish();
    return track && {
      duration: track.durationSec,
      combat: track.combat && {
        targets: track.combat.targets.length,
        bandits: track.combat.banditSamples.length,
        missiles: track.combat.missileSamples.length,
        events: track.combat.events.length,
        firstMissileTime: track.combat.missileSamples[0]?.timeSec,
        detonationTime: track.combat.events[0]?.timeSec,
      },
    };
  })()`);
  assert.ok(recorded?.combat, 'combat section recorded');
  assert.ok(recorded.combat.targets >= 2);
  assert.ok(recorded.combat.bandits >= 4);
  assert.ok(recorded.combat.missiles >= 20);
  assert.ok(recorded.combat.events >= 1);

  const loaded = await evaluate(`(async () => {
    const s = window.simulator;
    const track = s.replayRecorder.finish();
    // The recorder captured its metadata before this check set noon; replay the
    // sortie in daylight so the missile and bandit are legible in screenshots.
    if (track?.metadata) track.metadata.timeOfDay = 12;
    const ok = await s.replayDirector.load(track);
    return { ok, active: s.replayDirector.active, combat: Boolean(s.replayDirector._combat?.active) };
  })()`);
  assert.ok(loaded.ok, 'replay loaded');
  assert.ok(loaded.combat, 'replay combat playback active');

  // The recorded combat track must drive the same director cinematics as a
  // live launch: launch, missile follow, then the bandit POV.
  const replayShots = await evaluate(`(async () => {
    const s = window.simulator;
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    s.replayPanel?.setFolded?.(true);
    s.replayDirector.seek(${recorded.combat.firstMissileTime} + 0.02);
    s.cameraSystem.setMode(9, true);
    s.replayDirector.play();
    const waitShot = async (name, steps) => {
      for (let i = 0; i < steps; i++) {
        if (s.cameraSystem.cinematicDirector.currentShotType === name) return true;
        await delay(100);
      }
      return s.cameraSystem.cinematicDirector.currentShotType === name;
    };
    const launch = await waitShot('missile_launch', 20);
    const track = await waitShot('missile_track', 40);
    const pov = await waitShot('bandit_pov', 160);
    let close = false;
    for (let i = 0; i < 120; i++) {
      const sequence = s.cameraSystem.cinematicDirector.missileSequence;
      if (!sequence) break;
      const missile = sequence.missile;
      const target = sequence.target;
      if (missile?.alive && target && missile.position.distanceTo(target.position) < 80) {
        close = true;
        break;
      }
      await delay(100);
    }
    s.replayDirector.pause();
    return {
      launch, track, pov, close,
      shot: s.cameraSystem.cinematicDirector.currentShotType,
      phase: s.cameraSystem.cinematicDirector.missileSequence?.phase ?? null,
      timeSec: s.replayDirector.progressSec,
    };
  })()`);
  assert.ok(replayShots.launch, 'recorded launch cuts to the launch shot');
  assert.ok(replayShots.track, 'recorded missile gets the follow cam');
  assert.ok(replayShots.pov, `recorded missile reaches the bandit POV (${replayShots.shot})`);
  assert.ok(replayShots.close, 'recorded POV follows the missile down to impact range');
  await screenshot(path.join(dir, 'replay-director-pov.png'));

  const flightTime = recorded.combat.firstMissileTime + 1.2;
  const duringFlight = await evaluate(`(async () => {
    const s = window.simulator;
    s.replayDirector.seek(${flightTime});
    s.replayPanel?.setFolded?.(true);
    s.cameraSystem.setMode(1, true);
    await new Promise(resolve => setTimeout(resolve, 250));
    const missiles = [];
    const bandits = [];
    s.scene.traverse(node => {
      if (node.name.startsWith('Missile_') && node.visible) missiles.push(node.name);
      if (node.name.startsWith('Bandit_') && node.visible) bandits.push(node.name);
    });
    return { missiles, bandits, stateMissiles: s.replayDirector._combat.state.missiles.length,
      viewMissiles: s.replayDirector._combat.view.missileViews.size,
      rails: s.replayDirector._combat.state.rails,
      station0: s.aircraft.missileMeshes?.[0]?.visible,
      hudRemaining: s.replayDirector.combatHudState()?.remaining,
      hudTarget: s.replayDirector.combatHudState()?.selectedTarget?.callsign,
      overlayVisible: !document.getElementById('hud-view').hidden };
  })()`);
  assert.ok(duringFlight.missiles.includes('Missile_AIM9X'), 'replay draws the launched missile');
  assert.ok(duringFlight.bandits.includes('Bandit_BANDIT 1'), 'replay draws the bandit target');
  assert.equal(duringFlight.stateMissiles, 1);
  assert.equal(duringFlight.viewMissiles, 1);
  assert.equal(duringFlight.station0, false, 'replay host reflects the fired rail');
  assert.equal(duringFlight.rails & 1, 0, 'recorded loadout mask marks station 1 empty');
  assert.equal(duringFlight.hudRemaining, 5, 'replay HUD shows the recorded rail count');
  assert.ok(['BANDIT 1', 'BANDIT 2'].includes(duringFlight.hudTarget), 'replay HUD names a recorded bandit');
  assert.equal(duringFlight.overlayVisible, true, 'combat overlay is visible in replay');
  await evaluate('window.simulator.cameraSystem.setMode(8, true)');
  await delay(250);
  await screenshot(path.join(dir, 'replay-hud.png'));
  await evaluate('window.simulator.cameraSystem.setMode(1, true)');
  await delay(100);
  await screenshot(path.join(dir, 'replay-missile.png'));

  const afterBurst = await evaluate(`(async () => {
    const s = window.simulator;
    s.replayDirector.seek(${recorded.combat.detonationTime} + 0.25);
    await new Promise(resolve => setTimeout(resolve, 150));
    return {
      stateMissiles: s.replayDirector._combat.state.missiles.length,
      viewMissiles: s.replayDirector._combat.view.missileViews.size,
    };
  })()`);
  assert.equal(afterBurst.stateMissiles, 0, 'detonated missile leaves the replay state');
  assert.equal(afterBurst.viewMissiles, 0, 'detonated missile mesh is removed after the burst');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));

  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ recorded, loaded, replayShots, duringFlight, exceptions }, null, 2));
  console.log('Replay combat verification passed', { recorded: recorded.combat, replayShots, duringFlight, gpuAngle });
});
