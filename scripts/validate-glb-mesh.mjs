#!/usr/bin/env node
// Validate Three.js GLB meshes for geometry integrity:
// - Normalized normals (no NaN/Inf)
// - Outward-facing radome/nose normals
// - Non-inverted fin triangle winding
// - Fuselage longitudinal continuity under warning collars
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(result => {
        this.result = result;
        this.onloadend?.();
      });
    }
  };
}

export function parseGlbBuffer(arrayBuffer) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', gltf => resolve(gltf), reject);
  });
}

export async function validateGlbModel(arrayBuffer, modelName = 'model') {
  const gltf = await parseGlbBuffer(arrayBuffer);
  const errors = [];
  const stats = {
    name: modelName,
    meshes: 0,
    triangles: 0,
    materials: new Set(),
  };

  let bodyMesh = null;
  const warningBands = [];
  const finMeshes = [];
  let radomeMesh = null;

  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    stats.meshes++;
    const geo = node.geometry;
    const pos = geo?.attributes?.position;
    const norm = geo?.attributes?.normal;

    if (!pos || pos.count === 0) {
      errors.push(`Mesh "${node.name}" has empty or missing position attribute`);
      return;
    }

    const triCount = geo.index ? geo.index.count / 3 : pos.count / 3;
    stats.triangles += triCount;
    const matName = node.material?.name;
    if (matName) stats.materials.add(matName);

    // 1. Normal validity
    if (!norm) {
      errors.push(`Mesh "${node.name}" is missing normal attribute`);
    } else {
      for (let i = 0; i < norm.count; i++) {
        const nx = norm.getX(i);
        const ny = norm.getY(i);
        const nz = norm.getZ(i);
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
          errors.push(`Mesh "${node.name}" vertex ${i} has non-finite normal`);
          break;
        }
        const len = Math.hypot(nx, ny, nz);
        if (Math.abs(len - 1.0) > 0.05) {
          errors.push(`Mesh "${node.name}" vertex ${i} normal is not unit length (${len.toFixed(3)})`);
          break;
        }
      }
    }

    if (matName === 'missile-body') bodyMesh = node;
    else if (matName?.startsWith('missile-band-')) warningBands.push(node);
    else if (matName === 'missile-fin') finMeshes.push(node);
    else if (matName === 'missile-radome') radomeMesh = node;
  });

  // 2. Radome outward normal check
  if (radomeMesh) {
    const pos = radomeMesh.geometry.attributes.position;
    const norm = radomeMesh.geometry.attributes.normal;
    let inwardCount = 0;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const nx = norm.getX(i);
      const ny = norm.getY(i);
      const radialDist = Math.hypot(px, py);
      if (radialDist > 0.002) {
        const dot = px * nx + py * ny;
        if (dot < -0.0001) inwardCount++;
      }
    }
    if (inwardCount > 0) {
      errors.push(`Radome mesh "${radomeMesh.name}" has ${inwardCount} inward-pointing normals`);
    }
  }

  // 3. Fin triangle face normals & winding check
  for (const fin of finMeshes) {
    const geo = fin.geometry;
    const pos = geo.attributes.position;
    const index = geo.index;
    const triCount = (index ? index.count : pos.count) / 3;

    if (triCount === 0) {
      errors.push(`Fin mesh "${fin.name}" has no triangles`);
      continue;
    }

    // A. Compute signed polyhedron volume across the fin mesh:
    // For outward-facing CCW triangles, sum(A · (B × C)) / 6 must be positive.
    let totalSignedVolume = 0;
    let tipFacesChecked = 0;
    let inwardTipFaces = 0;

    // Find maximum radial distance from centerline for tip face identification
    let maxRadial = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      if (r > maxRadial) maxRadial = r;
    }
    const tipThreshold = maxRadial * 0.90;

    for (let i = 0; i < triCount; i++) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
      const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
      const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);

      // B x C
      const crossX = by * cz - bz * cy;
      const crossY = bz * cx - bx * cz;
      const crossZ = bx * cy - by * cx;

      // A · (B × C)
      totalSignedVolume += (ax * crossX + ay * crossY + az * crossZ);

      // Face normal: (B - A) × (C - A)
      const abX = bx - ax, abY = by - ay, abZ = bz - az;
      const acX = cx - ax, acY = cy - ay, acZ = cz - az;
      const fnX = abY * acZ - abZ * acY;
      const fnY = abZ * acX - abX * acZ;
      const fnZ = abX * acY - abY * acX;

      const triCenter = new THREE.Vector3((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
      const rCenter = Math.hypot(triCenter.x, triCenter.y);

      // B. For tip faces (outer perimeter), normal must point radially outward from centerline:
      if (rCenter >= tipThreshold) {
        tipFacesChecked++;
        const dotRadial = fnX * triCenter.x + fnY * triCenter.y;
        if (dotRadial < 0) {
          inwardTipFaces++;
        }
      }
    }

    totalSignedVolume /= 6.0;
    if (totalSignedVolume <= 0) {
      errors.push(`Fin mesh "${fin.name}" has negative signed volume (${totalSignedVolume.toExponential(3)}), indicating inverted triangle winding`);
    }
    if (tipFacesChecked > 0 && inwardTipFaces > 0) {
      errors.push(`Fin mesh "${fin.name}" has ${inwardTipFaces} tip face(s) pointing inward toward missile centerline`);
    }
  }

  // 4. Fuselage continuity under warning collars (actual longitudinal triangle coverage)
  if (bodyMesh && warningBands.length > 0) {
    const bodyGeo = bodyMesh.geometry;
    const bodyPos = bodyGeo.attributes.position;
    const bodyIndex = bodyGeo.index;
    const bodyTriCount = (bodyIndex ? bodyIndex.count : bodyPos.count) / 3;

    for (const band of warningBands) {
      const bandBox = new THREE.Box3().setFromObject(band);
      // Sample 5 test points across the band's longitudinal span
      const numSamples = 5;
      for (let s = 0; s < numSamples; s++) {
        const zTest = bandBox.min.z + (bandBox.max.z - bandBox.min.z) * (s / (numSamples - 1));
        let covered = false;

        for (let i = 0; i < bodyTriCount; i++) {
          const i0 = bodyIndex ? bodyIndex.getX(i * 3) : i * 3;
          const i1 = bodyIndex ? bodyIndex.getX(i * 3 + 1) : i * 3 + 1;
          const i2 = bodyIndex ? bodyIndex.getX(i * 3 + 2) : i * 3 + 2;

          const z0 = bodyPos.getZ(i0), z1 = bodyPos.getZ(i1), z2 = bodyPos.getZ(i2);
          const minZ = Math.min(z0, z1, z2);
          const maxZ = Math.max(z0, z1, z2);

          if (zTest >= minZ - 0.001 && zTest <= maxZ + 0.001) {
            covered = true;
            break;
          }
        }

        if (!covered) {
          errors.push(
            `Warning band "${band.name}" covers a hollow fuselage gap at z = ${zTest.toFixed(3)}m; no continuous body triangle spans this section`
          );
          break;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      ...stats,
      materials: Array.from(stats.materials),
    },
  };
}

export async function validateGlbFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`], stats: null };
  }
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return validateGlbModel(ab, path.basename(filePath));
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('validate-glb-mesh.mjs')) {
  const cliFiles = process.argv.slice(2);
  const targets = cliFiles.length > 0
    ? cliFiles
    : [
        'public/models/missiles/aim-9x.glb',
        'public/models/missiles/aim-120c.glb',
        'public/models/missile.glb',
        'public/models/missiles/pylon-wingtip.glb',
        'public/models/missiles/pylon-underwing.glb',
      ];

  let totalFailures = 0;
  for (const file of targets) {
    const result = await validateGlbFile(file);
    if (!result.valid) {
      console.error(`✖ ${file} FAILED validation:`);
      for (const err of result.errors) console.error(`  - ${err}`);
      totalFailures++;
    } else {
      console.log(`✔ ${file}: valid (${result.stats.triangles} tris, ${result.stats.meshes} meshes)`);
    }
  }

  if (totalFailures > 0) {
    process.exit(1);
  }
}
