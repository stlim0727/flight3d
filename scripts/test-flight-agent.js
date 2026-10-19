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

const PORT = 5173;
const CDP_PORT = 9446;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/ad33c4b1-3b1c-4752-ad5e-b09f9794851b';

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
  }

  log(msg, emoji = '🛫') {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${timestamp}] ${emoji} ${msg}`);
  }

  async start() {
    this.log('Starting Autonomous Flight Test Agent...', '🤖');

    // 1. Launch Headless Chrome with CDP
    const profileDir = `/tmp/chrome-flight-test-${Date.now()}`;
    const args = [
      '--headless=new',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1280,720',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--no-default-browser-check',
      SIM_URL
    ];

    this.chromeProcess = spawn('google-chrome-stable', args, { stdio: 'ignore' });
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
    await new Promise(r => setTimeout(r, 2500));

    // Verify window.simulator
    const simCheck = await this.eval('Boolean(window.simulator && window.simulator.aircraft)');
    if (!simCheck) {
      throw new Error('window.simulator not found in page scope!');
    }
    this.log('Simulator confirmed ready in browser context!', '✅');
    // Ensure demo director is stopped so standalone scenario tests run cleanly
    await this.eval('if (window.simulator.demoDirector) window.simulator.demoDirector.stop();');
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

  async captureScreenshot(filename) {
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

    this.log(`Screenshot captured: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`, '📸');
    return localPath;
  }

  /**
   * Monitor flight state for a duration while checking for anomalies
   * @param {number} durationSeconds 
   * @param {Function} stepCallback Optional callback per tick (dt)
   */
  async recordFlight(durationSeconds, stepCallback = null) {
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

    return telemetryHistory;
  }

  // ==========================================
  // SCENARIO 1: Automated Takeoff & Initial Climb
  // ==========================================
  async testTakeoffScenario() {
    this.log('=============================================', '🛫');
    this.log('SCENARIO 1: Takeoff Roll, Rotation & Climb', '🛫');
    this.log('=============================================', '🛫');

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

    await this.captureScreenshot('test_takeoff_result.png');

    const result = {
      scenario: 'Takeoff & Initial Climb',
      passed,
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
    this.log(`Scenario 1 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'}`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 2: Aerodynamic Stall & Recovery
  // ==========================================
  async testStallRecoveryScenario() {
    this.log('=============================================', '⚠️');
    this.log('SCENARIO 2: High-Altitude Stall & Nose-Down Recovery', '⚠️');
    this.log('=============================================', '⚠️');

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

    await this.captureScreenshot('test_stall_recovery_result.png');

    const passed = stallTriggered && recovered;
    const result = {
      scenario: 'Stall Warning & Recovery',
      passed,
      metrics: {
        stallTriggered,
        recovered,
        minIasKt: Math.round(Math.min(...history.map(s => s.iasKnots))),
        maxPitchDeg: Math.max(...history.map(s => s.pitchDeg)).toFixed(1),
        minG: Math.min(...history.map(s => s.gForce)).toFixed(2)
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 2 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'}`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 3: Final Approach, Touchdown & Reverser Braking
  // ==========================================
  async testApproachAndLandingScenario() {
    this.log('=============================================', '🛬');
    this.log('SCENARIO 3: Final Approach, Touchdown & Braking Rollout', '🛬');
    this.log('=============================================', '🛬');

    // Preset short final: 0.3 NM out (x = -1900m, alt = 42m / 138ft)
    await this.eval(`
      window.simulator.controls.clearVirtualInputs();
      window.simulator.position.set(-1900, 42, 0);
      window.simulator.linearVelocity.set(68, -2.6, 0); // 132 knots descending
      window.simulator.angularVelocity.set(0, 0, 0);
      window.simulator.quaternion.setFromEuler(new window.THREE.Euler(window.THREE.MathUtils.degToRad(2.0), -Math.PI * 0.5, 0, 'YXZ'));
      window.simulator.aircraft.group.position.copy(window.simulator.position);
      window.simulator.aircraft.group.quaternion.copy(window.simulator.quaternion);
      window.simulator.aircraft.group.updateMatrixWorld(true);
      window.simulator.controls.setVirtualInput('throttle', 0.45);
      window.simulator.engines.setThrottle(0.45);
      window.simulator.gear.setGearTarget(true);
      window.simulator.gear.gearState = 1.0;
      window.simulator.aero.setFlapPosition(5); // Flaps 30
      window.simulator.aero.pitchTrim = 5.5;
      window.simulator.cameraSystem.setMode(1);
      window.simulator.cameraSystem.snapToTarget(window.simulator.aircraft.group);
    `);
    await new Promise(r => setTimeout(r, 600));

    this.log('Tracking final approach down to Runway 09L threshold...', '📐');

    let flareInitiated = false;
    let touchdownConfirmed = false;
    let stoppedOnRunway = false;

    const history = await this.recordFlight(44, async (state, elapsedSec) => {
      // Flare at 25 ft AGL
      if (!flareInitiated && state.radioAltFt <= 25 && state.radioAltFt > 0) {
        flareInitiated = true;
        this.log(`Threshold 25 FT AGL: Executing gentle flare & retarding throttle to idle...`, '🛬');
        await this.eval(`
          window.simulator.controls.setVirtualInput('elevator', 0.12);
          window.simulator.controls.setVirtualInput('throttle', 0.0);
          window.simulator.engines.setThrottle(0.0);
        `);
      }

      // Confirm touchdown from wheel contact; CG radio altitude alone is not contact.
      if (!touchdownConfirmed && (state.onGround || state.touchdown)) {
        touchdownConfirmed = true;
        this.log(`TOUCHDOWN CONFIRMED! Radio Alt: ${Math.round(state.radioAltFt)} FT, G-Load: ${state.gForce.toFixed(2)} G`, '🎯');
        this.log(`Deploying Spoilers, Maximum Brakes, and Reverse Thrust...`, '🛑');
        await this.eval(`
          window.simulator.controls.setVirtualInput('elevator', 0.0);
          window.simulator.controls.setVirtualInput('aileron', 0.0);
          window.simulator.controls.setVirtualInput('rudder', 0.0);
          window.simulator.aero.spoilers = 1.0;
          window.simulator.controls.setVirtualInput('brakes', 1.0);
          window.simulator.gear.setBrakes(1.0);
          window.simulator.engines.setReverser(true, true);
          window.simulator.controls.setVirtualInput('throttle', 0.85); // Reverse thrust spool
        `);
      }

      // Check deceleration to safe taxi speed (< 40 knots)
      if (touchdownConfirmed && !stoppedOnRunway && state.iasKnots < 40) {
        stoppedOnRunway = true;
        this.log(`Aircraft safely decelerated on runway! IAS: ${Math.round(state.iasKnots)} KT`, '🏁');
        // Stow reverse thrust at taxi speed (standard SOP)
        await this.eval(`
          window.simulator.engines.setReverser(false, true);
          window.simulator.controls.setVirtualInput('throttle', 0.0);
        `);
      }
    });

    await this.captureScreenshot('test_landing_result.png');

    const passed = touchdownConfirmed && stoppedOnRunway && history.length > 0 && history.every(s => !s.isCrashed);
    const result = {
      scenario: 'Approach, Touchdown & Braking',
      passed,
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
    this.log(`Scenario 3 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'}`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 4: Rapid Preset & Camera Cycling
  // ==========================================
  async testPresetAndCameraStress() {
    this.log('=============================================', '🎛️');
    this.log('SCENARIO 4: Presets & Camera Switching Stress Test', '🎛️');
    this.log('=============================================', '🎛️');

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

    const passed = Boolean(state.validPosition && state.validQuat && this.browserExceptions.length === 0);
    const result = {
      scenario: 'Preset & Multi-Camera Stress',
      passed,
      metrics: {
        validState: state.validPosition && state.validQuat,
        uncaughtExceptions: this.browserExceptions.length
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 4 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'}`, passed ? '🎉' : '❌');
    return result;
  }

  // ==========================================
  // SCENARIO 5: Autonomous Demo Flight Director
  // ==========================================
  async testDemoFlightDirectorScenario() {
    this.log('=============================================', '🎬');
    this.log('SCENARIO 5: Autonomous Demo Flight Director & Handover', '🎬');
    this.log('=============================================', '🎬');

    // 1. Start Demo Director
    await this.eval(`window.simulator.demoDirector.start();`);
    await new Promise(r => setTimeout(r, 600));

    const activeCheck = await this.eval(`Boolean(window.simulator.demoDirector.isActive)`);
    const bannerDisplay = await this.eval(`document.getElementById('demo-banner').style.display !== 'none'`);
    const stageTitle = await this.eval(`document.getElementById('demo-stage-title').textContent`);
    this.log(`Demo started: active=${activeCheck}, bannerVisible=${bannerDisplay}, title="${stageTitle}"`, '🎬');

    // 2. Let demo run and confirm active stage progression
    let stageAdvanced = false;
    for (let s = 0; s < 60; s++) {
      await new Promise(r => setTimeout(r, 50));
      const currentStage = await this.eval(`
        (() => {
          window.simulator.stepSimulation(0.5);
          return window.simulator.demoDirector.currentStage;
        })()
      `);
      if (currentStage >= 1) {
        stageAdvanced = true;
        this.log(`Demo flight stage successfully advanced to stage ${currentStage}!`, '✨');
        break;
      }
    }

    // 3. Test user takeover (stop demo cleanly)
    await this.eval(`window.simulator.demoDirector.stop('수동 직접 조종으로 전환');`);
    await new Promise(r => setTimeout(r, 300));

    const stoppedCheck = await this.eval(`!window.simulator.demoDirector.isActive`);
    const bannerHidden = await this.eval(`document.getElementById('demo-banner').style.display === 'none'`);
    this.log(`Demo stopped cleanly: inactive=${stoppedCheck}, bannerHidden=${bannerHidden}`, '🎯');

    const passed = Boolean(activeCheck && bannerDisplay && stageAdvanced && stoppedCheck && bannerHidden);
    const result = {
      scenario: 'Autonomous Demo Director & User Handover',
      passed,
      metrics: {
        activeCheck,
        bannerDisplay,
        stageAdvanced,
        stoppedCheck,
        bannerHidden
      }
    };
    this.testResults.push(result);
    this.log(`Scenario 5 Result: ${passed ? 'PASSED ✅' : 'FAILED ❌'}`, passed ? '🎉' : '❌');
    return result;
  }

  async finish() {
    this.log('Generating Final Flight Test Report...', '📊');

    console.log('\n=============================================================');
    console.log('            AUTONOMOUS FLIGHT TEST REPORT');
    console.log('=============================================================');
    let allPassed = true;
    for (const r of this.testResults) {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenario}`);
      console.log(`       Metrics: ${JSON.stringify(r.metrics)}`);
      if (!r.passed) allPassed = false;
    }
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
