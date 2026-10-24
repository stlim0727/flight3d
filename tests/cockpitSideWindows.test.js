import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { APERTURE_OPENINGS, VISIBLE_GLASS, WINDSHIELD_PANES, SIDE_WINDOW_PANES,
  directAdmittance, referenceDirectAdmittance } from '../src/aircraft/CockpitAperture.js';

it('admits both aft quarters through No.3 without inventing a rear-facing window', () => {
  for (const elevation of [20, 40]) {
    for (const side of [-1, 1]) {
      let previous = Infinity;
      for (const bearing of [0, 45, 90, 135, 180]) {
        const sun = new THREE.Vector3().setFromSphericalCoords(1,
          THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(180 + side * bearing));
        const before = directAdmittance(sun, WINDSHIELD_PANES) / referenceDirectAdmittance(WINDSHIELD_PANES);
        const after = directAdmittance(sun) / referenceDirectAdmittance();
        assert.ok(after <= previous + 1e-9, 'sampled acceptance falls from nose to tail');
        if (bearing === 90) assert.ok(after > before * 1.3);
        if (bearing === 135) assert.ok(after > before * 2);
        if (bearing === 180) assert.equal(after, 0);
        previous = after;
      }
    }
  }
});

it('keeps virtual side openings out of the visible glass set', () => {
  assert.equal(VISIBLE_GLASS.length, 4);
  for (const pane of WINDSHIELD_PANES) assert.ok(APERTURE_OPENINGS.includes(pane));
  for (const pane of SIDE_WINDOW_PANES) {
    assert.ok(APERTURE_OPENINGS.includes(pane));
    assert.ok(!VISIBLE_GLASS.includes(pane));
  }
});

it('restores the original skin after the deck pass and keeps main-sun shadows', async () => {
  const { bindSideWindowShadow } = await import('../src/aircraft/CockpitSideWindows.js');
  const original = new THREE.BoxGeometry(), alternate = new THREE.PlaneGeometry();
  const mesh = new THREE.Mesh(original, new THREE.MeshBasicMaterial());
  const proxy = bindSideWindowShadow(mesh, alternate);
  const camera = new THREE.Camera(), args = [null, null, null, camera, original];
  for (const deck of [true, false, true, false]) {
    camera.userData.cockpitSun = deck;
    mesh.onBeforeShadow(...args);
    proxy.onBeforeShadow(...args);
    assert.equal(original.drawRange.count, deck ? 0 : Infinity);
    assert.equal(alternate.drawRange.count, deck ? Infinity : 0);
    mesh.onAfterShadow(...args);
    proxy.onAfterShadow(...args);
    assert.strictEqual(mesh.geometry, original);
  }
});

it('cuts a real opening through triangles while preserving UVs and surrounding wall', async () => {
  const { subtractWindow } = await import('../src/aircraft/CockpitSideWindows.js');
  const source = new THREE.PlaneGeometry(4, 4);
  const result = subtractWindow(source, new THREE.Matrix4(), [1, 1]);
  const mesh = new THREE.Mesh(result, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(mesh).length, 0);
  ray.ray.origin.x = 0.6;
  assert.ok(ray.intersectObject(mesh).length > 0);
  let area = 0;
  const p = result.attributes.position, uv = result.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k));
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  assert.ok(Math.abs(area - 15) < 1e-6, 'only the one square metre aperture is removed');
  for (let i = 0; i < p.count; i++) {
    assert.ok(Math.abs(uv.getX(i) - (p.getX(i) / 4 + .5)) < 1e-6);
    assert.ok(Math.abs(uv.getY(i) - (p.getY(i) / 4 + .5)) < 1e-6);
  }
  assert.equal(source.index.count, 6, 'shared source geometry stays intact');
  const farWall = source.clone().translate(0, 0, 2);
  const untouched = subtractWindow(farWall, new THREE.Matrix4(), [1, 1]);
  assert.equal(untouched.attributes.position.count, 6, 'distant bulkheads are not cut');
});

it('opens the decoded GLB liners only in the side-aperture shadow proxies', async () => {
  const { loadCockpitShell } = await import('./helpers/loadCockpitShell.js');
  const { bindCockpitSideWindowShadows } = await import('../src/aircraft/CockpitSideWindows.js');
  const { paneOutwardNormal } = await import('../src/aircraft/CockpitAperture.js');
  const { batchStaticCockpit } = await import('../src/aircraft/StaticCockpitBatch.js');
  const model = await loadCockpitShell();
  // Match GLTFLoader's sanitized names, rather than just the raw JSON names.
  model.traverse(node => { node.name = node.name.replaceAll('.', ''); });
  bindCockpitSideWindowShadows(model);
  const originals = [], proxies = [];
  model.traverse(node => {
    if (node.name.endsWith('_SideWindowShadow')) proxies.push(node);
    else if (node.isMesh && node.userData.cockpitApertureShadow) originals.push(node);
  });
  assert.equal(proxies.length, 5);
  assert.equal(originals.length, proxies.length);
  const geometries = originals.map(mesh => mesh.geometry);
  bindCockpitSideWindowShadows(model);
  batchStaticCockpit(model);
  assert.ok(originals.every((mesh, i) => mesh.geometry === geometries[i] && mesh.parent));
  model.updateMatrixWorld(true);
  for (const pane of SIDE_WINDOW_PANES) {
    const normal = paneOutwardNormal(pane), rotation = new THREE.Euler(...pane.rotation);
    let formerlyBlocked = 0;
    for (const u of [-.3, 0, .3]) for (const v of [-.3, 0, .3]) {
      const center = new THREE.Vector3(u * pane.size[0], v * pane.size[1], 0)
        .applyEuler(rotation).add(new THREE.Vector3(...pane.center));
      const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, .49), normal.clone().negate(), 0, .98);
      formerlyBlocked += ray.intersectObjects(originals, false).length;
      assert.equal(ray.intersectObjects(proxies, false).length, 0, `${pane.name}: cut shadow liners still block an aperture ray`);
    }
    assert.ok(formerlyBlocked > 0, `${pane.name}: regression must exercise actual opaque liner triangles`);
  }
});
