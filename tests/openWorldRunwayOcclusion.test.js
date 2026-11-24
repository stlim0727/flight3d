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

async function loadWorld({ mounted = true } = {}) {
  const terrain = new ExternalAirportSurface({
    airport: airport(), overrides: {}, outsideHeight: () => demElevationM,
  });
  const region = { terrain, extent: terrain.extent, mounted, group: { visible: mounted } };
  // A visible region without runways must not break tile loading.
  const coastal = { terrain: {}, extent: { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 }, mounted: true, group: { visible: true } };
  const world = {
    regions: new Map([['RKTH', region], ['coastal', coastal]]),
    offsets: new Map([['RKTH', [0, 0]], ['coastal', [0, 0]]]),
  };
  const openWorld = new OpenWorldTerrain({
    origin, world,
    elevationCache: { get() { return Promise.resolve(null); }, prefetch() {}, dispose() {} },
  });
  openWorld.raster = () => Promise.resolve(new Float32Array(256 ** 2).fill(demElevationM));
  openWorld.fetchWater = () => Promise.resolve(null);
  await openWorld.load(tile);
  return { openWorld, terrain, region };
}

function assertRunwayClear(openWorld, terrain) {
  const entry = openWorld.tiles.get(key);
  assert.ok(entry, 'runway tile must be loaded');
  const raycaster = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const rayOrigin = new Vector3();
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
      raycaster.set(rayOrigin.set(px, 1000, pz), down);
      const hit = raycaster.intersectObject(entry.mesh).find(hit => hit.point.y > runwayElevationM + EXTERNAL_MESH_LIFT_M);
      assert.equal(hit, undefined,
        `runway ${runway.id} terrain triangle covers the pavement at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
      checked++;
    }
  }
  const centre = terrain.runways[0].centre;
  raycaster.set(rayOrigin.set(centre.x, 1000, centre.z + 400), down);
  assert.ok(raycaster.intersectObject(entry.mesh).length > 0, 'raycaster must hit terrain beside the runway');
  const rawBeside = openWorld.sampleRaw(centre.x, centre.z + 25);
  assert.ok(rawBeside !== undefined && Math.abs(rawBeside - demElevationM) < 0.5,
    `clipped vertices must keep the raw DEM height, got ${rawBeside}`);
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

test('unmounted runways keep terrain until the region becomes visible again', async () => {
  const { openWorld, terrain, region } = await loadWorld({ mounted: false });
  const entry = openWorld.tiles.get(key);
  assert.equal(entry.runwayCutouts.length, 0);
  const centre = terrain.runways[0].centre;
  const raycaster = new Raycaster(new Vector3(centre.x, 1000, centre.z), new Vector3(0, -1, 0));
  assert.ok(raycaster.intersectObject(entry.mesh).length > 0,
    'an unmounted runway must not leave a terrain hole without pavement');

  region.mounted = true;
  region.group.visible = true;
  openWorld.syncRunwayVisibility();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(openWorld.tiles.get(key).runwayCutouts.length > 0,
    'mounting a runway must rebuild the tile with its cutout');
  assertRunwayClear(openWorld, terrain);
  openWorld.dispose();
});
