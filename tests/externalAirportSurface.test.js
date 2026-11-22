import test from 'node:test';
import assert from 'node:assert/strict';
import { projectToLocal } from '../src/geospatial/incheon.js';
import {
  buildExternalRunwayDescriptors,
  ExternalAirportSurface,
  createExternalAirportMesh,
  createExternalAirportRegion,
  EXTERNAL_MESH_LIFT_M,
  MARKING_LIFT_M,
} from '../src/geospatial/externalAirportSurface.js';

const ARP = { latitude: 37.56, longitude: 126.79 };
const [ARP_X, ARP_Z] = projectToLocal(ARP.latitude, ARP.longitude);

/** Approximate inverse of projectToLocal, sufficient for synthetic geometry. */
function wgs84(x, z, elevationM) {
  const metresPerDegreeLat = 110574;
  const metresPerDegreeLon = 111320 * Math.cos(ARP.latitude * Math.PI / 180);
  return {
    latitude: ARP.latitude - z / metresPerDegreeLat,
    longitude: ARP.longitude + x / metresPerDegreeLon,
    elevationM,
  };
}

function end(ident, physical, threshold = physical, displacedThresholdM = 0, headingDegT = 90) {
  return {
    ident,
    physical: wgs84(physical.x, physical.z, physical.elevationM),
    threshold: wgs84(threshold.x, threshold.z, threshold.elevationM),
    displacedThresholdM,
    headingDegT,
  };
}

function airport() {
  return {
    id: '9999',
    ident: 'TEST',
    icao: 'TEST',
    ...ARP,
    elevationM: 11,
    runways: [
      {
        id: '100',
        lengthM: 3200,
        widthM: 60,
        surface: 'ASP',
        ends: [
          end('14', { x: -1600, z: 0, elevationM: 12 },
            { x: -1300, z: 0, elevationM: 12 }, 300, 140),
          end('32', { x: 1600, z: 0, elevationM: 20 },
            { x: 1600, z: 0, elevationM: 20 }, 0, 320),
        ],
      },
      {
        id: '101',
        lengthM: 2400,
        widthM: 45,
        surface: 'TURF',
        ends: [
          end('09', { x: 400, z: 1800, elevationM: 9 }),
          end('27', { x: 400, z: 4200, elevationM: 15 }),
        ],
      },
    ],
  };
}

function descriptors() {
  return buildExternalRunwayDescriptors(airport());
}

function surface(outsideHeight = () => 5) {
  return new ExternalAirportSurface({ airport: airport(), baseOffset: [ARP_X, ARP_Z], outsideHeight });
}

const near = (actual, expected, tolerance = 0.02) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

function markingQuads(group, id) {
  const mesh = group.children.find(child => child.name === `runway-markings-${id}`);
  assert.ok(mesh, `missing markings for ${id}`);
  const position = mesh.geometry.attributes.position;
  const normal = mesh.geometry.attributes.normal;
  const quads = [];
  for (let i = 0; i < position.count; i += 4) {
    const vertices = [];
    for (let j = 0; j < 4; j++) {
      const k = i + j;
      vertices.push({
        x: position.getX(k), y: position.getY(k), z: position.getZ(k), ny: normal.getY(k),
      });
    }
    quads.push(vertices);
  }
  return { mesh, quads };
}

function frameFor(descriptor) {
  const a = descriptor.ends[0].physical;
  const b = descriptor.ends[1].physical;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  return { a, length, ux: dx / length, uz: dz / length, px: -dz / length, pz: dx / length };
}

function quadCoords(vertices, frame) {
  const points = vertices.map(vertex => {
    const dx = vertex.x - frame.a.x;
    const dz = vertex.z - frame.a.z;
    return { u: dx * frame.px + dz * frame.pz, v: dx * frame.ux + dz * frame.uz, ny: vertex.ny };
  });
  const us = points.map(point => point.u);
  const vs = points.map(point => point.v);
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  return {
    uMin, uMax, vMin, vMax,
    u: (uMin + uMax) / 2,
    v: (vMin + vMax) / 2,
    uSpan: uMax - uMin,
    vSpan: vMax - vMin,
    ny: points[0].ny,
  };
}

