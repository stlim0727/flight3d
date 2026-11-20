import { describe, it } from 'node:test';
import assert from 'node:assert';
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

import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';

describe('Boeing737 PBR Model & IBL Reflection System', () => {
  it('should initialize with an empty GLTF container and intrinsic gear and lights', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    assert.ok(aircraft.group instanceof THREE.Group, 'Aircraft root must be a THREE.Group');
    assert.ok(aircraft.gltfGroup instanceof THREE.Group, 'GLTF container must exist');
    assert.strictEqual(aircraft.gltfGroup.name, 'GLTF_Boeing737');
    assert.strictEqual(aircraft.modelLoaded, false, 'GLB has not loaded yet');
    assert.ok(aircraft.gearGroup, 'Intrinsic landing gear must exist before the GLB arrives');
    assert.ok(aircraft.lightsGroup, 'Aircraft lights must stay attached to the root group');
    assert.strictEqual(aircraft.fuselageGroup, undefined, 'No procedural exterior may exist');
  });

  it('should preserve the GLTF exterior and cockpit visibility contract', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    aircraft.setCockpitMode(true);
    assert.strictEqual(aircraft.gltfGroup.visible, false, 'GLTF exterior must be hidden in cockpit view');
    assert.strictEqual(aircraft.cockpit.group.visible, true, 'Cockpit instruments must be visible in cockpit view');

    aircraft.setCockpitMode(false);
    assert.strictEqual(aircraft.gltfGroup.visible, true, 'GLTF exterior must be visible in chase view');
    assert.strictEqual(aircraft.cockpit.group.visible, false, 'Cockpit interior must be hidden in exterior view');
  });

  it('scopes airframe-only lamps out of the compiled light set in cockpit view', () => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));
    const lamps = [...aircraft.navLights, ...aircraft.strobeLights];
    assert.equal(lamps.length, 6, 'Three navigation and three strobe lamps are airframe-only');
    assert.ok(lamps.every(light => light.visible), 'Exterior view must keep every lamp compiled');

    aircraft.setCockpitMode(true);
    assert.ok(lamps.every(light => !light.visible), 'Cockpit view must drop the lamps that shade nothing');
    assert.ok([...aircraft.beaconLights, ...aircraft.landingLights].every(light => light.visible),
      'Beacons and landing lights reach visible surfaces and must stay');

    aircraft.setCockpitMode(false);
    assert.ok(lamps.every(light => light.visible), 'Returning outside must restore every lamp');

    // Crash recovery restores the lamp group, so per-lamp scoping must survive it.
    aircraft.setCockpitMode(true);
    aircraft.triggerCrashVisuals('gear');
    aircraft.resetCrashVisuals();
    assert.ok(lamps.every(light => !light.visible), 'Crash recovery must not undo cockpit scoping');
    assert.ok(aircraft.lightsGroup.visible, 'The lamp group keeps following the master switch');
  });


  it('binds GLTF engine turbine fans and animates rotation based on engine1 and engine2 N1', (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));

    let completeLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, onLoad) => { completeLoad = onLoad; });
    const previousWindow = globalThis.window;
    globalThis.window = {};

    try {
      aircraft.loadGltfModel('/test.glb');
      const scene = new THREE.Group();
      const turbs = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      turbs.name = 'turbs';
      const tur01 = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      tur01.name = 'tur_01';
      scene.add(turbs, tur01);

      completeLoad({ scene });

      assert.strictEqual(aircraft.gltfFanL, turbs, 'turbs should bind as left engine fan');
      assert.strictEqual(aircraft.gltfFanR, tur01, 'tur_01 should bind as right engine fan');
      assert.strictEqual(aircraft.gltfFans.length, 2, 'gltfFans array should contain both fans');

      // Test asymmetric engine N1 values
      const dt = 0.1;
      aircraft.update(dt, {
        engine1: { n1: 80 },
        engine2: { n1: 40 }
      });

      const expectedRotL = (80 / 100.0) * 85.0 * dt;
      const expectedRotR = (40 / 100.0) * 85.0 * dt;

      assert.ok(Math.abs(aircraft.gltfFanL.rotation.x - expectedRotL) < 1e-5, 'Left fan rotates around X by expected delta');
      assert.ok(Math.abs(aircraft.gltfFanR.rotation.x - expectedRotR) < 1e-5, 'Right fan rotates around X by expected delta');
      assert.strictEqual(aircraft.gltfFanL.rotation.z, 0, 'Left fan must not rotate around Z to avoid out-of-plane wobble');
      assert.strictEqual(aircraft.gltfFanR.rotation.z, 0, 'Right fan must not rotate around Z to avoid out-of-plane wobble');

    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('reports a failed GLB load without revealing any exterior', async (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));
    let failLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, _onLoad, _onProgress, onError) => { failLoad = onError; });
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      aircraft.loadGltfModel('/missing.glb');
      assert.strictEqual(aircraft.loadingGltf, true);
      failLoad(new Error('Network error'));
      await aircraft.ready;
      assert.strictEqual(aircraft.loadingGltf, false);
      assert.strictEqual(aircraft.modelLoaded, false);
      assert.strictEqual(aircraft.gltfGroup.children.length, 0, 'No fallback exterior may appear on load failure');
      assert.ok(errors.some(args => String(args[0]).includes('GLB model failed')), 'The load error must be reported');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('keeps crash geometry aligned with physical contacts and restores state', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    aircraft.triggerCrashVisuals('TERRAIN');
    assert.strictEqual(aircraft.isCrashed, true);
    assert.strictEqual(aircraft.gltfGroup.rotation.z, 0, 'GLTF group must not rotate through the ground');

    aircraft.resetCrashVisuals();
    assert.strictEqual(aircraft.isCrashed, false);
    assert.strictEqual(aircraft.gltfGroup.rotation.z, 0, 'GLTF group rotation should reset to 0');
  });

  it('shows independent gear failures and restores articulation and indications after repair', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);
    aircraft.update(1 / 60, { gearState: 1 });
    const normalAngle = aircraft.mainGearLGroup.rotation.z;
    const state = { gearState: 1, gearDamage: { nose: 'damaged', mainLeft: 'collapsed', mainRight: 'normal' } };
    aircraft.update(1 / 60, state);
    const failedAngle = aircraft.mainGearLGroup.rotation.z;
    aircraft.update(1 / 60, state);
    assert.strictEqual(aircraft.mainGearLGroup.rotation.z, failedAngle, 'Damage transforms must not accumulate each frame');
    assert.ok(Math.abs(failedAngle - normalAngle) > 0.5);
    assert.strictEqual(aircraft.mainGearLGroup.scale.y, 1);
    const labels = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'fillText' ? text => labels.push(text) : () => {} });
    eicas.updateData(state);
    eicas.drawGearStatus(ctx, 0, 0, 140, 110);
    assert.deepStrictEqual(labels, ['LANDING GEAR', 'DMG', 'FAIL', 'DOWN']);
    labels.length = 0;
    eicas.updateData({ gearState: 1 });
    eicas.drawGearStatus(ctx, 0, 0, 140, 110);
    assert.deepStrictEqual(labels, ['LANDING GEAR', 'DOWN', 'DOWN', 'DOWN']);
    aircraft.update(1 / 60, { gearState: 1 });
    assert.strictEqual(aircraft.mainGearLGroup.scale.y, 1);
    assert.strictEqual(aircraft.mainGearLGroup.rotation.z, normalAngle);
  });

  it('should verify 3D assets exist in public/ and remain well within memory budget (< 15MB)', () => {
    const modelPath = path.resolve(process.cwd(), 'public/models/b737-800.glb');
    const hdrPath = path.resolve(process.cwd(), 'public/textures/environment/sky_1k.hdr');

    assert.ok(fs.existsSync(modelPath), 'public/models/b737-800.glb must exist');
    assert.ok(fs.existsSync(hdrPath), 'public/textures/environment/sky_1k.hdr must exist');

    const modelStats = fs.statSync(modelPath);
    const hdrStats = fs.statSync(hdrPath);
    const totalBytes = modelStats.size + hdrStats.size;

    assert.ok(modelStats.size > 100 * 1024, 'GLB model must be at least 100KB');
    assert.ok(modelStats.size < 10 * 1024 * 1024, 'GLB model must be under 10MB budget');
    assert.ok(totalBytes < 15 * 1024 * 1024, 'Total assets must be well under 15MB budget');
  });

  it('should verify CREDITS.md documents CC BY 4.0 and CC0 licenses', () => {
    const creditsPath = path.resolve(process.cwd(), 'CREDITS.md');
    assert.ok(fs.existsSync(creditsPath), 'CREDITS.md must exist');
    const content = fs.readFileSync(creditsPath, 'utf8');

    assert.ok(content.includes('amvlab/aircraft-models'), 'Must credit amvlab model repository');
    assert.ok(content.includes('CC BY 4.0'), 'Must document CC BY 4.0 license');
    assert.ok(content.includes('Poly Haven'), 'Must credit Poly Haven HDRI');
    assert.ok(content.includes('CC0'), 'Must document CC0 license');
  });

});

