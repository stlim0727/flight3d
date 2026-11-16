import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolbarOptionalItems, normalizeToolbarHidden, applyToolbarVisibility } from '../src/ui/toolbarVisibility.js';

const ITEMS = toolbarOptionalItems(['chase', 'cockpit', 'gear']);

function fakeDocument(ids) {
  const nodes = Object.fromEntries(ids.map(id => [id, { hidden: false }]));
  return { nodes, getElementById: id => nodes[id] ?? null };
}

test('optional items are the camera buttons followed by fullscreen', () => {
  assert.deepEqual(ITEMS, ['cam-chase', 'cam-cockpit', 'cam-gear', 'fullscreen']);
});

test('hidden lists keep only known items, once, in toolbar order', () => {
  assert.deepEqual(normalizeToolbarHidden(['fullscreen', 'cam-gear', 'gear', 'cam-gear', 'open-flight-more'], ITEMS),
    ['cam-gear', 'fullscreen']);
  for (const value of [undefined, null, 'cam-gear', { length: 1, 0: 'cam-gear' }]) {
    assert.deepEqual(normalizeToolbarHidden(value, ITEMS), [], `${JSON.stringify(value)} hides nothing`);
  }
});

test('applying a selection hides exactly those buttons and restores them when re-enabled', () => {
  const doc = fakeDocument(['btn-cam-chase', 'btn-cam-cockpit', 'btn-cam-gear', 'btn-fullscreen', 'camera-strip',
    'btn-gear', 'open-flight-more']);
  assert.equal(applyToolbarVisibility(['cam-cockpit', 'fullscreen'], ITEMS, doc), 2);
  assert.equal(doc.nodes['btn-cam-cockpit'].hidden, true);
  assert.equal(doc.nodes['btn-fullscreen'].hidden, true);
  assert.equal(doc.nodes['btn-cam-chase'].hidden, false);
  assert.equal(doc.nodes['camera-strip'].hidden, false);
  assert.equal(applyToolbarVisibility([], ITEMS, doc), 3);
  assert.equal(doc.nodes['btn-cam-cockpit'].hidden, false);
  assert.equal(doc.nodes['btn-fullscreen'].hidden, false);
});

test('aircraft controls and the overflow button can never be hidden by a stored selection', () => {
  const doc = fakeDocument(['btn-cam-chase', 'btn-cam-cockpit', 'btn-cam-gear', 'btn-fullscreen', 'camera-strip',
    'btn-gear', 'btn-flaps-ext', 'btn-skip-demo', 'open-flight-more']);
  applyToolbarVisibility(['gear', 'flaps-ext', 'skip-demo', 'open-flight-more', 'cam-gear'], ITEMS, doc);
  assert.equal(doc.nodes['btn-cam-gear'].hidden, true, 'the landing-gear camera is optional');
  for (const id of ['btn-gear', 'btn-flaps-ext', 'btn-skip-demo', 'open-flight-more']) {
    assert.equal(doc.nodes[id].hidden, false, `${id} stays visible`);
  }
});

test('hiding every camera removes the camera strip and its divider, and it returns with any camera', () => {
  const doc = fakeDocument(['btn-cam-chase', 'btn-cam-cockpit', 'btn-cam-gear', 'btn-fullscreen', 'camera-strip']);
  assert.equal(applyToolbarVisibility(['cam-chase', 'cam-cockpit', 'cam-gear'], ITEMS, doc), 0);
  assert.equal(doc.nodes['camera-strip'].hidden, true);
  assert.equal(doc.nodes['btn-fullscreen'].hidden, false);
  assert.equal(applyToolbarVisibility(['cam-chase', 'cam-cockpit'], ITEMS, doc), 1);
  assert.equal(doc.nodes['camera-strip'].hidden, false);
});

test('missing buttons are tolerated so replay and partial layouts do not throw', () => {
  const doc = fakeDocument(['btn-cam-chase']);
  assert.equal(applyToolbarVisibility(['cam-cockpit'], ITEMS, doc), 1);
});
