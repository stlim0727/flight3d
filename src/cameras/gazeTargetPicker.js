import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const ndcPointer = new THREE.Vector2();
const projectedPos = new THREE.Vector3();

function isObjectVisible(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function resolveHitDistance(object, ray) {
  if (!object || !isObjectVisible(object)) return null;
  const hits = ray.intersectObject(object, true);
  return hits.length > 0 ? hits[0] : null;
}

/**
 * Pick a clickable 3D gaze target (bandit, aircraft, airport building, etc.)
 * from a viewport client coordinate.
 *
 * Uses exact Three.js raycasting for all target categories, plus a screen-space
 * proximity fallback for dynamic aircraft (bandits and multiplayer aircraft) so
 * fast-moving or distant targets in the sky remain easy to click.
 */
export function pickGazeTarget({
  clientX,
  clientY,
  rect,
  camera,
  sources = {},
  aircraftScreenRadiusPx = 28,
} = {}) {
  if (!camera || !rect || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

  ndcPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndcPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndcPointer, camera);

  let bestDirect = null;
  const considerDirect = (distance, target) => {
    if (!bestDirect || distance < bestDirect.distance) {
      bestDirect = { distance, target };
    }
  };

  // 1. Dynamic bandits
  const bandits = sources.bandits ?? [];
  for (const bandit of bandits) {
    if (!bandit) continue;
    if (bandit.mesh) {
      const hit = resolveHitDistance(bandit.mesh, raycaster);
      if (hit) {
        considerDirect(hit.distance, {
          kind: 'bandit',
          id: bandit.id,
          label: bandit.label || 'Bandit',
          getPosition: bandit.getPosition,
        });
      }
    }
  }

  // 2. Dynamic multiplayer / other aircraft
  const aircraftList = sources.aircraft ?? [];
  for (const craft of aircraftList) {
    if (!craft) continue;
    if (craft.mesh) {
      const hit = resolveHitDistance(craft.mesh, raycaster);
      if (hit) {
        considerDirect(hit.distance, {
          kind: 'aircraft',
          id: craft.id,
          label: craft.label || 'Aircraft',
          getPosition: craft.getPosition,
        });
      }
    }
  }

  // 3. Parked airliners (static InstancedMesh)
  for (const parkedObj of sources.parkedAircraft ?? []) {
    const hit = resolveHitDistance(parkedObj, raycaster);
    if (hit) {
      considerDirect(hit.distance, {
        kind: 'parkedAircraft',
        label: sources.parkedLabel || 'Parked Aircraft',
        position: hit.point.clone(),
      });
    }
  }

  // 4. Airport buildings, towers, terminals, ships, etc.
  for (const entry of sources.buildings ?? []) {
    if (!entry?.object) continue;
    const hit = resolveHitDistance(entry.object, raycaster);
    if (hit) {
      considerDirect(hit.distance, {
        kind: entry.kind || 'building',
        label: entry.label || '',
        position: hit.point.clone(),
      });
    }
  }

  // If a dynamic aircraft was directly hit, return it immediately.
  if (bestDirect && (bestDirect.target.kind === 'bandit' || bestDirect.target.kind === 'aircraft')) {
    return bestDirect.target;
  }

  // 5. Screen-space proximity fallback for dynamic aircraft (bandits & remote aircraft)
  // so distant aircraft in flight can be clicked without pixel-perfect hits.
  let bestScreen = null;
  const dynamicCandidates = [
    ...bandits.map(b => ({ kind: 'bandit', entry: b, fallbackLabel: 'Bandit' })),
    ...aircraftList.map(a => ({ kind: 'aircraft', entry: a, fallbackLabel: 'Aircraft' })),
  ];
  for (const { kind, entry, fallbackLabel } of dynamicCandidates) {
    if (entry?.mesh && !isObjectVisible(entry.mesh)) continue;
    const pos = typeof entry?.getPosition === 'function' ? entry.getPosition() : entry?.position;
    if (!pos) continue;
    projectedPos.copy(pos).project(camera);
    if (projectedPos.z < -1 || projectedPos.z > 1) continue;
    const dx = (projectedPos.x - ndcPointer.x) * rect.width * 0.5;
    const dy = (projectedPos.y - ndcPointer.y) * rect.height * 0.5;
    const pixelDist = Math.hypot(dx, dy);
    if (pixelDist > aircraftScreenRadiusPx) continue;
    const worldDist = camera.position.distanceTo(pos);
    if (bestDirect && bestDirect.distance < worldDist - 5) continue;
    if (!bestScreen || pixelDist < bestScreen.pixelDist) {
      bestScreen = {
        pixelDist,
        target: {
          kind,
          id: entry.id,
          label: entry.label || fallbackLabel,
          getPosition: entry.getPosition,
        },
      };
    }
  }

  if (bestScreen) return bestScreen.target;
  return bestDirect ? bestDirect.target : null;
}
