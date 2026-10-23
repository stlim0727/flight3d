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
  it('should initialize Boeing737 with GLTF container and fallback procedural geometry', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    assert.ok(aircraft.group instanceof THREE.Group, 'Aircraft root must be a THREE.Group');
    assert.ok(aircraft.gltfGroup instanceof THREE.Group, 'GLTF container must exist');
    assert.strictEqual(aircraft.gltfGroup.name, 'GLTF_Boeing737');
    assert.strictEqual(aircraft.useGltf, false, 'Default should be procedural fallback before async GLB load');
    assert.ok(aircraft.fuselageGroup, 'Procedural fuselage group must exist as fallback');
  });

  it('should preserve setCockpitMode contract across both GLTF and procedural modes', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    // Procedural mode: enter cockpit
    aircraft.setCockpitMode(true);
    assert.strictEqual(aircraft.fuselageGroup.visible, false, 'Procedural fuselage must be hidden in cockpit view');
    assert.strictEqual(aircraft.cockpit.group.visible, true, 'Cockpit instruments must be visible in cockpit view');

    // Procedural mode: exit cockpit (chase view)
    aircraft.setCockpitMode(false);
    assert.strictEqual(aircraft.fuselageGroup.visible, true, 'Procedural fuselage must be visible in exterior view');
    assert.strictEqual(aircraft.tailGroup.visible, true, 'Procedural tail must be visible in exterior view');
    assert.strictEqual(aircraft.empennageGroup.visible, true, 'empennageGroup must match tailGroup visibility');
    assert.strictEqual(aircraft.cockpit.group.visible, false, 'Cockpit interior must be hidden in exterior view');

    // Simulate GLTF loaded state
    aircraft.useGltf = true;
    aircraft.setCockpitMode(true);
    assert.strictEqual(aircraft.gltfGroup.visible, false, 'GLTF model must be hidden in cockpit view');
    assert.strictEqual(aircraft.cockpit.group.visible, true, 'Cockpit must be visible in cockpit view');

    aircraft.setCockpitMode(false);
    assert.strictEqual(aircraft.gltfGroup.visible, true, 'GLTF model must be visible in exterior view');
    assert.strictEqual(aircraft.cockpit.group.visible, false, 'Cockpit must be hidden in exterior view');
  });

  it('should hide the procedural tail when the asynchronous model loads in cockpit view', (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));
    assert.strictEqual(aircraft.tailGroup, aircraft.empennageGroup);
    assert.strictEqual(aircraft.tailGroup.visible, true);

    let completeLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, onLoad) => { completeLoad = onLoad; });
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      aircraft.loadGltfModel('/test.glb');
      aircraft.setCockpitMode(true);
      completeLoad({ scene: new THREE.Group() });
      assert.strictEqual(aircraft.modelLoaded, true);
      assert.strictEqual(aircraft.gltfGroup.visible, false, 'Late model load must preserve cockpit view');
      assert.strictEqual(aircraft.tailGroup.visible, false);
      aircraft.setCockpitMode(false);
      assert.strictEqual(aircraft.gltfGroup.visible, true);
      assert.strictEqual(aircraft.tailGroup.visible, false, 'Exterior transitions must not restore the procedural tail');
      aircraft.setCockpitMode(true);
      assert.strictEqual(aircraft.gltfGroup.visible, false);
      assert.strictEqual(aircraft.tailGroup.visible, false);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('should suppress procedural exterior during GLTF load to prevent popping, and restore on failure', (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));
    assert.strictEqual(aircraft.fuselageGroup.visible, true);

    let failLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, _onLoad, _onProgress, onError) => { failLoad = onError; });
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      aircraft.loadGltfModel('/missing.glb');
      assert.strictEqual(aircraft.loadingGltf, true);
      assert.strictEqual(aircraft.fuselageGroup.visible, false, 'Procedural fuselage must be hidden while loading GLTF');
      assert.strictEqual(aircraft.tailGroup.visible, false, 'Procedural tail must be hidden while loading GLTF');

      // Trigger error fallback
      failLoad(new Error('Network error'));
      assert.strictEqual(aircraft.loadingGltf, false);
      assert.strictEqual(aircraft.useGltf, false);
      assert.strictEqual(aircraft.fuselageGroup.visible, true, 'Procedural fuselage must be restored on load failure');
      assert.strictEqual(aircraft.tailGroup.visible, true, 'Procedural tail must be restored on load failure');
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

    const wingRotations = aircraft.wingGroup.children.map(wing => wing.quaternion.toArray());
    aircraft.triggerCrashVisuals('TERRAIN');
    assert.strictEqual(aircraft.isCrashed, true);
    assert.strictEqual(aircraft.gltfGroup.rotation.z, 0, 'GLTF group must not rotate through the ground');

    assert.deepStrictEqual(aircraft.wingGroup.children.map(wing => wing.quaternion.toArray()), wingRotations, 'Fallback surfaces retain their physical attitude');
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

  it('should align procedural fallback turbofan mounts and pylons with collision probes and wing', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    assert.ok(aircraft.enginesGroup, 'enginesGroup must exist');
    assert.strictEqual(aircraft.enginesGroup.children.length, 2, 'Must have left and right engines');

    const [leftEng, rightEng] = aircraft.enginesGroup.children;
    // Probe coordinates in CollisionDetector: (±5.06, -1.95, -5.22)
    assert.strictEqual(leftEng.position.x, -5.06, 'Left engine mount X must match CFM56 collision probe');
    assert.strictEqual(leftEng.position.y, -1.95, 'Left engine mount Y must match CFM56 collision probe');
    assert.strictEqual(leftEng.position.z, -5.22, 'Left engine mount Z must match CFM56 collision probe');

    assert.strictEqual(rightEng.position.x, 5.06, 'Right engine mount X must match CFM56 collision probe');
    assert.strictEqual(rightEng.position.y, -1.95, 'Right engine mount Y must match CFM56 collision probe');
    assert.strictEqual(rightEng.position.z, -5.22, 'Right engine mount Z must match CFM56 collision probe');

    // Pylon geometry & span
    const pylon = leftEng.children[0];
    assert.ok(pylon, 'Engine pylon mesh must exist');
    const pylonGeo = pylon.geometry;
    const depth = pylonGeo.parameters.depth; // length along Z
    const height = pylonGeo.parameters.height; // height along Y

    // Aircraft local coordinates of pylon rear and top
    const rearZ = leftEng.position.z + pylon.position.z + depth / 2;
    const frontZ = leftEng.position.z + pylon.position.z - depth / 2;
    const topY = leftEng.position.y + pylon.position.y + height / 2;
    const bottomY = leftEng.position.y + pylon.position.y - height / 2;

    // Wing leading edge at x=5.06 is at z ≈ -2.71, cowl top is at y = -0.90
    assert.ok(frontZ <= -5.8, `Pylon front (${frontZ}) must rest forward over engine cowl`);
    assert.ok(rearZ >= -2.0, `Pylon rear (${rearZ}) must connect securely into wing leading edge without a gap`);
    assert.ok(topY >= 0.0, `Pylon top (${topY}) must penetrate into wing chord`);
    assert.ok(bottomY <= -1.2, `Pylon bottom (${bottomY}) must seat firmly in nacelle core`);
  });
});

