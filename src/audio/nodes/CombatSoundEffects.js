/**
 * CombatSoundEffects — tactical weapon & combat audio effects:
 * cannon fire (M61A1 burst), missile launch & in-flight rocket motor roar,
 * flare/chaff dispense pyrotechnics, ordnance detonation / explosion, and water impact.
 */
import { propagationDelaySeconds } from '../distanceAcoustics.js';

const GUN_REFERENCE_M = 900;
const GUN_AUDIBLE_RANGE_M = 3500;
const GUN_TARGET_GAIN = 0.14;

export class CombatSoundEffects {
  constructor(ctx, masterGain, ambientBus, onExplosion, isReplayPaused = null) {
    this.ctx = ctx;
    this.masterGain = masterGain;
    this.ambientBus = ambientBus;
    this.onExplosion = onExplosion;
    this.isReplayPaused = isReplayPaused;

    this.gunFireNodes = null;
    this.missileFlightNodes = null;
    this._whiteNoise = null;
    this._whiteNoiseContext = null;
  }

  reset() {
    this.stopGunFire();
    this.stopMissileFlight();
  }

  whiteNoiseSource() {
    if (!this._whiteNoise || this._whiteNoiseContext !== this.ctx) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, rate * 2, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this._whiteNoise = buffer;
      this._whiteNoiseContext = this.ctx;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this._whiteNoise;
    return source;
  }

  effectAttenuation(distance, referenceM) {
    const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
    return Math.min(1.0, Math.max(0.04, 1 / (1 + safeDistance / referenceM)));
  }

  duckAmbient(depth = 0.3, holdSeconds = 0.4) {
    if (!this.ambientBus || !this.ctx || this.isReplayPaused?.()) return;
    const now = this.ctx.currentTime;
    const gain = this.ambientBus.gain;
    gain.cancelScheduledValues?.(now);
    gain.setValueAtTime(gain.value ?? 1, now);
    gain.linearRampToValueAtTime(Math.max(0.05, Math.min(1, depth)), now + 0.02);
    gain.setTargetAtTime(1, now + holdSeconds, 0.2);
  }

  startGunFire(isMuted, volume, distance = 0) {
    if (!this.ctx || isMuted || volume === 0) return;
    const now = this.ctx.currentTime;
    const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
    const attenuation = safeDistance >= GUN_AUDIBLE_RANGE_M ? 0 : 1 / (1 + safeDistance / GUN_REFERENCE_M);
    const targetGain = GUN_TARGET_GAIN * attenuation;
    if (targetGain <= 0.001) {
      this.stopGunFire();
      return;
    }
    if (this.gunFireNodes) {
      // The camera can move away from the muzzle while the burst continues.
      this.gunFireNodes.gain.gain.setTargetAtTime(targetGain, now, 0.06);
      return;
    }
    const rate = this.ctx.sampleRate;
    const period = Math.max(1, Math.round(rate / 100));
    const length = Math.max(period * 10, Math.floor(rate * 0.1));
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const phase = i % period;
      const envelope = phase < period * 0.3 ? 1 - phase / (period * 0.3) : 0.12;
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(760, now);
    filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(targetGain, now + 0.03);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    this.gunFireNodes = { source, gain };
  }

