/**
 * MasterMixerChain — builds and routes the core Web Audio mastering chain:
 * master gain -> dynamic range compressor -> makeup gain -> audio destination,
 * and interior cockpit acoustics -> ambient bus -> distance attenuation stage.
 */
export class MasterMixerChain {
  static create(ctx, effectiveVolume, engineVolume, isReplayPaused = false) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(8, ctx.currentTime);
    compressor.ratio.setValueAtTime(6, ctx.currentTime);
    compressor.attack.setValueAtTime(0.002, ctx.currentTime);
    compressor.release.setValueAtTime(0.18, ctx.currentTime);

    const makeupGain = ctx.createGain();
    makeupGain.gain.setValueAtTime(1.0, ctx.currentTime);
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(effectiveVolume, ctx.currentTime);

    masterGain.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(ctx.destination);

    const cockpitFilter = ctx.createBiquadFilter();
    cockpitFilter.type = 'lowpass';
    cockpitFilter.frequency.setValueAtTime(2800, ctx.currentTime);

    const distanceGain = ctx.createGain();
    distanceGain.gain.setValueAtTime(1.0, ctx.currentTime);
    const ambientBus = ctx.createGain();
    ambientBus.gain.setValueAtTime(isReplayPaused ? 0.0 : 1.0, ctx.currentTime);
    cockpitFilter.connect(ambientBus);
    ambientBus.connect(distanceGain);
    distanceGain.connect(masterGain);

    const engineBus = ctx.createGain();
    engineBus.gain.setValueAtTime(engineVolume, ctx.currentTime);
    engineBus.connect(cockpitFilter);

    return { compressor, makeupGain, masterGain, cockpitFilter, distanceGain, ambientBus, engineBus };
  }
}
