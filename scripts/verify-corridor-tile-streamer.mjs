#!/usr/bin/env node
/**
 * scripts/verify-corridor-tile-streamer.mjs
 *
 * Automated verification and benchmark script for Phase 2:
 * 451.2km Incheon ↔ Jeju flight corridor dynamic tile streaming & oceanic ditching.
 *
 * Verifies:
 * 1. Continuous analytical surface across 451.2km (7m Incheon, 0m ocean, 154m Chuja, 36m Jeju)
 * 2. Dynamic lookahead tile streaming and rear tile pruning
 * 3. VRAM usage stays strictly under 150MB budget throughout the entire flight
 * 4. Water ditching (WaterDitching) simulation succeeds across marine corridor segments
 * 5. Clean resource disposal and teardown with zero leaks
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  INCHEON_ORIGIN,
  JEJU_ORIGIN,
  CORRIDOR_WAYPOINTS,
  getCorridorDistanceM,
  interpolateRoute,
  wgs84ToJejuLocal,
} from '../src/geospatial/CorridorCoordinateSystem.js';
import { CorridorFlightSurface } from '../src/environment/CorridorFlightSurface.js';
import { CorridorTileStreamer } from '../src/environment/CorridorTileStreamer.js';
import { WaterDitching } from '../src/physics/WaterDitching.js';
import { BODY_SUPPORT_POINTS } from '../src/physics/groundContacts.js';

console.log('🚀 [Phase 2] Starting 451.2km Incheon ↔ Jeju Flight Corridor Verification\n');

// 1. Initialize Surface and Streamer
const scene = new THREE.Scene();
const flightSurface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
const streamer = new CorridorTileStreamer(flightSurface, {
  origin: JEJU_ORIGIN,
  group: scene,
});

const totalDistM = getCorridorDistanceM();
console.log(`📍 Corridor Total Route Distance: ${(totalDistM / 1000).toFixed(1)} km`);
console.log(`📍 Origins: Incheon (${INCHEON_ORIGIN.elevationM}m MSL) ➔ Jeju (${JEJU_ORIGIN.elevationM}m MSL)`);
console.log(`📍 Water Level: 0.0m MSL uniform across Yellow Sea, Dadohae, and Korea Strait\n`);

// 2. Simulate 451.2km Flight Corridor with Telemetry Sampling
const steps = 60; // Sample every ~7.5km
let maxVramMb = 0;
let totalDisposed = 0;
const aero = { mass: 66000, invIxx: 1 / 1650000, invIyy: 1 / 3450000, invIzz: 1 / 4850000, cg: { x: 0, y: 0, z: 0 } };

console.log('✈️  Simulating 451.2km Enroute Flight:');

for (let i = 0; i <= steps; i++) {
  const progress = i / steps;
  const state = interpolateRoute(progress);
  const [localX, localZ] = wgs84ToJejuLocal(state.latitude, state.longitude);

  // Update dynamic corridor streamer
  await streamer.update({
    x: localX,
    z: localZ,
    altitudeM: state.altitudeM,
    headingDeg: state.headingDeg,
  });

  const metrics = streamer.getMetrics();
  maxVramMb = Math.max(maxVramMb, metrics.estimatedVramMb);
  totalDisposed = metrics.tilesDisposed;

  // Verify surface query continuity
  const surfaceHeight = flightSurface.getHeight(localX, localZ);
  const isWater = flightSurface.isWater(localX, localZ);
  assert.ok(Number.isFinite(surfaceHeight), `Surface height at step ${i} must be finite`);

  // Progress milestones
  if (i === 0) {
    console.log(`  [00%] RKSI Departure: Pos=(${localX.toFixed(0)}, ${localZ.toFixed(0)})m, Surface=${surfaceHeight.toFixed(1)}m, VRAM=${metrics.estimatedVramMb}MB, ActiveTiles=${metrics.activeTiles}`);
    assert.equal(surfaceHeight, 7.0, 'Incheon runway surface must be 7.0m');
  } else if (i === Math.floor(steps * 0.25)) {
    console.log(`  [25%] Yellow Sea (BOPTA): Alt=${state.altitudeFt.toFixed(0)}ft, Surface=${surfaceHeight.toFixed(1)}m, VRAM=${metrics.estimatedVramMb}MB, ActiveTiles=${metrics.activeTiles}`);
    assert.equal(surfaceHeight, 0.0, 'Yellow Sea water level must be 0.0m');
    assert.equal(isWater, true);
  } else if (i === Math.floor(steps * 0.50)) {
    console.log(`  [50%] Mid-Cruise (SOSDO): Alt=${state.altitudeFt.toFixed(0)}ft, Surface=${surfaceHeight.toFixed(1)}m, VRAM=${metrics.estimatedVramMb}MB, ActiveTiles=${metrics.activeTiles}`);
    assert.equal(surfaceHeight, 0.0, 'Dadohae offshore water level must be 0.0m');
  } else if (i === Math.floor(steps * 0.75)) {
    console.log(`  [75%] Descent (DOTOL): Alt=${state.altitudeFt.toFixed(0)}ft, Surface=${surfaceHeight.toFixed(1)}m, VRAM=${metrics.estimatedVramMb}MB, ActiveTiles=${metrics.activeTiles}`);
  } else if (i === steps) {
    console.log(`  [100%] RW07 Touchdown (Jeju): Surface=${surfaceHeight.toFixed(1)}m, VRAM=${metrics.estimatedVramMb}MB, ActiveTiles=${metrics.activeTiles}, CumulativeDisposed=${metrics.tilesDisposed}`);
    assert.equal(surfaceHeight, 36.0, 'Jeju RW07 surface must be 36.0m');
  }

  // Strict VRAM budget assertion
  assert.ok(
    metrics.estimatedVramMb < metrics.vramBudgetMb,
    `VRAM exceeded 150MB budget at step ${i}: got ${metrics.estimatedVramMb}MB`
  );
}

console.log(`\n📊 VRAM Budget Check: Peak VRAM = ${maxVramMb.toFixed(2)} MB (Budget: 150.0 MB — Used: ${(maxVramMb / 1.5).toFixed(1)}%)`);
assert.ok(maxVramMb < 35.0, `Peak VRAM should be well under 35MB, got ${maxVramMb}MB`);
assert.ok(totalDisposed > 0, 'Streamer must have pruned trailing tiles along the corridor');

// 3. Oceanic Water Ditching Verification at 4 Marine Waypoints
console.log('\n🌊 Testing Oceanic Emergency Ditching along the Corridor:');
const ditchWaypoints = ['BOPTA', 'OLMEN', 'SOSDO', 'TAMNA'];

for (const ident of ditchWaypoints) {
  const wpt = CORRIDOR_WAYPOINTS.find(w => w.ident === ident);
  const [wx, wz] = wgs84ToJejuLocal(wpt.latitude, wpt.longitude);

  const ditching = new WaterDitching();
  const mesh = new THREE.Object3D();
  mesh.position.set(wx, 1.0, wz);
  mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(4.0));
  mesh.updateMatrixWorld(true);

  const linearVel = new THREE.Vector3(0, -1.2, -65);
  const angularVel = new THREE.Vector3(0, 0, 0);

  const result = ditching.update(
    0.016,
    mesh,
    linearVel,
    angularVel,
    flightSurface,
    aero,
    BODY_SUPPORT_POINTS,
    0.0,
    4.0,
    0.0
  );

  console.log(`  ✔ [${ident.padEnd(5)}] Ditching Check: Contact=${result.ditchingContact}, PlaningForce=${result.forces.y.toFixed(0)}N, Drag=${result.forces.z.toFixed(0)}N, Spray=${result.sprayIntensity.toFixed(2)}`);
  assert.equal(result.catastrophic, false);
  assert.equal(result.ditchingContact, true);
  assert.ok(result.forces.y > 0);
  assert.ok(result.forces.z > 0);
}

// 4. Disposal and Teardown
console.log('\n🧹 Verifying Streamer Disposal:');
streamer.dispose();
const finalMetrics = streamer.getMetrics();
console.log(`  Active Tiles: ${finalMetrics.activeTiles}, Group Children: ${scene.children.length}, Disposed: ${finalMetrics.disposed}`);
assert.equal(finalMetrics.activeTiles, 0);
assert.equal(scene.children.length, 0);
assert.equal(finalMetrics.disposed, true);

console.log('\n✅ [Phase 2 PASS] All corridor streaming, VRAM budget, and oceanic ditching checks succeeded!\n');
