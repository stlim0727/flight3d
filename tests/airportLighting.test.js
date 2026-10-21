import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Airport } from '../src/environment/Airport.js';
import { RENDER_QUALITY, resolveRenderQuality } from '../src/config/renderQuality.js';

test('rabbit preserves every station, wrap, brightness and a constant light count', t => {
  const airport = Object.assign(Object.create(Airport.prototype), {
    group: new THREE.Group(), elevation: 12, runwayLength: 3200,
    runwayWidth: 60, beaconLights: [],
  });
  airport.buildLighting();
  const light = airport.approachLight;
  const count = () => { let n = 0; airport.group.traverseVisible(o => { if (o.isPointLight) n++; }); return n; };
  assert.equal(count(), 5); // One rabbit plus four PAPI units.
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let step = 0; step < 15; step++) {
      now = ((cycle + (step + 0.5) / 15) / 1.6) * 1000;
      airport.update(1 / 60, new THREE.Vector3(-2250, 12 + 1000 * Math.tan(3 * Math.PI / 180), 0));
      assert.strictEqual(airport.approachLight, light);
      assert.equal(light.position.x, -1600 - (15 - step) * 50);
      assert.equal(light.position.y, 14.6);
      assert.equal(light.intensity, 8);
      assert.equal(light.distance, 45);
      assert.equal(count(), 5);
    }
  }
  assert.deepEqual(airport.papiLights.map(p => p.pointLight.color.getHex()), [0xff1a1a, 0xff1a1a, 0xffffff, 0xffffff]);
  airport.update(0, new THREE.Vector3(-2250, 12, 0));
  assert.ok(airport.papiLights.every(p => p.pointLight.color.getHex() === 0xff1a1a));
  airport.update(0, new THREE.Vector3(-2250, 200, 0));
  assert.ok(airport.papiLights.every(p => p.pointLight.color.getHex() === 0xffffff));
  airport.update(0, new THREE.Vector3(0, 12, 0));
  assert.deepEqual(airport.papiLights.map(p => p.pointLight.color.getHex()), [0xffffff, 0xffffff, 0xff1a1a, 0xff1a1a]);
});

test('render quality uses safe defaults for missing or invalid saved values', () => {
  for (const value of [undefined, null, '', 'invalid', '__proto__']) assert.equal(resolveRenderQuality(value), 'balanced');
  for (const value of Object.keys(RENDER_QUALITY)) assert.equal(resolveRenderQuality(value), value);
  assert.equal(RENDER_QUALITY.performance.maxDpr, 1);
  assert.equal(RENDER_QUALITY.high.terrain, 'high');
});
