/**
 * AirflowSynthesizer — aerodynamic wind noise and cockpit pack / avionics cooling airflow.
 */
export class AirflowSynthesizer {
  constructor(ctx, outputNode) {
    this.ctx = ctx;
    this.outputNode = outputNode;

    // Cockpit air conditioning and avionics cooling pack airflow
    const packBufferSize = this.ctx.sampleRate * 2;
    const packBuffer = this.ctx.createBuffer(1, packBufferSize, this.ctx.sampleRate);
    const pData = packBuffer.getChannelData(0);
    for (let i = 0; i < packBufferSize; i++) {
      pData[i] = (Math.random() * 2 - 1) * 0.45;
    }

    this.packNoise = this.ctx.createBufferSource();
    this.packNoise.buffer = packBuffer;
    this.packNoise.loop = true;

    this.packFilter = this.ctx.createBiquadFilter();
    this.packFilter.type = 'bandpass';
    this.packFilter.frequency.setValueAtTime(580, this.ctx.currentTime);
    this.packFilter.Q.setValueAtTime(0.8, this.ctx.currentTime);

    this.packGain = this.ctx.createGain();
    this.packGain.gain.setValueAtTime(0.16, this.ctx.currentTime);

    this.packNoise.connect(this.packFilter);
    this.packFilter.connect(this.packGain);
    this.packGain.connect(this.outputNode);
    this.packNoise.start();

    // Wind slipstream broadband noise
    const windBufferSize = this.ctx.sampleRate * 2;
    const windBuffer = this.ctx.createBuffer(1, windBufferSize, this.ctx.sampleRate);
    const wData = windBuffer.getChannelData(0);
    for (let i = 0; i < windBufferSize; i++) {
      wData[i] = (Math.random() * 2 - 1) * 0.55;
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = windBuffer;
    this.windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.outputNode);
    this.windNoise.start();
  }

  update(state, now) {
    const ias = state.iasKnots || 0;
    const windVol = Math.min(0.75, Math.pow(ias / 270.0, 1.5) * 0.70);
    const windCutoff = 450 + Math.min(3200, ias * 9.5);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(windCutoff, now, 0.1);
  }

  silence(now, timeConstant = 0.04) {
    this.windGain?.gain.setTargetAtTime(0, now, timeConstant);
  }
}
