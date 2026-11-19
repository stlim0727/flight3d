/**
 * TurbofanSynthesizer — twin CFM56-7B turbofan sound synthesis.
 * Generates low-frequency combustion pink-noise roar and twin spool (N1/N2) turbine whine oscillators.
 */
export class TurbofanSynthesizer {
  constructor(ctx, outputNode, noiseBuffer = null) {
    this.ctx = ctx;
    this.outputNode = outputNode;

    // Generate pink noise buffer for turbofan combustion & bypass exhaust roar.
    // Opposing aircraft share the listener's buffer instead of multiplying it.
    if (!noiseBuffer) {
      const bufferSize = this.ctx.sampleRate * 2;
      noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

      let maxVal = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        if (Math.abs(output[i]) > maxVal) maxVal = Math.abs(output[i]);
      }
      // Normalize to peak 0.92 for robust healthy signal level across all audio gear
      if (maxVal > 0) {
        const norm = 0.92 / maxVal;
        for (let i = 0; i < bufferSize; i++) {
          output[i] *= norm;
        }
      }
    }

    this.engineNoiseBuffer = noiseBuffer;

    // Engine Roar Source
    this.engineNoise = this.ctx.createBufferSource();
    this.engineNoise.buffer = noiseBuffer;
    this.engineNoise.loop = true;

    // Combustion low-pass filter: 280 Hz (idle) up to 950 Hz (TOGA)
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(320, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.38, this.ctx.currentTime);

    this.engineNoise.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.outputNode);
    this.engineNoise.start();

    // Primary N1 Low-Pressure Fan Compressor Whine (Sine Oscillator)
    this.turbineWhine = this.ctx.createOscillator();
    this.turbineWhine.type = 'sine';
    this.turbineWhine.frequency.setValueAtTime(450, this.ctx.currentTime);

    this.turbineGain = this.ctx.createGain();
    this.turbineGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

    this.turbineWhine.connect(this.turbineGain);
    this.turbineGain.connect(this.outputNode);
    this.turbineWhine.start();

    // Secondary N2 High-Pressure Core Compressor Whine & Harmonics (Triangle Oscillator)
    this.turbineWhine2 = this.ctx.createOscillator();
    this.turbineWhine2.type = 'triangle';
    this.turbineWhine2.frequency.setValueAtTime(900, this.ctx.currentTime);

    this.turbineGain2 = this.ctx.createGain();
    this.turbineGain2.gain.setValueAtTime(0.04, this.ctx.currentTime);

    this.turbineWhine2.connect(this.turbineGain2);
    this.turbineGain2.connect(this.outputNode);
    this.turbineWhine2.start();
  }

  update(state, now, doppler = 1) {
    const n1 = Math.max(20, (state.engine1 ? state.engine1.n1 : 22));
    const n1Ratio = Math.max(0.0, Math.min(1.0, (n1 - 20) / 80.0));
    const pitch = Number.isFinite(doppler) ? Math.max(0.5, Math.min(1.5, doppler)) : 1;

    const engineFreq = (280 + n1Ratio * 670) * pitch;
    const engineVol = 0.38 + Math.pow(n1Ratio, 1.3) * 0.77;
    this.engineFilter.frequency.setTargetAtTime(engineFreq, now, 0.08);
    this.engineGain.gain.setTargetAtTime(engineVol, now, 0.08);

    const turbineFreq = (420 + Math.pow(n1Ratio, 1.2) * 1380) * pitch;
    const turbineVol = 0.08 + n1Ratio * 0.22;
    this.turbineWhine.frequency.setTargetAtTime(turbineFreq, now, 0.08);
    this.turbineGain.gain.setTargetAtTime(turbineVol, now, 0.08);

    if (this.turbineWhine2 && this.turbineGain2) {
      const turbineFreq2 = (840 + Math.pow(n1Ratio, 1.1) * 2360) * pitch;
      const turbineVol2 = 0.04 + n1Ratio * 0.12;
      this.turbineWhine2.frequency.setTargetAtTime(turbineFreq2, now, 0.08);
      this.turbineGain2.gain.setTargetAtTime(turbineVol2, now, 0.08);
    }

    // Noise has no frequency parameter; playback rate bends the roar with the
    // same ratio as the whine.
    this.engineNoise.playbackRate?.setTargetAtTime(pitch, now, 0.08);
  }

  silence(now, timeConstant = 0.04) {
    this.engineGain?.gain.setTargetAtTime(0, now, timeConstant);
    this.turbineGain?.gain.setTargetAtTime(0, now, timeConstant);
    this.turbineGain2?.gain.setTargetAtTime(0, now, timeConstant);
  }

  dispose(when = this.ctx?.currentTime ?? 0) {
    for (const source of [this.engineNoise, this.turbineWhine, this.turbineWhine2]) {
      try {
        source?.stop(when);
      } catch (error) {
        void error;
      }
    }
  }
}
