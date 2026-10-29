import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5195;
const CDP_PORT = 9485;
const SIM_URL = `http://localhost:${PORT}/`;
const WORKSPACE_DIR = process.cwd();

async function run() {
  console.log('🚀 Starting Vite preview/dev server on port ' + PORT);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: WORKSPACE_DIR,
    stdio: 'ignore',
    detached: true
  });

  const killTree = (p) => {
    if (!p) return;
    try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { try { p.kill('SIGKILL'); } catch (e2) {} }
  };

  // Wait for server to come up
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(SIM_URL);
      if (res.ok) break;
    } catch (e) {}
  }

  console.log('🌐 Spawning Headless Chrome with Vulkan GPU acceleration...');
  const profileDir = `/tmp/chrome-readme-refresh-${Date.now()}`;
  const chrome = spawn('google-chrome-stable', [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=vulkan',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ], { stdio: 'ignore', detached: true });

  let pageTarget = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
      pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
      if (pageTarget) break;
    } catch (e) {}
  }
  if (!pageTarget) {
    killTree(chrome);
    killTree(vite);
    throw new Error('CDP target not found');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(res => ws.onopen = res);

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const curId = id++;
    const handler = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id === curId) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res?.exceptionDetails) {
      throw new Error(`Browser JS Error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res?.result?.value;
  };

  const capture = async (filename, waitMs = 1200) => {
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    const outPath = path.join(WORKSPACE_DIR, filename);
    fs.writeFileSync(outPath, buf);
    console.log(`📸 Saved ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('⏳ Waiting for simulator initialization...');
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ready = await evalJs(`Boolean(window.simulator && window.simulator.aircraft && window.simulator.aircraft.cockpit && window.simulator.ships)`);
    if (ready) break;
  }
  console.log('✈️ Simulator ready! Beginning capture sequence...');

  // Dismiss any lobby/menu into flight
  await evalJs(`
    if (window.simulator.demoDirector) window.simulator.demoDirector.stop();
    window.simulator.gameFlow?.enterFlight();
    window.simulator.setAircraft('B738');
    window.simulator.setAirport('coastal');
    window.simulator.setPreset('runway');
    window.simulator.sky.setTimeOfDay(10.5); // Sunny morning daylight
  `);
  await new Promise(r => setTimeout(r, 1500));

  // 1. Cockpit Forward View (cockpit_view.png)
  console.log('Capturing cockpit_view.png...');
  await evalJs(`
    window.simulator.cameraSystem.setMode(0); // COCKPIT
    window.simulator.cameraSystem.lookYaw = 0.0;
    window.simulator.cameraSystem.lookPitch = -0.18;
    window.simulator.camera.fov = 60;
    window.simulator.camera.updateProjectionMatrix();
  `);
  await capture('cockpit_view.png', 1000);

  // 2. Cockpit Sunlight & Shadows (cockpit_sunlight_showcase.png)
  console.log('Capturing cockpit_sunlight_showcase.png...');
  await evalJs(`
    window.simulator.sky.setTimeOfDay(16.8); // Golden hour
    window.simulator.cameraSystem.lookYaw = -0.15;
    window.simulator.cameraSystem.lookPitch = -0.22;
    window.simulator.camera.fov = 60;
    window.simulator.camera.updateProjectionMatrix();
  `);
  await capture('cockpit_sunlight_showcase.png', 1200);

  // Restore midday daylight
  await evalJs(`window.simulator.sky.setTimeOfDay(11.0);`);

  // 6. Coastal Takeoff Roll (demo_takeoff_showcase.png)
  console.log('Capturing demo_takeoff_showcase.png...');
  await evalJs(`
    window.simulator.setPreset('runway');
    window.simulator.cameraSystem.setMode(1); // CHASE
    window.simulator.controls.throttle = 1.0;
    window.simulator.stepSimulation(3.0);
  `);
  await capture('demo_takeoff_showcase.png', 1200);

  // 7. Coastal Banking & Wing View (demo_coastal_banking_showcase.png)
  console.log('Capturing demo_coastal_banking_showcase.png...');
  await evalJs(`
    window.simulator.demoDirector.start();
    window.simulator.demoDirector.setStage(3); // COASTAL_BANK
  `);
  await capture('demo_coastal_banking_showcase.png', 2000);

  // 8. 3NM PAPI Final Approach (demo_approach_papi_showcase.png)
  console.log('Capturing demo_approach_papi_showcase.png...');
  await evalJs(`
    window.simulator.demoDirector.setStage(5); // FINAL_APPROACH
  `);
  await capture('demo_approach_papi_showcase.png', 2000);

  // Stop demo director
  await evalJs(`window.simulator.demoDirector.stop();`);

  // 9. Ocean Ships View (ocean_ships_view.png)
  console.log('Capturing ocean_ships_view.png...');
  await evalJs(`
    // Focus camera on the container cargo ship in coastal waters
    const cargo = window.simulator.ships.vessels.find(v => v.type === 'cargo') || window.simulator.ships.vessels[0];
    if (cargo) {
      const pos = cargo.mesh.position;
      window.simulator.camera.position.set(pos.x + 190, 48, pos.z + 180);
      window.simulator.camera.lookAt(pos.x, 12, pos.z);
      window.simulator.camera.fov = 55;
      window.simulator.camera.updateProjectionMatrix();
    }
  `);
  await capture('ocean_ships_view.png', 1500);

  // 10. Lukla Himalayan Airport (lukla-airport-showcase.png)
  console.log('Capturing lukla-airport-showcase.png...');
  await evalJs(`
    window.simulator.setAirport('lukla');
    window.simulator.setPreset('runway');
    window.simulator.cameraSystem.setMode(1); // CHASE
    window.simulator.stepSimulation(0.5);
  `);
  await capture('lukla-airport-showcase.png', 1500);

  // 11. Cessna 172 Skyhawk (cessna172_showcase.png)
  console.log('Capturing cessna172_showcase.png...');
  await evalJs(`
    window.simulator.setAirport('coastal');
    window.simulator.setAircraft('C172');
    window.simulator.setPreset('approach');
    window.simulator.cameraSystem.setMode(1); // CHASE
    window.simulator.sky.setTimeOfDay(12.0); // Noon
    window.simulator.stepSimulation(1.0);
  `);
  await capture('cessna172_showcase.png', 1500);

  // 12. Mobile Touch Controls (mobile_touch_controls_showcase.png)
  console.log('Capturing mobile_touch_controls_showcase.png...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: true
  });
  await evalJs(`
    window.simulator.setAircraft('B738');
    window.simulator.setPreset('cruise');
    window.simulator.cameraSystem.setMode(1); // CHASE
    if (window.simulator.touchControls) {
      window.simulator.touchControls.enable();
      window.simulator.touchControls.setThrottleValue(0.75);
      window.simulator.touchControls.controls.setTouchStick(0.3, 0.4);
      window.simulator.touchControls.updateStickTelemetry(0.3, 0.4);
    }
    window.simulator.stepSimulation(0.5);
  `);
  await capture('mobile_touch_controls_showcase.png', 1500);

  console.log('🎉 All 12 showcase images refreshed successfully!');

  ws.close();
  killTree(chrome);
  killTree(vite);
}

run().catch(err => {
  console.error('❌ Error during capture sequence:', err);
  process.exit(1);
});
