import test from 'node:test';
import assert from 'node:assert/strict';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';
import { RasterRegionSurface } from '../src/environment/RasterRegionSurface.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';

const gridSize = REGION_SURFACES.lukla.gridSize;
const elevations = new Float32Array(gridSize * gridSize).fill(2000);
const sin58 = Math.sin(58 * Math.PI / 180);
const cos58 = Math.cos(58 * Math.PI / 180);

test('declarative raster surface matches the legacy Lukla height model', () => {
  const legacy = new LuklaTerrain(REGION_SURFACES.lukla.size, REGION_SURFACES.lukla.segments, elevations);
  const common = new RasterRegionSurface(REGION_SURFACES.lukla, { elevations, load: false });

  for (const [x, z] of [[0, 0], [200, -100], [-500, 300], [10000, 5000], [-19000, 15000]]) {
    assert.ok(Math.abs(common.getHeight(x, z) - legacy.getHeight(x, z)) < 0.01,
      `height at ${x},${z}`);
    assert.ok(Math.abs(common.getNaturalHeight(x, z) - legacy.getNaturalHeight(x, z)) < 1e-6,
      `natural height at ${x},${z}`);
    const a = common.getNormal(x, z);
    const b = legacy.getNormal(x, z);
    assert.ok(Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01,
      `normal at ${x},${z}`);
  }

  assert.equal(common.isLoaded, true);
  assert.equal(common.size, legacy.size);
  assert.equal(common.localTerraceGeometry.attributes.position.count,
    legacy.localTerraceGeometry.attributes.position.count);
  common.dispose();
});

test('declarative runway endpoints retain the surveyed 2805/2867 m grade', () => {
  const common = new RasterRegionSurface(REGION_SURFACES.lukla, { elevations, load: false });
  const at = s => common.getHeight(s * sin58, -s * cos58);
  assert.ok(Math.abs(at(-263.5) - 2805) < 1, 'RW06 threshold');
  assert.ok(Math.abs(at(263.5) - 2867) < 1, 'RW24 threshold');
  assert.ok(Math.abs(at(0) - 2836) < 1, 'runway midpoint');
  assert.ok(common.isOnRunway(0, 0));
  common.dispose();
});
