import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setPavementUVs, createPavementMaterial, createRunwayRepairs, createRunwaySurfaceWear, createRunwayWearMaterial } from '../src/environment/Pavement.js';
import { applyLogDepthOffset, createRunwayMarkingMaterial } from '../src/environment/RunwayMarkings.js';
import { useProjectionDepth } from '../src/aircraft/CockpitDepth.js';
import { getAirportOverride } from '../src/config/airportOverrides.js';
import { buildExternalRunwayDescriptors, createExternalAirportRegion, EXTERNAL_MESH_LIFT_M, MARKING_LIFT_M } from '../src/geospatial/externalAirportSurface.js';

function createVnlkRegion() {
  const overrides = getAirportOverride('VNLK');
  const runwayOverride = overrides.runways[0];
  const firstEnd = runwayOverride.ends[0].physical;
  const airport = {
    ident: 'VNLK',
    latitude: firstEnd.latitude,
    longitude: firstEnd.longitude,
    elevationM: overrides.elevationM,
    runways: [{
      id: '06/24',
      surface: 'ASP',
      widthM: runwayOverride.widthM,
      lengthM: runwayOverride.lengthM,
      ends: runwayOverride.ends,
    }],
  };
  const descriptors = buildExternalRunwayDescriptors(airport, overrides);
  return { overrides, descriptor: descriptors[0], region: createExternalAirportRegion({ airport, overrides }) };
}

function ribbonSpan(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const point = index => new THREE.Vector3().fromBufferAttribute(position, index);
  const start = point(0).add(point(1)).multiplyScalar(0.5);
  const end = point(2).add(point(3)).multiplyScalar(0.5);
  return {
    width: point(0).distanceTo(point(1)),
    length: Math.hypot(end.x - start.x, end.z - start.z),
  };
}

test('pavement retains a three metre tile across different slabs and subdivisions', () => {
  for (const [width, length, segments] of [[3200, 60, 1], [30, 527, 32], [36, 80, 1]]) {
    const geo = new THREE.PlaneGeometry(width, length, segments, segments);
    geo.rotateX(-Math.PI / 2);
    setPavementUVs(geo);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 1; i < pos.count; i++) {
      assert.ok(Math.abs((uv.getX(i) - uv.getX(0)) * 3 - (pos.getX(i) - pos.getX(0))) < 0.001);
      assert.ok(Math.abs((uv.getY(i) - uv.getY(0)) * 3 + (pos.getZ(i) - pos.getZ(0))) < 0.001);
    }
  }
});

