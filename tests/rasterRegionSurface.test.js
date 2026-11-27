import test from 'node:test';
import assert from 'node:assert/strict';
import { RasterRegionSurface } from '../src/environment/RasterRegionSurface.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';

const config = REGION_SURFACES.lukla;
const gridSize = config.gridSize;
const elevations = new Float32Array(gridSize * gridSize).fill(2000);
const heading = config.runway.headingDeg * Math.PI / 180;
const sin = Math.sin(heading);
const cos = Math.cos(heading);
const naturalH = 2000;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothFade = (distance, width) => {
  const t = Math.min(1, Math.max(0, distance / width));
  return 1 - t * t * (3 - 2 * t);
};

// Independent grading model derived only from the declarative region config.
function expectedHeight(x, z) {
  const s = x * sin - z * cos;
  const w = x * cos + z * sin;
  const g = config.grading;
  const rwyH = config.runway.midElevationM + s * config.runway.gradient;
  const runwayWeight = smoothFade(
    Math.max(0, Math.abs(s) - config.runway.lengthM / 2), g.runwayFadeM,
  ) * smoothFade(Math.max(0, Math.abs(w) - config.runway.widthM / 2), g.widthFadeM);
  const apronDistanceS = Math.max(g.apronS[0] - s, 0, s - g.apronS[1]);
  const apronDistanceW = Math.max(g.apronW[0] - w, 0, w - g.apronW[1]);
  const apronWeight = smoothFade(apronDistanceS, g.apronFadeM)
    * smoothFade(apronDistanceW, g.apronFadeM);
  return lerp(lerp(naturalH, Math.max(rwyH, g.apronMinElevationM), apronWeight), rwyH, runwayWeight);
}

function expectedNormal(x, z) {
  const d = 2;
  const nx = expectedHeight(x - d, z) - expectedHeight(x + d, z);
  const nz = expectedHeight(x, z - d) - expectedHeight(x, z + d);
  const length = Math.hypot(nx, 2 * d, nz);
  return { x: nx / length, y: 2 * d / length, z: nz / length };
}

test('declarative raster surface grades and normals follow the region config', () => {
  const surface = new RasterRegionSurface(config, { elevations, load: false });

  for (const [x, z] of [[0, 0], [200, -100], [-500, 300], [10000, 5000], [-19000, 15000]]) {
    assert.ok(Math.abs(surface.getHeight(x, z) - expectedHeight(x, z)) < 0.01,
      `height at ${x},${z}`);
    assert.ok(Math.abs(surface.getNaturalHeight(x, z) - naturalH) < 1e-6,
      `natural height at ${x},${z}`);
    const a = surface.getNormal(x, z);
    const b = expectedNormal(x, z);
    assert.ok(Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01,
      `normal at ${x},${z}`);
  }

  assert.equal(surface.isLoaded, true);
  assert.equal(surface.size, config.size);
  assert.equal(surface.segments, config.segments);
  assert.equal(surface.localTerraceGeometry.attributes.position.count,
    (config.terrace.segmentsX + 1) * (config.terrace.segmentsZ + 1));
  assert.equal(config.demUrl, 'terrain/lukla_dem.bin');
  assert.equal(config.imageryUrl, 'terrain/lukla_satellite.jpg');
  assert.equal(surface.demUrl, config.demUrl);
  assert.equal(surface.imageryUrl, config.imageryUrl);
  surface.dispose();
});

test('declarative runway endpoints retain the surveyed 2805/2867 m grade', () => {
  const surface = new RasterRegionSurface(config, { elevations, load: false });
  const at = s => surface.getHeight(s * sin, -s * cos);
  const halfLength = config.runway.lengthM / 2;
  assert.ok(Math.abs(at(-halfLength) - config.runway.threshold06ElevationM) < 1, 'RW06 threshold');
  assert.ok(Math.abs(at(halfLength) - config.runway.threshold24ElevationM) < 1, 'RW24 threshold');
  assert.ok(Math.abs(at(0) - config.runway.midElevationM) < 1, 'runway midpoint');
  assert.ok(surface.isOnRunway(0, 0));
  assert.ok(surface.isRunwaySafetyArea(0, 0));
  assert.ok(!surface.isOnRunway(500, 200));
  surface.dispose();
});

test('Patagonia uses a common anchor surface without raster grading', () => {
  const patagonia = REGION_SURFACES.patagonia;
  assert.equal(patagonia.elevationM, 2492);
  assert.deepEqual(patagonia.precinctExtent, [-22000, -22000, 22000, 22000]);
  assert.equal(patagonia.demUrl, undefined);
  assert.equal(patagonia.runway, undefined);
  assert.equal(patagonia.grading, undefined);
  assert.equal(patagonia.terrace, undefined);
});

test('RasterRegionSurface.demReady resolves with loadError on HTTP 500 or network rejection', async t => {
  const previousWindow = globalThis.window;
  globalThis.window = { fetch: true };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  t.mock.method(console, 'warn', () => {});

  for (const [fetchImpl, expectedError] of [
    [async () => ({ ok: false, status: 500 }), /HTTP 500/],
    [async () => { throw new Error('Network unreachable'); }, /Network unreachable/],
  ]) {
    const surface = new RasterRegionSurface(
      { ...REGION_SURFACES.lukla, imageryUrl: '', demUrl: 'terrain/missing_dem.bin' },
      { fetchImpl },
    );
    await surface.demReady;
    assert.equal(surface.isLoaded, false);
    assert.match(surface.loadError, expectedError);
    surface.dispose();
  }
});
