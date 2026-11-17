/**
 * AirframeSoundEffects — mechanical and airframe sounds:
 * ground roll rumble, touchdown tire screech & oleo thump, gear transit & flap mechanical sounds.
 */
export class AirframeSoundEffects {
  constructor(ctx, outputNode) {
    this.ctx = ctx;
    this.outputNode = outputNode;

    // Runway rolling rumble noise source
    const bufferSize = this.ctx.sampleRate * 2;
    const rumbleBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const rData = rumbleBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      rData[i] = (Math.random() * 2 - 1) * 0.6;
    }

    this.rumbleNoise = this.ctx.createBufferSource();
    this.rumbleNoise.buffer = rumbleBuffer;
    this.rumbleNoise.loop = true;

    this.rumbleFilter = this.ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.setValueAtTime(260, this.ctx.currentTime);
    this.rumbleFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.rumbleNoise.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.outputNode);
    this.rumbleNoise.start();
  }

  static playContactNoise(ctx, outputNode, duration, frequency, level, type = 'lowpass') {
    if (!ctx) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const attack = 0.008;
    for (let i = 0; i < data.length; i++) {
      const time = i / ctx.sampleRate;
      const envelope = Math.min(1, time / attack) * Math.exp(-6 * time / duration);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, now);
    filter.Q.setValueAtTime(0.7, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(outputNode);
    source.onended = () => {
      try {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    };
    source.start(now);
    source.stop(now + duration);
  }

  playFlapTransit(duration = 2.0) {
    AirframeSoundEffects.playContactNoise(this.ctx, this.outputNode, duration, 420, 0.15, 'bandpass');
  }

  playGearTransit(duration = 2.5) {
    AirframeSoundEffects.playContactNoise(this.ctx, this.outputNode, duration, 280, 0.22, 'bandpass');
  }

  update(state, now) {
    if (this.rumbleGain && this.rumbleFilter) {
      const gndSpeed = state.groundSpeedKnots !== undefined ? state.groundSpeedKnots : (state.onGround ? (state.iasKnots || 0) : 0);
      if (state.onGround && gndSpeed > 3) {
        const roughness = state.groundRoughness || 0;
        const rumbleVol = Math.min(0.60, (gndSpeed / 110.0) * 0.55 * (1 + 0.5 * roughness));
        const rumbleCutoff = 180 + Math.min(260, gndSpeed * 1.8 + roughness * 200);
        this.rumbleGain.gain.setTargetAtTime(rumbleVol, now, 0.08);
        this.rumbleFilter.frequency.setTargetAtTime(rumbleCutoff, now, 0.08);
      } else {
        this.rumbleGain.gain.setTargetAtTime(0.0, now, 0.08);
      }
    }
  }

  silence(now, timeConstant = 0.04) {
    this.rumbleGain?.gain.setTargetAtTime(0, now, timeConstant);
  }
}
