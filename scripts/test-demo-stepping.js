import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 5173;
const CDP_PORT = 9462;
const SIM_URL = `http://localhost:${PORT}/`;

async function testDemo() {
  console.log('🛫 Testing Autonomous Demo Flight across all 6 stages...');
  const profileDir = `/tmp/chrome-demo-test-${Date.now()}`;
  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    SIM_URL
  ];

  const chrome = spawn('/usr/bin/google-chrome', args, { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2000));

  const versionRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const targets = await versionRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };
  await new Promise(r => ws.onopen = r);

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  for (let i = 0; i < 40; i++) {
    const ready = await evaluate('typeof window.simulator !== "undefined" && window.simulator.aircraft !== undefined');
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // Ensure demo flight is active
  await evaluate('window.simulator.demoDirector.start(); window.simulator.gameFlow.enterFlight();');
  await evaluate(`(() => {
    const sim = window.simulator;
    window.__touchdowns = [];
    const orig = sim.gear.update.bind(sim.gear);
    sim.gear.update = (...args) => {
      const result = orig(...args);
      for (const t of result.touchdownContacts || []) {
        window.__touchdowns.push({ id: t.id, sink: Number(t.sinkRate.toFixed(2)) });
      }
      return result;
    };
  })()`);

  // Step simulation in 0.25s slices until the demo hands control back
  const totalSimSeconds = 220;
  const sliceDt = 0.25;
  const numSlices = Math.round(totalSimSeconds / sliceDt);
  let prevHdg = null;
  let prevStage = null;
  const samples = [];

  for (let i = 0; i < numSlices; i++) {
    const simTime = (i * sliceDt).toFixed(2);
    const data = await evaluate(`
      (() => {
        const sim = window.simulator;
        sim.stepSimulation(${sliceDt});
        const d = sim.demoDirector;
        const tel = sim.telemetry;
        const cam = sim.cameraSystem;
        return {
          stage: d.currentStage,
          stageTimer: d.stageTimer.toFixed(1),
          active: d.isActive,
          camMode: cam.getModeName(),
          pos: { x: sim.position.x.toFixed(1), y: sim.position.y.toFixed(1), z: sim.position.z.toFixed(1) },
          ias: Math.round(tel.iasKnots),
          alt: Math.round(tel.altitudeFt),
          pitch: tel.pitchDeg.toFixed(1),
          roll: tel.rollDeg.toFixed(1),
          hdg: Math.round(tel.headingDeg),
          gForce: tel.gForce.toFixed(2),
          isStalled: tel.isStalled,
          aileron: sim.controls.aileron.toFixed(3),
          virtAil: (sim.controls.virtualAileron || 0).toFixed(3),
          angVelZ: sim.angularVelocity.z.toFixed(4),
          isCrashed: sim.isCrashed,
          crashDesc: sim.crashResult ? sim.crashResult.description : null,
          groundSpeed: Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z),
          sinkRate: sim.linearVelocity.y,
          contactStates: sim.gear.contacts.map(c => c.damageState).join(','),
          contactDamage: Math.max(...sim.gear.contacts.map(c => c.damage)),
          landingIncident: sim.landingIncident,
          reverser: Number(sim.engines.reverserDeployment.toFixed(2)),
          brakes: Number(sim.gear.brakes.toFixed(2)),
          spoilers: Number(sim.aero.spoilers || 0),
          onGround: tel.onGround
        };
      })()
    `);

    samples.push(data);
    if (!data.active && samples.filter(s => !s.active).length > 4) break;

    let hdgDiff = 0;
    const isStageChange = prevStage !== null && prevStage !== data.stage;
    if (prevHdg !== null && !isStageChange) {
      hdgDiff = Math.abs(((data.hdg - prevHdg + 540) % 360) - 180);
    }

    if (i % 4 === 0 || (!isStageChange && hdgDiff > 25) || Math.abs(parseFloat(data.roll)) > 45) {
      console.log(`[T=${simTime}s][Stage ${data.stage} | ${data.camMode}] Hdg:${data.hdg}°(Δ${hdgDiff}°) Roll:${data.roll}° Pitch:${data.pitch}° Alt:${data.alt}ft IAS:${data.ias}kt G:${data.gForce}G`);
      if (!isStageChange && (hdgDiff > 25 || Math.abs(parseFloat(data.roll)) > 45)) {
        console.warn(`🚨 ABNORMAL MOTION at T=${simTime}s! Roll=${data.roll}°, HdgDiff=${hdgDiff}°`);
      }
      if (data.isCrashed) {
        console.warn(`🚨 CRASH DETECTED at T=${simTime}s! Reason: ${data.crashDesc}`);
      }
    }

    prevHdg = data.hdg;
    prevStage = data.stage;
  }

  const touchdowns = await evaluate('window.__touchdowns');
  const last = samples.at(-1);
  console.log('Touchdown sink rates:', JSON.stringify(touchdowns));
  console.log('Final:', JSON.stringify({
    stage: last.stage, active: last.active, x: last.pos.x, groundSpeed: last.groundSpeed.toFixed(2),
    contactStates: last.contactStates, contactDamage: last.contactDamage,
    landingIncident: last.landingIncident, brakes: last.brakes, reverser: last.reverser
  }));

  assert.equal(last.active, false, 'the demo must finish and hand control back to the player');
  assert.equal(last.isCrashed, false, 'the demo must not crash');
  assert.equal(last.landingIncident, false, 'the demo landing must not damage the gear');
  assert.equal(last.contactStates, 'normal,normal,normal', 'every gear leg must land undamaged');
  assert.equal(last.contactDamage, 0, 'no accumulated gear damage');
  assert.ok(touchdowns.length >= 2, `the demo must land on the runway, saw ${JSON.stringify(touchdowns)}`);
  assert.ok(Math.max(...touchdowns.map(t => t.sink)) < 2.8,
    `touchdown sink ${JSON.stringify(touchdowns)} must stay under the nose gear impact limit`);
  assert.ok(samples.some(s => s.reverser > 0.5), 'the rollout must actually deploy reverse thrust');
  assert.ok(samples.some(s => s.spoilers > 0.5 && s.onGround), 'the rollout must deploy spoilers on the ground');
  assert.ok(last.groundSpeed < 0.5, `the airframe must be stationary at handoff, got ${last.groundSpeed} m/s`);
  assert.ok(Math.abs(parseFloat(last.pos.x)) <= 1600, `the airframe must stop on the runway, x=${last.pos.x}`);
  assert.equal(last.brakes, 1, 'the demo must leave the wheel brakes held at handoff');

  ws.close();
  chrome.kill('SIGKILL');
  console.log('✅ Demo test finished.');
}

testDemo().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
