import * as THREE from 'three';
import { riverCenter, hangangHeight } from '../config/hangangCourse.js';

/**
 * Creates a circular Gaussian soft glow sprite texture using pure DataTexture (headless-safe).
 */
export function createLightPointTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = (x - center) / radius;
      const dy = (y - center) / radius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1.0) {
        const falloff = Math.pow(1.0 - dist, 1.8);
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.floor(falloff * 255);
      } else {
        data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
      }
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates procedural architectural window textures for night buildings.
 */
function createSeoulWindowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const emissive = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const isFloor = (y % 8) < 4;
    for (let x = 0; x < size; x++) {
      const isWindow = isFloor && (x % 6) < 4;
      const idx = (y * size + x) * 4;
      if (isWindow) {
        const warm = (x * 17 + y * 23) % 10 > 3;
        const r = warm ? 255 : 200;
        const g = warm ? 215 : 235;
        const b = warm ? 160 : 255;
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
        emissive[idx] = Math.floor(r * 0.7);
        emissive[idx + 1] = Math.floor(g * 0.7);
        emissive[idx + 2] = Math.floor(b * 0.7);
        emissive[idx + 3] = 255;
      } else {
        data[idx] = 24; data[idx + 1] = 28; data[idx + 2] = 34; data[idx + 3] = 255;
        emissive[idx] = emissive[idx + 1] = emissive[idx + 2] = 0;
        emissive[idx + 3] = 255;
      }
    }
  }

  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const emissiveMap = new THREE.DataTexture(emissive, size, size, THREE.RGBAFormat);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.needsUpdate = true;

  return { map, emissiveMap };
}

/**
 * Builds Seoul cityscape scenery focused on the iconic Yeouido–Yongsan–Namsan Han River corridor:
 * - Yeouido Financial District (63 Building, Parc.1, IFC, National Assembly, LG Twin Towers)
 * - Mount Namsan & N Seoul Tower silhouette
 * - Lotte World Tower in the distant eastern horizon
 * - Nodeulseom cultural island
 * - Gangbyeonbuk-ro & Olympic-daero expressway traffic arteries
 * - Dense ~12,000 city light points cloud with authentic sodium & LED temperatures
 */
