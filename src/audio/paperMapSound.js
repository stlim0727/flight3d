/**
 * Procedural paper-chart unfold: a soft sweep of the sheet moving air, with
 * crisp crackles where the two folds open. Generated per play so repeated
 * unfolds do not sound like the same sample.
 */
export const PAPER_UNFOLD_SECONDS = 0.6;

// Fold openings (seconds) and how many crackles each one makes.
const FOLDS = [[0.03, 7], [0.27, 6], [0.46, 3]];

export function paperUnfoldSamples(sampleRate, random = Math.random) {
  const length = Math.ceil(sampleRate * PAPER_UNFOLD_SECONDS);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const swell = Math.sin(Math.PI * i / length) ** 2;
    data[i] = (random() * 2 - 1) * 0.16 * swell;
  }
  for (const [time, count] of FOLDS) {
    for (let k = 0; k < count; k++) {
      const start = Math.floor(sampleRate * (time + random() * 0.09));
      const decay = sampleRate * (0.0015 + random() * 0.003);
      const level = 0.35 + random() * 0.55;
      const end = Math.min(length, start + Math.ceil(decay * 5));
      for (let i = start; i < end; i++) {
        data[i] += (random() * 2 - 1) * level * Math.exp(-(i - start) / decay);
      }
    }
  }
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) for (let i = 0; i < length; i++) data[i] *= 0.9 / peak;
  return data;
}

export function playPaperUnfold(ctx, output, random = Math.random) {
  const now = ctx.currentTime;
  const samples = paperUnfoldSamples(ctx.sampleRate, random);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Paper rustle has little energy below ~500 Hz; cutting it keeps the
  // crackle clear over the engine without adding a boomy thump.
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(500, now);
  filter.Q.setValueAtTime(0.7, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.32, now);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.onended = () => {
    try {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    } catch {}
  };
  source.start(now);
  return source;
}