test('descriptors convert WGS84 into ARP-relative metres and keep thresholds distinct', () => {
  const source = airport();
  const result = buildExternalRunwayDescriptors(source);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, '100');
  assert.equal(result[0].lengthM, 3200);
  assert.equal(result[0].widthM, 60);
  assert.equal(result[0].surface, 'ASP');

  for (let i = 0; i < result.length; i++) {
    for (let j = 0; j < 2; j++) {
      const actual = result[i].ends[j];
      const original = source.runways[i].ends[j];
      for (const kind of ['physical', 'threshold']) {
        const [x, z] = projectToLocal(original[kind].latitude, original[kind].longitude);
        near(actual[kind].x, x - ARP_X, 1e-6);
        near(actual[kind].z, z - ARP_Z, 1e-6);
        assert.equal(actual[kind].elevationM, original[kind].elevationM);
      }
      assert.equal(actual.ident, original.ident);
      assert.equal(actual.headingDegT, original.headingDegT);
    }
  }
  const displaced = result[0].ends[0];
  assert.equal(displaced.displacedThresholdM, 300);
  assert.notDeepEqual(displaced.physical, displaced.threshold);
  assert.deepEqual(result[0].ends[1].physical, result[0].ends[1].threshold);
  near(result[0].centre.x,
    (result[0].ends[0].physical.x + result[0].ends[1].physical.x) / 2, 1e-9);
  near(result[0].centre.z,
    (result[0].ends[0].physical.z + result[0].ends[1].physical.z) / 2, 1e-9);
});

test('invalid and incomplete records produce no descriptors instead of throwing', () => {
  assert.deepEqual(buildExternalRunwayDescriptors(null), []);
  assert.deepEqual(buildExternalRunwayDescriptors({}), []);
  assert.deepEqual(buildExternalRunwayDescriptors({ runways: [null, {}, { ends: [end('14', { x: 0, z: 0, elevationM: 1 })] }] }), []);
  assert.deepEqual(buildExternalRunwayDescriptors({ runways: [{ id: '1', ends: [
    end('a', { x: 0, z: 0, elevationM: 1 }), end('b', { x: 0, z: 0, elevationM: 1 }),
  ] }] }), []);
});

test('contact height interpolates along the physical ends and blends from 40 to 240 m', () => {
  const terrain = surface();
  const runway = terrain.runways[0];
  const a = runway.ends[0].physical;
  const b = runway.ends[1].physical;
  const centre = runway.centre;

  near(terrain.getHeight(a.x, a.z), 12);
  near(terrain.getHeight(b.x, b.z), 20);
  near(terrain.getHeight(centre.x, centre.z), 16);
  near(terrain.getHeight((a.x + centre.x) / 2, a.z), 14);

  near(terrain.getHeight(centre.x, centre.z + 40), 16, 0.05);
  near(terrain.getHeight(centre.x, centre.z + 140), 10.5, 0.05);
  near(terrain.getHeight(centre.x, centre.z + 240), 5, 0.05);
  near(terrain.getHeight(centre.x, centre.z + 400), 5);
});

test('outsideHeight receives world coordinates and missing samples fall back to runway height', () => {
  const samples = [];
  const terrain = new ExternalAirportSurface({
    airport: airport(),
    baseOffset: [ARP_X, ARP_Z],
    outsideHeight: (x, z) => { samples.push([x, z]); return 5; },
  });
  const centre = terrain.runways[0].centre;
  terrain.getHeight(centre.x, centre.z + 300);
  assert.equal(samples.length, 1);
  near(samples[0][0], centre.x + ARP_X, 1e-6);
  near(samples[0][1], centre.z + 300 + ARP_Z, 1e-6);

  const nonFinite = new ExternalAirportSurface({
    airport: airport(), baseOffset: [ARP_X, ARP_Z], outsideHeight: () => Number.NaN,
  });
  near(nonFinite.getHeight(centre.x, centre.z + 300), 16);
  const absent = new ExternalAirportSurface({ airport: airport(), baseOffset: [ARP_X, ARP_Z] });
  near(absent.getHeight(centre.x, centre.z + 300), 16);
});

test('on-runway and safety-area predicates use the physical segment and width', () => {
  const terrain = surface();
  const runway = terrain.runways[0];
  const { x, z } = runway.centre;
  assert.equal(terrain.isOnRunway(x, z), true);
  assert.equal(terrain.isOnRunway(x, z + 29), true);
  assert.equal(terrain.isOnRunway(x, z + 31), false);
  assert.equal(terrain.isRunwaySafetyArea(x, z + 60), true);
  assert.equal(terrain.isRunwaySafetyArea(x, z + 100), false);
  const beyondEnd = runway.ends[1].physical.x + 20;
  assert.equal(terrain.isOnRunway(beyondEnd, runway.ends[1].physical.z), false);
  assert.equal(terrain.isRunwaySafetyArea(beyondEnd, runway.ends[1].physical.z), false);
  assert.equal(terrain.isOnRunway(terrain.runways[1].centre.x, terrain.runways[1].centre.z), true);
});

