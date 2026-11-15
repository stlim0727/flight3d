import * as THREE from 'three';

function resolveVector(vector, x = 0, y = 0, z = 0) {
  if (vector && typeof vector.x === 'number') return vector;
  return new THREE.Vector3(x, y, z);
}

/**
 * Present one combat event across audio, 3D effects, and optional UI callbacks.
 * Accepts both live AirToAirMissileSystem events (`type`, Vector3 fields) and
 * decoded replay combat events (`kind`, scalar fields) so live sorties and
 * replay playback share one presentation path.
 *
 * @param {object} event
 * @param {object} [context]
 * @returns {string|null} normalized event kind that was handled, or null
 */
export function presentCombatEvent(event, context = {}) {
  if (!event) return null;
  const kind = event.kind ?? event.type ?? null;
  if (!kind) return null;

  const { view, explosionSystem, audio, camera, onKill, onGunEmpty } = context;

  if (kind === 'launch') {
    const launchPos = event.position ?? event.missile?.position ?? null;
    const hasCoords = launchPos?.x !== undefined || event.x !== undefined;
    const distance = hasCoords && camera?.position?.distanceTo
      ? camera.position.distanceTo(resolveVector(launchPos, event.x, event.y, event.z))
      : 0;
    audio?.playMissileLaunch?.(distance);
    return kind;
  }

  if (kind === 'detonation') {
    const position = resolveVector(event.position, event.x, event.y, event.z);
    const velocity = resolveVector(event.velocity, event.vx, event.vy, event.vz);
    view?.spawnExplosion?.(explosionSystem, { ...event, position, velocity });
    const cameraPos = camera?.position;
    const distance = cameraPos?.distanceTo ? cameraPos.distanceTo(position) : 0;
    audio?.playRemoteExplosion?.(distance, Boolean(event.surface));
    return kind;
  }

  if (kind === 'lock') {
    audio?.playLockTone?.();
    return kind;
  }

  if (kind === 'kill') {
    onKill?.(event);
    return kind;
  }

  if (kind === 'gunEmpty') {
    onGunEmpty?.(event);
    return kind;
  }

  return null;
}

/**
 * Sync continuous combat audio (in-flight missile rocket/whoosh) from either
 * live AirToAirMissileSystem or CombatReplayPlayback.state.
 */
export function syncCombatAudio(system, { audio, camera = null, paused = false } = {}) {
  audio?.syncMissileFlight?.(paused ? [] : (system?.missiles || []), camera?.position ?? null);
}