test('repair and crack overlays stay inside both runways and share crack artwork', () => {
  const context = new Proxy({}, { get: () => () => {} });
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const materials = new Set();
    for (const [width, length] of [[60, 3200], [30, 527]]) {
      const group = createRunwayRepairs(width, length);
      assert.equal(group.children.length, 4);
      group.updateMatrixWorld(true);
      for (const mesh of group.children) {
        const bounds = new THREE.Box3().setFromObject(mesh);
        assert.ok(bounds.min.x > -width / 2 && bounds.max.x < width / 2);
        assert.ok(bounds.min.z > -length / 2 && bounds.max.z < length / 2);
        assert.ok(bounds.min.y > 0 && bounds.max.y < 0.02);
        assert.ok(mesh.material.polygonOffsetFactor < 0);
        if (mesh.name === 'runway-cracks') {
          materials.add(mesh.material);
          assert.equal(mesh.material.depthWrite, false);
          assert.equal(mesh.material.map.image.width, 512);
          assert.equal(mesh.material.map.colorSpace, THREE.SRGBColorSpace);
        }
      }
    }
    assert.equal(materials.size, 1);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('VNLK apron skirt cannot coincide with the pavement', () => {
  const { region } = createVnlkRegion();
  let apron = null;
  region.group.traverse(child => { if (child.name === 'vnlk-apron') apron = child; });
  assert.ok(apron, 'declarative VNLK apron model must exist');
  const pavement = [];
  apron.traverse(child => { if (child.material?.name === 'pavement-concrete') pavement.push(child); });
  assert.equal(pavement.length, 1);
  const { width, height } = pavement[0].geometry.parameters;
  assert.deepEqual([width, height], [36, 80]);
  let skirt = null;
  apron.traverse(child => {
    if (child.geometry?.type === 'BoxGeometry' && child.material?.color?.getHex() === 0x3a4048) skirt = child;
  });
  assert.ok(skirt, 'apron foundation must remain a distinct stone box');
  assert.deepEqual([skirt.geometry.parameters.width, skirt.geometry.parameters.height, skirt.geometry.parameters.depth], [36, 16, 80]);
  assert.ok(skirt.position.y + skirt.geometry.parameters.height / 2 < 0,
    'the skirt top must stay below the textured apron');
  region.dispose();
});

test('VNLK runway retains dimensions, shadows, lift and depth offset with headless fallback', () => {
  const { descriptor, region } = createVnlkRegion();
  const runway = region.group.children.find(child => child.userData?.runwayId && !child.userData?.kind);
  const markings = region.group.children.find(child => child.userData?.kind === 'markings');
  assert.ok(runway);
  assert.ok(markings);
  assert.strictEqual(runway.receiveShadow, true);
  assert.strictEqual(runway.material.metalness, 0);
  assert.strictEqual(runway.material.polygonOffset, true);
  assert.strictEqual(runway.material.map, null);
  assert.ok(runway.material.polygonOffsetFactor < 0);
  assert.equal(runway.material.userData.logDepthOffsetUnits, 1);
  assert.equal(runway.material.color.getHex(), 0x4b4b4b);
  assert.strictEqual(markings.receiveShadow, true);
  assert.equal(markings.material.polygonOffsetFactor, -2);
  assert.equal(markings.material.userData.logDepthOffsetUnits, 2);
  assert.equal(markings.material.color.getHex(), 0xf0f0e8);
  const { width, length } = ribbonSpan(runway);
  assert.ok(Math.abs(width - descriptor.widthM) < 0.01);
  assert.ok(Math.abs(length - descriptor.lengthM) < 0.1);
  assert.deepEqual([descriptor.widthM, descriptor.lengthM], [30, 527]);
  const position = runway.geometry.getAttribute('position');
  assert.ok(Math.abs(position.getY(0) - (descriptor.ends[0].physical.elevationM + EXTERNAL_MESH_LIFT_M)) < 1e-3);
  const markingPosition = markings.geometry.getAttribute('position');
  assert.ok(Math.abs(markingPosition.getY(0) - (position.getY(0) + MARKING_LIFT_M)) < 1e-3);
  region.dispose();
});

test('coastal pavement coverage follows the actual eight slabs without changing contact heights', async () => {
  const { Airport } = await import('../src/environment/Airport.js');
  const { Terrain } = await import('../src/environment/Terrain.js');
  const terrain = new Terrain(22000, 16);
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }) };
  let airport;
  try {
    class HeadlessAirport extends Airport { async loadBuildings() { return false; } }
    airport = new HeadlessAirport();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
  const geometry = terrain.geometry.attributes.position.array.slice();
  const heights = [[-1400, 0], [0, 160], [0, 270], [1700, 350]].map(([x, z]) => terrain.getHeight(x, z));
  terrain.excludePavement(airport.group);
  assert.equal(terrain.pavementBounds.length, 8);
  const covered = (x, z) => terrain.pavementBounds.some(b => x > b.x && z > b.y && x < b.z && z < b.w);
  for (const [x, z] of [[-1400, 0], [0, 160], [0, 270], [-1200, 80], [600, 80]]) assert.ok(covered(x, z));
  for (const [x, z] of [[1601, 0], [0, -31], [100, 80], [701, 270], [0, 361]]) assert.equal(covered(x, z), false);
  assert.deepEqual(terrain.geometry.attributes.position.array, geometry);
  assert.deepEqual([[-1400, 0], [0, 160], [0, 270], [1700, 350]].map(([x, z]) => terrain.getHeight(x, z)), heights);
});

