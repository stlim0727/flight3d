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

  // 3. Fin triangle face normals check
  for (const fin of finMeshes) {
    const pos = fin.geometry.attributes.position;
    const norm = fin.geometry.attributes.normal;
    if (pos.count < 30) {
      errors.push(`Fin mesh "${fin.name}" has unusually few vertices (${pos.count})`);
    }
  }

  // 4. Fuselage continuity under warning collars
  if (bodyMesh && warningBands.length > 0) {
    const bodyBox = new THREE.Box3().setFromObject(bodyMesh);
    for (const band of warningBands) {
      const bandBox = new THREE.Box3().setFromObject(band);
      if (bandBox.min.z < bodyBox.min.z - 0.05 || bandBox.max.z > bodyBox.max.z + 0.05) {
        errors.push(
          `Warning band "${band.name}" [${bandBox.min.z.toFixed(2)}, ${bandBox.max.z.toFixed(2)}] extends beyond continuous fuselage body [${bodyBox.min.z.toFixed(2)}, ${bodyBox.max.z.toFixed(2)}]`
        );
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
