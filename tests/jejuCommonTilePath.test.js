import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TERRAIN_INSETS, getInsetsForRegion } from '../src/config/terrainInsets.js';
import { OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';
import { loadJejuAirport } from '../src/environment/JejuAirport.js';
import { JEJU_ORIGIN } from '../src/geospatial/CorridorCoordinateSystem.js';
import { wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';

test('TERRAIN_INSETS defines declarative high-resolution data for RKPC', () => {
  const insets = getInsetsForRegion('jeju');
  assert.ok(insets.length > 0, 'Jeju must have registered high-resolution insets');

  const rkpc = insets.find((i) => i.id === 'rkpc');
  assert.ok(rkpc, 'RKPC inset must exist');
  assert.equal(rkpc.region, 'jeju');
  assert.deepEqual(rkpc.bounds, [-3200, -1500, 3200, 1500], 'RKPC bounds must match airport precinct');
  assert.equal(rkpc.minDetailLevel, 13, 'RKPC min detail zoom level must be 13');
  assert.equal(rkpc.maxDetailLevel, 14, 'RKPC max detail zoom level must be 14');
  assert.equal(rkpc.approachDistanceM, 8000, 'RKPC approach distance must be 8000m');
});

test('OpenWorldTerrain creates localMesh for RKPC airport precinct sharing common tile material', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false });
  const airportMesh = airport.terrain.airportMesh;
  assert.ok(airportMesh?.geometry, 'JejuAirport airportMesh must have geometry');

  const rkpcInsets = getInsetsForRegion('jeju');
  const dummyElevationCache = {
    getTileImage: async () => null,
    dispose: () => {},
  };
  const dummyImageryCache = {
    getTileImage: async () => null,
    dispose: () => {},
    getMetrics: () => ({ memoryTiles: 0 }),
  };

  const openWorld = new OpenWorldTerrain({
    origin: JEJU_ORIGIN,
    protectedAreas: [[-3200, -1500, 3200, 1500]],
    insets: rkpcInsets,
    localSurface: {
      geometry: airportMesh.geometry,
      extent: { minX: -3200, maxX: 3200, minZ: -1500, maxZ: 1500 },
    },
    elevationCache: dummyElevationCache,
    imageryCache: dummyImageryCache,
  });

  assert.ok(openWorld.localImagery, 'localImagery must be created for RKPC localSurface');
  assert.equal(openWorld.insets.length, 1, 'insets must be registered in OpenWorldTerrain');

  // Verify that RKPC origin maps to tile (1743, 821) at zoom 11
  const originTile = wgs84ToTile(JEJU_ORIGIN.latitude, JEJU_ORIGIN.longitude, 11);
  assert.equal(originTile.x, 1743);
  assert.equal(originTile.y, 821);

  openWorld.dispose();
});

test('updateImageryDetail promotes RKPC inset tiles to detail levels 13 and 14 upon approach', () => {
  const rkpcInsets = getInsetsForRegion('jeju');
  const openWorld = new OpenWorldTerrain({
    origin: JEJU_ORIGIN,
    protectedAreas: [[-3200, -1500, 3200, 1500]],
    insets: rkpcInsets,
    imageryCache: { getTileImage: async () => null, dispose: () => {} },
  });

  // Mock entry overlapping RKPC bounds [-3200, -1500, 3200, 1500]
  const mockMaterial = new THREE.MeshBasicMaterial();
  const mockMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), mockMaterial);
  mockMesh.geometry.computeBoundingSphere();
  const entry = {
    mesh: mockMesh,
    bounds: [-4000, -2000, 4000, 2000],
    detail: { map: { value: null }, blend: { value: 0 } },
    detailLevel: 11,
    baseMap: new THREE.Texture(),
  };
  openWorld.tiles.set('1743/821', entry);

  const camera = new THREE.PerspectiveCamera(60, 1, 10, 50000);

  // 1. Far away (> 8000m): Camera at 15000m south
  camera.position.set(0, 3000, 15000);
  camera.lookAt(0, 0, 0);
  openWorld.updateImageryDetail(camera, 768, 1000);
  // At 15km, inset approach condition is not triggered
  assert.ok((openWorld.detailWanted.get('1743/821') ?? 11) < 13, 'Must remain low-detail at 15km distance');

  // 2. Initial approach (within 8000m): Camera at 6000m south
  openWorld.nextImagerySelection = 0;
  camera.position.set(0, 1200, 6000);
  camera.lookAt(0, 0, 0);
  openWorld.updateImageryDetail(camera, 768, 1500);
  assert.equal(openWorld.detailWanted.get('1743/821'), 13, 'Must promote to detail level 13 within 8000m approach');

  // 3. Final / close approach (within 4000m = 8000m * 0.5): Camera at 2000m south
  openWorld.nextImagerySelection = 0;
  camera.position.set(0, 400, 2000);
  camera.lookAt(0, 0, 0);
  openWorld.updateImageryDetail(camera, 768, 2000);
  assert.equal(openWorld.detailWanted.get('1743/821'), 14, 'Must promote to detail level 14 within 4000m close approach');

  openWorld.dispose();
});

