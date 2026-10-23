import * as THREE from 'three';

export const SHADOW_VIEWS = [
  { key: 'shadow.leftFront', bearing: -65, elevation: 22 },
  { key: 'shadow.front', bearing: 0, elevation: 25 },
  { key: 'shadow.rightFront', bearing: 65, elevation: 22 },
  { key: 'shadow.right', bearing: 100, elevation: 40 },
  { key: 'shadow.high', bearing: 0, elevation: 65 },
  { key: 'shadow.low', bearing: -35, elevation: 12 },
];
const DURATION = 6;

/** Hold each direction, then smoothly move to the next over 1.5 seconds. */
export function shadowSunPose(elapsed) {
  const time = ((elapsed % (DURATION * SHADOW_VIEWS.length)) + DURATION * SHADOW_VIEWS.length)
    % (DURATION * SHADOW_VIEWS.length);
  const index = Math.floor(time / DURATION);
  const a = SHADOW_VIEWS[index], b = SHADOW_VIEWS[(index + 1) % SHADOW_VIEWS.length];
  const t = THREE.MathUtils.smoothstep(time % DURATION, 4.5, 6);
  const delta = ((b.bearing - a.bearing + 540) % 360) - 180;
  return { index, bearing: a.bearing + delta * t, elevation: THREE.MathUtils.lerp(a.elevation, b.elevation, t) };
}

export class CockpitShadowDemo {
  constructor(sim, onChange = () => {}) {
    this.sim = sim;
    this.onChange = onChange;
    this.active = false;
    this.paused = false;
    this.elapsed = 0;
    this.direction = new THREE.Vector3();
  }

  start() {
    this.stop();
    const sim = this.sim;
    this.saved = { cloud: sim.sky.cloudCover, time: sim.sky.timeOfDay,
      mode: sim.cameraSystem.autoSwitch ? 7 : sim.cameraSystem.mode,
      userModeSelected: sim.cameraSystem.userModeSelected, userLookOverridden: sim.cameraSystem.userLookOverridden,
      photo: sim.cameraSystem.photoCockpit,
      yaw: sim.cameraSystem.lookYaw, pitch: sim.cameraSystem.lookPitch };
    sim.setPreset('runway');
    // Settle the spawn once to produce consistent stationary flight displays.
    sim.integratePhysics(sim.physicsDt);
    sim.linearVelocity.set(0, 0, 0);
    sim.angularVelocity.set(0, 0, 0);
    Object.assign(sim.telemetry, { iasKnots: 0, tasKnots: 0, groundSpeedKnots: 0,
      vsiFpm: 0, mach: 0, gForce: 1, isStalled: false, isPreStall: false });
    sim.renderPose.reset(sim.position, sim.quaternion);
    sim.cameraSystem.setMode(0, true);
    sim.cameraSystem.photoCockpit = false;
    sim.cameraSystem.lookYaw = 0;
    sim.cameraSystem.lookPitch = -0.45;
    sim.cameraSystem.snapToTarget(sim.aircraft.group);
    sim.sky.setCloudCover(0);
    sim.sky.setTimeOfDay(9, sim.position, sim.camera.position);
    this.elapsed = 0;
    this.paused = false;
    this.active = true;
    sim.lastPresetType = 'shadow';
    this.apply();
    this.onChange();
  }

  apply() {
    const pose = shadowSunPose(this.elapsed);
    if (this.sim.cameraSystem.mode !== 0) this.sim.cameraSystem.setMode(0, true);
    this.sim.cameraSystem.photoCockpit = false;
    const bearing = THREE.MathUtils.degToRad(pose.bearing);
    const elevation = THREE.MathUtils.degToRad(pose.elevation);
    this.direction.set(Math.sin(bearing) * Math.cos(elevation), Math.sin(elevation),
      -Math.cos(bearing) * Math.cos(elevation)).applyQuaternion(this.sim.quaternion);
    this.sim.sky.sunDirectionOverride = this.direction;
    if (this.index !== pose.index) {
      this.index = pose.index;
      this.onChange();
    }
  }

  update(dt) {
    if (!this.active) return;
    if (!this.paused) this.elapsed += Math.max(0, dt);
    this.apply();
  }

  next(delta = 1) {
    if (!this.active) return;
    this.elapsed = ((this.index + delta + SHADOW_VIEWS.length) % SHADOW_VIEWS.length) * DURATION;
    this.apply();
  }

  togglePause() {
    if (!this.active) return;
    this.paused = !this.paused;
    this.onChange();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const sim = this.sim, saved = this.saved;
    sim.sky.sunDirectionOverride = null;
    sim.sky.setCloudCover(saved.cloud);
    sim.sky.setTimeOfDay(saved.time, sim.position, sim.camera.position);
    sim.cameraSystem.setMode(saved.mode, true);
    sim.cameraSystem.userModeSelected = saved.userModeSelected;
    sim.cameraSystem.userLookOverridden = saved.userLookOverridden;
    sim.cameraSystem.photoCockpit = saved.photo;
    sim.cameraSystem.lookYaw = saved.yaw;
    sim.cameraSystem.lookPitch = saved.pitch;
    sim.foliage.setTimeOfDay(saved.time);
    sim.water.syncWithAtmosphere(sim.sky);
    this.onChange();
  }
}
