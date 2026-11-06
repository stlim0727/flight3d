import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { districtSurfaceHeight } from './CitySurface.js';
import { applyLogDepthOffset } from './RunwayMarkings.js';
export { districtSurfaceHeight } from './CitySurface.js';

export const DISTRICT = { x: 900, z: 950, spacing: 60, columns: 11, rows: 10 };
export function districtLot(index) {
  const d = DISTRICT;
  return { x: d.x + (index % d.columns - (d.columns - 1) / 2) * d.spacing,
    z: d.z + (Math.floor(index / d.columns) - (d.rows - 1) / 2) * d.spacing };
}
export function inDistrict(x, z) {
  const d = DISTRICT;
  return Math.abs(x - d.x) < d.columns * d.spacing / 2 + 12 &&
    Math.abs(z - d.z) < d.rows * d.spacing / 2 + 12;
}
export function createDistrictRoads(terrain) {
  const d = DISTRICT, pieces = [];
  const strip = (x, z, w, h) => {
    const g = new THREE.PlaneGeometry(w, h, Math.max(1, Math.ceil(w / 3)), Math.max(1, Math.ceil(h / 3)));
    g.rotateX(-Math.PI / 2); g.translate(x, 0, z);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, districtSurfaceHeight(terrain, p.getX(i), p.getZ(i)) + .12);
    g.computeVertexNormals(); pieces.push(g);
  };
  // Non-overlapping strips: intersections belong to the north/south roads.
  for (let col = 0; col <= d.columns; col++) strip(d.x + (col - d.columns / 2) * d.spacing, d.z, 12, d.rows * d.spacing + 12);
  for (let row = 0; row <= d.rows; row++) for (let col = 0; col < d.columns; col++) {
    strip(d.x + (col - (d.columns - 1) / 2) * d.spacing,
      d.z + (row - d.rows / 2) * d.spacing, d.spacing - 12, 12);
  }
  const mesh = new THREE.Mesh(mergeGeometries(pieces), applyLogDepthOffset(new THREE.MeshStandardMaterial({ color: 0x444a4c, roughness: .95 }), 2));
  pieces.forEach(g => g.dispose()); mesh.name = 'district-roads'; mesh.receiveShadow = true;
  return mesh;
}
export async function loadDistrictKit() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL ?? '/'}models/city/district-kit.glb`);
  const mask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 100, 80, 45, 255]), 2, 1);
  mask.colorSpace = THREE.SRGBColorSpace; mask.needsUpdate = true;
  return [0, 1, 2].map(i => {
    const mesh = gltf.scene.getObjectByName(`District${i}`);
    if (!mesh?.isMesh) throw new Error(`Missing district mesh ${i}`);
    mesh.material.emissive.set(0xffffff);
    mesh.material.emissiveMap = mask;
    mesh.material.emissiveIntensity = 0;
    mesh.geometry.computeBoundingBox();
    return mesh;
  });
}
