#!/usr/bin/env node
/**
 * scripts/measure-streamed-scenery.mjs
 *
 * Bounded baseline measurement for the streamed scenery work in discussion #871.
 * Records tile requests, frame timing and GPU/heap usage on a low-altitude
 * Incheon route so each stage can be compared against the same viewport.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

const OUT = '.cache/road-scenery';
const name = process.env.MEASURE_NAME ?? 'measurement';
await mkdir(OUT, { recursive: true });
console.log('Detected GPU angle:', detectGpuAngle());

await withBrowserSession(
  {
    mobile: true,
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    timeoutMs: 40000,
  },
  async ({ origin, send, evaluate, delay, screenshot, exceptions, consoleMessages }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__tileRequests = [];
        const originalFetch = window.fetch.bind(window);
        window.fetch = (...args) => {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (/overturemaps|arcgisonline|elevation-tiles|tile\\.openstreetmap/.test(url)) {
            window.__tileRequests.push({ url, at: performance.now() });
          }
          return originalFetch(...args);
        };
      `,
    });
    await send('Page.navigate', {
      url: `${origin}/?terrain=incheon&aircraft=C172&scenario=runway&fly=1&telemetry=0`,
    });
    await send('Page.bringToFront');

    const waitFor = async (expression, timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try { if (await evaluate(expression)) return; } catch { /* still starting */ }
        await delay(150);
      }
      throw new Error(`Timed out waiting for ${expression}`);
    };

    await waitFor('Boolean(window.sim?.startupReady)');
    await waitFor('window.sim?.activeAirport === "incheon"');
    await waitFor('Boolean(window.sim?.geographicBuildingLayer)');
    await evaluate(`
      window.__perfReports = [];
      sim.flightPerformance.emit = report => window.__perfReports.push(report);
      sim.performanceTelemetryEnabled = true;
      sim.flightPerformance.intervalMs = 4000;
    `);
    await delay(2000);
    await evaluate(`sim.flightPerformance.flush('warmup'); window.__perfReports = []; window.__tileRequests = [];`);
    await delay(6000);
    await evaluate(`sim.flightPerformance.flush('measure');`);

    const metrics = await evaluate(() => {
      const sim = window.sim;
      const surface = sim?.currentTerrain;
      const requests = window.__tileRequests ?? [];
      const byHost = {};
      for (const request of requests) {
        const host = new URL(request.url).host;
        byHost[host] = (byHost[host] ?? 0) + 1;
      }
      return {
        airport: sim?.activeAirport,
        position: sim?.position?.toArray?.() ?? null,
        tileRequests: { total: requests.length, byHost },
        frame: window.__perfReports.at(-1) ?? null,
        tiles: {
          terrain: surface?.openWorld?.tiles?.size ?? 0,
          buildings: sim?.geographicBuildingLayer?.tiles?.size ?? 0,
          roads: sim?.geographicRoadLayer?.tiles?.size ?? 0,
          green: sim?.geographicGreenLayer?.tiles?.size ?? 0,
        },
        greenWithGeometry: [...(sim?.geographicGreenLayer?.tiles?.values() ?? [])].filter(Boolean).length,
        lamps: {
          near: sim?.geographicRoadLayer?.nearLamps?.length ?? 0,
          far: sim?.geographicRoadLayer?.farLamps?.length ?? 0,
          instances: sim?.geographicRoadLayer?.lampMesh?.count ?? 0,
          visible: Boolean(sim?.geographicRoadLayer?.lampPoints?.visible),
        },
        bridges: {
          decks: [...(sim?.geographicRoadLayer?.bridges?.values() ?? [])].flat().length,
          evidenced: [...(sim?.geographicRoadLayer?.bridges?.values() ?? [])].flat().filter(deck => deck.evidenced).length,
        },
        renderInfo: sim?.renderer?.info ? {
          memory: { ...sim.renderer.info.memory },
          render: { ...sim.renderer.info.render },
        } : null,
        heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      };
    });

    const report = {
      timestamp: new Date().toISOString(),
      viewport: { mobile: true, width: 412, height: 915 },
      gpuAngle: detectGpuAngle(),
      metrics,
      exceptions,
      consoleErrors: consoleMessages.filter(message => message.type === 'error').length,
    };
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(report, null, 2));
    await screenshot(`${OUT}/${name}.png`);
    console.log(JSON.stringify(report, null, 2));
  },
);