test('coplanar surface materials bias logarithmic fragment depth in ordered tiers and strip cleanly under projection depth', async () => {
  const compileFragment = (material) => {
    const shader = { fragmentShader: 'void main() {\n#include <logdepthbuf_fragment>\n}' };
    material.onBeforeCompile(shader, {});
    return shader.fragmentShader;
  };

  // Tier 1: runway repair slab (2.5 cm + 500 ppm relative)
  const repairsGroup = createRunwayRepairs(45, 3000);
  const repairPatch = repairsGroup.children[0];
  assert.match(compileFragment(repairPatch.material), /vFragDepth \* 0\.9995 - 0\.025\)/);

  // Tier 2: runway markings (5 cm + 1000 ppm relative)
  const markingMat = createRunwayMarkingMaterial();
  assert.match(compileFragment(markingMat), /gl_FragDepth\s*=\s*log2\(max\(1\.0,\s*vFragDepth\s*\*\s*0\.999\s*-\s*0\.05\)\)/);

  // Negative units push water/river behind coplanar banks (+10 cm + 2000 ppm away from camera)
  const riverMat = applyLogDepthOffset(new THREE.MeshStandardMaterial(), -4);
  assert.equal(riverMat.polygonOffset, true);
  assert.equal(riverMat.polygonOffsetFactor, 4);
  assert.match(compileFragment(riverMat), /vFragDepth \* 1\.002 \+ 0\.1\)/);

  // Projection depth strips both logdepthbuf_fragment and the injected bias block
  const projMat = applyLogDepthOffset(new THREE.MeshStandardMaterial(), 2);
  useProjectionDepth(projMat);
  const stripped = compileFragment(projMat);
  assert.ok(!stripped.includes('logdepthbuf_fragment'));
  assert.ok(!stripped.includes('gl_FragDepth'));

  // Verify surface wear (Tier 2), rubber skid marks (Tier 3), and cracks (Tier 4)
  const context = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  globalThis.window = globalThis;
  try {
    const wearMesh = createRunwaySurfaceWear(45, 3000);
    assert.match(compileFragment(wearMesh.material), /vFragDepth \* 0\.999 - 0\.05\)/);

    const rubberMat = createRunwayWearMaterial();
    assert.match(compileFragment(rubberMat), /vFragDepth \* 0\.9985 - 0\.075\)/);

    const repairs = createRunwayRepairs(45, 3000);
    const crackMesh = repairs.children.find(c => c.name === 'runway-cracks');
    assert.match(compileFragment(crackMesh.material), /vFragDepth \* 0\.998 - 0\.1\)/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('FoliageAndCities rebuilds draped road geometries when terrain quality switches segments', async () => {
  const { Terrain } = await import('../src/environment/Terrain.js');
  const { FoliageAndCities } = await import('../src/environment/FoliageAndCities.js');
  const terrain = new Terrain(22000, 64, { quality: 'ultraLow' });
  const scenery = new FoliageAndCities(terrain);

  const initialDistrictGeo = scenery.districtRoadsMesh.geometry;
  const initialNorthGeo = scenery.northRoadsMesh.geometry;
  assert.equal(scenery.roadTerrainSegments, 64);

  const shader = { fragmentShader: 'void main() {\n#include <logdepthbuf_fragment>\n}' };
  scenery.districtRoadsMesh.material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /vFragDepth \* 0\.999 - 0\.05\)/);

  // Switch terrain to high quality (256 segments) and notify scenery
  terrain.setQuality('high');
  scenery.setQuality('high');
  assert.equal(scenery.roadTerrainSegments, 256);
  assert.notEqual(scenery.districtRoadsMesh.geometry, initialDistrictGeo);
  assert.notEqual(scenery.northRoadsMesh.geometry, initialNorthGeo);
});

test('codebase-wide guard: every polygonOffset material in src/ uses logarithmic depth separation', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Cockpit.js is locked by a precomputed radiosity bake checksum and draws live displays on DISPLAY_LAYER = 2 at ~0.6m.
  const allowlist = new Set(['src/aircraft/Cockpit.js']);
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(e => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : (full.endsWith('.js') ? [full] : []);
    });
  };

  for (const file of walk('src')) {
    const rel = file.replace(/\\/g, '/');
    if (allowlist.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/polygonOffset\s*:\s*(true|layer\s*!==)/.test(source)) {
      assert.ok(
        source.includes('applyLogDepthOffset') || source.includes('createRunwayMarkingMaterial'),
        `${rel} sets polygonOffset without applyLogDepthOffset or createRunwayMarkingMaterial (hardware polygonOffset is ignored under logarithmicDepthBuffer)`
      );
    }
  }
});

test('multi-kilometer ground and water planes subdivide geometry to prevent near-plane 1/w interpolation corruption', async () => {
  const { WaterOcean } = await import('../src/environment/WaterOcean.js');
  const { createNeonRiver } = await import('../src/environment/NeonRiver.js');
  const { Airport } = await import('../src/environment/Airport.js');

  const ultraOcean = new WaterOcean(36000, 1, { quality: 'ultraLow' });
  assert.ok(ultraOcean.segments >= 64, 'ultraLow ocean must use at least 64x64 grid so triangles do not span 36km across near=0.08m');

  // The Neon Metropolis canal and the city ground beside it span 24 km (#551).
  const river = createNeonRiver();
  for (const mesh of [river.water, ...river.ground.children]) {
    // Every triangle edge is shorter than 200 m.
    const { index, attributes: { position } } = mesh.geometry;
    const at = n => [position.getX(index.getX(n)), position.getZ(index.getX(n))];
    for (let n = 0; n < index.count; n += 3) {
      const [a, b, c] = [at(n), at(n + 1), at(n + 2)], length = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      assert.ok(Math.max(length(a, b), length(b, c), length(c, a)) < 200, `${mesh.name || 'neon ground'} must be subdivided`);
    }
  }

  const context = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  globalThis.window = globalThis;
  try {
    class HeadlessAirport extends Airport { async loadBuildings() { return false; } }
    const airport = new HeadlessAirport();
    const runway = airport.group.getObjectByName('runway-pavement');
    assert.ok(runway.geometry.parameters.widthSegments >= 32, '3.2km runway slab must be subdivided along its length');
    const wear = createRunwaySurfaceWear(60, 3200);
    assert.ok(wear.geometry.parameters.heightSegments >= 32, '3.2km runway surface wear must be subdivided along its length');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
