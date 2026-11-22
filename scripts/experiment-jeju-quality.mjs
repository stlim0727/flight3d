import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output/jeju-experiment';
await mkdir(OUTPUT_DIR, { recursive: true });

console.log('--- Jeju Terrain Quality 4-Step Experiment ---');
console.log('GPU Angle:', detectGpuAngle());

const PASSES = [
  {
    name: 'step1_baseline',
    label: 'Step 1: Baseline (Zoom 10, Anisotropy 1)',
    zoom: 10,
    anisotropy: 1,
    targetTiles: 8,
    view: 'susanbong',
  },
  {
    name: 'step2_anisotropy8',
    label: 'Step 2: Anisotropy 8x Only (Zoom 10, Anisotropy 8)',
    zoom: 10,
    anisotropy: 8,
    targetTiles: 8,
    view: 'susanbong',
  },
  {
    name: 'step3_zoom11_aniso8',
    label: 'Step 3: High-Res Zoom 11 32 Tiles + Anisotropy 8x',
    zoom: 11,
    anisotropy: 8,
    targetTiles: 32,
    view: 'susanbong',
  },
  {
    name: 'step4_low_altitude_approach',
    label: 'Step 4: Low-Altitude Approach (1,500 ft, Runway 07, Zoom 11, Anisotropy 8)',
    zoom: 11,
    anisotropy: 8,
    targetTiles: 32,
    view: 'approach',
  },
];

