import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateControlState } from '../src/ui/FlightPanels.js';
import { setLanguage } from '../src/i18n/index.js';

test('shared controls track deployment, damage, keyboard changes and input mode switches', () => {
  const previous = globalThis.document;
  const ids = ['btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser', 'btn-touch-toggle', 'open-camera', 'camera-select', 'flight-trim-less', 'flight-trim-more', 'flight-park-brake', 'flight-trim-value'];
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
    assert.equal(nodes['camera-select'].value, '0');
    assert.equal(nodes['open-camera'].value, '0');
    assert.equal(nodes['open-camera'].title, 'Camera: Cockpit');
    camera.autoSwitch = true;
    updateControlState(telemetry, camera);
    assert.equal(nodes['open-camera'].value, '7');
    assert.equal(nodes['camera-select'].value, '7');
    camera.autoSwitch = false;
    camera.opticalZoom = 2;
    updateControlState(telemetry, camera);
    assert.equal(nodes['open-camera'].title, 'Camera: Cockpit · 2.0×');
    camera.opticalZoom = 1;
    updateControlState(telemetry, camera);
    assert.equal(nodes['open-camera'].title, 'Camera: Cockpit');
    Object.assign(telemetry, { gearState: .5, flapDegree: 12, flapIndex: 6, spoilers: 1, reverserActive: true, engine1: {} });
    camera.autoSwitch = true;
    updateControlState(telemetry, camera);
    assert.equal(nodes['camera-select'].value, '7');
    assert.equal(nodes['btn-gear'].textContent, 'Gear moving');
    assert.equal(nodes['btn-flaps-ext'].disabled, true, 'limit follows commanded detent while flaps are moving');
    assert.match(nodes['btn-flaps-ext'].textContent, /12°/);
    assert.equal(nodes['btn-spoilers']['aria-pressed'], 'true');
    assert.equal(nodes['btn-reverser']['aria-pressed'], 'true');
    assert.equal(nodes['open-camera'].title, 'Camera: Auto');
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
    assert.equal(nodes['open-camera'].title, 'Camera: Drone');
    delete telemetry.gearDamage;
    telemetry.gearState = 1;
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].textContent, 'Gear down');
    assert.equal(nodes['btn-gear'].disabled, false);
    assert.equal(nodes['btn-spoilers'].disabled, false);
    assert.equal(nodes['btn-reverser'].disabled, false);

    updateControlState(telemetry, camera, { pitchTrim: 3.2, parkingBrake: true });
    assert.equal(nodes['flight-trim-value'].textContent, '3.2°');
    assert.equal(nodes['flight-park-brake']['aria-pressed'], 'true');
    assert.equal(nodes['flight-trim-more'].disabled, false);
    updateControlState(telemetry, camera, { controlsDisabled: true });
    assert.equal(nodes['flight-trim-more'].disabled, true, 'blocked flight input also locks the shared trim controls');
    assert.equal(nodes['flight-park-brake'].disabled, true);

    // During autonomous demo flight, all airplane flight controls are disabled
    telemetry.demoActive = true;
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].disabled, true, 'gear disabled during demo flight');
    assert.equal(nodes['flight-trim-more'].disabled, true);
    assert.equal(nodes['flight-park-brake'].disabled, true);
    assert.equal(nodes['btn-flaps-ret'].disabled, true, 'flaps retract disabled during demo flight');
    assert.equal(nodes['btn-flaps-ext'].disabled, true, 'flaps extend disabled during demo flight');
    assert.equal(nodes['btn-spoilers'].disabled, true, 'spoilers disabled during demo flight');
    assert.equal(nodes['btn-reverser'].disabled, true, 'reverser disabled during demo flight');

    // When manual direct control is engaged, airplane flight controls are re-enabled
    telemetry.demoActive = false;
    updateControlState(telemetry, camera);
    assert.equal(nodes['btn-gear'].disabled, false, 'gear enabled upon taking manual control');
    assert.equal(nodes['btn-flaps-ret'].disabled, true, 'flaps retract follows flap detent limit (0)');
    assert.equal(nodes['btn-flaps-ext'].disabled, false, 'flaps extend enabled upon taking manual control');
    assert.equal(nodes['btn-spoilers'].disabled, false, 'spoilers enabled upon taking manual control');
    assert.equal(nodes['btn-reverser'].disabled, false, 'reverser enabled upon taking manual control');
  } finally { globalThis.document = previous; }
});
