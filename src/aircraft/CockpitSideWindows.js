import * as THREE from 'three';
import { excludeFromDeckShadow } from './CockpitLighting.js';
import { SIDE_WINDOW_PANES } from './CockpitAperture.js';

const cutModels = new WeakSet();

// Virtual side apertures affect only the deck sun depth pass. Beauty and main
// sunlight keep the original closed liners. Instruments/seats are never cut.
export function bindCockpitSideWindowShadows(model) {
  if (cutModels.has(model)) return;
  model.updateMatrixWorld(true);
  const worldToDeck = model.parent
    ? model.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  model.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.cockpitApertureShadow || !/^Body[._]?(002|006|018)_/.test(mesh.name)) return;
    const original = mesh.geometry;
    let shadowGeometry = original;
    for (const pane of SIDE_WINDOW_PANES) {
      const paneMatrix = new THREE.Matrix4().compose(new THREE.Vector3(...pane.center),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...pane.rotation)), new THREE.Vector3(1, 1, 1));
      const toPane = paneMatrix.invert().multiply(worldToDeck).multiply(mesh.matrixWorld);
      const previous = shadowGeometry;
      shadowGeometry = subtractWindow(previous, toPane, pane.size);
      if (previous !== original) previous.dispose();
    }
    bindSideWindowShadow(mesh, shadowGeometry);
  });
  cutModels.add(model);
}

export function subtractWindow(source, toPane, size) {
  const half = [size[0] / 2, size[1] / 2, 0.50];
  const attributes = Object.entries(source.attributes);
  const output = Object.fromEntries(attributes.map(([name]) => [name, []]));
  const emit = polygon => {
    for (let i = 1; i + 1 < polygon.length; i++) {
      for (const vertex of [polygon[0], polygon[i], polygon[i + 1]]) {
        for (const [name] of attributes) output[name].push(...vertex[name]);
      }
    }
  };
  const clip = (polygon, axis, sign, inside) => {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = half[axis] - sign * a.window[axis];
      const db = half[axis] - sign * b.window[axis];
      const ka = inside ? da >= 0 : da < 0, kb = inside ? db >= 0 : db < 0;
      if (ka) result.push(a);
      if (ka !== kb) {
        const t = da / (da - db);
        result.push(Object.fromEntries(Object.entries(a).map(([name, values]) =>
          [name, values.map((v, k) => THREE.MathUtils.lerp(v, b[name][k], t))])));
      }
    }
    return result;
  };
  const count = source.index?.count ?? source.attributes.position.count;
  for (let i = 0; i < count; i += 3) {
    let polygon = [0, 1, 2].map(k => {
      const index = source.index ? source.index.getX(i + k) : i + k;
      const vertex = Object.fromEntries(attributes.map(([name, a]) => [name,
        Array.from({ length: a.itemSize }, (_, n) => a.getComponent(index, n))]));
      vertex.window = new THREE.Vector3(...vertex.position).applyMatrix4(toPane).toArray();
      return vertex;
    });
    // Reject whole triangles first, preserving the bulk of the model unchanged.
    if (half.some((h, axis) => [1, -1].some(sign => polygon.every(v => sign * v.window[axis] > h)))) {
      emit(polygon);
      continue;
    }
    for (let axis = 0; axis < 3 && polygon.length; axis++) {
      for (const sign of [1, -1]) {
        emit(clip(polygon, axis, sign, false));
        polygon = clip(polygon, axis, sign, true);
      }
    }
  }
  const result = new THREE.BufferGeometry();
  for (const [name, a] of attributes) result.setAttribute(name,
    new THREE.Float32BufferAttribute(output[name], a.itemSize));
  if (result.attributes.normal) result.normalizeNormals();
  result.computeBoundingSphere();
  return result;
}



/** A depth-only proxy is needed: three resolves geometry before the shadow hook. */
export function bindSideWindowShadow(mesh, shadowGeometry) {
  mesh.userData.cockpitApertureShadow = true;
  excludeFromDeckShadow(mesh);
  const proxy = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  proxy.name = mesh.name + '_SideWindowShadow';
  proxy.castShadow = true;
  proxy.userData.cockpitApertureShadow = true;
  let saved;
  proxy.onBeforeShadow = function (_renderer, _object, _camera, shadowCamera) {
    saved = { ...this.geometry.drawRange };
    if (!shadowCamera.userData.cockpitSun) this.geometry.setDrawRange(0, 0);
  };
  proxy.onAfterShadow = function () {
    this.geometry.setDrawRange(saved.start, saved.count);
  };
  mesh.add(proxy);
  return proxy;
}
