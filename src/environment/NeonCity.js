import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEON_TOWERS, towerRecord } from '../config/neonBuildings.js';
import { NEON_RIVER, bridgeWorldBoxes, isLand, riverCenter, riverGroundHeight } from '../config/neonRiver.js';
import { isStreet, neonStreets } from '../config/neonRoads.js';
import { EXTENT as SEA_EXTENT, createNeonRiver } from './NeonRiver.js';
import { createNeonRoads } from './NeonRoads.js';

/**
 * Creates clean, sleek facade textures tailored to eliminate trypophobia.
 * Replaces high-frequency dot/slot perforations with smooth, elegant horizontal
 * ribbon glazing, vertical architectural fins, and velvety monoliths with thin amber floor lines.
 */
function createArchitecturalTextures() {
  const size = 128;

  // 1. Sleek Continuous Horizontal Ribbon Glazing
  // Uniform across X (zero vertical cuts or dots), two elegant architectural glass bands in Y.
  const ribbonData = new Uint8Array(size * size * 4);
  const ribbonEmissive = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const isBand1 = y >= 20 && y <= 34;
    const isBand2 = y >= 84 && y <= 98;
    const isBand = isBand1 || isBand2;
    const bandY = isBand1 ? (y - 20) / 14 : (y - 84) / 14;
    const bandEdge = isBand ? Math.sin(bandY * Math.PI) : 0;

    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (isBand) {
        // Soft pale ice-cyan / lavender glass ribbon
        const r = Math.floor(18 + 140 * bandEdge);
        const g = Math.floor(14 + 205 * bandEdge);
        const b = Math.floor(28 + 245 * bandEdge);
        ribbonData[idx] = r;
        ribbonData[idx + 1] = g;
        ribbonData[idx + 2] = b;
        ribbonData[idx + 3] = 255;

        ribbonEmissive[idx] = Math.floor(110 * bandEdge);
        ribbonEmissive[idx + 1] = Math.floor(175 * bandEdge);
        ribbonEmissive[idx + 2] = Math.floor(215 * bandEdge);
        ribbonEmissive[idx + 3] = 255;
      } else {
        // Deep obsidian plum spandrel wall
        ribbonData[idx] = 16;
        ribbonData[idx + 1] = 11;
        ribbonData[idx + 2] = 26;
        ribbonData[idx + 3] = 255;

        ribbonEmissive[idx] = 0;
        ribbonEmissive[idx + 1] = 0;
        ribbonEmissive[idx + 2] = 0;
        ribbonEmissive[idx + 3] = 255;
      }
    }
  }

  const ribbonMap = new THREE.DataTexture(ribbonData, size, size, THREE.RGBAFormat);
  ribbonMap.colorSpace = THREE.SRGBColorSpace;
  ribbonMap.wrapS = ribbonMap.wrapT = THREE.RepeatWrapping;
  ribbonMap.needsUpdate = true;

  const ribbonEmissiveMap = new THREE.DataTexture(ribbonEmissive, size, size, THREE.RGBAFormat);
  ribbonEmissiveMap.colorSpace = THREE.SRGBColorSpace;
  ribbonEmissiveMap.wrapS = ribbonEmissiveMap.wrapT = THREE.RepeatWrapping;
  ribbonEmissiveMap.needsUpdate = true;

  // 2. Vertical Architectural Neon Fins (e.g. Bank of China / Art Deco ribs)
  const finData = new Uint8Array(size * size * 4);
  const finEmissive = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Two crisp vertical structural fins in X
      const isFin1 = x >= 28 && x <= 34;
      const isFin2 = x >= 92 && x <= 98;
      const isFin = isFin1 || isFin2;

      if (isFin) {
        finData[idx] = 230;
        finData[idx + 1] = 95;
        finData[idx + 2] = 220;
        finData[idx + 3] = 255;

        finEmissive[idx] = 190;
        finEmissive[idx + 1] = 65;
        finEmissive[idx + 2] = 180;
        finEmissive[idx + 3] = 255;
      } else {
        finData[idx] = 18;
        finData[idx + 1] = 12;
        finData[idx + 2] = 30;
        finData[idx + 3] = 255;

        finEmissive[idx] = 0;
        finEmissive[idx + 1] = 0;
        finEmissive[idx + 2] = 0;
        finEmissive[idx + 3] = 255;
      }
    }
  }

  const finMap = new THREE.DataTexture(finData, size, size, THREE.RGBAFormat);
  finMap.colorSpace = THREE.SRGBColorSpace;
  finMap.wrapS = finMap.wrapT = THREE.RepeatWrapping;
  finMap.needsUpdate = true;

  const finEmissiveMap = new THREE.DataTexture(finEmissive, size, size, THREE.RGBAFormat);
  finEmissiveMap.colorSpace = THREE.SRGBColorSpace;
  finEmissiveMap.wrapS = finEmissiveMap.wrapT = THREE.RepeatWrapping;
  finEmissiveMap.needsUpdate = true;

  // 3. Monolith Sunset Amber Floor Line (#624)
  // One thin warm line per tile keeps the obsidian silhouette while lighting it.
  const amberData = new Uint8Array(size * size * 4);
  const amberEmissive = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const isLine = y >= 60 && y <= 65;
    const lineEdge = isLine ? Math.sin(((y - 60) / 5) * Math.PI) : 0;

    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Obsidian body 0x160e28 blending into amber 0xffb46a
      amberData[idx] = Math.floor(22 + 233 * lineEdge);
      amberData[idx + 1] = Math.floor(14 + 166 * lineEdge);
      amberData[idx + 2] = Math.floor(40 + 66 * lineEdge);
      amberData[idx + 3] = 255;

      // Glow 0xff9a3c
      amberEmissive[idx] = Math.floor(255 * lineEdge);
      amberEmissive[idx + 1] = Math.floor(154 * lineEdge);
      amberEmissive[idx + 2] = Math.floor(60 * lineEdge);
      amberEmissive[idx + 3] = 255;
    }
  }

  const amberMap = new THREE.DataTexture(amberData, size, size, THREE.RGBAFormat);
  amberMap.colorSpace = THREE.SRGBColorSpace;
  amberMap.wrapS = amberMap.wrapT = THREE.RepeatWrapping;
  amberMap.needsUpdate = true;

  const amberEmissiveMap = new THREE.DataTexture(amberEmissive, size, size, THREE.RGBAFormat);
  amberEmissiveMap.colorSpace = THREE.SRGBColorSpace;
  amberEmissiveMap.wrapS = amberEmissiveMap.wrapT = THREE.RepeatWrapping;
  amberEmissiveMap.needsUpdate = true;

  return {
    ribbon: { map: ribbonMap, emissiveMap: ribbonEmissiveMap },
    fin: { map: finMap, emissiveMap: finEmissiveMap },
    amber: { map: amberMap, emissiveMap: amberEmissiveMap },
  };
}

