import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createMissileMesh, createBanditMesh, banditSkin } from '../src/weapons/missileGeometry.js';

/**
 * The model's forward axis is -Z. A nose cone must therefore present its
 * sharp apex at the minimum Z and its wide base where it meets the fuselage.
 */
function coneEnds(group) {
  group.updateMatrixWorld(true);
  const cone = group.children.find(child => child.geometry?.type === 'ConeGeometry');
  assert.ok(cone, 'expected a nose cone');
  const positions = cone.geometry.attributes.position;
  const point = new Vector3();
  let front = { z: Infinity, radius: -Infinity };
  let rear = { z: -Infinity, radius: -Infinity };
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).applyMatrix4(cone.matrixWorld);
    const radius = Math.hypot(point.x, point.y);
    if (point.z < front.z - 1e-6 || (Math.abs(point.z - front.z) <= 1e-6 && radius > front.radius)) {
      front = { z: point.z, radius };
    }
    if (point.z > rear.z + 1e-6 || (Math.abs(point.z - rear.z) <= 1e-6 && radius > rear.radius)) {
      rear = { z: point.z, radius };
    }
  }
  return { front, rear };
}

for (const type of ['AIM9X', 'AIM120C']) {
  test(`${type} nose points forward instead of tapering into the body`, () => {
    const { front, rear } = coneEnds(createMissileMesh(type));
    assert.ok(front.z < rear.z, 'the apex is ahead of the base');
    assert.ok(front.radius < 1e-6, `forward tip is pointed, radius ${front.radius}`);
    assert.ok(rear.radius > 0.05, `base is wide, radius ${rear.radius}`);
  });
}

test('bandit nose points along its velocity instead of trailing it', () => {
  const { front, rear } = coneEnds(createBanditMesh('BANDIT 1'));
  assert.ok(front.z < rear.z, 'the apex is ahead of the base');
  assert.ok(front.radius < 1e-6, `forward tip is pointed, radius ${front.radius}`);
  assert.ok(rear.radius > 0.2, `base is wide, radius ${rear.radius}`);
});

/** The wing-tip markers are the only meshes that carry the callsign trim color. */
function trimColor(group) {
  let color = null;
  group.traverse(node => {
    if (node.isMesh && node.geometry?.parameters?.width === 0.55) color = node.material.color.getHex();
  });
  return color;
}

test('callsign trim colors never leak between bandits (#722)', () => {
  const one = createBanditMesh('BANDIT 1');
  assert.equal(trimColor(one), banditSkin('BANDIT 1').trim);
  const two = createBanditMesh('BANDIT 2');
  assert.notEqual(trimColor(one), trimColor(two));
  assert.equal(trimColor(one), banditSkin('BANDIT 1').trim, 'a later bandit must not repaint slot 1');
  assert.equal(trimColor(createBanditMesh('CANYON BANDIT')), banditSkin('CANYON BANDIT').trim);
});

test('patrol slots and the canyon bandit use distinct liveries', () => {
  const one = banditSkin('BANDIT 1');
  const two = banditSkin('BANDIT 2');
  const canyon = banditSkin('CANYON BANDIT');
  assert.notEqual(one.body, two.body, 'wingmen are separable by body paint');
  assert.notEqual(one.trim, two.trim, 'wingmen are separable by accent');
  assert.equal(canyon.key, 'lizard');
  assert.equal(banditSkin('BANDIT 1').body, one.body, 'a callsign keeps its scheme across respawns');
});
