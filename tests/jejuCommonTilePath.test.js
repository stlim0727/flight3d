import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TERRAIN_INSETS, getInsetsForRegion } from '../src/config/terrainInsets.js';
import { OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';
import { loadJejuAirport } from '../src/environment/JejuAirport.js';
import { JEJU_ORIGIN } from '../src/geospatial/CorridorCoordinateSystem.js';
import { wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';
import { UnifiedWorld } from '../src/world/UnifiedWorld.js';

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

test('UnifiedWorld forwards airportMesh from active anchorTerrain', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false });
  const world = new UnifiedWorld('jeju');
  world.register('jeju', {
    terrain: airport.terrain,
    airport,
    group: airport.group,
    mesh: airport.terrain.mesh,
    extent: { minX: -3200, maxX: 3200, minZ: -1500, maxZ: 1500 },
  });

  assert.ok(world.airportMesh, 'UnifiedWorld must forward airportMesh from anchor terrain');
  assert.equal(world.airportMesh, airport.terrain.airportMesh, 'Must point to active airportMesh');
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

test('updateImageryDetail respects imageryBudget limits during inset promotion', () => {
  const rkpcInsets = getInsetsForRegion('jeju');
  // Configure budget with 0 ultra-detail tiles (performance preset)
  const openWorld = new OpenWorldTerrain({
    origin: JEJU_ORIGIN,
    protectedAreas: [[-3200, -1500, 3200, 1500]],
    insets: rkpcInsets,
    imageryBudget: {
      detailTileLimit: 4,
      highDetailTileLimit: 2,
      ultraDetailTileLimit: 0, // No zoom 14 allowed
    },
    imageryCache: { getTileImage: async () => null, dispose: () => {} },
  });

  const mockMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
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
  camera.position.set(0, 200, 500); // Very close approach (< 4000m)
  camera.lookAt(0, 0, 0);

  openWorld.updateImageryDetail(camera, 768, 1000);

  // When ultraDetailTileLimit is 0, zoom 14 must be capped at 13
  assert.equal(openWorld.detailWanted.get('1743/821'), 13, 'Must cap zoom 14 at 13 when ultraDetailTileLimit is 0');

  openWorld.dispose();
});

test('updateImageryDetail promotes from zoom 13 to 14 when highDetail slots are at capacity', () => {
  const rkpcInsets = getInsetsForRegion('jeju');
  // High-detail capacity is 1, ultra-detail capacity is 1
  const openWorld = new OpenWorldTerrain({
    origin: JEJU_ORIGIN,
    protectedAreas: [[-3200, -1500, 3200, 1500]],
    insets: rkpcInsets,
    imageryBudget: {
      detailTileLimit: 4,
      highDetailTileLimit: 1, // exactly 1 high-detail slot allowed
      ultraDetailTileLimit: 1, // 1 ultra-detail slot allowed
    },
    imageryCache: { getTileImage: async () => null, dispose: () => {} },
  });

  const mockMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
  mockMesh.geometry.computeBoundingSphere();
  const entry = {
    mesh: mockMesh,
    bounds: [-4000, -2000, 4000, 2000],
    detail: { map: { value: null }, blend: { value: 0 } },
    detailLevel: 11,
    baseMap: new THREE.Texture(),
  };
  openWorld.tiles.set('1743/821', entry);

  // Set the tile as already wanted at level 13
  openWorld.detailWanted.set('1743/821', 13);

  const camera = new THREE.PerspectiveCamera(60, 1, 10, 50000);
  camera.position.set(0, 200, 500); // Close approach (< 4000m)
  camera.lookAt(0, 0, 0);

  openWorld.updateImageryDetail(camera, 768, 1000);

  // Even though highDetailCount reached highDetailTileLimit (1), promoting existing 13 to 14 does not consume
  // an extra high-detail slot and ultra-detail slot is available, so it must promote to 14.
  assert.equal(openWorld.detailWanted.get('1743/821'), 14, 'Must promote from zoom 13 to 14 without being blocked by highDetailTileLimit');

  openWorld.dispose();
});

test('updateImageryDetail measures both surrounding DEM mesh and localMesh', () => {
  const openWorld = new OpenWorldTerrain({
    origin: JEJU_ORIGIN,
    imageryCache: { getTileImage: async () => null, dispose: () => {} },
  });

  const demMesh = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshBasicMaterial());
  demMesh.position.set(0, 0, 0);
  demMesh.geometry.computeBoundingSphere();

  const localMesh = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshBasicMaterial());
  localMesh.position.set(0, 0, -200);
  localMesh.geometry.computeBoundingSphere();

  const entry = {
    mesh: demMesh,
    localMesh,
    bounds: [-500, -500, 500, 500],
    detail: { map: { value: null }, blend: { value: 0 } },
    detailLevel: 11,
    baseMap: new THREE.Texture(),
  };
  openWorld.tiles.set('test/tile', entry);

  const camera = new THREE.PerspectiveCamera(60, 1, 10, 50000);
  camera.position.set(0, 100, 300);
  camera.lookAt(0, 0, 0);

  openWorld.updateImageryDetail(camera, 768, 1000);
  assert.ok(entry.imageryPriority > 0, 'Must compute valid imageryPriority using max of DEM and localMesh');

  openWorld.dispose();
});

