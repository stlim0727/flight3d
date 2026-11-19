import { TurbofanSynthesizer } from './TurbofanSynthesizer.js';
import {
  remoteEngineGain, remoteEngineCutoff, dopplerFactor, stereoPan,
} from '../distanceAcoustics.js';

const MAX_VOICES = 4;
const MIN_AUDIBLE_GAIN = 0.004;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Engine N1 for live patrol aircraft, replayed pose-only targets and test fixtures. */
function engineN1(target) {
  const n1 = target?.flight?.engines?.n1?.[0];
  if (Number.isFinite(n1)) return clamp(n1, 20, 105);
  const throttle = target?.flight?.controls?.throttle ?? target?.flight?.throttle;
  if (Number.isFinite(throttle)) return 22 + clamp(throttle, 0, 1) * 78;
  const speed = target?.velocity?.length?.() ?? 0;
  return 30 + clamp(speed / 300, 0, 1) * 70;
}

/**
 * Continuous engines for opposing aircraft. Each voice is the same turbofan
 * synthesis as the listener's aircraft, scaled by distance, air absorption and
 * stereo bearing, and pitched by the source/listener closing rate. Voices live
 * outside the cockpit bus so the listener's own acoustics do not muffle them.
 */
export class RemoteEngineAudio {
  constructor(ctx, outputNode, noiseBuffer = null) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(1, ctx.currentTime);
    this.bus.connect(outputNode);
    this.noiseBuffer = noiseBuffer;
    this.voices = new Map();
    this._seen = new Set();
    this._right = { x: 0, y: 0, z: 0 };
  }

  setEngineVolume(level) {
    if (!Number.isFinite(level)) return;
    this.bus?.gain.setTargetAtTime(clamp(level, 0, 1), this.ctx?.currentTime ?? 0, 0.05);
  }

  update(targets, camera = null, listenerVelocity = null) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const listener = camera?.position ?? null;
    const right = this._rightFromCamera(camera);
    const list = Array.isArray(targets) ? targets : [];
    this._seen.clear();

    for (const target of list) {
      if (!target?.alive || !target.position) continue;
      const id = target.id ?? target.callsign;
      if (id == null || this._seen.has(id)) continue;
      if (this._seen.size >= MAX_VOICES) break;
      const distance = listener?.distanceTo?.(target.position) ?? this._distance(listener, target.position);
      const gain = remoteEngineGain(distance);
      if (gain < MIN_AUDIBLE_GAIN) continue;
      this._seen.add(id);
      const voice = this.voices.get(id) ?? this._createVoice(id, now);
      voice.synth.update({ engine1: { n1: engineN1(target) } }, now,
        listener ? dopplerFactor(target.position, target.velocity, listener, listenerVelocity) : 1);
      voice.filter.frequency.setTargetAtTime(remoteEngineCutoff(distance), now, 0.08);
      voice.gain.gain.setTargetAtTime(gain, now, 0.08);
      voice.panner?.pan.setTargetAtTime(stereoPan(target.position, listener, right), now, 0.06);
    }

    for (const [id, voice] of this.voices) {
      if (this._seen.has(id)) continue;
      this.voices.delete(id);
      this._retire(voice, now);
    }
  }

  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.voices.values()) this._retire(voice, now);
    this.voices.clear();
    this._seen.clear();
  }

  _distance(listener, position) {
    if (!listener) return 0;
    const dx = position.x - listener.x;
    const dy = position.y - listener.y;
    const dz = position.z - listener.z;
    return Math.hypot(dx, dy, dz);
  }

  _createVoice(id, now) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(remoteEngineCutoff(0), now);
    filter.Q.setValueAtTime(0.4, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    const panner = typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null;
    if (panner) {
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.bus);
    } else {
      filter.connect(gain);
      gain.connect(this.bus);
    }
    const synth = new TurbofanSynthesizer(this.ctx, filter, this.noiseBuffer);
    const voice = { id, synth, filter, gain, panner };
    this.voices.set(id, voice);
    return voice;
  }

  _retire(voice, now) {
    try {
      voice.gain.gain.cancelScheduledValues?.(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value ?? 0, now);
      voice.gain.gain.setTargetAtTime(0, now, 0.03);
    } catch (error) {
      void error;
    }
    voice.synth.dispose(now + 0.12);
  }

  _rightFromCamera(camera) {
    const q = camera?.quaternion;
    if (!q) return null;
    this._right.x = 1 - 2 * (q.y * q.y + q.z * q.z);
    this._right.y = 2 * (q.x * q.y + q.w * q.z);
    this._right.z = 2 * (q.x * q.z - q.w * q.y);
    return this._right;
  }
}