test('loadImageryDetail retains parent tile baseMap when detail sub-tiles fail on restricted network', async () => {
  let callCount = 0;
  const dummyImageryCache = {
    getTileImage: async () => {
      callCount++;
      // Return null to simulate a network timeout / tile failure
      return null;
    },
    dispose: () => {},
  };

  const openWorld = new OpenWorldTerrain({
    origin: JEJU_ORIGIN,
    imageryCache: dummyImageryCache,
  });

  const parentBaseTexture = new THREE.Texture();
  parentBaseTexture.name = 'parent-zoom-11';

  const entry = {
    baseMap: parentBaseTexture,
    detailMap: null,
    detailLevel: 11,
    detail: {
      map: { value: parentBaseTexture },
      blend: { value: 0 },
    },
    mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: parentBaseTexture })),
  };
  openWorld.tiles.set('1743/821', entry);
  openWorld.detailWanted.set('1743/821', 13);

  // Attempt to load detail level 13 (which requires 4 sub-tiles)
  await openWorld.loadImageryDetail('1743/821', entry, 13);

  // Verification: sub-tiles were requested, but because they returned null,
  // the parent baseMap is completely preserved without being overwritten or dropped
  assert.ok(callCount > 0, 'Sub-tiles must have been requested');
  assert.equal(entry.detailMap, null, 'detailMap must remain null on failure');
  assert.equal(entry.detailLevel, 11, 'detailLevel must remain at parent zoom 11');
  assert.equal(entry.detail.map.value, parentBaseTexture, 'Material detail map must retain parent baseMap');
  assert.ok(entry.detailRetryAt > 0, 'Retry timestamp must be scheduled');

  openWorld.dispose();
});

test('JejuAirport hides airportMesh when OpenWorldTerrain localImagery is active and restores when unloaded', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false });
  const islandMesh = airport.terrain.islandMesh;
  const airportMesh = airport.terrain.airportMesh;

  assert.ok(islandMesh && airportMesh);

  // Case 1: OpenWorld active with localImagery and loaded DEM tiles
  airport.terrain.openWorld = {
    tiles: new Map([['1743/821', {}]]),
    localImagery: {},
  };
  airport.update(0.1, { x: 0, y: 1000, z: 0 }, 0);
  assert.equal(islandMesh.visible, false, 'Island mesh must be hidden when DEM tiles are active');
  assert.equal(airportMesh.visible, false, 'Airport precinct mesh must be hidden when OpenWorld localImagery is active');

  // Case 2: OpenWorld unloaded (cold cache / offline fallback)
  airport.terrain.openWorld.tiles.clear();
  airport.update(0.1, { x: 0, y: 1000, z: 0 }, 0);
  assert.equal(islandMesh.visible, true, 'Island mesh must reappear as fallback');
  assert.equal(airportMesh.visible, true, 'Airport precinct mesh must reappear as fallback');
});
