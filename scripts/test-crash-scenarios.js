import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 5173);
const CDP_PORT = Number(process.env.CHROME_DEBUG_PORT || process.env.CDP_PORT || 9452);
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

  const externalBrowser = process.env.CHROME_DEBUG_PORT;
  const chrome = externalBrowser ? null : spawn(process.env.CHROME_BIN || 'google-chrome-stable', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome?.stderr.on('data', (d) => {
    const s = d.toString();
    if (s.includes('FATAL') || s.includes('ERROR:content') || s.includes('Crash')) {
      console.error('[Chrome Stderr]', s.trim());
    }
  });

  let ownedTarget;
  try {
    if (externalBrowser) {
      ownedTarget = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(SIM_URL)}`, { method: 'PUT' })).json();
    }
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => ownedTarget ? t.id === ownedTarget.id : t.url.includes(String(PORT)) && t.type === 'page');
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
      if (filename.startsWith('crash_') && process.env.CRASH_SCREENSHOTS === '0') return;
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.resolve(process.cwd(), filename), buf);
      if (fs.existsSync(ARTIFACT_DIR)) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
      }
      console.log(`📸 Saved: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
    };

    const browserErrors = [];
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown' ||
          (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !message.params.entry.url?.endsWith('/favicon.ico'))) {
        browserErrors.push(message.params);
      }
    });
    await send('Log.enable');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    console.log('⏳ Waiting for simulator to initialize in browser DOM...');
    let simulatorReady = false;
    for (let i = 0; i < 360; i++) {
      try {
        const ready = await evalJs('typeof window.simulator !== "undefined" && window.simulator.startupReady && window.simulator.aircraft !== undefined && !window.simulator.aircraft.loadingGltf && !window.simulator.aircraft.cockpit?.cockpitModelLoading');
        if (ready) { simulatorReady = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }

    if (!simulatorReady) throw new Error('Simulator failed to initialize: ' + JSON.stringify(browserErrors));

    console.log('WebGL renderer:', await evalJs(`(() => {
      const gl = window.simulator.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    })()`));

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

    // Detection and effects must share the velocity preserved before contact impulses.
    await evalJs(`(() => {
      const sim = window.simulator;
      const detect = sim.collisionDetector.checkCollision.bind(sim.collisionDetector);
      const trigger = sim.triggerCrash.bind(sim);
      sim.impactVelocityChecks = { crashes: 0, contactResponses: 0 };
      let incoming;
      sim.collisionDetector.checkCollision = (...args) => {
        const result = detect(...args);
        if (result) incoming = args[2].clone();
        return result;
      };
      sim.triggerCrash = (result, velocity) => {
        if (!velocity || !incoming || velocity.distanceTo(incoming) > 1e-8) {
          throw new Error('Impact effects did not receive the pre-contact velocity');
        }
        sim.impactVelocityChecks.crashes++;
        if (velocity.distanceTo(sim.linearVelocity) > 1e-6) sim.impactVelocityChecks.contactResponses++;
        let emittedVelocity;
        const spawn = sim.explosionSystem.spawnExplosion;
        sim.explosionSystem.spawnExplosion = function(crash, v) {
          emittedVelocity = v?.clone();
          return spawn.call(this, crash, v);
        };
        try { trigger(result, velocity); }
        finally { sim.explosionSystem.spawnExplosion = spawn; }
        if (!emittedVelocity || emittedVelocity.distanceTo(incoming) > 1e-8) {
          throw new Error('Impact effects used a velocity changed by the contact response');
        }
      };
    })()`);

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
    const breakupState = await evalJs(`(() => {
      const sim = window.simulator;
      return { pieces: sim.aircraftBreakup.pieces.length,
        hidden: !sim.aircraft.group.visible,
        exterior: sim.cameraSystem.mode === 1 && !!sim.cameraSystem.crashView,
        finite: sim.aircraftBreakup.pieces.every(p => p.object.position.toArray().every(Number.isFinite)) };
    })()`);
    if (breakupState.pieces < 4 || !breakupState.hidden || !breakupState.exterior || !breakupState.finite) {
      throw new Error(`Invalid aircraft breakup: ${JSON.stringify(breakupState)}`);
    }
    console.log('   Exterior crash camera and separated airframe: PASS', breakupState);
    // Capture the whole scene even when ordinary crash screenshots are disabled.
    await takeScreenshot('aircraft_breakup_exterior.png');
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

    // =========================================================================
    // TEST 6: Off-Runway Ground Excursion Collision
    // =========================================================================
    console.log('\n🚜 TEST 6: Off-Runway Ground Excursion...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.resetCrash();
        // Position in grass north of Runway 09L at z = 70m, rolling at 45 m/s
        sim.position.set(-1000, 15.5, 70);
        sim.linearVelocity.set(45, 0, 0);
        sim.quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
      })()
    `);

    await evalJs(`window.simulator.stepSimulation(0.5);`);
    await new Promise(r => setTimeout(r, 600));

    const excursionCrashed = await evalJs(`Boolean(window.simulator.isCrashed && window.simulator.crashResult?.type === 'TERRAIN')`);
    const excursionTitle = await evalJs(`document.getElementById('crash-title').textContent`);
    console.log(`   Off-Runway Excursion: ${excursionCrashed ? 'PASS ✅' : 'FAIL ❌'} [${excursionTitle}]`);
    await takeScreenshot('crash_excursion_showcase.png');

    // Menu open/close after crash must hold the post-crash scene without repeating the crash.
    const menuRoundTrip = await evalJs(`(() => {
      const sim = window.simulator;
      const crashesBefore = sim.impactVelocityChecks.crashes;
      document.getElementById('menu-toggle').click();
      const inLobby = document.body.dataset.flow === 'lobby'
        && sim.isCrashed
        && sim.aircraftBreakup.pieces.length > 0
        && getComputedStyle(document.getElementById('crash-overlay')).display === 'none';
      document.getElementById('menu-toggle').click();
      sim.stepSimulation(0.5);
      const backInFlight = document.body.dataset.flow === 'flight'
        && sim.isCrashed
        && sim.aircraftBreakup.pieces.length > 0
        && getComputedStyle(document.getElementById('crash-overlay')).display !== 'none'
        && sim.impactVelocityChecks.crashes === crashesBefore;
      return { inLobby, backInFlight, crashesBefore, crashesAfter: sim.impactVelocityChecks.crashes };
    })()`);
    if (!menuRoundTrip.inLobby || !menuRoundTrip.backInFlight) {
      throw new Error('Crash menu open/close repeated or lost crash state: ' + JSON.stringify(menuRoundTrip));
    }
    console.log('   Crash Menu Open/Close Preservation: PASS ✅', JSON.stringify(menuRoundTrip));

    // Test Quick Restart
    console.log('\n🔄 Testing Quick Restart...');
    await evalJs(`window.simulator.resetCrash();`);
    await new Promise(r => setTimeout(r, 400));
    const restartOk = await evalJs(`
      Boolean(!window.simulator.isCrashed && document.getElementById('crash-overlay').style.display === 'none')
    `);
    console.log(`   Restart Cleanliness: ${restartOk ? 'PASS ✅' : 'FAIL ❌'}`);

    if (![towerCrashed, waterCrashed, terrainCrashed, bldgCrashed, treeCrashed, excursionCrashed, restartOk].every(Boolean)) {
      throw new Error('One or more collision/restart checks failed');
    }
    const velocityChecks = await evalJs('window.simulator.impactVelocityChecks');
    if (velocityChecks.crashes < 6 || velocityChecks.contactResponses < 1) {
      throw new Error('Missing crash/contact-response coverage: ' + JSON.stringify(velocityChecks));
    }
    console.log('Pre-contact impact velocity:', JSON.stringify(velocityChecks));

    const aircraftBreakups = await evalJs(`(() => {
      const sim = window.simulator;
      const results = [];
      for (const id of ['B738', 'C172', 'F16']) {
        sim.setAircraft(id);
        sim.setPreset('runway');
        sim.cameraSystem.userModeSelected = false;
        sim.cameraSystem.setMode(0);
        const vertexCount = source => {
          let count = 0;
          source.traverseVisible(mesh => {
            if (mesh.isMesh) count += mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
          });
          return count;
        };
        sim.aircraft.setCockpitMode(false);
        const gearVertices = id === 'B738' ? vertexCount(sim.aircraft.gearGroup) : 0;
        const expectedVertices = vertexCount(sim.aircraft.gltfGroup) + gearVertices;
        sim.aircraftBreakup.spawn(sim.aircraft, new window.THREE.Vector3(35, -8, 0));
        sim.cameraSystem.beginCrashView(sim.aircraftBreakup);
        sim.aircraftBreakup.update(0.6, sim.currentTerrain);
        sim.cameraSystem.updateCrashView(0, true);
        const pieces = sim.aircraftBreakup.pieces.length;
        const outside = sim.cameraSystem.mode === 1;
        const actualVertices = sim.aircraftBreakup.pieces.reduce((sum, p) => sum + vertexCount(p.object), 0);
        if (actualVertices !== expectedVertices || (id === 'B738' && gearVertices === 0)) {
          throw new Error('Missing exterior/gear geometry: ' + JSON.stringify({ id, expectedVertices, actualVertices, gearVertices }));
        }
        sim.aircraftBreakup.clear();
        sim.cameraSystem.endCrashView();
        const restored = sim.aircraft.group.visible && sim.cameraSystem.mode === 0 && !sim.cameraSystem.userModeSelected;
        if (!sim.cameraSystem.setMode(1)) throw new Error('Crash reset blocked automatic camera selection');
        results.push({ id, pieces, outside, gearVertices, restored });
      }
      sim.setAircraft('B738');
      return results;
    })()`);
    if (aircraftBreakups.some(r => r.pieces < 4 || !r.outside || !r.restored)) {
      throw new Error('Aircraft breakup/reset failed: ' + JSON.stringify(aircraftBreakups));
    }
    console.log('All loaded aircraft breakup/cockpit exit/reset:', JSON.stringify(aircraftBreakups));

    const fallback = await evalJs(`(() => {
      const sim = window.simulator;
      sim.setPreset('runway');
      const aircraft = sim.aircraft;
      const roots = [aircraft.gltfGroup, aircraft.fuselageGroup, aircraft.wingGroup,
        aircraft.tailGroup, aircraft.empennageGroup, aircraft.enginesGroup];
      sim.fallbackReviewVisibility = roots.map(object => [object, object.visible]);
      aircraft.useGltf = false;
      aircraft.setCockpitMode(false);
      aircraft.group.updateWorldMatrix(true, true);
      let mirroredMeshes = 0;
      aircraft.wingGroup.traverse(mesh => {
        if (mesh.isMesh && mesh.matrixWorld.determinant() < 0) mirroredMeshes++;
      });
      sim.cameraSystem.userModeSelected = false;
      sim.cameraSystem.setMode(0);
      sim.cameraSystem.showTemporaryView(5, 4.5);
      sim.aircraftBreakup.spawn(aircraft, new window.THREE.Vector3(35, -8, 0));
      sim.aircraftBreakup.update(0.6, sim.currentTerrain);
      sim.cameraSystem.beginCrashView(sim.aircraftBreakup);
      sim.renderScene();
      return { mirroredMeshes, pieces: sim.aircraftBreakup.pieces.length };
    })()`);
    if (fallback.mirroredMeshes < 2 || fallback.pieces < 4) throw new Error('Missing mirrored fallback coverage');
    await takeScreenshot('aircraft_breakup_fallback.png');
    const fallbackCameraRestored = await evalJs(`(() => {
      const sim = window.simulator;
      sim.aircraftBreakup.clear();
      sim.cameraSystem.endCrashView();
      sim.aircraft.useGltf = true;
      for (const [object, visible] of sim.fallbackReviewVisibility) object.visible = visible;
      delete sim.fallbackReviewVisibility;
      return sim.cameraSystem.mode === 0 && sim.cameraSystem.savedMode === null && sim.cameraSystem.temporaryViewTimer === 0;
    })()`);
    if (!fallbackCameraRestored) throw new Error('Temporary gear/crash/reset stranded the fallback camera');
    console.log('Mirrored fallback breakup and temporary-view reset:', JSON.stringify(fallback));

    const stepping = await evalJs(`(() => {
      const sim = window.simulator;
      sim.resetCrash();
      sim.position.set(120, 65, 360);
      sim.linearVelocity.set(0, 0, -85);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.set(0, 0, 0, 1);
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.aircraft.update(0, sim.telemetry);
      sim.cameraSystem.setMode(1, true);
      let ticks = 0, crashTick = 0, debrisTime = 0;
      const integrate = sim.integratePhysics;
      const update = sim.aircraftBreakup.update;
      sim.integratePhysics = function(dt) {
        const before = this.isCrashed;
        integrate.call(this, dt);
        ticks++;
        if (!before && this.isCrashed) crashTick = ticks;
      };
      sim.aircraftBreakup.update = function(dt, ...args) {
        debrisTime += dt;
        update.call(this, dt, ...args);
      };
      try { sim.stepSimulation(1); }
      finally { sim.integratePhysics = integrate; sim.aircraftBreakup.update = update; }
      if (!crashTick || Math.abs(debrisTime - (1 - crashTick * sim.physicsDt)) > 1e-8) {
        throw new Error('Incorrect post-impact time: ' + JSON.stringify({ crashTick, debrisTime }));
      }
      const postImpactTime = debrisTime;
      // Reuse exactly the same impact state; preset reset does not reset fuel,
      // engine spool or every animated component of the source model.
      const initial = sim.aircraftBreakup.pieces.map(p => ({
        position: p.object.position.clone(), quaternion: p.object.quaternion.clone(),
        velocity: p.velocity.clone(), spin: p.spin.clone()
      }));
      const run = durations => {
        sim.aircraftBreakup.pieces.forEach((p, i) => {
          p.object.position.copy(initial[i].position);
          p.object.quaternion.copy(initial[i].quaternion);
          p.velocity.copy(initial[i].velocity);
          p.spin.copy(initial[i].spin);
        });
        debrisTime = 0;
        sim.aircraftBreakup.update = function(dt, ...args) {
          debrisTime += dt;
          update.call(this, dt, ...args);
        };
        try { for (const duration of durations) sim.stepSimulation(duration); }
        finally { sim.aircraftBreakup.update = update; }
        if (Math.abs(debrisTime - 10) > 1e-8) throw new Error('Truncated debris time: ' + debrisTime);
        return sim.aircraftBreakup.pieces.flatMap(p => [
          ...p.object.position.toArray(), ...p.object.quaternion.toArray(), ...p.velocity.toArray(), ...p.spin.toArray()
        ]).concat(sim.camera.position.toArray(), sim.camera.quaternion.toArray());
      };
      const whole = run([10]);
      const grouped = run(Array(10).fill(1));
      if (!initial.length || whole.length !== grouped.length) throw new Error('Missing crash stepping coverage');
      const maxDifference = Math.max(...whole.map((v, i) => Math.abs(v - grouped[i])));
      if (!Number.isFinite(maxDifference) || maxDifference > 1e-7) throw new Error('Crash step grouping changed state: ' + maxDifference);
      sim.resetCrash();
      return { crashTick, postImpactTime, comparedSeconds: debrisTime, maxDifference };
    })()`);
    console.log('Deterministic post-impact debris and camera (10s vs 10 x 1s):', JSON.stringify(stepping));

    // Fixed camera and time samples expose effects without aircraft/HUD occlusion.
    await evalJs(`(async () => {
      const THREE = window.THREE;
      const { ExplosionSystem } = await import('/src/effects/ExplosionSystem.js');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x52677a);
      const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 500);
      camera.position.set(-40, 26, 50);
      camera.lookAt(5, 5, 0);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1280, 720);
      Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '99999', width: '100%', height: '100%' });
      document.body.appendChild(renderer.domElement);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: 0x28485b }));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      window.effectReview = { scene, camera, renderer, ground, effects: new ExplosionSystem(scene) };
    })()`);
    for (const type of ['WATER', 'TERRAIN', 'BUILDING']) {
      await evalJs(`(() => {
        const { effects, ground } = window.effectReview;
        effects.clear();
        ground.material.color.set('${type}' === 'WATER' ? 0x28485b : 0x655e4d);
        effects.spawnExplosion({ type: '${type}', point: new window.THREE.Vector3() }, new window.THREE.Vector3(75, -20, 0));
      })()`);
      for (const [label, steps] of [['early', 24], ['late', 120]]) {
        await evalJs(`(() => {
          const { effects, renderer, scene, camera } = window.effectReview;
          for (let i = 0; i < ${steps}; i++) effects.update(1 / 60);
          renderer.render(scene, camera);
          if (renderer.info.programs.some(p => p.diagnostics && !p.diagnostics.runnable)) throw new Error('Effect shader failed');
        })()`);
        await takeScreenshot('impact_' + type.toLowerCase() + '_' + label + '.png');
      }
    }
    await evalJs(`(() => {
      const { effects, renderer, ground } = window.effectReview;
      effects.dispose(); ground.geometry.dispose(); ground.material.dispose();
      renderer.dispose(); renderer.domElement.remove(); delete window.effectReview;
    })()`);
    if (browserErrors.length) throw new Error(JSON.stringify(browserErrors));
    console.log('\n🎉 ALL COLLISION & EXPLOSION TESTS COMPLETED SUCCESSFULLY!');
    ws.close();
  } finally {
    if (ownedTarget) await fetch(`http://localhost:${CDP_PORT}/json/close/${ownedTarget.id}`);
    chrome?.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('Crash test runner error:', err);
  process.exit(1);
});
