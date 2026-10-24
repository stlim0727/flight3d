const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = process.cwd();
const path = require('node:path');
const artifactDir = path.resolve(process.env.ARTIFACT_DIR || '.tmp/issue185');
fs.mkdirSync(artifactDir, { recursive: true });
const baseline = Object.fromEntries(['src/main.js', 'src/physics/Aerodynamics.js', 'src/config/simConfig.js'].map(file =>
  [file, execFileSync('git', ['show', `37f76adf644c6120ddbbd6e127ab7f56cc4c8b44:${file}`], { cwd: root, encoding: 'utf8' })]));

(async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_PATH ? undefined : 'chrome', executablePath: process.env.CHROME_PATH, headless: true });
  const reports = {};
  try {
    for (const variant of ['baseline', 'updated']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      await page.addInitScript(() => {
        let seed = 185;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        window.nativeFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = () => 0;
      });
      if (variant === 'baseline') {
        for (const [file, body] of Object.entries(baseline)) {
          await page.route(`**/${file}*`, route => route.fulfill({ contentType: 'application/javascript', body: body.replaceAll("from 'three'", "from '/node_modules/.vite/deps/three.js'") }));
        }
      }
      await page.goto(process.env.SIM_URL || 'http://127.0.0.1:5185/', { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForFunction(() => Boolean(window.simulator), null, { timeout: 30000 });
      const session = await context.newCDPSession(page);
      await page.evaluate(() => {
        const sim = window.simulator;
        sim.demoDirector.stop();
        sim.gameFlow.enterFlight();
        sim.setPreset('runway');
        for (let second = 0; second < 10; second++) sim.stepSimulation(1);
      });
      await session.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      reports[variant] = await page.evaluate(() => {
        const sim = window.simulator;
        sim.demoDirector.stop();
        sim.gameFlow.enterFlight();
        const snapshots = [];
        const times = [];
        for (const preset of ['runway', 'cruise', 'approach', 'runway']) {
          sim.setPreset(preset);
          if (preset === 'runway') {
            sim.controls.brakes = 1;
            sim.controls.parkingBrake = true;
          }
          for (let second = 0; second < 12; second++) {
            const start = performance.now();
            sim.stepSimulation(1);
            times.push(performance.now() - start);
            const state = [...sim.position.toArray(), ...sim.linearVelocity.toArray(), ...sim.quaternion.toArray(), ...sim.angularVelocity.toArray()];
            if (!state.every(Number.isFinite)) throw new Error('nonfinite physics');
            if (Math.abs(sim.quaternion.length() - 1) > 1e-10) throw new Error('quaternion drift');
            snapshots.push({ preset, second, state, onGround: sim.telemetry.onGround, crashed: sim.isCrashed });
          }
        }
        sim.setPreset('runway');
        sim.position.set(-1000, 16, 0);
        sim.linearVelocity.set(45, -1, 0);
        for (let second = 0; second < 8; second++) {
          sim.stepSimulation(1);
          snapshots.push({ preset: 'touchdown', second, state: [...sim.position.toArray(), ...sim.linearVelocity.toArray(), ...sim.quaternion.toArray()], onGround: sim.telemetry.onGround });
        }
        sim.setPreset('cruise');
        if (sim.physicsAccumulator !== 0) throw new Error('stale reset accumulator');
        sim.gameFlow.pause();
        sim.animate();
        const sorted = times.slice(5).sort((left, right) => left - right);
        return { snapshots, physicsHz: sim.physicsHz, p95BatchMs: sorted[Math.floor(sorted.length * .95)], p99BatchMs: sorted[Math.floor(sorted.length * .99)], glError: sim.renderer.getContext().getError() };
      });
      const { profile } = await session.send('HeapProfiler.stopSampling');
      let allocated = 0;
      function sum(node) { allocated += node.selfSize; node.children.forEach(sum); }
      sum(profile.head);
      reports[variant].sampledAllocationBytes = allocated;
      reports[variant].errors = errors;
      reports[variant].render = await page.evaluate(async () => {
        const sim = window.simulator;
        sim.gameFlow.resume();
        sim.setPreset('cruise');
        sim.cameraSystem.setMode(1, true);
        sim.clock.getDelta();
        const frameTimes = [];
        let previous = performance.now();
        for (let frame = 0; frame < 120; frame++) {
          await new Promise(resolve => window.nativeFrame(resolve));
          const current = performance.now();
          if (frame > 60) frameTimes.push(current - previous);
          previous = current;
          sim.animate();
        }
        frameTimes.sort((left, right) => left - right);
        return { p95FrameMs: frameTimes[Math.floor(frameTimes.length * .95)], p99FrameMs: frameTimes[Math.floor(frameTimes.length * .99)], quaternionNorm: sim.quaternion.length(), glError: sim.renderer.getContext().getError() };
      });
      await page.screenshot({ path: path.join(artifactDir, `${variant}.png`) });
      fs.writeFileSync(path.join(artifactDir, `${variant}-heap.json`), JSON.stringify(profile));
      await context.close();
      console.log(variant, JSON.stringify({ ...reports[variant], snapshots: reports[variant].snapshots.length }));
    }
    assert.deepEqual(reports.updated.snapshots, reports.baseline.snapshots);
    assert.deepEqual(reports.updated.errors, []);
    assert.equal(reports.updated.glError, 0);
    assert.equal(reports.updated.physicsHz, 120);
    assert.equal(reports.updated.render.glError, 0);
    assert.ok(Math.abs(reports.updated.render.quaternionNorm - 1) < 1e-10);
    assert.ok(reports.updated.snapshots.every(sample => sample.state.every(Number.isFinite)));
    assert.ok(reports.updated.snapshots.filter(sample => sample.preset === 'touchdown').some(sample => sample.onGround));
    fs.writeFileSync(path.join(artifactDir, 'verification.json'), JSON.stringify(reports, null, 2));
    console.log('PASS: 56 sampled states across 6720 physics steps match baseline exactly; reset and WebGL verified.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
