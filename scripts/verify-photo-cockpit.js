/**
 * @file scripts/verify-photo-cockpit.js
 * @description Visual Browser Verification for 2D Photorealistic Cockpit Overlay
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5188;
const CDP_PORT = 9488;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = '/home/bli/.gemini/antigravity-cli/brain/d4926e0b-d4bf-44c8-85c5-63c666fb0aa4';

class CockpitVerifier {
  constructor() {
    this.viteProcess = null;
    this.chromeProcess = null;
    this.ws = null;
    this.msgId = 1;
    this.pendingRequests = new Map();
  }

  log(msg, emoji = '✈️') {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${timestamp}] ${emoji} ${msg}`);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async run() {
    this.log('Starting Visual Cockpit Verification...', '🚀');

    // 1. Launch Vite Dev Server
    this.viteProcess = spawn('npx', ['vite', '--port', PORT.toString(), '--strictPort'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    await new Promise((res) => {
      this.viteProcess.stdout.on('data', (d) => {
        const text = d.toString();
        if (text.includes('Local:')) res();
      });
      setTimeout(res, 3000);
    });
    this.log(`Vite server started on port ${PORT}`);

    // 2. Launch Chrome
    const profileDir = path.resolve(process.cwd(), '.chrome-profile/cockpit-test');
    fs.mkdirSync(profileDir, { recursive: true });

    const chromeArgs = [
      '--headless=new',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1376,768',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      SIM_URL
    ];

    this.chromeProcess = spawn('google-chrome-stable', chromeArgs, { stdio: 'ignore' });
    this.log(`Chrome spawned on CDP port ${CDP_PORT}`);

    // Connect CDP
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find((t) => t.type === 'page');
        if (pageTarget?.webSocketDebuggerUrl) break;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!pageTarget) throw new Error('Failed to find Chrome page target');

    const WebSocketClass = globalThis.WebSocket;
    this.ws = new WebSocketClass(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve, reject } = this.pendingRequests.get(msg.id);
        this.pendingRequests.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    await this.send('Page.enable');
    await this.send('Runtime.enable');

    this.log('Connected to Simulator page. Waiting 4s for assets to initialize...');
    await new Promise((r) => setTimeout(r, 4000));

    // Ensure camera is in COCKPIT mode and skip demo so banner is dismissed
    await this.send('Runtime.evaluate', {
      expression: `
        if (window.simulator) {
          if (window.simulator.demoDirector && window.simulator.demoDirector.isActive) {
            window.simulator.demoDirector.stop();
            window.simulator.gameFlow?.enterFlight();
          }
          window.simulator.cameraSystem.setMode(window.simulator.cameraSystem.constructor.MODES.COCKPIT);
          window.simulator.cameraSystem.setCockpitPhoto(true);
        }
      `
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 1. Capture Runway 09L Ground Cockpit View
    this.log('Capturing Runway 09L Photo Cockpit view screenshot...', '📸');
    const photoSnap = await this.send('Page.captureScreenshot', { format: 'png' });
    const photoPath = path.join(ARTIFACT_DIR, 'cockpit_photo_live_screenshot.png');
    fs.writeFileSync(photoPath, Buffer.from(photoSnap.data, 'base64'));
    this.log(`Saved Photo Cockpit screenshot to ${photoPath}`);

    // 2. Switch to 3 NM Approach Preset (flying in air on glideslope)
    this.log('Switching to 3 NM Approach preset...', '🛬');
    await this.send('Runtime.evaluate', {
      expression: `
        if (window.simulator) {
          window.simulator.setPreset('approach');
          window.simulator.cameraSystem.setMode(window.simulator.cameraSystem.constructor.MODES.COCKPIT);
          window.simulator.cameraSystem.setCockpitPhoto(true);
        }
      `
    });
    await new Promise((r) => setTimeout(r, 1500));

    const appSnap = await this.send('Page.captureScreenshot', { format: 'png' });
    const appPath = path.join(ARTIFACT_DIR, 'cockpit_photo_approach_screenshot.png');
    fs.writeFileSync(appPath, Buffer.from(appSnap.data, 'base64'));
    this.log(`Saved Approach Photo Cockpit screenshot to ${appPath}`);

    // 3. Toggle to 3D Virtual Cockpit
    this.log('Toggling to 3D Virtual Cockpit view...', '🔄');
    await this.send('Runtime.evaluate', {
      expression: `
        if (window.simulator) {
          window.simulator.cameraSystem.toggleCockpitPhoto();
        }
      `
    });
    await new Promise((r) => setTimeout(r, 1000));

    const virtualSnap = await this.send('Page.captureScreenshot', { format: 'png' });
    const virtualPath = path.join(ARTIFACT_DIR, 'cockpit_3d_toggle_screenshot.png');
    fs.writeFileSync(virtualPath, Buffer.from(virtualSnap.data, 'base64'));
    this.log(`Saved 3D Virtual Cockpit screenshot to ${virtualPath}`);

    this.cleanup();
    this.log('Verification Complete!', '🎉');
  }

  cleanup() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    if (this.chromeProcess) {
      try { this.chromeProcess.kill('SIGTERM'); } catch (e) {}
    }
    if (this.viteProcess) {
      try { this.viteProcess.kill('SIGTERM'); } catch (e) {}
    }
  }
}

const verifier = new CockpitVerifier();
verifier.run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Verification failed:', err);
  verifier.cleanup();
  process.exit(1);
});
