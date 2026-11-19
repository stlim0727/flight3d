import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CorridorTileStreamer } from '../src/environment/CorridorTileStreamer.js';
import { CorridorFlightSurface } from '../src/environment/CorridorFlightSurface.js';
import { JEJU_ORIGIN, wgs84ToJejuLocal, CORRIDOR_WAYPOINTS } from '../src/geospatial/CorridorCoordinateSystem.js';

test('CorridorTileStreamer initializes with valid state and group', () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const streamer = new CorridorTileStreamer(surface, { origin: JEJU_ORIGIN });

  assert.equal(streamer.disposed, false);
  assert.equal(streamer.activeTiles.size, 0);
  assert.ok(streamer.group instanceof THREE.Group);

  const metrics = streamer.getMetrics();
  assert.equal(metrics.activeTiles, 0);
  assert.equal(metrics.estimatedVramMb, 0);
  assert.equal(metrics.underBudget, true);
  assert.equal(metrics.vramBudgetMb, 150.0);

  streamer.dispose();
  assert.equal(streamer.disposed, true);
});

test('CorridorTileStreamer selects appropriate zoom based on altitude', () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const streamer = new CorridorTileStreamer(surface, { origin: JEJU_ORIGIN });

  // Cruise altitude (FL280 ~ 8,500m) -> Zoom 9
  assert.equal(streamer.selectZoom(8500), 9);
  // Descent / approach (< 5,000m) -> Zoom 10
  assert.equal(streamer.selectZoom(2500), 10);
  assert.equal(streamer.selectZoom(50), 10);

  streamer.dispose();
});

test('CorridorTileStreamer computeNeededTiles includes forward lookahead tiles', () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const streamer = new CorridorTileStreamer(surface, { origin: JEJU_ORIGIN });

  // Aircraft flying south towards Jeju at (0, -100000), heading 180° (South)
  const needed = streamer.computeNeededTiles({
    x: 0,
    z: -100000,
    altitudeM: 8000,
    headingDeg: 180,
  });

  assert.ok(needed.length >= 2, `Should compute multiple tiles for coverage, got ${needed.length}`);
  // First tile should be closest
  assert.ok(needed[0].distM <= needed[1].distM, 'Candidate tiles must be sorted by distance');

  streamer.dispose();
});

test('CorridorTileStreamer update dynamically loads and prunes trailing tiles', async () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const streamer = new CorridorTileStreamer(surface, { origin: JEJU_ORIGIN });

  // Step 1: Aircraft at Point A (Yellow Sea near BOPTA)
  const bopta = CORRIDOR_WAYPOINTS.find(w => w.ident === 'BOPTA');
  const [bx, bz] = wgs84ToJejuLocal(bopta.latitude, bopta.longitude);

  await streamer.update({
    x: bx,
    z: bz,
    altitudeM: 8000,
    headingDeg: 190,
  });

  const countAfterA = streamer.activeTiles.size;
  assert.ok(countAfterA > 0, 'Active tiles should be loaded at Point A');
  assert.equal(streamer.group.children.length, countAfterA);

  const metricsA = streamer.getMetrics();
  assert.ok(metricsA.estimatedVramMb < 150.0, 'VRAM must be within budget');

  // Step 2: Aircraft moves 250km south to Point B (near TAMNA/Jeju)
  const tamna = CORRIDOR_WAYPOINTS.find(w => w.ident === 'TAMNA');
  const [tx, tz] = wgs84ToJejuLocal(tamna.latitude, tamna.longitude);

  await streamer.update({
    x: tx,
    z: tz,
    altitudeM: 3000,
    headingDeg: 170,
  });

  assert.ok(streamer.tilesDisposed > 0, 'Tiles from Point A (250km away) must be pruned');
  assert.ok(streamer.activeTiles.size <= streamer.config.maxActiveTiles, 'Active tile count must respect max limit');

  const metricsB = streamer.getMetrics();
  assert.ok(metricsB.estimatedVramMb < 20.0, `VRAM should be low (<20MB), got ${metricsB.estimatedVramMb}MB`);
  assert.equal(metricsB.underBudget, true);

  streamer.dispose();
  assert.equal(streamer.activeTiles.size, 0);
  assert.equal(streamer.group.children.length, 0);
});

test('CorridorTileStreamer clean disposal frees all geometries and meshes without leaks', async () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const streamer = new CorridorTileStreamer(surface, { origin: JEJU_ORIGIN });

  await streamer.update({
    x: 0,
    z: 0,
    altitudeM: 2000,
    headingDeg: 70,
  });

  assert.ok(streamer.activeTiles.size > 0);
  assert.ok(streamer.group.children.length > 0);

  streamer.dispose();

  assert.equal(streamer.disposed, true);
  assert.equal(streamer.activeTiles.size, 0);
  assert.equal(streamer.group.children.length, 0);
});
