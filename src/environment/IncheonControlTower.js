import * as THREE from 'three';

// The ICN main tower stands on the landside edge of the Central Traffic Center,
// between the two terminal spurs. Position derived from the frozen OSM patch:
// (-230, -70) clears every building ring by >14m and pavement by >300m.
export const INCHEON_TOWER = Object.freeze({
  x: -230, z: -70,
  totalHeightMeters: 100.4, // Published cab-roof/mast height of the Incheon tower.
  cabEyeMeters: 78, // Mid the glazed cab band (72..82), where controllers sit.
});

const BANDS = [
  ['podium', 10.5, 9.5, 0, 6, 'concrete'],
  ['base', 9.5, 7, 6, 10, 'concrete'],
  ['shaft', 7, 4.6, 10, 68, 'concrete'],
  ['console', 5, 7.5, 68, 72, 'concrete'],
  ['cab', 7.5, 9, 72, 82, 'glass'],
  ['roof', 9.5, 3.5, 82, 85, 'concrete'],
  ['deck', 3.5, 2.2, 85, 88, 'concrete'],
  ['mast', 0.6, 0.35, 88, INCHEON_TOWER.totalHeightMeters, 'concrete'],
];

function octagonalBand([name, bottomRadius, topRadius, bottom, top, kind], floor, materials) {
  const height = top - bottom;
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 8, 1);
  const mesh = new THREE.Mesh(geometry, kind === 'glass' ? materials.glass : materials.concrete);
  mesh.name = name;
  mesh.position.y = floor + bottom + height / 2;
  mesh.rotation.y = Math.PI / 8;
  return mesh;
}

/**
 * Builds the landmark control tower over the given terrain sampler.
 * Returns the renderable group, a collider in the Incheon building-collider
 * shape, and the cab eye position for the tower camera.
 */
export function createControlTower(getHeight, {
  x = INCHEON_TOWER.x, z = INCHEON_TOWER.z,
} = {}) {
  const materials = {
    concrete: new THREE.MeshLambertMaterial({ color: 0xd9d6cf }),
    glass: new THREE.MeshLambertMaterial({ name: 'tower-window-glass', color: 0x2d4f5f, emissive: 0x0b1c24 }),
  };
  const floor = getHeight(x, z) + 0.05;
  const group = new THREE.Group();
  group.name = 'incheon-control-tower';
  group.position.set(x, 0, z);
  for (const band of BANDS) group.add(octagonalBand(band, floor, materials));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  beacon.name = 'beacon';
  beacon.position.y = floor + INCHEON_TOWER.totalHeightMeters;
  group.add(beacon);

  const r = 10.5;
  const points = Array.from({ length: 8 }, (_, i) => {
    const angle = Math.PI / 8 + i * Math.PI / 4;
    return [x + Math.cos(angle) * r, z + Math.sin(angle) * r];
  });
  points.push([...points[0]]);
  const top = floor + INCHEON_TOWER.totalHeightMeters;
  const collider = {
    points,
    top,
    bounds: new THREE.Box3(
      new THREE.Vector3(x - r, floor, z - r),
      new THREE.Vector3(x + r, top, z + r),
    ),
  };
  return { group, collider, cab: { x, y: floor + INCHEON_TOWER.cabEyeMeters, z } };
}
