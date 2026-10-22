import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5175;
const CDP_PORT = 9466;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/bli/.gemini/antigravity-cli/brain/4a05b289-685e-4af6-9cf1-c4a6ca34e5f7';

async function main() {
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
  console.log('🌐 Server ready. Spawning Headless Chrome...');

  const profileDir = `/tmp/chrome-lukla-showcase-${Date.now()}`;
  const chromeArgs = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ];

  const chrome = spawn('google-chrome-stable', chromeArgs, { stdio: 'ignore' });

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
      if (res?.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res?.result?.value;
    };

    const takeScreenshot = async (filename) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.resolve(process.cwd(), filename), buf);
      if (fs.existsSync(ARTIFACT_DIR)) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
      }
      console.log(`📸 Saved: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting 4s for simulator to initialize WebGL...');
    await new Promise(r => setTimeout(r, 4000));

    // Stop demo flight if running
    await evalJs(`
      if (window.simulator.demoDirector && window.simulator.demoDirector.isActive) {
        window.simulator.demoDirector.stop();
        window.simulator.gameFlow?.enterFlight();
      }
    `);

    // 1. Switch to Nepal Lukla Airport and set Runway 06 preset
    console.log('🏔️ Scene 1: Runway 06 Cockpit View (11.7% uphill incline)...');
    await evalJs(`
      window.simulator.setAirport('lukla');
      window.simulator.setPreset('runway');
      window.simulator.cameraSystem.setMode(0); // COCKPIT view
      // Look slightly up to view the sloped runway and mountain wall
      window.simulator.cameraSystem.lookPitch = -0.05;
      window.simulator.cameraSystem.lookYaw = 0.08;
    `);
    await new Promise(r => setTimeout(r, 2000));
    await takeScreenshot('lukla_runway06_cockpit.png');

    // 2. Tower View
    console.log('🗼 Scene 2: Control Tower View (looking down at runway and apron)...');
    await evalJs(`
      window.simulator.cameraSystem.setMode(3); // TOWER view
    `);
    await new Promise(r => setTimeout(r, 1500));
    await takeScreenshot('lukla_tower_view.png');

    // 3. Wing View from Apron
    console.log('✈️ Scene 3: Wing View over Himalayas...');
    await evalJs(`
      window.simulator.cameraSystem.setMode(2); // WING view
    `);
    await new Promise(r => setTimeout(r, 1500));
    await takeScreenshot('lukla_wing_view.png');

    // 4. Canyon Approach - Cockpit
    console.log('🛬 Scene 4: Canyon Final Approach (Cockpit View)...');
    await evalJs(`
      window.simulator.setPreset('approach');
      window.simulator.cameraSystem.setMode(0); // COCKPIT view
      window.simulator.cameraSystem.lookPitch = -0.12;
      window.simulator.cameraSystem.lookYaw = 0.0;
    `);
    await new Promise(r => setTimeout(r, 2000));
    await takeScreenshot('lukla_canyon_cockpit.png');

    // 5. Canyon Approach - Chase
    console.log('🏔️ Scene 5: Canyon Final Approach (Exterior Chase View)...');
    await evalJs(`
      window.simulator.cameraSystem.setMode(1); // CHASE view
    `);
    await new Promise(r => setTimeout(r, 1500));
    await takeScreenshot('lukla_canyon_chase.png');

    // 6. Cliff Takeoff - Downhill Runway 24
    console.log('⚡ Scene 6: Runway 24 Cliff Edge Cockpit View...');
    await evalJs(`
      window.simulator.setPreset('cliff');
      window.simulator.cameraSystem.setMode(0); // COCKPIT view
      window.simulator.cameraSystem.lookPitch = -0.15;
    `);
    await new Promise(r => setTimeout(r, 1500));
    await takeScreenshot('lukla_cliff_cockpit.png');

    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    vite.kill('SIGKILL');
  }
}

main().catch(err => {
  console.error('Fatal error during capture:', err);
  process.exit(1);
});
