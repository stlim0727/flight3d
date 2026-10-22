import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5173;
const CDP_PORT = 9452;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/ad33c4b1-3b1c-4752-ad5e-b09f9794851b';

async function main() {
  console.log('💥 Launching Autonomous Crash & Explosion Test Suite...');
  const profileDir = path.resolve(process.cwd(), '.chrome-profile/crash');
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ];

  const chrome = spawn('google-chrome-stable', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', (d) => {
    const s = d.toString();
    if (s.includes('FATAL') || s.includes('ERROR:content') || s.includes('Crash')) {
      console.error('[Chrome Stderr]', s.trim());
    }
  });

  try {
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('CDP target not found');
    console.log(`🔌 Connected to CDP target: ${pageTarget.webSocketDebuggerUrl}`);

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    const pending = new Map();
    ws.addEventListener('close', () => {
      for (const [id, { reject }] of pending) {
        reject(new Error('WebSocket closed unexpectedly'));
      }
      pending.clear();
    });
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
      if (res.exceptionDetails) {
        const text = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
        throw new Error(text);
      }
      return res.result?.value;
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

    console.log('⏳ Waiting for simulator to initialize in browser DOM...');
    for (let i = 0; i < 40; i++) {
      try {
        const ready = await evalJs('typeof window.simulator !== "undefined" && window.simulator.aircraft !== undefined');
        if (ready) break;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }

    // Stop demo flight director and select coastal airport for coastal collision scenarios
    await evalJs(`
      if (window.simulator) {
        if (window.simulator.demoDirector) {
          window.simulator.demoDirector.stop();
        }
        window.simulator.gameFlow?.enterFlight();
        if (typeof window.simulator.setAirport === 'function') {
          window.simulator.setAirport('coastal');
        }
      }
    `);

    // =========================================================================
    // TEST 1: Airport Control Tower Collision
    // =========================================================================
    console.log('\n🗼 TEST 1: Control Tower Collision...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.resetCrash();
        // Position 80m South of Tower (tower is at x=120, z=280, height=83m) heading North (-Z) at 85 m/s
        sim.position.set(120, 65, 360);
        sim.linearVelocity.set(0, 0, -85);
        sim.quaternion.set(0, 0, 0, 1);
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.cameraSystem.setMode(1); // Chase view
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
      })()
    `);

    // Step simulation into tower
    await evalJs(`window.simulator.stepSimulation(1.2);`);
    await new Promise(r => setTimeout(r, 600));

    const towerCrashed = await evalJs(`Boolean(window.simulator.isCrashed && window.simulator.crashResult?.type === 'TOWER')`);
    const towerTitle = await evalJs(`document.getElementById('crash-title').textContent`);
    console.log(`   Tower Collision Detected: ${towerCrashed ? 'PASS ✅' : 'FAIL ❌'} [${towerTitle}]`);
    await takeScreenshot('crash_tower_showcase.png');

    // =========================================================================
    // TEST 2: Ocean Water Ditching / High-Speed Impact
    // =========================================================================
    console.log('\n🌊 TEST 2: Ocean Water Ditching Collision...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.resetCrash();
        // Over ocean bay (z=4200) diving into water surface (y=5m, Vy=-22m/s, Vx=60m/s)
        sim.position.set(400, 5, 4200);
        sim.linearVelocity.set(60, -22, 0);
        sim.quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
      })()
    `);

    await evalJs(`window.simulator.stepSimulation(0.8);`);
    await new Promise(r => setTimeout(r, 600));

    const waterCrashed = await evalJs(`Boolean(window.simulator.isCrashed && window.simulator.crashResult?.type === 'WATER')`);
    const waterTitle = await evalJs(`document.getElementById('crash-title').textContent`);
    console.log(`   Water Impact Detected: ${waterCrashed ? 'PASS ✅' : 'FAIL ❌'} [${waterTitle}]`);
    await takeScreenshot('crash_water_showcase.png');

    // =========================================================================
    // TEST 3: Mountain Ridge / Rolling Hill Terrain Collision
    // =========================================================================
    console.log('\n⛰️ TEST 3: Mountain Ridge Terrain Collision...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.resetCrash();
        // Find an actual rising mountainside outside the carved departure corridor.
        // Keep the CG clear of terrain while the forward nose probes hit the slope.
        let site = null;
        for (let z = -6000; z <= -1500 && !site; z += 100) {
          for (let x = -7000; x <= 7000; x += 100) {
            const groundH = sim.terrain.getHeight(x, z);
            const aheadH = sim.terrain.getHeight(x + 17.5, z);
            if (groundH > 120 && aheadH > groundH + 8 &&
                !sim.foliage.treeData.some(tree => Math.hypot(tree.x - x, tree.z - z) < 60) &&
                !sim.foliage.buildingData.some(building => Math.hypot(building.x - x, building.z - z) < 100)) {
              site = { x, z, y: groundH + 4 };
              break;
            }
          }
        }
        if (!site) throw new Error('No unobstructed mountain collision fixture found');
        sim.position.set(site.x, site.y, site.z);
        sim.linearVelocity.set(90, 0, 0);
        sim.quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
      })()
    `);

    await evalJs(`window.simulator.stepSimulation(1.0);`);
    await new Promise(r => setTimeout(r, 600));

    const terrainCrashed = await evalJs(`Boolean(window.simulator.isCrashed && window.simulator.crashResult?.type === 'TERRAIN')`);
    const terrainTitle = await evalJs(`document.getElementById('crash-title').textContent`);
    console.log(`   Mountain Terrain Collision: ${terrainCrashed ? 'PASS ✅' : 'FAIL ❌'} [${terrainTitle}]`);
    await takeScreenshot('crash_terrain_showcase.png');

    // =========================================================================
    // TEST 4: Downtown Skyscraper Collision
    // =========================================================================
    console.log('\n🏙️ TEST 4: City Skyscraper Collision...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.resetCrash();
        // Find a tall skyscraper in East Bay cluster
        const b = sim.foliage.buildingData.find(item => item.height > 60) || sim.foliage.buildingData[0];
        const startX = b.x - 45;
        const localGroundH = sim.terrain.getHeight(startX, b.z);
        const flightY = Math.max(localGroundH + 15, b.y + b.height * 0.5);
        sim.position.set(startX, flightY, b.z);
        sim.linearVelocity.set(75, 0, 0);
        sim.quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
      })()
    `);

    await evalJs(`window.simulator.stepSimulation(0.9);`);
    await new Promise(r => setTimeout(r, 600));

    const bldgCrashed = await evalJs(`Boolean(window.simulator.isCrashed && window.simulator.crashResult?.type === 'BUILDING')`);
    const bldgTitle = await evalJs(`document.getElementById('crash-title').textContent`);
    console.log(`   Skyscraper Collision: ${bldgCrashed ? 'PASS ✅' : 'FAIL ❌'} [${bldgTitle}]`);
    await takeScreenshot('crash_building_showcase.png');

    // =========================================================================
    // TEST 5: Forest Tree Collision & Clean Quick Restart
    // =========================================================================
    console.log('\n🌲 TEST 5: Tree Collision & Quick Restart...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.resetCrash();
        // Find a tall tree on flat terrain
        const t = sim.foliage.treeData.find(item => {
          const h1 = sim.terrain.getHeight(item.x - 15, item.z);
          const h2 = sim.terrain.getHeight(item.x, item.z);
          return Math.abs(h1 - h2) < 0.3 && item.height > 10;
        }) || sim.foliage.treeData[0];
        const startX = t.x - 12;
        const flightY = t.y + t.height * 0.65;
        sim.position.set(startX, flightY, t.z);
        sim.linearVelocity.set(55, 0, 0);
        sim.quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
      })()
    `);

    await evalJs(`window.simulator.stepSimulation(0.9);`);
    await new Promise(r => setTimeout(r, 600));

    const treeCrashed = await evalJs(`Boolean(window.simulator.isCrashed && window.simulator.crashResult?.type === 'TREE')`);
    const treeTitle = await evalJs(`document.getElementById('crash-title').textContent`);
    console.log(`   Tree Collision: ${treeCrashed ? 'PASS ✅' : 'FAIL ❌'} [${treeTitle}]`);
    await takeScreenshot('crash_tree_showcase.png');

    // Test Quick Restart
    console.log('\n🔄 Testing Quick Restart...');
    await evalJs(`window.simulator.resetCrash();`);
    await new Promise(r => setTimeout(r, 400));
    const restartOk = await evalJs(`
      Boolean(!window.simulator.isCrashed && document.getElementById('crash-overlay').style.display === 'none')
    `);
    console.log(`   Restart Cleanliness: ${restartOk ? 'PASS ✅' : 'FAIL ❌'}`);

    if (![towerCrashed, waterCrashed, terrainCrashed, bldgCrashed, treeCrashed, restartOk].every(Boolean)) {
      throw new Error('One or more collision/restart checks failed');
    }
    console.log('\n🎉 ALL COLLISION & EXPLOSION TESTS COMPLETED SUCCESSFULLY!');
    ws.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('Crash test runner error:', err);
  process.exit(1);
});
