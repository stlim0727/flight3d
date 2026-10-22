import fs from 'node:fs';
import path from 'node:path';

const SIM_PORT = 5173;
const CHROME_PORT = 9222;
const SIM_URL = `http://localhost:${SIM_PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/8bc06807-dda2-4748-88be-25aecc7932e1';

const VIEWS = [
  {
    name: 'terrain_runway_mesa',
    label: '1. 활주로 09L 진입 경계 (Runway 09L Approach & Mesa Boundary)',
    camPos: [-1450, 22, 45],
    lookAt: [-1300, 14, 0]
  },
  {
    name: 'terrain_north_cliff',
    label: '2. 북측 급경사 절벽 (North Steep Cliff - Triplanar Mapping)',
    camPos: [1200, 180, -3200],
    lookAt: [1600, 280, -3900]
  },
  {
    name: 'terrain_south_shoreline',
    label: '3. 남측 해안선 & 모래사장 (South Coastal Beach & Shoreline)',
    camPos: [-500, 35, 1350],
    lookAt: [0, 8, 1750]
  },
  {
    name: 'terrain_20km_vista',
    label: '4. 20km 원경 고고도 파노라마 (20km Panoramic Vista at 4,000ft)',
    camPos: [-4000, 1400, 5000],
    lookAt: [500, 150, -1000]
  }
];

async function main() {
  console.log('🏔️ Capturing Terrain PBR & Triplanar Verification Viewpoints...');
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  // Create new tab in headless Chrome
  const newTabRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?${encodeURIComponent(SIM_URL)}`, { method: 'PUT' });
  if (!newTabRes.ok) {
    throw new Error(`Failed to create browser tab: ${newTabRes.statusText}`);
  }
  const tab = await newTabRes.json();
  console.log(`🔌 Created browser tab: ${tab.id}`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      consoleLogs.push(text);
      if (text.includes('Error') || text.includes('WARN')) {
        console.log(`[Browser Console] ${text}`);
      }
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for simulator to initialize
  console.log('⏳ Waiting for FlightSimulator and WebGL context initialization...');
  await new Promise(r => setTimeout(r, 2500));

  // Check WebGL errors or exceptions
  const evalRes = await send('Runtime.evaluate', {
    expression: `Boolean(window.simulator && window.simulator.terrain && window.simulator.renderer)`,
    returnByValue: true
  });
  console.log('Simulator initialized:', evalRes.result.value);

  // Stop demo director and lock cameraSystem so custom viewpoint camera stays fixed
  await send('Runtime.evaluate', {
    expression: `
      if (window.simulator.demoDirector) {
        window.simulator.demoDirector.stop();
        window.simulator.gameFlow?.enterFlight();
      }
      if (window.simulator.cameraSystem) {
        window.simulator.cameraSystem.update = () => {};
      }
      // Hide cockpit elements if any
      window.simulator.aircraft.setCockpitMode(false);
    `
  });

  const results = [];

  for (const v of VIEWS) {
    console.log(`\n📸 Pointing camera to: ${v.label}...`);
    // Position camera
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.simulator;
          sim.camera.position.set(${v.camPos[0]}, ${v.camPos[1]}, ${v.camPos[2]});
          sim.camera.lookAt(${v.lookAt[0]}, ${v.lookAt[1]}, ${v.lookAt[2]});
          sim.camera.updateMatrixWorld(true);
          sim.renderer.render(sim.scene, sim.camera);
        })();
      `
    });

    await new Promise(r => setTimeout(r, 800));

    // Capture screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const imgPath = path.join(ARTIFACT_DIR, `${v.name}.png`);
    fs.writeFileSync(imgPath, Buffer.from(shot.data, 'base64'));
    console.log(`   Saved: ${imgPath} (${(shot.data.length / 1024).toFixed(1)} KB)`);
    results.push({ name: v.name, path: imgPath, label: v.label });
  }

  // Test Quality Preset Switch (High vs Low)
  console.log('\n🔄 Testing Live Quality Preset Toggle in Browser...');
  const qualityTest = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const sim = window.simulator;
        const q0 = sim.terrain.getQuality();
        sim.terrain.setQuality('low');
        const q1 = sim.terrain.getQuality();
        const definesLow = sim.terrain.material.defines.QUALITY_LOW;
        sim.renderer.render(sim.scene, sim.camera);
        sim.terrain.setQuality('high');
        const q2 = sim.terrain.getQuality();
        const definesHigh = sim.terrain.material.defines.QUALITY_LOW;
        sim.renderer.render(sim.scene, sim.camera);
        return { q0, q1, q2, definesLow, definesHigh };
      })();
    `,
    returnByValue: true
  });
  console.log('Quality Preset Switch Test:', qualityTest.result.value);

  // Close tab and ws
  ws.close();
  await fetch(`http://127.0.0.1:${CHROME_PORT}/json/close/${tab.id}`);
  console.log('✅ Captured all verification viewpoints successfully!');
}

main().catch(err => {
  console.error('Fatal error in capture script:', err);
  process.exit(1);
});
