import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  GroundContactShadow,
  contactShadowAppearance,
  CONTACT_SHADOW_CEILING_M,
} from '../src/environment/GroundContactShadow.js';

const SPAN = 35.8;

test('contact shadow reads as a height cue: strongest on the ground, gone by the ceiling', () => {
  const ground = contactShadowAppearance(0, SPAN);
  assert.equal(ground.visible, true);
  assert.equal(ground.opacity, 0.5);
  assert.ok(Math.abs(ground.radius - SPAN * 0.32) < 1e-9, 'Footprint hugs the airframe at touchdown');

  let previousOpacity = Infinity;
  let previousRadius = 0;
  for (const h of [5, 15, 30, 45, 59.9]) {
    const look = contactShadowAppearance(h, SPAN);
    assert.equal(look.visible, true);
    assert.ok(look.opacity < previousOpacity, `opacity must fall with height (at ${h} m)`);
    assert.ok(look.radius > previousRadius, `spread must grow with height (at ${h} m)`);
    previousOpacity = look.opacity;
    previousRadius = look.radius;
  }

  for (const h of [CONTACT_SHADOW_CEILING_M, 80, 500]) {
    assert.equal(contactShadowAppearance(h, SPAN).visible, false, `no blob at ${h} m AGL`);
  }
});

test('contact shadow tracks the displayed pose on live terrain and stays hidden when disabled', () => {
  const scene = new THREE.Scene();
  const blob = new GroundContactShadow(scene);
  const position = new THREE.Vector3(90, 7 + 10, -202);
  const groundHeight = 7;

  blob.setEnabled(true);
  blob.update(position, groundHeight, SPAN);
  assert.equal(blob.mesh.visible, true);
  assert.ok(Math.abs(blob.mesh.position.y - (groundHeight + 0.05)) < 1e-9, 'Blob sits on the ground sheet, not on sea level');
  assert.equal(blob.mesh.position.x, position.x);
  assert.equal(blob.mesh.position.z, position.z);
  assert.ok(blob.mesh.scale.x > 5 && blob.mesh.scale.x < SPAN, 'Footprint scales with the airframe');

  blob.update(new THREE.Vector3(0, groundHeight + 400, 0), groundHeight, SPAN);
  assert.equal(blob.mesh.visible, false, 'Climbed away: the cue retires');

  blob.update(position, groundHeight, SPAN);
  blob.setEnabled(false);
  assert.equal(blob.mesh.visible, false, 'Leaving ultraLow hands shading back to the shadow map');
  blob.update(position, groundHeight, SPAN);
  assert.equal(blob.mesh.visible, false, 'Disabled blobs ignore updates');
});
