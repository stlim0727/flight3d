import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const dir = process.env.ARTIFACT_DIR || '.cache/f16-missiles';
fs.mkdirSync(dir, { recursive: true });

const close = (condition, message) => assert.ok(condition, message);

await withBrowserSession({
  path: '/?terrain=coastal&aircraft=F16&scenario=cruise&fly=1',
  width: 1440,
  height: 900,
}, async ({ gpuAngle, evaluate, screenshot, send, exceptions, delay }) => {
  close(gpuAngle !== 'swiftshader' || process.env.FORCE_GPU === '0', 'hardware GPU is required for this check');

  for (let i = 0; i < 240; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(250);
  }
  close(await evaluate('Boolean(window.simulator?.startupReady)'), 'startup ready');
  close(await evaluate('window.simulator.currentAircraftId === "F16"'), 'F-16 selected');

  // Hold the aircraft in a fixed airborne pose so the check is about weapons,
  // not about the autopilot keeping a particular trajectory.
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    s.integratePhysics = () => {};
    s.setTimeOfDay(12, { persist: false, userChoice: false });
    s.position.set(0, 3000, 0);
    s.linearVelocity.set(0, 0, -250);
    s.aircraft.group.position.copy(s.position);
    s.aircraft.group.quaternion.identity();
    s.quaternion.identity();
    s.renderPose.reset(s.position, s.quaternion);
    Object.assign(s.telemetry, {
      onGround: false, iasKnots: 350, altitudeFt: 9840, headingDeg: 0,
      pitchDeg: 0, rollDeg: 0, vsiFpm: 0, rwrLevel: 0,
    });
    // Re-spawn the bandits relative to this fixed pose instead of the pose the
    // live cruise start happened to use before the check took control.
    s.missileCombat.reset();
    s.missileCombatView.clear();
    s.syncMissileLoadout();
    s.cameraSystem.setMode(1, true);
  })()`);

  for (let i = 0; i < 120; i++) {
    if (await evaluate('window.simulator.missileCombat.targets.length === 2')) break;
    await delay(100);
  }
  close(await evaluate('window.simulator.missileCombat.targets.length === 2'), 'two bandits spawned');
  close(await evaluate('window.simulator.aircraft.missileMeshes.every(mesh => mesh.visible)'), 'six rail missiles visible');
  await delay(300);
  await screenshot(path.join(dir, 'f16-rail-loadout.png'));

  // HUD camera with the boresight on the first bandit.
  await evaluate('window.simulator.cameraSystem.setMode(8, true)');
  for (let i = 0; i < 100; i++) {
    if (await evaluate('window.simulator.missileCombat.lockProgress >= 1')) break;
    await delay(100);
  }
  const hud = await evaluate('window.simulator.missileCombat.getHudState()');
  close(hud.locked, 'HUD reports a locked target');
  close(hud.remaining === 6 && hud.total === 6, 'HUD ammunition is 6/6');
  close(hud.rwr.level >= 1, 'RWR sees the bandits on radar');
  await screenshot(path.join(dir, 'hud-lock.png'));

  // Director camera owns the launch: cut on the rail release, follow the missile
  // and finish from the targeted bandit's seat.
  await evaluate('window.simulator.cameraSystem.setMode(9, true)');
  await evaluate('document.activeElement?.blur?.()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await delay(250);
  close(await evaluate('window.simulator.missileCombat.remaining === 5'), 'one missile left the rail');
  close(await evaluate('!window.simulator.aircraft.missileMeshes[0].visible'), 'fired station mesh hidden');
  close(await evaluate('window.simulator.missileCombat.missiles.length === 1'), 'one missile in flight');
  close(
    await evaluate('window.simulator.cameraSystem.cinematicDirector.currentShotType === "missile_launch"'),
    'director cut to the missile launch',
  );
  await screenshot(path.join(dir, 'director-missile-launch.png'));

  for (let i = 0; i < 40; i++) {
    if (await evaluate('window.simulator.cameraSystem.cinematicDirector.currentShotType === "missile_track"')) break;
    await delay(100);
  }
  close(
    await evaluate('window.simulator.cameraSystem.cinematicDirector.currentShotType === "missile_track"'),
    'director follows the missile',
  );
  await screenshot(path.join(dir, 'director-missile-track.png'));

  for (let i = 0; i < 120; i++) {
    if (await evaluate('window.simulator.cameraSystem.cinematicDirector.currentShotType === "bandit_pov"')) break;
    await delay(100);
  }
  close(
    await evaluate('window.simulator.cameraSystem.cinematicDirector.currentShotType === "bandit_pov"'),
    'director cuts to the bandit POV',
  );
  await screenshot(path.join(dir, 'director-bandit-pov.png'));

  for (let i = 0; i < 50; i++) {
    const near = await evaluate(`(() => {
      const s = window.simulator;
      const missile = s.missileCombat.missiles[0];
      const target = s.missileCombat.targets.find(candidate => candidate.alive);
      return Boolean(missile && target && missile.position.distanceTo(target.position) < 180);
    })()`);
    if (near) break;
    await delay(100);
  }
  await screenshot(path.join(dir, 'director-bandit-pov-close.png'));

  await evaluate('window.simulator.cameraSystem.setMode(1, true)');
  await delay(650);
  await screenshot(path.join(dir, 'missile-smoke.png'));

  let killed = false;
  for (let i = 0; i < 160; i++) {
    if (await evaluate('window.simulator.missileCombat.splashCount >= 1')) { killed = true; break; }
    await delay(100);
  }
  close(killed, 'proximity fuse destroyed the bandit');
  close(await evaluate('window.simulator.missileCombat.targets.some(target => !target.alive)'), 'bandit marked dead');
  await delay(120);
  await screenshot(path.join(dir, 'bandit-splash.png'));

  // Gun pass: put the surviving bandit inside the LCOS envelope, then hold the
  // airborne trigger (Space) through the real keyboard path.
  await evaluate(`(() => {
    const s = window.simulator;
    const target = s.missileCombat.targets.find(t => t.alive);
    if (!target) return;
    target.orbit = null;
    target.velocity.set(0, 0, 0);
    target.position.set(s.position.x, s.position.y, s.position.z - 260);
    target.prevPosition.copy(target.position);
    target.damage = 0;
    target.damageState = 'normal';
    s.missileCombat.selectedTargetIndex = s.missileCombat.targets.indexOf(target);
    s.cameraSystem.setMode(8, true);
  })()`);
  await delay(250);
  const gunHud = await evaluate('window.simulator.missileCombat.getHudState()');
  close(gunHud.gun.rounds === 510 && gunHud.gun.capacity === 510, 'HUD gun magazine is 510/510');
  close(Boolean(gunHud.gun.aim), 'LCOS pipper exists inside gun range');
  await screenshot(path.join(dir, 'hud-gun-lcos.png'));

  await evaluate('document.activeElement?.blur?.()');
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32,
  });
  await delay(80);
  close(await evaluate('window.simulator.controls.gunTrigger === true'), 'Space arms the gun trigger');
  await delay(300);
  await screenshot(path.join(dir, 'gun-tracers.png'));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32,
  });
  await delay(600);
  const gun = await evaluate(`(() => {
    const s = window.simulator;
    return {
      rounds: s.missileCombat.cannon.rounds,
      splash: s.missileCombat.splashCount,
      firing: s.missileCombat.cannon.firing,
      tracers: s.missileCombat.cannon.bullets.length,
    };
  })()`);
  close(gun.rounds < 510, `gun consumed rounds: ${gun.rounds}`);
  close(gun.splash >= 2, `gun destroyed the bandit: splash ${gun.splash}`);
  close(gun.firing === false, 'released trigger stops the gun');

  // Turnaround: stopped on pavement with partial ammunition rearms after 5 s.
  await evaluate(`(() => {
    const s = window.simulator;
    s.currentAirport.isOnRunway = () => true;
    Object.assign(s.telemetry, {
      onGround: true, groundSpeedKnots: 0, gearState: 1,
      gearDamage: {}, bodyDamage: {}, rwrLevel: 0,
    });
    s.linearVelocity.set(0, 0, 0);
  })()`);
  await delay(5600);
  const rearmed = await evaluate(`(() => {
    const s = window.simulator;
    return {
      rounds: s.missileCombat.cannon.rounds,
      remaining: s.missileCombat.remaining,
      state: s.rearmSystem.state,
      rails: s.aircraft.missileMeshes.filter(mesh => mesh.visible).length,
    };
  })()`);
  close(rearmed.rounds === 510, `turnaround reloaded the gun: ${rearmed.rounds}`);
  close(rearmed.remaining === 6, `turnaround reloaded all six rails: ${rearmed.remaining}`);
  close(rearmed.rails === 6, `six rail meshes are visible after rearming: ${rearmed.rails}`);
  await evaluate('window.simulator.cameraSystem.setMode(1, true)');
  await delay(300);
  await screenshot(path.join(dir, 'f16-rearmed.png'));

  // Deterministic lock tone: aim a bandit's nose at the player and observe the
  // RWR track stage independently of its circular patrol.
  await evaluate(`(() => {
    const s = window.simulator;
    Object.assign(s.telemetry, { onGround: false, groundSpeedKnots: 250, iasKnots: 350 });
  })()`);
  for (let i = 0; i < 100; i++) {
    if (await evaluate('window.simulator.missileCombat.targets.some(t => t.alive)')) break;
    await delay(100);
  }
  await evaluate(`(() => {
    const s = window.simulator;
    const target = s.missileCombat.targets.find(t => t.alive);
    if (!target) return;
    target.orbit = null;
    target.position.copy(s.position).add({ x: 0, y: 200, z: -8000 });
    target.prevPosition.copy(target.position);
    target.velocity.copy(s.position).sub(target.position).normalize().multiplyScalar(200);
  })()`);
  await delay(300);
  const rwr = await evaluate('window.simulator.missileCombat.rwr.state()');
  close(rwr.level >= 2, 'RWR escalates to a tracking lock');
  close(exceptions.length === 0, `no page exceptions: ${JSON.stringify(exceptions)}`);

  fs.writeFileSync(path.join(dir, 'result.json'),
    JSON.stringify({ gpuAngle, hud, gunHud, gun, rearmed, rwr, exceptions }, null, 2));
  console.log('F-16 air-to-air verification passed', {
    gpuAngle, remaining: hud.remaining, gunRounds: gun.rounds, splash: gun.splash,
    rearmed: rearmed.remaining, rwr: rwr.levelName,
  });
});
