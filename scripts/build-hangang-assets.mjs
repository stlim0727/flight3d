// Builds optimized binary GLB 3D models for the Hangang Seoul scenery.
// Run: node scripts/build-hangang-assets.mjs
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HANGANG_COURSE } from '../src/config/hangangCourse.js';
import { pavilionMatrix } from '../src/environment/nodeulPavilion.js';
import { bakePavilionHeights, readGlbTriangles } from './lib/nodeul-pavilion-heights.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

const outputDir = new URL('../public/models/hangang/', import.meta.url);
await mkdir(outputDir, { recursive: true });

function computeBounds(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

async function exportGLB(group, filename) {
  const exporter = new GLTFExporter();
  const bytes = await exporter.parseAsync(group, { binary: true });
  await writeFile(new URL(filename, outputDir), Buffer.from(bytes));
  console.log(`Saved ${filename}: ${bytes.byteLength} bytes`);
  return {
    bytes: bytes.byteLength,
    bounds: computeBounds(group),
  };
}

// 1. Yeouido Landmarks (63 Building, Parc.1, IFC, National Assembly, LG Twin Towers, skyline)
function buildYeouidoModel() {
  const group = new THREE.Group();
  group.name = 'Yeouido 3D Landmarks';

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd69930,
    metalness: 0.88,
    roughness: 0.2,
    emissive: 0x3d2503,
  });
  const darkGlassMat = new THREE.MeshStandardMaterial({
    color: 0x182028,
    metalness: 0.8,
    roughness: 0.25,
    emissive: 0x111c24,
  });
  const parcRedMat = new THREE.MeshStandardMaterial({
    color: 0xd41919,
    metalness: 0.35,
    roughness: 0.35,
    emissive: 0x330000,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x30353a,
    roughness: 0.85,
  });
  const copperDomeMat = new THREE.MeshStandardMaterial({
    color: 0x38886f,
    metalness: 0.2,
    roughness: 0.65,
    emissive: 0x0d281e,
  });
  const obsDeckMat = new THREE.MeshBasicMaterial({ color: 0xffe290 });

  // 1.1 63 Building (249.6m)
  {
    const b63 = new THREE.Group();
    b63.name = '63_Building';
    b63.position.set(780, 0, -350);

    const mainBody = new THREE.Mesh(new THREE.BoxGeometry(48, 218, 30), goldMat);
    mainBody.position.y = 109;
    b63.add(mainBody);

    // Beveled sloping crown
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(14, 23, 30, 4), goldMat);
    crown.rotation.y = Math.PI / 4;
    crown.position.y = 218 + 15;
    b63.add(crown);

    // Observation deck
    const obs = new THREE.Mesh(new THREE.BoxGeometry(49, 12, 31), obsDeckMat);
    obs.position.y = 205;
    b63.add(obs);

    group.add(b63);
  }

  // 1.2 Parc.1 Tower A & B
  {
    const parc = new THREE.Group();
    parc.name = 'Parc1';
    parc.position.set(910, 0, -120);

    // Tower A (338m)
    const towerA = new THREE.Mesh(new THREE.BoxGeometry(46, 338, 46), darkGlassMat);
    towerA.position.set(0, 169, 0);
    parc.add(towerA);

    for (const sx of [-23.5, 23.5]) {
      for (const sz of [-23.5, 23.5]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(3.5, 338, 3.5), parcRedMat);
        col.position.set(sx, 169, sz);
        parc.add(col);
      }
    }

    // Tower B (256m)
    const towerB = new THREE.Mesh(new THREE.BoxGeometry(40, 256, 40), darkGlassMat);
    towerB.position.set(65, 128, 60);
    parc.add(towerB);

    for (const sx of [-20.5, 20.5]) {
      for (const sz of [-20.5, 20.5]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(3, 256, 3), parcRedMat);
        col.position.set(65 + sx, 128, 60 + sz);
        parc.add(col);
      }
    }
    group.add(parc);
  }

  // 1.3 IFC Towers (284m, 186m, 178m)
  {
    const ifc = new THREE.Group();
    ifc.name = 'IFC_Seoul';
    ifc.position.set(1040, 0, -120);

    const heights = [284, 186, 178];
    const offsets = [[0, 0], [0, -70], [0, -140]];
    const sizes = [44, 38, 36];

    for (let i = 0; i < 3; i++) {
      const h = heights[i], s = sizes[i], [ox, oz] = offsets[i];
      const tower = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), darkGlassMat);
      tower.position.set(ox, h / 2, oz);
      ifc.add(tower);

      const crown = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.35, s * 0.7, 16, 4), darkGlassMat);
      crown.rotation.y = Math.PI / 4;
      crown.position.set(ox, h + 8, oz);
      ifc.add(crown);
    }
    group.add(ifc);
  }

  // 1.4 National Assembly Building
  {
    const na = new THREE.Group();
    na.name = 'National_Assembly';
    na.position.set(780, 0, 520);

    const hall = new THREE.Mesh(new THREE.BoxGeometry(110, 32, 75), concreteMat);
    hall.position.y = 16;
    na.add(hall);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), copperDomeMat);
    dome.position.y = 32;
    na.add(dome);

    const podium = new THREE.Mesh(new THREE.BoxGeometry(130, 4, 95), concreteMat);
    podium.position.y = 2;
    na.add(podium);

    group.add(na);
  }

  // 1.5 LG Twin Towers
  {
    const lg = new THREE.Group();
    lg.name = 'LG_Twin_Towers';
    lg.position.set(740, 0, -50);
    for (const oz of [-20, 20]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(28, 144, 28), darkGlassMat);
      tower.position.set(0, 72, oz);
      lg.add(tower);

      const redCrown = new THREE.Mesh(new THREE.BoxGeometry(28, 6, 28), parcRedMat);
      redCrown.position.set(0, 147, oz);
      lg.add(redCrown);
    }
    group.add(lg);
  }

  // 1.6 Yeouido Urban Highrises
  {
    const skylineParts = [];
    for (let i = 0; i < 65; i++) {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const x = 700 + col * 55 + ((i * 37) % 35);
      const z = -450 + row * 90 + ((i * 53) % 45);
      const h = 45 + ((i * 47) % 115);
      const w = 26 + (i % 16);
      const d = 24 + ((i * 7) % 18);

      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(x, h / 2, z);
      skylineParts.push(geo);
    }
    const merged = mergeGeometries(skylineParts);
    group.add(new THREE.Mesh(merged, darkGlassMat));
  }

  return group;
}

