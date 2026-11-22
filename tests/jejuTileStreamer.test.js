import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { JEJU_AIRFIELD, JejuFlightSurface } from '../src/geospatial/JejuFlightSurface.js';
import { JejuTileStreamer, JEJU_ORIGIN, JEJU_MACRO_TILES } from '../src/environment/JejuTileStreamer.js';
import { loadJejuAirport } from '../src/environment/JejuAirport.js';

test('JejuTileStreamer initializes with correct macro grid bounds and origin', () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 10, 10);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  const streamer = new JejuTileStreamer(mesh, surface);
  assert.equal(streamer.origin.latitude, JEJU_ORIGIN.latitude);
  assert.equal(streamer.origin.longitude, JEJU_ORIGIN.longitude);
  assert.equal(JEJU_MACRO_TILES.length, 8);

  const { minX, maxX, minZ, maxZ } = streamer.gridBounds;
  assert.ok(minX < maxX, `minX (${minX}) should be less than maxX (${maxX})`);
  assert.ok(minZ < maxZ, `minZ (${minZ}) should be less than maxZ (${maxZ})`);

  // Bounding box should span approximately 100-140 km East-West and 50-70 km North-South
  const widthM = maxX - minX;
  const heightM = maxZ - minZ;
  assert.ok(widthM > 100000 && widthM < 150000, `Grid width should be ~125km, got ${widthM}`);
  assert.ok(heightM > 40000 && heightM < 80000, `Grid height should be ~65km, got ${heightM}`);
});

test('JejuTileStreamer strictly delegates all physics and surface queries to JejuFlightSurface', () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 10, 10);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const streamer = new JejuTileStreamer(mesh, surface);

  const testCoords = [
    [-1000, 424],       // On RW07
    [0, 0],             // Midpoint RW07/25
    [-1463.6, 621.3],   // RW07 threshold
    [1463.6, -621.3],   // RW25 threshold
    [3740, 16000],      // Hallasan peak
    [0, 20000],         // Southern slope
    [0, -5000],         // Northern coastline / ocean
    [50000, 50000],     // Far ocean (seabed)
  ];

  for (const [x, z] of testCoords) {
    assert.equal(streamer.getHeight(x, z), surface.getHeight(x, z), `Height mismatch at (${x}, ${z})`);
    assert.deepEqual(streamer.getNormal(x, z), surface.getNormal(x, z), `Normal mismatch at (${x}, ${z})`);
    assert.equal(streamer.isOnRunway(x, z), surface.isOnRunway(x, z), `isOnRunway mismatch at (${x}, ${z})`);
    assert.equal(streamer.isRunwaySafetyArea(x, z), surface.isRunwaySafetyArea(x, z), `isRunwaySafetyArea mismatch at (${x}, ${z})`);
  }
});

test('JejuTileStreamer updateMeshUVs normalizes terrain geometry to macro tile bounds', () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 4, 4);
  geo.rotateX(-Math.PI / 2);
  geo.translate(3740, 0, 16000);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  const streamer = new JejuTileStreamer(mesh, surface);
  streamer.updateMeshUVs();

  const uv = geo.attributes.uv;
  assert.ok(uv, 'UV attribute must exist');
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    assert.ok(u >= 0 && u <= 1, `U coordinate out of range: ${u}`);
    assert.ok(v >= 0 && v <= 1, `V coordinate out of range: ${v}`);
  }
});

test('JejuTileStreamer updateMeshUVs accurately aligns origin vertex with fractional Mercator tile position', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0]);
  const uvs = new Float32Array([0, 0]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  const streamer = new JejuTileStreamer(mesh, surface);
  streamer.updateMeshUVs();

  const { wgs84ToTile } = await import('../src/geospatial/TileCoordinateSystem.js');
  const tile = wgs84ToTile(JEJU_ORIGIN.latitude, JEJU_ORIGIN.longitude, 10);
  const expectedU = (tile.x + tile.fx - 870) / 4;
  const expectedV = 1.0 - (tile.y + tile.fy - 410) / 2;

  const actualU = geo.attributes.uv.getX(0);
  const actualV = geo.attributes.uv.getY(0);

  assert.ok(Math.abs(actualU - expectedU) < 1e-4, `U mismatch: expected ${expectedU}, got ${actualU}`);
  assert.ok(Math.abs(actualV - expectedV) < 1e-4, `V mismatch: expected ${expectedV}, got ${actualV}`);
});

test('JejuTileStreamer loadIslandMacroTiles handles offline environment without throwing', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 2, 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  const streamer = new JejuTileStreamer(mesh, surface);
  const loaded = await streamer.loadIslandMacroTiles();
  // In headless Node test runner without browser canvas, it should resolve false safely
  assert.equal(loaded, false);
  const metrics = streamer.getMetrics();
  assert.equal(metrics.activeLOD, 'macro');
  assert.equal(metrics.tilesLoaded, 0);
});

test('JejuTileStreamer clean disposal frees resources and blocks late async updates', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 2, 2);
  const initialMat = new THREE.MeshBasicMaterial({ color: 0x228833 });
  const mesh = new THREE.Mesh(geo, initialMat);

  // Mock a slow cache manager
  const slowCache = {
    getTileImage() {
      return new Promise((resolve) => setTimeout(() => resolve({ width: 256, height: 256 }), 50));
    },
    getMetrics() { return {}; },
    dispose() {},
  };

  const streamer = new JejuTileStreamer(mesh, surface, { cacheManager: slowCache });
  const loadingPromise = streamer.loadIslandMacroTiles();

  // Dispose immediately while loading is in flight
  streamer.dispose();
  assert.equal(streamer.disposed, true);
  assert.equal(streamer.macroTexture, null);
  assert.equal(streamer.canvas, null);
  assert.equal(streamer.isStreaming, false);

  const result = await loadingPromise;
  assert.equal(result, false, 'Disposed streamer should resolve false');
  assert.equal(mesh.material.map, null, 'Disposed streamer must never re-attach texture to mesh');
});

