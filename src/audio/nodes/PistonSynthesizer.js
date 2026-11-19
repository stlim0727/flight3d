import { pistonSoundState } from '../pistonSoundState.js';

/**
 * PistonSynthesizer — piston/propeller engine sound synthesis.
 * RPM-driven periodic pulse oscillator, mixture, mag-cut, and blade-passage modulated noise.
 */
export class PistonSynthesizer {
  constructor(ctx, outputNode, noiseBuffer) {
    this.ctx = ctx;
    this.outputNode = outputNode;

    // A short pressure pulse repeated at the four-stroke firing rate. Harmonics
    // provide the exhaust's throaty "putter", without N1/N2 whistle oscillators.
    const real = new Float32Array(33);
    const imaginary = new Float32Array(33);
    for (let harmonic = 1; harmonic < real.length; harmonic++) {
      real[harmonic] = 1 / (1 + (harmonic / 5) ** 2);
      imaginary[harmonic] = -0.35 * real[harmonic];
    }
    this.pistonPulse = this.ctx.createOscillator();
    this.pistonPulse.setPeriodicWave(this.ctx.createPeriodicWave(real, imaginary));
    this.pistonPulse.frequency.setValueAtTime(24, this.ctx.currentTime);
    this.pistonFilter = this.ctx.createBiquadFilter();
    this.pistonFilter.type = 'lowpass';
    this.pistonFilter.frequency.setValueAtTime(1800, this.ctx.currentTime);
    this.pistonFilter.Q.setValueAtTime(0.7, this.ctx.currentTime);
    this.pistonGain = this.ctx.createGain();
    this.pistonGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.pistonPulse.connect(this.pistonFilter);
    this.pistonFilter.connect(this.pistonGain);
    this.pistonGain.connect(this.outputNode);
    this.pistonPulse.start();

    // Propeller air noise is amplitude-modulated by blade passage, not pitched
    // up into a turbine whine. Reuse the existing noise buffer, without a download.
    this.propNoise = this.ctx.createBufferSource();
    this.propNoise.buffer = noiseBuffer;
    this.propNoise.loop = true;
    this.propFilter = this.ctx.createBiquadFilter();
    this.propFilter.type = 'bandpass';
    this.propFilter.frequency.setValueAtTime(550, this.ctx.currentTime);
    this.propFilter.Q.setValueAtTime(0.6, this.ctx.currentTime);
    this.propGain = this.ctx.createGain();
    this.propGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.propNoise.connect(this.propFilter);
    this.propFilter.connect(this.propGain);
    this.propGain.connect(this.outputNode);
    this.propBeat = this.ctx.createOscillator();
    this.propBeat.type = 'sine';
    this.propBeat.frequency.setValueAtTime(24, this.ctx.currentTime);
    this.propModGain = this.ctx.createGain();
    this.propModGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.propBeat.connect(this.propModGain);
    this.propModGain.connect(this.propGain.gain);
    this.propBeat.start();
    this.propNoise.start();
  }

  update(state, now, profile, doppler = 1) {
    const sound = pistonSoundState(state.engine1, state.iasKnots || 0, profile);
    const rotor = Math.min(1, sound.rpm / profile.maxRpm);
    const pitch = Number.isFinite(doppler) ? Math.max(0.5, Math.min(1.5, doppler)) : 1;
    this.pistonPulse.frequency.setTargetAtTime(Math.max(1, sound.firingHz * pitch), now, 0.06);
    this.pistonFilter.frequency.setTargetAtTime(1100 + sound.power * 1500, now, 0.08);
    this.pistonGain.gain.setTargetAtTime(sound.combustion * (0.32 + sound.power * 0.40), now, 0.10);
    this.propBeat.frequency.setTargetAtTime(Math.max(1, sound.bladeHz * pitch), now, 0.06);
    this.propFilter.frequency.setTargetAtTime(350 + rotor * 700, now, 0.10);
    this.propNoise.playbackRate?.setTargetAtTime(pitch, now, 0.08);
    const air = rotor * (sound.combustion ? 1 : 0.2);
    this.propGain.gain.setTargetAtTime(air * (0.08 + sound.power * 0.12), now, 0.10);
    this.propModGain.gain.setTargetAtTime(air * (0.04 + sound.power * 0.06), now, 0.10);
  }

  silence(now, timeConstant = 0.04) {
    this.pistonGain?.gain.setTargetAtTime(0, now, timeConstant);
    this.propGain?.gain.setTargetAtTime(0, now, timeConstant);
    this.propModGain?.gain.setTargetAtTime(0, now, timeConstant);
  }
}
