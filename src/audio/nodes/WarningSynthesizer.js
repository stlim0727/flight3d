/**
 * WarningSynthesizer — cockpit audio warnings:
 * stall warning horn / stick shaker chirp, caution & warning chimes,
 * Radar Warning Receiver (RWR) tones, missile lock tones, and pilot high-G straining breath sound.
 */
export class WarningSynthesizer {
  constructor(ctx, warningOutput, cockpitOutput) {
    this.ctx = ctx;
    this.warningOutput = warningOutput;
    this.cockpitOutput = cockpitOutput;

    this.stallBeepTime = 0;
    this.threatLevel = 0;
    this.threatTimer = 0;
    this.threatToneFlip = false;
    this.alertId = null;
    this.alertTimer = 0;
    this.alertElapsed = 0;

    // Cockpit Warning Tone Oscillator
    this.warningOsc = this.ctx.createOscillator();
    this.warningOsc.type = 'sawtooth';
    this.warningOsc.frequency.setValueAtTime(680, this.ctx.currentTime);

    this.warningGain = this.ctx.createGain();
    this.warningGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.warningOsc.connect(this.warningGain);
    this.warningGain.connect(this.warningOutput);
    this.warningOsc.start();

    // Pilot High-G Straining Maneuver Breath Synthesizer
    const bufferSize = this.ctx.sampleRate * 2;
    const strainBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = strainBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    this.gStrainNoise = this.ctx.createBufferSource();
    this.gStrainNoise.buffer = strainBuffer;
    this.gStrainNoise.loop = true;

    this.gStrainFilter = this.ctx.createBiquadFilter();
    this.gStrainFilter.type = 'bandpass';
    this.gStrainFilter.frequency.setValueAtTime(650, this.ctx.currentTime);
    this.gStrainFilter.Q.setValueAtTime(1.8, this.ctx.currentTime);

    this.gStrainGain = this.ctx.createGain();
    this.gStrainGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.gStrainNoise.connect(this.gStrainFilter);
    this.gStrainFilter.connect(this.gStrainGain);
    this.gStrainGain.connect(this.cockpitOutput);
    this.gStrainNoise.start();
  }

