import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateControlState } from '../src/ui/FlightPanels.js';
import { installSimulatorHudAndBindings } from '../src/ui/SimulatorHudAndBindings.js';
import { DiagnosticsInspector } from '../src/ui/DiagnosticsInspector.js';

class FakeSim {}
installSimulatorHudAndBindings(FakeSim);

function withMockDocument(ids, fn) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const elements = new Map();
  for (const id of ids) {
    const attributes = {};
    const classes = new Set();
    elements.set(id, {
      id,
      hidden: false,
      disabled: false,
      textContent: '',
      value: '',
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          } else if (force) classes.add(c);
          else classes.delete(c);
        },
        contains(c) { return classes.has(c); },
      },
      setAttribute(k, v) { attributes[k] = String(v); },
      getAttribute(k) { return attributes[k] ?? null; },
    });
  }
  const bodyClasses = new Set();
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    body: {
      classList: {
        contains: (c) => bodyClasses.has(c),
        toggle: (c, force) => (force ? bodyClasses.add(c) : bodyClasses.delete(c)),
      },
    },
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
  };
  try {
    return fn(elements);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

test('replay.css hides touch-controls-overlay, flight-toolbar strip, AP, stale fuel, and diagnostics during replay', () => {
  const css = fs.readFileSync(new URL('../src/styles/replay.css', import.meta.url), 'utf8');
  const ruleMatch = css.match(/body\.replaying[\s\S]*?\{[^}]*display:\s*none\s*!important;/);
  assert.ok(ruleMatch, 'expected body.replaying display: none !important rule in replay.css');
  const rule = ruleMatch[0];
  for (const selector of [
    '#touch-controls-overlay',
    '.touch-controls-overlay',
    '#btn-lobby-end',
    '.flight-toolbar',
    '#flight-more-panel',
    '#ap-bar',
    '#ap-panel',
    '.hud-item[data-hud="fuel"]',
    '#btn-touch-toggle',
    '#touch-btn-gyro',
    '#gyro-settings',
    '#btn-diag',
    '#btn-joystick-check',
    '#diagnostics-panel',
  ]) {
    assert.ok(rule.includes(selector), `expected replay.css body.replaying rule to hide ${selector}`);
  }
});

test('updateControlState disables bottom flight control buttons when controlsDisabled is true', () => {
  const ids = [
    'flight-trim-less', 'flight-trim-more', 'flight-park-brake',
    'btn-gear', 'btn-flaps-ret', 'btn-flaps-ext', 'btn-spoilers', 'btn-reverser',
  ];
  withMockDocument(ids, (elements) => {
    updateControlState(
      { gearState: 1, gearDamage: {}, flapDegree: 5, flapIndex: 1, spoilers: 0, reverserActive: false },
      { mode: 1, autoSwitch: false, opticalZoom: 1 },
      { demoActive: false, controlsDisabled: true, pitchTrim: 0, parkingBrake: false },
    );
    for (const id of ids) {
      assert.equal(elements.get(id).disabled, true, `expected ${id} to be disabled`);
    }
  });
});

test('updateAutopilotUI disables AP controls and collapses #ap-panel via updateApToggleUI during replay', () => {
  const ids = ['btn-ap-toggle', 'ap-panel', 'ap-bar', 'hud-phase', 'hud-ap-modes',
    'btn-ap', 'btn-ap-hdg', 'btn-ap-alt', 'btn-ap-spd', 'btn-ap-app'];
  withMockDocument(ids, (elements) => {
    elements.get('ap-panel').hidden = false;
    elements.get('btn-ap-toggle').setAttribute('aria-expanded', 'true');
    const fakeSim = {
      demoDirector: { isActive: false },
      replayDirector: { active: true },
      telemetry: { onGround: false, vsiFpm: 0 },
      autopilot: {
        master: false,
        lateralMode: 'NONE',
        verticalMode: 'NONE',
        speedMode: false,
        appArmed: false,
        annunciation: () => '',
      },
      flightPhase: FakeSim.prototype.flightPhase,
      updateApToggleUI: FakeSim.prototype.updateApToggleUI,
    };
    FakeSim.prototype.updateAutopilotUI.call(fakeSim);
    assert.equal(elements.get('btn-ap-toggle').disabled, true);
    assert.equal(elements.get('btn-ap-toggle').getAttribute('aria-expanded'), 'false');
    assert.ok(elements.get('btn-ap-toggle').getAttribute('aria-label'));
    assert.ok(elements.get('btn-ap-toggle').getAttribute('title'));
    assert.equal(elements.get('ap-panel').hidden, true);
    assert.equal(elements.get('ap-bar').classList.contains('ap-collapsed'), true);
    for (const id of ['btn-ap', 'btn-ap-hdg', 'btn-ap-alt', 'btn-ap-spd', 'btn-ap-app']) {
      assert.equal(elements.get(id).disabled, true, `expected ${id} to be disabled during replay`);
    }
  });
});

test('DiagnosticsInspector refuses to open during replay', () => {
  const classes = new Set(['visible']);
  const inspector = Object.create(DiagnosticsInspector.prototype);
  inspector.sim = { replayDirector: { active: true } };
  inspector.visible = true;
  inspector.panel = {
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
  };
  inspector.toggle();
  assert.equal(inspector.visible, false);
  assert.equal(classes.has('visible'), false);
  inspector.show();
  assert.equal(inspector.visible, false);
  assert.equal(classes.has('visible'), false);
});
