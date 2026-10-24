import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { solveTransfer, solveFloodOutputs, sunWeights, SUN_DIRECTIONS,
  TRANSFER_COLUMNS, TRANSFER_VERSION, receiverKey } from '../src/aircraft/CockpitTransferModel.js';
import { CockpitLightTransfer } from '../src/aircraft/CockpitLightTransfer.js';
import { batchStaticCockpit } from '../src/aircraft/StaticCockpitBatch.js';

it('converges to the analytical two-patch radiosity solution, including repeated bounces', () => {
  const result = solveTransfer([.2, 0], [[[1, .5]], [[0, .5]]], [.5, .5], 1, 1e-10);
  assert.ok(Math.abs(result.values[0] - .2 / (1 - .25 ** 2)) < 1e-9);
  assert.ok(Math.abs(result.values[1] - .25 * result.values[0]) < 1e-9);
  const closed = solveTransfer([0, 0], [[[1, 1]], [[0, 1]]], [.8, .8], 1);
  assert.deepEqual([...closed.values], [0, 0], 'No light is created in a closed unlit cavity');
  assert.throws(() => solveTransfer([], [], [], 1));
  assert.throws(() => solveTransfer([1], [[[0, 1.1]]], [.5], 1));
  assert.throws(() => solveTransfer([NaN], [[]], [.5], 1));
  assert.throws(() => solveTransfer([1], [[]], [1], 1));
});

it('solves flood deficits per receiver without a direction-only dimmer or mandatory floor', () => {
  const rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], maximum = [1.2, 1.6, .8];
  assert.deepEqual(solveFloodOutputs(rows, [0, 0, 0], maximum), maximum);
  assert.deepEqual(solveFloodOutputs(rows, [3, 3, 3], maximum), [0, 0, 0]);
  const partial = solveFloodOutputs(rows, [.5, 3, 0], maximum);
  assert.ok(Math.abs(partial[0] - .7) < 1e-10);
  assert.equal(partial[1], 0);
  assert.equal(partial[2], .8);
});

it('interpolates the directional sun basis continuously with nonnegative conserved weights', () => {
  let previous;
  for (let a = 0; a <= 360; a += .25) {
    const d = new THREE.Vector3(Math.sin(a * Math.PI / 180), .5, -Math.cos(a * Math.PI / 180)).normalize();
    const weights = sunWeights(d).map(([, w]) => w);
    assert.ok(weights.every(w => w >= 0));
    assert.ok(Math.abs(weights.reduce((s, w) => s + w, 0) - 1) < 1e-10);
    if (previous) assert.ok(Math.max(...weights.map((w, i) => Math.abs(w - previous[i]))) < .05);
    previous = weights;
  }
  SUN_DIRECTIONS.forEach((d, i) => assert.ok(sunWeights(new THREE.Vector3(...d))[i][1] > .9999));
});

it('fades solved floods across day/night sequences and stops uploading a settled texture', () => {
  const coefficients = new Float32Array(3 * TRANSFER_COLUMNS);
  for (let i = 0; i < 3; i++) { coefficients[i * TRANSFER_COLUMNS] = .1; coefficients[i * TRANSFER_COLUMNS + 1 + i] = 1; }
  const manifest = { version: TRANSFER_VERSION, columns: TRANSFER_COLUMNS, keys: ['a', 'b', 'c'],
    controls: [0, 1, 2].map(index => ({ index, sun: SUN_DIRECTIONS.map(() => 0) })),
    floodColors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], floodMaximum: [1, 1, 1] };
  const transfer = new CockpitLightTransfer(manifest, coefficients);
  const state = { ambientColor: new THREE.Color(1, 1, 1), ambientIntensity: 0,
    sunColor: new THREE.Color(1, 1, 1), sunIntensity: 0, sunDirection: new THREE.Vector3(0, 1, 0), dt: 1 / 60 };
  transfer.update(state);
  assert.deepEqual(transfer.outputs, [1, 1, 1]);
  assert.ok(Math.abs(transfer.pixels[3] - .1) < 1e-6, 'Environment accessibility is geometry based even at night');
  for (let i = 0; i < 180; i++) transfer.update({ ...state, ambientIntensity: 40 });
  assert.ok(transfer.outputs.every(v => v < .001));
  const version = transfer.texture.version;
  transfer.update({ ...state, ambientIntensity: 40 });
  assert.equal(transfer.texture.version, version);
  for (let i = 0; i < 240; i++) transfer.update(state);
  assert.ok(transfer.outputs.every(v => v > .999));
  assert.throws(() => new CockpitLightTransfer(manifest, new Float32Array(0)));
  transfer.dispose();
});

it('binds front/back receivers after batching independently of the aircraft world pose', () => {
  const group = new THREE.Group(), material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const keys = new Set();
  for (const x of [-.3, .3]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.2, .2), material);
    mesh.position.set(x, .7, -12.8); group.add(mesh);
  }
  batchStaticCockpit(group);
  assert.equal(group.children.length, 1);
  group.updateMatrixWorld(true);
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld);
      for (const sign of [1, -1]) keys.add(receiverKey(p, new THREE.Vector3(0, 0, sign)));
    }
  });
  group.position.set(140, 83, -320);
  group.quaternion.setFromEuler(new THREE.Euler(.3, 1.2, -.6));
  const manifest = { version: TRANSFER_VERSION, columns: TRANSFER_COLUMNS, keys: [...keys],
    controls: [{ index: 0, sun: SUN_DIRECTIONS.map(() => 0) }],
    floodColors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], floodMaximum: [1, 1, 1] };
  const transfer = new CockpitLightTransfer(manifest, new Float32Array(keys.size * TRANSFER_COLUMNS));
  transfer.bind(group);
  assert.equal(transfer.coverage, 1);
  const uv = group.children[0].geometry.attributes.deckTransferUV;
  assert.equal(uv.count, 8);
  assert.notEqual(uv.getX(0), uv.getZ(0), 'The underside has its own receiver');
  transfer.dispose();
});

for (const variant of ['medium', 'draco']) it(`ships a finite, current, checksum-verified ${variant} bake`, () => {
  const manifest = JSON.parse(fs.readFileSync(`public/lighting/cockpit-${variant}.json`));
  const bytes = fs.readFileSync(`public/lighting/cockpit-${variant}.bin`);
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.equal(hash(bytes), manifest.dataHash);
  assert.equal(hash(fs.readFileSync(`public/models/b737-cockpit-${variant}.glb`)), manifest.assetHash);
  for (const [file, expected] of Object.entries(manifest.sources)) {
    assert.equal(hash(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')), expected, `${file}: regenerate the cockpit bake`);
  }
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const transfer = new CockpitLightTransfer(manifest, values);
  assert.ok(manifest.solve.residual < 1e-5);
  assert.ok(manifest.keys.length > 1000);
  let skySum = 0;
  for (let i = 0; i < manifest.keys.length; i++) {
    const sky = values[i * TRANSFER_COLUMNS];
    assert.ok(sky >= 0 && sky <= 1.00001, 'A passive uniform-sky transfer cannot amplify radiance');
    skySum += sky;
  }
  assert.ok(skySum > 1, 'The bake must not silently contain only zero visibility');
  transfer.dispose();
});
