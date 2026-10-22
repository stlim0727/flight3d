/**
 * @file scripts/test-flight-agent.js
 * @description Autonomous Flight Test & Issue Reproduction Suite
 * 
 * Allows AI coding agents and human developers to run the flight simulator,
 * execute automated flight scenarios (Takeoff, Stall, Landing, Presets),
 * detect physics anomalies (NaN, terrain clipping, extreme G-forces, crash),
 * capture milestone screenshots, and generate detailed flight test reports.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173;
const CDP_PORT = process.env.CDP_PORT ? parseInt(process.env.CDP_PORT, 10) : 9446;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || process.cwd();

class FlightTestAgent {
  constructor() {
    this.chromeProcess = null;
    this.ws = null;
    this.msgId = 1;
    this.pendingRequests = new Map();
    this.consoleLogs = [];
    this.browserExceptions = [];
    this.anomalies = [];
    this.testResults = [];
    this.suiteStartTime = null;
    this.suiteEndTime = null;
    this.activeRenderer = 'Unknown';
    this.isHardwareGpu = false;
    this.captureScreenshots = process.argv.includes('--screenshots') ||
                              process.argv.includes('--screenshot') ||
                              process.env.CAPTURE_SCREENSHOTS === '1';
  }

  log(msg, emoji = '🛫') {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${timestamp}] ${emoji} ${msg}`);
  }

  async start() {
    this.suiteStartTime = performance.now();
    this.log('Starting Autonomous Flight Test Agent...', '🤖');

    // 1. Launch Headless Chrome with CDP
    const profileDir = `/tmp/chrome-flight-test-${Date.now()}`;
    const forceSwiftShader = process.argv.includes('--swiftshader') || process.env.FORCE_SWIFTSHADER === '1';
    const forceGpu = process.argv.includes('--gpu') || process.env.FORCE_GPU === '1';

    const args = [
      '--headless=new',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1280,720',
      '--no-first-run',
      '--no-default-browser-check'
    ];

    if (forceGpu) {
      this.log('Launching Headless Chrome with hardware GPU acceleration (Vulkan)...', '🚀');
      args.push('--use-gl=angle', '--use-angle=vulkan');
    } else {
      this.log('Launching Headless Chrome with SwiftShader rendering...', '⚡');
      args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
    }
    args.push(SIM_URL);

    this.chromeProcess = spawn('google-chrome-stable', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.chromeProcess.stderr?.on('data', (d) => {
      const s = d.toString();
      if (s.includes('FATAL') || s.includes('Crash') || s.includes('ERROR:content')) {
        this.log(`[Chrome Stderr] ${s.trim()}`, '⚠️');
      }
    });
    this.log(`Headless Chrome spawned with PID ${this.chromeProcess.pid} on CDP port ${CDP_PORT}`);

    // Wait for CDP to become ready
    let pageTarget = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {
        // Retry
      }
    }

    if (!pageTarget) {
      throw new Error(`Failed to find page target on CDP port ${CDP_PORT}`);
    }

    this.log(`CDP target connected: ${pageTarget.webSocketDebuggerUrl}`, '🔌');
    await this.connectWebSocket(pageTarget.webSocketDebuggerUrl);

    // Enable CDP domains
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Console.enable');

    // Wait for simulation to load
    this.log('Waiting for simulator to initialize in browser DOM...', '⏳');
    await this.ensureSimulatorReady(15000);
    this.log('Simulator confirmed ready in browser context!', '✅');

    // Detect active WebGL rendering engine
    const rendererInfo = await this.eval(`
      (() => {
        const gl = window.simulator?.renderer?.getContext();
        if (!gl) return 'Unknown';
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      })()
    `);
    this.activeRenderer = rendererInfo || 'Unknown';
    this.isHardwareGpu = Boolean(this.activeRenderer && !this.activeRenderer.includes('SwiftShader') && !this.activeRenderer.includes('llvmpipe'));
    this.log(`Active WebGL Engine: ${this.activeRenderer} (${this.isHardwareGpu ? 'Hardware GPU Accelerated 🚀' : 'Software SwiftShader 🐢'})`, '🎨');

    if (!this.captureScreenshots) {
      this.log('Screenshot capture: OPT-IN (skipping routine screenshots for speed; pass --screenshots to enable)', '⚡');
    } else {
      this.log('Screenshot capture: ENABLED (--screenshots)', '📸');
    }

    // Ensure demo director is stopped and coastal airport is selected so standalone scenario tests run cleanly
    await this.eval(`
      if (window.simulator) {
        if (window.simulator.demoDirector) window.simulator.demoDirector.stop();
        window.simulator.gameFlow?.enterFlight();
        if (typeof window.simulator.setAirport === 'function') window.simulator.setAirport('coastal');
      }
    `);
  }

  async ensureSimulatorReady(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ready = await this.eval('Boolean(window.simulator && window.simulator.aircraft && window.simulator.controls)');
        if (ready) return true;
      } catch (e) {
        // Retry if context is still evaluating
      }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for window.simulator to be ready');
  }

  connectWebSocket(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (err) => reject(err));

      this.ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pendingRequests.has(msg.id)) {
            const { resolve, reject } = this.pendingRequests.get(msg.id);
            this.pendingRequests.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          } else if (msg.method === 'Console.messageAdded') {
            const text = msg.params.message.text;
            this.consoleLogs.push(text);
            if (msg.params.message.level === 'error') {
              this.log(`[Browser Console Error] ${text}`, '❌');
            }
          } else if (msg.method === 'Runtime.exceptionThrown') {
            const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
            this.browserExceptions.push(desc);
            this.log(`[Uncaught Exception] ${desc}`, '💥');
          }
        } catch (e) {
          // ignore
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      const err = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Eval error (${expression}): ${err}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filename, force = false) {
    if (!this.captureScreenshots && !force) {
      return { path: null, durationMs: 0, sizeBytes: 0, skipped: true };
    }
    const startShot = performance.now();
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shot.data, 'base64');
    const localPath = path.resolve(process.cwd(), filename);
    fs.writeFileSync(localPath, buffer);

    // Also copy to artifacts directory if available
    try {
      if (fs.existsSync(ARTIFACT_DIR)) {
        const artifactPath = path.join(ARTIFACT_DIR, filename);
        fs.writeFileSync(artifactPath, buffer);
      }
    } catch (e) {
      // Artifact copy optional
    }

    const durationMs = performance.now() - startShot;
    this.log(`Screenshot captured: ${filename} (${(buffer.length / 1024).toFixed(1)} KB in ${(durationMs / 1000).toFixed(2)}s)`, '📸');
    return { path: localPath, durationMs, sizeBytes: buffer.length, skipped: false };
  }

  /**
   * Monitor flight state for a duration while checking for anomalies
   * @param {number} durationSeconds 
   * @param {Function} stepCallback Optional callback per tick (dt)
   */
  async recordFlight(durationSeconds, stepCallback = null) {
    const recordStartTime = performance.now();
    const sliceDt = 0.25; // 250ms of simulation time per step (30 physics substeps at 120Hz)
    const numSlices = Math.round(durationSeconds / sliceDt);
    const telemetryHistory = [];

    for (let slice = 0; slice < numSlices; slice++) {
      const currentSimTime = (slice + 1) * sliceDt;
      const state = await this.eval(`
        (() => {
          const sim = window.simulator;
          if (!sim) return null;
          sim.stepSimulation(${sliceDt});
          const pos = sim.position;
          const vel = sim.linearVelocity;
          const tel = sim.telemetry;
          const groundY = sim.terrain.getHeight(pos.x, pos.z);
          return {
            x: pos.x, y: pos.y, z: pos.z,
            vx: vel.x, vy: vel.y, vz: vel.z,
            groundY,
            altitudeFt: tel.altitudeFt,
            radioAltFt: tel.radioAltFt,
            iasKnots: tel.iasKnots,
            pitchDeg: tel.pitchDeg,
            rollDeg: tel.rollDeg,
            headingDeg: tel.headingDeg,
            vsiFpm: tel.vsiFpm,
            gForce: tel.gForce,
            isStalled: tel.isStalled,
            gearDown: tel.gearState > 0.9,
            onGround: tel.onGround,
            touchdown: tel.touchdown,
            isCrashed: sim.isCrashed,
            engineN1: tel.engine1 ? tel.engine1.n1 : 0
          };
        })()
      `);

      if (state) {
        telemetryHistory.push(state);

        // Anomaly Checks:
        // 1. NaN check
        if (Number.isNaN(state.x) || Number.isNaN(state.y) || Number.isNaN(state.vx) || Number.isNaN(state.gForce)) {
          this.anomalies.push({ type: 'NAN_PHYSICS', state, time: Date.now() });
          this.log(`CRITICAL: NaN detected in physics state! x=${state.x}, y=${state.y}`, '🚨');
        }

        // 2. Extreme G-force check (> 4.5G or < -2.0G)
        if (Math.abs(state.gForce) > 4.5 || state.gForce < -2.0) {
          this.anomalies.push({ type: 'EXTREME_G_LOAD', value: state.gForce, time: Date.now() });
          this.log(`WARNING: Extreme G-load detected: ${state.gForce.toFixed(2)} G`, '⚠️');
        }

        // 3. Terrain clipping check (aircraft center significantly below terrain)
        if (state.y < state.groundY - 0.5) {
          this.anomalies.push({ type: 'TERRAIN_PENETRATION', y: state.y, groundY: state.groundY, time: Date.now() });
          this.log(`CRITICAL: Terrain clipping! y=${state.y.toFixed(2)}, groundY=${state.groundY.toFixed(2)}`, '💥');
        }

        if (stepCallback) {
          await stepCallback(state, currentSimTime);
        }
      }
    }

    const recordDurationMs = performance.now() - recordStartTime;
    telemetryHistory.performance = {
      simulatedDurationSec: durationSeconds,
      steppingTimeMs: recordDurationMs,
      steps: numSlices,
      avgStepMs: numSlices > 0 ? (recordDurationMs / numSlices) : 0,
      speedRatio: (recordDurationMs > 0) ? (durationSeconds / (recordDurationMs / 1000)) : 0
    };

    return telemetryHistory;
  }

  // ==========================================
  // SCENARIO 1: Automated Takeoff & Initial Climb
  // ==========================================
  async testTakeoffScenario() {
    const scenarioStart = performance.now();
    this.log('=============================================', '🛫');
    this.log('SCENARIO 1: Takeoff Roll, Rotation & Climb', '🛫');
    this.log('=============================================', '🛫');

    await this.ensureSimulatorReady();

    // 1. Reset to runway preset
    await this.eval(`
      window.simulator.setPreset('runway');
      window.simulator.controls.clearVirtualInputs();
      window.simulator.controls.brakes = 0.0;
      window.simulator.gear.setBrakes(0.0);
      window.simulator.cameraSystem.setMode(1); // Chase view for visual check
      window.simulator.cameraSystem.snapToTarget(window.simulator.aircraft.group);
    `);
    await new Promise(r => setTimeout(r, 600));

    // 2. Advance throttle to 100% TOGA
    this.log('Advancing throttles to 100% TOGA for takeoff roll...', '🔥');
    await this.eval(`
      window.simulator.controls.setVirtualInput('throttle', 1.0);
      window.simulator.engines.setThrottle(1.0);
    `);

    let rotated = false;
    let liftoffDetected = false;
    let rotationIas = 0;

    const initialAnomalies = this.anomalies.length;
    // Full Boeing 737-800 takeoff roll to Vr takes ~22 seconds at 66,000 kg,
    // followed by smooth 4-5s rotation at 2.2°/s and positive rate climb-out.
    const history = await this.recordFlight(36, async (state, elapsedSec) => {
      // Rotation at Vr ~ 132-138 knots
      if (!rotated && state.iasKnots >= 132) {
        rotated = true;
        rotationIas = state.iasKnots;
        this.log(`V_r reached (${Math.round(rotationIas)} KT at ${elapsedSec.toFixed(1)}s). Pulling back yoke (Elevator 0.65, ~2.2°/s rotation rate)...`, '🕹️');
        await this.eval(`window.simulator.controls.setVirtualInput('elevator', 0.65);`);
      }

      // Detect liftoff (require actual wheel separation from runway)
      if (rotated && !liftoffDetected && !state.onGround && state.radioAltFt > 14.0) {
        liftoffDetected = true;
        this.log(`Positive Rate of Climb confirmed! Radio Alt: ${Math.round(state.radioAltFt)} FT, VSI: +${Math.round(state.vsiFpm)} FPM`, '✈️');
        // Retract gear and stabilize climb attitude
        this.log('Gear UP commanded, relaxing pitch to cruise climb attitude.', '🛞');
        await this.eval(`
          window.simulator.gear.toggleGear();
          window.simulator.controls.setVirtualInput('elevator', 0.22);
        `);
      }
    });

    const finalState = history[history.length - 1];
    const passed = liftoffDetected && finalState.altitudeFt > 40 && finalState.iasKnots > 130;

    const forceScreenshot = !passed || (this.anomalies.length > initialAnomalies);
    const shot = await this.captureScreenshot('test_takeoff_result.png', forceScreenshot);
    const scenarioDurationMs = performance.now() - scenarioStart;

    const perf = {
      realDurationSec: parseFloat((scenarioDurationMs / 1000).toFixed(2)),
      simulatedDurationSec: 36.0,
      speedRatio: parseFloat((36.0 / (scenarioDurationMs / 1000)).toFixed(2)),
      steppingTimeSec: parseFloat(((history.performance?.steppingTimeMs || 0) / 1000).toFixed(2)),
      screenshotTimeSec: parseFloat((shot.durationMs / 1000).toFixed(2)),
      steps: history.performance?.steps || 0,
      avgStepMs: parseFloat((history.performance?.avgStepMs || 0).toFixed(1))
    };

    const result = {
      scenario: 'Takeoff & Initial Climb',
      passed,
      performance: perf,
      metrics: {
        rotationIas: Math.round(rotationIas),
        liftoffDetected,
        finalAltFt: Math.round(finalState.altitudeFt),
        finalIasKt: Math.round(finalState.iasKnots),
        finalVsiFpm: Math.round(finalState.vsiFpm),
        maxG: Math.max(...history.map(s => s.gForce)).toFixed(2)
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 1 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'} (${perf.realDurationSec}s real, ${perf.simulatedDurationSec}s sim, ${perf.speedRatio}x)`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 2: Aerodynamic Stall & Recovery
  // ==========================================
  async testStallRecoveryScenario() {
    const scenarioStart = performance.now();
    this.log('=============================================', '⚠️');
    this.log('SCENARIO 2: High-Altitude Stall & Nose-Down Recovery', '⚠️');
    this.log('=============================================', '⚠️');

    await this.ensureSimulatorReady();

    // Setup high altitude clean flight
    await this.eval(`
      window.simulator.controls.clearVirtualInputs();
      window.simulator.position.set(0, 1500, 3000); // ~5,000 ft
      window.simulator.linearVelocity.set(0, 0, -80); // 155 knots heading North
      window.simulator.angularVelocity.set(0, 0, 0);
      window.simulator.quaternion.set(0, 0, 0, 1);
      window.simulator.aircraft.group.position.copy(window.simulator.position);
      window.simulator.aircraft.group.quaternion.copy(window.simulator.quaternion);
      window.simulator.aircraft.group.updateMatrixWorld(true);
      window.simulator.controls.setVirtualInput('throttle', 0.0); // Idle
      window.simulator.engines.setThrottle(0.0);
      window.simulator.gear.setGearTarget(false);
      window.simulator.gear.gearState = 0.0;
      window.simulator.aero.setFlapPosition(0);
      window.simulator.cameraSystem.snapToTarget(window.simulator.aircraft.group);
    `);
    await new Promise(r => setTimeout(r, 600));

    this.log('Idle thrust + high pitch up commanded to induce aerodynamic stall...', '📈');
    await this.eval(`window.simulator.controls.setVirtualInput('elevator', 0.85);`);

    let stallTriggered = false;
    let recovered = false;

    const initialAnomalies = this.anomalies.length;
    const history = await this.recordFlight(16, async (state, elapsedSec) => {
      if (!stallTriggered && state.isStalled) {
        stallTriggered = true;
        this.log(`STALL DETECTED! IAS: ${Math.round(state.iasKnots)} KT, Pitch: ${state.pitchDeg.toFixed(1)}°`, '🚨');
        
        // Initiate stall recovery: Nose down elevator + Full TOGA power
        this.log('Executing stall recovery: Pushing yoke down (-0.6) + TOGA 100%...', '🔄');
        await this.eval(`
          window.simulator.controls.setVirtualInput('elevator', -0.6);
          window.simulator.controls.setVirtualInput('throttle', 1.0);
          window.simulator.engines.setThrottle(1.0);
        `);
      }

      if (stallTriggered && !recovered && !state.isStalled && state.iasKnots > 120) {
        recovered = true;
        this.log(`Stall recovery successful! Airflow reattached, IAS: ${Math.round(state.iasKnots)} KT`, '✅');
        // Return controls to neutral
        await this.eval(`window.simulator.controls.setVirtualInput('elevator', 0.05);`);
      }
    });

    const passed = stallTriggered && recovered;
    const forceScreenshot = !passed || (this.anomalies.length > initialAnomalies);
    const shot = await this.captureScreenshot('test_stall_recovery_result.png', forceScreenshot);
    const scenarioDurationMs = performance.now() - scenarioStart;
    const perf = {
      realDurationSec: parseFloat((scenarioDurationMs / 1000).toFixed(2)),
      simulatedDurationSec: 16.0,
      speedRatio: parseFloat((16.0 / (scenarioDurationMs / 1000)).toFixed(2)),
      steppingTimeSec: parseFloat(((history.performance?.steppingTimeMs || 0) / 1000).toFixed(2)),
      screenshotTimeSec: parseFloat((shot.durationMs / 1000).toFixed(2)),
      steps: history.performance?.steps || 0,
      avgStepMs: parseFloat((history.performance?.avgStepMs || 0).toFixed(1))
    };

    const result = {
      scenario: 'Stall Warning & Recovery',
      passed,
      performance: perf,
      metrics: {
        stallTriggered,
        recovered,
        minIasKt: Math.round(Math.min(...history.map(s => s.iasKnots))),
        maxPitchDeg: Math.max(...history.map(s => s.pitchDeg)).toFixed(1),
        minG: Math.min(...history.map(s => s.gForce)).toFixed(2)
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 2 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'} (${perf.realDurationSec}s real, ${perf.simulatedDurationSec}s sim, ${perf.speedRatio}x)`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 3: Final Approach, Touchdown & Reverser Braking
  // ==========================================
  async testApproachAndLandingScenario() {
    const scenarioStart = performance.now();
    this.log('=============================================', '🛬');
    this.log('SCENARIO 3: Final Approach, Touchdown & Braking Rollout', '🛬');
    this.log('=============================================', '🛬');

    await this.ensureSimulatorReady();

    // Start in an already configured, trimmed short final. The old fixture
    // spawned at 2deg pitch with flaps still travelling, then reduced elevator
    // during flare; the new contact model correctly rejects that nose impact.
    await this.eval(`
      (() => {
        const sim = window.simulator;
        sim.setPreset('approach');
        sim.controls.setParkingBrake(false);
        sim.position.set(-1900, 42, 0);
        sim.linearVelocity.set(68, -2.6, 0);
        sim.angularVelocity.set(0, 0, 0);
        sim.quaternion.setFromEuler(new window.THREE.Euler(window.THREE.MathUtils.degToRad(5.8), -Math.PI * 0.5, 0, 'YXZ'));
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.gear.setGearTarget(true);
        sim.gear.gearState = 1;
        sim.aero.setFlapPosition(6);
        sim.aero.currentFlapAngle = 40;
        sim.controls.pitchTrim = 5.5;
        sim.aero.pitchTrim = 5.5;
        sim.controls.elevator = 0.18;
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
        const original = sim.integratePhysics.bind(sim);
        const pilot = { contact: false, pitch: null };
        sim.integratePhysics = function(dt) {
          const guidance = this.demoDirector.luklaScenario;
          guidance.flyBank(0, this.telemetry);
          this.controls.setVirtualInput('rudder', 0);
          if (!pilot.contact && !this.gear.onGround) {
            const height = this.position.y - this.currentTerrain.getHeight(this.position.x, this.position.z);
            const descent = Math.max(-2.6, Math.min(-0.5, -(height - 3.9) * 0.35));
            guidance.flyVerticalPath(descent, 132, this.telemetry);
          } else {
            pilot.contact = true;
            pilot.pitch ??= this.telemetry.pitchDeg;
            pilot.pitch = Math.max(0, pilot.pitch - dt * 2);
            guidance.flyVerticalPath(0, 0, this.telemetry, 0, pilot.pitch);
            const noseDown = this.gear.contacts[0].isGrounded;
            const reverse = noseDown && this.telemetry.iasKnots > 40;
            this.aero.spoilers = noseDown ? 1 : 0;
            this.controls.setVirtualInput('brakes', noseDown ? 1 : 0);
            this.engines.setReverser(reverse, this.gear.onGround);
            this.controls.setVirtualInput('throttle', reverse ? 0.85 : 0);
          }
          original(dt);
        };
        window.restoreCoastalLandingIntegration = () => { sim.integratePhysics = original; };
      })()
    `);

    this.log('Tracking a trimmed final and controlled main/nose-gear touchdown...', '📐');
    let touchdownConfirmed = false;
    let stoppedOnRunway = false;
    const initialAnomalies = this.anomalies.length;
    let history;
    try {
      history = await this.recordFlight(60, async state => {
        if (!touchdownConfirmed && (state.onGround || state.touchdown)) {
          touchdownConfirmed = true;
          this.log(`TOUCHDOWN CONFIRMED! Radio Alt: ${Math.round(state.radioAltFt)} FT`, '🎯');
        }
        if (touchdownConfirmed && !stoppedOnRunway && state.iasKnots < 40 && !state.isCrashed) {
          stoppedOnRunway = true;
          this.log(`Aircraft safely decelerated on runway! IAS: ${Math.round(state.iasKnots)} KT`, '🏁');
        }
      });
    } finally {
      await this.eval('window.restoreCoastalLandingIntegration()');
    }

    const passed = touchdownConfirmed && stoppedOnRunway && history.length > 0 && history.every(s => !s.isCrashed);
    const forceScreenshot = !passed || (this.anomalies.length > initialAnomalies);
    const shot = await this.captureScreenshot('test_landing_result.png', forceScreenshot);
    const scenarioDurationMs = performance.now() - scenarioStart;
    const perf = {
      realDurationSec: parseFloat((scenarioDurationMs / 1000).toFixed(2)),
      simulatedDurationSec: 60.0,
      speedRatio: parseFloat((60.0 / (scenarioDurationMs / 1000)).toFixed(2)),
      steppingTimeSec: parseFloat(((history.performance?.steppingTimeMs || 0) / 1000).toFixed(2)),
      screenshotTimeSec: parseFloat((shot.durationMs / 1000).toFixed(2)),
      steps: history.performance?.steps || 0,
      avgStepMs: parseFloat((history.performance?.avgStepMs || 0).toFixed(1))
    };

    const result = {
      scenario: 'Approach, Touchdown & Braking',
      passed,
      performance: perf,
      metrics: {
        touchdownConfirmed,
        stoppedOnRunway,
        maxTouchdownG: history.some(s => s.onGround || s.touchdown)
          ? Math.max(...history.filter(s => s.onGround || s.touchdown).map(s => s.gForce)).toFixed(2)
          : null,
        finalStopSpeedKt: Math.round(history[history.length - 1].iasKnots)
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 3 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'} (${perf.realDurationSec}s real, ${perf.simulatedDurationSec}s sim, ${perf.speedRatio}x)`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 4: Rapid Preset & Camera Cycling
  // ==========================================
  async testPresetAndCameraStress() {
    const scenarioStart = performance.now();
    this.log('=============================================', '🎛️');
    this.log('SCENARIO 4: Presets & Camera Switching Stress Test', '🎛️');
    this.log('=============================================', '🎛️');

    await this.ensureSimulatorReady();

    const presets = ['runway', 'approach', 'cruise', 'runway'];
    let cameraMode = 0;

    for (const p of presets) {
      this.log(`Switching to preset '${p}'...`, '🔄');
      await this.eval(`window.simulator.setPreset('${p}');`);
      await new Promise(r => setTimeout(r, 400));

      cameraMode = (cameraMode + 1) % 5;
      await this.eval(`window.simulator.cameraSystem.setMode(${cameraMode});`);
      await new Promise(r => setTimeout(r, 300));
    }

    const state = await this.eval(`
      (() => {
        const sim = window.simulator;
        return {
          posX: sim.position.x,
          posY: sim.position.y,
          posZ: sim.position.z,
          quatW: sim.quaternion.w,
          quatX: sim.quaternion.x,
          validPosition: typeof sim.position.x === 'number' && !Number.isNaN(sim.position.x),
          validQuat: typeof sim.quaternion.w === 'number' && !Number.isNaN(sim.quaternion.w),
          camMode: sim.cameraSystem.getModeName()
        };
      })()
    `);

    this.log(`Scenario 4 Diagnostics: pos=(${state.posX}, ${state.posY}, ${state.posZ}), quatW=${state.quatW}, validPos=${state.validPosition}, validQuat=${state.validQuat}, cam=${state.camMode}`, '🔍');

    const scenarioDurationMs = performance.now() - scenarioStart;
    const passed = Boolean(state.validPosition && state.validQuat && this.browserExceptions.length === 0);
    const perf = {
      realDurationSec: parseFloat((scenarioDurationMs / 1000).toFixed(2)),
      simulatedDurationSec: 0.0,
      speedRatio: 0.0,
      steppingTimeSec: 0.0,
      screenshotTimeSec: 0.0,
      steps: presets.length,
      avgStepMs: parseFloat((scenarioDurationMs / presets.length).toFixed(1))
    };

    const result = {
      scenario: 'Preset & Multi-Camera Stress',
      passed,
      performance: perf,
      metrics: {
        validState: state.validPosition && state.validQuat,
        uncaughtExceptions: this.browserExceptions.length
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 4 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'} (${perf.realDurationSec}s real)`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 5: Autonomous Demo Flight Director
  // ==========================================
  async testDemoFlightDirectorScenario() {
    const scenarioStart = performance.now();
    this.log('=============================================', '🎬');
    this.log('SCENARIO 5: Autonomous Demo Flight Director & Handover', '🎬');
    this.log('=============================================', '🎬');

    await this.ensureSimulatorReady();

    // 1. Start Demo Director
    await this.eval(`window.simulator.demoDirector.start();`);
    await new Promise(r => setTimeout(r, 600));

    const activeCheck = await this.eval(`Boolean(window.simulator.demoDirector.isActive)`);
    const bannerDisplay = await this.eval(`document.getElementById('demo-banner').style.display !== 'none'`);
    const stageTitle = await this.eval(`document.getElementById('demo-stage-title').textContent`);
    this.log(`Demo started: active=${activeCheck}, bannerVisible=${bannerDisplay}, title="${stageTitle}"`, '🎬');

    // 2. Let demo run and confirm active stage progression
    let stageAdvanced = false;
    let simulatedSec = 0;
    let steppingTimeMs = 0;
    let stepCount = 0;

    for (let s = 0; s < 60; s++) {
      await new Promise(r => setTimeout(r, 50));
      const t0 = performance.now();
      const currentStage = await this.eval(`
        (() => {
          window.simulator.stepSimulation(0.5);
          return window.simulator.demoDirector.currentStage;
        })()
      `);
      steppingTimeMs += (performance.now() - t0);
      simulatedSec += 0.5;
      stepCount++;

      if (currentStage >= 1) {
        stageAdvanced = true;
        this.log(`Demo flight stage successfully advanced to stage ${currentStage}!`, '✨');
        break;
      }
    }

    // 3. Test user takeover (stop demo cleanly)
    await this.eval(`window.simulator.demoDirector.stop('수동 직접 조종으로 전환'); window.simulator.gameFlow.enterFlight();`);
    await new Promise(r => setTimeout(r, 300));

    const stoppedCheck = await this.eval(`!window.simulator.demoDirector.isActive`);
    const bannerHidden = await this.eval(`document.getElementById('demo-banner').style.display === 'none'`);
    this.log(`Demo stopped cleanly: inactive=${stoppedCheck}, bannerHidden=${bannerHidden}`, '🎯');

    const scenarioDurationMs = performance.now() - scenarioStart;
    const passed = Boolean(activeCheck && bannerDisplay && stageAdvanced && stoppedCheck && bannerHidden);
    const perf = {
      realDurationSec: parseFloat((scenarioDurationMs / 1000).toFixed(2)),
      simulatedDurationSec: parseFloat(simulatedSec.toFixed(1)),
      speedRatio: scenarioDurationMs > 0 ? parseFloat((simulatedSec / (scenarioDurationMs / 1000)).toFixed(2)) : 0,
      steppingTimeSec: parseFloat((steppingTimeMs / 1000).toFixed(2)),
      screenshotTimeSec: 0.0,
      steps: stepCount,
      avgStepMs: stepCount > 0 ? parseFloat((steppingTimeMs / stepCount).toFixed(1)) : 0
    };

    const result = {
      scenario: 'Autonomous Demo Director & User Handover',
      passed,
      performance: perf,
      metrics: {
        activeCheck,
        bannerDisplay,
        stageAdvanced,
        stoppedCheck,
        bannerHidden
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 5 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'} (${perf.realDurationSec}s real, ${perf.simulatedDurationSec}s sim, ${perf.speedRatio}x)`, passed ? '🎉' : '❌');
    return result;
  }

  async finish() {
    this.suiteEndTime = performance.now();
    const totalSuiteRealDurationSec = (this.suiteEndTime - this.suiteStartTime) / 1000;
    this.log('Generating Final Flight Test & Performance Report...', '📊');

    const totalSimulatedSec = this.testResults.reduce((acc, r) => acc + (r.performance?.simulatedDurationSec || 0), 0);
    const totalSteps = this.testResults.reduce((acc, r) => acc + (r.performance?.steps || 0), 0);
    const totalSteppingSec = this.testResults.reduce((acc, r) => acc + (r.performance?.steppingTimeSec || 0), 0);
    const totalScreenshotSec = this.testResults.reduce((acc, r) => acc + (r.performance?.screenshotTimeSec || 0), 0);
    const overallSpeedRatio = totalSuiteRealDurationSec > 0 ? (totalSimulatedSec / totalSuiteRealDurationSec) : 0;

    const performanceReport = {
      timestamp: new Date().toISOString(),
      platform: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        webglRenderer: this.activeRenderer,
        isHardwareGpu: this.isHardwareGpu
      },
      summary: {
        totalRealDurationSec: parseFloat(totalSuiteRealDurationSec.toFixed(2)),
        totalSimulatedFlightSec: parseFloat(totalSimulatedSec.toFixed(2)),
        overallSpeedRatio: parseFloat(overallSpeedRatio.toFixed(2)),
        totalSteps,
        totalSteppingTimeSec: parseFloat(totalSteppingSec.toFixed(2)),
        totalScreenshotTimeSec: parseFloat(totalScreenshotSec.toFixed(2)),
        screenshotsEnabled: this.captureScreenshots,
        scenariosCount: this.testResults.length,
        passedCount: this.testResults.filter(r => r.passed).length,
        failedCount: this.testResults.filter(r => !r.passed).length
      },
      scenarios: this.testResults.map(r => ({
        scenario: r.scenario,
        passed: r.passed,
        performance: r.performance,
        metrics: r.metrics
      })),
      anomalies: this.anomalies,
      consoleErrors: this.browserExceptions
    };

    // Save performance report to JSON
    const perfFileName = 'flight-test-performance.json';
    const localPerfPath = path.resolve(process.cwd(), perfFileName);
    fs.writeFileSync(localPerfPath, JSON.stringify(performanceReport, null, 2));
    try {
      if (fs.existsSync(ARTIFACT_DIR)) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, perfFileName), JSON.stringify(performanceReport, null, 2));
      }
    } catch (e) {
      // Optional artifact copy
    }

    console.log('\n=============================================================');
    console.log('            AUTONOMOUS FLIGHT TEST REPORT');
    console.log('=============================================================');
    let allPassed = true;
    for (const r of this.testResults) {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenario}`);
      console.log(`       Flight Metrics: ${JSON.stringify(r.metrics)}`);
      if (r.performance) {
        const shotInfo = r.performance.screenshotTimeSec > 0
          ? `Screenshot: ${r.performance.screenshotTimeSec}s`
          : 'Screenshot: skipped';
        console.log(`       Performance: ${r.performance.realDurationSec}s real | ${r.performance.simulatedDurationSec}s sim | Speed: ${r.performance.speedRatio}x | Stepping: ${r.performance.steppingTimeSec}s (${r.performance.avgStepMs}ms/step) | ${shotInfo}`);
      }
      if (!r.passed) allPassed = false;
    }
    console.log('-------------------------------------------------------------');
    console.log('FLIGHT PERFORMANCE & DURATION SUMMARY:');
    console.log(`  Active WebGL Engine:        ${this.activeRenderer}`);
    console.log(`  Hardware GPU Accelerated:   ${this.isHardwareGpu ? 'YES 🚀' : 'NO (SwiftShader Software) 🐢'}`);
    console.log(`  Total Real Duration:        ${totalSuiteRealDurationSec.toFixed(2)}s`);
    console.log(`  Total Flight Simulated:     ${totalSimulatedSec.toFixed(2)}s`);
    console.log(`  Overall Simulation Speed:   ${overallSpeedRatio.toFixed(2)}x real-time`);
    console.log(`  Total Physics Steps:        ${totalSteps} slices (${totalSteppingSec.toFixed(2)}s total stepping)`);
    console.log(`  Screenshot Overhead:        ${totalScreenshotSec.toFixed(2)}s ${this.captureScreenshots ? '(enabled)' : '(opt-in skipped)'}`);
    console.log(`  Saved Profile:              ${localPerfPath}`);
    console.log('-------------------------------------------------------------');
    console.log(`Total Scenarios: ${this.testResults.length}`);
    console.log(`Passed: ${this.testResults.filter(r => r.passed).length}`);
    console.log(`Failed: ${this.testResults.filter(r => !r.passed).length}`);
    console.log(`Anomalies Detected: ${this.anomalies.length}`);
    console.log(`Console Errors: ${this.browserExceptions.length}`);
    console.log('=============================================================\n');

    // Cleanup Chrome
    if (this.ws) this.ws.close();
    if (this.chromeProcess) {
      this.chromeProcess.kill('SIGTERM');
    }

    return allPassed && this.anomalies.length === 0 && this.browserExceptions.length === 0;
  }
}

// Main execution
(async () => {
  const agent = new FlightTestAgent();
  try {
    await agent.start();
    await agent.testTakeoffScenario();
    await agent.testStallRecoveryScenario();
    await agent.testApproachAndLandingScenario();
    await agent.testPresetAndCameraStress();
    await agent.testDemoFlightDirectorScenario();

    const success = await agent.finish();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('Flight Test Agent encountered fatal error:', err);
    if (agent.chromeProcess) agent.chromeProcess.kill('SIGTERM');
    process.exit(1);
  }
})();