  reset() {
    this.stallBeepTime = 0;
    this.threatLevel = 0;
    this.threatTimer = 0;
    this.threatToneFlip = false;
    this.alertId = null;
    this.alertTimer = 0;
    this.alertElapsed = 0;
    if (this.warningGain) this.warningGain.gain.setValueAtTime(0, this.ctx.currentTime);
    if (this.gStrainGain) this.gStrainGain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  updateGStrain(state, now, isCockpitCam) {
    if (!this.gStrainGain || !this.gStrainFilter) return;
    const pilot = state.pilot;
    const gZ = pilot?.gZ ?? state.gForce ?? 1.0;
    const consciousness = pilot?.consciousness ?? 1.0;
    const isGLOC = Boolean(pilot?.isGLOC);

    if (isCockpitCam && !isGLOC && (Math.abs(gZ) > 3.0 || consciousness < 0.9) && consciousness > 0.0) {
      const cycle = (now % 2.5) / 2.5;
      const breathShape = cycle < 0.25
        ? Math.sin(cycle / 0.25 * Math.PI)
        : 0.35 + 0.35 * Math.sin((cycle - 0.25) / 0.75 * Math.PI);
      const gExcess = Math.max(0.0, (Math.abs(gZ) - 3.0) / 4.0);
      const fatigueExcess = Math.max(0.0, (1.0 - consciousness) * 0.7);
      const severity = Math.max(0.0, Math.min(1.0, gExcess + fatigueExcess));
      const targetVol = Math.max(0.0, Math.min(0.70, severity * breathShape * 0.65));
      const targetFreq = 500 + severity * 400 + (cycle < 0.25 ? 300 : 0);
      this.gStrainGain.gain.setTargetAtTime(targetVol, now, 0.05);
      this.gStrainFilter.frequency.setTargetAtTime(targetFreq, now, 0.05);
    } else {
      this.gStrainGain.gain.setTargetAtTime(0.0, now, 0.08);
    }
  }

  updateWarnings(dt, state, now, isPiston, aircraftId, onVoice) {
    const alert = state.warnings?.[0];
    this.alertTimer += dt;
    this.alertElapsed += dt;
    if (alert?.id !== this.alertId) {
      if (this.alertId || alert) onVoice?.(null);
      this.alertId = alert?.id;
      this.alertTimer = 99;
      this.alertElapsed = 0;
    }
    if (alert?.voice && this.alertTimer >= 4) {
      onVoice?.(alert.voice);
      this.alertTimer = 0;
    }

    const stallWarning = state.isStallWarning ?? (state.isStalled || state.isPreStall);
    if (isPiston) {
      const horn = !state.onGround && stallWarning;
      this.warningGain.gain.setValueAtTime(horn ? 0.30 : 0, now);
    } else if (stallWarning && state.isStalled && !state.onGround) {
      this.stallBeepTime += dt;
      const beepActive = (this.stallBeepTime % 0.25) < 0.14;
      this.warningGain.gain.setValueAtTime(beepActive ? 0.50 : 0.0, now);
    } else if (stallWarning && !state.onGround) {
      this.stallBeepTime += dt;
      const chirpActive = (this.stallBeepTime % 0.3) < 0.05 || ((this.stallBeepTime % 0.3) > 0.09 && (this.stallBeepTime % 0.3) < 0.14);
      this.warningGain.gain.setValueAtTime(chirpActive ? 0.18 : 0.0, now);
    } else {
      this.stallBeepTime = 0;
      this.warningGain.gain.setValueAtTime(0.0, now);
    }

    if ((alert?.id === 'overspeed' || alert?.id === 'takeoff-config') && !isPiston) {
      this.warningOsc.frequency.setValueAtTime(800, now);
      this.warningGain.gain.setValueAtTime((this.alertElapsed % 0.16) < 0.08 ? 0.35 : 0, now);
    } else if (alert?.id === 'engine' && aircraftId === 'B738' && this.alertElapsed < 0.18) {
      this.warningOsc.frequency.setValueAtTime(1000, now);
      this.warningGain.gain.setValueAtTime(0.25, now);
    } else {
      this.warningOsc.frequency.setValueAtTime(680, now);
    }
    return alert;
  }

  updateThreatAlert(dt, level, isMuted, volume) {
    if (!this.ctx || isMuted || volume === 0) return;
    if (level !== this.threatLevel) {
      this.threatLevel = level;
      this.threatTimer = 0;
    }
    if (!level) return;
    this.threatTimer -= dt;
    if (this.threatTimer > 0) return;
    this.playRwrTone(level);
    this.threatTimer = level === 3 ? 0.18 : level === 2 ? 0.32 : 1.15;
  }

  playRwrTone(level) {
    if (!this.ctx || !this.warningOutput) return;
    const now = this.ctx.currentTime;
    const launch = level === 3;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = launch ? 'sawtooth' : 'square';
    if (level === 1) osc.frequency.setValueAtTime(820, now);
    else if (level === 2) osc.frequency.setValueAtTime(1320, now);
    else {
      this.threatToneFlip = !this.threatToneFlip;
      osc.frequency.setValueAtTime(this.threatToneFlip ? 1040 : 720, now);
    }
    const peak = level === 3 ? 0.12 : level === 2 ? 0.07 : 0.035;
    const duration = launch ? 0.12 : 0.075;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.warningOutput);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playLockTone(isMuted, volume) {
    if (!this.ctx || isMuted || volume === 0) return;
    const now = this.ctx.currentTime;
    for (const [offset, frequency] of [[0, 980], [0.085, 1460]]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.055, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.08);
      osc.connect(gain);
      gain.connect(this.warningOutput);
      osc.start(now + offset);
      osc.stop(now + offset + 0.1);
    }
  }

  silence(now, timeConstant = 0.04) {
    this.warningGain?.gain.setTargetAtTime(0, now, timeConstant);
    this.gStrainGain?.gain.setTargetAtTime(0, now, timeConstant);
  }
}