test('normals and water level are finite across pavement and blend', () => {
  const terrain = surface();
  const centre = terrain.runways[0].centre;
  for (const [x, z] of [
    [centre.x, centre.z],
    [centre.x, centre.z + 40],
    [centre.x, centre.z + 140],
    [centre.x, centre.z + 400],
    [terrain.runways[1].centre.x, terrain.runways[1].centre.z],
  ]) {
    const normal = terrain.getNormal(x, z);
    assert.equal(Number.isFinite(normal.x), true);
    assert.equal(Number.isFinite(normal.y), true);
    assert.equal(Number.isFinite(normal.z), true);
    assert.ok(Math.abs(normal.length() - 1) < 1e-6);
    assert.ok(normal.y > 0);
  }
  assert.equal(Number.isFinite(terrain.getWaterLevel(centre.x, centre.z)), true);
});

test('mesh ribbons sit 15 mm above contact height and only displaced ends get bars', () => {
  const terrain = surface();
  const group = createExternalAirportMesh(terrain.runways);
  const ribbons = group.children.filter(child =>
    child.isMesh && child.geometry?.attributes?.position?.count === 4);
  assert.equal(ribbons.length, 2);
  for (const ribbon of ribbons) {
    assert.equal(ribbon.material.type, 'MeshStandardMaterial');
    assert.equal(ribbon.material.map, null);
    const position = ribbon.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      near(y, terrain.getHeight(x, z) + EXTERNAL_MESH_LIFT_M, 1e-5);
    }
  }
  const bars = group.children.filter(child => child.name.startsWith('threshold-'));
  assert.equal(bars.length, 1);
  assert.equal(bars[0].name, 'threshold-100-14');
  group.dispose();
  assert.equal(group.children.length, 0);
});

test('markings render from index geometry, including undisplaced runways', () => {
  const terrain = surface();
  const group = createExternalAirportMesh(terrain.runways);
  const markings = group.children.filter(child => child.name.startsWith('runway-markings-'));
  assert.equal(markings.length, 2);
  for (const mesh of markings) {
    assert.equal(mesh.material.type, 'MeshStandardMaterial');
    const position = mesh.geometry.attributes.position;
    assert.ok(position.count > 100, 'centerline, threshold keys and designator cells are present');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      near(y, terrain.getHeight(x, z) + EXTERNAL_MESH_LIFT_M + MARKING_LIFT_M, 1e-5);
      assert.ok(mesh.geometry.attributes.normal.getY(i) > 0, 'markings face up');
    }
  }

  // Wonju's index record: one concrete runway, no displaced thresholds.
  const wonju = {
    ...ARP,
    elevationM: 100.28,
    runways: [{
      id: '237300', lengthM: 2743.2, widthM: 45.7, surface: 'CON',
      ends: [
        end('03', { x: -517.3, z: 1131.0, elevationM: 98.45 }),
        end('21', { x: 593.7, z: -1340.1, elevationM: 100.28 }),
      ],
    }],
  };
  const [descriptor] = buildExternalRunwayDescriptors(wonju);
  const wonjuGroup = createExternalAirportMesh([descriptor]);
  const wonjuMarkings = wonjuGroup.children.filter(child => child.name === 'runway-markings-237300');
  assert.equal(wonjuMarkings.length, 1);
  assert.ok(wonjuMarkings[0].geometry.attributes.position.count > 100);
});

