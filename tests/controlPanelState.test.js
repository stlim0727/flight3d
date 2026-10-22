import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateControlState } from '../src/ui/FlightPanels.js';
import { setLanguage } from '../src/i18n/index.js';

test('shared controls track deployment, damage, keyboard changes and input mode switches', () => {
  const previous = globalThis.document;
  const ids = ['btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser', 'btn-touch-toggle', 'open-camera'];
  const nodes = Object.fromEntries(ids.map(id => [id, { textContent: '', setAttribute(key, value) { this[key] = value; } }]));
  let touch = true;
  globalThis.document = {
    getElementById: id => nodes[id],
    body: { classList: { contains: () => touch } },
    documentElement: {},
  };
  try {
    setLanguage('en', { setItem() {} });
    const camera = { mode: 0 };
    const telemetry = { gearState: 1, flapDegree: 5, flapIndex: 2, spoilers: 0 };
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].textContent, 'Gear down');
    assert.equal(nodes['btn-gear']['aria-pressed'], 'true');
    assert.equal(nodes['btn-flaps-ret'].disabled, false);
    assert.equal(nodes['open-camera'].textContent, 'Camera: Cockpit');
    Object.assign(telemetry, { gearState: .5, flapDegree: 12, flapIndex: 6, spoilers: 1, reverserActive: true, engine1: {} });
    camera.autoSwitch = true;
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].textContent, 'Gear moving');
    assert.equal(nodes['btn-flaps-ext'].disabled, true, 'limit follows commanded detent while flaps are moving');
    assert.match(nodes['btn-flaps-ext'].textContent, /12°/);
    assert.equal(nodes['btn-spoilers']['aria-pressed'], 'true');
    assert.equal(nodes['btn-reverser']['aria-pressed'], 'true');
    assert.equal(nodes['open-camera'].textContent, 'Camera: Auto');
    Object.assign(telemetry, { gearState: 0, gearDamage: { left: 'collapsed' }, flapIndex: 0, spoilers: 0, reverserActive: false, engine1: {} });
    camera.autoSwitch = false;
    camera.mode = 6;
    touch = false;
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].textContent, 'Gear failed');
    assert.equal(nodes['btn-flaps-ret'].disabled, true);
    assert.equal(nodes['btn-spoilers']['aria-pressed'], 'false');
    assert.equal(nodes['btn-reverser']['aria-pressed'], 'false');
    assert.equal(nodes['btn-touch-toggle']['aria-pressed'], 'false');
    assert.equal(nodes['open-camera'].textContent, 'Camera: Drone');
    delete telemetry.gearDamage;
    telemetry.gearState = 1;
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].textContent, 'Gear down');
  } finally { globalThis.document = previous; }
});
