import * as THREE from 'three';
import { createPavementMaterial, setPavementUVs } from './Pavement.js';

// Visual-only facilities for declarative airport overrides. Geometry is built
// around the local origin; the external airport loader places and yaws the
// returned group from the descriptor's position/rotationY.

const ROOF_COLOR = 0x0284c7;
const TERMINAL_WIDTH = 44;
const TERMINAL_DEPTH = 24;

function buildTerminal() {
  const group = new THREE.Group();
  group.name = 'vnlk-terminal';

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.85,
    metalness: 0.05,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(TERMINAL_WIDTH, 10, TERMINAL_DEPTH), wallMat);
  body.position.y = 5;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roofMat = new THREE.MeshStandardMaterial({
    color: ROOF_COLOR,
    roughness: 0.45,
    metalness: 0.25,
  });
  const roofGeom = new THREE.ConeGeometry(TERMINAL_WIDTH * 0.65, 5.5, 4);
  roofGeom.rotateY(Math.PI * 0.25);
  roofGeom.scale(1, 1, TERMINAL_DEPTH / (TERMINAL_WIDTH * 0.65));
  const roof = new THREE.Mesh(roofGeom, roofMat);
  roof.position.y = 12.5;
  roof.castShadow = true;
  group.add(roof);

  const paneMat = new THREE.MeshStandardMaterial({
    name: 'terminal-window-glass',
    color: 0x34556a,
    emissive: 0x34556a,
    roughness: 0.3,
  });
  const paneGeom = new THREE.PlaneGeometry(2.6, 2);
  for (const side of [-1, 1]) {
    for (const y of [3, 7]) {
      for (let x = -18; x <= 18; x += 6) {
        const pane = new THREE.Mesh(paneGeom, paneMat);
        pane.position.set(x, y, side * (TERMINAL_DEPTH / 2 + 0.04));
        pane.rotation.y = side < 0 ? Math.PI : 0;
        group.add(pane);
      }
    }
  }

  return { group, gazeTarget: { object: group, kind: 'terminal' } };
}

function buildTower(facility) {
  const group = new THREE.Group();
  group.name = 'vnlk-tower';

  const totalH = Number.isFinite(facility.height) ? facility.height : 16;
  const cabH = Number.isFinite(facility.cabHeight) ? facility.cabHeight : 4.5;
  const cabR = Number.isFinite(facility.cabRadius) ? facility.cabRadius : 4.2;
  const shaftR = Number.isFinite(facility.shaftRadius) ? facility.shaftRadius : 3.8;
  const shaftH = Math.max(1, totalH - cabH);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftR, shaftR * 1.15, shaftH, 8),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.75 }),
  );
  shaft.position.y = shaftH / 2;
  shaft.castShadow = true;
  group.add(shaft);

  const cabin = new THREE.Mesh(
    new THREE.CylinderGeometry(cabR, shaftR, cabH, 8),
    new THREE.MeshStandardMaterial({
      name: 'terminal-window-glass',
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.85,
      transparent: true,
      opacity: 0.8,
    }),
  );
  cabin.position.y = shaftH + cabH / 2;
  cabin.castShadow = true;
  group.add(cabin);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(cabR + 1, 2.0, 8),
    new THREE.MeshStandardMaterial({ color: ROOF_COLOR, roughness: 0.45, metalness: 0.25 }),
  );
  roof.position.y = totalH + 1;
  group.add(roof);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 6.0, 6),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 }),
  );
  mast.position.y = totalH + 4.5;
  group.add(mast);

  const beacon = new THREE.PointLight(0xff2222, 1.8, 120);
  beacon.position.y = totalH + 7.5;
  group.add(beacon);

  return {
    group,
    gazeTarget: { object: group, kind: 'tower' },
    update(time) {
      beacon.intensity = Math.sin(time * 6.28) > 0 ? 2.5 : 0.2;
    },
  };
}

function buildApron(facility) {
  const group = new THREE.Group();
  group.name = 'vnlk-apron';

  // Yaw is applied by the caller; the inner group carries the runway pitch so
  // the combined transform is the legacy Euler(pitch, yaw, 0, 'YXZ').
  const pitched = new THREE.Group();
  pitched.rotation.x = Number.isFinite(facility.pitchRad) ? facility.pitchRad : Math.atan(0.1176);
  group.add(pitched);

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(36, 16, 80),
    new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.95, metalness: 0.05 }),
  );
  skirt.position.y = -8.1;
  skirt.receiveShadow = true;
  pitched.add(skirt);

  const apronGeom = new THREE.PlaneGeometry(36, 80);
  apronGeom.rotateX(-Math.PI * 0.5);
  const apron = new THREE.Mesh(apronGeom, createPavementMaterial('concrete', -2));
  setPavementUVs(apronGeom);
  apron.receiveShadow = true;
  pitched.add(apron);

  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
  const heliMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ringGeom = new THREE.RingGeometry(4.8, 5.4, 32);
  ringGeom.rotateX(-Math.PI * 0.5);
  const barGeom = new THREE.PlaneGeometry(0.9, 4.8);
  barGeom.rotateX(-Math.PI * 0.5);
  const midGeom = new THREE.PlaneGeometry(2.6, 0.9);
  midGeom.rotateX(-Math.PI * 0.5);

  for (let i = 0; i < 2; i++) {
    const hx = -6 + i * 12;
    const hz = 20;
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(hx, 0.05, hz);
    ring.receiveShadow = true;
    pitched.add(ring);
    for (const dx of [-1.3, 1.3]) {
      const bar = new THREE.Mesh(barGeom, heliMat);
      bar.position.set(hx + dx, 0.06, hz);
      bar.receiveShadow = true;
      pitched.add(bar);
    }
    const mid = new THREE.Mesh(midGeom, heliMat);
    mid.position.set(hx, 0.06, hz);
    mid.receiveShadow = true;
    pitched.add(mid);
  }

  return { group };
}

function buildWindsock() {
  const group = new THREE.Group();
  group.name = 'vnlk-windsock';

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.15, 7.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1 }),
  );
  pole.position.y = 3.75;
  group.add(pole);

  const coneGeom = new THREE.ConeGeometry(0.55, 3.2, 12);
  coneGeom.rotateZ(-Math.PI * 0.45);
  const sock = new THREE.Mesh(
    coneGeom,
    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7 }),
  );
  sock.position.set(0.8, 7.2, 0);
  group.add(sock);

  return {
    group,
    update(time) {
      sock.rotation.y = Math.sin(time * 2.5) * 0.15;
    },
  };
}

function buildWall() {
  const group = new THREE.Group();
  group.name = 'vnlk-wall';

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(45, 6, 3),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.95 }),
  );
  wall.position.y = 3;
  wall.castShadow = true;
  group.add(wall);

  return {
    group,
    gazeTarget: { object: group, kind: 'wall' },
  };
}

const BUILDERS = {
  'vnlk-terminal': buildTerminal,
  'vnlk-tower': buildTower,
  'vnlk-apron': buildApron,
  'vnlk-windsock': buildWindsock,
  'vnlk-wall': buildWall,
};

/** Build a visual-only facility model; unknown ids return null for the generic loader. */
export function createAirportFacilityModel(facility) {
  if (!facility || typeof facility.model !== 'string') return null;
  const build = BUILDERS[facility.model];
  return build ? build(facility) : null;
}
