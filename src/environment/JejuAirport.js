import * as THREE from 'three';
import { JEJU_AIRFIELD, JejuFlightSurface } from '../geospatial/JejuFlightSurface.js';
import { AirportNightLighting } from './AirportNightLighting.js';
import { applyLogDepthOffset } from './RunwayMarkings.js';
import { pavementRibbon } from './IncheonPavement.js';
import { incheonSurfaceMaterial, loadIncheonSatelliteTexture } from './IncheonGround.js';

export async function loadJejuAirport(base = '', options = {}) {
  const terrain = new JejuFlightSurface(JEJU_AIRFIELD);
  terrain.mesh = new THREE.Group();
  const group = new THREE.Group();

  // 1. Terrain Mesh (covers 40 km x 40 km around Jeju airport and Mt. Hallasan)
  const size = 40000;
  const segments = 160;
  const terrainGeo = new THREE.PlaneGeometry(size, size, segments, segments);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrain.getHeight(x, z));
  }
  terrainGeo.computeVertexNormals();

  const satelliteTexture = options.satelliteTexture !== undefined
    ? options.satelliteTexture
    : (options.loadSatellite !== false && base ? await loadIncheonSatelliteTexture(base) : null);

  const groundMaterial = incheonSurfaceMaterial({
    satelliteTexture,
  });

  const terrainMesh = new THREE.Mesh(terrainGeo, groundMaterial);
  terrain.mesh.add(terrainMesh);
  terrain.satelliteTexture = satelliteTexture;
  terrain.groundMaterial = groundMaterial;

  // 2. Pavement & Cross Runways
  const pavementMat = new THREE.MeshStandardMaterial({
    color: 0x22262a,
    roughness: 0.88,
    metalness: 0.05,
  });

  const markingsMat = applyLogDepthOffset(new THREE.MeshBasicMaterial({ color: 0xffffff }), 3);

  for (const runway of JEJU_AIRFIELD.runways) {
    const a = runway.points[0];
    const b = runway.points.at(-1);
    const rwyGeo = pavementRibbon([a, b], runway.width);
    const rwyMesh = new THREE.Mesh(rwyGeo, pavementMat);
    rwyMesh.position.y = JEJU_AIRFIELD.elevationM + 0.04;
    group.add(rwyMesh);

    // Centerline dashed stripes
    const clGeo = pavementRibbon([a, b], 1.2, true);
    const clMesh = new THREE.Mesh(clGeo, markingsMat);
    clMesh.position.y = JEJU_AIRFIELD.elevationM + 0.05;
    group.add(clMesh);

    // Threshold markings and bars
    const yaw = -Math.atan2(b[0] - a[0], a[1] - b[1]);
    for (const [i, p] of [a, b].entries()) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(runway.width, 0.025, 3), markingsMat);
      bar.position.set(p[0], JEJU_AIRFIELD.elevationM + 0.05, p[1]);
      bar.rotation.y = yaw;
      group.add(bar);

      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.font = 'bold 85px sans-serif';
          const ref = runway.ref.split('/')[i];
          ctx.fillText(ref.slice(0, 2), 64, 110);
          if (ref.length > 2) {
            ctx.font = 'bold 75px sans-serif';
            ctx.fillText(ref.slice(2), 64, 205);
          }
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          const numMarking = new THREE.Mesh(
            new THREE.PlaneGeometry(16, 32),
            applyLogDepthOffset(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), 4)
          );
          numMarking.rotation.set(-Math.PI / 2, 0, 0);
          numMarking.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), yaw + (i ? Math.PI : 0));
          const direction = i ? -1 : 1;
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          numMarking.position.set(
            p[0] + direction * ((b[0] - a[0]) / length) * 140,
            JEJU_AIRFIELD.elevationM + 0.06,
            p[1] + direction * ((b[1] - a[1]) / length) * 140
          );
          group.add(numMarking);
        }
      }
    }
  }

  // 3. Terminal & Control Tower Buildings
  const buildingsGroup = new THREE.Group();
  const terminalMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.6, metalness: 0.2 });
  const terminalGeo = new THREE.BoxGeometry(450, 22, 120);
  const terminal = new THREE.Mesh(terminalGeo, terminalMat);
  terminal.position.set(150, JEJU_AIRFIELD.elevationM + 11, 320);
  buildingsGroup.add(terminal);

  const towerBaseMat = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.7 });
  const towerShaftGeo = new THREE.CylinderGeometry(7, 9, 45, 16);
  const towerShaft = new THREE.Mesh(towerShaftGeo, towerBaseMat);
  towerShaft.position.set(-80, JEJU_AIRFIELD.elevationM + 22.5, 260);
  buildingsGroup.add(towerShaft);

  const towerCabMat = new THREE.MeshStandardMaterial({ color: 0x1a365d, roughness: 0.2, metalness: 0.8 });
  const towerCabGeo = new THREE.CylinderGeometry(11, 7, 8, 16);
  const towerCab = new THREE.Mesh(towerCabGeo, towerCabMat);
  towerCab.position.set(-80, JEJU_AIRFIELD.elevationM + 49, 260);
  buildingsGroup.add(towerCab);

  group.add(buildingsGroup);

  // 4. Night Lighting
  const nightLighting = new AirportNightLighting(
    group,
    JEJU_AIRFIELD.runways.map(s => ({
      start: [s.points[0][0], JEJU_AIRFIELD.elevationM, s.points[0][1]],
      end: [s.points.at(-1)[0], JEJU_AIRFIELD.elevationM, s.points.at(-1)[1]],
      width: s.width,
    })),
    [
      { x: 50, y: JEJU_AIRFIELD.elevationM, z: 240, height: 20, target: [50, JEJU_AIRFIELD.elevationM + 3, 180] },
      { x: 250, y: JEJU_AIRFIELD.elevationM, z: 240, height: 20, target: [250, JEJU_AIRFIELD.elevationM + 3, 180] },
    ]
  );

  const gazeTargets = [
    { object: towerCab, kind: 'tower' },
    { object: terminal, kind: 'building' },
  ];

  return {
    terrain,
    group,
    nightLighting,
    towerCab: { position: new THREE.Vector3(-80, JEJU_AIRFIELD.elevationM + 49, 260) },
    isOnRunway: (x, z) => terrain.isOnRunway(x, z),
    isRunwaySafetyArea: (x, z) => terrain.isRunwaySafetyArea(x, z),
    resetTraffic() {},
    update(dt, position, time, options = {}) {},
    checkBuildingCollision(probes) {
      for (const p of probes) {
        if (Math.hypot(p.pos.x - (-80), p.pos.z - 260) < 12 && p.pos.y < JEJU_AIRFIELD.elevationM + 55) {
          return { point: p.pos.clone(), part: 'tower' };
        }
        if (Math.abs(p.pos.x - 150) < 230 && Math.abs(p.pos.z - 320) < 65 && p.pos.y < JEJU_AIRFIELD.elevationM + 25) {
          return { point: p.pos.clone(), part: 'terminal' };
        }
      }
      return null;
    },
    getGazeTargets() { return gazeTargets; },
  };
}
