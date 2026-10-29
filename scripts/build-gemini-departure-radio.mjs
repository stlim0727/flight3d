// Author-time Gemini synthesis; the game ships only static WAVs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DEPARTURE_RADIO } from '../src/config/departureRadio.js';

const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
if (!['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'].includes(model)) throw new Error('Unsupported authoring model');
const voices = { pilot: 'Charon', crew: 'Fenrir', apron: 'Kore', ground: 'Kore', tower: 'Kore' };
const output = path.resolve('public/audio/departure');
const cache = path.resolve('.cache/gemini-departure');
const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!key) throw new Error('Set GEMINI_API_KEY in the authoring environment.');
execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
await fs.mkdir(cache, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flight3d-gemini-'));
const manifest = {};
let lastRequest = 0;

try {
  for (const [stage, lines] of Object.entries(DEPARTURE_RADIO)) {
    // Gemini supports at most two named speakers in one request.
    const groups = [];
    for (const line of lines) {
      let group = groups.at(-1);
      if (!group || new Set([...group.map(([speaker]) => speaker), line[0]]).size > 2) {
        group = []; groups.push(group);
      }
      group.push(line);
    }
    const clips = [];
    for (const [index, group] of groups.entries()) {
      const speakers = [...new Set(group.map(([speaker]) => speaker))];
      const spoken = group.map(([speaker, text]) => `${speaker}: ${text.replaceAll('123', 'one two three').replaceAll('33L', 'three three left')}`).join('\n');
      const prompt = `Read this scripted English aviation radio exchange exactly, with no introduction or additional dialogue. Calm professional voices, natural conversational intonation, brisk but clearly intelligible. Pilot is an airline pilot, crew is a ground crew member, other roles are air traffic controllers. Brief pauses between turns. No music, radio noise or sound effects.\n${spoken}`;
      const speechConfig = speakers.length === 1
        ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[speakers[0]] } } }
        : { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map(speaker => ({ speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[speaker] } } })) } };
      const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } };
      const hash = createHash('sha256').update(JSON.stringify({ model, body })).digest('hex').slice(0, 20);
      const clean = path.join(cache, `${stage}-${index}-${hash}.wav`);
      try { await fs.access(clean); }
      catch {
        // Reuse the approved clean audition only when its transcript and voices match.
        const auditionDir = path.resolve('.cache/gemini-radio');
        let audition;
        if (stage === 'clearance') {
          audition = await fs.readFile(path.join(auditionDir, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
        }
        const expected = group.map(([speaker, text]) => ({ speaker, voice: voices[speaker], text: text.replaceAll('123', 'one two three').replaceAll('33L', 'three three left') }));
        if (audition?.model === model && JSON.stringify(audition.samples) === JSON.stringify(expected)) {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(auditionDir, 'tower-clean.wav'), '-i', path.join(auditionDir, 'pilot-clean.wav'), '-filter_complex', '[0:a]apad=pad_dur=0.22[a];[a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clean]);
        } else {
          const delay = Math.max(0, 22_000 - (Date.now() - lastRequest));
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          lastRequest = Date.now();
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const details = error.error?.details || [];
            const quota = details.flatMap(detail => (detail.violations || []).map(v => ({ metric: v.quotaMetric, id: v.quotaId, value: v.quotaValue })));
            const retryDelay = details.find(detail => detail.retryDelay)?.retryDelay;
            throw new Error(`Gemini HTTP ${response.status} at ${stage}/${index}; stopped, completed requests cached. No paid fallback. ${JSON.stringify({ quota, retryDelay })}`);
          }
          const data = await response.json();
          const audio = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
          if (!audio?.data) throw new Error(`No audio at ${stage}/${index}`);
          const bytes = Buffer.from(audio.data, 'base64');
          const wav = bytes.subarray(0, 4).toString() === 'RIFF';
          if (!wav && !/^audio\/(?:L16|pcm)(?:;|$)/i.test(audio.mimeType)) throw new Error('Unsupported Gemini audio format');
          const raw = path.join(temp, 'input');
          await fs.writeFile(raw, bytes);
          const rate = /rate=(\d+)/i.exec(audio.mimeType)?.[1] || '24000';
          execFileSync('ffmpeg', ['-v', 'error', '-y', ...(!wav ? ['-f', 's16le', '-ar', rate, '-ac', '1'] : []), '-i', raw, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clean]);
        }
      }
      const filtered = path.join(temp, `${stage}-${index}.wav`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clean, '-af', 'highpass=f=300,lowpass=f=3200,acompressor=threshold=0.125:ratio=3:attack=5:release=80:makeup=1.5,alimiter=limit=0.85,apad=pad_dur=0.22', '-c:a', 'pcm_s16le', filtered]);
      clips.push(filtered);
    }
    const list = path.join(temp, 'concat.txt');
    await fs.writeFile(list, clips.map(file => `file '${file}'`).join('\n'));
    const assembled = path.join(temp, `${stage}.wav`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', assembled]);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', assembled], { encoding: 'utf8' }));
    if (!Number.isFinite(duration) || duration < 0.5 || duration > 60) throw new Error(`Invalid clip duration at ${stage}`);
    manifest[stage] = { file: `${stage}.wav`, duration, provider: 'Gemini', model, lines: lines.map(([speaker, text]) => ({ speaker, voice: voices[speaker], text })) };
    console.log(`${stage}: ${duration.toFixed(2)}s`);
  }
  // Publish only after every stage succeeds, so quota failure cannot mix providers.
  for (const stage of Object.keys(manifest)) await fs.copyFile(path.join(temp, `${stage}.wav`), path.join(output, `${stage}.wav`));
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
