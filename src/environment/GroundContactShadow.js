import * as THREE from 'three';

// The blob fades out by 60 m AGL (~200 ft), the window where a radio-altimeter
// height cue actually matters on approach and climb-out.
export const CONTACT_SHADOW_CEILING_M = 60;

/**
 * Pure appearance model for the ultraLow ground cue: a dark disc under the
 * airframe whose spread grows and contrast fades with height above ground.
 */
export function contactShadowAppearance(heightAboveGroundM, wingspanM) {
  const t = Math.min(1, Math.max(0, heightAboveGroundM / CONTACT_SHADOW_CEILING_M));
  if (heightAboveGroundM >= CONTACT_SHADOW_CEILING_M) {
    return { visible: false, opacity: 0, radius: 0 };
  }
  return {
    visible: true,
    opacity: 0.5 * Math.pow(1 - t, 1.5),
    radius: wingspanM * (0.32 + 0.18 * t),
  };
}

/**
 * Flat disc projected onto the terrain beneath the aircraft, used only when the
 * shadow-map pipeline is off (ultraLow tier) so takeoff and landing still have
 * a direct height-over-ground cue. One transparent quad, no extra render pass.
 */
export class GroundContactShadow {
  constructor(scene) {
    this.geometry = new THREE.CircleGeometry(1, 24);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshBasicMaterial({
      color: 0x14171c, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Ground contact shadow';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = true;
    scene.add(this.mesh);
    this.enabled = false;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.mesh.visible = false;
  }

  /** Call once per rendered frame with the displayed aircraft position. */
  update(position, groundHeight, wingspan) {
    if (!this.enabled) return;
    const look = contactShadowAppearance(Math.max(0, position.y - groundHeight), wingspan);
    this.mesh.visible = look.visible;
    if (!look.visible) return;
    this.mesh.position.set(position.x, groundHeight + 0.05, position.z);
    this.mesh.scale.setScalar(look.radius);
    this.material.opacity = look.opacity;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