// 2. Namsan & N Seoul Tower (243m hill + 236m tower)
function buildNamsanModel() {
  const group = new THREE.Group();
  group.name = 'Namsan_N_Seoul_Tower';
  group.position.set(-1550, 0, -2100);

  // Mount Namsan natural hill landform
  const hillGeo = new THREE.ConeGeometry(680, 243, 28, 6);
  hillGeo.translate(0, 121.5, 0);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x141f17, roughness: 0.95 });
  group.add(new THREE.Mesh(hillGeo, hillMat));

  // N Seoul Tower
  const towerGroup = new THREE.Group();
  towerGroup.position.y = 243;

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x30353a, roughness: 0.85 });
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0xdde2e5, roughness: 0.4 });
  const obsDeckMat = new THREE.MeshStandardMaterial({
    color: 0x00d4ff,
    emissive: 0x007799,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const spireMat = new THREE.MeshStandardMaterial({ color: 0xb5bec4, roughness: 0.3 });

  // Base plaza
  const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 24, 14, 8), concreteMat);
  base.position.y = 7;
  towerGroup.add(base);

  // Tower column
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 7.5, 95, 12), shaftMat);
  shaft.position.y = 14 + 47.5;
  towerGroup.add(shaft);

  // Observation deck disc
  const obs = new THREE.Mesh(new THREE.CylinderGeometry(15, 13, 16, 16), obsDeckMat);
  obs.position.y = 14 + 95 + 8;
  towerGroup.add(obs);

  // Transmission antenna spire
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 3.2, 110, 8), spireMat);
  antenna.position.y = 14 + 95 + 16 + 55;
  towerGroup.add(antenna);

  group.add(towerGroup);
  return group;
}