await withBrowserSession(
  {
    mobile: true,
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    preview: true,
    timeoutMs: 120000,
  },
  async ({ origin, send, evaluate, delay, screenshot, exceptions }) => {
    const results = [];

    const waitFor = async (expression, timeoutMs = 45000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(expression)) return;
        } catch {}
        await delay(200);
      }
      throw new Error(`Timed out waiting for: ${expression}`);
    };

    console.log('Navigating to simulator session...');
    const initialUrl = `${origin}/?terrain=jeju&aircraft=B738&scenario=runway&fly=1&telemetry=0&jejuZoom=10&jejuAnisotropy=1`;
    await send('Page.navigate', { url: initialUrl });
    await send('Page.bringToFront');

    console.log('Waiting for simulator startupReady...');
    await waitFor('Boolean(window.sim?.startupReady)');

    console.log('Waiting for tileStreamer initialization...');
    await waitFor('Boolean(window.sim?.jejuAirport?.tileStreamer)');

    console.log('Waiting for initial macro tiles to load (>= 8)...');
    await waitFor('Boolean(window.sim?.jejuAirport?.tileStreamer?.tilesLoaded >= 8)');

    for (const pass of PASSES) {
      console.log(`\n========================================`);
      console.log(`Executing ${pass.label}...`);
      console.log(`========================================`);

      // Dynamically apply zoom & anisotropy configuration
      console.log(`Configuring TileStreamer: zoom=${pass.zoom}, anisotropy=${pass.anisotropy}...`);
      await evaluate(async ({ zoom, anisotropy }) => {
        const streamer = window.sim?.jejuAirport?.tileStreamer;
        if (!streamer) throw new Error('tileStreamer missing');
        await streamer.setConfig({ zoom, anisotropy });
      }, { zoom: pass.zoom, anisotropy: pass.anisotropy });

      console.log(`Waiting for tiles (target: >= ${pass.targetTiles})...`);
      await waitFor(
        `Boolean(window.sim?.jejuAirport?.tileStreamer?.tilesLoaded >= ${pass.targetTiles})`,
        45000
      );

      // Brief delay for GPU texture upload and mipmap generation to settle
      await delay(1500);

      // Setup exact camera & aircraft pose
      console.log(`Setting up pose for view: ${pass.view}...`);
      await evaluate((pView) => {
        const s = window.sim;
        s.setTimeOfDay(12.0, { persist: false, userChoice: false });

        if (pView === 'susanbong') {
          // Susanbong coordinate: 33.4898° N, 126.3311° E
          // CJU南西 15.2km, 수산봉 5.1km 앞
          const x = -15045.9;
          const z = 2372.9;
          const y = 3266.54; // 10,717 FT
          const headingDeg = 81.0;
          const headingRad = (headingDeg * Math.PI) / 180;
          const speedMs = 112 * 0.514444; // ~57.6 m/s (112 knots)

          s.position.set(x, y, z);
          s.quaternion.setFromEuler(new window.THREE.Euler(0, -headingRad, 0, 'YXZ'));
          s.linearVelocity.set(speedMs * Math.sin(headingRad), 0, -speedMs * Math.cos(headingRad));
        } else if (pView === 'approach') {
          // Runway 07 final approach at 1,500 ft (~457 m MSL)
          // 8.7 km out on 068.5° extended centerline
          const x = -9573.6;
          const z = 3817.3;
          const y = 457.2;
          const headingDeg = 68.5;
          const headingRad = (headingDeg * Math.PI) / 180;
          const speedMs = 65 * 0.514444; // ~33.4 m/s (65 knots approach speed)

          s.position.set(x, y, z);
          s.quaternion.setFromEuler(new window.THREE.Euler(0, -headingRad, 0, 'YXZ'));
          s.linearVelocity.set(speedMs * Math.sin(headingRad), 0, -speedMs * Math.cos(headingRad));
        }

        s.aircraft.group.position.copy(s.position);
        s.aircraft.group.quaternion.copy(s.quaternion);
        s.aircraft.group.updateMatrixWorld(true);

        s.cameraSystem.setMode('chase', true);
        s.cameraSystem.snapToTarget(s.aircraft.group);

        // Freeze physics integration so view stays rock-solid during sampling
        s.integratePhysics = () => {};
      }, pass.view);

      await delay(1000);

      // Measure performance
      console.log('Measuring performance over 3000ms...');
      await evaluate(`
        window.perfReports = [];
        sim.flightPerformance.emit = r => perfReports.push(r);
        sim.performanceTelemetryEnabled = true;
        sim.flightPerformance.intervalMs = 3000;
        sim.flightPerformance.flush('warmup');
      `);

      await delay(3200);

      await evaluate(`sim.flightPerformance.flush('measure');`);

      const passData = await evaluate(() => {
        const report = window.perfReports.at(-1) || null;
        const streamer = window.sim?.jejuAirport?.tileStreamer;
        const metrics = streamer ? streamer.getMetrics() : null;
        const memory = window.performance?.memory
          ? {
              usedJSHeapMB: +(window.performance.memory.usedJSHeapSize / 1048576).toFixed(1),
              totalJSHeapMB: +(window.performance.memory.totalJSHeapSize / 1048576).toFixed(1),
            }
          : null;

        const textureInfo = streamer?.macroTexture
          ? {
              width: streamer.macroTexture.image?.width,
              height: streamer.macroTexture.image?.height,
              anisotropy: streamer.macroTexture.anisotropy,
            }
          : null;

        return {
          flightPerf: report,
          metrics,
          memory,
          textureInfo,
        };
      });

      const shotPath = `${OUTPUT_DIR}/${pass.name}.png`;
      console.log(`Capturing screenshot to ${shotPath}...`);
      await screenshot(shotPath);

      const summary = {
        pass: pass.name,
        label: pass.label,
        zoom: pass.zoom,
        anisotropy: pass.anisotropy,
        tilesLoaded: passData.metrics?.tilesLoaded,
        texture: passData.textureInfo,
        frameMs: passData.flightPerf?.frameMs,
        fps: passData.flightPerf
          ? +(passData.flightPerf.frames / (passData.flightPerf.durationMs / 1000)).toFixed(1)
          : null,
        memory: passData.memory,
        screenshot: shotPath,
      };

      console.log('Result:', JSON.stringify(summary, null, 2));
      results.push(summary);
    }

    const reportPath = `${OUTPUT_DIR}/experiment_summary.json`;
    await writeFile(reportPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nAll 4 passes finished! Summary saved to ${reportPath}`);
  }
);
