import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectGpuAngle, withBrowserSession } from './lib/browserHarness.mjs';

// Fail before the harness can choose its legacy software fallback.
assert.notEqual(detectGpuAngle(), 'swiftshader', 'Hardware GPU required; follow browser-gpu.md');
const dir = path.resolve(process.env.ARTIFACT_DIR || '.cache/bandit-evasion');
mkdirSync(dir, { recursive: true });

await withBrowserSession({ width: 1440, height: 900 }, async ({
  origin, cdpPort, send, evaluate, screenshot, delay, exceptions,
}) => {
  const gpuFile = path.join(dir, 'gpu.json');
  execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
    env: { ...process.env, GPU_REPORT: gpuFile }, stdio: 'inherit',
  });
  const gpu = JSON.parse(readFileSync(gpuFile, 'utf8'));
  assert.equal(gpu.passed, true);
  await send('Page.navigate', { url: `${origin}/?terrain=coastal&aircraft=F16&scenario=cruise&fly=1` });
  await send('Page.bringToFront');
  for (let i = 0; i < 240; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(250);
  }
  const startup = await evaluate('({ ready: Boolean(window.simulator?.startupReady), url: location.href, text: document.body.innerText.slice(-2000) })');
  assert.equal(startup.ready, true, JSON.stringify({ startup, exceptions }));

  const scene = await evaluate(async () => {
    const s = window.simulator;
    // This is a controlled-pose check: stop scheduling normal scene frames
    // while advancing bounded physics samples and rendering explicit snapshots.
    s.animate = () => {};
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    s.integratePhysics = () => {};
    s.setTimeOfDay(12, { persist: false, userChoice: false });
    s.position.set(0, 3000, 0);
    s.linearVelocity.set(0, 0, -250);
    s.quaternion.identity();
    s.renderPose.reset(s.position, s.quaternion);
    Object.assign(s.telemetry, { onGround: false, iasKnots: 350, altitudeFt: 9840 });
    const combat = s.missileCombat;
    combat.reset();
    s.missileCombatView.clear();
    const update = combat.update.bind(combat);
    const world = s.combatWorld();
    update(1 / 120, world);
    const target = combat.targets[0];
    const initial = target.position.clone();
    const missile = combat.fire(world);
    // Controlled real-system plume encounter, not a target-ID warning shortcut.
    missile.position.copy(target.position).add({ x: 0, y: 0, z: 3000 });
    missile.velocity.set(0, 0, -300);
    let reaction = null;
    let maxLoadG = 0;
    for (let i = 0; i < 360; i++) {
      update(1 / 120, world);
      maxLoadG = Math.max(maxLoadG, target.flight.aero.gForce);
      if (reaction === null && target.threatResponse.phase === 'evade') reaction = (i + 1) / 120;
    }
    // Hold this actual physics state for inspecting the rendered aircraft pose.
    combat.update = () => [];
    s.missileCombatView.sync(0);
    s.cameraSystem.setMode(1, true);
    s.cameraSystem.update = () => {};
    const view = s.missileCombatView.targetViews.get(target.id);
    const frame = () => {
      s.missileCombatView.sync(0);
      s.camera.position.copy(target.position).add({ x: 35, y: 14, z: 45 });
      s.camera.lookAt(target.position);
      s.renderer.render(s.scene, s.camera);
    };
    frame();
    window.banditEvasionProbe = { s, combat, target, update, world, frame };
    return { reaction, maxLoadG, phase: target.threatResponse.phase,
      movedM: initial.distanceTo(target.position), alive: target.alive,
      meshVisible: view.mesh.visible,
      meshPositionErrorM: view.mesh.position.distanceTo(target.position),
      meshQuaternionAgreement: Math.abs(view.mesh.quaternion.dot(target.quaternion)) };
  });
  assert.ok(scene.alive && scene.meshVisible);
  assert.ok(scene.reaction >= 0.65 && scene.phase === 'evade', JSON.stringify(scene));
  assert.ok(scene.maxLoadG < 9 && scene.movedM > 100);
  assert.equal(scene.meshPositionErrorM, 0);
  assert.ok(scene.meshQuaternionAgreement > 0.99999);
  await delay(500); // Allow exterior assets to settle before the screenshot.
  await evaluate('window.banditEvasionProbe.frame()');
  await screenshot(path.join(dir, 'bandit-evade.png'));
  console.log('Rendered evasion pose passed', JSON.stringify(scene));

  await evaluate('window.banditEvasionProbe.combat.missiles.length = 0');
  // Bound each CDP evaluation; a long simulation must not monopolize the page.
  for (let i = 0; i < 11; i++) {
    await evaluate(() => {
      for (let j = 0; j < 10 * 120; j++) window.banditEvasionProbe.target.update(1 / 120);
    });
  }
  const recovery = await evaluate(() => {
    const { target } = window.banditEvasionProbe;
    return { phase: target.threatResponse.phase, weight: target.threatResponse.weight,
      altitudeM: target.position.y, alive: target.alive };
  });
  assert.equal(recovery.phase, 'patrol');
  assert.ok(recovery.alive && recovery.weight < 0.01);
  console.log('Physical patrol recovery passed', JSON.stringify(recovery));
  await evaluate('window.banditEvasionProbe.frame()');
  await screenshot(path.join(dir, 'bandit-recovered.png'));

  // Rendered-scene assertions are complete. Run the bounded numerical matrix
  // in a lightweight same-origin page so scene rendering cannot stall CDP.
  await send('Page.navigate', { url: `${origin}/scripts/lib/banditEvasionScenario.mjs` });
  await send('Page.bringToFront');
  await delay(200);
  console.log('Rendered evasion/recovery passed; running isolated numerical comparisons');
  const comparison = await evaluate(async () => {
    const { compareBanditEngagements } = await import('/scripts/lib/banditEvasionScenario.mjs');
    return compareBanditEngagements();
  });
  assert.equal(comparison.length, 18);
  assert.ok(comparison.some(r => r.evasion && r.reactionSeconds !== null));
  assert.ok(comparison.every(r => Number.isFinite(r.minSampledSeparationM)));
  const energy = await evaluate(async () => {
    const { compareMissileEnergyEnvelope, measureMissileCoast } = await import('/scripts/lib/banditEvasionScenario.mjs');
    return { ...measureMissileCoast(), envelope: compareMissileEnergyEnvelope({ idealSensor: true }), sensorModel: 'ideal-fixture' };
  });
  assert.ok(energy.turnSpeedMps < energy.straightSpeedMps - 40, 'maneuver energy loss in browser');
  assert.ok(energy.thinDeliveredMps2 <= energy.thinAvailableMps2, 'current aerodynamic authority');
  assert.equal(energy.envelope.length, 24);
  assert.ok(energy.envelope.some(r => r.terminal === 'hit'));
  assert.ok(energy.envelope.some(r => r.terminal === 'miss-expired'));
  assert.ok(energy.envelope.some(r => r.controlLimitedSeconds > 0.5));
  assert.deepEqual(exceptions, [], 'no browser runtime exceptions');
  const report = { gpu, scene, recovery, comparison, energy, exceptions };
  writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ scene, recovery, cases: comparison.length,
    energy: { straightSpeedMps: energy.straightSpeedMps, turnSpeedMps: energy.turnSpeedMps,
      envelopeCases: energy.envelope.length,
      envelopeHits: energy.envelope.filter(r => r.terminal === 'hit').length }, artifacts: dir }, null, 2));
});
