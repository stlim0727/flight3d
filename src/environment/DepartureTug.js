import * as THREE from 'three';

// Metres, not a scaled-up car. A 737 conventional towbar is about 5.1 m long.
export const TUG = { width: 2.7, length: 6, wheelbase: 3.6, wheelRadius: .48,
  hitchZ: 3, towbarLength: 5.1, noseGearZ: -12.5, clearDistance: 26 };
const up = new THREE.Vector3(0, 1, 0);

/** Low-profile conventional airport tractor with a rear tow hitch. */
export function createDepartureTug() {
  const group = new THREE.Group(); group.name = 'departure-tug';
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe9b92f, roughness: .62, metalness: .15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20262d, roughness: .88 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa2abb1, roughness: .35, metalness: .7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x244653, roughness: .23, metalness: .25 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffdf9f, emissiveIntensity: .7 });
  const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xffa52a, emissive: 0xff8800 });
  const box = (parent, w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  };
  const body = box(group, 2.7, .65, 5.7, 0, .9, 0, yellow); body.name = 'tug-counterweight';
  box(group, 2.45, .25, 5.6, 0, .48, 0, dark);
  for (const z of [-2.98, 2.98]) box(group, 2.8, .27, .18, 0, .67, z, dark);
  const cab = box(group, 2.15, .9, 1.8, 0, 1.55, -1.7, glass); cab.name = 'tug-cab';
  box(group, 2.35, .12, 2, 0, 2.06, -1.7, yellow);
  for (const x of [-1.12, 1.12]) {
    for (const z of [-2.55, -.85]) box(group, .09, .98, .09, x, 1.57, z, yellow);
    box(group, .09, .07, 1.8, x, 1.34, -1.7, yellow);
    box(group, .12, .35, .12, x * 1.15, 1.68, -2.3, dark);
    box(group, .32, .08, 1.2, x * 1.15, .47, -.2, steel);
  }
  for (let z = .1; z < 2.3; z += .22) box(group, 1.8, .025, .07, 0, 1.24, z, dark);
  for (const x of [-1, 1]) {
    box(group, .28, .2, .07, x, .95, -3.08, lamp);
    for (let i = 0; i < 3; i++) box(group, .16, .19, .025, x + (i - 1) * .19, .68, 3.08, i % 2 ? yellow : steel);
  }
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.13, .15, .2, 12), beaconMaterial);
  beacon.position.set(.7, 2.22, -1.7); group.add(beacon);
  const wheels = [], steering = [];
  for (const z of [-1.8, 1.8]) for (const x of [-1.29, 1.29]) {
    const swivel = new THREE.Group(); swivel.position.set(x, TUG.wheelRadius, z); group.add(swivel);
    const axle = new THREE.Group(); swivel.add(axle);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(TUG.wheelRadius, TUG.wheelRadius, .35, 24), dark);
    tire.rotation.z = Math.PI / 2; axle.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .37, 16), steel);
    hub.rotation.z = Math.PI / 2; axle.add(hub);
    box(axle, .39, .035, .38, 0, 0, 0, yellow);
    wheels.push(axle); if (z < 0) steering.push(swivel);
  }
  const towbar = new THREE.Group(); towbar.name = 'tug-towbar'; group.add(towbar);
  box(towbar, .14, .16, TUG.towbarLength, 0, .5, TUG.hitchZ + TUG.towbarLength / 2, yellow);
  for (const z of [TUG.hitchZ, TUG.hitchZ + TUG.towbarLength]) box(towbar, .46, .14, .32, 0, .5, z, steel);
  box(towbar, .85, .08, .14, 0, .38, 5.6, steel);
  for (const x of [-.42, .42]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .12, 12), dark);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .19, 5.6); towbar.add(wheel);
  }
  group.userData.animation = { wheels, steering, towbar, beacon, body, cab,
    elapsed: 0, previous: new THREE.Vector3(), initialized: false, detached: false,
    detachedSeconds: 0, speed: 0, distance: 0, clear: false, yaw: 0, steeringAngle: 0, pinReleased: false };
  return group;
}

