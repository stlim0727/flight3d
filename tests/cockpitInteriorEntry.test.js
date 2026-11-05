import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop: noop }) });
  globalThis.document = {
    createElement: () => ({ getContext: () => mockCtx, width: 64, height: 64 })
  };
}

import { Cockpit } from '../src/aircraft/Cockpit.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';
import { MCPCanvas } from '../src/aircraft/MCPCanvas.js';
import { ISFDCanvas } from '../src/aircraft/ISFDCanvas.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';

const createCanvases = () => [
  new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256),
  new MCPCanvas(512, 64), new ISFDCanvas(128, 128), new CDUCanvas(256, 256)
];

const withWindow = (body) => {
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    return body();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
};

describe('interior is streamed on cockpit entry, not at boot', () => {
  it('constructing a cockpit requests no interior bytes', (t) => {
    const requested = [];
    t.mock.method(GLTFLoader.prototype, 'load', (url) => requested.push(url));
    t.mock.method(console, 'warn', () => {});
    withWindow(() => {
      const cockpit = new Cockpit(...createCanvases());
      assert.deepEqual(requested, [], 'A lobby visitor must not download the cockpit interior');
      assert.equal(cockpit.cockpitModelLoading, false);
      assert.equal(cockpit.cockpitModelRequested, false);
    });
  });

  it('ensureCockpitModel starts the download exactly once', (t) => {
    const requested = [];
    t.mock.method(GLTFLoader.prototype, 'load', (url) => requested.push(url));
    t.mock.method(console, 'warn', () => {});
    withWindow(() => {
      const cockpit = new Cockpit(...createCanvases());
      assert.equal(cockpit.ensureCockpitModel(), true, 'The first entry starts the download');
      assert.equal(cockpit.ensureCockpitModel(), false, 'A repeat entry must not re-request it');
      assert.equal(cockpit.ensureCockpitModel(), false);
      assert.deepEqual(requested, ['/models/b737-cockpit-medium.glb']);
      assert.equal(cockpit.cockpitModelLoading, true);
      assert.equal(cockpit.cockpitModelRequested, true);
    });
  });

  it('stays silent outside a browser', () => {
    const cockpit = new Cockpit(...createCanvases());
    assert.equal(cockpit.ensureCockpitModel(), false,
      'With no window there is nothing to download and nothing to wait for');
    assert.equal(cockpit.cockpitModelRequested, false);
  });
});

describe('the camera holds a cockpit entry until the interior lands', () => {
  const MODES = CameraSystem.MODES;

  const gated = (state) => {
    const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
    let current = state;
    let calls = 0;
    system.setCockpitInteriorGate(() => { calls += 1; return current; });
    return { system, setState: (next) => { current = next; }, gateCalls: () => calls };
  };

  it('refuses the cockpit while loading and lands it when ready', () => {
    const { system, setState } = gated('loading');
    assert.equal(system.setMode(MODES.COCKPIT, true), false);
    assert.equal(system.mode, MODES.CHASE, 'The view stays outside while the interior streams');
    assert.equal(system.pendingCockpitEntry, true);

    setState('ready');
    assert.equal(system.completeCockpitEntry(), true);
    assert.equal(system.mode, MODES.COCKPIT);
    assert.equal(system.pendingCockpitEntry, false);
    assert.equal(system.completeCockpitEntry(), false, 'One entry lands once');
  });

  it('does not hold a cockpit that will never arrive', () => {
    const { system } = gated('unavailable');
    assert.equal(system.setMode(MODES.COCKPIT, true), true,
      'Failure is the existing path: enter, then get pulled back out with a notice');
    assert.equal(system.mode, MODES.COCKPIT);
    assert.equal(system.pendingCockpitEntry, false);
  });

  it('drops the held entry when the visitor chooses another view', () => {
    const { system, setState } = gated('loading');
    system.setMode(MODES.COCKPIT, true);
    assert.equal(system.pendingCockpitEntry, true);
    system.setMode(MODES.WING, true);
    assert.equal(system.pendingCockpitEntry, false, 'A newer view request wins');
    setState('ready');
    assert.equal(system.completeCockpitEntry(), false);
    assert.equal(system.mode, MODES.WING, 'The late interior must not steal the view back');
  });

  it('releases a held entry whose interior can never arrive', () => {
    const { system, setState } = gated('loading');
    system.setMode(MODES.COCKPIT, true);
    assert.equal(system.pendingCockpitEntry, true, 'The request is waiting on the interior');
    setState('unavailable');
    assert.equal(system.releaseCockpitEntry(), true, 'The release reports it was waiting');
    assert.equal(system.pendingCockpitEntry, false);
    // A late success callback cannot resurrect an entry the failure already closed.
    setState('ready');
    assert.equal(system.completeCockpitEntry(), false);
    assert.equal(system.releaseCockpitEntry(), false, 'Nothing is left to release');
  });

  it('is not consulted for views that need no interior', () => {
    const { system, gateCalls } = gated('loading');
    system.setMode(MODES.CHASE, true);
    system.setMode(MODES.DRONE, true);
    assert.equal(gateCalls(), 0, 'Only a cockpit request pays for the probe');
  });

  it('keeps AUTO from cutting into an interior that has not arrived', () => {
    const { system, setState } = gated('loading');
    const aircraft = new THREE.Object3D();
    aircraft.position.y = 100;
    system.setTerrain(() => 0);
    system.setMode(MODES.AUTO, true);
    // The same intent sequence that reaches the cockpit in autoCameraIntent.test.js.
    for (let i = 0; i < 6; i += 1) {
      system.update(8, aircraft, { iasKnots: 250, rollDeg: 0, gearState: 1, vsiFpm: -500 });
    }
    assert.notEqual(system.mode, MODES.COCKPIT, 'AUTO cannot show a cockpit shell');
    assert.equal(system.pendingCockpitEntry, true);
    setState('ready');
    assert.equal(system.completeCockpitEntry(), true);
    assert.equal(system.mode, MODES.COCKPIT);
  });
});