test('markings are oriented, separated and bounded across reciprocal and constrained runways', () => {
  const symmetric = {
    ...ARP,
    elevationM: 11,
    runways: [{
      id: '200', lengthM: 3000, widthM: 45, surface: 'CON',
      ends: [
        end('21', { x: -1500, z: 0, elevationM: 12 }),
        end('21', { x: 1500, z: 0, elevationM: 12 }),
      ],
    }],
  };
  const [descriptor] = buildExternalRunwayDescriptors(symmetric);
  const group = createExternalAirportMesh([descriptor]);
  const frame = frameFor(descriptor);
  const { quads } = markingQuads(group, '200');
  const coords = quads.map(quad => quadCoords(quad, frame));
  assert.ok(coords.every(coord => coord.ny > 0), 'every marking quad faces +Y');

  const endAlong = frame.length;
  const designator = coords.filter(coord => coord.vSpan <= 3 && (
    (coord.v > 70 && coord.v < 100) || (coord.v > endAlong - 100 && coord.v < endAlong - 70)));
  assert.ok(designator.length > 10, 'both ends carry designator cells');
  const cell = coord => ({ u: Math.round(coord.u * 100) / 100, v: Math.round(coord.v * 100) / 100 });
  const approaching = (list, direction) => list
    .map(coord => cell({ u: direction * coord.u,
      v: direction > 0 ? coord.v : endAlong - coord.v }))
    .sort((a, b) => a.v - b.v || a.u - b.u);
  assert.deepEqual(
    approaching(designator.filter(coord => coord.v < endAlong / 2), 1),
    approaching(designator.filter(coord => coord.v > endAlong / 2), -1),
    'reciprocal ends render the same glyph in the approaching pilot frame',
  );

  const centreline = coords.filter(coord => coord.uSpan <= 2 && coord.vSpan >= 25 && Math.abs(coord.u) <= 1);
  assert.ok(centreline.length > 10, 'dashed centerline is present');
  for (const dash of centreline) {
    assert.ok(dash.vMin > 100 && dash.vMax < endAlong - 100, 'centerline clears both designators');
  }

  const variants = [
    { label: 'narrow', widthM: 10, lengthM: 1000, ends: [
      end('03', { x: -500, z: 0, elevationM: 12 }),
      end('21', { x: 500, z: 0, elevationM: 12 }),
    ] },
    { label: 'short', widthM: 45, lengthM: 150, ends: [
      end('03', { x: -75, z: 0, elevationM: 12 }),
      end('21', { x: 75, z: 0, elevationM: 12 }),
    ] },
    { label: 'displaced', widthM: 45, lengthM: 3000, ends: [
      end('03', { x: -1500, z: 0, elevationM: 12 }, { x: -900, z: 0, elevationM: 12 }, 600),
      end('21', { x: 1500, z: 0, elevationM: 12 }, { x: 900, z: 0, elevationM: 12 }, 600),
    ] },
  ];
  for (const variant of variants) {
    const [tiled] = buildExternalRunwayDescriptors({
      ...ARP,
      runways: [{ id: '201', lengthM: variant.lengthM, widthM: variant.widthM,
        surface: 'CON', ends: variant.ends }],
    });
    const variantFrame = frameFor(tiled);
    const { quads: variantQuads } = markingQuads(createExternalAirportMesh([tiled]), '201');
    for (const quad of variantQuads) {
      const coord = quadCoords(quad, variantFrame);
      assert.ok(coord.ny > 0, `${variant.label}: marking faces +Y`);
      assert.ok(coord.vMin >= -0.02 && coord.vMax <= variantFrame.length + 0.02,
        `${variant.label}: along stays on the ribbon`);
      assert.ok(coord.uMin >= -variant.widthM / 2 - 0.02 && coord.uMax <= variant.widthM / 2 + 0.02,
        `${variant.label}: lateral stays on the ribbon`);
    }
  }
  group.dispose();
});

test('region exposes the no-op airport facade, tight extent and a disposing group', () => {
  const region = createExternalAirportRegion({
    airport: airport(), baseOffset: [ARP_X, ARP_Z], outsideHeight: () => 5,
  });
  assert.equal(region.terrain instanceof ExternalAirportSurface, true);
  assert.equal(region.group.isGroup, true);
  assert.deepEqual(region.baseOffset, [ARP_X, ARP_Z]);
  assert.deepEqual(region.extent, region.terrain.extent);

  for (const runway of region.terrain.runways) for (const end of runway.ends) {
    for (const point of [end.physical, end.threshold]) {
      assert.ok(point.x >= region.extent.minX && point.x <= region.extent.maxX);
      assert.ok(point.z >= region.extent.minZ && point.z <= region.extent.maxZ);
    }
  }
  const ends = region.terrain.runways.flatMap(runway => runway.ends);
  const minX = Math.min(...ends.flatMap(end => [end.physical.x, end.threshold.x]));
  near(region.extent.minX, minX - 1500, 1e-9);

  const centre = region.terrain.runways[0].centre;
  assert.equal(region.airport.isOnRunway(centre.x, centre.z), true);
  assert.equal(region.airport.isOnRunway(centre.x, centre.z + 100), false);
  assert.equal(region.airport.isRunwaySafetyArea(centre.x, centre.z + 60), true);
  assert.deepEqual(region.airport.getGazeTargets(), []);
  assert.equal(region.airport.hasModeledBuilding(), false);
  assert.equal(region.airport.checkBuildingCollision(), false);
  assert.equal(region.airport.update(), undefined);
  assert.equal(region.airport.nightLighting.update(), undefined);
  assert.equal(region.airport.updateRenderLights(), undefined);

  let disposed = 0;
  region.group.children[0].geometry.dispose = () => { disposed++; };
  region.dispose();
  assert.ok(disposed > 0);
  assert.equal(region.group.children.length, 0);
});
