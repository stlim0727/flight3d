// Start Vite separately; SIM_URL selects it. Always require a hardware GPU.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

process.env.GPU_ANGLE = process.platform === 'win32' ? 'd3d11' : 'vulkan';
if (process.platform === 'win32') process.env.CHROME_PATH ??= 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/turbulence');
await mkdir(directory, { recursive: true });
await withBrowserSession({ startVite: false, origin: process.env.SIM_URL || 'http://127.0.0.1:5196', timeoutMs: 120000 },
  async ({ origin, cdpPort, send, evaluate, screenshot, exceptions, delay }) => {
    execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
      env: { ...process.env, GPU_REPORT: resolve(directory, 'gpu.json') }, stdio: 'inherit', windowsHide: true,
    });
    await send('Page.navigate', { url: origin });
    await send('Page.bringToFront');
    let ready;
    for (let i = 0; i < 240; i++) {
      ready = await evaluate(() => Boolean(window.simulator?.aircraft.modelLoaded && window.simulator.renderer.info.render.frame > 0));
      if (ready) break;
      await delay(500);
    }
    assert.ok(ready, 'Aircraft loaded');
    const entry = await evaluate(() => {
      const s = window.simulator;
      s.clock.getDelta = () => 0; s.physicsAccumulator = 0;
      s.demoDirector.stop(); s.gameFlow.returnToLobby(true);
      document.getElementById('lobby-tab-settings').click();
      document.getElementById('dev-enabled').click();
      document.getElementById('lobby-tab-dev').click();
      s.developerPanel.select.value = 'turbulence'; s.developerPanel.refresh();
      return { options: [...s.developerPanel.select.options].slice(0, 3).map(o => ({ id: o.value, label: o.textContent })),
        enabled: !document.getElementById('dev-run').disabled,
        description: document.getElementById('dev-description').textContent };
    });
    assert.ok(entry.enabled);
    assert.deepEqual(entry.options.map(o => o.id), ['turbulence', 'turbulence-moderate', 'turbulence-strong']);
    await screenshot(resolve(directory, 'entry.png'));
    for (const id of ['turbulence-moderate', 'turbulence-strong']) {
      await evaluate(id => {
        const select = window.simulator.developerPanel.select;
        select.value = id; select.dispatchEvent(new Event('change'));
      }, id);
      await screenshot(resolve(directory, `entry-${id}.png`));
    }
    const initial = await evaluate(() => {
      const s = window.simulator;
      s.developerPanel.select.value = 'turbulence'; s.developerPanel.refresh();
      document.getElementById('dev-run').click(); s.devRunner.updatePreparation(0);
      return { position: s.position.toArray(), velocity: s.linearVelocity.toArray(), quaternion: s.quaternion.toArray(),
        throttle: s.controls.throttle, trim: s.controls.pitchTrim, mass: s.aero.mass,
        field: s.windField?.profile, seed: s.windField?.seed,
        inputBlocked: s.controls.inputBlocked, disabled: s.controls.aircraftControlsDisabled };
    });
    assert.equal(initial.field, 'light-turbulence-v1');
    assert.equal(initial.inputBlocked, false); assert.equal(initial.disabled, false);
    const flights = await evaluate(async () => {
      const { setSimulationWind, WindField } = await import('/src/physics/WindField.js');
      const { stepPhysics } = await import('/src/core/physicsTiming.js');
      const s = window.simulator, runs = {};
      for (const [id, profile] of [
        ['turbulence', null], ['turbulence', 'calm-debug-v1'], ['turbulence', 'light-turbulence-v1'],
        ['turbulence-moderate', 'moderate-turbulence-v1'], ['turbulence-strong', 'strong-turbulence-v1'],
      ]) {
        s.developerPanel.select.value = id; s.developerPanel.refresh();
        document.getElementById('dev-run').click(); s.devRunner.updatePreparation(0);
        const initial = { position: s.position.toArray(), velocity: s.linearVelocity.toArray(), quaternion: s.quaternion.toArray(),
          rates: s.angularVelocity.toArray(), throttle: s.controls.throttle, trim: s.controls.pitchTrim,
          mass: s.aero.mass, seed: s.windField.seed, time: s.windTimeSeconds };
        if (profile?.includes('turbulence') && s.windField.profile !== profile) throw new Error(`Wrong profile for ${id}`);
        const seed = s.windField.seed;
        if (!profile || profile === 'calm-debug-v1') setSimulationWind(s, profile ? new WindField({ profile, seed, runwayHeadingDeg: 63 }) : null);
        const min = {}, max = {}, trace = [], rollTicks = {};
        for (let tick = 0; tick < 7200; tick++) {
          stepPhysics(s);
          const values = { altitude: s.position.y, agl: s.position.y - s.currentTerrain.getHeight(s.position.x, s.position.z),
            ias: s.telemetry.iasKnots, g: s.telemetry.gForce, pitch: s.telemetry.pitchDeg, roll: s.telemetry.rollDeg,
            heading: s.telemetry.headingDeg, wingMoment: s._aeroResult.wingGustRollMoment,
            wingWindDifference: s.aero.windRightWorld.y - s.aero.windLeftWorld.y };
          if (values.roll < (min.roll ?? Infinity)) rollTicks.min = tick;
          if (values.roll > (max.roll ?? -Infinity)) rollTicks.max = tick;
          for (const [key, value] of Object.entries(values)) {
            if (!Number.isFinite(value)) throw new Error(`Invalid ${key}`);
            min[key] = Math.min(min[key] ?? Infinity, value); max[key] = Math.max(max[key] ?? -Infinity, value);
          }
          if (tick % 120 === 0) trace.push({ tick, ...values, wind: s.aero.windWorld.toArray(),
            force: s._aeroResult.forceWorld.toArray(), moment: s._aeroResult.momentBody.toArray(),
            leftWind: s.aero.windLeftWorld.toArray(), rightWind: s.aero.windRightWorld.toArray(),
            tas: s.telemetry.tasKnots, rates: s.angularVelocity.toArray() });
        }
        runs[profile ?? 'none'] = { initial, min, max, trace, rollTicks, result: s.devRunner.result,
          position: s.position.toArray(), quaternion: s.quaternion.toArray(),
          velocity: s.linearVelocity.toArray(), rates: s.angularVelocity.toArray(),
          ap: s.autopilot.master, demo: s.demoDirector.isActive };
      }
      s.stepSimulation(1 / 120); s.developerPanel.refresh(); s.renderScene();
      return runs;
    });
    await writeFile(resolve(directory, 'results.json'), JSON.stringify({ entry, initial, flights }, null, 2));
    for (const run of Object.values(flights)) {
      assert.equal(run.result.status, 'passed', JSON.stringify(run.result));
      assert.equal(run.result.observation.samples, 7200);
      assert.equal(run.ap, false); assert.equal(run.demo, false);
    }
    for (const key of ['position', 'quaternion', 'velocity', 'rates']) assert.deepEqual(flights.none[key], flights['calm-debug-v1'][key]);
    assert.notDeepEqual(flights.none.position, flights['light-turbulence-v1'].position);
    assert.notDeepEqual(flights.none.trace[0].force, flights['light-turbulence-v1'].trace[0].force);
    assert.notDeepEqual(flights.none.trace[0].moment, flights['light-turbulence-v1'].trace[0].moment);
    let previousRollRange = 0;
    for (const profile of ['light-turbulence-v1', 'moderate-turbulence-v1', 'strong-turbulence-v1']) {
      const run = flights[profile];
      assert.deepEqual(run.initial, flights.none.initial);
      assert.ok(run.max.roll - run.min.roll > previousRollRange, profile);
      previousRollRange = run.max.roll - run.min.roll;
      if (profile !== 'light-turbulence-v1') {
        assert.ok(run.min.roll < -1.5 && run.max.roll > 2, `${profile}: visible banks both ways`);
        assert.ok(run.min.wingMoment < -1000 && run.max.wingMoment > 1000);
        assert.ok(run.min.wingWindDifference < 0 && run.max.wingWindDifference > 0);
      } else {
        assert.equal(run.min.wingMoment, 0); assert.equal(run.max.wingMoment, 0);
      }
    }
    await screenshot(resolve(directory, 'cruise-60s.png'));
    for (const [id, profile] of [['turbulence-moderate', 'moderate-turbulence-v1'], ['turbulence-strong', 'strong-turbulence-v1']]) {
      for (const extreme of ['min', 'max']) {
        const roll = await evaluate(({ id, ticks }) => {
          const s = window.simulator;
          s.devRunner.start(id); s.devRunner.updatePreparation(0);
          s.stepSimulation((ticks + 1) * s.physicsDt);
          s.cameraSystem.snapToTarget(s.aircraft.group); s.developerPanel.refresh(); s.renderScene();
          return s.telemetry.rollDeg;
        }, { id, ticks: flights[profile].rollTicks[extreme] });
        assert.ok(Math.abs(roll - flights[profile][extreme].roll) < 1e-9);
        await screenshot(resolve(directory, `${id}-roll-${extreme}.png`));
      }
    }
    const lifecycle = await evaluate(() => {
      const s = window.simulator;
      const snap = () => ({ position: s.position.toArray(), quaternion: s.quaternion.toArray(), wind: s.aero.windWorld.toArray(), time: s.windTimeSeconds });
      document.getElementById('dev-live-restart').click(); s.stepSimulation(.5);
      const reference = snap();
      document.getElementById('dev-live-pause').click(); s.stepSimulation(2);
      const paused = snap();
      document.getElementById('dev-live-pause').click(); s.stepSimulation(.5);
      const resumed = s.windTimeSeconds > reference.time;
      document.getElementById('dev-live-restart').click(); s.stepSimulation(.5);
      return { reference, paused, restarted: snap(), resumed, inputBlocked: s.controls.inputBlocked };
    });
    assert.deepEqual(lifecycle.reference, lifecycle.paused);
    assert.deepEqual(lifecycle.reference, lifecycle.restarted);
    assert.ok(lifecycle.resumed); assert.equal(lifecycle.inputBlocked, false);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
    const held = await evaluate(() => {
      const s = window.simulator; s.stepSimulation(.25);
      return { aileron: s.controls.aileron, roll: s.telemetry.rollDeg };
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
    const released = await evaluate(() => {
      const s = window.simulator; s.stepSimulation(1);
      return { aileron: s.controls.aileron, roll: s.telemetry.rollDeg };
    });
    assert.ok(held.aileron > .01); assert.ok(Math.abs(released.aileron) < Math.abs(held.aileron));
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await delay(300);
    const touch = await evaluate(() => {
      const s = window.simulator;
      s.touchControls.updateUI();
      const stick = document.getElementById('touch-stick-zone').getBoundingClientRect();
      const panel = document.getElementById('dev-live').getBoundingClientRect();
      return { display: getComputedStyle(document.getElementById('touch-controls-overlay')).display,
        separated: panel.bottom < stick.top, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    });
    assert.notEqual(touch.display, 'none');
    assert.ok(touch.separated, 'Developer controls do not cover the manual stick');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touch.x, y: touch.y, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x + 35, y: touch.y, id: 1 }] });
    touch.held = await evaluate(() => { const s = window.simulator; s.stepSimulation(.25); return s.controls.aileron; });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    touch.released = await evaluate(() => { const s = window.simulator; s.stepSimulation(1); return s.controls.aileron; });
    assert.ok(touch.held > .01); assert.ok(Math.abs(touch.released) < Math.abs(touch.held));
    await screenshot(resolve(directory, 'manual-mobile.png'));
    const realtimeStart = await evaluate(() => {
      const s = window.simulator;
      s.devRunner.restart(); s.clock.getDelta = () => 1 / 60;
      return s.devRunner.elapsed;
    });
    await delay(1000);
    const realtime = await evaluate(start => {
      const s = window.simulator; s.clock.getDelta = () => 0;
      return { elapsed: s.devRunner.elapsed, advanced: s.devRunner.elapsed > start, time: s.windTimeSeconds };
    }, realtimeStart);
    assert.ok(realtime.advanced); assert.equal(realtime.elapsed, realtime.time);
    const cleanup = await evaluate(async () => {
      const s = window.simulator;
      const clean = () => !s.devRunner.active && !s.windField && s.windTimeSeconds === 0 && s.aero.windWorld.length() === 0;
      const start = () => { s.devRunner.start('turbulence'); s.stepSimulation(.1); };
      document.getElementById('dev-live-stop').click(); const exit = clean();
      start(); s.setPreset('approach'); const preset = clean();
      start(); s.setAircraft('C172'); const aircraft = clean();
      s.setAircraft('B738'); start(); await s.setAirport('lukla'); const airport = clean();
      await s.setAirport('coastal'); start(); s.developerMode.disable(); const disabled = clean();
      return { exit, preset, aircraft, airport, disabled };
    });
    assert.ok(Object.values(cleanup).every(Boolean), JSON.stringify(cleanup));
    assert.deepEqual(exceptions, []);
    const report = { entry, initial, flights, lifecycle, held, released, touch, realtime, cleanup, exceptions };
    await writeFile(resolve(directory, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ initial, ranges: Object.fromEntries(Object.entries(flights).map(([id, run]) =>
      [id, { min: run.min, max: run.max, status: run.result.status }])), lifecycle, held, released, touch, cleanup }, null, 2));
  });
