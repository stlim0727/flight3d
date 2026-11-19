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
  assert.equal(JEJU_MACRO_TILES.length, 4);

  const { minX, maxX, minZ, maxZ } = streamer.gridBounds;
  assert.ok(minX < maxX, `minX (${minX}) should be less than maxX (${maxX})`);
  assert.ok(minZ < maxZ, `minZ (${minZ}) should be less than maxZ (${maxZ})`);

  // Bounding box should span approximately 70-90 km East-West and 50-70 km North-South
  const widthM = maxX - minX;
  const heightM = maxZ - minZ;
  assert.ok(widthM > 60000 && widthM < 100000, `Grid width should be ~78km, got ${widthM}`);
  assert.ok(heightM > 40000 && heightM < 80000, `Grid height should be ~56km, got ${heightM}`);
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

test('JejuTileStreamer clean disposal frees resources', () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);
  const geo = new THREE.PlaneGeometry(80000, 56000, 2, 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());

  const streamer = new JejuTileStreamer(mesh, surface);
  assert.doesNotThrow(() => streamer.dispose());
  assert.equal(streamer.macroTexture, null);
  assert.equal(streamer.canvas, null);
  assert.equal(streamer.isStreaming, false);
});

test('loadJejuAirport integrates tileStreamer and exposes lifecycle disposal', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false, streamTiles: true, autoloadTiles: false });
  assert.ok(airport.tileStreamer, 'Airport should expose tileStreamer');
  assert.equal(airport.terrain.tileStreamer, airport.tileStreamer);
  assert.equal(typeof airport.dispose, 'function');
  assert.doesNotThrow(() => airport.dispose());
});
