import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFile } from 'node:fs/promises';

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
import { getAirportOverride } from '../src/config/airportOverrides.js';
import { buildExternalRunwayDescriptors, createExternalAirportMesh, EXTERNAL_MESH_LIFT_M, MARKING_LIFT_M } from '../src/geospatial/externalAirportSurface.js';
import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';

function createVnlkRunwayMesh() {
  const overrides = getAirportOverride('VNLK');
  const runwayOverride = overrides.runways[0];
  // Use the indexed ARP, not a runway end, so the runway keeps its declared facilities frame.
  const airport = {
    ident: 'VNLK',
    latitude: 27.686768,
    longitude: 86.729479,
    elevationM: overrides.elevationM,
    runways: [{
      id: '06/24',
      surface: 'ASP',
      widthM: runwayOverride.widthM,
      lengthM: runwayOverride.lengthM,
      ends: runwayOverride.ends,
    }],
  };
  return createExternalAirportMesh(buildExternalRunwayDescriptors(airport, overrides));
}

function ribbonSpan(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const point = (index) => new THREE.Vector3().fromBufferAttribute(position, index);
  const start = point(0).add(point(1)).multiplyScalar(0.5);
  const end = point(2).add(point(3)).multiplyScalar(0.5);
  return { width: point(0).distanceTo(point(1)), length: Math.hypot(end.x - start.x, end.z - start.z) };
}

function minimumY(mesh) {
  const position = mesh.geometry.getAttribute('position');
  let minimum = Infinity;
  for (let i = 0; i < position.count; i++) minimum = Math.min(minimum, position.getY(i));
  return minimum;
}

class KitAirport extends Airport {
  loadBuildings() { return Promise.resolve(false); }
}

describe('Airport & Aircraft Runway Shadow System', () => {
  it('should verify Coastal Airport runway, taxiways, apron, and markings receive shadows', () => {
    const airport = new KitAirport();
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

  it('should verify Coastal Airport GLB tower and terminal cast and receive shadows', async () => {
    const bytes = await readFile(new URL('../public/models/airport/airport-kit.glb', import.meta.url));
    const kit = (await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''
    )).scene;
    const airport = new KitAirport();
    assert.equal(await Airport.prototype.loadBuildings.call(airport, async () => kit), true);

    let towerMeshes = 0;
    airport.towerGroup.traverse(child => {
      if (child.isMesh && child.castShadow && child.receiveShadow) towerMeshes++;
    });
    assert.ok(towerMeshes >= 2, 'GLB control tower meshes must cast and receive shadows');

    const terminalLods = airport.buildings.lods.filter(lod => lod.name === 'TerminalBay');
    assert.equal(terminalLods.length, 7);
    let terminalMeshes = 0;
    for (const lod of terminalLods) lod.traverse(child => {
      if (child.isMesh && child.castShadow && child.receiveShadow) terminalMeshes++;
    });
    assert.ok(terminalMeshes > 0, 'GLB terminal bays must cast and receive shadows');
    assert.equal(airport.beaconLights.length, 1);
  });

  it('should verify VNLK runway markings receive shadows with ordered depth tiers', () => {
    const group = createVnlkRunwayMesh();
    const rwyMesh = group.children.find(child => child.userData?.runwayId && !child.userData?.kind);
    const markMesh = group.children.find(child => child.userData?.kind === 'markings');

    assert.ok(rwyMesh, 'VNLK runway ribbon must exist');
    const span = ribbonSpan(rwyMesh);
    assert.ok(Math.abs(span.width - 30) < 0.01, 'VNLK runway must remain 30 m wide');
    assert.ok(Math.abs(span.length - 527) < 0.1, 'VNLK runway must remain 527 m long');
    assert.strictEqual(rwyMesh.receiveShadow, true, 'VNLK runway must receive shadows');
    assert.strictEqual(rwyMesh.material.metalness, 0);
    assert.strictEqual(rwyMesh.material.map, null);
    assert.strictEqual(rwyMesh.material.color.getHex(), 0x4b4b4b, 'asphalt surface colour');
    assert.ok(rwyMesh.material.polygonOffsetFactor < 0, 'runway surface must keep a negative polygon offset');
    assert.equal(rwyMesh.material.userData.logDepthOffsetUnits, 1);

    assert.ok(markMesh, 'VNLK runway markings mesh must exist');
    assert.notStrictEqual(markMesh.geometry, rwyMesh.geometry,
      'Pavement tiling must not change the shared marking overlay');
    assert.ok(Math.abs((minimumY(markMesh) - minimumY(rwyMesh)) - MARKING_LIFT_M) < 1e-4,
      'markings must stay 50 mm above the ribbon');
    assert.ok(Math.abs(minimumY(rwyMesh) - (2805 + EXTERNAL_MESH_LIFT_M)) < 1e-3,
      'runway ribbon must keep the 15 mm surface lift');
    assert.strictEqual(markMesh.receiveShadow, true, 'VNLK runway markings must receive shadows');
    assert.strictEqual(markMesh.material.color.getHex(), 0xf0f0e8, 'white marking colour');
    assert.strictEqual(markMesh.material.metalness, 0);
    assert.strictEqual(markMesh.material.polygonOffset, true);
    assert.equal(markMesh.material.polygonOffsetFactor, -2, 'markings use the second logarithmic depth tier');
    assert.equal(markMesh.material.userData.logDepthOffsetUnits, 2);
    assert.ok(markMesh.material instanceof THREE.MeshStandardMaterial, 'Markings must use MeshStandardMaterial to respond to light/shadow');
  });

  it('should cast shadows in cockpit view via airframe shadow proxy while preserving gltfGroup.visible = false', (t) => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    // Intrinsic gear is the only procedural shadow caster before the GLB arrives.
    let gearCasters = 0;
    aircraft.gearGroup.traverse(child => {
      if (child.isMesh && child.castShadow) gearCasters++;
    });
    assert.ok(gearCasters >= 5, 'Procedural gear must cast shadows');

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
