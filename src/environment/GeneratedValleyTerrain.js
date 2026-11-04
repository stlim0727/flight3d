import * as THREE from 'three';
import { createTreeGeometry } from './TreeModels.js';
import { planValleyTrees } from './valleyTrees.js';

const VALLEY_FLOOR_REFERENCE_M = 2100; // course start floor elevation
const C_FLOOR = new THREE.Color(0x273628);  // valley floor moss/pine
const C_CANYON = new THREE.Color(0x524638); // canyon earth/rock
const C_CLIFF = new THREE.Color(0x352e26);  // sheer cliff rock face
const C_RIDGE = new THREE.Color(0x7a746e);  // alpine granite
const C_SNOW = new THREE.Color(0xdce5ed);   // high mountain peaks

// Ribbon cross-track stops as multiples of the local corridor half width. The wall
// band is 1..2 half widths, so 1/12 of a half width (~6m) resolves the rock face the
// pilot flies at; the crest plateau either side is stepped off progressively coarser.
const CORRIDOR_STOPS = [
  -6.7, -6.1, -5.6, -5.1, -4.6, -4.1, -3.7, -3.3, -2.9, -2.6, -2.3, -2.0,
  -1.917, -1.833, -1.75, -1.667, -1.583, -1.5, -1.417, -1.333, -1.25, -1.167, -1.083,
  -1.0, -0.7, -0.35, 0,
  0.35, 0.7, 1.0,
  1.083, 1.167, 1.25, 1.333, 1.417, 1.5, 1.583, 1.667, 1.75, 1.833, 1.917,
  2.0, 2.3, 2.6, 2.9, 3.3, 3.7, 4.1, 4.6, 5.1, 5.6, 6.1, 6.7,
];

const RIBBON_END_RINGS = 20;     // ribbon rings beyond each course end, closing the tube
const RIBBON_HALF_WIDTHS = 6.7;  // how far the ribbon reaches either side of the centreline
// The ribbon is the analytic surface, so it needs no help being correct - but the coarse
// grid it lands on is not, and where one stops and the other starts that reads as an
// arbitrary cliff. Past the crest the corridor is unreachable (a hull crashes inside two
// half widths), so the ribbon eases onto the coarse surface across the outer ramp and
// matches it, recessed, from `RIBBON_BLEND_TO` - the same distance the coarse cull
// reaches - leaving the seam as the only thing drawn there.
const RIBBON_BLEND_FROM = 3.5;   // half widths where the ribbon starts following the coarse grid
const RIBBON_BLEND_TO = 4.6;     // half widths where it has fully joined it
const SEAM_RECESS_M = 3;         // depress the coarse surface where the ribbon overlaps it

/** Deterministic lattice hash, the seed for every tint detail below. Cheap and
 * stable, so the same vertex always gets the same blotch. */
function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function latticeNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

function fbm(x, z) {
  return latticeNoise(x, z) * 0.6 + latticeNoise(x * 2.7 + 11.3, z * 2.7 - 5.7) * 0.4;
}

/** Elevation and slope tint shared by the coarse world mesh and the corridor
 * ribbon, plus deterministic noise so the bands read as rock and earth instead
 * of an airbrush: patchy vegetation, per-vertex grain, strata on steep faces,
 * damp pockets on the floor. Judging and collision never see any of this. */
