import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Ships } from '../src/environment/Ships.js';
import { shipAssetManifest, shipBounds, createWakeTexture } from '../src/environment/ShipAssets.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

const models = new Map();
async function loadAsset(type) {
  if (!models.has(type)) {
    const bytes = await readFile(
      new URL(`../public/${shipAssetManifest[type].url}`, import.meta.url)
    );
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ''
    );
    models.set(type, gltf.scene);
  }
  return models.get(type).clone(true);
}
const water = {
  getWaveHeight: (x, z, t) => 4 + Math.sin(x * 0.004 + t) * 0.6 + Math.cos(z * 0.006 + t) * 0.3
};

test('four shipped GLBs have metre bounds, shared material batches and outward hull normals', async () => {
  for (const [type, asset] of Object.entries(shipAssetManifest)) {
    const model = await loadAsset(type),
      bounds = shipBounds(model);
    assert.deepEqual(bounds.min.toArray(), asset.bounds.min);
    assert.deepEqual(bounds.max.toArray(), asset.bounds.max);
    assert.ok(bounds.min.y < 0 && bounds.max.y > 0, 'waterline cuts hull');
    let triangles = 0,
      draws = 0;
    model.traverse((n) => {
      if (n.isMesh) {
        draws++;
        triangles += (n.geometry.index?.count || n.geometry.attributes.position.count) / 3;
      }
    });
    assert.equal(triangles, asset.triangles);
    assert.equal(draws, asset.drawCalls);
    assert.ok(draws <= 8);
    const hullMaterial = type === 'cargo' ? 0 : type === 'cruise' ? 1 : type === 'tanker' ? 6 : 5;
    const hull = model.getObjectByName(`${type}-material-${hullMaterial}`);
    assert.ok(hull.geometry.attributes.normal.getX(0) < 0, 'port hull points outward');
  }
});

test('late asset replacement preserves roots, route phase and buoyancy across updates', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ships = new Ships(water, {
    loadAsset: async (type) => {
      await gate;
      return loadAsset(type);
    },
    random: () => 0.2
  });
  const all = [...ships.vessels, ...ships.speedboats];
  for (let i = 0; i < 120; i++) ships.update(1 / 60, i / 60);
  const roots = all.map((v) => v.mesh),
    poses = roots.map((m) => [...m.position.toArray(), ...m.quaternion.toArray()]);
  release();
  await ships.ready;
  all.forEach((v, i) => {
    assert.equal(v.mesh, roots[i]);
    assert.deepEqual([...v.mesh.position.toArray(), ...v.mesh.quaternion.toArray()], poses[i]);
    assert.equal(v.assetStatus, 'loaded');
  });
  for (let i = 120; i < 600; i++) {
    const t = i / 60;
    ships.update(1 / 60, t);
    for (const v of ships.vessels)
      assert.equal(v.mesh.position.y, water.getWaveHeight(v.basePos.x, v.basePos.z, t));
    for (const b of ships.speedboats) {
      assert.ok(
        Math.abs(Math.hypot(b.mesh.position.x - b.cx, b.mesh.position.z - b.cz) - b.radius) < 1e-9
      );
      const forward = new T.Vector3(0, 0, -1)
        .applyQuaternion(b.mesh.quaternion)
        .setY(0)
        .normalize();
      assert.ok(forward.dot(new T.Vector3(-Math.sin(b.angle), 0, Math.cos(b.angle))) > 0.999);
      assert.ok(new T.Vector3(0, 0, -1).applyQuaternion(b.mesh.quaternion).y > 0, 'planing bow up');
      b.wake.updateMatrixWorld(true);
      const vertices = b.wake.geometry.attributes.position;
      for (const j of [0, 100, 224]) {
        const p = new T.Vector3().fromBufferAttribute(vertices, j).applyMatrix4(b.wake.matrixWorld);
        assert.ok(
          Math.abs(p.y - water.getWaveHeight(p.x, p.z, t) - 0.12) < 1e-5,
          'wake hugs water'
        );
      }
      assert.ok(b.wake.position.clone().sub(b.mesh.position).dot(forward) < 0, 'wake behind');
    }
  }
});

test('ship collision bounds follow heading, pitch, roll and waves, including speedboats', async () => {
  const ships = new Ships(water, { loadAsset, random: () => 0 });
  await ships.ready;
  const detector = new CollisionDetector(null, null, null, ships, water);
  for (const v of [...ships.vessels, ...ships.speedboats])
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI]) {
      v.mesh.position.y = 14;
      v.mesh.rotation.set(0.12, yaw, -0.08, 'YXZ');
      v.mesh.updateMatrixWorld(true);
      const local = v.bounds.getCenter(new T.Vector3());
      const hit = local.clone().applyMatrix4(v.mesh.matrixWorld);
      assert.ok(detector.checkShips(hit, [{ pos: hit, radius: 0.1, desc: 'probe' }]));
      const clear = local
        .clone()
        .setY(v.bounds.max.y + 2)
        .applyMatrix4(v.mesh.matrixWorld);
      assert.equal(detector.checkShips(clear, [{ pos: clear, radius: 0.1, desc: 'probe' }]), null);
      const edge = local
        .clone()
        .setX(v.bounds.max.x + 0.4)
        .applyMatrix4(v.mesh.matrixWorld);
      assert.ok(
        detector.checkShips(edge, [{ pos: edge, radius: 0.5, desc: 'probe' }]),
        'sphere edge contact'
      );
      // Mast and bow envelope points must not be clipped to the old hardcoded height/length.
      const top = local
        .clone()
        .setY(v.bounds.max.y - 0.01)
        .applyMatrix4(v.mesh.matrixWorld);
      assert.ok(detector.checkShips(top, [{ pos: top, radius: 0.1, desc: 'probe' }]));
    }
});

test('failed downloads retain visible collidable fallback and settle readiness', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const ships = new Ships(water, {
    loadAsset: async () => {
      throw Error('offline');
    },
    random: () => 0
  });
  await ships.ready;
  assert.equal(ships.assetErrors.length, 5);
  for (const v of [...ships.vessels, ...ships.speedboats]) {
    assert.equal(v.assetStatus, 'fallback');
    assert.equal(v.mesh.children.length, 1);
    assert.ok(!v.bounds.isEmpty());
  }
  ships.update(1, 1);
  assert.ok(Number.isFinite(ships.speedboats[0].mesh.position.y));
});

test('wake alpha fades to transparent edges instead of a solid rectangle', () => {
  const { data, width, height } = createWakeTexture().image;
  const alpha = (x, y) => data[(y * width + x) * 4 + 3];
  for (let x = 0; x < width; x++) {
    assert.equal(alpha(x, 0), 0);
    assert.equal(alpha(x, height - 1), 0);
  }
  assert.ok(alpha(64, 48) > 0);
  assert.equal(alpha(0, 48), 0);
});
