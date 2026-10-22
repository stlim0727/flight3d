import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => () => ({ addColorStop: noop })
  });
  globalThis.document = {
    createElement: () => ({
      getContext: () => mockCtx,
      width: 64,
      height: 64
    })
  };
}

import { Cockpit } from '../src/aircraft/Cockpit.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';
import { MCPCanvas } from '../src/aircraft/MCPCanvas.js';
import { ISFDCanvas } from '../src/aircraft/ISFDCanvas.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';

const createCanvases = () => [
  new PFDCanvas(256, 256),
  new NDCanvas(256, 256),
  new EICASCanvas(256, 256),
  new MCPCanvas(512, 64),
  new ISFDCanvas(128, 128),
  new CDUCanvas(256, 256)
];

describe('Cockpit GLTF Interior System', () => {
  it('should initialize the cockpit group with the captain eye viewpoint', () => {
    const cockpit = new Cockpit(...createCanvases());

    assert.ok(cockpit.group instanceof THREE.Group, 'Cockpit root must be a THREE.Group');
    assert.ok(cockpit.gltfCockpitGroup instanceof THREE.Group, 'GLTF cockpit group must exist');
    assert.ok(cockpit.group.children.includes(cockpit.gltfCockpitGroup), 'GLTF group must be attached to root');
    assert.ok(cockpit.captainEyePos instanceof THREE.Vector3, 'Captain eye position must exist');
    assert.strictEqual(cockpit.captainEyePos.x, -0.48);

    // In a Node test environment nothing is downloaded: the interior stays absent.
    assert.strictEqual(cockpit.gltfCockpitLoaded, false);
    assert.strictEqual(cockpit.cockpitModelLoading, false);
    assert.strictEqual(cockpit.cockpitModelFailed, false);
  });

  it('trades instrument flood light for daylight without a mode switch', () => {
    const cockpit = new Cockpit(...createCanvases());
    const base = cockpit.floodBaseIntensity.slice();
    assert.equal(cockpit.floods.length, base.length, 'Every cockpit flood must be registered');

    cockpit.syncDaylight(0);
    cockpit.floods.forEach((flood, i) => assert.equal(flood.intensity, base[i],
      'Night keeps the shipped flood glow'));

    let previous = base.map(() => Infinity);
    for (const daylight of [0.1, 0.25, 0.5, 0.75, 0.9, 1, 3]) {
      cockpit.syncDaylight(daylight);
      cockpit.floods.forEach((flood, i) => {
        assert.ok(flood.intensity <= previous[i], `daylight ${daylight} must not brighten a flood`);
        assert.ok(flood.intensity >= 0.06, 'Floods keep a floor so the deck never goes dark');
        previous[i] = flood.intensity;
      });
    }
    cockpit.floods.forEach((flood, i) => assert.ok(Math.abs(flood.intensity - Math.max(base[i] * 0.08, 0.06)) < 1e-9,
      'Full sun leaves a small instrument fill'));

    cockpit.syncDaylight(0);
    cockpit.floods.forEach((flood, i) => assert.equal(flood.intensity, base[i],
      'Setting the sun returns the floods'));
  });

  it('can hide yokes for instrument inspection without stopping their animation', () => {
    const cockpit = new Cockpit(...createCanvases());
    cockpit.gltfYokes = [new THREE.Group(), new THREE.Group()];

    assert.equal(cockpit.toggleYokes(), false);
    assert.ok(cockpit.gltfYokes.every(yoke => !yoke.visible));

    cockpit.updateControls({ aileron: 1 });
    assert.ok(cockpit.gltfYokes.every(yoke => yoke.rotation.z > 1), 'Hidden yokes must keep articulating');

    assert.equal(cockpit.toggleYokes(), true);
    assert.ok(cockpit.gltfYokes.every(yoke => yoke.visible));
  });

  it('should tolerate control updates before the interior asset has bound its parts', () => {
    const cockpit = new Cockpit(...createCanvases());
    cockpit.updateControls({ throttle: 1, rudder: 1, elevator: 1, aileron: 1 });
    assert.strictEqual(cockpit.gltfYokes, undefined, 'No parts are bound before the interior loads');
  });

  it('should mount live dynamic displays and cockpit framing on the GLTF interior', () => {
    const cockpit = new Cockpit(...createCanvases());

    cockpit.setupGltfFlightDisplays();
    assert.ok(cockpit.gltfDisplays instanceof THREE.Group, 'GLTF displays group must exist');
    assert.ok(cockpit.gltfCaptainPfd instanceof THREE.Mesh, 'Captain PFD must be a Mesh');
    assert.strictEqual(cockpit.gltfCaptainPfd.material.map, cockpit.pfdCanvas.texture, 'PFD must map to live pfdCanvas texture');
    assert.strictEqual(cockpit.gltfCaptainNd.material.map, cockpit.ndCanvas.texture, 'ND must map to live ndCanvas texture');
    assert.strictEqual(cockpit.gltfUpperEicas.material.map, cockpit.eicasCanvas.texture, 'EICAS must map to live eicasCanvas texture');
    assert.strictEqual(cockpit.gltfIsfd.material.map, cockpit.isfdCanvas.texture, 'ISFD must map to live isfdCanvas texture');
    assert.strictEqual(cockpit.gltfMcp.material.map, cockpit.mcpCanvas.texture, 'MCP must map to live mcpCanvas texture');
    assert.strictEqual(cockpit.gltfCaptainCdu.material.map, cockpit.cduCanvas.texture, 'CDU must map to live cduCanvas texture');

    // Verify depth / polygonOffset to eliminate Z-fighting
    assert.strictEqual(cockpit.gltfCaptainPfd.material.polygonOffset, true);
    assert.strictEqual(cockpit.gltfCaptainPfd.material.polygonOffsetFactor, -1);

    // Mount GLTF framing and verify windshield glass and ceiling trims
    cockpit.setupGltfCockpitFraming();
    assert.ok(cockpit.gltfCockpitFraming instanceof THREE.Group, 'GLTF cockpit framing group must exist');
    assert.strictEqual(cockpit.gltfGlassPanels.length, 4, 'Must have 4 tinted windshield glass panels (1L, 1R, 2L, 2R)');
    assert.ok(cockpit.gltfCeilingTrim instanceof THREE.Group, 'Ceiling eyebrow trim must exist');
    assert.ok(cockpit.gltfCompassBracket instanceof THREE.Mesh, 'Compass center post bracket must exist');
    assert.strictEqual(cockpit.gltfGlassPanels[0].material.transparent, true);
    assert.strictEqual(cockpit.gltfGlassPanels[0].material.depthWrite, false);
  });

  it('reports the interior as loading, then as failed once both GLB assets are unavailable', (t) => {
    const cockpit = new Cockpit(...createCanvases());
    const requested = [];
    let loadError;
    t.mock.method(GLTFLoader.prototype, 'load', (url, _onLoad, _onProgress, onError) => {
      requested.push(url);
      loadError = onError;
    });
    t.mock.method(console, 'warn', () => {});
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      cockpit.loadCockpitModel('/models/b737-cockpit-medium.glb');
      assert.strictEqual(cockpit.cockpitModelLoading, true, 'A download in flight must be visible to the camera');
      assert.strictEqual(cockpit.gltfCockpitLoaded, false);

      // Medium asset failure retries the Draco lite asset: still downloading.
      loadError(new Error('medium asset unavailable'));
      assert.strictEqual(cockpit.cockpitModelLoading, true);
      assert.strictEqual(cockpit.cockpitModelFailed, false);
      assert.strictEqual(requested.length, 2);

      // Draco retry fails too: no interior exists to show.
      loadError(new Error('draco asset unavailable'));
      assert.strictEqual(cockpit.cockpitModelLoading, false);
      assert.strictEqual(cockpit.gltfCockpitLoaded, false);
      assert.strictEqual(cockpit.cockpitModelFailed, true,
        'The camera must learn that no GLTF interior will ever appear');
      assert.strictEqual(cockpit.gltfCockpitGroup.visible, false);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('should verify optimized 3D GLB models (balanced & lite) and Draco decoder assets exist in public/', () => {
    const dracoPath = path.resolve(process.cwd(), 'public/models/b737-cockpit-draco.glb');
    const mediumPath = path.resolve(process.cwd(), 'public/models/b737-cockpit-medium.glb');
    assert.ok(fs.existsSync(dracoPath), 'Optimized Draco lite GLB model must exist in public/models/');
    assert.ok(fs.existsSync(mediumPath), 'Balanced medium GLB model must exist in public/models/');
    const dracoStats = fs.statSync(dracoPath);
    const mediumStats = fs.statSync(mediumPath);
    assert.ok(dracoStats.size > 1024 * 1024 && dracoStats.size < 5 * 1024 * 1024);
    assert.ok(mediumStats.size > 1024 * 1024 && mediumStats.size < 6 * 1024 * 1024);

    const dracoFiles = ['draco_decoder.wasm', 'draco_decoder.js', 'draco_wasm_wrapper.js'];
    for (const df of dracoFiles) {
      const dfPath = path.resolve(process.cwd(), 'public/draco/gltf', df);
      assert.ok(fs.existsSync(dfPath), `Draco decoder file ${df} must exist in public/draco/gltf/`);
    }
  });
});
