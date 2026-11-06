import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setPavementUVs, createPavementMaterial, createRunwayRepairs, createRunwaySurfaceWear, createRunwayWearMaterial } from '../src/environment/Pavement.js';
import { applyLogDepthOffset, createRunwayMarkingMaterial } from '../src/environment/RunwayMarkings.js';
import { useProjectionDepth } from '../src/aircraft/CockpitDepth.js';
import { LuklaAirport } from '../src/environment/LuklaAirport.js';

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

test('Lukla apron foundation cannot coincide with the pavement', () => {
  const airport = new LuklaAirport();
  const apron = airport.group.children.find(g => g.children.some(o => o.material?.name === 'pavement-concrete'));
  assert.ok(apron);
  const foundation = apron.children.find(o => o.geometry?.type === 'BoxGeometry');
  assert.ok(foundation.position.y + foundation.geometry.parameters.height / 2 < 0);
});

test('Lukla runway retains dimensions, shadows and depth offset with headless fallback', () => {
  for (const AirportClass of [LuklaAirport]) {
    const airport = new AirportClass();
    const runway = airport.group.getObjectByName('runway-pavement');
    assert.ok(runway);
    assert.equal(runway.receiveShadow, true);
    assert.equal(runway.material.metalness, 0);
    assert.equal(runway.material.polygonOffset, true);
    assert.equal(runway.material.map, null);
    assert.ok(runway.material.polygonOffsetFactor < 0);
    const { width, height } = runway.geometry.parameters;
    assert.deepEqual([width, height].sort((a,b) => a-b),
      [airport.runwayLength, airport.runwayWidth].sort((a,b) => a-b));
  }
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

  // Tier 1: runway repair slab (2.5 cm)
  const repairsGroup = createRunwayRepairs(45, 3000);
  const repairPatch = repairsGroup.children[0];
  assert.match(compileFragment(repairPatch.material), /vFragDepth - 0\.025\)/);

  // Tier 2: runway markings (5 cm)
  const markingMat = createRunwayMarkingMaterial();
  assert.match(compileFragment(markingMat), /gl_FragDepth\s*=\s*log2\(max\(1\.0,\s*vFragDepth\s*-\s*0\.05\)\)/);

  // Negative units push water/river behind coplanar banks (+10 cm away from camera)
  const riverMat = applyLogDepthOffset(new THREE.MeshStandardMaterial(), -4);
  assert.equal(riverMat.polygonOffset, true);
  assert.equal(riverMat.polygonOffsetFactor, 4);
  assert.match(compileFragment(riverMat), /vFragDepth \+ 0\.1\)/);

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
    assert.match(compileFragment(wearMesh.material), /vFragDepth - 0\.05\)/);

    const rubberMat = createRunwayWearMaterial();
    assert.match(compileFragment(rubberMat), /vFragDepth - 0\.075\)/);

    const repairs = createRunwayRepairs(45, 3000);
    const crackMesh = repairs.children.find(c => c.name === 'runway-cracks');
    assert.match(compileFragment(crackMesh.material), /vFragDepth - 0\.1\)/);
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
  assert.match(shader.fragmentShader, /vFragDepth - 0\.05\)/);

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
