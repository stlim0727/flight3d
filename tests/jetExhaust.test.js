import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JetExhaust } from '../src/effects/JetExhaust.js';

test('exhaust follows engine spool and thrust, then fades on shutdown and hides on impact', () => {
  const jet = new JetExhaust();
  jet.update(.1, {});
  assert.equal(jet.group.visible, false);
  for (let i = 0; i < 60; i++) jet.update(1 / 60, { engine1: { n1: 65, thrust: 10000 } });
  const dryLength = jet.plume.scale.z;
  assert.equal(jet.material.uniforms.burner.value, 0);
  for (let i = 0; i < 120; i++) jet.update(1 / 60, { engine1: { n1: 100, thrust: 100000 } });
  assert.ok(jet.plume.scale.z > dryLength * 2);
  assert.ok(jet.material.uniforms.burner.value > .95);
  jet.update(.1, { engine1: { n1: 100, thrust: 0 } });
  assert.ok(jet.power < 1, 'zero thrust cools even while the fan winds down');
  jet.update(.01, { engine1: { n1: 100, thrust: 100000 } }, true);
  assert.equal(jet.group.visible, false);
  for (let i = 0; i < 120; i++) jet.update(1 / 60, {});
  assert.equal(jet.group.visible, false);
  jet.plume.geometry.computeBoundingBox();
  assert.ok(jet.plume.geometry.boundingBox.min.z >= -1e-6, 'plume extends aft from the nozzle');
  assert.ok(jet.plume.geometry.boundingBox.max.z > .99);
});
