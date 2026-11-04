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
      width: 64,
      height: 64
    })
  };
}

import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { applyJejuAirLivery } from '../src/aircraft/JejuAirLivery.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';

describe('Jeju Air Livery & Aircraft Customization', () => {
  it('should initialize Boeing737 with Jeju Air as default livery and signature orange procedural accent', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    assert.strictEqual(aircraft.livery, 'jeju', 'Default livery must be jeju');

    // Fin and rudder procedural fallback should use Jeju orange (#f47920 = 0xf47920)
    assert.ok(aircraft.rudder, 'Procedural rudder must exist');
    assert.strictEqual(
      aircraft.rudder.material.color.getHex(),
      0xf47920,
      'Procedural rudder must have Jeju Air orange color'
    );
  });

  it('should allow initializing Boeing737 with custom livery option', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas, null, null, null, { livery: 'korean' });

    assert.strictEqual(aircraft.livery, 'korean');
    assert.strictEqual(
      aircraft.rudder.material.color.getHex(),
      0x003366,
      'Procedural rudder for Korean Air must have classic blue color'
    );
  });

  it('should apply Jeju Air shader overrides, decals and userData.airline to airframe', () => {
    const root = new THREE.Group();
    const container = new THREE.Group();
    const model = new THREE.Group();

    const airframeGeo = new THREE.BoxGeometry(4, 4, 30);
    const airframeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const airframe = new THREE.Mesh(airframeGeo, airframeMat);
    airframe.name = 'B737';
    model.add(airframe);
    root.add(model);
    root.add(container);

    applyJejuAirLivery(model, root, container);

    assert.strictEqual(root.userData.airline, 'Jeju Air');
    assert.strictEqual(airframe.material.customProgramCacheKey(), 'jeju-air-v1');

    const decalGroup = container.getObjectByName('JejuAirLivery');
    assert.ok(decalGroup, 'JejuAirLivery decal group must be added to container');
    assert.strictEqual(decalGroup.children.length, 4, 'Must project 2 titles and 2 tail emblems');

    const names = decalGroup.children.map(c => c.name);
    assert.ok(names.includes('JejuAir-title--1'));
    assert.ok(names.includes('JejuAir-title-1'));
    assert.ok(names.includes('JejuAir-tail--1'));
    assert.ok(names.includes('JejuAir-tail-1'));
  });

  it('should dynamically switch between liveries using setLivery', (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));

    let completeLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, onLoad) => { completeLoad = onLoad; });
    const previousWindow = globalThis.window;
    globalThis.window = {};

    try {
      aircraft.loadGltfModel('/test.glb');
      const fakeScene = new THREE.Group();
      const airframe = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 30), new THREE.MeshStandardMaterial());
      airframe.name = 'B737';
      fakeScene.add(airframe);
      completeLoad({ scene: fakeScene });

      assert.strictEqual(aircraft.group.userData.airline, 'Jeju Air');
      assert.ok(aircraft.gltfGroup.getObjectByName('JejuAirLivery'));
      assert.strictEqual(aircraft.gltfGroup.getObjectByName('KoreanAirLivery'), undefined);

      // Switch to Korean Air
      aircraft.setLivery('korean');
      assert.strictEqual(aircraft.group.userData.airline, 'Korean Air');
      assert.ok(aircraft.gltfGroup.getObjectByName('KoreanAirLivery'));
      assert.strictEqual(aircraft.gltfGroup.getObjectByName('JejuAirLivery'), undefined);

      // Switch back to Jeju Air
      aircraft.setLivery('jeju');
      assert.strictEqual(aircraft.group.userData.airline, 'Jeju Air');
      assert.ok(aircraft.gltfGroup.getObjectByName('JejuAirLivery'));
      assert.strictEqual(aircraft.gltfGroup.getObjectByName('KoreanAirLivery'), undefined);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });
});
