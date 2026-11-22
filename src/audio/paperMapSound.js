/**
 * Procedural paper-chart rustle: a soft sweep of the sheet moving air, with
 * crisp crackles where the folds open or close. Generated per play so
 * repeated handling does not sound like the same sample.
 */
export const PAPER_SHEET = Object.freeze({
  // Three panels opening one after another.
  unfold: Object.freeze({ seconds: 0.6, level: 0.32, folds: [[0.03, 7], [0.27, 6], [0.46, 3]] }),
  // Quicker and softer; the last cluster is the creases being pressed flat.
  fold: Object.freeze({ seconds: 0.45, level: 0.26, folds: [[0.02, 4], [0.16, 5], [0.31, 6]] }),
});

export function paperSheetSamples(sampleRate, sheet = PAPER_SHEET.unfold, random = Math.random) {
  const length = Math.ceil(sampleRate * sheet.seconds);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const swell = Math.sin(Math.PI * i / length) ** 2;
    data[i] = (random() * 2 - 1) * 0.16 * swell;
  }
  for (const [time, count] of sheet.folds) {
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

export function playPaperSheet(ctx, output, sheet = PAPER_SHEET.unfold, random = Math.random) {
  const now = ctx.currentTime;
  const samples = paperSheetSamples(ctx.sampleRate, sheet, random);
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
  gain.gain.setValueAtTime(sheet.level, now);
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