// 3. Lotte World Tower (555m)
function buildLotteTowerModel() {
  const group = new THREE.Group();
  group.name = 'Lotte_World_Tower';
  group.position.set(2200, 0, -6400);

  const lotteGeo = new THREE.CylinderGeometry(9, 32, 555, 16);
  lotteGeo.translate(0, 277.5, 0);
  const lotteMat = new THREE.MeshStandardMaterial({
    color: 0xcfd6dc,
    metalness: 0.85,
    roughness: 0.18,
    emissive: 0x223548,
    emissiveIntensity: 0.5,
  });
  group.add(new THREE.Mesh(lotteGeo, lotteMat));

  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 9, 25, 12),
    new THREE.MeshBasicMaterial({ color: 0xdff4ff })
  );
  crown.position.y = 555 + 12.5;
  group.add(crown);

  return group;
}

// 4. Bridges & Nodeulseom Kit
function buildBridgesModel() {
  const group = new THREE.Group();
  group.name = 'Bridges_Kit';

  // Nodeulseom Island; HangangRun collides with the same course data.
  const island = HANGANG_COURSE.nodeulseom;
  const nodeul = new THREE.Group();
  nodeul.position.set(island.x, 0, island.z);

  const islandGeo = new THREE.CylinderGeometry(island.topRadius, island.bottomRadius, island.height, 24);
  islandGeo.scale(1.0, 1.0, island.zScale);
  islandGeo.translate(0, island.height / 2, 0);
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x18241b, roughness: 0.95 });
  nodeul.add(new THREE.Mesh(islandGeo, islandMat));
  group.add(nodeul);

  return group;
}

// Build all GLB assets and output manifest
const manifest = {};
manifest['yeouido-landmarks'] = {
  url: 'models/hangang/yeouido-landmarks.glb',
  ...(await exportGLB(buildYeouidoModel(), 'yeouido-landmarks.glb')),
};
manifest['namsan-tower'] = {
  url: 'models/hangang/namsan-tower.glb',
  ...(await exportGLB(buildNamsanModel(), 'namsan-tower.glb')),
};
manifest['lotte-tower'] = {
  url: 'models/hangang/lotte-tower.glb',
  ...(await exportGLB(buildLotteTowerModel(), 'lotte-tower.glb')),
};
manifest['bridges-kit'] = {
  url: 'models/hangang/bridges-kit.glb',
  ...(await exportGLB(buildBridgesModel(), 'bridges-kit.glb')),
};

// 5. Nodeulseom pavilion: third-party GLB shipped unmodified (see nodeul-pavilion.LICENSE.txt).
// Its collision heightfield is rebaked from the same bytes players see.
const island = HANGANG_COURSE.nodeulseom;
const pavilionBytes = await readFile(new URL('nodeul-pavilion.glb', outputDir));
const pavilionBounds = new THREE.Box3().setFromPoints(readGlbTriangles(pavilionBytes, pavilionMatrix(island)).flat());
manifest['nodeul-pavilion'] = {
  url: 'models/hangang/nodeul-pavilion.glb',
  bytes: pavilionBytes.byteLength,
  bounds: { min: pavilionBounds.min.toArray(), max: pavilionBounds.max.toArray() },
};
const heightsPath = new URL('../src/config/nodeulPavilionHeights.json', import.meta.url);
await writeFile(heightsPath, JSON.stringify(bakePavilionHeights(pavilionBytes, island)) + '\n');
console.log('Nodeulseom pavilion heightfield written to', heightsPath.pathname);

const manifestPath = new URL('../src/environment/hangangAssetManifest.json', import.meta.url);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Hangang asset manifest written to', manifestPath.pathname);