  stopGunFire() {
    const nodes = this.gunFireNodes;
    if (!nodes) return;
    this.gunFireNodes = null;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      nodes.source.stop(now + 0.09);
    } catch (error) {
      void error;
    }
  }

  playMissileLaunch(distance, isMuted, volume) {
    if (!this.ctx || isMuted || volume === 0) return;
    const now = this.ctx.currentTime;
    const attenuation = this.effectAttenuation(distance, 400);
    const duration = 1.6;
    this.duckAmbient(1 - 0.7 * attenuation, 0.45);
    const noise = this.whiteNoiseSource();

    const crack = this.ctx.createBiquadFilter();
    crack.type = 'highpass';
    crack.frequency.setValueAtTime(1800, now);
    const crackGain = this.ctx.createGain();
    crackGain.gain.setValueAtTime(2.0 * attenuation, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    noise.connect(crack);
    crack.connect(crackGain);
    crackGain.connect(this.masterGain);

    const roar = this.ctx.createBiquadFilter();
    roar.type = 'bandpass';
    roar.Q.setValueAtTime(0.7, now);
    roar.frequency.setValueAtTime(240, now);
    roar.frequency.exponentialRampToValueAtTime(2600, now + 0.3);
    roar.frequency.exponentialRampToValueAtTime(380, now + duration);
    const roarGain = this.ctx.createGain();
    roarGain.gain.setValueAtTime(2.2 * attenuation, now);
    roarGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(roar);
    roar.connect(roarGain);
    roarGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration);

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(34, now + 0.6);
    thumpGain.gain.setValueAtTime(1.7 * attenuation, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    thump.connect(thumpGain);
    thumpGain.connect(this.masterGain);
    thump.start(now);
    thump.stop(now + 0.7);
  }

  playFlareDispense(distance, isMuted, volume) {
    if (!this.ctx || isMuted || volume === 0) return;
    const now = this.ctx.currentTime;
    const attenuation = this.effectAttenuation(distance, 500);
    const duration = 0.9;
    const noise = this.whiteNoiseSource();

    const crack = this.ctx.createBiquadFilter();
    crack.type = 'bandpass';
    crack.Q.setValueAtTime(0.9, now);
    crack.frequency.setValueAtTime(3200, now);
    crack.frequency.exponentialRampToValueAtTime(900, now + 0.35);
    const crackGain = this.ctx.createGain();
    crackGain.gain.setValueAtTime(2.0 * attenuation, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    noise.connect(crack);
    crack.connect(crackGain);
    crackGain.connect(this.masterGain);

    const burn = this.ctx.createBiquadFilter();
    burn.type = 'bandpass';
    burn.Q.setValueAtTime(0.6, now);
    burn.frequency.setValueAtTime(1400, now);
    burn.frequency.exponentialRampToValueAtTime(700, now + duration);
    const burnGain = this.ctx.createGain();
    burnGain.gain.setValueAtTime(0.0001, now);
    burnGain.gain.exponentialRampToValueAtTime(0.7 * attenuation, now + 0.03);
    burnGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(burn);
    burn.connect(burnGain);
    burnGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration);

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(180, now);
    thump.frequency.exponentialRampToValueAtTime(60, now + 0.18);
    thumpGain.gain.setValueAtTime(1.5 * attenuation, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    thump.connect(thumpGain);
    thumpGain.connect(this.masterGain);
    thump.start(now);
    thump.stop(now + 0.22);
  }

  playChaffDispense(distance, isMuted, volume) {
    if (!this.ctx || isMuted || volume === 0) return;
    const now = this.ctx.currentTime;
    const attenuation = this.effectAttenuation(distance, 500);
    const duration = 0.28;
    const noise = this.whiteNoiseSource();

    const puff = this.ctx.createBiquadFilter();
    puff.type = 'lowpass';
    puff.frequency.setValueAtTime(1800, now);
    puff.frequency.exponentialRampToValueAtTime(420, now + duration);
    const puffGain = this.ctx.createGain();
    puffGain.gain.setValueAtTime(1.2 * attenuation, now);
    puffGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(puff);
    puff.connect(puffGain);
    puffGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration);

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(95, now);
    thump.frequency.exponentialRampToValueAtTime(45, now + 0.14);
    thumpGain.gain.setValueAtTime(1.2 * attenuation, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    thump.connect(thumpGain);
    thumpGain.connect(this.masterGain);
    thump.start(now);
    thump.stop(now + 0.18);
  }

  syncMissileFlight(missiles, cameraPosition, isMuted, volume) {
    if (!this.ctx || isMuted || volume === 0 || !Array.isArray(missiles)) {
      this.stopMissileFlight();
      return;
    }
    let nearest = null;
    let nearestDist = Infinity;
    for (const missile of missiles) {
      if (!missile?.alive || !missile.position) continue;
      const dist = cameraPosition?.distanceTo ? cameraPosition.distanceTo(missile.position) : 0;
      if (dist < nearestDist) {
        nearest = missile;
        nearestDist = dist;
      }
    }
    if (!nearest || nearestDist > 2500) {
      this.stopMissileFlight();
      return;
    }

    const powered = (nearest.propellant ?? 0) > 0;
    const attenuation = 1 / (1 + Math.pow(nearestDist / 220, 1.6));
    const targetGain = (powered ? 0.16 : 0.065) * attenuation;
    if (targetGain < 0.002) {
      this.stopMissileFlight();
      return;
    }

    const now = this.ctx.currentTime;
    if (!this.missileFlightNodes) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, rate, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      source.start(now);
      this.missileFlightNodes = { source, filter, gain };
    }

    const proximity = Math.max(0, 1 - nearestDist / 1600);
    const cutoff = (powered ? 550 : 340) + proximity * (powered ? 750 : 500);
    this.missileFlightNodes.filter.Q.setTargetAtTime(powered ? 0.7 : 1.15, now, 0.05);
    this.missileFlightNodes.filter.frequency.setTargetAtTime(cutoff, now, 0.05);
    this.missileFlightNodes.gain.gain.setTargetAtTime(targetGain, now, 0.05);
  }

  stopMissileFlight() {
    const nodes = this.missileFlightNodes;
    if (!nodes) return;
    this.missileFlightNodes = null;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      nodes.source.stop(now + 0.1);
    } catch (error) {
      void error;
    }
  }

  playExplosion(isWater = false, isMuted = false) {
    if (this.onExplosion) this.onExplosion();
    if (!this.ctx || isMuted) return;
    const now = this.ctx.currentTime;

    // 1. Low-Frequency Subwoofer Detonation Thump
    const bufferSize = Math.floor(this.ctx.sampleRate * 3.5);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.7));
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const bassFilter = this.ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(isWater ? 180 : 320, now);
    bassFilter.frequency.exponentialRampToValueAtTime(32, now + 2.8);

    const bassGain = this.ctx.createGain();
    bassGain.gain.setValueAtTime(1.4, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 3.2);

    noiseSrc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.masterGain);
    noiseSrc.start(now);

    // 2. High-Frequency Crunch / Debris
    const crunchBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 1.5), this.ctx.sampleRate);
    const cData = crunchBuffer.getChannelData(0);
    for (let i = 0; i < cData.length; i++) {
      cData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.3));
    }

    const crunchSrc = this.ctx.createBufferSource();
    crunchSrc.buffer = crunchBuffer;

    const crunchFilter = this.ctx.createBiquadFilter();
    crunchFilter.type = isWater ? 'bandpass' : 'highpass';
    crunchFilter.frequency.setValueAtTime(isWater ? 600 : 2200, now);
    crunchFilter.frequency.exponentialRampToValueAtTime(isWater ? 180 : 350, now + 1.2);

    const crunchGain = this.ctx.createGain();
    crunchGain.gain.setValueAtTime(isWater ? 1.0 : 0.85, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    crunchSrc.connect(crunchFilter);
    crunchFilter.connect(crunchGain);
    crunchGain.connect(this.masterGain);
    crunchSrc.start(now);
  }

  playRemoteExplosion(distance = 0, isWater = false, isMuted = false) {
    if (!this.ctx || isMuted) return;
    const now = this.ctx.currentTime;
    const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
    // Light outruns sound: a detonation kilometres away is heard after the flash.
    const at = now + propagationDelaySeconds(safeDistance);
    const volume = Math.min(1.0, Math.max(0.02, 1 / (1 + safeDistance / 1500)));

    const bufferSize = Math.floor(this.ctx.sampleRate * 2.5);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.6));
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const bassFilter = this.ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    const cutoff = Math.max(50, (isWater ? 180 : 300) - (safeDistance / 4000) * 140);
    bassFilter.frequency.setValueAtTime(cutoff, at);
    bassFilter.frequency.exponentialRampToValueAtTime(26, at + 2.0);

    const bassGain = this.ctx.createGain();
    bassGain.gain.setValueAtTime(1.2 * volume, at);
    bassGain.gain.exponentialRampToValueAtTime(0.001, at + 2.2);

    noiseSrc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.masterGain);
    noiseSrc.start(at);

    const proximity = Math.max(0, 1 - safeDistance / 4000);
    if (proximity > 0.01) {
      const crackSize = Math.floor(this.ctx.sampleRate * 0.6);
      const crackBuffer = this.ctx.createBuffer(1, crackSize, this.ctx.sampleRate);
      const crackData = crackBuffer.getChannelData(0);
      for (let i = 0; i < crackSize; i++) {
        crackData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.12));
      }
      const crackSrc = this.ctx.createBufferSource();
      crackSrc.buffer = crackBuffer;
      const crackFilter = this.ctx.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.setValueAtTime(isWater ? 1000 : 2200, at);
      crackFilter.frequency.exponentialRampToValueAtTime(isWater ? 220 : 400, at + 0.55);
      const crackGain = this.ctx.createGain();
      crackGain.gain.setValueAtTime((isWater ? 0.55 : 0.9) * volume * proximity, at);
      crackGain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      crackSrc.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(this.masterGain);
      crackSrc.start(at);
    }
  }

  playWaterSplash(isMuted = false, onSplash = null) {
    if (onSplash) onSplash();
    if (!this.ctx || isMuted) return;
    const now = this.ctx.currentTime;

    const bufferSize = Math.floor(this.ctx.sampleRate * 2.5);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.9));
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const splashFilter = this.ctx.createBiquadFilter();
    splashFilter.type = 'lowpass';
    splashFilter.frequency.setValueAtTime(380, now);
    splashFilter.frequency.exponentialRampToValueAtTime(80, now + 2.2);

    const splashGain = this.ctx.createGain();
    splashGain.gain.setValueAtTime(0.9, now);
    splashGain.gain.exponentialRampToValueAtTime(0.001, now + 2.4);

    noiseSrc.connect(splashFilter);
    splashFilter.connect(splashGain);
    splashGain.connect(this.masterGain);
    noiseSrc.start(now);

    const washBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 3.0), this.ctx.sampleRate);
    const wData = washBuffer.getChannelData(0);
    for (let i = 0; i < wData.length; i++) {
      wData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 1.5));
    }
    const washSrc = this.ctx.createBufferSource();
    washSrc.buffer = washBuffer;

    const washFilter = this.ctx.createBiquadFilter();
    washFilter.type = 'bandpass';
    washFilter.frequency.setValueAtTime(550, now);
    washFilter.frequency.exponentialRampToValueAtTime(220, now + 2.8);

    const washGain = this.ctx.createGain();
    washGain.gain.setValueAtTime(0.65, now);
    washGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

    washSrc.connect(washFilter);
    washFilter.connect(washGain);
    washGain.connect(this.masterGain);
    washSrc.start(now);
  }
}
