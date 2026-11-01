import * as THREE from 'three';
import { HANGANG_COURSE, riverCenter, hangangHeight } from '../config/hangangCourse.js';
import { createHangangAssetLoader } from './HangangAssetLoader.js';
import { placeNodeulPavilion } from './nodeulPavilion.js';

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
 * Builds Seoul cityscape scenery using real GLB 3D model assets:
 * - GLB 3D Models: Yeouido landmarks (63 Building, Parc.1, IFC, etc.), N Seoul Tower, Lotte World Tower, Nodeulseom
 * - 2D GIS Vector Data: Gangbyeonbuk-ro & Olympic-daero expressway ribbons
 * - Procedural Night Lighting: ~12,000 city light points cloud and traffic streams
 */
export function createSeoulScenery() {
  const group = new THREE.Group();
  group.name = 'Seoul Han River Scenery';

  const strobes = [];
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xff1525 });

  // 1. Aviation Obstruction Strobes at surveyed summit heights
  // (63 Building: 250m, Parc.1: 340m, N Seoul Tower: 480m, Lotte World Tower: 570m)
  const beaconCoords = [
    [780, 250, -350],   // 63 Building
    [910, 340, -120],   // Parc.1 Tower A
    [975, 258, -60],    // Parc.1 Tower B
    [1040, 290, -120],  // Three IFC
    [-1550, 480, -2100], // N Seoul Tower Spire
    [2200, 570, -6400], // Lotte World Tower Crown
  ];

  for (const [x, y, z] of beaconCoords) {
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), strobeMat);
    beacon.position.set(x, y, z);
    group.add(beacon);
    strobes.push(beacon);
  }

  // 2. 2D GIS Vector Expressways (강변북로 & 올림픽대로)
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

  // 3. Seoul Metropolis Night Light Point Cloud (~12,000 Points)
  const pointCount = 12000;
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);

  const cAmber = new THREE.Color(0xffaa40);   // Sodium streetlights
  const cWarm = new THREE.Color(0xffd578);    // Warm incandescent windows
  const cLed = new THREE.Color(0xd6eeff);     // Modern LED white/cyan

  let ptr = 0;
  for (let i = 0; i < pointCount; i++) {
    const isSouth = (i % 2 === 0);
    const z = 1400 - Math.random() * 7400;
    const center = riverCenter(z);

    const dist = 520 + Math.pow(Math.random(), 1.4) * 4200;
    const x = center + (isSouth ? dist : -dist);

    const gridX = Math.round(x / 75) * 75 + ((Math.random() - 0.5) * 16);
    const gridZ = Math.round(z / 75) * 75 + ((Math.random() - 0.5) * 16);
    const y = hangangHeight(gridX, gridZ) + 1.2 + Math.random() * 25.0;

    positions[ptr * 3] = gridX;
    positions[ptr * 3 + 1] = y;
    positions[ptr * 3 + 2] = gridZ;

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

  // 4. Asynchronously Load GLB 3D Models (Browser / Production Runtime)
  const modelsGroup = new THREE.Group();
  modelsGroup.name = 'Hangang GLB Models';
  group.add(modelsGroup);

  const ready = typeof window === 'undefined'
    ? Promise.resolve(false)
    : (async () => {
        const load = createHangangAssetLoader();
        const [yeouido, namsan, lotte, bridges, pavilion] = await Promise.all([
          load('yeouido-landmarks'),
          load('namsan-tower'),
          load('lotte-tower'),
          load('bridges-kit'),
          load('nodeul-pavilion'),
        ]);

        if (yeouido) modelsGroup.add(yeouido);
        if (namsan) modelsGroup.add(namsan);
        if (lotte) modelsGroup.add(lotte);
        if (bridges) modelsGroup.add(bridges);
        if (pavilion) modelsGroup.add(placeNodeulPavilion(pavilion, HANGANG_COURSE.nodeulseom));
        return true;
      })().catch(err => {
        console.warn('Hangang GLB models load notice:', err);
        return false;
      });

  // Strobe beacon blinking logic (1 Hz cycle)
  let elapsed = 0;
  function update(dt) {
    elapsed += dt;
    const isOn = (elapsed % 1.0) < 0.2;
    strobeMat.color.setHex(isOn ? 0xff1525 : 0x220205);
  }

  return { group, update, ready };
}
