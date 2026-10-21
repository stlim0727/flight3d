import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original Flight3d assets. See docs/development/foliage.md for provenance.
export const TREE_SPECIES = ['pine', 'spruce', 'oak'];
export const TREE_LOD_DISTANCE = 650;
export const TREE_LOD_HYSTERESIS = 100;

export function createTreeGeometry(species, detailed) {
  const parts = [];
  const add = (geometry, position, scale, color) => {
    geometry.scale(...scale);
    geometry.translate(...position);
    const rgb = new THREE.Color(color);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Common non-indexed layout allows crowns and cylinders to share one draw.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    flat.deleteAttribute('uv');
    parts.push(flat);
  };
  add(new THREE.CylinderGeometry(0.25, 0.48, species === 'oak' ? 6 : 9, detailed ? 7 : 3, 1, !detailed),
    [0, species === 'oak' ? 3 : 4.5, 0], [1, 1, 1], 0x604630);
  if (species === 'oak') {
    const lobes = [[0, 7.8, 0, 3.3], [-2, 6.5, 0, 2.3], [1.7, 6.8, 0.8, 2.5],
      [0, 6.7, -1.9, 2.4], [0.2, 6.4, 2, 2.2]];
    for (const [x, y, z, r] of lobes) {
      add(detailed ? new THREE.IcosahedronGeometry(1, 1) : new THREE.OctahedronGeometry(1),
        [x, y, z], [r, r * 0.9, r], 0x426b32);
    }
  } else {
    const spruce = species === 'spruce';
    const tiers = spruce ? [[2.7, 5.5, 4.7], [2.15, 5, 7], [1.4, 4.5, 9.5]]
      : [[3.3, 4, 5.2], [2.8, 4, 7.3], [1.9, 3.6, 9.3]];
    for (const [radius, height, y] of tiers) {
      add(new THREE.ConeGeometry(radius, height, detailed ? 9 : 4),
        [0, y, 0], [1, 1, 1], spruce ? 0x254e40 : 0x365c2b);
    }
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
