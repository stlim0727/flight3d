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

  // Step simulation in 0.25s slices for 125 seconds of simulation time
  const totalSimSeconds = 125;
  const sliceDt = 0.25;
  const numSlices = Math.round(totalSimSeconds / sliceDt);
  let prevHdg = null;
  let prevStage = null;

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
          crashDesc: sim.crashResult ? sim.crashResult.description : null
        };
      })()
    `);

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

  ws.close();
  chrome.kill('SIGKILL');
  console.log('✅ Demo test finished.');
}

testDemo().catch(console.error);
