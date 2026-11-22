import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { generateValley } from '../src/arena/generatedValley.js';
import { IncheonTerrain } from '../src/geospatial/IncheonTerrain.js';
import { ExplosionSystem } from '../src/effects/ExplosionSystem.js';
import { TireSmokeSystem } from '../src/effects/TireSmokeSystem.js';
import { generateEffectAtlasData } from '../src/effects/effectFlipbookData.js';
import { CockpitPhotoOverlay } from '../src/aircraft/CockpitPhotoOverlay.js';
import { SkyAtmosphere, createFallbackEnvironmentTexture } from '../src/environment/SkyAtmosphere.js';
import {
  distanceToRegionBoundsM,
  installPresetSpawner,
  REGION_STREAM_DISTANCE_M,
} from '../src/core/PresetSpawner.js';
import { REGION_EXTENTS, UnifiedWorld } from '../src/world/UnifiedWorld.js';

function bruteForceValleyProject(samples, x, z) {
  let best = null;
  for (let i = 0; i < samples.length; i++) {
    const from = samples[i];
    const to = samples[Math.min(samples.length - 1, i + 1)];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lenSq = dx * dx + dz * dz || 1;
    const share = Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / lenSq));
    const px = from.x + dx * share;
    const pz = from.z + dz * share;
    const distanceSquared = (x - px) ** 2 + (z - pz) ** 2;
    if (!best || distanceSquared < best.distanceSquared) {
      const along = { x: Math.sin(to.heading), z: -Math.cos(to.heading) };
      best = {
        distanceSquared,
        s: from.s + (to.s - from.s) * share,
        crossM: (x - px) * along.z * -1 + (z - pz) * along.x,
        legIndex: from.legIndex,
      };
    }
  }
  return best;
}

function naivePointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[i][0], az = ring[i][1];
    const bx = ring[j][0], bz = ring[j][1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

function naiveIsLand(coastline, x, z) {
  const { type, coordinates } = coastline.land;
  const polys = type === 'Polygon' ? [coordinates] : coordinates;
  for (const rings of polys) {
    if (!naivePointInRing(rings[0], x, z)) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) {
      if (naivePointInRing(rings[h], x, z)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

test('generatedValley.project chunked fallback matches full-scan reference bit-for-bit on outer terrain', () => {
  const { terrain } = generateValley({ seed: 1 });
  const samples = terrain.centerline;
  const b = terrain.bounds;
  const probes = [];
  for (let x = b.minX - 7000; x <= b.maxX + 7000; x += 800) {
    for (let z = b.minZ - 10000; z <= b.maxZ + 6000; z += 800) {
      if (x >= b.minX - 2000 && x <= b.maxX + 2000 && z >= b.minZ - 2000 && z <= b.maxZ + 2000) continue;
      probes.push([x, z]);
    }
  }
  assert.ok(probes.length >= 600);
  for (const [x, z] of probes) {
    const actual = terrain.project(x, z);
    const expected = bruteForceValleyProject(samples, x, z);
    assert.equal(actual.distanceSquared, expected.distanceSquared, `distanceSquared mismatch at (${x}, ${z})`);
    assert.equal(actual.s, expected.s, `s mismatch at (${x}, ${z})`);
    assert.equal(actual.crossM, expected.crossM, `crossM mismatch at (${x}, ${z})`);
    assert.equal(actual.legIndex, expected.legIndex, `legIndex mismatch at (${x}, ${z})`);
  }
});

test('IncheonTerrain.isLand Z-slab index matches naive ray-cast bit-for-bit on real coastlines', () => {
  const coastline = JSON.parse(readFileSync(new URL('../public/scenery/incheon/coastline.json', import.meta.url), 'utf8'));
  const coreCoastline = JSON.parse(readFileSync(new URL('../public/scenery/incheon/sihwa/core-coastline.json', import.meta.url), 'utf8'));
  for (const [label, json] of [['coastline', coastline], ['core-coastline', coreCoastline]]) {
    const terrain = new IncheonTerrain({ schemaVersion: 1, grids: {} }, {}, json);
    let checked = 0;
    for (let z = -6000; z <= 6000; z += 500) {
      for (let x = -6000; x <= 6000; x += 500) {
        assert.equal(terrain.isLand(x, z), naiveIsLand(json, x, z), `${label} mismatch at (${x}, ${z})`);
        checked++;
      }
    }
    const polys = json.land.type === 'Polygon' ? [json.land.coordinates] : json.land.coordinates;
    for (const rings of polys) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 40))) {
          const [vx, vz] = ring[i];
          for (const [dx, dz] of [[0, 0], [0.5, 0.5], [-0.5, -0.5]]) {
            const px = vx + dx;
            const pz = vz + dz;
            assert.equal(terrain.isLand(px, pz), naiveIsLand(json, px, pz), `${label} edge mismatch at (${px}, ${pz})`);
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 500);
  }
});

test('ExplosionSystem and TireSmokeSystem support deferred textures, buffer hydration, and empty dispose', () => {
  const prevDoc = globalThis.document;
  const noop = () => {};
  globalThis.document = {
    createElement: () => ({
      width: 32,
      height: 32,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop: noop }),
        fillRect: noop,
      }),
    }),
  };
  try {
    const scene = new THREE.Scene();
    const explosions = new ExplosionSystem(scene, null, { deferTextures: true });
    const smoke = new TireSmokeSystem(scene, null, { deferTextures: true });

    assert.equal(explosions.fireTexture, null);
    assert.equal(explosions.smokeTexture, null);
    assert.equal(explosions.waterTexture, null);
    assert.equal(explosions.dustTexture, null);
    assert.equal(explosions.sparkTexture, null);
    assert.equal(smoke.smokeTexture, null);
    assert.equal(smoke.waterTexture, null);

    // Disposing before textures are hydrated must not throw.
    assert.doesNotThrow(() => explosions.dispose());
    assert.doesNotThrow(() => smoke.dispose());

    const explosions2 = new ExplosionSystem(scene, null, { deferTextures: true });
    const smoke2 = new TireSmokeSystem(scene, null, { deferTextures: true });
    const buffers = {
      fire: generateEffectAtlasData('fire'),
      smoke: generateEffectAtlasData('smoke'),
      water: generateEffectAtlasData('water'),
      tire: generateEffectAtlasData('tire'),
    };
    explosions2.applyAtlasBuffers(buffers);
    smoke2.applyAtlasBuffers(buffers);

    assert.ok(explosions2.fireTexture instanceof THREE.DataTexture);
    assert.ok(explosions2.smokeTexture instanceof THREE.DataTexture);
    assert.ok(explosions2.waterTexture instanceof THREE.DataTexture);
    assert.ok(explosions2.dustTexture instanceof THREE.DataTexture);
    assert.ok(explosions2.sparkTexture instanceof THREE.CanvasTexture);
    assert.ok(smoke2.smokeTexture instanceof THREE.DataTexture);
    assert.ok(smoke2.waterTexture instanceof THREE.DataTexture);

    assert.doesNotThrow(() => explosions2.dispose());
    assert.doesNotThrow(() => smoke2.dispose());
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('CockpitPhotoOverlay defers loading panelTexture until enabled update or render', () => {
  const overlay = new CockpitPhotoOverlay();
  assert.equal(overlay.panelTexture, null);
  assert.equal(overlay.panelMat.map, null);

  overlay.enabled = false;
  overlay.update();
  assert.equal(overlay.panelTexture, null);
  assert.equal(overlay.panelMat.map, null);

  overlay.enabled = true;
  overlay.update();
  assert.ok(overlay.panelTexture instanceof THREE.Texture);
  assert.equal(overlay.panelMat.map, overlay.panelTexture);
});

test('createFallbackEnvironmentTexture matches sky_1k width and SkyAtmosphere defers HDR when requested', () => {
  const fallback = createFallbackEnvironmentTexture();
  assert.ok(fallback instanceof THREE.DataTexture);
  assert.equal(fallback.image.width, 1024);
  assert.equal(fallback.image.height, 4);
  assert.equal(fallback.mapping, THREE.EquirectangularReflectionMapping);
  fallback.dispose();

  const prevWindow = globalThis.window;
  globalThis.window = {};
  try {
    const scene = new THREE.Scene();
    const origLoad = SkyAtmosphere.prototype.loadEnvironmentHdr;
    let hdrCalls = 0;
    SkyAtmosphere.prototype.loadEnvironmentHdr = function stubHdr() {
      hdrCalls++;
    };
    try {
      const sky = new SkyAtmosphere(scene, null, null, { deferHdr: true });
      assert.equal(hdrCalls, 0);
      assert.ok(sky.fallbackEnvTexture instanceof THREE.DataTexture);
      assert.equal(scene.environment, sky.fallbackEnvTexture);

      sky.loadEnvironmentHdr();
      assert.equal(hdrCalls, 1);
      sky.fallbackEnvTexture.dispose();
      sky.cloudLayer.dispose();
    } finally {
      SkyAtmosphere.prototype.loadEnvironmentHdr = origLoad;
    }
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('UnifiedWorld proximity streaming ignores distant regions and triggers inside 65 km', async () => {
  const world = new UnifiedWorld('coastal');
  assert.ok(distanceToRegionBoundsM(0, 0, world.offsets.get('coastal'), REGION_EXTENTS.coastal) === 0);
  const incheonDistAtCoastal = distanceToRegionBoundsM(0, 0, world.offsets.get('incheon'), REGION_EXTENTS.incheon);
  assert.ok(incheonDistAtCoastal > REGION_STREAM_DISTANCE_M,
    `expected Incheon > 65 km from Coastal origin, got ${incheonDistAtCoastal}`);

  class StreamHost {}
  installPresetSpawner(StreamHost);
  const host = new StreamHost();
  const requested = [];
  world.register('coastal', {
    terrain: { getHeight: () => 0, isLoaded: true },
    airport: {},
    group: new THREE.Group(),
    extent: REGION_EXTENTS.coastal,
  });
  Object.assign(host, {
    world,
    activeAirport: 'coastal',
    terrain: { mesh: {} },
    airport: { group: {} },
    position: new THREE.Vector3(0, 1000, 0),
    preloadUnifiedRegion(id) {
      requested.push(id);
      return Promise.resolve();
    },
  });

  host.updateUnifiedRegionStreaming(1000);
  assert.deepEqual(requested, [], 'no neighbor region should stream at coastal origin');

  // Move to 60 km from Incheon's local western edge (80000 - 7000 = 73000 on X, 60000 on Z in coastal frame)
  const [ix, iz] = world.offsets.get('incheon');
  host.position.set(ix + REGION_EXTENTS.incheon.minX - 40000, 1000, iz);
  host.updateUnifiedRegionStreaming(2000);
  assert.deepEqual(requested, ['incheon']);
});
