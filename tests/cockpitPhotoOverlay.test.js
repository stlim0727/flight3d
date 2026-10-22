import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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

import { CockpitPhotoOverlay } from '../src/aircraft/CockpitPhotoOverlay.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';
import { ISFDCanvas } from '../src/aircraft/ISFDCanvas.js';

describe('CockpitPhotoOverlay & Photorealistic 2D Cockpit System', () => {
  it('should initialize CockpitPhotoOverlay with dedicated scene and orthographic camera', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const isfd = new ISFDCanvas(128, 128);

    const overlay = new CockpitPhotoOverlay(pfd, nd, eicas, isfd);

    assert.ok(overlay.scene instanceof THREE.Scene, 'Overlay must have its own THREE.Scene');
    assert.ok(overlay.camera instanceof THREE.OrthographicCamera, 'Overlay must use OrthographicCamera');
    assert.strictEqual(overlay.enabled, true, 'Overlay should default to enabled');
    assert.ok(overlay.panelMesh instanceof THREE.Mesh, 'Photo panel mesh must exist');
    assert.strictEqual(overlay.panelMesh.name, 'Cockpit_Photo_Panel');
  });

  it('should construct live display screen quads with renderOrder 1 and panel overlay with renderOrder 2', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const isfd = new ISFDCanvas(128, 128);

    const overlay = new CockpitPhotoOverlay(pfd, nd, eicas, isfd);

    // Verify display screen meshes
    assert.ok(overlay.pfdMesh instanceof THREE.Mesh, 'PFD screen quad must exist');
    assert.ok(overlay.ndMesh instanceof THREE.Mesh, 'ND screen quad must exist');
    assert.ok(overlay.isfdMesh instanceof THREE.Mesh, 'ISFD screen quad must exist');
    assert.ok(overlay.eicasMesh instanceof THREE.Mesh, 'EICAS screen quad must exist');

    assert.strictEqual(overlay.pfdMesh.renderOrder, 1, 'PFD must render behind photo bezel');
    assert.strictEqual(overlay.ndMesh.renderOrder, 1, 'ND must render behind photo bezel');
    assert.strictEqual(overlay.isfdMesh.renderOrder, 1, 'ISFD must render behind photo bezel');
    assert.strictEqual(overlay.eicasMesh.renderOrder, 1, 'EICAS must render behind photo bezel');
    assert.strictEqual(overlay.panelMesh.renderOrder, 2, 'Photo panel bezel overlay must render on top');

    // Panel material must be transparent to allow windshield & screen cutouts to show through
    assert.strictEqual(overlay.panelMesh.material.transparent, true);
    assert.strictEqual(overlay.panelMesh.material.depthTest, false);
  });

  it('should position all display screen quads within valid orthographic boundaries', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const isfd = new ISFDCanvas(128, 128);

    const overlay = new CockpitPhotoOverlay(pfd, nd, eicas, isfd);
    const aspect = overlay.panelAspect;

    const screens = [overlay.pfdMesh, overlay.ndMesh, overlay.isfdMesh, overlay.eicasMesh];
    for (const s of screens) {
      assert.ok(s.position.x >= -aspect && s.position.x <= aspect, `X position ${s.position.x} must be within [-${aspect}, ${aspect}]`);
      assert.ok(s.position.y >= -1.0 && s.position.y <= 1.0, `Y position ${s.position.y} must be within [-1, 1]`);
    }

    // Screens should be arranged horizontally from left to right: PFD < ND < ISFD < EICAS
    assert.ok(overlay.pfdMesh.position.x < overlay.ndMesh.position.x, 'PFD should be to the left of ND');
    assert.ok(overlay.ndMesh.position.x < overlay.isfdMesh.position.x, 'ND should be to the left of ISFD');
    assert.ok(overlay.isfdMesh.position.x < overlay.eicasMesh.position.x, 'ISFD should be to the left of EICAS');
  });

  it('should adjust camera bounds and group scaling on viewport resize', () => {
    const overlay = new CockpitPhotoOverlay();

    // 16:9 standard screen
    overlay.onResize(1920, 1080);
    assert.strictEqual(overlay.camera.top, 1.0);
    assert.strictEqual(overlay.camera.bottom, -1.0);
    assert.ok(Math.abs(overlay.camera.right - 1920 / 1080) < 0.001);

    // 21:9 ultrawide screen
    overlay.onResize(2560, 1080);
    assert.ok(overlay.group.scale.x > 1.0, 'Group scale should expand to cover ultrawide');

    // 4:3 screen
    overlay.onResize(1024, 768);
    assert.ok(overlay.group.scale.x >= 1.0);
  });

  it('should safely execute update and render without throwing errors', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const overlay = new CockpitPhotoOverlay(pfd, nd, eicas);

    overlay.update({ iasKnots: 140, pitchDeg: 3.2, rollDeg: -1.5 });

    let renderedScene = null;
    let renderedCamera = null;
    let clearDepthCalled = false;

    const mockRenderer = {
      autoClear: true,
      clearDepth: () => { clearDepthCalled = true; },
      render: (scene, camera) => {
        renderedScene = scene;
        renderedCamera = camera;
      }
    };

    overlay.render(mockRenderer);
    assert.strictEqual(clearDepthCalled, true, 'clearDepth must be called');
    assert.strictEqual(renderedScene, overlay.scene);
    assert.strictEqual(renderedCamera, overlay.camera);
    assert.strictEqual(mockRenderer.autoClear, true, 'autoClear must be restored');

    // Test disabled state
    overlay.enabled = false;
    clearDepthCalled = false;
    overlay.render(mockRenderer);
    assert.strictEqual(clearDepthCalled, false, 'render should not execute when disabled');
  });

  it('should integrate seamlessly with CameraSystem photoCockpit toggle', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const camSys = new CameraSystem(camera, null);
    camSys.setMode(CameraSystem.MODES.COCKPIT, true);

    assert.strictEqual(camSys.photoCockpit, false, 'CameraSystem must default to photoCockpit=false (3D Virtual Cockpit)');
    assert.strictEqual(camSys.getModeName(), 'COCKPIT (CAPTAIN)');
    assert.strictEqual(camSys.getCockpitSubmodeName(), '3D VIRTUAL');

    camSys.toggleCockpitPhoto();
    assert.strictEqual(camSys.photoCockpit, true);
    assert.strictEqual(camSys.getCockpitSubmodeName(), 'PHOTO 2D');

    camSys.toggleCockpitPhoto();
    assert.strictEqual(camSys.photoCockpit, false);
    assert.strictEqual(camSys.getCockpitSubmodeName(), '3D VIRTUAL');

    // Verify camera update alignment in photoCockpit mode
    const aircraftMesh = new THREE.Mesh();
    camSys.update(0.016, aircraftMesh, { onGround: true, pitchDeg: 0, rollDeg: 0 });

    assert.ok(camera.position.x < -0.3, 'Eye position should be Captain seat (negative X)');
    assert.ok(camera.position.y > 0.8, 'Eye height should be Captain eye level');
  });
});