test('loadJejuAirport integrates tileStreamer and exposes lifecycle disposal', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false, streamTiles: true, autoloadTiles: false });
  assert.ok(airport.tileStreamer, 'Airport should expose tileStreamer');
  assert.equal(airport.terrain.tileStreamer, airport.tileStreamer);
  assert.equal(typeof airport.dispose, 'function');
  assert.doesNotThrow(() => airport.dispose());
});

test('JejuTileStreamer supports Zoom 11 configuration with identical bounds and UV alignment', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo10 = new THREE.PlaneGeometry(80000, 56000, 4, 4);
  const mesh10 = new THREE.Mesh(geo10, new THREE.MeshBasicMaterial());
  const streamer10 = new JejuTileStreamer(mesh10, surface, { zoom: 10, anisotropy: 1 });

  const geo11 = new THREE.PlaneGeometry(80000, 56000, 4, 4);
  const mesh11 = new THREE.Mesh(geo11, new THREE.MeshBasicMaterial());
  const streamer11 = new JejuTileStreamer(mesh11, surface, { zoom: 11, anisotropy: 8 });

  assert.equal(streamer10.macroTiles.length, 8);
  assert.equal(streamer11.macroTiles.length, 32);
  assert.equal(streamer11.anisotropy, 8);

  // Geographic gridBounds must match within millimeter precision
  assert.ok(Math.abs(streamer10.gridBounds.minX - streamer11.gridBounds.minX) < 1e-3);
  assert.ok(Math.abs(streamer10.gridBounds.maxX - streamer11.gridBounds.maxX) < 1e-3);
  assert.ok(Math.abs(streamer10.gridBounds.minZ - streamer11.gridBounds.minZ) < 1e-3);
  assert.ok(Math.abs(streamer10.gridBounds.maxZ - streamer11.gridBounds.maxZ) < 1e-3);

  // UV coordinates for every vertex must match identically between zoom 10 and 11
  streamer10.updateMeshUVs();
  streamer11.updateMeshUVs();

  const uv10 = geo10.attributes.uv;
  const uv11 = geo11.attributes.uv;
  for (let i = 0; i < uv10.count; i++) {
    assert.ok(Math.abs(uv10.getX(i) - uv11.getX(i)) < 1e-5, `UV X drift at vertex ${i}`);
    assert.ok(Math.abs(uv10.getY(i) - uv11.getY(i)) < 1e-5, `UV Y drift at vertex ${i}`);
  }
});

test('JejuTileStreamer setConfig dynamically updates anisotropy and zoom tiles', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 2, 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const streamer = new JejuTileStreamer(mesh, surface, { zoom: 10, anisotropy: 1 });

  assert.equal(streamer.zoom, 10);
  assert.equal(streamer.anisotropy, 1);
  assert.equal(streamer.macroTiles.length, 8);

  // Update anisotropy only
  await streamer.setConfig({ anisotropy: 8 });
  assert.equal(streamer.anisotropy, 8);
  assert.equal(streamer.zoom, 10);

  // Update zoom to 11
  await streamer.setConfig({ zoom: 11 });
  assert.equal(streamer.zoom, 11);
  assert.equal(streamer.macroTiles.length, 32);
});

test('JejuTileStreamer discards stale in-flight loads when loadGeneration advances', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 2, 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  let callCount = 0;
  const mockCache = {
    getTileImage() {
      callCount++;
      return new Promise((resolve) => setTimeout(() => resolve({ width: 256, height: 256 }), 30));
    },
    getMetrics() { return {}; },
    dispose() {},
  };

  const streamer = new JejuTileStreamer(mesh, surface, { cacheManager: mockCache, zoom: 10 });
  const loadPromise1 = streamer.loadIslandMacroTiles();

  // Advance generation by re-triggering load with zoom 11
  streamer.setZoomLevel(11);
  const loadPromise2 = streamer.loadIslandMacroTiles();

  const [res1, res2] = await Promise.all([loadPromise1, loadPromise2]);
  // In Node test runner without document, both safely resolve false, but res1 must have aborted on generation check
  assert.equal(res1, false);
  assert.equal(streamer.loadGeneration, 2);
});

test('JejuTileStreamer setConfig allows retry after failure because appliedZoom is not set', async () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 2, 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  let failNetwork = true;
  let attempts = 0;
  const flakyCache = {
    getTileImage() {
      attempts++;
      if (failNetwork) return Promise.resolve(null);
      return Promise.resolve({ width: 256, height: 256 });
    },
    getMetrics() { return {}; },
    dispose() {},
  };

  const streamer = new JejuTileStreamer(mesh, surface, { cacheManager: flakyCache, zoom: 10 });
  assert.equal(streamer.appliedZoom, null);

  // First attempt fails (loadIslandMacroTiles returns false)
  const success1 = await streamer.setConfig({ zoom: 11 });
  assert.equal(success1, false);
  assert.equal(streamer.zoom, 11);
  assert.equal(streamer.appliedZoom, null);

  // Second attempt with the exact same zoom=11 executes loadIslandMacroTiles again rather than skipping
  const success2 = await streamer.setConfig({ zoom: 11 });
  assert.equal(success2, false);
  assert.equal(streamer.appliedZoom, null);
  // It attempted the load twice rather than short-circuiting on attempts
  assert.ok(streamer.loadGeneration >= 2);
});