/** Fixed-length tow constraint while coupled; bicycle steering when released. */
export function updateDepartureTug(group, sim, dt, detached) {
  const state = group.userData.animation; state.elapsed += dt;
  const nose = new THREE.Vector3(0, 0, TUG.noseGearZ).applyQuaternion(sim.quaternion).add(sim.position);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(sim.quaternion); forward.y = 0; forward.normalize();
  const link = TUG.hitchZ + TUG.towbarLength;
  if (!state.initialized) {
    group.position.copy(nose).addScaledVector(forward, link);
    state.yaw = Math.atan2(-forward.x, -forward.z);
    state.previous.copy(group.position); state.initialized = true;
  }
  const previousYaw = state.yaw; state.detached ||= detached;
  if (!state.detached) {
    // The tractor follows the moving nose pin; it does not inherit aircraft yaw,
    // pitch or roll. Its coupling can articulate relative to the nose gear.
    const direction = group.position.clone().sub(nose); direction.y = 0;
    if (direction.lengthSq() < 1e-8) direction.copy(forward);
    direction.normalize();
    group.position.copy(nose).addScaledVector(direction, link);
    state.yaw = Math.atan2(-direction.x, -direction.z);
  } else {
    state.detachedSeconds += dt; state.pinReleased = state.detachedSeconds >= 1.5;
    const remaining = Math.max(0, TUG.clearDistance - state.distance);
    const targetSpeed = state.pinReleased ? Math.min(1.8, Math.sqrt(2 * .65 * remaining)) : 0;
    state.speed += THREE.MathUtils.clamp(targetSpeed - state.speed, -.65 * dt, .55 * dt);
    const travel = Math.min(remaining, state.speed * dt);
    // Pull straight ahead first, turn around an 8 m radius, then brake to park.
    const turn = THREE.MathUtils.smoothstep(state.distance, 4, 6) * (1 - THREE.MathUtils.smoothstep(state.distance, 16.5, 18.5));
    state.steeringAngle = -Math.atan(TUG.wheelbase / 8) * turn;
    const yawDelta = travel / TUG.wheelbase * Math.tan(state.steeringAngle);
    group.position.add(new THREE.Vector3(-Math.sin(state.yaw + yawDelta / 2), 0, -Math.cos(state.yaw + yawDelta / 2)).multiplyScalar(travel));
    state.yaw += yawDelta; state.distance += travel;
    state.clear = remaining < .03 && state.speed < .05;
  }
  group.position.y = sim.currentTerrain?.getHeight(group.position.x, group.position.z) ?? sim.position.y - sim.gear.cgGroundHeightM;
  group.quaternion.setFromAxisAngle(up, state.yaw);
  const facing = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const travel = group.position.clone().sub(state.previous).dot(facing);
  if (!state.detached && Math.abs(travel) > 1e-6) {
    const yawDelta = Math.atan2(Math.sin(state.yaw - previousYaw), Math.cos(state.yaw - previousYaw));
    state.steeringAngle = THREE.MathUtils.clamp(Math.atan(TUG.wheelbase * yawDelta / travel), -.55, .55);
  }
  for (const axle of state.wheels) axle.rotateX(travel / TUG.wheelRadius);
  for (const swivel of state.steering) swivel.rotation.y = state.steeringAngle;
  state.beacon.material.emissiveIntensity = state.clear ? .2 : .3 + 2 * Math.max(0, Math.sin(state.elapsed * 8));
  state.previous.copy(group.position);
}

export function disposeDepartureTug(group) {
  const materials = new Set(); group.removeFromParent();
  group.traverse(node => { node.geometry?.dispose(); if (node.material) materials.add(node.material); });
  materials.forEach(material => material.dispose());
}
