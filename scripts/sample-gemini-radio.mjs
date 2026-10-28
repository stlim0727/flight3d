// Offline asset generation only: never expose the API key to the browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const output = path.resolve(process.env.GEMINI_SAMPLE_DIR || '.cache/gemini-radio');
const samples = [
  { speaker: 'tower', voice: 'Kore', text: 'Korean Air one two three, runway three three left, cleared for takeoff.' },
  { speaker: 'pilot', voice: 'Charon', text: 'Runway three three left, cleared for takeoff, Korean Air one two three.' },
];
const requests = samples.map(sample => ({
  ...sample,
  body: {
    contents: [{ parts: [{ text: `Speak the following English aviation radio transmission exactly, without introduction. Use a calm, professional ${sample.speaker === 'tower' ? 'air traffic controller' : 'airline pilot'} voice, natural conversational intonation and a brisk but clearly intelligible pace. No music or sound effects.\n${sample.text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: sample.voice } } },
    },
  },
}));

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ model, output, requests }, null, 2));
} else {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Set GEMINI_API_KEY in the terminal environment; do not paste it into chat or commit it.');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid model name');
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  await fs.mkdir(output, { recursive: true });
  for (const request of requests) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(120_000),
    });
    // No automatic retry or paid-provider fallback on quota/access failures.
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}; stopped without retry. Check model access and free-tier quota in AI Studio.`);
    const data = await response.json();
    const audio = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
    if (!audio?.data) throw new Error('Gemini returned no audio');
    const bytes = Buffer.from(audio.data, 'base64');
    const wav = bytes.subarray(0, 4).toString() === 'RIFF';
    if (!wav && !/^audio\/(?:L16|pcm)(?:;|$)/i.test(audio.mimeType)) throw new Error(`Unsupported audio format: ${audio.mimeType}`);
    const raw = path.join(output, `${request.speaker}.${wav ? 'input.wav' : 'pcm'}`);
    const clean = path.join(output, `${request.speaker}-clean.wav`);
    const radio = path.join(output, `${request.speaker}-radio.wav`);
    await fs.writeFile(raw, bytes);
    const rate = /rate=(\d+)/i.exec(audio.mimeType)?.[1] || '24000';
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...(!wav ? ['-f', 's16le', '-ar', rate, '-ac', '1'] : []), '-i', raw, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clean]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clean, '-af', 'highpass=f=300,lowpass=f=3200,acompressor=threshold=0.125:ratio=3:attack=5:release=80:makeup=1.5,alimiter=limit=0.85', '-c:a', 'pcm_s16le', radio]);
    await fs.rm(raw);
    console.log(`${request.speaker}: ${clean}\n${radio}`);
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ model, samples }, null, 2) + '\n');
}
