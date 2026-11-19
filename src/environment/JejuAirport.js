import * as THREE from 'three';
import { JEJU_AIRFIELD, JejuFlightSurface } from '../geospatial/JejuFlightSurface.js';
import { AirportNightLighting } from './AirportNightLighting.js';
import { applyLogDepthOffset } from './RunwayMarkings.js';
import { pavementRibbon } from './IncheonPavement.js';
import { loadIncheonSatelliteTexture } from './IncheonGround.js';
import { colourJejuGround, jejuSurfaceMaterial } from './JejuGround.js';
import { JejuTileStreamer } from './JejuTileStreamer.js';
import { CorridorTileStreamer } from './CorridorTileStreamer.js';
import { CorridorFlightSurface } from './CorridorFlightSurface.js';
import {
  CHUJA_EMERGENCY_STRIP,
  JEJU_ORIGIN,
  wgs84ToJejuLocal,
} from '../geospatial/CorridorCoordinateSystem.js';

export async function loadJejuAirport(base = '', options = {}) {
  const terrain = new JejuFlightSurface(JEJU_AIRFIELD);
  terrain.mesh = new THREE.Group();
  const group = new THREE.Group();

  // 1. Terrain Mesh (covers 80 km x 56 km across the entire island of Jeju)
  const sizeX = 80000;
  const sizeZ = 56000;
  const segmentsX = 200;
  const segmentsZ = 140;
  const terrainGeo = new THREE.PlaneGeometry(sizeX, sizeZ, segmentsX, segmentsZ);
  terrainGeo.rotateX(-Math.PI / 2);
  // Center mesh over central Jeju Island / Mount Hallasan (3,740m East, 16,000m South of RKPC)
  terrainGeo.translate(3740, 0, 16000);

  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.getHeight(x, z);
    // Vertices outside island boundary drop to seabed (-10m) beneath water surface (0m)
    pos.setY(i, h <= 0 ? -10.0 : h);
  }
  terrainGeo.computeVertexNormals();

  const satelliteTexture = options.satelliteTexture !== undefined
    ? options.satelliteTexture
    : (options.loadSatellite !== false && base ? await loadIncheonSatelliteTexture(base) : null);

  if (!satelliteTexture) {
    colourJejuGround(terrainGeo);
  }

  const groundMaterial = jejuSurfaceMaterial({
    satelliteTexture,
  });

  const terrainMesh = new THREE.Mesh(terrainGeo, groundMaterial);
  terrain.mesh.add(terrainMesh);
  terrain.satelliteTexture = satelliteTexture;
  terrain.groundMaterial = groundMaterial;

  let tileStreamer = null;
  if (options.streamTiles !== false) {
    tileStreamer = new JejuTileStreamer(terrainMesh, terrain, options.streamerOptions);
    terrain.tileStreamer = tileStreamer;
    if (options.autoloadTiles !== false) {
      tileStreamer.loadIslandMacroTiles().catch(() => {});
    }
  }

  let corridorStreamer = null;
  let activeTerrain = terrain;
  if (options.streamCorridor) {
    const corridorSurface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN, jejuSurface: terrain });
    corridorStreamer = new CorridorTileStreamer(corridorSurface, { origin: JEJU_ORIGIN, ...options.corridorOptions });
    group.add(corridorStreamer.group);
    corridorSurface.mesh = terrain.mesh;
    corridorSurface.tileStreamer = tileStreamer;
    corridorSurface.corridorStreamer = corridorStreamer;
    corridorSurface.satelliteTexture = satelliteTexture;
    corridorSurface.groundMaterial = groundMaterial;
    activeTerrain = corridorSurface;
  }

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

  // 2B. Chuja Island Emergency Diversion Airstrip (when corridor streaming is active)
  if (options.streamCorridor) {
    const [cx, cz] = wgs84ToJejuLocal(CHUJA_EMERGENCY_STRIP.center.latitude, CHUJA_EMERGENCY_STRIP.center.longitude);
    const halfL = CHUJA_EMERGENCY_STRIP.lengthM * 0.5;
    const ptA = [cx - halfL * Math.SQRT1_2, cz + halfL * Math.SQRT1_2];
    const ptB = [cx + halfL * Math.SQRT1_2, cz - halfL * Math.SQRT1_2];

    const chujaRwyGeo = pavementRibbon([ptA, ptB], CHUJA_EMERGENCY_STRIP.widthM);
    const chujaRwyMesh = new THREE.Mesh(chujaRwyGeo, pavementMat);
    chujaRwyMesh.position.y = CHUJA_EMERGENCY_STRIP.elevationM + 0.04;
    group.add(chujaRwyMesh);

    const chujaClGeo = pavementRibbon([ptA, ptB], 1.2, true);
    const chujaClMesh = new THREE.Mesh(chujaClGeo, markingsMat);
    chujaClMesh.position.y = CHUJA_EMERGENCY_STRIP.elevationM + 0.05;
    group.add(chujaClMesh);
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

  let lastPos = null;

  return {
    terrain: activeTerrain,
    group,
    nightLighting,
    tileStreamer,
    corridorStreamer,
    towerCab: { position: new THREE.Vector3(-80, JEJU_AIRFIELD.elevationM + 49, 260) },
    isOnRunway: (x, z) => activeTerrain.isOnRunway(x, z),
    isRunwaySafetyArea: (x, z) => activeTerrain.isRunwaySafetyArea(x, z),
    resetTraffic() {},
    update(dt, position, time, options = {}) {
      if (corridorStreamer && position) {
        let headingDeg = options.headingDeg ?? options.trackDeg;
        if (headingDeg === undefined && lastPos) {
          const dx = position.x - lastPos.x;
          const dz = position.z - lastPos.z;
          if (Math.hypot(dx, dz) > 0.5) {
            headingDeg = (Math.atan2(dx, -dz) * (180 / Math.PI) + 360) % 360;
          }
        }
        if (position) {
          lastPos = { x: position.x, z: position.z };
        }
        corridorStreamer.update({
          x: position.x,
          z: position.z,
          y: position.y,
          altitudeM: position.y,
          headingDeg,
        }).catch(() => {});
      }
    },
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
    dispose() {
      tileStreamer?.dispose();
      corridorStreamer?.dispose();
    },
  };
}
