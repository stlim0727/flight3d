import * as THREE from 'three';
import { applyLogDepthOffset } from './RunwayMarkings.js';

// The blob fades out by 60 m AGL (~200 ft), the window where a radio-altimeter
// height cue actually matters on approach and climb-out.
export const CONTACT_SHADOW_CEILING_M = 60;

// Top-view planform envelopes (metres). Visual constants, not performance data.
const PLANFORMS = {
  B738: { lengthM: 39.5, spanM: 35.8, sweepDeg: 25 },
  F16: { lengthM: 15.0, spanM: 9.96, sweepDeg: 40 },
  C172: { lengthM: 8.3, spanM: 11.0, sweepDeg: 0 },
};

/**
 * Pure appearance model for the ultraLow ground cue: contrast and spread fall
 * off with height above ground so the blob reads as an altitude gauge.
 */
export function contactShadowAppearance(heightAboveGroundM) {
  const t = Math.min(1, Math.max(0, heightAboveGroundM / CONTACT_SHADOW_CEILING_M));
  if (heightAboveGroundM >= CONTACT_SHADOW_CEILING_M) {
    return { visible: false, opacity: 0, spread: 0 };
  }
  return {
    visible: true,
    opacity: 0.5 * Math.pow(1 - t, 1.5),
    spread: 1 + 0.35 * t,
  };
}

/** Yaw (radians, three.js Y-rotation) that points the silhouette nose (local -Z) along the aircraft forward vector. */
export function planformYaw(forwardX, forwardZ) {
  return Math.atan2(-forwardX, -forwardZ);
}

/**
 * Silhouette of the top-view planform, drawn once into a canvas alpha map.
 * Canvas y grows toward the tail; the nose sits at the top of the texture.
 */
function createPlanformTexture(planform) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const cx = 64;
  const halfSpan = 60;
  const noseY = 14, tailY = 240;
  const rootY = noseY + (tailY - noseY) * 0.42;
  const sweep = Math.tan((planform.sweepDeg * Math.PI) / 180);
  const tipY = rootY + sweep * halfSpan;
  const tailY0 = tailY - 52;
  const tailSweep = Math.tan((Math.min(40, planform.sweepDeg + 12) * Math.PI) / 180);
  const tailTipX = halfSpan * 0.42;
  const tailTipY = tailY0 + tailSweep * tailTipX;

  ctx.fillStyle = '#000';
  // Fuselage: rounded nose, constant body, tapered tail cone.
  ctx.beginPath();
  ctx.ellipse(cx, noseY + 24, 9, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - 9, noseY + 18, 18, tailY - noseY - 40);
  ctx.beginPath();
  ctx.moveTo(cx - 9, tailY - 30);
  ctx.lineTo(cx, tailY);
  ctx.lineTo(cx + 9, tailY - 30);
  ctx.closePath();
  ctx.fill();
  // Main wings: swept trapezoids, tips aft of the roots by the sweep angle.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 8, rootY);
    ctx.lineTo(cx + side * halfSpan, tipY);
    ctx.lineTo(cx + side * (halfSpan - 7), tipY + 16);
    ctx.lineTo(cx + side * 8, rootY + 34);
    ctx.closePath();
    ctx.fill();
  }
  // Horizontal stabilisers, smaller and less swept than the wings.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 5, tailY0);
    ctx.lineTo(cx + side * tailTipX, tailTipY);
    ctx.lineTo(cx + side * (tailTipX - 5), tailTipY + 12);
    ctx.lineTo(cx + side * 5, tailY0 + 20);
    ctx.closePath();
    ctx.fill();
  }
  // Feather the edges so the silhouette does not read as a hard decal.
  if ('filter' in ctx) ctx.filter = 'blur(4px)';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();

/**
 * Aircraft-shaped ground cue for the ultraLow tier, which ships without
 * shadow maps: the planform silhouette pinned to the terrain under the
 * airframe, yawed with heading and foreshortened in bank. One textured
 * quad, no extra render pass.
 */
export class GroundContactShadow {
  constructor(scene) {
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = applyLogDepthOffset(new THREE.MeshBasicMaterial({
      color: 0x14171c, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }), 4);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Ground contact shadow';
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.enabled = false;
    this.textureCache = new Map();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.mesh.visible = false;
  }

  /** Call once per rendered frame with the displayed aircraft pose. */
  update(position, quaternion, groundHeight, aircraftId, fallbackSpanM) {
    if (!this.enabled) return;
    const look = contactShadowAppearance(Math.max(0, position.y - groundHeight));
    this.mesh.visible = look.visible;
    if (!look.visible) return;
    const planform = PLANFORMS[aircraftId]
      ?? { lengthM: (fallbackSpanM ?? 12) * 1.1, spanM: fallbackSpanM ?? 12, sweepDeg: 20 };

    scratchForward.set(0, 0, -1).applyQuaternion(quaternion);
    scratchRight.set(1, 0, 0).applyQuaternion(quaternion);
    // Only the horizontal part of the wing axis reaches the ground plane.
    const bankFactor = Math.min(1, Math.max(0.12, Math.hypot(scratchRight.x, scratchRight.z)));
    this.mesh.position.set(position.x, groundHeight + 0.05, position.z);
    this.mesh.rotation.set(0, planformYaw(scratchForward.x, scratchForward.z), 0);
    this.mesh.scale.set(planform.spanM * look.spread * bankFactor, 1, planform.lengthM * look.spread);

    let texture = this.textureCache.get(aircraftId);
    if (!texture) {
      texture = createPlanformTexture(planform);
      this.textureCache.set(aircraftId, texture);
    }
    if (this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }
    this.material.opacity = look.opacity;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    for (const texture of this.textureCache.values()) texture.dispose();
  }
}
