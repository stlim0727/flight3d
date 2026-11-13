import * as THREE from 'three';

/** Parked-airliner origin sits this far above the pavement (see IncheonParkedAirliners). */
const ORIGIN_HEIGHT = 3.5;

/**
 * Builds a moving 737 from the already-parsed parked-airliner assets: no extra GLTF parse.
 * Geometry, livery materials and the gear material stay owned by IncheonParkedAirliners, so
 * dispose() only detaches the meshes. The pose pivots about the main gear so rotation lifts
 * the nose instead of sinking the tail through the runway.
 */
export function buildPrecedingFlightVisuals(assets, { livery = 'korean', gearMaterial, groundY = 0, name = 'preceding-flight' } = {}) {
  const materials = assets.liveries[livery] ?? Object.values(assets.liveries)[0];
  const group = new THREE.Group(); group.name = name;
  const model = new THREE.Group(); model.name = `${name}-model`; group.add(model);
  const body = new THREE.Mesh(assets.geometry, materials.body); body.name = `${name}-body`;
  const decal = new THREE.Mesh(assets.decals, materials.decal); decal.name = `${name}-titles`;
  const ownGearMaterial = gearMaterial ? null : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .65, metalness: .15 });
  const gear = new THREE.Mesh(assets.gear, gearMaterial ?? ownGearMaterial); gear.name = `${name}-gear`;
  body.castShadow = gear.castShadow = true; body.receiveShadow = true;
  model.add(body, decal, gear);
  if (!assets.gear.boundingBox) assets.gear.computeBoundingBox();
  const pivotZ = Math.max(0, assets.gear.boundingBox.max.z - 0.5);
  model.position.set(0, ORIGIN_HEIGHT, -pivotZ);
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  return {
    group, gear, pivotZ,
    update(flight) {
      const { x, y, z, heading, pitch } = flight.pose;
      // Pivot at the main gear contact point, displaced along the path by the pivot offset.
      group.position.set(x + Math.sin(heading) * -pivotZ, groundY + y, z - Math.cos(heading) * -pivotZ);
      euler.set(pitch, -heading, 0); group.quaternion.setFromEuler(euler);
      gear.visible = flight.gearDown;
      group.visible = flight.phase !== 'vacated';
    },
    dispose() { group.removeFromParent(); ownGearMaterial?.dispose(); },
  };
}

/** Waits for the airport's parked airliners, then adds KE653's meshes to `scene`. */
export async function loadPrecedingFlightVisuals(parked, scene, options = {}) {
  if (!parked?.ready) return null;
  const loaded = await parked.ready;
  if (!loaded || !parked.assets || parked.disposed) return null;
  const visuals = buildPrecedingFlightVisuals(parked.assets, { gearMaterial: parked.gearMaterial, groundY: parked.elevation, ...options });
  scene.add(visuals.group);
  return visuals;
}
