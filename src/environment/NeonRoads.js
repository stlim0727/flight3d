import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEON_RUNWAY, bridgeFootprints, neonStreets } from '../config/neonRoads.js';

// Pieces at most this long, so no triangle spans kilometres (near-plane 1/w interpolation).
const PIECE = 100;
// Curb lines: this wide, inset this far from the street edge.
const CURB = 0.5, INSET = 0.6;

// A flat, upward-facing rectangle at height y, cut into pieces at most PIECE long.
function slab(x0, x1, z0, z1, y) {
  const pieces = [], nx = Math.max(1, Math.ceil((x1 - x0) / PIECE)), nz = Math.max(1, Math.ceil((z1 - z0) / PIECE));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = x0 + (x1 - x0) * i / nx, b = x0 + (x1 - x0) * (i + 1) / nx;
      const c = z0 + (z1 - z0) * j / nz, d = z0 + (z1 - z0) * (j + 1) / nz;
      pieces.push(new THREE.PlaneGeometry(b - a, d - c).rotateX(-Math.PI / 2).translate((a + b) / 2, y, (c + d) / 2));
    }
  }
  return pieces;
}

// [from, to] minus every interval in `cuts`.
function subtract([from, to], cuts) {
  let spans = [[from, to]];
  for (const [c0, c1] of cuts) spans = spans.flatMap(([a, b]) => (c1 <= a || c0 >= b ? [[a, b]] : [[a, c0], [c1, b]].filter(([p, q]) => q - p > 1e-6)));
  return spans;
}

// Curb spans of street `s`: the parts of each edge where the ground just outside it is not
// paved (another street, the runway or a bridge), as [x0, x1, z0, z1] line rectangles.
export function curbLines(s, paved) {
  const others = paved.filter(o => o !== s), lines = [];
  // Along X at z = edge, with the ground outside at z = edge + out.
  for (const [edge, out] of [[s.z0, -1], [s.z1, 1]]) {
    const probe = edge + out * 1e-3, cuts = others.filter(o => probe > o.z0 && probe < o.z1).map(o => [o.x0, o.x1]);
    const z = edge - out * INSET;
    for (const [a, b] of subtract([s.x0, s.x1], cuts)) lines.push([a, b, z - CURB / 2, z + CURB / 2]);
  }
  for (const [edge, out] of [[s.x0, -1], [s.x1, 1]]) {
    const probe = edge + out * 1e-3, cuts = others.filter(o => probe > o.x0 && probe < o.x1).map(o => [o.z0, o.z1]);
    const x = edge - out * INSET;
    for (const [a, b] of subtract([s.z0, s.z1], cuts)) lines.push([x - CURB / 2, x + CURB / 2, a, b]);
  }
  return lines;
}

// Every street's curb lines, against the streets, the runway and the bridges.
export function curbRects(streets = neonStreets()) {
  const paved = [...streets, NEON_RUNWAY, ...bridgeFootprints()];
  return streets.flatMap(s => curbLines(s, paved));
}

// The Neon Metropolis street network (#579): dark asphalt at the runway's height with
// violet curb lines along every edge that does not open onto another street.
export function createNeonRoads(streets = neonStreets()) {
  const group = new THREE.Group();
  group.name = 'neon-roads';

  const surface = new THREE.Mesh(mergeGeometries(streets.flatMap(s => slab(s.x0, s.x1, s.z0, s.z1, 0.04))),
    new THREE.MeshBasicMaterial({ color: 0x110b20 }));
  surface.name = 'neon-road-surface';
  const curbs = new THREE.Mesh(mergeGeometries(curbRects(streets).flatMap(([x0, x1, z0, z1]) => slab(x0, x1, z0, z1, 0.08))),
    new THREE.MeshBasicMaterial({ color: 0x8a3bd8 }));
  curbs.name = 'neon-road-curbs';
  group.add(surface, curbs);
  return { group, surface, curbs, streets };
}
