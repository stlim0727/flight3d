import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  EIFFEL_TOWER_HEIGHT_M, PARIS_SHOWCASE, PARIS_SHOWCASE_ORIGIN,
  isParisShowcaseOrigin, parisShowcaseInsets,
} from '../src/config/parisShowcase.js';
import {
  EIFFEL_LOD_LEVELS, ParisShowcase, createEiffelTower,
  eiffelCollisionSolids, updateParisShowcase, validateEiffelKit,
} from '../src/environment/ParisShowcase.js';
import { wgs84ToLocal } from '../src/geospatial/TileCoordinateSystem.js';
import { GeographicBuildings } from '../src/environment/GeographicBuildings.js';

const fakeKit = () => {
  const kit = new THREE.Group();
  for (const { name } of EIFFEL_LOD_LEVELS) {
    const node = new THREE.Group();
    node.name = name;
    node.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    kit.add(node);
  }
  return kit;
};
const flatTerrain = () => ({ getHeight: () => 35 });

test('showcase anchors describe the Seine verification zone', () => {
  assert.equal(EIFFEL_TOWER_HEIGHT_M, 330);
  assert.ok(Math.abs(PARIS_SHOWCASE.tower.position[0]) < 1e-6 && Math.abs(PARIS_SHOWCASE.tower.position[1]) < 1e-6);
  assert.ok(PARIS_SHOWCASE.bridge.position[1] < -100, 'bridge spans the river north of the tower');
  assert.ok(PARIS_SHOWCASE.champDeMars.position[0] > 0 && PARIS_SHOWCASE.champDeMars.position[1] > 0);
  assert.equal(PARIS_SHOWCASE.route.length, 4);
  for (const waypoint of PARIS_SHOWCASE.route) {
    assert.ok(Number.isFinite(waypoint.latitude) && Number.isFinite(waypoint.longitude));
    assert.ok(waypoint.altitudeM > 0 && waypoint.altitudeM < 200);
  }
});

test('origin detector stays local and rejects unrelated or invalid coordinates', () => {
  assert.equal(isParisShowcaseOrigin(PARIS_SHOWCASE_ORIGIN), true);
  assert.equal(isParisShowcaseOrigin({ latitude: 48.95, longitude: 2.35 }), true);
  assert.equal(isParisShowcaseOrigin({ latitude: 37.5, longitude: 127 }), false);
  assert.equal(isParisShowcaseOrigin(null), false);
  assert.equal(isParisShowcaseOrigin({ latitude: NaN, longitude: 2 }), false);
  assert.equal(isParisShowcaseOrigin({ latitude: 49.5, longitude: 2.5 }, 50000), false);
});

test('Paris inset covers tower and bridge in the active origin frame', () => {
  assert.deepEqual(parisShowcaseInsets({ latitude: 37.5, longitude: 127 }), []);
  const origin = { latitude: 48.86, longitude: 2.3 };
  const [inset] = parisShowcaseInsets(origin);
  assert.equal(inset.minDetailLevel, 13);
  assert.equal(inset.maxDetailLevel, 14);
  assert.equal(inset.approachDistanceM, 9000);
  const [minX, minZ, maxX, maxZ] = inset.bounds;
  for (const place of [PARIS_SHOWCASE.tower, PARIS_SHOWCASE.bridge]) {
    const [x, z] = wgs84ToLocal(place.latitude, place.longitude, origin);
    assert.ok(x >= minX && x <= maxX && z >= minZ && z <= maxZ);
  }
});

test('Eiffel kit validation and near-to-far LOD ordering', () => {
  assert.throws(() => validateEiffelKit(new THREE.Group()), /missing EiffelNear/);
  const kit = fakeKit();
  assert.doesNotThrow(() => validateEiffelKit(kit));
  const lod = createEiffelTower(kit);
  assert.deepEqual(lod.levels.map(level => level.distance), [0, 800, 2200]);
  assert.ok(lod.levels.every(level => level.hysteresis === .1));
  assert.deepEqual(lod.levels.map(level => level.object.name), EIFFEL_LOD_LEVELS.map(level => level.name));
});

