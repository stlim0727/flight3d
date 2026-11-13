/**
 * Hardware-GPU browser check for the preceding Korean Air 653 traffic in the Jeju Air 2503
 * (jeju-bangkok-2503) departure: real simulator physics stepped deterministically, KE653 meshes
 * reused from the parked airliners, ground separation, traffic gates and framing screenshots.
 *
 *   APP_URL=http://127.0.0.1:5173/ CHROME_PATH=... GPU_ANGLE=d3d11|vulkan|metal node scripts/verify-incheon-preceding-flight.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const dir = process.env.ARTIFACT_DIR || '.cache/incheon-preceding-flight';
fs.mkdirSync(dir, { recursive: true });
const STAGE = { HOLD: 54, LINEUP: 55, CLEARANCE: 56, TAKEOFF: 57 };

await withBrowserSession({ path: '/', width: 1440, height: 900 }, async ({ evaluate, screenshot, exceptions, gpuAngle, delay }) => {
  const gpu = await evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const gl = canvas.getContext('webgl2');
    if (!gl) return { renderer: 'none' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    gl.clearColor(0.2, 0.6, 0.9, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER), pixel: [...pixel] };
  });
  console.log(`GPU (${gpuAngle}): ${gpu.renderer} pixel ${gpu.pixel}`);
  assert.doesNotMatch(gpu.renderer, /swiftshader|llvmpipe|software|none/i, 'hardware GPU renderer required');
  assert.deepEqual(gpu.pixel, [51, 153, 229, 255], 'GPU draws and reads back pixels');

  for (let i = 0; i < 240 && !(await evaluate('Boolean(window.simulator?.startupReady)')); i++) await delay(500);
  await evaluate(`(async () => {
    const s = window.simulator;
    s.demoDirector.stop(); s.gameFlow.isPhysicsFrozen = () => true; s.setAircraft('B738');
    await s.setAirport('incheon'); s.audio.setMuted(true);
    await s.currentAirport.parked.ready;
    s.gameFlow.enterFlight(); s.gameFlow.isPhysicsFrozen = () => true; // Harness steps physics itself.
    s.demoDirector.start('incheon', 'jeju-bangkok-2503');
    window.__traffic = { t: 0, minSeparation: Infinity, events: [], last: '' };
    window.__step = (seconds, until) => {
      const d = s.demoDirector, log = window.__traffic;
      for (let i = 0; i < seconds; i++) {
        s.stepSimulation(1); log.t++;
        const scenario = d.jejuBangkokScenario, flight = scenario.traffic?.[0];
        const key = d.currentStage + ':' + flight?.phase;
        if (key !== log.last) { log.events.push({ t: log.t, stage: d.currentStage, phase: flight?.phase }); log.last = key; }
        if (flight?.onGround && s.gear.onGround) log.minSeparation = Math.min(log.minSeparation, flight.separationFrom(s.position).horizontal);
        if (s.isCrashed || !d.isActive || (until && until(d, flight))) break;
      }
      return log.t;
    };
  })()`);
  await delay(1500);
  const initial = await evaluate(`(() => {
    const s = window.simulator, flight = s.demoDirector.jejuBangkokScenario.traffic[0], group = s.scene.getObjectByName('preceding-flight');
    return { id: flight.id, phase: flight.phase, visuals: Boolean(flight.visuals), meshes: group?.children[0].children.map(c => c.name),
      sharedGeometry: group?.getObjectByName('preceding-flight-body').geometry === s.currentAirport.parked.assets.geometry };
  })()`);
  assert.equal(initial.id, 'KE653');
  assert.equal(initial.phase, 'standby');
  assert.ok(initial.visuals, 'KE653 meshes attached');
  assert.ok(initial.sharedGeometry, 'KE653 reuses the parsed parked-airliner geometry');

  // Fixed camera framing, rendered once outside the live camera rig.
  const frame = async (name, eye, target) => {
    await evaluate(`(async () => {
      const s = window.simulator, flight = s.demoDirector.jejuBangkokScenario.traffic[0];
      const resolve = spec => spec === 'player' ? s.position.clone() : spec === 'traffic' ? flight.visuals.group.position.clone().setY(flight.visuals.group.position.y + 3) : spec;
      window.__restoreCamera ??= s.cameraSystem.update;
      s.cameraSystem.update = () => {};
      const target = resolve(${JSON.stringify(target)}), eye = ${eye};
      s.camera.position.set(eye.x, eye.y, eye.z); s.camera.lookAt(target.x, target.y, target.z); s.camera.updateMatrixWorld(true);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    await screenshot(path.join(dir, `${name}.png`));
    await evaluate(`window.simulator.cameraSystem.update = window.__restoreCamera`);
  };

  await evaluate(`window.__step(900, d => d.currentStage === ${STAGE.HOLD})`);
  const hold = await evaluate(`(() => { const s = window.simulator, f = s.demoDirector.jejuBangkokScenario.traffic[0];
    return { stage: s.demoDirector.currentStage, phase: f.phase, separation: f.separationFrom(s.position).horizontal }; })()`);
  assert.equal(hold.stage, STAGE.HOLD, 'player reached hold short');
  assert.ok(['lineup', 'roll'].includes(hold.phase), `KE653 has left hold short when the player arrives (${hold.phase})`);
  // Over the player's shoulder at hold short, looking at KE653 on the runway entry.
  const behind = `(() => { const p = window.simulator.position, f = window.simulator.demoDirector.jejuBangkokScenario.traffic[0].pose;
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz); return { x: p.x - dx / d * 45, y: p.y + 14, z: p.z - dz / d * 45 }; })()`;
  await frame('hold-short-ke653', behind, 'traffic');

  await evaluate(`window.__step(300, (d, f) => d.currentStage > ${STAGE.HOLD} || f.phase === 'roll')`);
  await evaluate(`window.__step(300, (d, f) => d.currentStage > ${STAGE.HOLD})`);
  const lineup = await evaluate(`(() => { const s = window.simulator, f = s.demoDirector.jejuBangkokScenario.traffic[0];
    return { stage: s.demoDirector.currentStage, phase: f.phase }; })()`);
  assert.equal(lineup.stage, STAGE.LINEUP);
  assert.ok(['roll', 'climb'].includes(lineup.phase), `player lines up only once KE653 is rolling (${lineup.phase})`);

  await evaluate(`window.__step(300, (d, f) => f.phase === 'climb' && f.height > 25)`);
  const side = `(() => { const f = window.simulator.demoDirector.jejuBangkokScenario.traffic[0].pose;
    return { x: f.x + Math.cos(f.heading) * 160 - Math.sin(f.heading) * 60, y: 12 + f.y, z: f.z + Math.sin(f.heading) * 160 + Math.cos(f.heading) * 60 }; })()`;
  await frame('ke653-climb-out', side, 'traffic');
  const climb = await evaluate(`(() => { const f = window.simulator.demoDirector.jejuBangkokScenario.traffic[0];
    return { gearVisible: f.visuals.gear.visible, pitchDeg: f.pitch * 180 / Math.PI, height: f.height }; })()`);
  assert.equal(climb.gearVisible, false, 'gear retracted after liftoff');

  await evaluate(`window.__step(1200)`);
  const result = await evaluate(`(() => { const s = window.simulator, r = s.demoDirector.jejuBangkokScenario.result, log = window.__traffic;
    return { status: r.status, reason: r.reason, stages: r.stages, traffic: r.traffic, elapsed: r.elapsedSeconds, crashed: s.isCrashed,
      minSeparation: log.minSeparation, events: log.events, leftover: Boolean(s.scene.getObjectByName('preceding-flight')) }; })()`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ gpu, gpuAngle, initial, hold, lineup, climb, result, exceptions }, null, 2));
  assert.equal(result.crashed, false);
  assert.equal(result.status, 'completed', `scenario ${result.status} ${result.reason ?? ''}`);
  assert.ok(result.minSeparation >= 60, `ground separation ${result.minSeparation.toFixed(1)} m`);
  assert.equal(result.leftover, false, 'KE653 removed with the scenario');
  assert.deepEqual(exceptions, []);
  console.log(`completed in ${result.elapsed.toFixed(0)} s sim; min ground separation ${result.minSeparation.toFixed(1)} m; artifacts in ${dir}`);
});
