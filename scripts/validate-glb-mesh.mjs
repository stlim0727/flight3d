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
  // Ensure world matrices are up-to-date across all node transforms
  gltf.scene.updateMatrixWorld(true);
  // Compute inverse of scene root matrix so all geometric predicates can be
  // evaluated in the missile's common model frame, invariant to root translation/rotation.
  const invScene = gltf.scene.matrixWorld.clone().invert();

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
    else if (matName === 'missile-fin' && !node.name.toLowerCase().includes('pylon') && !modelName.toLowerCase().includes('pylon')) finMeshes.push(node);
    else if (matName === 'missile-radome') radomeMesh = node;
  });

  if (stats.meshes === 0) {
    errors.push('GLB scene contains no meshes');
  }

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

  // 3. Fin triangle face normals & individual triangle winding check (in missile model frame)
  for (const fin of finMeshes) {
    const geo = fin.geometry;
    const pos = geo.attributes.position;
    const index = geo.index;
    const triCount = (index ? index.count : pos.count) / 3;

    if (triCount === 0) {
      errors.push(`Fin mesh "${fin.name}" has no triangles`);
      continue;
    }

    // Transform from fin local space to missile root scene space
    const finToScene = new THREE.Matrix4().multiplyMatrices(invScene, fin.matrixWorld);

    let totalSignedVolume = 0;
    let invertedFaces = 0;

    for (let i = 0; i < triCount; i++) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      // Transform vertices to missile root model space
      const a = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(finToScene);
      const b = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(finToScene);
      const c = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(finToScene);

      // Signed volume contribution: A · (B × C)
      const crossX = b.y * c.z - b.z * c.y;
      const crossY = b.z * c.x - b.x * c.z;
      const crossZ = b.x * c.y - b.y * c.x;
      totalSignedVolume += (a.x * crossX + a.y * crossY + a.z * crossZ);

      // Triangle face normal
      const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const ct = new THREE.Vector3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);

      // Determine the fin blade orientation in missile frame (multiples of PI/4 = 45 deg)
      const angle = Math.atan2(ct.y, ct.x);
      const bladeAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);

      const rHat = new THREE.Vector3(Math.cos(bladeAngle), Math.sin(bladeAngle), 0);
      const tHat = new THREE.Vector3(-Math.sin(bladeAngle), Math.cos(bladeAngle), 0);
      const zHat = new THREE.Vector3(0, 0, 1);

      const lateralOffset = ct.dot(tHat);
      const fnLateral = fn.dot(tHat);
      const fnRadial = fn.dot(rHat);
      const fnZ = fn.dot(zHat);

      // An outward face satisfies:
      // Lateral face: (lateralOffset * fnLateral > 0)
      // Tip cap: fnRadial > 0.4
      // Trailing edge: fnZ > 0.4
      // Leading edge: fnZ < -0.2
      let outward = false;
      if (Math.abs(lateralOffset) > 0.0003 && Math.abs(fnLateral) > 0.2) {
        outward = (lateralOffset * fnLateral > 0);
      } else if (fnRadial > 0.4) {
        outward = true;
      } else if (fnZ > 0.4 || fnZ < -0.2) {
        outward = true;
      }

      if (!outward) {
        invertedFaces++;
      }
    }

    totalSignedVolume /= 6.0;
    if (totalSignedVolume <= 0) {
      errors.push(`Fin mesh "${fin.name}" has negative signed volume (${totalSignedVolume.toExponential(3)}), indicating inverted triangle winding`);
    }
    if (invertedFaces > 0) {
      errors.push(`Fin mesh "${fin.name}" has ${invertedFaces} triangle face(s) with inverted winding / inward normal`);
    }
  }

  // 4. Fuselage continuity under warning collars (evaluated in common missile scene frame)
  if (warningBands.length > 0) {
    if (!bodyMesh) {
      errors.push(
        `GLB contains ${warningBands.length} warning band(s) but no missile-body mesh to provide continuous fuselage beneath them`
      );
    } else {
      const bodyGeo = bodyMesh.geometry;
      const bodyPos = bodyGeo.attributes.position;
      const bodyIndex = bodyGeo.index;
      const bodyTriCount = (bodyIndex ? bodyIndex.count : bodyPos.count) / 3;
      const bodyToScene = new THREE.Matrix4().multiplyMatrices(invScene, bodyMesh.matrixWorld);

      for (const band of warningBands) {
        // Compute bounding box in missile scene space
        const bandToScene = new THREE.Matrix4().multiplyMatrices(invScene, band.matrixWorld);
        const bandBox = new THREE.Box3();
        const bPos = band.geometry.attributes.position;
        for (let i = 0; i < bPos.count; i++) {
          const v = new THREE.Vector3(bPos.getX(i), bPos.getY(i), bPos.getZ(i)).applyMatrix4(bandToScene);
          bandBox.expandByPoint(v);
        }

        const numSamples = 5;
        for (let s = 0; s < numSamples; s++) {
          const zTest = bandBox.min.z + (bandBox.max.z - bandBox.min.z) * (s / (numSamples - 1));
          let covered = false;

          for (let i = 0; i < bodyTriCount; i++) {
            const i0 = bodyIndex ? bodyIndex.getX(i * 3) : i * 3;
            const i1 = bodyIndex ? bodyIndex.getX(i * 3 + 1) : i * 3 + 1;
            const i2 = bodyIndex ? bodyIndex.getX(i * 3 + 2) : i * 3 + 2;

            const v0 = new THREE.Vector3(bodyPos.getX(i0), bodyPos.getY(i0), bodyPos.getZ(i0)).applyMatrix4(bodyToScene);
            const v1 = new THREE.Vector3(bodyPos.getX(i1), bodyPos.getY(i1), bodyPos.getZ(i1)).applyMatrix4(bodyToScene);
            const v2 = new THREE.Vector3(bodyPos.getX(i2), bodyPos.getY(i2), bodyPos.getZ(i2)).applyMatrix4(bodyToScene);

            const minZ = Math.min(v0.z, v1.z, v2.z);
            const maxZ = Math.max(v0.z, v1.z, v2.z);

            if (zTest >= minZ - 0.001 && zTest <= maxZ + 0.001) {
              covered = true;
              break;
            }
          }

          if (!covered) {
            errors.push(
              `Warning band "${band.name}" covers a hollow fuselage gap at z = ${zTest.toFixed(3)}m in missile frame; no continuous body triangle spans this section`
            );
            break;
          }
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
