import { Vector3 } from 'three';
import { AircraftBreakup } from '../effects/AircraftBreakup.js';
import { ExplosionSystem } from '../effects/ExplosionSystem.js';
import { sampleTrack, sampleRemote } from './TrackSampler.js';

// Effects are visual approximations, not recorded physics. Bound both their lifetime and
// seek reconstruction work; a long-dead aircraft remains hidden until its recorded respawn.
export const REPLAY_IMPACT_LIFETIME = 30;

export function crashEvents(track, pilot) {
  const timeline = track.metadata?.room?.timeline;
  const states = Array.isArray(timeline) ? timeline.map(event => ({ timeSec: event.timeSec, ...event.states[pilot] }))
    : pilot > 0 ? track.remotes[pilot - 1].samples : [];
  const events = [];
  let previous;
  for (const state of states) {
    if (state.crashed && (!previous?.crashed || previous.segment !== state.segment)) {
      const pose = pilot === 0 ? sampleTrack(track, state.timeSec) : sampleRemote(track, pilot - 1, state.timeSec);
      if (pose) events.push({ timeSec: state.timeSec, segment: state.segment,
        type: state.crash?.type ?? 'unknown', speedKnots: state.crash?.speedKnots,
        position: new Vector3(pose.x, pose.y, pose.z), quat: [...pose.quat],
        velocity: impactVelocity(track, pilot, state.timeSec, state.crash?.speedKnots) });
    }
    previous = state;
  }
  return events;
}

/** Derive velocity only inside one observed segment; a respawn must not launch wreckage. */
function impactVelocity(track, pilot, time, speedKnots) {
  const samples = pilot === 0 ? track.samples : track.remotes[pilot - 1].samples;
  let index = samples.findLastIndex(sample => sample.timeSec <= time + 1e-5);
  if (index < 1) return new Vector3();
  const a = samples[index - 1], b = samples[index];
  if (a.segment !== b.segment || a.visible === false || b.visible === false) return new Vector3();
  const dt = b.timeSec - a.timeSec;
  if (!(dt > 0)) return new Vector3();
  const velocity = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).divideScalar(dt);
  if (Number.isFinite(speedKnots) && speedKnots >= 0 && velocity.lengthSq() > 0) velocity.setLength(speedKnots / 1.94384);
  return velocity;
}

export class ReplayCrashEffects {
  constructor({ scene, aircraft, poseRoot = aircraft.group, terrain, breakup, explosions }) {
    this.aircraft = aircraft;
    this.poseRoot = poseRoot;
    this.terrain = terrain;
    this.ownsBreakup = !breakup;
    this.ownsExplosions = !explosions;
    this.breakup = breakup ?? new AircraftBreakup(scene);
    this.explosions = explosions ?? new ExplosionSystem(scene, terrain);
    this.event = null;
    this.age = 0;
  }

  apply(event, time, { visible = true, seek = false } = {}) {
    const age = event ? Math.max(0, time - event.timeSec) : 0;
    if (!event || !visible || age >= REPLAY_IMPACT_LIFETIME) {
      this.clear();
      return;
    }
    if (event !== this.event || seek || age < this.age) {
      this.clear();
      this.event = event;
      this.poseRoot.position.copy(event.position);
      this.poseRoot.quaternion.fromArray(event.quat);
      this.poseRoot.visible = true;
      this.aircraft.group.visible = true;
      this.poseRoot.updateMatrixWorld(true);
      this.explosions.spawnExplosion({ type: event.type, point: event.position, speedKnots: event.speedKnots }, event.velocity);
      this.breakup.spawn(this.aircraft, event.velocity);
    }
    const water = this.terrain?.getWaterLevel?.(event.position.x, event.position.z) ?? 0;
    let remaining = age - this.age;
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, 1 / 60);
      this.breakup.update(dt, this.terrain, water);
      this.explosions.update(dt);
      remaining -= dt;
    }
    this.age = age;
  }

  clear() {
    if (!this.event) return;
    this.breakup.clear();
    this.explosions.clear();
    this.event = null;
    this.age = 0;
  }

  dispose() {
    this.clear();
    if (this.ownsBreakup) this.breakup.disposePrepared();
    if (this.ownsExplosions) this.explosions.dispose();
  }
}
