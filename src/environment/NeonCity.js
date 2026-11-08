import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEON_RIVER, bridgeWorldBoxes, isRiver, riverCenter, riverGroundHeight } from '../config/neonRiver.js';
import { createNeonRiver } from './NeonRiver.js';

/**
 * Creates clean, sleek facade textures tailored to eliminate trypophobia.
 * Replaces high-frequency dot/slot perforations with smooth, elegant horizontal
 * ribbon glazing, vertical architectural fins, and pure velvety monolithic finishes.
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

  return {
    ribbon: { map: ribbonMap, emissiveMap: ribbonEmissiveMap },
    fin: { map: finMap, emissiveMap: finEmissiveMap },
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
      // The canal's water lies below the street (#551); CollisionDetector reads it here.
      getWaterLevel: (x, z) => (isRiver(x, z) ? NEON_RIVER.waterLevel : 0),
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

  // The street, or the canal's water between its quay walls.
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
    // City ground on both banks of the canal, the canal and its bridges (#551)
    this.river = createNeonRiver();
    this.group.add(this.river.group);
    // Bridges are solid for every aircraft, like the towers
    this.buildingData.push(...bridgeWorldBoxes());

    // Glowing city avenue grid lines, stopping at the canal's quay walls
    const gridLines = [];
    const westBank = riverCenter(0) - NEON_RIVER.halfWidth, eastBank = riverCenter(0) + NEON_RIVER.halfWidth;
    for (let x = -2000; x <= 4500; x += 300) {
      if (x > westBank && x < eastBank) continue;
      gridLines.push(new THREE.Vector3(x, 0.02, -1800), new THREE.Vector3(x, 0.02, 1800));
    }
    for (let z = -1800; z <= 1800; z += 300) {
      gridLines.push(new THREE.Vector3(-2000, 0.02, z), new THREE.Vector3(westBank, 0.02, z));
      gridLines.push(new THREE.Vector3(eastBank, 0.02, z), new THREE.Vector3(4500, 0.02, z));
    }
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

    for (let x = -2000; x <= 3200; x += 120) {
      for (const z of [-34, 34]) {
        // No lamp stands in the canal or on its quay edge.
        if (Math.abs(x - riverCenter(z)) < NEON_RIVER.halfWidth + 3) continue;
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

    // Material 3: Velvety Monolithic Obsidian Silhouette (zero windows)
    const monolithMat = new THREE.MeshStandardMaterial({
      color: 0x160e28,
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

    // Organic, varied architectural definition table
    // Intentionally breaks Cartesian alignment and mirror symmetry!
    const buildingsConfig = [
      // === Iconic Central Megatowers ===
      // 1. The Grand Art Deco Spire (Stepped pyramid, 440m tall with 36m spire)
      { x: 1950, z: 165, w: 75, d: 75, h: 440, type: 'stepped-spire', facade: 'fin', rot: -0.08 },
      // 2. The Chrysler Crown Tower (420m tall)
      { x: 2500, z: -175, w: 70, d: 70, h: 420, type: 'stepped-spire', facade: 'ribbon', rot: 0.12 },
      // 3. Citigroup Chiseled Wedge Tower (45° angled roof, 380m tall)
      { x: 1420, z: -160, w: 68, d: 68, h: 380, type: 'wedge-chisel', facade: 'monolith', rot: -0.18 },
      // 4. Cylindrical Landmark Tower with glowing circular observation ring (370m tall)
      { x: 2850, z: 185, w: 65, d: 65, h: 370, type: 'cylinder', facade: 'ribbon', rot: 0 },
      // 5. Asymmetric Gateway Towers flanking canyon entrance
      { x: 920, z: 135, w: 55, d: 50, h: 320, type: 'blade-slab', facade: 'ribbon', rot: 0.15 },
      { x: 860, z: -140, w: 58, d: 52, h: 350, type: 'wedge-chisel', facade: 'fin', rot: -0.22 },

      // === Asymmetric North Midtown Cluster (Z = 120 to 480) ===
      { x: 650,  z: 145, w: 48, d: 48, h: 220, type: 'blade-slab', facade: 'monolith', rot: 0.05 },
      { x: 790,  z: 280, w: 65, d: 55, h: 290, type: 'wedge-chisel', facade: 'ribbon', rot: -0.25 },
      { x: 1140, z: 210, w: 70, d: 65, h: 340, type: 'stepped-spire', facade: 'fin', rot: 0.18 },
      { x: 1290, z: 390, w: 55, d: 75, h: 260, type: 'blade-slab', facade: 'monolith', rot: -0.10 },
      { x: 1620, z: 230, w: 65, d: 65, h: 360, type: 'cylinder', facade: 'ribbon', rot: 0 },
      { x: 1780, z: 380, w: 75, d: 60, h: 310, type: 'wedge-chisel', facade: 'fin', rot: 0.32 },
      { x: 2080, z: 240, w: 60, d: 70, h: 350, type: 'blade-slab', facade: 'ribbon', rot: -0.15 },
      { x: 2560, z: 430, w: 70, d: 65, h: 280, type: 'stepped-spire', facade: 'monolith', rot: 0.22 },
      { x: 2620, z: 225, w: 68, d: 60, h: 340, type: 'wedge-chisel', facade: 'ribbon', rot: -0.12 },
      { x: 2790, z: 400, w: 58, d: 68, h: 290, type: 'cylinder', facade: 'fin', rot: 0 },
      { x: 3100, z: 210, w: 62, d: 62, h: 330, type: 'stepped-spire', facade: 'ribbon', rot: 0.16 },
      { x: 3280, z: 360, w: 70, d: 58, h: 270, type: 'blade-slab', facade: 'monolith', rot: -0.20 },
      { x: 3550, z: 220, w: 60, d: 60, h: 300, type: 'wedge-chisel', facade: 'fin', rot: 0.1 },

      // === Asymmetric South Waterfront Cluster (Z = -130 to -480) ===
      { x: 580,  z: -170, w: 52, d: 50, h: 200, type: 'cylinder', facade: 'ribbon', rot: 0 },
      { x: 740,  z: -310, w: 68, d: 60, h: 280, type: 'stepped-spire', facade: 'monolith', rot: 0.25 },
      { x: 1080, z: -210, w: 60, d: 72, h: 330, type: 'blade-slab', facade: 'fin', rot: -0.18 },
      { x: 1240, z: -410, w: 75, d: 58, h: 270, type: 'wedge-chisel', facade: 'ribbon', rot: 0.28 },
      { x: 1650, z: -220, w: 68, d: 62, h: 360, type: 'stepped-spire', facade: 'ribbon', rot: -0.14 },
      { x: 1820, z: -380, w: 62, d: 72, h: 310, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 2060, z: -235, w: 72, d: 62, h: 350, type: 'wedge-chisel', facade: 'fin', rot: 0.19 },
      { x: 2560, z: -440, w: 58, d: 68, h: 290, type: 'blade-slab', facade: 'ribbon', rot: -0.24 },
      { x: 2650, z: -215, w: 65, d: 65, h: 330, type: 'stepped-spire', facade: 'monolith', rot: 0.15 },
      { x: 2820, z: -370, w: 72, d: 58, h: 280, type: 'blade-slab', facade: 'fin', rot: -0.12 },
      { x: 3150, z: -220, w: 68, d: 68, h: 320, type: 'cylinder', facade: 'ribbon', rot: 0 },
      { x: 3320, z: -390, w: 62, d: 62, h: 270, type: 'wedge-chisel', facade: 'monolith', rot: 0.22 },
      { x: 3600, z: -210, w: 58, d: 58, h: 310, type: 'stepped-spire', facade: 'ribbon', rot: -0.08 },

      // === Deep Background Skyline Silhouettes (Far North, Z = 580 to 1150) ===
      { x: 800,  z: 650,  w: 90, d: 80, h: 250, type: 'blade-slab', facade: 'monolith', rot: 0.12 },
      { x: 1200, z: 720,  w: 75, d: 75, h: 290, type: 'stepped-spire', facade: 'ribbon', rot: -0.22 },
      { x: 1600, z: 640,  w: 80, d: 85, h: 310, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 2050, z: 730,  w: 95, d: 75, h: 320, type: 'wedge-chisel', facade: 'fin', rot: 0.18 },
      { x: 2600, z: 760,  w: 85, d: 80, h: 290, type: 'stepped-spire', facade: 'monolith', rot: -0.14 },
      { x: 2880, z: 740,  w: 80, d: 90, h: 280, type: 'blade-slab', facade: 'ribbon', rot: 0.25 },
      { x: 3280, z: 670,  w: 85, d: 75, h: 260, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 1050, z: 980,  w: 110, d: 90, h: 220, type: 'blade-slab', facade: 'monolith', rot: 0 },
      { x: 1550, z: 1020, w: 90, d: 95, h: 240, type: 'stepped-spire', facade: 'ribbon', rot: 0.28 },
      { x: 2080, z: 990,  w: 105, d: 85, h: 260, type: 'wedge-chisel', facade: 'monolith', rot: -0.16 },
      { x: 2580, z: 1040, w: 95, d: 100, h: 230, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 3080, z: 1000, w: 100, d: 85, h: 210, type: 'blade-slab', facade: 'fin', rot: 0.12 },

      // === Deep Background Skyline Silhouettes (Far South, Z = -580 to -1150) ===
      { x: 820,  z: -660,  w: 85, d: 80, h: 260, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 1220, z: -730,  w: 90, d: 75, h: 300, type: 'wedge-chisel', facade: 'fin', rot: 0.22 },
      { x: 1620, z: -650,  w: 80, d: 85, h: 320, type: 'stepped-spire', facade: 'monolith', rot: -0.18 },
      { x: 2080, z: -740,  w: 95, d: 80, h: 310, type: 'blade-slab', facade: 'ribbon', rot: 0.12 },
      { x: 2560, z: -670,  w: 85, d: 90, h: 290, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 2910, z: -750,  w: 90, d: 75, h: 280, type: 'stepped-spire', facade: 'ribbon', rot: -0.22 },
      { x: 3310, z: -680,  w: 80, d: 85, h: 250, type: 'wedge-chisel', facade: 'monolith', rot: 0.14 },
      { x: 1080, z: -990,  w: 105, d: 90, h: 230, type: 'blade-slab', facade: 'fin', rot: 0 },
      { x: 1580, z: -1030, w: 95, d: 100, h: 250, type: 'cylinder', facade: 'monolith', rot: 0 },
      { x: 2050, z: -1000, w: 100, d: 85, h: 260, type: 'stepped-spire', facade: 'ribbon', rot: 0.22 },
      { x: 2610, z: -1050, w: 90, d: 95, h: 220, type: 'wedge-chisel', facade: 'monolith', rot: -0.18 },
      { x: 3110, z: -1010, w: 110, d: 85, h: 210, type: 'blade-slab', facade: 'monolith', rot: 0.1 },

      // === Varied Asymmetric Urban Podiums / Terraces (Plazas & Setbacks) ===
      { x: 420,  z: 160,  w: 42, d: 40, h: 75,  type: 'podium', facade: 'monolith', rot: 0.12 },
      { x: 580,  z: -175, w: 46, d: 42, h: 95,  type: 'podium', facade: 'ribbon', rot: -0.18 },
      { x: 1020, z: 145,  w: 50, d: 38, h: 105, type: 'podium', facade: 'fin', rot: -0.08 },
      { x: 1150, z: -150, w: 45, d: 44, h: 115, type: 'podium', facade: 'monolith', rot: 0.15 },
      { x: 1460, z: 155,  w: 52, d: 40, h: 135, type: 'podium', facade: 'ribbon', rot: 0.22 },
      { x: 1580, z: -140, w: 48, d: 45, h: 120, type: 'podium', facade: 'monolith', rot: -0.12 },
      { x: 1980, z: 140,  w: 50, d: 42, h: 145, type: 'podium', facade: 'fin', rot: -0.16 },
      { x: 2120, z: -155, w: 54, d: 40, h: 130, type: 'podium', facade: 'ribbon', rot: 0.14 },
      { x: 2490, z: 190,  w: 44, d: 46, h: 115, type: 'podium', facade: 'monolith', rot: 0.08 },
      { x: 2580, z: -145, w: 48, d: 42, h: 125, type: 'podium', facade: 'fin', rot: -0.20 },
      { x: 2880, z: 135,  w: 46, d: 40, h: 95,  type: 'podium', facade: 'ribbon', rot: 0.18 },
      { x: 3020, z: -150, w: 50, d: 44, h: 105, type: 'podium', facade: 'monolith', rot: -0.15 },
    ];

    for (const b of buildingsConfig) {
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

      // Compute accurate world-space bounding dimensions including rotation
      const cosR = Math.abs(Math.cos(rotationY));
      const sinR = Math.abs(Math.sin(rotationY));
      const worldW = cosR * width + sinR * depth;
      const worldD = sinR * width + cosR * depth;

      this.buildingData.push({
        x: posX,
        y: 0,
        z: posZ,
        width: worldW,
        height: height + 8,
        visualY: 0,
        depth: worldD,
        localWidth: width,
        localDepth: depth,
        rotationY,
      });
    }

    if (ribbonGeometries.length > 0) {
      this.group.add(new THREE.Mesh(mergeGeometries(ribbonGeometries), ribbonMat));
    }
    if (finGeometries.length > 0) {
      this.group.add(new THREE.Mesh(mergeGeometries(finGeometries), finMat));
    }
    if (monolithGeometries.length > 0) {
      this.group.add(new THREE.Mesh(mergeGeometries(monolithGeometries), monolithMat));
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
    const moonTexture = createStylizedMoonTexture();
    const moonGeo = new THREE.CircleGeometry(1150, 64);
    const moonMat = new THREE.MeshBasicMaterial({
      map: moonTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonMesh.name = 'retro-synthwave-sun';
    moonMesh.position.set(7400, 650, 0);
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
