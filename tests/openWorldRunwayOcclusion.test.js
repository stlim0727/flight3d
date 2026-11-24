import assert from 'node:assert/strict';
import test from 'node:test';
import { Raycaster, Vector3 } from 'three';
import { OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';
import { localToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';
import { EXTERNAL_MESH_LIFT_M, ExternalAirportSurface } from '../src/geospatial/externalAirportSurface.js';
const origin = { latitude: 37.55, longitude: 126.98 };

const tile = { x: 1746, y: 793, key: '1746/793' };
const key = tile.key;
const runwayElevationM = 10;
const demElevationM = 40; // 30 m of unmapped relief above every runway.

function geodetic(localX, localZ) {
  const { latitude, longitude } = localToWgs84(localX, localZ, origin);
  return { latitude, longitude, elevationM: runwayElevationM };
}

function end(ident, localX, localZ) {
  const point = geodetic(localX, localZ);
  return { ident, physical: point, threshold: point };
}

function airport() {
  const cos = Math.cos(35 * Math.PI / 180);
  const sin = Math.sin(35 * Math.PI / 180);
  return {
    ident: 'RKTH',
    ...geodetic(0, 0),
    elevationM: runwayElevationM,
    runways: [
      {
        id: '10/28', widthM: 45, surface: 'ASP',
        ends: [end('10', 1250, 0), end('28', -1250, 0)],
      },
      {
        id: 'cross', widthM: 30, surface: 'CON',
        ends: [end('17', 600 - cos * 900, 800 - sin * 900),
          end('35', 600 + cos * 900, 800 + sin * 900)],
      },
    ],
  };
}

async function loadWorld() {
  const terrain = new ExternalAirportSurface({
    airport: airport(), overrides: {}, outsideHeight: () => demElevationM,
  });
  const world = {
    regions: new Map([['RKTH', { terrain, extent: terrain.extent }]]),
    offsets: new Map([['RKTH', [0, 0]]]),
  };
  const openWorld = new OpenWorldTerrain({
    origin, world,
    elevationCache: { get() { return Promise.resolve(null); }, prefetch() {}, dispose() {} },
  });
  openWorld.raster = () => Promise.resolve(new Float32Array(256 ** 2).fill(demElevationM));
  openWorld.fetchWater = () => Promise.resolve(null);
  await openWorld.load(tile);
  return { openWorld, terrain };
}

function assertRunwayClear(openWorld, terrain) {
  const entry = openWorld.tiles.get(key);
  assert.ok(entry, 'runway tile must be loaded');
  const raycaster = new Raycaster();
  const down = new Vector3(0, -1, 0);
  let checked = 0;
  for (const runway of terrain.runways) {
    const a = runway.ends[0].physical;
    const b = runway.ends[1].physical;
    // Midpoint first: a threshold-only failure would miss the reported
    // interior centreline occlusion.
    for (const i of [50, ...Array.from({ length: 100 }, (_, n) => n)]) {
      const t = i / 100;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const contact = terrain.getHeight(px, pz);
      assert.ok(Math.abs(contact - runwayElevationM) < 0.05,
        `runway ${runway.id} contact height ${contact} must stay at the pavement elevation`);
      const sampled = openWorld.sample(px, pz);
      assert.ok(!sampled || sampled.height <= runwayElevationM + 1e-3,
        `runway ${runway.id} terrain sample ${sampled?.height} at ${px.toFixed(1)}, ${pz.toFixed(1)} must not rise above the pavement`);
      const hit = raycaster.intersectObject(entry.mesh).find(hit => hit.point.y > runwayElevationM + EXTERNAL_MESH_LIFT_M);
      assert.equal(hit, undefined,
        `runway ${runway.id} terrain triangle covers the pavement at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
      checked++;
    }
  }
  assert.equal(checked, 202);
}

test('streamed terrain stays below every world runway strip and its contact height', async () => {
  const { openWorld, terrain } = await loadWorld();
  assertRunwayClear(openWorld, terrain);

  // A reload rebuilds the tile from the same DEM; the cut must survive it.
  await openWorld.load(tile);
  assert.notEqual(openWorld.tiles.get(key), undefined);
  assertRunwayClear(openWorld, terrain);

  // Reduced LOD uses 4x coarser triangles, which could bridge a narrow strip.
  const entry = openWorld.tiles.get(key);
  openWorld.reducedGeometry = true;
  openWorld.detailedKey = 'another/tile';
  openWorld.updateRenderGeometry(entry, key);
  assert.equal(entry.mesh.geometry, entry.fullGeometry);
  assertRunwayClear(openWorld, terrain);
  openWorld.dispose();
});
