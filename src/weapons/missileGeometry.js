import * as THREE from 'three';
import { missileSpec } from './missileSpecs.js';

const sharedMaterials = new Map();

function material(key, options) {
  let value = sharedMaterials.get(key);
  if (!value) {
    value = new THREE.MeshStandardMaterial(options);
    sharedMaterials.set(key, value);
  }
  return value;
}

const bodyMaterial = () => material('missile-body', { color: 0xd9d9d2, roughness: 0.46, metalness: 0.28 });
const finMaterial = () => material('missile-fin', { color: 0xa9ada8, roughness: 0.55, metalness: 0.35 });
const domeMaterial = () => material('missile-dome', { color: 0x20262a, roughness: 0.18, metalness: 0.55 });
const radomeMaterial = () => material('missile-radome', { color: 0xecece5, roughness: 0.62, metalness: 0.05 });
const bandMaterial = () => material('missile-band', { color: 0x8d5b2b, roughness: 0.7, metalness: 0.1 });

/** Four radial fins around the Z axis, nose toward -Z. */
function addFinRing(group, { z, chord, span, thickness, radius, phase = Math.PI / 4 }) {
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(thickness, span, chord), finMaterial());
    fin.position.set(0, radius + span / 2, 0);
    fin.rotation.z = phase;
    const pivot = new THREE.Group();
    pivot.rotation.z = phase + i * Math.PI / 2;
    pivot.position.z = z;
    pivot.add(fin);
    fin.castShadow = true;
    group.add(pivot);
  }
}

/**
 * Build one rail missile in the aircraft frame. The origin is the station
 * attach point, the nose points down -Z and the group is cheap enough to keep
 * six copies resident on the airframe.
 */
export function createMissileMesh(type) {
  const spec = missileSpec(type);
  if (!spec) throw new Error(`Unknown missile type: ${type}`);
  const group = new THREE.Group();
  group.name = `Missile_${type}`;
  group.userData.missileType = type;

  const length = spec.lengthM;
  const radius = spec.diameterM / 2;
  const noseLength = length * (type === 'AIM9X' ? 0.16 : 0.2);
  const bodyLength = length - noseLength;
  const isSidewinder = type === 'AIM9X';

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, bodyLength, 18, 1, false),
    isSidewinder ? bodyMaterial() : radomeMaterial(),
  );
  body.rotation.x = Math.PI / 2;
  body.position.z = noseLength / 2;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(radius, noseLength, 18, 1, false),
    isSidewinder ? domeMaterial() : radomeMaterial(),
  );
  // ConeGeometry's apex is +Y; the missile nose points forward (-Z).
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -length / 2 + noseLength / 2;
  nose.castShadow = true;
  group.add(nose);

  if (isSidewinder) {
    const seekerBand = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.015, radius * 1.015, 0.12, 18, 1, true),
      bandMaterial(),
    );
    seekerBand.rotation.x = Math.PI / 2;
    seekerBand.position.z = -length / 2 + noseLength + 0.05;
    group.add(seekerBand);
    addFinRing(group, { z: -length / 2 + noseLength + 0.34, chord: 0.2, span: 0.1, thickness: 0.008, radius });
    addFinRing(group, { z: length / 2 - 0.26, chord: 0.24, span: 0.13, thickness: 0.008, radius });
  } else {
    addFinRing(group, { z: -0.08, chord: 0.42, span: 0.17, thickness: 0.01, radius, phase: 0 });
    addFinRing(group, { z: length / 2 - 0.3, chord: 0.34, span: 0.2, thickness: 0.01, radius, phase: 0 });
  }

  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.9, radius * 0.78, 0.1, 16, 1, true),
    finMaterial(),
  );
  tail.rotation.x = Math.PI / 2;
  tail.position.z = length / 2 - 0.02;
  group.add(tail);

  return group;
}

/** Cheap delta-wing target drone used for the two airborne bandits. */
export function createBanditMesh(callsign = 'BANDIT') {
  const group = new THREE.Group();
  group.name = `Bandit_${callsign}`;
  const dark = material('bandit-dark', { color: 0x3a4148, roughness: 0.62, metalness: 0.3 });
  const trim = material('bandit-trim', { color: 0xd07b32, roughness: 0.5, metalness: 0.2 });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.28, 7.6, 10), dark);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  group.add(fuselage);
  // Customize bandit appearance based on callsign
  if (callsign.includes('HEAVY')) {
    // Heavy bandit: larger, more angular fuselage
    fuselage.geometry.scale(1.2, 1.1, 1.5);
    fuselage.geometry.parameters.heightSegments = 16;
    fuselage.geometry.parameters.radiusSegments = 16;
  } else if (callsign.includes('B-1')) {
    // B-1 bandit: sleek, swept-wing design
    fuselage.geometry = new THREE.CylinderGeometry(0.3, 0.15, 8.2, 12, 8);
    fuselage.scale.set(0.8, 1.2, 1.0);
  } else if (callsign.includes('F-') || callsign.includes('Fighter')) {
    // Fighter bandit: more aerodynamic
    fuselage.rotation.x = Math.PI / 2 - 0.1;
    fuselage.geometry = new THREE.CylinderGeometry(0.35, 0.2, 8.0, 12);
  }
  // Add custom trim color for specific callsigns
  if (callsign.includes('RED')) {
    trim.color.set(0xff0000);
  } else if (callsign.includes('BLUE')) {
    trim.color.set(0x0000ff);
  } else if (callsign.includes('GREEN')) {
    trim.color.set(0x00ff00);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.12, 2.1), dark);
  wing.position.set(0, -0.05, 0.55);
  wing.rotation.z = 0.04;
  wing.castShadow = true;
  group.add(wing);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.75), dark);
  tail.position.set(0, 0.18, 3.35);
  tail.castShadow = true;
  group.add(tail);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.2), dark);
  fin.position.set(0, 0.78, 3.2);
  fin.castShadow = true;
  group.add(fin);

  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 1.1), trim);
    tip.position.set(side * 4.1, -0.04, 0.55);
    group.add(tip);
  }

  return group;
}
