import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

const REPORT_DIR = '.cache/jeju-tile-streamer';
await mkdir(REPORT_DIR, { recursive: true });

console.log('Detecting GPU angle:', detectGpuAngle());

await withBrowserSession(
  {
    mobile: true,
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    preview: true,
    timeoutMs: 35000,
  },
  async ({ origin, send, evaluate, delay, exceptions, consoleMessages }) => {
    console.log(`Navigating to mobile session at ${origin}...`);
    await send('Page.navigate', {
      url: `${origin}/?terrain=jeju&aircraft=B738&scenario=runway&fly=1&telemetry=0`,
    });
    await send('Page.bringToFront');

    const waitFor = async (expression, timeoutMs = 25000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(expression)) return;
        } catch {
          // Retry until ready
        }
        await delay(150);
      }
      throw new Error(`Timed out waiting for: ${expression}`);
    };

    console.log('Waiting for simulator startup...');
    await waitFor('Boolean(window.sim?.startupReady)');
    console.log('Simulator startupReady!');
    await waitFor('Boolean(window.sim?.jejuAirport?.tileStreamer)');
    console.log('TileStreamer initialized!');

    // Wait a brief moment for initial streaming / canvas stitching
    await delay(1000);

    console.log('Benchmarking frame times and performance metrics...');
    await evaluate(`
      window.perfReports = [];
      sim.flightPerformance.emit = r => perfReports.push(r);
      sim.performanceTelemetryEnabled = true;
      sim.flightPerformance.intervalMs = 5000;
    `);

    // Warm up to flush initial asset/shader compilation hitch
    await delay(1500);
    await evaluate(`sim.flightPerformance.flush('warmup'); window.perfReports = [];`);

    // Sample steady state flight loop
    await delay(2500);
    await evaluate(`sim.flightPerformance.flush('verify');`);

    const perf = await evaluate(() => {
      const report = window.perfReports.at(-1) || null;
      const streamer = window.sim?.jejuAirport?.tileStreamer;
      const metrics = streamer ? streamer.getMetrics() : null;
      const memory = window.performance?.memory
        ? {
            usedJSHeapSize: window.performance.memory.usedJSHeapSize,
            totalJSHeapSize: window.performance.memory.totalJSHeapSize,
          }
        : null;

      const renderInfo = window.sim?.renderer?.info
        ? {
            memory: window.sim.renderer.info.memory,
            render: window.sim.renderer.info.render,
          }
        : null;

      // Verify analytical elevation continuity across diverse coordinates
      const surface = window.sim?.currentTerrain;
      const testCoords = [
        { name: 'RW07', x: -1000, z: 424 },
        { name: 'RW07_Threshold', x: -1463.6, z: 621.3 },
        { name: 'Coast_North', x: 0, z: -5000 },
        { name: 'Hallasan', x: 3740, z: 16000 },
        { name: 'Open_Water', x: 50000, z: 50000 },
      ];
      const physicsChecks = testCoords.map((c) => {
        const hStreamer = streamer?.getHeight(c.x, c.z);
        const hSurface = surface?.getHeight(c.x, c.z);
        return {
          name: c.name,
          hStreamer,
          hSurface,
          isEqual: hStreamer === hSurface,
        };
      });

      return {
        flightPerf: report,
        lastFrameDeltaMs: (window.sim?.lastFrameDelta || 0) * 1000,
        streamerMetrics: metrics,
        memory,
        renderInfo,
        physicsChecks,
      };
    });

    console.log('Testing clean disposal of tile streamer resources...');
    const disposal = await evaluate(() => {
      const airport = window.sim?.jejuAirport;
      const streamer = airport?.tileStreamer;
      const before = {
        hasMacroTexture: Boolean(streamer?.macroTexture),
        isStreaming: Boolean(streamer?.isStreaming),
      };

      airport?.dispose?.();

      const after = {
        hasMacroTexture: Boolean(streamer?.macroTexture),
        isStreaming: Boolean(streamer?.isStreaming),
      };

      return { before, after };
    });

    const report = {
      timestamp: new Date().toISOString(),
      viewport: { mobile: true, width: 412, height: 915 },
      perf,
      disposal,
      exceptions,
    };

    await writeFile(
      `${REPORT_DIR}/report.json`,
      JSON.stringify(report, null, 2),
      'utf8'
    );
    console.log('Report saved to', `${REPORT_DIR}/report.json`);
    console.log(JSON.stringify(report, null, 2));

    // Assertions
    if (perf.flightPerf) {
      assert.ok(perf.flightPerf.frames > 0, 'Expected recorded frames in flight performance');
      assert.ok(perf.flightPerf.frameMs.p95 > 0, 'Expected positive p95 frame time');
      assert.ok(perf.flightPerf.updateMs.mean > 0, 'Expected positive updateMs');
    }
    assert.ok(perf.streamerMetrics.tilesLoaded > 0, 'Expected tiles to be loaded');
    assert.ok(
      perf.streamerMetrics.cache.estimatedMemoryBytes < 150 * 1024 * 1024,
      'Tile memory must be under 150MB budget'
    );
    for (const check of perf.physicsChecks) {
      assert.ok(
        check.isEqual,
        `Physics check failed for ${check.name}: streamer=${check.hStreamer}, surface=${check.hSurface}`
      );
    }
    assert.equal(
      disposal.after.hasMacroTexture,
      false,
      'macroTexture should be null after disposal'
    );
    assert.equal(
      disposal.after.isStreaming,
      false,
      'isStreaming should be false after disposal'
    );
    assert.deepEqual(exceptions, [], 'No uncaught exceptions should occur');
    console.log('✅ All Phase 1 verification checks passed!');
  }
);
