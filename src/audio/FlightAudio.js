import { DepartureRadio } from './DepartureRadio.js';
import { DEPARTURE_RADIO } from '../config/departureRadio.js';
import { BANGKOK_DEPARTURE_RADIO } from '../config/bangkokDepartureRadio.js';
import { exteriorDistanceGain, exteriorAirCutoff } from './distanceAcoustics.js';
import { t } from '../i18n/index.js';
import { MasterMixerChain } from './nodes/MasterMixerChain.js';
import { TurbofanSynthesizer } from './nodes/TurbofanSynthesizer.js';
import { PistonSynthesizer } from './nodes/PistonSynthesizer.js';
import { AirflowSynthesizer } from './nodes/AirflowSynthesizer.js';
import { AirframeSoundEffects } from './nodes/AirframeSoundEffects.js';
import { WarningSynthesizer } from './nodes/WarningSynthesizer.js';
import { CombatSoundEffects } from './nodes/CombatSoundEffects.js';
import { GpwsCalloutSystem } from './nodes/GpwsCalloutSystem.js';

export class FlightAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = this.isPaused = this.isInitialized = this.crashed = this.touchdownActive = false;
    this.volume = this.engineVolume = 1.0;
    this.lastTouchdownTime = -Infinity;
    const rOpts = (dir, cfg) => ({
      context: () => this.ctx, output: () => this.masterGain,
      muted: () => this.isMuted || this.volume === 0,
      baseUrl: import.meta.env?.BASE_URL ?? '/', audioDir: dir, radioConfig: cfg,
    });
    this.departureRadio = new DepartureRadio(rOpts('audio/departure', DEPARTURE_RADIO));
    this.bangkokRadio = new DepartureRadio(rOpts('audio/bangkok', BANGKOK_DEPARTURE_RADIO));
    this.gpws = new GpwsCalloutSystem(this);
    this.loadAircraftConfig();
  }

  get lastRadioAlt() { return this.gpws.lastRadioAlt; }
  set lastRadioAlt(v) { this.gpws.lastRadioAlt = v; }
  get calledAltitudes() { return this.gpws.calledAltitudes; }
  get isPiston() { return this.profile.engineType === 'piston'; }
  get effectiveVolume() { return (this.isMuted || this.isPaused) ? 0.0 : this.volume; }
  get gunFireNodes() { return this.combat?.gunFireNodes ?? null; }
  set gunFireNodes(v) { if (this.combat) this.combat.gunFireNodes = v; }
  get missileFlightNodes() { return this.combat?.missileFlightNodes ?? null; }
  set missileFlightNodes(v) { if (this.combat) this.combat.missileFlightNodes = v; }

  cancelSpeech() { this.gpws.cancelSpeech(); }
  pickSynthVoice(s) { return this.gpws.pickSynthVoice(s); }
  playGpwsCallout(t) { this.gpws.playGpwsCallout(t); }

  reset() {
    this.combat?.reset(); this.crashed = this.touchdownActive = false; this.lastTouchdownTime = -Infinity;
    this.gpws?.reset(); this.departureRadio.stop(); this.bangkokRadio?.stop(); this.warnings?.reset();
    if (this.packGain) this.packGain.gain.setTargetAtTime(this.isPiston ? 0 : 0.16, this.ctx?.currentTime ?? 0, 0.04);
  }

  silenceEngines() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.turbofan?.silence(now); this.piston?.silence(now); this.warnings?.silence(now);
  }

  loadAircraftConfig(config = {}) {
    this.aircraftId = config.id || 'B738';
    const s = config.audio || {};
    this.profile = {
      engineType: s.engineType || 'jet',
      idleN1: config.propulsion?.idleN1Percent ?? 22, maxN1: config.propulsion?.togaN1Percent ?? 100,
      idleRpm: s.idleRpm ?? 700, maxRpm: s.maxRpm ?? 2700,
      cylinders: s.cylinders ?? 4, propellerBlades: s.propellerBlades ?? 2,
    };
    this.reset();
    this.silenceEngines();
  }

  init(context = null) {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = context || new AudioCtx();
      if (typeof this.ctx.onstatechange !== 'undefined') {
        this.ctx.onstatechange = () => {
          if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
            this.ctx.resume().catch(() => {});
          }
        };
      }
      Object.assign(this, MasterMixerChain.create(this.ctx, this.effectiveVolume, this.engineVolume));
      this.airflow = new AirflowSynthesizer(this.ctx, this.cockpitFilter);
      this.turbofan = new TurbofanSynthesizer(this.ctx, this.engineBus);
      this.piston = new PistonSynthesizer(this.ctx, this.engineBus, this.turbofan.engineNoiseBuffer);
      this.airframe = new AirframeSoundEffects(this.ctx, this.cockpitFilter);
      this.warnings = new WarningSynthesizer(this.ctx, this.masterGain, this.cockpitFilter);
      this.combat = new CombatSoundEffects(this.ctx, this.masterGain, this.ambientBus, () => this.silenceOnCrash());
      Object.assign(this, this.airflow, this.turbofan, this.piston, this.airframe, this.warnings);

      this.isInitialized = true;
      for (const n of ['engineGain', 'turbineGain', 'turbineGain2', 'pistonGain', 'propGain', 'propModGain', 'gStrainGain']) {
        this[n]?.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      this.packGain.gain.setValueAtTime(this.isPiston || this.crashed ? 0 : 0.16, this.ctx.currentTime);
    } catch (e) {
      console.warn('Web Audio initialization error:', e);
    }
  }

  ensureContextRunning() {
    if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
      this.ctx.resume().catch(() => {});
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(1.0, vol));
    if (this.volume > 0.0) this.isMuted = false;
    if (this.volume === 0) {
      this.cancelSpeech(); this.stopGunFire(); this.stopMissileFlight();
      this.departureRadio.stop(); this.bangkokRadio?.stop();
    }
    this.applyMasterGain();
  }

  setEngineVolume(level) {
    if (!Number.isFinite(level)) return this.engineVolume;
    this.engineVolume = Math.max(0, Math.min(1, level));
    if (this.engineBus && this.ctx) this.engineBus.gain.setTargetAtTime(this.engineVolume, this.ctx.currentTime, 0.05);
    return this.engineVolume;
  }

  setMuted(m) {
    this.isMuted = !!m;
    if (this.isMuted) { this.cancelSpeech(); this.departureRadio.stop(); this.bangkokRadio?.stop(); }
    this.applyMasterGain();
  }

  setRadioPaused(p) { this.departureRadio.setPaused(p); this.bangkokRadio?.setPaused(p); }
  setPaused(p) { this.isPaused = !!p; if (this.isPaused) this.cancelSpeech(); this.applyMasterGain(); }

  setReplayPaused(paused) {
    this.isReplayPaused = !!paused;
    if (this.isReplayPaused) {
      this.cancelSpeech(); this.stopGunFire(); this.stopMissileFlight();
      this.departureRadio.stop(); this.bangkokRadio?.stop();
      this.warningGain?.gain.setValueAtTime(0, this.ctx?.currentTime ?? 0);
    }
    if (this.ambientBus && this.ctx) this.ambientBus.gain.setTargetAtTime(this.isReplayPaused ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  applyMasterGain() {
    if (this.masterGain && this.ctx) {
      const g = this.effectiveVolume;
      if (typeof this.masterGain.gain.setTargetAtTime === 'function') this.masterGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
      else this.masterGain.gain.setValueAtTime(g, this.ctx.currentTime);
    }
  }

  cycleVolume() {
    this.setMuted(!this.isMuted); this.volume = 1.0; this.applyMasterGain();
    return this.getVolumeState();
  }

  getVolumeState() {
    if (this.isMuted) return { muted: true, level: 0, mode: 'muted', text: t('audio.muted'), icon: '🔇' };
    return { muted: false, level: 1.0, mode: 'normal', text: t('normal.volume.100'), icon: '🔊' };
  }

  update(dt, state, isCockpitCam, cameraDistanceMeters = 0) {
    if (!this.isInitialized || !this.ctx || this.crashed) return;
    const now = this.ctx.currentTime;
    if (isCockpitCam) {
      const consciousness = state.pilot?.consciousness ?? 1.0;
      const muffle = state.pilot?.isGLOC ? 0.14 : Math.max(0.14, Math.min(1.0, consciousness));
      this.cockpitFilter.frequency.setTargetAtTime(2700 * muffle, now, 0.1);
      this.distanceGain.gain.setTargetAtTime(1.0, now, 0.1);
    } else {
      this.cockpitFilter.frequency.setTargetAtTime(exteriorAirCutoff(cameraDistanceMeters), now, 0.1);
      this.distanceGain.gain.setTargetAtTime(exteriorDistanceGain(cameraDistanceMeters), now, 0.1);
    }

    this.warnings?.updateGStrain(state, now, isCockpitCam);
    if (this.isPiston) this.piston?.update(state, now, this.profile);
    else this.turbofan?.update(state, now);
    this.airflow?.update(state, now);
    this.airframe?.update(state, now);

    if (state.touchdown && !this.touchdownActive && now - this.lastTouchdownTime >= 0.25) {
      this.lastTouchdownTime = now;
      this.playTouchdownScreech(state.groundSpeedKnots ?? state.iasKnots ?? 0);
      this.playTouchdownThump(state.touchdownSinkRate ?? Math.abs(state.vsiFpm ?? 0) / 196.85);
    }
    this.touchdownActive = !!state.touchdown;

    const alert = this.warnings?.updateWarnings(dt, state, now, this.isPiston, this.aircraftId, v => {
      this.cancelSpeech(); if (v) this.playGpwsCallout(v);
    });
    this.gpws.update(state, alert);
    this.warnings?.updateThreatAlert(dt, state.rwrLevel || 0, this.isMuted, this.volume);
  }

  playDepartureRadio(stage, profile = 'departure') {
    this.ensureContextRunning();
    return (profile === 'bangkok' ? this.bangkokRadio : this.departureRadio).play(stage);
  }

  playContactNoise(d, f, l, t = 'lowpass') {
    if (this.ctx && this.effectiveVolume !== 0) AirframeSoundEffects.playContactNoise(this.ctx, this.cockpitFilter, d, f, l, t);
  }
  playTouchdownScreech(spd = 100) {
    const s = Math.min(1, Math.max(0, spd) / 100);
    if (s > 0) this.playContactNoise(0.12 + 0.08 * s, 1800, 0.32 * s, 'bandpass');
  }
  playTouchdownThump(snk = 1.5) {
    const s = Math.min(1, Math.max(0, snk) / 3);
    if (s > 0) { this.playContactNoise(0.28, 180, 1.2 * s); this.playContactNoise(0.09, 650, 0.35 * s); }
  }

  silenceOnCrash() {
    this.crashed = true; this.cancelSpeech(); this.departureRadio.stop(); this.bangkokRadio?.stop();
    if (this.ctx) {
      for (const n of ['engineGain', 'turbineGain', 'turbineGain2', 'pistonGain', 'propGain', 'propModGain', 'windGain', 'rumbleGain', 'packGain', 'warningGain', 'gStrainGain']) this[n]?.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  playExplosion(w = false) {
    this.silenceOnCrash();
    this.combat?.playExplosion(w, this.isMuted);
  }

  playRwrTone(lvl) { this.warnings?.playRwrTone(lvl); }
  playLockTone() { this.warnings?.playLockTone(this.isMuted, this.volume); }
  updateThreatAlert(dt, lvl) { this.warnings?.updateThreatAlert(dt, lvl, this.isMuted, this.volume); }
  startGunFire() { this.combat?.startGunFire(this.isMuted, this.volume); }
  stopGunFire() { this.combat?.stopGunFire(); }
  playMissileLaunch(d = 0) { this.combat?.playMissileLaunch(d, this.isMuted, this.volume); }
  playFlareDispense(d = 0) { this.combat?.playFlareDispense(d, this.isMuted, this.volume); }
  playChaffDispense(d = 0) { this.combat?.playChaffDispense(d, this.isMuted, this.volume); }
  syncMissileFlight(m, c = null) { this.combat?.syncMissileFlight(m, c, this.isMuted, this.volume); }
  stopMissileFlight() { this.combat?.stopMissileFlight(); }
  playRemoteExplosion(d = 0, w = false) { this.combat?.playRemoteExplosion(d, w, this.isMuted); }
  playWaterSplash() {
    this.cancelSpeech();
    this.combat?.playWaterSplash(this.isMuted, () => {
      this.engineGain?.gain.setTargetAtTime(0, this.ctx?.currentTime ?? 0, 0.4);
      this.windGain?.gain.setTargetAtTime(0.05, this.ctx?.currentTime ?? 0, 0.8);
    });
  }
  duckAmbient(d = 0.3, h = 0.4) { this.combat?.duckAmbient(d, h); }
}
