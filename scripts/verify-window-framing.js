import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 5195);
const CDP_PORT = 9465;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function main() {
  const profileDir = `/tmp/chrome-verify-framing-${Date.now()}`;
  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1440,1000',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    '--use-angle=vulkan',
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
        pageTarget = targets.find(t => t.type === 'page' && t.url.includes(String(PORT)));
        if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    assert.ok(pageTarget?.webSocketDebuggerUrl, 'Chrome page must be available');
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || msg.error));
          else resolve(msg.result);
        }
      } catch (e) {}
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalCode = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(`Eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
      }
      return res.result?.value;
    };

    const capture = async (name) => {
      await new Promise(r => setTimeout(r, 800));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.join(ARTIFACT_DIR, name), buf);
      console.log(`Saved: ${name}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Waiting for cockpit GLB to load naturally...');
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 300));
      const ready = await evalCode(`Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)`);
      if (ready) break;
    }

    // Freeze physics so screenshots and ray intersections share the same pose.
    await evalCode(`(() => {
      const s = window.simulator;
      s.demoDirector?.stop();
      s.gameFlow?.enterFlight();
      s.integratePhysics = () => {};
      s.cameraSystem.setMode(0);
      s.cameraSystem.enableCursorTrack = false;
      s.cameraSystem.photoCockpit = false;
    })()`);

    // Verify framing elements exist natively in the simulator
    const framingState = await evalCode(`(() => {
      const cp = window.simulator.aircraft.cockpit;
      return {
        loaded: cp.gltfCockpitLoaded,
        framingExists: Boolean(cp.gltfCockpitFraming),
        glassCount: cp.gltfGlassPanels?.length || 0,
        ceilingTrimExists: Boolean(cp.gltfCeilingTrim),
        bracketExists: Boolean(cp.gltfCompassBracket),
        cameraNear: window.simulator.camera.near
      };
    })()`);
    console.log('Native framing state:', framingState);
    assert.equal(framingState.loaded, true, 'Cockpit GLB must load');
    const shell = await evalCode(`(() => {
      const rows = [];
      window.simulator.aircraft.cockpit.gltfCockpitModel.traverse(o => {
        if (o.isMesh && o.name.startsWith('Body')) rows.push({
          name: o.name, visible: o.visible,
          sides: (Array.isArray(o.material) ? o.material : [o.material]).map(m => m.side)
        });
      });
      return rows;
    })()`);
    assert.ok(shell.length >= 6, 'Medium model must retain all six shell meshes');
    for (const mesh of shell) {
      assert.equal(mesh.visible, true, `${mesh.name} must remain visible`);
      assert.ok(mesh.sides.every(side => side === 2), `${mesh.name} must render inward faces`);
    }

    // 1. Captain Seated Default View
    await capture('verified_cockpit_window_framing_default.png');

    // 2. Captain Look Left (A-Pillar & #2L window)
    await evalCode(`(() => {
      window.simulator.cameraSystem.lookYaw = 0.42;
      window.simulator.cameraSystem.lookPitch = -0.12;
    })()`);
    await capture('verified_cockpit_window_framing_left.png');

    // 3. Captain Look Right (Center Post & #1R window)
    await evalCode(`(() => {
      window.simulator.cameraSystem.lookYaw = -0.32;
      window.simulator.cameraSystem.lookPitch = -0.12;
    })()`);
    await capture('verified_cockpit_window_framing_right.png');

    // 4. Look through the lower left side window toward its solid wall.
    await evalCode(`(() => {
      window.simulator.cameraSystem.lookYaw = 1.3;
      window.simulator.cameraSystem.lookPitch = -0.12;
    })()`);
    await capture('verified_cockpit_enclosure_left.png');
    const wallHits = await evalCode(`(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const s = window.simulator;
      s.camera.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, -0.65), s.camera);
      return ray.intersectObject(s.aircraft.cockpit.gltfCockpitModel, true)
        .filter(h => h.object.visible && h.object.name.startsWith('Body'))
        .map(h => ({name: h.object.name, distance: h.distance}));
    })()`);
    assert.ok(wallHits.some(hit => hit.distance > framingState.cameraNear && hit.distance < 2),
      'A solid native sidewall must intercept the view below the window');
    for (const [name, yaw, pitch] of [
      ['right', -1.3, -0.12], ['rear', Math.PI, -0.12],
      ['roof', 0, 1.1], ['floor', 0, -1.1]
    ]) {
      await evalCode(`(() => {
        window.simulator.cameraSystem.lookYaw = ${yaw};
        window.simulator.cameraSystem.lookPitch = ${pitch};
      })()`);
      await capture(`verified_cockpit_enclosure_${name}.png`);
    }
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'cockpit-enclosure.json'),
      JSON.stringify({framingState, shell, wallHits}, null, 2));

    ws.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
