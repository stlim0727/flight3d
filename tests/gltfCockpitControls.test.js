import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindGltfYokes, updateGltfYokes, bindGltfEngineControls, updateGltfEngineControls } from '../src/aircraft/GltfCockpitControls.js';
import { bindGltfAirframeControls, updateGltfAirframeControls } from '../src/aircraft/GltfCockpitControls.js';
import { batchStaticCockpit } from '../src/aircraft/StaticCockpitBatch.js';

test('nested and batched GLB yokes preserve rest geometry and follow hold/reverse/release', () => {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.position.set(0, -1.31, -11.43);
  const nested = new THREE.Group();
  nested.position.y = 1;
  model.add(nested);
  const geometry = new THREE.BufferGeometry();
  // Captain yoke, first officer yoke, and unrelated panel share one mesh.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    .29,.96,1.26, .31,.96,1.26, .30,.98,1.26,
    -.26,.96,1.26, -.24,.96,1.26, -.25,.98,1.26,
    0,.80,1.45, .02,.80,1.45, .01,.82,1.45
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array(18).fill(.5), 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  nested.add(mesh);
  const yokes = bindGltfYokes(model);
  assert.deepEqual(yokes.map(y => y.children.length), [1, 1]);
  assert.equal(mesh.geometry.attributes.position.count, 3, 'panel remains static');
  assert.equal(yokes[0].children[0].geometry.attributes.uv.count, 3);
  for (const aileron of [1, 1, -1, 0]) {
    updateGltfYokes(yokes, { aileron, elevator: aileron });
    for (const yoke of yokes) {
      assert.equal(yoke.rotation.z, aileron * Math.PI / 3);
      assert.equal(yoke.position.z, 1.265 - aileron * .045);
    }
  }
  model.updateMatrixWorld(true);
  const actual = yokes[0].children[0].localToWorld(
    new THREE.Vector3().fromBufferAttribute(yokes[0].children[0].geometry.attributes.position, 0)
  );
  const expected = model.localToWorld(new THREE.Vector3(.29, 1.96, 1.26));
  assert.ok(actual.distanceTo(expected) < 1e-6, 'neutral restores original asset placement');
});

for (const named of [true, false]) {
  test(`${named ? 'named' : 'material-batched'} airframe controls survive batching and hold/reverse/reset`, () => {
    const model = new THREE.Group();
    model.rotation.y = Math.PI;
    model.position.set(0, -1.31, -11.43);
    const material = new THREE.MeshStandardMaterial();
    const definitions = [
      ['Cylinder058_', [-.075, 1.86, 1.42]],
      ['Cylinder210_', [.0878, 1.77, 1.24]],
      ['Cylinder211_', [-.068, 1.77, 1.24]],
      ['Cube482_', [-.045, 1.84, 1.30]],
      ['Cube481_', [.070, 1.84, 1.32]],
      // A fixed panel inside a named part's bounds must not be selected.
      ['Panel', named ? [-.045, 1.84, 1.30] : [-.075, 1.86, 1.46]]
    ];
    const geometries = definitions.map(([name, point]) => {
      const geometry = new THREE.BufferGeometry();
      const [x,y,z] = point;
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        x,y,z, x+.001,y,z, x,y+.001,z
      ], 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,1,0,0,1], 2));
      return { name, geometry };
    });
    if (named) {
      for (const {name, geometry} of geometries) {
        const mesh = new THREE.Mesh(geometry, material); mesh.name = name; model.add(mesh);
      }
    } else {
      const geometry = new THREE.BufferGeometry();
      for (const attr of ['position', 'uv']) {
        geometry.setAttribute(attr, new THREE.Float32BufferAttribute(
          geometries.flatMap(({geometry: g}) => [...g.attributes[attr].array]), attr === 'uv' ? 2 : 3));
      }
      model.add(new THREE.Mesh(geometry, material));
    }
    const controls = bindGltfAirframeControls(model);
    const parts = [controls.gear, ...controls.trimWheels, controls.flaps, controls.spoilers];
    parts.forEach(part => {
      assert.equal(part.children.length, 1, `${part.name} binds actual geometry`);
      assert.strictEqual(part.children[0].material, material);
      assert.equal(part.children[0].geometry.attributes.uv.count, 3);
    });
    batchStaticCockpit(model, parts);
    assert.ok(parts.every(p => p.children.length === 1), 'static batching keeps moving parts');
    const snapshot = () => parts.map(p => [...p.position.toArray(), ...p.rotation.toArray()]);
    const neutral = snapshot();
    const deployed = {gearState: 0, flapIndex: 6, spoilers: 1, pitchTrim: 12};
    updateGltfAirframeControls(controls, deployed);
    const held = snapshot();
    for (let i=0; i<100; i++) updateGltfAirframeControls(controls, deployed);
    assert.deepEqual(snapshot(), held, 'holding cannot accumulate drift');
    assert.ok(controls.gear.position.y > neutral[0][1], 'retracted gear moves handle up');
    assert.ok(controls.flaps.rotation.x < 0, 'flaps pull aft');
    assert.ok(controls.spoilers.rotation.x < 0, 'speedbrake pulls aft');
    updateGltfAirframeControls(controls, {gearState: .5, flapIndex: 3, spoilers: .5, pitchTrim: -5});
    assert.ok(controls.trimWheels.every(p => p.rotation.x < 0), 'trim reverses');
    assert.ok(Math.abs(controls.gear.position.y - 1.9425) < 1e-12);
    updateGltfAirframeControls(controls, {});
    // Euler may preserve signed zero; compare coordinates numerically.
    snapshot().forEach((row,i) => row.slice(0,6).forEach((v,k) => assert.ok(Math.abs(v-neutral[i][k]) < 1e-12)));
    updateGltfAirframeControls(controls, {gearState: NaN, pitchTrim: Infinity});
    assert.ok(controls.trimWheels.every(p => p.rotation.x === 0));
    assert.equal(controls.gear.position.y, 1.905);
  });
}