function shadeSurfaceVertex(color, y, ny, x, z) {
  const relY = y - VALLEY_FLOOR_REFERENCE_M;
  if (relY < 60) {
    color.lerpColors(C_FLOOR, C_CANYON, Math.max(0, relY / 60));
  } else if (relY < 320) {
    color.lerpColors(C_CANYON, C_RIDGE, (relY - 60) / 260);
  } else {
    color.lerpColors(C_RIDGE, C_SNOW, Math.min(1, (relY - 320) / 300));
  }
  if (ny < 0.78) {
    color.lerp(C_CLIFF, Math.min(1, (0.78 - ny) / 0.45) * 0.75);
  }
  const patch = fbm(x * 0.02, z * 0.02);
  color.offsetHSL((patch - 0.5) * 0.012, (patch - 0.5) * 0.10, (patch - 0.5) * 0.10);
  color.multiplyScalar(1 + (hash2(Math.round(x), Math.round(z)) - 0.5) * 0.08);
  if (ny < 0.8) {
    const strata = 0.5 + 0.5 * Math.sin(relY * 0.075 + fbm(x * 0.01, z * 0.01) * 5);
    color.multiplyScalar(0.86 + strata * 0.22);
  } else if (relY < 80 && ny > 0.9) {
    if (latticeNoise(x * 0.015 + 31.7, z * 0.015 - 17.3) > 0.62) color.multiplyScalar(0.9);
  }
}

function ribbonTangent(sample, sign) {
  return { x: Math.sin(sample.heading) * sign, z: -Math.cos(sample.heading) * sign };
}

/**
 * Classify coarse grid vertices against the corridor: culled, because the ribbon draws
 * that part properly, or overlapped, because it is drawn underneath the ribbon edge.
 * Only the band around the centreline is ever queried - projecting the whole plateau
 * would scan every centreline sample per vertex for nothing. Returns null when the
 * terrain carries no centreline, leaving the plain heightfield alone.
 */
function corridorMask(terrain, pos, cols, rows) {
  const centerline = terrain?.centerline;
  if (!Array.isArray(centerline) || centerline.length < 2 || typeof terrain.project !== 'function') return null;

  const stride = cols;
  const inside = new Uint8Array(pos.count);
  const overlap = new Uint8Array(pos.count);
  const first = centerline[0], last = centerline[centerline.length - 1];
  const stepM = (last.s - first.s) / (centerline.length - 1);
  const reach = RIBBON_END_RINGS * stepM;
  const startAlong = ribbonTangent(first, 1), endAlong = ribbonTangent(last, 1);
  const minHalfWidth = centerline.reduce((best, sample) => Math.min(best, sample.halfWidth), Infinity);

  const x0 = pos.getX(0), z0 = pos.getZ(0);
  const cellX = (pos.getX(1) - x0) || 1, cellZ = (pos.getZ(stride) - z0) || 1;
  // A culled triangle still reaches one cell past its culled vertices, so the cull
  // line sits a cell diagonal inside the ribbon's own reach: what is removed is
  // always redrawn, never left as sky.
  const cellDiagonalM = Math.hypot(cellX, cellZ);
  const ribbonReachM = RIBBON_HALF_WIDTHS * minHalfWidth;
  const cullLimitM = ribbonReachM - cellDiagonalM;
  const overlapLimitM = ribbonReachM + cellDiagonalM;
  const bandM = overlapLimitM + 60; // curvature slack on the offset line
  const candidates = new Set();
  for (const sample of centerline) {
    const fromCol = Math.max(0, Math.floor((sample.x - bandM - x0) / cellX));
    const toCol = Math.min(stride - 1, Math.ceil((sample.x + bandM - x0) / cellX));
    const fromRow = Math.max(0, Math.floor((sample.z - bandM - z0) / cellZ));
    const toRow = Math.min(rows - 1, Math.ceil((sample.z + bandM - z0) / cellZ));
    for (let row = fromRow; row <= toRow; row++) {
      for (let col = fromCol; col <= toCol; col++) candidates.add(row * stride + col);
    }
  }

  for (const i of candidates) {
    const x = pos.getX(i), z = pos.getZ(i);
    const here = terrain.project(x, z);
    if (!here) continue;
    // project() clamps arc length to the centreline, so clearance beyond the ends
    // is measured along the end tangents instead.
    let s = here.s;
    if (s <= first.s) s = Math.max(first.s - reach, first.s + (x - first.x) * startAlong.x + (z - first.z) * startAlong.z);
    else if (s >= last.s) s = Math.min(last.s + reach, last.s + (x - last.x) * endAlong.x + (z - last.z) * endAlong.z);
    if (s < first.s - reach || s > last.s + reach) continue;
    const crossAbs = Math.abs(here.crossM);
    if (crossAbs <= cullLimitM && s > first.s + reach && s < last.s - reach) inside[i] = 1;
    else if (crossAbs <= overlapLimitM) overlap[i] = 1;
  }
  return { inside, overlap };
}

