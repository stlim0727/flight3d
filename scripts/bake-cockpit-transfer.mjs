import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Cockpit } from '../src/aircraft/Cockpit.js';
import { APERTURE_OPENINGS, paneOutwardNormal } from '../src/aircraft/CockpitAperture.js';
import { receiverKey, SUN_DIRECTIONS, TRANSFER_COLUMNS, TRANSFER_VERSION,
  solveTransfer } from '../src/aircraft/CockpitTransferModel.js';
import { loadCockpitGeometry } from './lib/load-cockpit-geometry.mjs';

const samples = Number(process.env.BAKE_SAMPLES || 256);
if (!Number.isInteger(samples) || samples < 32) throw Error('BAKE_SAMPLES must be an integer >= 32');
const dir = 'public/lighting';
fs.mkdirSync(dir, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
const inputs = ['src/aircraft/Cockpit.js', 'src/aircraft/CockpitAperture.js',
  'src/aircraft/CockpitSideWindows.js', 'src/aircraft/GltfCockpitControls.js',
  'src/aircraft/StaticCockpitBatch.js', 'src/aircraft/CockpitTransferModel.js',
  'scripts/bake-cockpit-transfer.mjs', 'scripts/lib/load-cockpit-geometry.mjs'];
const sourceHashes = Object.fromEntries(inputs.map(p => [p, hash(fs.readFileSync(p, 'utf8').replaceAll('\r\n', '\n'))]));

for (const variant of ['medium', 'draco']) {
  const file = `public/models/b737-cockpit-${variant}.glb`;
  const cockpit = new Cockpit({}, {}, {}, {}, {}, {});
  cockpit.prepareModel(await loadCockpitGeometry(file));
  cockpit.group.updateMatrixWorld(true);
  const receivers = [], lookup = new Map(), geometries = [];
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const materialReflectance = m => {
    const c = m.color;
    // Scalar diffuse radiosity uses linear-luminance albedo; specular energy is
    // excluded. Clamp below 1 so the sampled transport is a contraction.
    return Math.min(.9, (c.r * .2126 + c.g * .7152 + c.b * .0722) * (1 - (m.metalness ?? 0)));
  };
  const receiver = (p, n, material) => {
    const key = receiverKey(p, n);
    if (!lookup.has(key)) {
      lookup.set(key, receivers.length);
      receivers.push({ key, p: p.clone(), n: n.clone(), rho: materialReflectance(material) });
    }
    return lookup.get(key);
  };
  cockpit.gltfCockpitGroup.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible) return;
    // Closed liners opt out of the deck pass; only their cut proxies occlude.
    if (mesh.userData.cockpitApertureShadow && !mesh.name.endsWith('_SideWindowShadow')) return;
    const material = mesh.name.endsWith('_SideWindowShadow') ? mesh.parent.material : mesh.material;
    if (Array.isArray(material) || material.transparent || !material.isMeshStandardMaterial) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0 && g.index) {
      for (let i = 0; i < g.index.count; i += 3) {
        const a = g.index.getX(i);
        g.index.setX(i, g.index.getX(i + 2)); g.index.setX(i + 2, a);
      }
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    const ids = [];
    for (let i = 0; i < g.attributes.position.count; i++) {
      point.fromBufferAttribute(g.attributes.position, i);
      normal.fromBufferAttribute(g.attributes.normal, i).normalize();
      const front = receiver(point, normal, material);
      ids.push(front, material.side === THREE.DoubleSide ? receiver(point, normal.clone().negate(), material) : front);
    }
    g.setAttribute('receiver', new THREE.Float32BufferAttribute(ids, 2));
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    geometries.push(g);
  });
  const geometry = mergeGeometries(geometries);
  geometry.boundsTree = new MeshBVH(geometry);
  const occluder = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  occluder.raycast = acceleratedRaycast;
  occluder.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  ray.near = .001;
  const panes = APERTURE_OPENINGS.map(pane => ({
    normal: paneOutwardNormal(pane), size: pane.size,
    inverse: new THREE.Matrix4().compose(new THREE.Vector3(...pane.center),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...pane.rotation)), new THREE.Vector3(1, 1, 1)).invert(),
  }));
  const localOrigin = new THREE.Vector3(), localDirection = new THREE.Vector3();
  const apertureDistance = (origin, direction) => {
    let nearest = Infinity;
    for (const pane of panes) {
      if (pane.normal.dot(direction) <= 0) continue;
      localOrigin.copy(origin).applyMatrix4(pane.inverse);
      localDirection.copy(direction).transformDirection(pane.inverse);
      const t = -localOrigin.z / localDirection.z;
      if (t > .001 && t < nearest &&
          Math.abs(localOrigin.x + t * localDirection.x) <= pane.size[0] / 2 &&
          Math.abs(localOrigin.y + t * localDirection.y) <= pane.size[1] / 2) nearest = t;
    }
    return nearest;
  };
  const trace = (origin, direction, far = Infinity) => {
    ray.set(origin, direction); ray.far = far;
    return ray.intersectObject(occluder, false)[0];
  };
  const direct = new Float64Array(receivers.length * TRANSFER_COLUMNS), links = [];
  const sunDirect = new Float32Array(receivers.length * SUN_DIRECTIONS.length);
  const offset = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3();
  const direction = new THREE.Vector3();
  console.log(`${variant}: ${receivers.length} receivers, ${samples} rays/receiver`);
  for (let i = 0; i < receivers.length; i++) {
    const { p, n } = receivers[i], base = i * TRANSFER_COLUMNS;
    offset.copy(p).addScaledVector(n, .002);
    tangent.crossVectors(Math.abs(n.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), n).normalize();
    bitangent.crossVectors(n, tangent);
    const targets = new Map();
    for (let sample = 0; sample < samples; sample++) {
      const r = Math.sqrt((sample + .5) / samples), phi = sample * 2.399963229728653;
      direction.copy(tangent).multiplyScalar(r * Math.cos(phi))
        .addScaledVector(bitangent, r * Math.sin(phi)).addScaledVector(n, Math.sqrt(1 - r * r));
      const aperture = apertureDistance(offset, direction);
      const hit = trace(offset, direction, aperture);
      if (!hit) {
        if (Number.isFinite(aperture)) direct[base] += 1 / samples;
      } else {
        const back = hit.face.normal.dot(direction) > 0;
        for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) {
          const j = geometry.attributes.receiver.getComponent(vertex, back ? 1 : 0);
          targets.set(j, (targets.get(j) ?? 0) + 1 / (3 * samples));
        }
      }
    }
    links.push([...targets]);
    for (let j = 0; j < 3; j++) {
      direction.copy(cockpit.floods[j].position).sub(offset);
      const distance = direction.length(); direction.divideScalar(distance);
      const cosine = Math.max(0, n.dot(direction));
      if (cosine > 0 && !trace(offset, direction, distance - .002)) {
        const cutoff = Math.max(0, 1 - (distance / cockpit.floods[j].distance) ** 4) ** 2;
        direct[base + 1 + j] = cosine * cutoff / (Math.PI * Math.max(.01, distance ** 2));
      }
    }
    for (let j = 0; j < SUN_DIRECTIONS.length; j++) {
      direction.fromArray(SUN_DIRECTIONS[j]);
      const aperture = apertureDistance(offset, direction), cosine = Math.max(0, n.dot(direction));
      if (cosine > 0 && Number.isFinite(aperture) && !trace(offset, direction, aperture)) {
        direct[base + 4 + j] = cosine / Math.PI;
        sunDirect[i * SUN_DIRECTIONS.length + j] = cosine / Math.PI;
      }
    }
    if (i && i % 10000 === 0) console.log(`${variant}: traced ${i}/${receivers.length}`);
  }
  const solved = solveTransfer(direct, links, receivers.map(r => r.rho), TRANSFER_COLUMNS);
  const values = Float32Array.from(solved.values);
  for (let i = 0; i < receivers.length; i++) {
    for (let j = 4; j < TRANSFER_COLUMNS; j++) values[i * TRANSFER_COLUMNS + j] -= direct[i * TRANSFER_COLUMNS + j];
  }
  const controls = receivers.map((r, i) => ({ r, i })).filter(({ r }) =>
    Math.abs(r.p.x) < .6 && r.p.z < -12.65 && r.p.y > .3 && r.p.y < 1.25 && r.n.z > .3)
    .filter((_, i) => i % 8 === 0).slice(0, 96).map(({ i }) => ({ index: i,
      sun: Array.from(sunDirect.subarray(i * SUN_DIRECTIONS.length, (i + 1) * SUN_DIRECTIONS.length)) }));
  if (!controls.length) throw Error('No instrument receivers for flood control');
  const binary = Buffer.from(values.buffer);
  fs.writeFileSync(`${dir}/cockpit-${variant}.bin`, binary);
  fs.writeFileSync(`${dir}/cockpit-${variant}.json`, JSON.stringify({
    version: TRANSFER_VERSION, variant, columns: TRANSFER_COLUMNS, samples,
    sources: sourceHashes, assetHash: hash(fs.readFileSync(file)), dataHash: hash(binary),
    keys: receivers.map(r => r.key), controls, floodMaximum: cockpit.floodBaseIntensity,
    floodColors: cockpit.floods.map(l => l.color.toArray()),
    solve: { iterations: solved.iterations, residual: solved.residual },
  }));
  console.log(`${variant}: wrote ${binary.length} bytes, ${solved.iterations} iterations, residual ${solved.residual}`);
}
