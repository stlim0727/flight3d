import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  getAirportOverride,
  AIRPORT_OVERRIDES,
} from '../src/config/airportOverrides.js';
import {
  buildExternalRunwayDescriptors,
  buildExternalTaxiwayDescriptors,
  buildExternalFacilityDescriptors,
  createExternalAirportMesh,
  createExternalTaxiwayMesh,
  createExternalAirportFacilities,
  createExternalAirportLighting,
  createExternalAirportRegion,
  ExternalAirportSurface,
  EXTERNAL_MESH_LIFT_M,
  MARKING_LIFT_M,
} from '../src/geospatial/externalAirportSurface.js';
import { projectToLocal } from '../src/geospatial/incheon.js';

// Real-world RKPC record from public/data/airports/
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

// Generic third-party airport record (RKNY Yangyang) with NO overrides
const RKNY_RECORD = {
  id: '5642',
  ident: 'RKNY',
  icao: 'RKNY',
  iata: 'YNY',
  name: 'Yangyang International Airport',
  type: 'medium_airport',
  latitude: 38.061401,
  longitude: 128.669006,
  elevationM: 73.15,
  country: 'KR',
  region: 'KR-42',
  municipality: 'Yangyang',
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

test('AIRPORT_OVERRIDES defines precision declarative data for RKPC', () => {
  const rkpcOverride = getAirportOverride('RKPC');
  assert.ok(rkpcOverride, 'RKPC override must be defined');
  assert.equal(rkpcOverride.elevationM, 36.0, 'RKPC elevation must be 36.0m');
  assert.ok(rkpcOverride.facilities.length >= 2, 'RKPC must define tower and terminal');
  assert.ok(rkpcOverride.runways.length >= 2, 'RKPC must define runway overrides for 07/25 and 13/31');
  assert.ok(rkpcOverride.taxiways.length >= 1, 'RKPC must define taxiway overrides');

  // Case insensitive lookup
  assert.equal(getAirportOverride('rkpc'), rkpcOverride);
  // Unknown airport returns null
  assert.equal(getAirportOverride('UNKNOWN_ICAO'), null);
});

test('buildExternalRunwayDescriptors applies elevation and lighting overrides for RKPC', () => {
  const override = getAirportOverride('RKPC');
  const descriptors = buildExternalRunwayDescriptors(RKPC_RECORD, override);

  assert.equal(descriptors.length, 2, 'Must build 2 runway descriptors');
  const rwy07 = descriptors[0];
  assert.equal(rwy07.ends[0].ident, '07');
  assert.equal(rwy07.ends[1].ident, '25');

  // All runway ends must be elevated to exact override elevation 36.0m
  assert.equal(rwy07.ends[0].physical.elevationM, 36.0);
  assert.equal(rwy07.ends[1].physical.elevationM, 36.0);
  assert.equal(descriptors[1].ends[0].physical.elevationM, 36.0);
  assert.equal(descriptors[1].ends[1].physical.elevationM, 36.0);

  // Lighting configs attached
  assert.ok(rwy07.lighting, 'Runway 07/25 must have lighting configured');
  assert.ok(rwy07.lighting.papi?.length >= 2, 'Runway 07/25 must have PAPI configured at both ends');
  assert.ok(rwy07.lighting.approachLighting?.length >= 1, 'Runway 07 must have approach lighting');
});

test('buildExternalTaxiwayDescriptors and createExternalTaxiwayMesh generate correct geometries', () => {
  const override = getAirportOverride('RKPC');
  const taxiways = buildExternalTaxiwayDescriptors(override.taxiways, { x: 0, z: 0 }, 36.0);

  assert.equal(taxiways.length, 2);
  assert.equal(taxiways[0].name, 'Parallel Taxiway P');
  assert.equal(taxiways[0].widthM, 23);

  const meshGroup = createExternalTaxiwayMesh(taxiways);
  assert.equal(meshGroup.children.length, 2);
  const mesh0 = meshGroup.children[0];
  assert.ok(mesh0.isMesh);
  assert.ok(mesh0.geometry.attributes.position.count > 0);

  // Mesh elevation sits at elevation + EXTERNAL_MESH_LIFT_M
  const y = mesh0.geometry.attributes.position.getY(0);
  assert.ok(Math.abs(y - (36.0 + EXTERNAL_MESH_LIFT_M)) < 1e-4);

  meshGroup.dispose();
  assert.equal(meshGroup.children.length, 0);
});

test('createExternalAirportFacilities builds towers, terminals, and handles collision detection', () => {
  const override = getAirportOverride('RKPC');
  const facilities = buildExternalFacilityDescriptors(override.facilities, 36.0);
  const result = createExternalAirportFacilities(facilities, 36.0);

  assert.equal(result.group.children.length, 2, 'Must create 2 facility meshes (tower and terminal)');
  assert.equal(result.gazeTargets.length, 2, 'Must expose 2 gaze targets for camera director');
  assert.equal(result.gazeTargets[0].kind, 'tower');
  assert.equal(result.gazeTargets[1].kind, 'terminal');

  // Footprint check
  assert.equal(result.hasModeledBuilding(-80, 260), true, 'Inside tower footprint');
  assert.equal(result.hasModeledBuilding(150, 320), true, 'Inside terminal footprint');
  assert.equal(result.hasModeledBuilding(0, 0), false, 'Outside building footprints');

  // Probe collisions
  // Probe hitting tower below max altitude
  const hitTower = result.checkCollision([
    { pos: new THREE.Vector3(-80, 50, 260) },
  ]);
  assert.ok(hitTower, 'Must detect collision with control tower');
  assert.equal(hitTower.part, 'tower');
  assert.equal(hitTower.id, 'tower');

  // Probe flying above tower
  const missHigh = result.checkCollision([
    { pos: new THREE.Vector3(-80, 150, 260) },
  ]);
  assert.equal(missHigh, false, 'Must not collide above tower height');

  // Probe hitting terminal
  const hitTerminal = result.checkCollision([
    { pos: new THREE.Vector3(150, 45, 320) },
  ]);
  assert.ok(hitTerminal, 'Must detect collision with passenger terminal');
  assert.equal(hitTerminal.part, 'terminal');

  result.dispose();
  assert.equal(result.group.children.length, 0);
});

test('createExternalAirportLighting builds PAPI and updates glideslope indication interactively', () => {
  const override = getAirportOverride('RKPC');
  const descriptors = buildExternalRunwayDescriptors(RKPC_RECORD, override);
  const lighting = createExternalAirportLighting(descriptors, {
    apronLamps: override.lighting.apronLamps,
  });

  assert.ok(lighting.group.isGroup);
  assert.ok(lighting.papiSystems.length >= 3, 'Must have PAPI systems for RKPC runways');

  const rwy07Papi = lighting.papiSystems.find(p => p.units.length === 4);
  assert.ok(rwy07Papi);
  const center = rwy07Papi.center;

  // Approach vector for Runway 07: facing opposite approach
  const dir = rwy07Papi.approachDir;

  // 1. On glideslope (3.0°): aircraft 2000m out along approachDir at tan(3.0°) * 2000m altitude
  const onSlopeAlt = center.y + 2000 * Math.tan(THREE.MathUtils.degToRad(3.0));
  const onSlopePos = new THREE.Vector3(
    center.x + dir.x * 2000,
    onSlopeAlt,
    center.z + dir.z * 2000
  );
  lighting.update(0.5, onSlopePos);

  const colorsOnSlope = rwy07Papi.units.map(u => u.lensMat.color.getHex());
  // Standard 2 White (0xffffff), 2 Red (0xff1a1a)
  assert.equal(colorsOnSlope[0], 0xffffff, 'Unit 0 must be white on slope');
  assert.equal(colorsOnSlope[1], 0xffffff, 'Unit 1 must be white on slope');
  assert.equal(colorsOnSlope[2], 0xff1a1a, 'Unit 2 must be red on slope');
  assert.equal(colorsOnSlope[3], 0xff1a1a, 'Unit 3 must be red on slope');

  // 2. High approach (3.6° > 3.5°): 4 White
  const highAlt = center.y + 2000 * Math.tan(THREE.MathUtils.degToRad(3.6));
  const highPos = new THREE.Vector3(
    center.x + dir.x * 2000,
    highAlt,
    center.z + dir.z * 2000
  );
  lighting.update(0.5, highPos);
  const colorsHigh = rwy07Papi.units.map(u => u.lensMat.color.getHex());
  assert.deepEqual(colorsHigh, [0xffffff, 0xffffff, 0xffffff, 0xffffff], 'High approach must show 4 White');

  // 3. Low approach (2.2° < 2.5°): 4 Red
  const lowAlt = center.y + 2000 * Math.tan(THREE.MathUtils.degToRad(2.2));
  const lowPos = new THREE.Vector3(
    center.x + dir.x * 2000,
    lowAlt,
    center.z + dir.z * 2000
  );
  lighting.update(0.5, lowPos);
  const colorsLow = rwy07Papi.units.map(u => u.lensMat.color.getHex());
  assert.deepEqual(colorsLow, [0xff1a1a, 0xff1a1a, 0xff1a1a, 0xff1a1a], 'Low approach must show 4 Red');

  lighting.dispose();
});

test('createExternalAirportRegion creates fully unified airport for RKPC', () => {
  const [arpX, arpZ] = projectToLocal(RKPC_RECORD.latitude, RKPC_RECORD.longitude);
  const region = createExternalAirportRegion({
    airport: RKPC_RECORD,
    baseOffset: [arpX, arpZ],
    outsideHeight: () => 0,
  });

  assert.ok(region.terrain instanceof ExternalAirportSurface);
  assert.equal(region.terrain.elevationM, 36.0, 'Surface elevation must be overridden to 36.0m');

  // Runway elevation & contact height consistency
  const rwy07 = region.terrain.runways[0];
  const rwyCentre = rwy07.centre;
  const contactHeight = region.terrain.getHeight(rwyCentre.x, rwyCentre.z);
  assert.equal(contactHeight, 36.0, 'Runway contact height must exactly equal 36.0m');
  assert.equal(region.airport.isOnRunway(rwyCentre.x, rwyCentre.z), true);

  // Taxiway contact & safety area
  const twyPos = { x: -1400, z: 480 };
  assert.equal(region.airport.isOnTaxiway(twyPos.x, twyPos.z), true);
  assert.equal(region.airport.isRunwaySafetyArea(twyPos.x, twyPos.z), true);

  // Facilities & Gaze targets
  const targets = region.airport.getGazeTargets();
  assert.ok(targets.some(t => t.kind === 'tower'));
  assert.ok(targets.some(t => t.kind === 'terminal'));

  // Collisions
  const colHit = region.airport.checkBuildingCollision([{ pos: new THREE.Vector3(-80, 50, 260) }]);
  assert.ok(colHit);
  assert.equal(colHit.part, 'tower');

  region.dispose();
  assert.equal(region.group.children.length, 0);
});

test('createExternalAirportRegion creates autonomous valid airport for un-overridden airport (RKNY)', () => {
  const [arpX, arpZ] = projectToLocal(RKNY_RECORD.latitude, RKNY_RECORD.longitude);
  const region = createExternalAirportRegion({
    airport: RKNY_RECORD,
    baseOffset: [arpX, arpZ],
    outsideHeight: () => 0,
  });

  assert.ok(region.terrain instanceof ExternalAirportSurface);
  assert.equal(region.terrain.elevationM, 73.15, 'Must use OurAirports elevation 73.15m');

  const rwy15 = region.terrain.runways[0];
  const rwyCentre = rwy15.centre;
  assert.equal(region.airport.isOnRunway(rwyCentre.x, rwyCentre.z), true);
  assert.ok(Math.abs(region.terrain.getHeight(rwyCentre.x, rwyCentre.z) - 73.15) < 0.1);

  // Automatically generates default PAPI because lighted: true
  assert.ok(rwy15.lighting?.papi?.length >= 2, 'Lighted runway must get auto-generated PAPI');

  // Has no modeled buildings since no override
  assert.equal(region.airport.hasModeledBuilding(0, 0), false);
  assert.equal(region.airport.checkBuildingCollision([{ pos: new THREE.Vector3(0, 0, 0) }]), false);
  assert.deepEqual(region.airport.getGazeTargets(), []);

  region.dispose();
  assert.equal(region.group.children.length, 0);
});

test('PAPI lateral offset is inverted on reciprocal runway end to remain on pilot left', () => {
  const override = getAirportOverride('RKPC');
  const descriptors = buildExternalRunwayDescriptors(RKPC_RECORD, override);
  const lighting = createExternalAirportLighting(descriptors);

  const papi07 = lighting.papiSystems.find(p => p.endIdent === '07');
  const papi25 = lighting.papiSystems.find(p => p.endIdent === '25');
  assert.ok(papi07 && papi25);

  // Approach vector for 07 and 25
  const dir07 = papi07.approachDir;
  const dir25 = papi25.approachDir;

  // Pilot's left vector facing in approach direction
  // For 07 (dir ~ [0.4, 0, 0.9]): left is [-0.9, 0, 0.4]
  // For 25 (dir ~ [-0.4, 0, -0.9]): left is [0.9, 0, -0.4]
  const left07 = new THREE.Vector3(-dir07.z, 0, dir07.x);
  const left25 = new THREE.Vector3(-dir25.z, 0, dir25.x);

  // Vector from runway center to PAPI
  const rwy07Centre = descriptors[0].centre;
  const toPapi07 = papi07.center.clone().sub(new THREE.Vector3(rwy07Centre.x, 0, rwy07Centre.z));
  const toPapi25 = papi25.center.clone().sub(new THREE.Vector3(rwy07Centre.x, 0, rwy07Centre.z));

  // Dot product of (toPapi) with (left) must be positive on BOTH ends
  assert.ok(toPapi07.dot(left07) > 0, 'PAPI 07 must be positioned on pilot left');
  assert.ok(toPapi25.dot(left25) > 0, 'PAPI 25 must be positioned on pilot left');

  lighting.dispose();
});

test('unlighted runway creates no edge lights, threshold lights, or PAPI', () => {
  const unlightedRecord = {
    ...RKNY_RECORD,
    runways: [
      {
        ...RKNY_RECORD.runways[0],
        lighted: false,
      },
    ],
  };
  const descriptors = buildExternalRunwayDescriptors(unlightedRecord);
  assert.equal(descriptors[0].lighted, false);
  assert.equal(descriptors[0].lighting, null);

  const lighting = createExternalAirportLighting(descriptors);
  assert.equal(lighting.group.children.length, 0, 'Unlighted runway must generate no light meshes');
  assert.equal(lighting.papiSystems.length, 0, 'Unlighted runway must generate no PAPI');

  lighting.dispose();
});

test('PAPI nested lens geometries and materials are recursively disposed', () => {
  const override = getAirportOverride('RKPC');
  const descriptors = buildExternalRunwayDescriptors(RKPC_RECORD, override);
  const lighting = createExternalAirportLighting(descriptors);

  const papi07 = lighting.papiSystems[0];
  const unit = papi07.units[0];
  const lensMesh = unit.box.children.find(c => c.isMesh);
  assert.ok(lensMesh, 'Box must have child lens mesh');

  let lensGeoDisposed = false;
  let lensMatDisposed = false;
  lensMesh.geometry.dispose = () => { lensGeoDisposed = true; };
  lensMesh.material.dispose = () => { lensMatDisposed = true; };

  lighting.dispose();
  assert.equal(lensGeoDisposed, true, 'Lens geometry must be disposed recursively');
  assert.equal(lensMatDisposed, true, 'Lens material must be disposed recursively');
});

test('displaced threshold separates green threshold lights and red runway end lights', () => {
  const override = getAirportOverride('RKPC');
  const descriptors = buildExternalRunwayDescriptors(RKPC_RECORD, override);
  const rwy1331 = descriptors.find(d => d.ends.some(e => e.ident === '31'));
  assert.ok(rwy1331);

  const lighting = createExternalAirportLighting([rwy1331]);
  const haloMesh = lighting.group.children.find(c => c.name === 'airport-light-halos');
  assert.ok(haloMesh);

  const posAttr = haloMesh.geometry.attributes.position;
  const dirAttr = haloMesh.geometry.attributes.endDirection;

  let greenMode1Count = 0;
  let redMode2Count = 0;
  const greenThresholdZ = [];
  const redPhysicalZ = [];

  for (let i = 0; i < posAttr.count; i++) {
    const mode = dirAttr.getY(i);
    if (Math.abs(mode - 1) < 0.1) {
      greenMode1Count++;
      greenThresholdZ.push(posAttr.getZ(i));
    } else if (Math.abs(mode - 2) < 0.1) {
      redMode2Count++;
      redPhysicalZ.push(posAttr.getZ(i));
    }
  }

  assert.ok(greenMode1Count > 0, 'Must have mode 1 green threshold lights');
  assert.ok(redMode2Count > 0, 'Must have mode 2 red runway end lights');

  // The Z coordinates of green threshold and red end lights must differ significantly (displaced by ~411m)
  const avgGreenZ = greenThresholdZ.reduce((a, b) => a + b, 0) / greenThresholdZ.length;
  const avgRedZ = redPhysicalZ.reduce((a, b) => a + b, 0) / redPhysicalZ.length;
  assert.ok(Math.abs(avgGreenZ - avgRedZ) > 200, 'Green threshold and red end lights must be separated by displacement');

  lighting.dispose();
});
