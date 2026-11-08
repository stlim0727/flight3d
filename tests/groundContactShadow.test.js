import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => noop,
    has: () => false,
  });
  globalThis.document = {
    createElement: () => ({ getContext: () => mockCtx, width: 0, height: 0 }),
  };
}

import {
  GroundContactShadow,
  contactShadowAppearance,
  planformYaw,
  CONTACT_SHADOW_CEILING_M,
} from '../src/environment/GroundContactShadow.js';

test('contact shadow reads as a height cue: strongest on the ground, gone by the ceiling', () => {
  const ground = contactShadowAppearance(0);
  assert.equal(ground.visible, true);
  assert.equal(ground.opacity, 0.5);
  assert.equal(ground.spread, 1, 'Footprint matches the airframe at touchdown');

  let previousOpacity = Infinity;
  let previousSpread = 1;
  for (const h of [5, 15, 30, 45, 59.9]) {
    const look = contactShadowAppearance(h);
    assert.equal(look.visible, true);
    assert.ok(look.opacity < previousOpacity, `opacity must fall with height (at ${h} m)`);
    assert.ok(look.spread > previousSpread, `spread must grow with height (at ${h} m)`);
    previousOpacity = look.opacity;
    previousSpread = look.spread;
  }

  for (const h of [CONTACT_SHADOW_CEILING_M, 80, 500]) {
    assert.equal(contactShadowAppearance(h).visible, false, `no blob at ${h} m AGL`);
  }
});

test('planform yaw points the silhouette nose along the aircraft forward vector', () => {
  assert.ok(Math.abs(planformYaw(0, -1)) < 1e-12, 'Nose along -Z needs no rotation');
  assert.ok(Math.abs(planformYaw(-1, 0) - Math.PI / 2) < 1e-9, 'Nose along -X yaws +90 degrees');
  assert.ok(Math.abs(planformYaw(1, 0) + Math.PI / 2) < 1e-9, 'Nose along +X yaws -90 degrees');
});

test('contact shadow tracks the displayed pose, banks, and stays hidden when disabled', () => {
  const scene = new THREE.Scene();
  const blob = new GroundContactShadow(scene);
  const groundHeight = 7;
  const position = new THREE.Vector3(90, groundHeight + 2, -202);

  blob.setEnabled(true);
  const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  blob.update(position, heading, groundHeight, 'B738');
  assert.equal(blob.mesh.visible, true);
  assert.ok(Math.abs(blob.mesh.position.y - (groundHeight + 0.05)) < 1e-9, 'Blob sits on the ground sheet, not on sea level');
  assert.ok(Math.abs(blob.mesh.rotation.y - Math.PI / 2) < 1e-9, 'Silhouette follows heading');
  // 737-800 planform: 35.8 m span across, 39.5 m nose-to-tail.
  assert.ok(Math.abs(blob.mesh.scale.x - 35.8 * blob.mesh.scale.z / 39.5) < 1e-6, 'Footprint keeps the planform aspect');
  assert.ok(blob.mesh.scale.z > 39 && blob.mesh.scale.z < 40);
  assert.ok(blob.material.map, 'Planform texture is attached');

  // 30 degrees of bank foreshortens the span but not the length.
  const rolled = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 6));
  const uprightSpan = blob.mesh.scale.x;
  const spreadAt2m = contactShadowAppearance(2).spread;
  blob.update(position, rolled, groundHeight, 'B738');
  assert.ok(Math.abs(blob.mesh.scale.x - uprightSpan * Math.cos(Math.PI / 6)) < 1e-6, 'Bank foreshortens the wing axis');
  assert.ok(Math.abs(blob.mesh.scale.z - 39.5 * spreadAt2m) < 1e-6, 'Length is unaffected by bank');

  blob.update(new THREE.Vector3(0, groundHeight + 400, 0), heading, groundHeight, 'B738');
  assert.equal(blob.mesh.visible, false, 'Climbed away: the cue retires');

  // Unknown aircraft fall back to the physics wingspan instead of a fixed disc.
  blob.update(position, heading, groundHeight, 'A320', 11.0);
  assert.equal(blob.mesh.visible, true);
  assert.ok(blob.mesh.scale.x > 10 && blob.mesh.scale.x < 12, 'Fallback span drives the width');

  blob.setEnabled(false);
  blob.update(position, heading, groundHeight, 'B738');
  assert.equal(blob.mesh.visible, false, 'Disabling contact shadow hides the mesh');
});