/** Rebuild the coarse index without any triangle touching the culled corridor band. */
function cullCoarseIndex(geom, inside) {
  const source = geom.index.array;
  const kept = [];
  for (let t = 0; t < source.length; t += 3) {
    const a = source[t], b = source[t + 1], c = source[t + 2];
    if (inside[a] || inside[b] || inside[c]) continue;
    kept.push(a, b, c);
  }
  geom.setIndex(kept);
}

/** Bilinear reader for the coarse grid, used to land the ribbon on it. */
function coarseSurfaceSampler(pos, cols) {
  const rows = Math.floor(pos.count / cols);
  const x0 = pos.getX(0), z0 = pos.getZ(0);
  const cellX = (pos.getX(1) - x0) || 1, cellZ = (pos.getZ(cols) - z0) || 1;
  return (x, z) => {
    const fx = (x - x0) / cellX, fz = (z - z0) / cellZ;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= cols - 1 || j >= rows - 1) return null;
    const tx = fx - i, tz = fz - j;
    const a = pos.getY(j * cols + i), b = pos.getY(j * cols + i + 1);
    const c = pos.getY((j + 1) * cols + i), d = pos.getY((j + 1) * cols + i + 1);
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

/**
 * Three.js 3D Procedural Mountain Valley Terrain
 * Creates an alpine canyon mesh matching the exact mathematical heights of
 * generateValley({ seed, rules }).
 *
 * The coarse world grid is a ~90m cell heightfield, far too wide to resolve a
 * 68-72m corridor with 550-800m walls: sampled there the wall face is a chord that
 * cuts tens of metres inside the surface collision queries. So the corridor gets its
 * own ribbon, sampled vertex-by-vertex from the analytic getHeight() the probes call,
 * and the coarse triangles underneath it are culled. The ribbon's outer stops blend
 * onto the coarse grid so the two surfaces meet instead of leaving a step halfway up
 * the flank. Rendering only - getHeight() stays authoritative for landing gear and
 * collision queries: nothing here changes what a probe can hit.
 */
export class GeneratedValleyTerrain {
  constructor(valleyTerrain, sim = null, options = {}) {
    this.terrain = valleyTerrain;
    this.isLoaded = true;
    this.loadError = null;
    this.region = 'generated-valley';

    const b = valleyTerrain?.bounds;
    const minX = b?.minX ?? -2000;
    const maxX = b?.maxX ?? 2000;
    const minZ = b?.minZ ?? -18000;
    const maxZ = b?.maxZ ?? 0;

    // Course extends northward (negative Z) from z=0 to minZ (~-18000m).
    // Provide generous mountain terrain margins:
    // - Ahead of finish line: 10,000m beyond minZ (runout and forward visibility)
    // - Behind start line: 6,000m past maxZ (approach and rear visibility)
    // - Lateral margin: at least 7,000m on each side of the corridor
    const northEdgeZ = minZ - 10000;
    const southEdgeZ = maxZ + 6000;
    const lengthZ = options.lengthZ ?? (options.size ? options.size : (southEdgeZ - northEdgeZ));
    const centerZ = options.centerZ ?? ((southEdgeZ + northEdgeZ) / 2);

    const widthX = options.widthX ?? (options.size ? options.size : Math.max(18000, (maxX - minX) + 14000));
    const centerX = options.centerX ?? ((minX + maxX) / 2);

    this.size = Math.max(widthX, lengthZ);
    this.widthX = widthX;
    this.lengthZ = lengthZ;
    this.centerX = centerX;
    this.centerZ = centerZ;

    const segmentsX = options.segmentsX ?? (options.segments ? options.segments : 200);
    const segmentsZ = options.segmentsZ ?? (options.segments ? Math.round(options.segments * (lengthZ / widthX)) : 380);
    this.segments = Math.max(segmentsX, segmentsZ);
    this.mesh = null;
    this.ribbonMesh = null;
    this.treeMeshes = [];
    this.ribbonRings = 0;
    this.ribbonStops = CORRIDOR_STOPS.length;
    this.group = new THREE.Group();
    this.group.name = 'generated-valley-terrain';

    if (sim?.scene) {
      const geom = new THREE.PlaneGeometry(widthX, lengthZ, segmentsX, segmentsZ);
      geom.rotateX(-Math.PI * 0.5);
      // Center the mesh along the generated valley trajectory
      geom.translate(centerX, 0, centerZ);

      const pos = geom.attributes.position;
      const count = pos.count;
      const corridor = corridorMask(this.terrain, pos, segmentsX + 1, segmentsZ + 1);
      for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const recess = corridor && corridor.overlap[i] ? SEAM_RECESS_M : 0;
        pos.setY(i, this.terrain.getHeight(x, z) - recess);
      }
      if (corridor) cullCoarseIndex(geom, corridor.inside);
      geom.computeVertexNormals();
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      const norm = geom.attributes.normal;
      const colors = new Float32Array(count * 3);
      const tmpColor = new THREE.Color();

      for (let i = 0; i < count; i++) {
        shadeSurfaceVertex(tmpColor, pos.getY(i), norm.getY(i), pos.getX(i), pos.getZ(i));
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }

      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.05,
        flatShading: false,
      });

      this.mesh = new THREE.Mesh(geom, mat);
      this.mesh.receiveShadow = true;
      this.group.add(this.mesh);

      this.buildCorridorRibbon(mat, coarseSurfaceSampler(pos, segmentsX + 1));
      this.buildTreeInstances();
      sim.scene.add(this.group);
    }
  }

  /** Low-poly conifers on the flank benches, wall ledges, and plateau: one static
   * InstancedMesh per species, planted from the planner's rejection sample of the
   * same analytic surface the ribbon is lifted from. No shadow casting — a depth
   * pass for thousands of trees is not what the sense of terrain is bought with. */
  buildTreeInstances() {
    const trees = planValleyTrees(this.terrain, { floorReferenceM: VALLEY_FLOOR_REFERENCE_M });
    if (!trees.length) return;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const dummy = new THREE.Object3D();
    for (const species of new Set(trees.map(tree => tree.species))) {
      const batch = trees.filter(tree => tree.species === species);
      const mesh = new THREE.InstancedMesh(createTreeGeometry(species, false), material, batch.length);
      mesh.name = 'valley-trees-' + species;
      batch.forEach((tree, i) => {
        dummy.position.set(tree.x, tree.y, tree.z);
        dummy.rotation.set(0, tree.rotY, 0);
        dummy.scale.setScalar(tree.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      // Instances are spread along the whole course but the base geometry sits at
      // the origin, so the default per-mesh bounding sphere would cull the forest
      // once the camera moves down-course. The batches are static and span the map.
      mesh.frustumCulled = false;
      this.treeMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /**
   * Corridor ribbon: one ring per 25m centreline sample across the CORRIDOR_STOPS
   * cross-track ladder, each vertex lifted from the analytic getHeight(), so the rock
   * the pilot sees is the rock the collision probes test. Stops beyond the reachable
   * flank blend onto the coarse grid, which resumes exactly where the cull ends.
   */
  buildCorridorRibbon(material, readCoarse = null) {
    const centerline = this.terrain?.centerline;
    if (!Array.isArray(centerline) || centerline.length < 2 || typeof this.terrain.place !== 'function') return;
    const terrain = this.terrain;
    const first = centerline[0], last = centerline[centerline.length - 1];
    const stepM = (last.s - first.s) / (centerline.length - 1);

    // Rings run from reach behind the start line to reach past the finish, so the
    // culled coarse band is always covered and neither end of the tube is open.
    const rings = [];
    for (let k = RIBBON_END_RINGS; k > 0; k--) {
      const tangent = ribbonTangent(first, -1);
      rings.push({ s: first.s - k * stepM, halfWidth: first.halfWidth,
        shift: { x: tangent.x * k * stepM, z: tangent.z * k * stepM } });
    }
    for (const sample of centerline) {
      rings.push({ s: sample.s, halfWidth: sample.halfWidth, shift: null });
    }
    for (let k = 1; k <= RIBBON_END_RINGS; k++) {
      const tangent = ribbonTangent(last, 1);
      rings.push({ s: last.s + k * stepM, halfWidth: last.halfWidth,
        shift: { x: tangent.x * k * stepM, z: tangent.z * k * stepM } });
    }

    const stops = CORRIDOR_STOPS;
    const vertCount = rings.length * stops.length;
    const positions = new Float32Array(vertCount * 3);
    const skirtSpan = RIBBON_BLEND_TO - RIBBON_BLEND_FROM;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      for (let c = 0; c < stops.length; c++) {
        const at = terrain.place(ring.s, stops[c] * ring.halfWidth);
        const x = at.x + (ring.shift ? ring.shift.x : 0);
        const z = at.z + (ring.shift ? ring.shift.z : 0);
        let y = terrain.getHeight(x, z);
        const out = Math.abs(stops[c]);
        if (readCoarse && out > RIBBON_BLEND_FROM) {
          const coarse = readCoarse(x, z);
          if (coarse !== null) {
            const u = Math.min(1, (out - RIBBON_BLEND_FROM) / skirtSpan);
            const share = u * u * (3 - 2 * u);
            y += (coarse - y) * share;
          }
        }
        const v = (r * stops.length + c) * 3;
        positions[v] = x;
        positions[v + 1] = y;
        positions[v + 2] = z;
      }
    }

    const indices = [];
    for (let r = 0; r < rings.length - 1; r++) {
      for (let c = 0; c < stops.length - 1; c++) {
        const a = r * stops.length + c, b = a + 1, d = a + stops.length, e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const norm = geometry.attributes.normal;
    const colors = new Float32Array(vertCount * 3);
    const tmpColor = new THREE.Color();
    for (let v = 0; v < vertCount; v++) {
      shadeSurfaceVertex(tmpColor, positions[v * 3 + 1], norm.getY(v), positions[v * 3], positions[v * 3 + 2]);
      colors[v * 3] = tmpColor.r;
      colors[v * 3 + 1] = tmpColor.g;
      colors[v * 3 + 2] = tmpColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    this.ribbonRings = rings.length;
    this.ribbonMesh = new THREE.Mesh(geometry, material);
    this.ribbonMesh.receiveShadow = true;
    this.ribbonMesh.castShadow = false;
    this.mesh.add(this.ribbonMesh);
  }

  isWater() { return false; }

  getHeight(x, z) {
    return this.terrain.getHeight(x, z);
  }

  getNormal(x, z) {
    return this.terrain.getNormal ? this.terrain.getNormal(x, z) : new THREE.Vector3(0, 1, 0);
  }

  dispose(sim = null) {
    for (const mesh of this.treeMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    if (this.treeMeshes.length) {
      this.treeMeshes[0].material.dispose();
      this.treeMeshes = [];
    }
    if (this.ribbonMesh) {
      this.ribbonMesh.geometry.dispose();
      this.ribbonMesh = null;
    }
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach(m => m.dispose());
      } else {
        this.mesh.material.dispose();
      }
      this.mesh = null;
    }
    const scene = sim?.scene;
    if (scene && this.group) {
      scene.remove(this.group);
    }
  }
}
