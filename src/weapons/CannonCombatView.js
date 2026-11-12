import * as THREE from 'three';

const CAPACITY = 512;
let flashTexture = null;
let tracerTexture = null;

function tracerDotTexture() {
  if (tracerTexture || typeof document === 'undefined') return tracerTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  gradient.addColorStop(0, 'rgba(255,255,220,1)');
  gradient.addColorStop(0.45, 'rgba(255,206,120,0.85)');
  gradient.addColorStop(1, 'rgba(255,160,50,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  tracerTexture = new THREE.CanvasTexture(canvas);
  tracerTexture.needsUpdate = true;
  return tracerTexture;
}

function muzzleFlashTexture() {
  if (flashTexture || typeof document === 'undefined') return flashTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,232,1)');
  gradient.addColorStop(0.28, 'rgba(255,204,96,0.9)');
  gradient.addColorStop(0.62, 'rgba(255,138,40,0.35)');
  gradient.addColorStop(1, 'rgba(255,110,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  flashTexture = new THREE.CanvasTexture(canvas);
  flashTexture.needsUpdate = true;
  return flashTexture;
}

/**
 * Scene mirror for the M61A1: tracer points, muzzle flash and nothing else.
 * Bullet physics and ammunition live in VulcanCannon/AirToAirMissileSystem.
 */
export class CannonCombatView {
  constructor(scene, system) {
    this.scene = scene;
    this.system = system;
    this.positions = new Float32Array(CAPACITY * 3);
    this.geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(this.positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attribute);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.PointsMaterial({
      map: tracerDotTexture(),
      color: 0xffd27a,
      size: 1.4,
      transparent: true,
      opacity: 0.95,
      alphaTest: 0.02,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'VulcanTracers';
    this.points.frustumCulled = false;
    scene.add(this.points);

    // A one-point cloud uses the same textured-alpha path as the smoke trails;
    // SpriteMaterial renders an opaque square for this canvas texture.
    this.flashPosition = new Float32Array(3);
    this.flashGeometry = new THREE.BufferGeometry();
    const flashAttribute = new THREE.BufferAttribute(this.flashPosition, 3);
    flashAttribute.setUsage(THREE.DynamicDrawUsage);
    this.flashGeometry.setAttribute('position', flashAttribute);
    this.flash = new THREE.Points(this.flashGeometry, new THREE.PointsMaterial({
      map: muzzleFlashTexture(),
      color: 0xffd08a,
      size: 1.9,
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.02,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }));
    this.flash.name = 'VulcanMuzzleFlash';
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    scene.add(this.flash);
    this.flashPhase = 0;
  }

  sync(dt) {
    const bullets = this.system.cannon?.bullets || [];
    const count = Math.min(CAPACITY, bullets.length);
    for (let index = 0; index < count; index++) {
      const position = bullets[index].position;
      const offset = index * 3;
      this.positions[offset] = position.x;
      this.positions[offset + 1] = position.y;
      this.positions[offset + 2] = position.z;
    }
    this.geometry.setDrawRange(0, count);
    if (count) this.geometry.attributes.position.needsUpdate = true;

    const cannon = this.system.cannon;
    const firing = Boolean(cannon?.firing && cannon.rounds > 0);
    this.flash.visible = firing;
    if (firing) {
      this.flashPhase += dt;
      this.flashPosition[0] = cannon.muzzlePosition.x;
      this.flashPosition[1] = cannon.muzzlePosition.y;
      this.flashPosition[2] = cannon.muzzlePosition.z;
      this.flashGeometry.attributes.position.needsUpdate = true;
    }
  }

  clear() {
    this.geometry.setDrawRange(0, 0);
    this.flash.visible = false;
  }
}