export function createSeoulScenery() {
  const group = new THREE.Group();
  group.name = 'Seoul Han River Scenery';

  const strobes = [];
  const { map: windowMap, emissiveMap: windowEmissiveMap } = createSeoulWindowTexture();

  // Shared Materials
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.9 });
  const darkGlassMat = new THREE.MeshStandardMaterial({
    color: 0x182028,
    roughness: 0.25,
    metalness: 0.8,
    map: windowMap,
    emissiveMap: windowEmissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0.75,
  });
  const goldGlassMat = new THREE.MeshStandardMaterial({
    color: 0xd69930,
    roughness: 0.2,
    metalness: 0.88,
    emissive: 0x3d2503,
    emissiveIntensity: 0.4,
  });
  const parcRedMat = new THREE.MeshStandardMaterial({
    color: 0xd41919,
    roughness: 0.35,
    metalness: 0.3,
    emissive: 0x330000,
  });
  const copperDomeMat = new THREE.MeshStandardMaterial({
    color: 0x38886f,
    roughness: 0.65,
    metalness: 0.2,
    emissive: 0x0f2d22,
  });
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xff1525 });

  // 1. Yeouido Landmarks (South Bank, +X)
  const yeouidoGroup = new THREE.Group();
  yeouidoGroup.name = 'Yeouido Landmarks';

  // 1.1 63 Building (63빌딩 / 63스퀘어, 249.6m)
  {
    const b63Group = new THREE.Group();
    b63Group.position.set(780, 8, -350);

    // Main golden tower body
    const mainBody = new THREE.Mesh(new THREE.BoxGeometry(48, 218, 30), goldGlassMat);
    mainBody.position.y = 109;
    mainBody.castShadow = true;
    b63Group.add(mainBody);

    // Beveled sloping crown
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(14, 23, 30, 4), goldGlassMat);
    crown.rotation.y = Math.PI / 4;
    crown.position.y = 218 + 15;
    b63Group.add(crown);

    // Observation deck warm glow band (60F)
    const obsDeck = new THREE.Mesh(
      new THREE.BoxGeometry(49, 12, 31),
      new THREE.MeshBasicMaterial({ color: 0xffe290 })
    );
    obsDeck.position.y = 205;
    b63Group.add(obsDeck);

    // Obstruction Strobe
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), strobeMat);
    beacon.position.y = 250;
    b63Group.add(beacon);
    strobes.push(beacon);

    yeouidoGroup.add(b63Group);
  }

  // 1.2 Parc.1 Towers (파크원 Tower A 338m & Tower B 256m)
  {
    const parcGroup = new THREE.Group();
    parcGroup.position.set(910, 8, -120);

    // Tower A (338m)
    const towerA = new THREE.Mesh(new THREE.BoxGeometry(46, 338, 46), darkGlassMat);
    towerA.position.set(0, 169, 0);
    towerA.castShadow = true;
    parcGroup.add(towerA);

    // Tower A Red Corner Trusses (signature Richard Rogers exterior red steel frames)
    for (const sx of [-23.5, 23.5]) {
      for (const sz of [-23.5, 23.5]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(3.5, 338, 3.5), parcRedMat);
        col.position.set(sx, 169, sz);
        parcGroup.add(col);
      }
    }
    const beaconA = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), strobeMat);
    beaconA.position.set(0, 340, 0);
    parcGroup.add(beaconA);
    strobes.push(beaconA);

    // Tower B (256m)
    const towerB = new THREE.Mesh(new THREE.BoxGeometry(40, 256, 40), darkGlassMat);
    towerB.position.set(65, 128, 60);
    towerB.castShadow = true;
    parcGroup.add(towerB);

    for (const sx of [-20.5, 20.5]) {
      for (const sz of [-20.5, 20.5]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(3, 256, 3), parcRedMat);
        col.position.set(65 + sx, 128, 60 + sz);
        parcGroup.add(col);
      }
    }
    const beaconB = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), strobeMat);
    beaconB.position.set(65, 258, 60);
    parcGroup.add(beaconB);
    strobes.push(beaconB);

    yeouidoGroup.add(parcGroup);
  }

  // 1.3 Three IFC (Three IFC 284m, Two IFC 186m, One IFC 178m)
  {
    const ifcGroup = new THREE.Group();
    ifcGroup.position.set(1040, 8, -120);

    const heights = [284, 186, 178];
    const offsets = [[0, 0], [0, -70], [0, -140]];
    const sizes = [44, 38, 36];

    for (let i = 0; i < 3; i++) {
      const h = heights[i], s = sizes[i], [ox, oz] = offsets[i];
      const tower = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), darkGlassMat);
      tower.position.set(ox, h / 2, oz);
      tower.castShadow = true;
      ifcGroup.add(tower);

      // Slanted crystal roof crown
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(s * 0.35, s * 0.7, 16, 4),
        new THREE.MeshStandardMaterial({ color: 0x4488aa, roughness: 0.1, metalness: 0.9 })
      );
      crown.rotation.y = Math.PI / 4;
      crown.position.set(ox, h + 8, oz);
      ifcGroup.add(crown);

      const beacon = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), strobeMat);
      beacon.position.set(ox, h + 18, oz);
      ifcGroup.add(beacon);
      strobes.push(beacon);
    }
    yeouidoGroup.add(ifcGroup);
  }

  // 1.4 National Assembly Building (국회의사당)
  {
    const naGroup = new THREE.Group();
    naGroup.position.set(780, 8, 520);

    // Classical Main Hall
    const hall = new THREE.Mesh(new THREE.BoxGeometry(110, 32, 75), concreteMat);
    hall.position.y = 16;
    hall.castShadow = true;
    naGroup.add(hall);

    // Green Copper Hemispherical Dome
    const domeGeo = new THREE.SphereGeometry(15, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, copperDomeMat);
    dome.position.y = 32;
    naGroup.add(dome);

    // Base podium
    const podium = new THREE.Mesh(new THREE.BoxGeometry(130, 4, 95), concreteMat);
    podium.position.y = 2;
    naGroup.add(podium);

    yeouidoGroup.add(naGroup);
  }

  // 1.5 LG Twin Towers (144m each)
  {
    const lgGroup = new THREE.Group();
    lgGroup.position.set(740, 8, -50);
    for (const oz of [-20, 20]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(28, 144, 28), darkGlassMat);
      tower.position.set(0, 72, oz);
      tower.castShadow = true;
      lgGroup.add(tower);

      const crown = new THREE.Mesh(
        new THREE.BoxGeometry(28, 6, 28),
        new THREE.MeshBasicMaterial({ color: 0xb51230 })
      );
      crown.position.set(0, 147, oz);
      lgGroup.add(crown);
    }
    yeouidoGroup.add(lgGroup);
  }

  // 1.6 Yeouido Secondary Skyline (Instanced Towers)
  {
    const count = 65;
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const instancedMesh = new THREE.InstancedMesh(towerGeo, darkGlassMat, count);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const x = 700 + col * 55 + ((i * 37) % 35);
      const z = -450 + row * 90 + ((i * 53) % 45);
      const h = 45 + ((i * 47) % 115);
      const w = 26 + (i % 16);
      const d = 24 + ((i * 7) % 18);

      pos.set(x, 8 + h / 2, z);
      scale.set(w, h, d);
      matrix.compose(pos, quat, scale);
      instancedMesh.setMatrixAt(i, matrix);
    }
    instancedMesh.castShadow = true;
    yeouidoGroup.add(instancedMesh);
  }

  group.add(yeouidoGroup);

  // 2. North Bank & Namsan Landmark (강북 용산 & 남산타워)
  const namsanGroup = new THREE.Group();
  namsanGroup.name = 'Namsan & N Seoul Tower';
  namsanGroup.position.set(-1550, 0, -2100);

  // 2.1 Mount Namsan Terrain Mound (Organic hill rising to 243m)
  {
    const hillGeo = new THREE.ConeGeometry(680, 243, 28, 6);
    hillGeo.translate(0, 121.5, 0);
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x141f17, roughness: 0.95 });
    const hill = new THREE.Mesh(hillGeo, hillMat);
    namsanGroup.add(hill);
  }

  // 2.2 N Seoul Tower (N서울타워, 236.7m tower atop 243m peak -> ~480m elevation)
  {
    const towerBaseY = 243;
    const towerGroup = new THREE.Group();
    towerGroup.position.y = towerBaseY;

    // Plaza & base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 24, 14, 8), concreteMat);
    base.position.y = 7;
    towerGroup.add(base);

    // Tower Column
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 7.5, 95, 12),
      new THREE.MeshStandardMaterial({ color: 0xdde2e5, roughness: 0.4 })
    );
    shaft.position.y = 14 + 47.5;
    towerGroup.add(shaft);

    // Observation Deck Disc (Glowing fine-dust turquoise/cyan)
    const obsDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 13, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0x00d4ff,
        emissive: 0x007799,
        emissiveIntensity: 0.85,
        roughness: 0.2,
      })
    );
    obsDeck.position.y = 14 + 95 + 8;
    towerGroup.add(obsDeck);

    // Antenna Transmission Spire
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 3.2, 110, 8),
      new THREE.MeshStandardMaterial({ color: 0xb5bec4, roughness: 0.3 })
    );
    antenna.position.y = 14 + 95 + 16 + 55;
    towerGroup.add(antenna);

    // Flashing Strobe Beacon at Summit (~480m)
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), strobeMat);
    beacon.position.y = 14 + 95 + 16 + 110;
    towerGroup.add(beacon);
    strobes.push(beacon);

    namsanGroup.add(towerGroup);
  }
  group.add(namsanGroup);

  // 3. Eastern Horizon: Lotte World Tower (롯데월드타워, 555m at Jamsil)
  {
    const lotteGroup = new THREE.Group();
    lotteGroup.position.set(2200, 8, -6400);

    const lotteGeo = new THREE.CylinderGeometry(9, 32, 555, 16);
    lotteGeo.translate(0, 277.5, 0);
    const lotteMat = new THREE.MeshStandardMaterial({
      color: 0xcfd6dc,
      metalness: 0.85,
      roughness: 0.18,
      emissive: 0x223548,
      emissiveIntensity: 0.5,
    });
    const lotteTower = new THREE.Mesh(lotteGeo, lotteMat);
    lotteGroup.add(lotteTower);

    // Crown lantern
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 9, 25, 12),
      new THREE.MeshBasicMaterial({ color: 0xdff4ff })
    );
    crown.position.y = 555 + 12.5;
    lotteGroup.add(crown);

    const beacon = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), strobeMat);
    beacon.position.y = 570;
    lotteGroup.add(beacon);
    strobes.push(beacon);

    group.add(lotteGroup);
  }

  // 4. Nodeulseom Cultural Island (노들섬, at Central Bridge x: 200, z: -1700)
  {
    const nodeulGroup = new THREE.Group();
    nodeulGroup.position.set(200, 0, -1700);

    // Oval island plateau
    const islandGeo = new THREE.CylinderGeometry(70, 75, 4, 24);
    islandGeo.scale(1.0, 1.0, 2.4); // Stretched along the river corridor (360m in Z)
    islandGeo.translate(0, 2, 0);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x18241b, roughness: 0.95 });
    const island = new THREE.Mesh(islandGeo, islandMat);
    island.receiveShadow = true;
    nodeulGroup.add(island);

    // Nodeul Live House / Art Center complex
    const pavilion = new THREE.Mesh(
      new THREE.BoxGeometry(45, 9, 80),
      new THREE.MeshStandardMaterial({
        color: 0x262b2e,
        roughness: 0.7,
        emissive: 0x3d2914,
        emissiveIntensity: 0.6,
      })
    );
    pavilion.position.set(0, 8.5, 0);
    nodeulGroup.add(pavilion);

    group.add(nodeulGroup);
  }

  // 5. Expressways & Highway Traffic (강변북로 & 올림픽대로)
  {
    const roadGroup = new THREE.Group();
    roadGroup.name = 'Han River Expressways';

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.95 });
    const headLightMat = new THREE.MeshBasicMaterial({ color: 0xfff0c4 });
    const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });

    for (const side of [-1, 1]) {
      // side = -1: Gangbyeonbuk-ro (North), side = 1: Olympic-daero (South)
      const pts = [];
      const zStart = 1600, zEnd = -6200, step = 100;
      for (let z = zStart; z >= zEnd; z -= step) {
        const x = riverCenter(z) + side * 505;
        const y = 8.1;
        pts.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);

      // Roadway surface
      const roadGeo = new THREE.TubeGeometry(curve, 78, 14, 4, false);
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadGroup.add(roadMesh);

      // Flowing traffic streaks (Headlights and Taillights)
      const headPts = pts.map(p => new THREE.Vector3(p.x + (side > 0 ? 3.5 : -3.5), p.y + 0.35, p.z));
      const tailPts = pts.map(p => new THREE.Vector3(p.x + (side > 0 ? -3.5 : 3.5), p.y + 0.35, p.z));

      const headGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(headPts), 78, 0.45, 4, false);
      const tailGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 78, 0.45, 4, false);

      roadGroup.add(new THREE.Mesh(headGeo, headLightMat));
      roadGroup.add(new THREE.Mesh(tailGeo, tailLightMat));
    }
    group.add(roadGroup);
  }

  // 6. Seoul Metropolis Night Light Point Cloud (~12,000 Points)
  {
    const pointCount = 12000;
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);

    const cAmber = new THREE.Color(0xffaa40);   // Sodium streetlights
    const cWarm = new THREE.Color(0xffd578);    // Warm incandescent windows
    const cLed = new THREE.Color(0xd6eeff);     // Modern LED white/cyan

    let ptr = 0;
    // Generate street grid clusters on North and South sides of the Han River
    for (let i = 0; i < pointCount; i++) {
      const isSouth = (i % 2 === 0);
      const z = 1400 - Math.random() * 7400; // Z: 1400 down to -6000
      const center = riverCenter(z);

      // Distance away from river bank (>510m to 4800m)
      const dist = 520 + Math.pow(Math.random(), 1.4) * 4200;
      const x = center + (isSouth ? dist : -dist);

      // Road grid snap for authentic urban street pattern
      const gridX = Math.round(x / 75) * 75 + ((Math.random() - 0.5) * 16);
      const gridZ = Math.round(z / 75) * 75 + ((Math.random() - 0.5) * 16);
      const y = hangangHeight(gridX, gridZ) + 1.2 + Math.random() * 25.0;

      positions[ptr * 3] = gridX;
      positions[ptr * 3 + 1] = y;
      positions[ptr * 3 + 2] = gridZ;

      // Color distribution: ~60% Sodium Amber, ~25% LED white, ~15% Warm Incandescent
      const rPick = Math.random();
      const chosenColor = rPick < 0.60 ? cAmber : (rPick < 0.85 ? cLed : cWarm);
      const intensity = 0.7 + Math.random() * 0.5;

      colors[ptr * 3] = chosenColor.r * intensity;
      colors[ptr * 3 + 1] = chosenColor.g * intensity;
      colors[ptr * 3 + 2] = chosenColor.b * intensity;
      ptr++;
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointsMat = new THREE.PointsMaterial({
      size: 4.8,
      vertexColors: true,
      map: createLightPointTexture(32),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const lightPoints = new THREE.Points(pointsGeo, pointsMat);
    lightPoints.name = 'Seoul Metropolis Night Lights';
    group.add(lightPoints);
  }

  // Strobe beacon blinking logic
  let elapsed = 0;
  function update(dt) {
    elapsed += dt;
    // 1 Hz cycle: on for 0.2s, off for 0.8s
    const isOn = (elapsed % 1.0) < 0.2;
    strobeMat.color.setHex(isOn ? 0xff1525 : 0x220205);
  }

  return { group, update };
}
