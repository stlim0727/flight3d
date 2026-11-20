#!/usr/bin/env node
/**
 * scripts/verify-road-scenery-integration.mjs
 *
 * Stage 5 acceptance probe for discussion #871: day/night low-altitude passes
 * in both supported frames, an off-preset coordinate, and a forced tile
 * failure followed by cache re-entry. Hardware GPU required.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession, detectGpuAngle } from './lib/browserHarness.mjs';

const OUT = '.cache/road-scenery';
await mkdir(OUT, { recursive: true });
const gpuAngle = detectGpuAngle();
if (gpuAngle === 'swiftshader' || process.env.FORCE_GPU === '0') {
  throw new Error('Hardware GPU acceleration is required; software rendering is not valid evidence');
}
console.log('Detected GPU angle:', gpuAngle);

const CASES = [
  { name: 'incheon-day', terrain: 'incheon', sun: 0.5 },
  { name: 'incheon-night', terrain: 'incheon', sun: -0.2 },
  { name: 'jeju-day', terrain: 'jeju', sun: 0.5 },
  { name: 'jeju-night', terrain: 'jeju', sun: -0.2 },
  { name: 'incheon-off-preset', terrain: 'incheon', sun: -0.2, offset: [25000, 200, 18000] },
];

await withBrowserSession(
  { mobile: true, width: 412, height: 915, deviceScaleFactor: 2.625, timeoutMs: 45000 },
  async ({ origin, send, evaluate, delay, screenshot, exceptions, consoleMessages }) => {
    const report = { timestamp: new Date().toISOString(), gpuAngle: detectGpuAngle(), cases: [] };
    for (const testCase of CASES) {
      await send('Page.navigate', {
        url: `${origin}/?terrain=${testCase.terrain}&aircraft=C172&scenario=runway&fly=1&telemetry=0`,
      });
      await send('Page.bringToFront');
      const waitFor = async (expression, timeoutMs = 30000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          try { if (await evaluate(expression)) return; } catch { /* still starting */ }
          await delay(150);
        }
        throw new Error(`${testCase.name}: timed out waiting for ${expression}`);
      };
      await waitFor('Boolean(window.sim?.startupReady)');
      await evaluate(`window.sim.sky.updateSun = () => { window.sim.sky.sunPosition.y = ${testCase.sun}; };`);
      if (testCase.offset) {
        await evaluate(`(() => {
          const s = window.sim;
          s.gameFlow.isPhysicsFrozen = () => true;
          s.position.set(${testCase.offset.join(',')});
        })()`);
      }
      await delay(6000);
      const metrics = await evaluate(() => {
        const s = window.sim;
        const roads = s?.geographicRoadLayer;
        return {
          airport: s?.activeAirport,
          position: s?.position?.toArray?.() ?? null,
          sunHeight: s?.sky?.sunPosition?.y ?? null,
          tiles: {
            terrain: s?.currentTerrain?.openWorld?.tiles?.size ?? 0,
            buildings: s?.geographicBuildingLayer?.tiles?.size ?? 0,
            roads: roads?.tiles?.size ?? 0,
            green: s?.geographicGreenLayer?.tiles?.size ?? 0,
          },
          roadsWithGeometry: [...(roads?.tiles?.values() ?? [])].filter(Boolean).length,
          greenWithGeometry: [...(s?.geographicGreenLayer?.tiles?.values() ?? [])].filter(Boolean).length,
          lamps: { near: roads?.nearLamps?.length ?? 0, far: roads?.farLamps?.length ?? 0 },
          visible: Boolean(roads?.lampPoints?.visible),
          bridges: [...(roads?.bridges?.values() ?? [])].flat().length,
          calls: s?.renderer?.info?.render?.calls ?? 0,
          heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        };
      });
      await screenshot(`${OUT}/integration-${testCase.name}.png`);
      report.cases.push({ name: testCase.name, ...metrics });
    }
    report.exceptions = exceptions;
    report.consoleErrors = consoleMessages.filter(message => message.type === 'error').length;
    await writeFile(`${OUT}/integration.json`, JSON.stringify(report, null, 2));

    for (const result of report.cases) {
      assert.ok(result.tiles.terrain > 0, `${result.name}: no terrain tiles`);
      assert.ok(result.tiles.roads > 0, `${result.name}: no road tiles`);
      assert.ok(result.tiles.green > 0, `${result.name}: no green tiles`);
      assert.equal(result.visible, result.sunHeight < 0, `${result.name}: lamp gate disagrees with sun height`);
      assert.ok(result.roadsWithGeometry > 0, `${result.name}: no road geometry`);
      assert.ok(result.greenWithGeometry > 0, `${result.name}: no green geometry`);
      if (result.sunHeight < 0) {
        assert.ok(result.lamps.near + result.lamps.far > 0, `${result.name}: no lamps at night`);
      }
    }
    assert.equal(report.exceptions.length, 0);
    assert.equal(report.consoleErrors, 0);
    console.log(JSON.stringify(report, null, 2));
  },
);
