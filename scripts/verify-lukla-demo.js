import { spawn } from 'node:child_process';

const PORT = 5176;
const CDP_PORT = 9467;
const SIM_URL = `http://localhost:${PORT}/`;

async function testLuklaDemo() {
  console.log('🚀 Starting Vite preview server on port ' + PORT);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore'
  });

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const resp = await fetch(SIM_URL);
      if (resp.ok) break;
    } catch (e) {}
  }

  const profileDir = `/tmp/chrome-lukla-demo-${Date.now()}`;
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

  const chrome = spawn('google-chrome-stable', args, { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('CDP target not found');
    console.log(`🔌 Connected to CDP: ${pageTarget.webSocketDebuggerUrl}`);

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res?.exceptionDetails) {
        const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
        throw new Error(`Browser JS Error: ${desc}`);
      }
      return res?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting 4s for simulator to initialize WebGL...');
    await new Promise(r => setTimeout(r, 4000));

    // Verify initial airport is Lukla and demo flight is active
    const state = await evalJs(`
      (() => {
        const sim = window.simulator;
        return {
          activeAirport: sim.activeAirport,
          demoActive: sim.demoDirector.isActive,
          demoAirport: sim.demoDirector.activeDemoAirport,
          stage: sim.demoDirector.currentStage
        };
      })()
    `);

    console.log('📊 Simulator Initial State:', JSON.stringify(state, null, 2));

    if (state.activeAirport !== 'lukla') {
      throw new Error(`Expected activeAirport to be 'lukla', got '${state.activeAirport}'`);
    }
    if (!state.demoActive) {
      throw new Error('Expected demoDirector.isActive to be true');
    }
    await evalJs('window.simulator.gameFlow.enterFlight();');
    if (state.demoAirport !== 'lukla') {
      throw new Error(`Expected demoDirector.activeDemoAirport to be 'lukla', got '${state.demoAirport}'`);
    }

    // Step simulation across all 5 demo stages through touchdown and safe stop
    const stagesSeen = new Set();
    const maxSteps = 620; // up to 155s of sim time (0.25s per step) for full continuous circuit to safe stop
    let completed = false;

    for (let step = 0; step < maxSteps; step++) {
      const stepData = await evalJs(`
        (() => {
          const sim = window.simulator;
          sim.stepSimulation(0.25);
          const d = sim.demoDirector;
          const tel = sim.telemetry;
          const pos = sim.position;
          const groundH = sim.currentTerrain ? sim.currentTerrain.getHeight(pos.x, pos.z) : 0;
          return {
            stage: d.currentStage,
            stageTimer: d.stageTimer.toFixed(1),
            ias: Math.round(tel.iasKnots),
            alt: Math.round(tel.altitudeFt),
            pitch: tel.pitchDeg.toFixed(1),
            roll: tel.rollDeg.toFixed(1),
            heading: Math.round(tel.headingDeg),
            aileron: sim.controls?.aileron?.toFixed(2),
            rudder: sim.controls?.rudder?.toFixed(2),
            w: Math.round(pos.x * 0.529919 + pos.z * 0.848048),
            s: Math.round(pos.x * 0.848048 - pos.z * 0.529919),
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            z: Math.round(pos.z),
            groundH: Math.round(groundH),
            clearance: Math.round(pos.y - groundH),
            isCrashed: sim.isCrashed,
            crashDesc: sim.crashResult ? sim.crashResult.description : null,
            touchdown: tel.touchdown,
            onGround: tel.onGround,
            isStalled: sim.aero?.isStalled,
            alpha: (THREE.MathUtils.radToDeg(sim.aero?.alpha || 0)).toFixed(1),
            elev: sim.controls?.elevator?.toFixed(2),
            virtElev: sim.controls?.virtualElevator?.toFixed(2),
            trim: sim.controls?.pitchTrim?.toFixed(1)
          };
        })()
      `);

      stagesSeen.add(stepData.stage);

      if (step % 8 === 0 || stepData.stage === 4 || stepData.stage === 5 || stepData.isCrashed) {
        console.log(`⏱️ T=${(step * 0.25).toFixed(1)}s: Stg ${stepData.stage}, IAS:${stepData.ias}kt, Alt:${stepData.alt}ft, Ptch:${stepData.pitch}°, Roll:${stepData.roll}°, Hdg:${stepData.heading}°, Ail:${stepData.aileron}, Rud:${stepData.rudder}, s:${stepData.s}m, w:${stepData.w}m, Grnd:${stepData.groundH}m, Clr:${stepData.clearance}m, Crashed:${stepData.isCrashed}`);
      }

      if (stepData.isCrashed) {
        throw new Error(`Plane crashed during demo flight! Stage ${stepData.stage} at (${stepData.x},${stepData.y},${stepData.z}) vs Ground ${stepData.groundH}m: ${stepData.crashDesc}`);
      }

      if (stepData.stage === 5 || (stepData.stage === -1 && stagesSeen.has(4))) {
        completed = true;
        console.log(`🎉 Demo flight reached COMPLETED stage at T=${(step * 0.25).toFixed(1)}s!`);
        break;
      }
    }

    // Verify that all flight stages (takeoff, climb, cruise, approach, touchdown) were traversed
    const expectedStages = [0, 1, 2, 3, 4];
    for (const stg of expectedStages) {
      if (!stagesSeen.has(stg)) {
        throw new Error(`Demo did not transition through expected stage ${stg}. Stages traversed: ${[...stagesSeen].join(', ')}`);
      }
    }

    if (!completed) {
      throw new Error(`Demo flight did not reach complete stop within step budget!`);
    }

    console.log('✅ Lukla Demo Flight verification successfully passed!');
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    vite.kill('SIGKILL');
  }
}

testLuklaDemo().catch(err => {
  console.error('❌ Error during demo verification:', err);
  process.exit(1);
});