test('loadImageryDetail retains parent tile baseMap when detail sub-tiles fail on restricted network', async () => {
  let callCount = 0;
  const dummyImageryCache = {
    getTileImage: async () => {
      callCount++;
      return null; // Simulate network error
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

  await openWorld.loadImageryDetail('1743/821', entry, 13);

  assert.ok(callCount > 0, 'Sub-tiles must have been requested');
  assert.equal(entry.detailMap, null, 'detailMap must remain null on failure');
  assert.equal(entry.detailLevel, 11, 'detailLevel must remain at parent zoom 11');
  assert.equal(entry.detail.map.value, parentBaseTexture, 'Material detail map must retain parent baseMap');
  assert.ok(entry.detailRetryAt > 0, 'Retry timestamp must be scheduled');

  openWorld.dispose();
});

test('JejuAirport keeps airportMesh visible until replacement localMesh is rendered with imagery', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false });
  const islandMesh = airport.terrain.islandMesh;
  const airportMesh = airport.terrain.airportMesh;

  assert.ok(islandMesh && airportMesh);

  // Case 1: DEM tiles loaded, localImagery configured, but localMesh not yet visible (imagery loading)
  airport.terrain.openWorld = {
    tiles: new Map([['1743/821', {}]]),
    localImagery: {},
    hasVisibleLocalMesh: () => false,
  };
  airport.update(0.1, { x: 0, y: 1000, z: 0 }, 0);
  assert.equal(islandMesh.visible, false, 'Island mesh must be hidden when DEM tiles are active');
  assert.equal(airportMesh.visible, true, 'Airport precinct fallback must remain visible while replacement imagery is pending');

  // Case 2: Replacement localMesh imagery succeeds and becomes visible
  airport.terrain.openWorld.hasVisibleLocalMesh = () => true;
  airport.update(0.1, { x: 0, y: 1000, z: 0 }, 0);
  assert.equal(airportMesh.visible, false, 'Airport precinct fallback hides once replacement localMesh is visible');

  // Case 3: OpenWorld unloaded (cold cache / offline fallback)
  airport.terrain.openWorld.tiles.clear();
  airport.terrain.openWorld.hasVisibleLocalMesh = () => false;
  airport.update(0.1, { x: 0, y: 1000, z: 0 }, 0);
  assert.equal(islandMesh.visible, true, 'Island mesh must reappear as fallback');
  assert.equal(airportMesh.visible, true, 'Airport precinct mesh must reappear as fallback');
});