/**
 * Procedural Giant Celestial Moon with Cloud Silhouettes
 */
function createStylizedMoonTexture() {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const radius = 175;
  const glowRadius = 252;

  const clouds = [
    { cx: -50, cy: 35, r: 75 },
    { cx: 30,  cy: 50, r: 85 },
    { cx: -110, cy: 60, r: 60 },
    { cx: 95,  cy: 40, r: 70 },
    { cx: 0,   cy: 80, r: 90 },
    { cx: -20, cy: -10, r: 55 },
    { cx: 65,  cy: -5,  r: 50 },
  ];

  for (let y = 0; y < size; y++) {
    const dy = y - center;

    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dist = Math.hypot(dx, dy);
      const idx = (y * size + x) * 4;

      if (dist <= radius) {
        let cloudDistMin = Infinity;
        for (const c of clouds) {
          const d = Math.hypot(dx - c.cx, dy - c.cy) - c.r;
          cloudDistMin = Math.min(cloudDistMin, d);
        }

        const isCloud = cloudDistMin < 0;
        const cloudEdge = THREE.MathUtils.clamp(-cloudDistMin / 12.0, 0, 1);

        if (isCloud) {
          const cr = Math.floor(65 * cloudEdge + 255 * (1 - cloudEdge));
          const cg = Math.floor(12 * cloudEdge + 140 * (1 - cloudEdge));
          const cb = Math.floor(85 * cloudEdge + 240 * (1 - cloudEdge));
          data[idx] = cr;
          data[idx + 1] = cg;
          data[idx + 2] = cb;
          data[idx + 3] = 255;
        } else {
          const normD = dist / radius;
          const r = 255;
          const g = Math.floor(130 * (1 - normD) + 195 * normD);
          const b = Math.floor(225 * (1 - normD) + 245 * normD);

          const edgeBlend = THREE.MathUtils.clamp((radius - dist) / 2.0, 0, 1);
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = Math.floor(255 * edgeBlend);
        }
      } else if (dist <= glowRadius) {
        const glowT = (dist - radius) / (glowRadius - radius);
        const falloff = Math.pow(1.0 - glowT, 2.0);

        data[idx] = Math.floor(255 * falloff);
        data[idx + 1] = Math.floor(80 * falloff);
        data[idx + 2] = Math.floor(220 * falloff);
        data[idx + 3] = Math.floor(180 * falloff);
      } else {
        data[idx + 3] = 0;
      }
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * NeonCity: A stylized Lofi / Synthwave Anime Metropolis
 * with organic, asymmetric urban clustering, varied architectural archetypes,
 * and elegant continuous ribbon glazing (zero trypophobic dot patterns).
 */
export class NeonCity {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'neon-metropolis';
    this.elevation = 0.0;
    this.buildingData = [];
    this.strobes = [];

    this.terrain = {
      mesh: this.group,
      isLoaded: true,
      getHeight: (x, z) => this.getHeight(x, z),
      getNormal: (x, z) => this.getNormal(x, z),
      // One sea runs under the island at the canal's level (#551, #628). Reporting it under
      // the street too keeps the street well above its water, so the shared water checks
      // (CollisionDetector, WaterDitching, remote crashes) never call a street crash water (#458, #648).
      getWaterLevel: () => NEON_RIVER.waterLevel,
    };

    this.airport = {
      group: this.group,
      elevation: this.elevation,
      isOnRunway: (x, z) => this.isOnRunway(x, z),
      isRunwaySafetyArea: (x, z) => this.isRunwaySafetyArea(x, z),
      controlTowerData: { x: 300, y: 0, z: 220, radius: 16, height: 260 },
      update: (dt, pos, time) => this.update(dt, pos, time),
    };

    this.initStylizedSky();
    this.initStarsAndShootingStars();
    this.initGroundAndRoads();
    this.initStreetLightingAndGantries();
    this.initSkyscrapers();
    this.initRetroSun();
  }

  // The street, or the water of the canal and the sea around the island.
  getHeight(x, z) {
    return riverGroundHeight(x, z);
  }

  getNormal(x, z) {
    return new THREE.Vector3(0, 1, 0);
  }

  isOnRunway(x, z) {
    return x >= -2400 && x <= 1800 && Math.abs(z) <= 30;
  }

  isRunwaySafetyArea(x, z) {
    return x >= -2500 && x <= 1900 && Math.abs(z) <= 50;
  }

  initStylizedSky() {
    const skyGeo = new THREE.SphereGeometry(14000, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          float t = clamp((h + 0.05) / 0.95, 0.0, 1.0);

          vec3 cHorizon = vec3(0.48, 0.04, 0.46);
          vec3 cMid     = vec3(0.20, 0.03, 0.32);
          vec3 cTop     = vec3(0.03, 0.01, 0.10);

          vec3 color = t < 0.4 ? mix(cHorizon, cMid, t / 0.4) : mix(cMid, cTop, (t - 0.4) / 0.6);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.name = 'stylized-sky-dome';
    this.group.add(skyMesh);
  }

  initStarsAndShootingStars() {
    let seed = 777;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const starCount = 450;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = THREE.MathUtils.degToRad(12 + rng() * 74);
      const dist = 9500;

      starPos[i * 3] = dist * Math.cos(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = dist * Math.sin(phi);
      starPos[i * 3 + 2] = dist * Math.cos(phi) * Math.sin(theta);

      const tint = rng();
      if (tint < 0.5) {
        starCol[i * 3] = 1.0; starCol[i * 3 + 1] = 0.95; starCol[i * 3 + 2] = 1.0;
      } else if (tint < 0.8) {
        starCol[i * 3] = 0.6; starCol[i * 3 + 1] = 0.9; starCol[i * 3 + 2] = 1.0;
      } else {
        starCol[i * 3] = 1.0; starCol[i * 3 + 1] = 0.6; starCol[i * 3 + 2] = 0.95;
      }
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 3.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.group.add(new THREE.Points(starGeo, starMat));

    const crossLines = [];
    for (let i = 0; i < 40; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = THREE.MathUtils.degToRad(20 + rng() * 60);
      const dist = 9200;
      const cx = dist * Math.cos(phi) * Math.cos(theta);
      const cy = dist * Math.sin(phi);
      const cz = dist * Math.cos(phi) * Math.sin(theta);
      const arm = 35 + rng() * 45;

      crossLines.push(new THREE.Vector3(cx - arm, cy, cz), new THREE.Vector3(cx + arm, cy, cz));
      crossLines.push(new THREE.Vector3(cx, cy - arm, cz), new THREE.Vector3(cx, cy + arm, cz));
    }
    const crossGeo = new THREE.BufferGeometry().setFromPoints(crossLines);
    const crossMat = new THREE.LineBasicMaterial({ color: 0xfff0ff, transparent: true, opacity: 0.95 });
    this.group.add(new THREE.LineSegments(crossGeo, crossMat));

    const shootingStreaks = [];
    for (let i = 0; i < 30; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = THREE.MathUtils.degToRad(25 + rng() * 55);
      const dist = 9000;
      const sx = dist * Math.cos(phi) * Math.cos(theta);
      const sy = dist * Math.sin(phi);
      const sz = dist * Math.cos(phi) * Math.sin(theta);

      const len = 120 + rng() * 180;
      const ex = sx - len * 0.45;
      const ey = sy - len * 0.85;
      const ez = sz;

      shootingStreaks.push(new THREE.Vector3(sx, sy, sz), new THREE.Vector3(ex, ey, ez));
    }
    const shootGeo = new THREE.BufferGeometry().setFromPoints(shootingStreaks);
    const shootMat = new THREE.LineBasicMaterial({ color: 0x90e0ff, transparent: true, opacity: 0.75 });
    this.group.add(new THREE.LineSegments(shootGeo, shootMat));
  }

  initGroundAndRoads() {
    // The island's ground on both banks of the canal, the sea, the canal and its bridges (#551, #628)
    this.river = createNeonRiver();
    this.group.add(this.river.group);
    // Bridges are solid for every aircraft, like the towers
    this.buildingData.push(...bridgeWorldBoxes());
    // Streets between the towers, reaching every bridge (#579)
    this.roads = createNeonRoads();
    this.group.add(this.roads.group);

    // Glowing city avenue grid lines on the island, stopping short of the quay walls: each
    // line is walked in 2 m steps and drawn over its runs of land.
    const gridLines = [];
    const landRuns = (x0, z0, x1, z1) => {
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2);
      let start = null, last = null;
      for (let i = 0; i <= n + 1; i++) {
        const p = i <= n ? new THREE.Vector3(x0 + (x1 - x0) * i / n, 0.02, z0 + (z1 - z0) * i / n) : null;
        if (p && isLand(p.x, p.z)) { start ??= p; last = p; continue; }
        if (start && last !== start) gridLines.push(start, last);
        start = null;
      }
    };
    for (let x = -2000; x <= 4500; x += 300) landRuns(x, -1800, x, 1800);
    for (let z = -1800; z <= 1800; z += 300) landRuns(-2000, z, 4500, z);
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridLines);
    this.group.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: 0x22123d,
      transparent: true,
      opacity: 0.7,
    })));

    // Neon Highway / Runway (heading 090° East)
    const roadGeo = new THREE.PlaneGeometry(4200, 60);
    roadGeo.rotateX(-Math.PI / 2);
    roadGeo.translate(-300, 0.04, 0);
    const roadMat = new THREE.MeshBasicMaterial({
      color: 0x110b20,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    this.group.add(roadMesh);

    const roadMarkings = [];
    const edgeL = new THREE.PlaneGeometry(4200, 1.4);
    edgeL.rotateX(-Math.PI / 2);
    edgeL.translate(-300, 0.08, -28.5);
    roadMarkings.push(edgeL);

    const edgeR = new THREE.PlaneGeometry(4200, 1.4);
    edgeR.rotateX(-Math.PI / 2);
    edgeR.translate(-300, 0.08, 28.5);
    roadMarkings.push(edgeR);

    this.group.add(new THREE.Mesh(
      mergeGeometries(roadMarkings),
      new THREE.MeshBasicMaterial({ color: 0xd9269e })
    ));

    const dashes = [];
    for (let x = -2350; x <= 1750; x += 50) {
      const dash = new THREE.PlaneGeometry(28, 1.6);
      dash.rotateX(-Math.PI / 2);
      dash.translate(x, 0.09, 0);
      dashes.push(dash);
    }
    this.group.add(new THREE.Mesh(
      mergeGeometries(dashes),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    ));
  }

  initStreetLightingAndGantries() {
    const gantryPositions = [-1200, -400, 400, 1200, 2000, 2800];
    const gantryParts = [];

    for (const gx of gantryPositions) {
      const beam = new THREE.BoxGeometry(2.5, 3.5, 68);
      beam.translate(gx, 18, 0);
      gantryParts.push(beam);

      const legL = new THREE.BoxGeometry(2.5, 18, 2.5);
      legL.translate(gx, 9, -32);
      gantryParts.push(legL);

      const legR = new THREE.BoxGeometry(2.5, 18, 2.5);
      legR.translate(gx, 9, 32);
      gantryParts.push(legR);

      for (const sz of [-18, 0, 18]) {
        const sign = new THREE.BoxGeometry(0.8, 5, 14);
        sign.translate(gx - 1.5, 18, sz);
        gantryParts.push(sign);
      }
    }

    const gantryMesh = new THREE.Mesh(
      mergeGeometries(gantryParts),
      new THREE.MeshStandardMaterial({ color: 0x181426, metalness: 0.5, roughness: 0.5 })
    );
    this.group.add(gantryMesh);

    const lightPosts = [];
    const lightHeads = [];
    const streets = neonStreets();

    for (let x = -2000; x <= 3200; x += 120) {
      for (const z of [-34, 34]) {
        // No lamp stands in the canal or on its quay edge.
        if (Math.abs(x - riverCenter(z)) < NEON_RIVER.halfWidth + 3) continue;
        // Nor in a street crossing the highway (#579).
        if (isStreet(x, z, 1.5, streets)) continue;
        const post = new THREE.CylinderGeometry(0.35, 0.5, 12, 6);
        post.translate(x, 6, z);
        lightPosts.push(post);

        const head = new THREE.SphereGeometry(0.55, 8, 8);
        head.translate(x, 12, z);
        lightHeads.push(head);
      }
    }

    this.group.add(new THREE.Mesh(
      mergeGeometries(lightPosts),
      new THREE.MeshStandardMaterial({ color: 0x221c32, metalness: 0.4, roughness: 0.5 })
    ));
    this.group.add(new THREE.Mesh(
      mergeGeometries(lightHeads),
      new THREE.MeshBasicMaterial({ color: 0xffd290 })
    ));
  }

  /**
   * Generates organic, non-grid clusters of diverse architectural skyscrapers
   * with non-trypophobic sleek ribbon glazing, vertical fins, and monolithic silhouettes.
   */
  initSkyscrapers() {
    const textures = createArchitecturalTextures();

    // Material 1: Continuous Horizontal Ribbon Glazing
    const ribbonMat = new THREE.MeshStandardMaterial({
      map: textures.ribbon.map,
      emissiveMap: textures.ribbon.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.75,
      roughness: 0.5,
      metalness: 0.3,
    });

    // Material 2: Sleek Vertical Architectural Fins
    const finMat = new THREE.MeshStandardMaterial({
      map: textures.fin.map,
      emissiveMap: textures.fin.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.70,
      roughness: 0.5,
      metalness: 0.3,
    });

    // Material 3: Velvety Monolithic Obsidian Silhouette with sunset amber floor lines
    const monolithMat = new THREE.MeshStandardMaterial({
      map: textures.amber.map,
      emissiveMap: textures.amber.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.75,
      roughness: 0.4,
      metalness: 0.5,
    });

    // Material 4: Dark Roof Cap
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x10081e,
      roughness: 0.6,
      metalness: 0.3,
    });

    const beaconGeo = new THREE.SphereGeometry(2.0, 8, 8);
    this.strobeMat = new THREE.MeshBasicMaterial({ color: 0xd82050 });

    const ribbonGeometries = [];
    const finGeometries = [];
    const monolithGeometries = [];
    const roofGeometries = [];

    const neonCyanEdgePoints = [];
    const neonPinkEdgePoints = [];
    const beaconPositions = [];

    // One table for meshes and collision (#695): src/config/neonBuildings.js.
    for (const b of NEON_TOWERS) {
      const { x: posX, z: posZ, w: width, d: depth, h: height, type, facade, rot: rotationY } = b;
      const targetBucket = facade === 'ribbon' ? ribbonGeometries : (facade === 'fin' ? finGeometries : monolithGeometries);

      if (type === 'stepped-spire') {
        // Art Deco Stepped Pyramid with needle spire
        const h1 = height * 0.72;
        const g1 = new THREE.BoxGeometry(width, h1, depth);
        g1.translate(0, h1 / 2, 0);
        this.applyCrispUVs(g1, width, h1);

        const w2 = width * 0.75, d2 = depth * 0.75, h2 = height * 0.20;
        const g2 = new THREE.BoxGeometry(w2, h2, d2);
        g2.translate(0, h1 + h2 / 2, 0);
        this.applyCrispUVs(g2, w2, h2);

        const w3 = width * 0.50, d3 = depth * 0.50, h3 = height * 0.08;
        const g3 = new THREE.BoxGeometry(w3, h3, d3);
        g3.translate(0, h1 + h2 + h3 / 2, 0);
        this.applyCrispUVs(g3, w3, h3);

        const merged = mergeGeometries([g1, g2, g3]);
        merged.rotateY(rotationY);
        merged.translate(posX, 0, posZ);
        targetBucket.push(merged);

        // Needle spire
        const spireHeight = 40;
        const spire = new THREE.CylinderGeometry(0.6, 2.2, spireHeight, 8);
        spire.rotateY(rotationY);
        spire.translate(posX, height + spireHeight / 2, posZ);
        roofGeometries.push(spire);

        beaconPositions.push(new THREE.Vector3(posX, height + spireHeight, posZ));

        // Crown neon outline
        const hw = w3 / 2, hd = d3 / 2, topY = height;
        const edges = (Math.abs(posZ) % 20 < 10) ? neonCyanEdgePoints : neonPinkEdgePoints;
        const p1 = new THREE.Vector3(-hw, topY, -hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        const p2 = new THREE.Vector3(hw, topY, -hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        const p3 = new THREE.Vector3(hw, topY, hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        const p4 = new THREE.Vector3(-hw, topY, hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        edges.push(p1, p2, p2, p3, p3, p4, p4, p1);

      } else if (type === 'wedge-chisel') {
        // Chiseled wedge roof skyscraper (e.g. Citigroup Center style)
        const bodyH = height * 0.85;
        const body = new THREE.BoxGeometry(width, bodyH, depth);
        body.translate(0, bodyH / 2, 0);
        this.applyCrispUVs(body, width, bodyH);
        body.rotateY(rotationY);
        body.translate(posX, 0, posZ);
        targetBucket.push(body);

        // Angled wedge roof in dark roof material with neon pink contour
        const wedgeH = height * 0.15;
        const wedge = new THREE.ConeGeometry(width * 0.7, wedgeH, 4);
        wedge.rotateY(Math.PI / 4);
        wedge.translate(0, bodyH + wedgeH / 2, 0);
        wedge.rotateY(rotationY);
        wedge.translate(posX, 0, posZ);
        roofGeometries.push(wedge);

        beaconPositions.push(new THREE.Vector3(posX, height + 4, posZ));

        // Glowing angled rim outline
        const edges = neonPinkEdgePoints;
        const hw = width / 2, hd = depth / 2;
        const p1 = new THREE.Vector3(-hw, bodyH, -hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        const p2 = new THREE.Vector3(hw, bodyH, -hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        const p3 = new THREE.Vector3(hw, bodyH, hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        const p4 = new THREE.Vector3(-hw, bodyH, hd).applyAxisAngle(new THREE.Vector3(0,1,0), rotationY).add(new THREE.Vector3(posX, 0, posZ));
        edges.push(p1, p2, p2, p3, p3, p4, p4, p1);

      } else if (type === 'cylinder') {
        // Cylindrical Landmark tower with glowing observation ring
        const cyl = new THREE.CylinderGeometry(width / 2, width / 2, height, 16);
        cyl.translate(posX, height / 2, posZ);
        this.applyCrispUVs(cyl, width, height);
        targetBucket.push(cyl);

        // Rooftop observation disc
        const ring = new THREE.CylinderGeometry(width * 0.58, width * 0.58, 6, 16);
        ring.translate(posX, height + 3, posZ);
        roofGeometries.push(ring);

        beaconPositions.push(new THREE.Vector3(posX, height + 6, posZ));

      } else {
        // Blade slab or podium block
        const block = new THREE.BoxGeometry(width, height, depth);
        block.translate(0, height / 2, 0);
        this.applyCrispUVs(block, width, height);
        block.rotateY(rotationY);
        block.translate(posX, 0, posZ);
        targetBucket.push(block);

        const roof = new THREE.BoxGeometry(width * 0.85, 4, depth * 0.85);
        roof.translate(0, height + 2, 0);
        roof.rotateY(rotationY);
        roof.translate(posX, 0, posZ);
        roofGeometries.push(roof);

        beaconPositions.push(new THREE.Vector3(posX, height + 4, posZ));
      }

      this.buildingData.push(towerRecord(b));
    }

    const facades = [['ribbon', ribbonGeometries, ribbonMat], ['fin', finGeometries, finMat], ['monolith', monolithGeometries, monolithMat]];
    for (const [facade, geometries, material] of facades) {
      if (geometries.length === 0) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      mesh.name = `neon-facade-${facade}`;
      this.group.add(mesh);
    }
    if (roofGeometries.length > 0) {
      this.group.add(new THREE.Mesh(mergeGeometries(roofGeometries), roofMat));
    }

    if (neonCyanEdgePoints.length > 0) {
      const geo = new THREE.BufferGeometry().setFromPoints(neonCyanEdgePoints);
      this.group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00f0ff })));
    }
    if (neonPinkEdgePoints.length > 0) {
      const geo = new THREE.BufferGeometry().setFromPoints(neonPinkEdgePoints);
      this.group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff1493 })));
    }

    this.strobeMesh = new THREE.InstancedMesh(beaconGeo, this.strobeMat, beaconPositions.length);
    const dummy = new THREE.Object3D();
    beaconPositions.forEach((pos, i) => {
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.strobeMesh.setMatrixAt(i, dummy.matrix);
    });
    this.strobeMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.strobeMesh);
  }

  applyCrispUVs(geometry, width, height) {
    const uv = geometry.attributes.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) {
      // Clean, low-frequency mapping (broad continuous ribbons every 32m of height)
      uv.setXY(i, uv.getX(i) * (width / 40), uv.getY(i) * (height / 32));
    }
  }

  initRetroSun() {
    // Beyond the sea's edge (and inside the 14 km sky dome), so the horizon itself hides the
    // moon's lower part at any altitude (#631). Nearer, the sea behind the moon rose above the
    // line where the near water cut it, and it looked sunk in the water. Radius and height
    // scale with distance to keep the 17.7° billboard centred 5° above the horizon, as it was at 7.4 km.
    const distance = SEA_EXTENT + 1000;
    const scale = distance / 7400;
    const moonTexture = createStylizedMoonTexture();
    const moonGeo = new THREE.CircleGeometry(1150 * scale, 64);
    const moonMat = new THREE.MeshBasicMaterial({
      map: moonTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false, // Night fog would wash the disc out at 13 km.
    });

    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonMesh.name = 'retro-synthwave-sun';
    moonMesh.position.set(distance, 650 * scale, 0);
    moonMesh.rotation.y = -Math.PI / 2;
    this.group.add(moonMesh);
  }

  update(dt, playerPos, totalTime = 0) {
    if (this.strobeMat) {
      const pulse = Math.sin(totalTime * 2.5) * 0.5 + 0.5;
      this.strobeMat.color.setRGB(0.85 * pulse + 0.15, 0.15 * pulse, 0.35 * pulse);
    }
  }
}
