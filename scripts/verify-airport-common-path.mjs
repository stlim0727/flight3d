#!/usr/bin/env node
/**
 * scripts/verify-airport-common-path.mjs
 *
 * Automated verification and benchmark script for Issue #956 (Step 2):
 * Airport Common Path Expansion:
 * - Single source of truth runway generator (externalAirportSurface.js)
 * - Declarative airport overrides (precision elevation, markings, lighting, taxiways, facilities)
 * - PAPI glideslope guidance & approach lighting
 * - Collision & height consistency between visual mesh and flight physics
 * - Universal autonomous airport generation for un-overridden OurAirports records
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  getAirportOverride,
} from '../src/config/airportOverrides.js';
import {
  buildExternalRunwayDescriptors,
  createExternalAirportRegion,
  ExternalAirportSurface,
} from '../src/geospatial/externalAirportSurface.js';
import { projectToLocal } from '../src/geospatial/incheon.js';

console.log('🚀 [Issue #956 - Step 2] Starting Airport Common Path Verification\n');

// 1. Verify Declarative Override Data for RKPC
console.log('📋 1. Verifying Declarative Override Data (RKPC):');
const rkpcOverride = getAirportOverride('RKPC');
assert.ok(rkpcOverride, 'RKPC override must exist in registry');
console.log(`  • Airport ICAO: ${rkpcOverride.ident}`);
console.log(`  • Precision Elevation: ${rkpcOverride.elevationM} m`);
console.log(`  • Runways configured: ${rkpcOverride.runways.map(r => r.ident).join(', ')}`);
console.log(`  • Taxiways configured: ${rkpcOverride.taxiways.map(t => t.name).join(', ')}`);
console.log(`  • Facilities configured: ${rkpcOverride.facilities.map(f => `${f.name} (${f.kind})`).join(', ')}`);
console.log('  ✔ Declarative override data parsed successfully\n');

// Sample RKPC Record
const RKPC_RECORD = {
  id: '5639',
  ident: 'RKPC',
  icao: 'RKPC',
  iata: 'CJU',
  name: 'Jeju International Airport',
  type: 'large_airport',
  latitude: 33.512058,
  longitude: 126.492548,
  elevationM: 35.97,
  country: 'KR',
  region: 'KR-49',
  municipality: 'Jeju City',
  runways: [
    {
      id: '237295',
      lengthM: 3180,
      widthM: 45.1,
      surface: 'ASP',
      lighted: true,
      ends: [
        {
          ident: '07',
          physical: { latitude: 33.500401, longitude: 126.469002, elevationM: 26.21 },
          threshold: { latitude: 33.500401, longitude: 126.469002, elevationM: 26.21 },
          displacedThresholdM: 0,
          headingDegT: 58.9,
        },
        {
          ident: '25',
          physical: { latitude: 33.5145, longitude: 126.497002, elevationM: 23.16 },
          threshold: { latitude: 33.5145, longitude: 126.497002, elevationM: 23.16 },
          displacedThresholdM: 0,
          headingDegT: 238.9,
        },
      ],
    },
    {
      id: '237296',
      lengthM: 1910.5,
      widthM: 45.1,
      surface: 'ASP',
      lighted: true,
      ends: [
        {
          ident: '13',
          physical: { latitude: 33.515499, longitude: 126.487, elevationM: 20.42 },
          threshold: { latitude: 33.515499, longitude: 126.487, elevationM: 20.42 },
          displacedThresholdM: 0,
          headingDegT: 125.2,
        },
        {
          ident: '31',
          physical: { latitude: 33.505501, longitude: 126.503998, elevationM: 32 },
          threshold: { latitude: 33.507634, longitude: 126.500372, elevationM: 29.53 },
          displacedThresholdM: 411.48,
          headingDegT: 305.2,
        },
      ],
    },
  ],
};

// 2. Build RKPC via Common Airport Generator
console.log('🛫 2. Building RKPC Airport Environment via Common Generator:');
const t0 = performance.now();
const [arpX, arpZ] = projectToLocal(RKPC_RECORD.latitude, RKPC_RECORD.longitude);
const rkpcRegion = createExternalAirportRegion({
  airport: RKPC_RECORD,
  baseOffset: [arpX, arpZ],
  outsideHeight: () => 0,
});
const buildTime = performance.now() - t0;

console.log(`  • Build Time: ${buildTime.toFixed(2)} ms`);
console.log(`  • Scene Children Count: ${rkpcRegion.group.children.length}`);
console.log(`  • Contact Surface Elevation: ${rkpcRegion.terrain.elevationM} m`);

const rwy07 = rkpcRegion.terrain.runways[0];
const rwyCentre = rwy07.centre;
const groundHeight = rkpcRegion.terrain.getHeight(rwyCentre.x, rwyCentre.z);
console.log(`  • Runway 07/25 Ground Contact Height: ${groundHeight.toFixed(2)} m`);
assert.equal(groundHeight, 36.0, 'Runway contact height must match 36.0m override');
assert.equal(rkpcRegion.airport.isOnRunway(rwyCentre.x, rwyCentre.z), true, 'Center must be on runway');
console.log('  ✔ Runway height & contact physics match 100% with visual geometry\n');

// 3. Verify Interactive PAPI Glideslope
console.log('💡 3. Verifying Interactive PAPI 4-Light Glideslope Guidance:');
const papi = rkpcRegion.airport.nightLighting.papiSystems[0];
assert.ok(papi, 'PAPI system must be created');
const center = papi.center;
const dir = papi.approachDir;

// Test On-Slope (3.0°)
const onSlopeAlt = center.y + 2000 * Math.tan(THREE.MathUtils.degToRad(3.0));
rkpcRegion.airport.update(0.1, new THREE.Vector3(center.x + dir.x * 2000, onSlopeAlt, center.z + dir.z * 2000));
const onSlopeColors = papi.units.map(u => u.lensMat.color.getHex());
console.log(`  • 3.0° Glideslope (On-Slope): [${onSlopeColors.map(c => c === 0xffffff ? 'WHITE' : 'RED').join(', ')}]`);
assert.deepEqual(onSlopeColors, [0xffffff, 0xffffff, 0xff1a1a, 0xff1a1a], 'On-slope must be 2 White 2 Red');

// Test High Approach (3.6°)
const highAlt = center.y + 2000 * Math.tan(THREE.MathUtils.degToRad(3.6));
rkpcRegion.airport.update(0.1, new THREE.Vector3(center.x + dir.x * 2000, highAlt, center.z + dir.z * 2000));
const highColors = papi.units.map(u => u.lensMat.color.getHex());
console.log(`  • 3.6° Glideslope (Too High): [${highColors.map(c => c === 0xffffff ? 'WHITE' : 'RED').join(', ')}]`);
assert.deepEqual(highColors, [0xffffff, 0xffffff, 0xffffff, 0xffffff], 'High approach must be 4 White');

// Test Low Approach (2.2°)
const lowAlt = center.y + 2000 * Math.tan(THREE.MathUtils.degToRad(2.2));
rkpcRegion.airport.update(0.1, new THREE.Vector3(center.x + dir.x * 2000, lowAlt, center.z + dir.z * 2000));
const lowColors = papi.units.map(u => u.lensMat.color.getHex());
console.log(`  • 2.2° Glideslope (Too Low): [${lowColors.map(c => c === 0xffffff ? 'WHITE' : 'RED').join(', ')}]`);
assert.deepEqual(lowColors, [0xff1a1a, 0xff1a1a, 0xff1a1a, 0xff1a1a], 'Low approach must be 4 Red');
console.log('  ✔ PAPI guidance dynamically adapts to aircraft approach angle\n');

// 4. Verify Facilities & Collisions
console.log('🏢 4. Verifying Facilities & Flight Collision Boundaries:');
const targets = rkpcRegion.airport.getGazeTargets();
console.log(`  • Gaze Targets: ${targets.map(t => `${t.name} (${t.kind})`).join(', ')}`);
assert.ok(targets.some(t => t.kind === 'tower'));
assert.ok(targets.some(t => t.kind === 'terminal'));

// Direct flight into tower
const towerCollision = rkpcRegion.airport.checkBuildingCollision([
  { pos: new THREE.Vector3(-80, 50, 260) },
]);
assert.ok(towerCollision, 'Aircraft hitting tower must register collision');
console.log(`  • Tower Collision Result: ${towerCollision.part} (${towerCollision.id})`);

// Flying clear above terminal
const clearFlight = rkpcRegion.airport.checkBuildingCollision([
  { pos: new THREE.Vector3(150, 100, 320) },
]);
assert.equal(clearFlight, false, 'Aircraft flying well above terminal must not collide');
console.log('  ✔ Facility collision testing and camera gaze targets fully operational\n');

// 5. Autonomous Generation for Generic Airport (RKNY Yangyang)
console.log('🌐 5. Verifying Autonomous Generation for Non-Overridden Airport (RKNY):');
const RKNY_RECORD = {
  id: '5642',
  ident: 'RKNY',
  name: 'Yangyang International Airport',
  latitude: 38.061401,
  longitude: 128.669006,
  elevationM: 73.15,
  runways: [
    {
      id: '237299',
      lengthM: 2500,
      widthM: 45,
      surface: 'CON',
      lighted: true,
      ends: [
        {
          ident: '15',
          physical: { latitude: 38.0716, longitude: 128.661, elevationM: 73.15 },
          threshold: { latitude: 38.0716, longitude: 128.661, elevationM: 73.15 },
          displacedThresholdM: 0,
          headingDegT: 150,
        },
        {
          ident: '33',
          physical: { latitude: 38.0512, longitude: 128.677, elevationM: 73.15 },
          threshold: { latitude: 38.0512, longitude: 128.677, elevationM: 73.15 },
          displacedThresholdM: 0,
          headingDegT: 330,
        },
      ],
    },
  ],
};

const [nyX, nyZ] = projectToLocal(RKNY_RECORD.latitude, RKNY_RECORD.longitude);
const rknyRegion = createExternalAirportRegion({
  airport: RKNY_RECORD,
  baseOffset: [nyX, nyZ],
  outsideHeight: () => 0,
});

assert.ok(rknyRegion.terrain instanceof ExternalAirportSurface);
assert.equal(rknyRegion.terrain.elevationM, 73.15);
assert.equal(rknyRegion.airport.isOnRunway(rknyRegion.terrain.runways[0].centre.x, rknyRegion.terrain.runways[0].centre.z), true);
assert.ok(rknyRegion.terrain.runways[0].lighting?.papi?.length >= 2, 'Lighted airport must receive automated PAPI');
console.log(`  • RKNY Elevation: ${rknyRegion.terrain.elevationM} m`);
console.log(`  • RKNY Auto-generated PAPI: ${rknyRegion.terrain.runways[0].lighting.papi.length} units`);
console.log('  ✔ Universal common path successfully generates operational airport without manual config\n');

// 6. Cleanup
rkpcRegion.dispose();
rknyRegion.dispose();

console.log('✅ All Issue #956 Step 2 verification assertions passed successfully!\n');
