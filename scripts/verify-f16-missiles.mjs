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

  // Exercise the real keyboard path, then verify the rail separation.
  await evaluate('document.activeElement?.blur?.()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await delay(250);
  close(await evaluate('window.simulator.missileCombat.remaining === 5'), 'one missile left the rail');
  close(await evaluate('!window.simulator.aircraft.missileMeshes[0].visible'), 'fired station mesh hidden');
  close(await evaluate('window.simulator.missileCombat.missiles.length === 1'), 'one missile in flight');

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

  // Deterministic lock tone: aim a bandit's nose at the player and observe the
  // RWR track stage independently of its circular patrol.
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

  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ gpuAngle, hud, rwr, exceptions }, null, 2));
  console.log('F-16 air-to-air verification passed', { gpuAngle, remaining: hud.remaining, splash: 1, rwr: rwr.levelName });
});