test('collision envelopes leave the arch open but cover legs, decks and antenna', () => {
  const solids = eiffelCollisionSolids({ x: 10, y: 35, z: -20 });
  const boxes = solids.map(({ center, size }) => new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(...center), new THREE.Vector3(...size)));
  const hits = point => boxes.some(box => box.distanceToPoint(point) <= 3);
  assert.equal(hits(new THREE.Vector3(10, 45, -20)), false, 'no phantom solid under the arch');
  assert.equal(hits(new THREE.Vector3(10, 100, -20)), true, 'first deck is solid');
  assert.equal(hits(new THREE.Vector3(10 + 30, 35 + 57, -20)), true, 'first deck slab spans 74 m');
  assert.equal(hits(new THREE.Vector3(10 + 38.5, 35 + 28.5, -20 + 38.5)), true, 'sloped leg includes both endpoints');
  assert.equal(hits(new THREE.Vector3(10 + 37, 35 + 60, -20)), true, 'first deck railing is solid');
});
test('showcase placement uses one ground height for visuals, exclusion and collision', () => {
  const showcase = new ParisShowcase(fakeKit(), PARIS_SHOWCASE_ORIGIN);
  assert.equal(showcase.ready, false);
  assert.equal(showcase.place(flatTerrain()), true);
  assert.equal(showcase.tower.position.y, 35);
  assert.equal(showcase.excludes(...PARIS_SHOWCASE.tower.position), true);
  assert.equal(showcase.excludes(300, 300), false);
  const probe = pos => [{ pos: new THREE.Vector3(...pos), radius: 1 }];
  assert.equal(showcase.checkCollision(probe([0, 45, 0])), null);
  assert.match(showcase.checkCollision(probe([-62, 40, -62])).part, /leg/);
  assert.match(showcase.checkCollision(probe(showcase.bridge.position.toArray())).part, /Pont/);
  const loading = new ParisShowcase(fakeKit(), PARIS_SHOWCASE_ORIGIN);
  assert.equal(loading.place({ getHeight: () => 35, openWorld: { sample: () => undefined } }, true), false);
  assert.equal(loading.tower.visible, false);
  loading.dispose();
  const missing = new ParisShowcase(fakeKit(), PARIS_SHOWCASE_ORIGIN);
  assert.equal(missing.place({ getHeight: () => undefined }), false);
  missing.dispose();
  showcase.dispose();
});


test('failed GLB load backs off instead of retrying every frame', async () => {
  const originalFetch = globalThis.fetch;
  const originalRequest = globalThis.Request;
  const originalProgressEvent = globalThis.ProgressEvent;
  globalThis.Request = class extends originalRequest {
    constructor(input, init) {
      super(typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input, init);
    }
  };
  globalThis.ProgressEvent = class extends Event {
    constructor(type, init = {}) { super(type); Object.assign(this, init); }
  };
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('offline'); };
  const sim = {
    world: { customOrigin: PARIS_SHOWCASE_ORIGIN },
    currentTerrain: { mesh: new THREE.Group(), getHeight: () => 35 },
    camera: new THREE.PerspectiveCamera(),
  };
  try {
    for (let frame = 0; frame < 10; frame++) {
      updateParisShowcase(sim);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(requests, 1, 'one failed request, not one per frame');
    assert.ok(sim.parisShowcaseRetryAt > performance.now(), 'retry deadline is set');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Request = originalRequest;
    globalThis.ProgressEvent = originalProgressEvent;
  }
});

test('leaving Paris while the GLB loads invalidates the previous creation callback', async () => {
  const originalFetch = globalThis.fetch;
  const originalRequest = globalThis.Request;
  globalThis.Request = class extends originalRequest {
    constructor(input, init) {
      super(typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input, init);
    }
  };
  const originalProgressEvent = globalThis.ProgressEvent;
  globalThis.ProgressEvent = class extends Event {
    constructor(type, init = {}) { super(type); Object.assign(this, init); }
  };
  const glb = readFileSync(new URL('../public/models/landmarks/eiffel-tower.glb', import.meta.url));
  globalThis.fetch = async () => new Response(glb, { status: 200, headers: { 'content-type': 'model/gltf-binary' } });
  const mesh = new THREE.Group();
  const sim = {
    world: { customOrigin: PARIS_SHOWCASE_ORIGIN },
    currentTerrain: { mesh, getHeight: () => 35 },
    camera: new THREE.PerspectiveCamera(),
  };
  try {
    updateParisShowcase(sim);
    const first = sim.parisShowcasePending;
    assert.ok(first, 'first load started');
    sim.world.customOrigin = { latitude: 37.5, longitude: 127 };
    updateParisShowcase(sim);
    sim.world.customOrigin = PARIS_SHOWCASE_ORIGIN;
    updateParisShowcase(sim);
    await Promise.all([first, sim.parisShowcasePending]);
    assert.equal(mesh.children.length, 1, 'stale callback must not add a second showcase');
    sim.parisShowcase?.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Request = originalRequest;
    globalThis.ProgressEvent = originalProgressEvent;
  }
});

test('building exclusion receives the footprint corners', () => {
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: () => [0, 0],
    terrain: {},
    archive: { getZxy: async () => null },
    exclude: (x, z, corners) => Math.hypot(x, z) <= 75
      || (corners?.some(point => Math.hypot(point.x, point.y) <= 75) ?? false),
  });
  assert.equal(layer.exclude(80, 62, [{ x: 60, y: 42 }, { x: 100, y: 82 }]), true);
  layer.dispose();
});

test('shipped GLB contains all three named LOD meshes', () => {
  const glb = readFileSync(new URL('../public/models/landmarks/eiffel-tower.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLength = glb.readUInt32LE(12);
  assert.equal(glb.toString('ascii', 16, 20), 'JSON');
  const document = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
  const names = document.nodes.map(node => node.name);
  for (const { name } of EIFFEL_LOD_LEVELS) assert.ok(names.includes(name), `${name} missing from GLB`);
  assert.ok(document.meshes.length >= 9, 'three materials per LOD');
});