test('batched throttles and both pedal pairs move independently and reset without drift', () => {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.position.set(4, -1.31, -11.43);
  const nested = new THREE.Group();
  nested.position.y = 1;
  model.add(nested);
  const points = [
    [-.001, 1.85, 1.19], [.023, 1.85, 1.19],
    [.376, 1.68, 1.54], [.231, 1.68, 1.54],
    [-.187, 1.68, 1.54], [-.332, 1.68, 1.54],
    [0, 1.70, 1.10] // Static quadrant remains outside all moving bounds.
  ];
  const vertices = points.flatMap(([x,y,z]) => [x,y-1,z, x+.001,y-1,z, x,y-1+.001,z]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array(vertices.length / 3 * 2).fill(.5), 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  nested.add(mesh);
  model.updateMatrixWorld(true);
  const original = points.map(([x,y,z]) => model.localToWorld(new THREE.Vector3(x,y,z)));
  const controls = bindGltfEngineControls(model);
  const parts = [...controls.throttles, ...controls.pedals];
  assert.deepEqual(parts.map(p => p.children.length), [1,1,1,1,1,1]);
  assert.equal(mesh.geometry.attributes.position.count, 3, 'quadrant stays static');
  const vertex = part => part.children[0].localToWorld(new THREE.Vector3().fromBufferAttribute(part.children[0].geometry.attributes.position, 0));
  for (const state of [{throttle:1,rudder:1}, {throttle:1,rudder:1}, {throttle:.5,rudder:-1}, {}]) {
    updateGltfEngineControls(controls, state);
    model.updateMatrixWorld(true);
    controls.throttles.forEach((part, i) => {
      const point = model.worldToLocal(vertex(part));
      if (state.throttle) assert.ok(point.z > points[i][2], 'thrust advances handle forward in asset coordinates');
    });
    controls.pedals.forEach((part, i) => {
      const point = model.worldToLocal(vertex(part));
      const direction = i % 2 ? 1 : -1;
      assert.ok(Math.abs(point.z - points[i+2][2] - direction * (state.rudder || 0) * .05) < 1e-6);
    });
  }
  parts.forEach((part, i) => {
    assert.ok(vertex(part).distanceTo(original[i]) < 1e-6, 'reset restores asset geometry');
    assert.equal(part.children[0].geometry.attributes.uv.count, 3);
  });
});
