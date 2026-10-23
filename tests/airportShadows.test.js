import { describe, it } from 'node:test';
import assert from 'node:assert';
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
      width: 256,
      height: 256
    })
  };
}

import { Airport } from '../src/environment/Airport.js';
import { LuklaAirport } from '../src/environment/LuklaAirport.js';
import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';

describe('Airport & Aircraft Runway Shadow System', () => {
  it('should verify Coastal Airport runway, taxiways, apron, and markings receive shadows', () => {
    const airport = new Airport();
    let rwyMesh = null;
    let taxiMesh = null;
    let apronMesh = null;
    let markingsReceived = 0;
    let totalMarkings = 0;

    airport.group.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry instanceof THREE.PlaneGeometry) {
          const { width, height } = child.geometry.parameters;
          if (width === 3200 && height === 60) {
            rwyMesh = child;
          } else if (width === 3200 && height === 25) {
            taxiMesh = child;
          } else if (width === 1400 && height === 180) {
            apronMesh = child;
          }
        }
        if (child.material?.depthWrite === false && child.material?.polygonOffset) {
          totalMarkings++;
          if (child.receiveShadow) markingsReceived++;
        }
      }
    });

    assert.ok(rwyMesh, 'Runway mesh must exist');
    assert.strictEqual(rwyMesh.receiveShadow, true, 'Runway mesh must receive shadows for takeoff and landing');

    assert.ok(taxiMesh, 'Taxiway mesh must exist');
    assert.strictEqual(taxiMesh.receiveShadow, true, 'Taxiway mesh must receive shadows');

    assert.ok(apronMesh, 'Apron mesh must exist');
    assert.strictEqual(apronMesh.receiveShadow, true, 'Apron mesh must receive shadows');

    assert.ok(totalMarkings > 10, 'Runway markings must exist');
    assert.strictEqual(markingsReceived, totalMarkings, 'All runway markings must receive shadows');
  });

  it('should verify Coastal Airport control tower and terminal concourse cast and receive shadows', () => {
    const airport = new Airport();
    let towerMeshes = 0;
    let terminalMeshes = 0;

    airport.towerGroup.traverse((child) => {
      if (child.isMesh && child.castShadow && child.receiveShadow) towerMeshes++;
    });

    airport.group.traverse((child) => {
      if (child.isMesh && child.geometry instanceof THREE.BoxGeometry) {
        const { width, height, depth } = child.geometry.parameters;
        if (width === 350 && height === 18 && depth === 70) {
          terminalMeshes++;
          assert.strictEqual(child.castShadow, true, 'Terminal concourse must cast shadows');
          assert.strictEqual(child.receiveShadow, true, 'Terminal concourse must receive shadows');
        }
      }
    });

    assert.ok(towerMeshes >= 2, 'Control tower shaft and roof must cast and receive shadows');
    assert.strictEqual(terminalMeshes, 1, 'Terminal concourse must exist and have shadow properties');
  });

  it('should verify Lukla Airport runway markings receive shadows without depth buffer occlusion', () => {
    const luklaAirport = new LuklaAirport();
    let rwyMesh = null;
    let markMesh = null;

    luklaAirport.group.traverse((child) => {
      if (child.isMesh && child.geometry instanceof THREE.PlaneGeometry) {
        const { width, height } = child.geometry.parameters;
        if (width === 30 && height === 527) {
          if (child.material?.map) {
            markMesh = child;
          } else {
            rwyMesh = child;
          }
        }
      }
    });

    assert.ok(rwyMesh, 'Lukla runway mesh must exist');
    assert.strictEqual(rwyMesh.receiveShadow, true, 'Lukla runway must receive shadows');

    assert.ok(markMesh, 'Lukla runway markings mesh must exist');
    assert.notStrictEqual(markMesh.geometry, rwyMesh.geometry,
      'Pavement tiling must not change the shared marking overlay');
    const markingUVs = markMesh.geometry.getAttribute('uv');
    for (let i = 0; i < markingUVs.count; i++) {
      assert.ok(markingUVs.getX(i) >= 0 && markingUVs.getX(i) <= 1);
      assert.ok(markingUVs.getY(i) >= 0 && markingUVs.getY(i) <= 1);
    }
    assert.strictEqual(markMesh.receiveShadow, true, 'Lukla runway markings must receive shadows');
    assert.strictEqual(markMesh.material.depthWrite, false, 'Markings must not write depth to avoid transparent z-fighting');
    assert.ok(markMesh.material instanceof THREE.MeshStandardMaterial, 'Markings must use MeshStandardMaterial to respond to light/shadow');
  });

  it('should cast shadows in cockpit view via airframe shadow proxy while preserving gltfGroup.visible = false', (t) => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    // Verify procedural shadow casting
    let procCasters = 0;
    aircraft.group.traverse((child) => {
      if (child.isMesh && child.castShadow) procCasters++;
    });
    assert.ok(procCasters >= 5, 'Procedural components must cast shadows');

    // Simulate async GLTF airframe load
    let completeLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, onLoad) => { completeLoad = onLoad; });
    const previousWindow = globalThis.window;
    globalThis.window = {};

    try {
      aircraft.loadGltfModel('/test.glb');

      // Create a mock GLTF scene with B737 airframe mesh
      const scene = new THREE.Group();
      const b737Mesh = new THREE.Mesh(new THREE.BoxGeometry(36, 10, 39), new THREE.MeshStandardMaterial());
      b737Mesh.name = 'B737';
      scene.add(b737Mesh);

      completeLoad({ scene });
      assert.strictEqual(aircraft.useGltf, true);
      assert.ok(aircraft.gltfShadowProxy, 'Airframe shadow proxy must be created when GLTF loads');
      assert.strictEqual(aircraft.gltfShadowProxy.castShadow, true, 'Shadow proxy must cast shadows');
      assert.strictEqual(aircraft.gltfShadowProxy.material.colorWrite, false, 'Shadow proxy must be invisible to camera');
      assert.strictEqual(aircraft.gltfShadowProxy.material.depthWrite, false, 'Shadow proxy must not write main depth');

      // 1. Cockpit view: gltfGroup is hidden, shadow proxy is active
      aircraft.setCockpitMode(true);
      assert.strictEqual(aircraft.gltfGroup.visible, false, 'gltfGroup must remain hidden in cockpit view for test contract');
      assert.strictEqual(aircraft.gltfShadowProxy.visible, true, 'Airframe shadow proxy must be active in cockpit view');

      // 2. Exterior view: gltfGroup is visible, shadow proxy is inactive
      aircraft.setCockpitMode(false);
      assert.strictEqual(aircraft.gltfGroup.visible, true, 'gltfGroup must be visible in exterior view');
      assert.strictEqual(aircraft.gltfShadowProxy.visible, false, 'Airframe shadow proxy must be inactive in exterior view');

      // 3. Crash geometry and its shadow remain aligned with physical contacts
      aircraft.triggerCrashVisuals('RUNWAY');
      assert.strictEqual(aircraft.gltfShadowProxy.rotation.z, 0, 'Shadow proxy must retain the physical attitude');
      aircraft.resetCrashVisuals();
      assert.strictEqual(aircraft.gltfShadowProxy.rotation.z, 0, 'Shadow proxy rotation must reset');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });
});
