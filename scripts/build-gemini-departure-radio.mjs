// Author-time Gemini synthesis; the game ships only static WAVs.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DEPARTURE_RADIO } from '../src/config/departureRadio.js';

const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
if (!['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'].includes(model)) {
  throw new Error('Unsupported authoring model: ' + model);
}

const voices = { pilot: 'Charon', crew: 'Fenrir', apron: 'Kore', ground: 'Kore', tower: 'Kore' };
const output = path.resolve('public/audio/departure');
const cache = path.resolve('.cache/gemini-departure');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    isCheck: false,
    isForce: false,
    isDryRun: false,
    stage: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') options.isCheck = true;
    else if (arg === '--force') options.isForce = true;
    else if (arg === '--dry-run') options.isDryRun = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg.startsWith('--stage=')) options.stage = arg.slice(8);
    else if (arg === '--stage' && i + 1 < args.length) options.stage = args[++i];
  }
  return options;
}

function printUsage() {
  console.log(`
Usage: node scripts/build-gemini-departure-radio.mjs [options]

Options:
  --check        Check if manifest.json and audio files are in sync with DEPARTURE_RADIO (exits 0 or 1)
  --dry-run      Analyze which stages need synthesis without calling the API or writing files
  --force        Force re-generation of all stages even if unchanged
  --stage <name> Target only a specific stage (e.g. --stage taxi)
  -h, --help     Show this help message

Environment Variables:
  GEMINI_API_KEY (or GOOGLE_API_KEY, GEMINI_FREE_KEY): API key for Gemini TTS
  GEMINI_TTS_MODEL: Default is 'gemini-3.1-flash-tts-preview'
`);
}

function findGeminiApiKey() {
  let key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_FREE_KEY;
  if (key) return key.trim();

  const candidatePaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
    path.join(os.homedir(), '.env'),
  ];

  for (const envPath of candidatePaths) {
    try {
      const content = fsSync.readFileSync(envPath, 'utf8');
      const match = content.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY|GEMINI_FREE_KEY)\s*=\s*["']?([^"'\r\n]+)["']?/);
      if (match && match[1]) return match[1].trim();
    } catch {}
  }
  return null;
}

function formatPhonetic(text) {
  return text
    .replaceAll('1102', 'one one zero two')
    .replaceAll('2503', 'two five zero three')
    .replaceAll('123', 'one two three')
    .replaceAll('33L', 'three three left')
    .replaceAll('34R', 'three four right')
    .replaceAll('N2', 'November two')
    .replaceAll('SEL1N', 'Sierra Echo Lima one November');
}

async function checkAudioSync() {
  let existingManifest = null;
  try {
    existingManifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  } catch (err) {
    return { inSync: false, reasons: [`manifest.json not found or invalid: ${err.message}`] };
  }

  const reasons = [];
  const stages = Object.keys(DEPARTURE_RADIO);
  const manifestStages = Object.keys(existingManifest);

  for (const stage of stages) {
    const lines = DEPARTURE_RADIO[stage];
    const manifestEntry = existingManifest[stage];
    if (!manifestEntry) {
      reasons.push(`[MISSING_STAGE] Stage "${stage}" is defined in DEPARTURE_RADIO but missing in manifest.json`);
      continue;
    }
    const expectedLines = lines.map(([speaker, text]) => ({ speaker, voice: voices[speaker], text }));
    if (JSON.stringify(manifestEntry.lines) !== JSON.stringify(expectedLines)) {
      reasons.push(`[MODIFIED_SCRIPT] Stage "${stage}" script lines differ from manifest.json`);
    }
    const wavPath = path.join(output, manifestEntry.file || `${stage}.wav`);
    try {
      const stat = await fs.stat(wavPath);
      if (stat.size < 1000) {
        reasons.push(`[INVALID_FILE] Audio file for "${stage}" (${wavPath}) is too small (${stat.size} bytes)`);
      }
    } catch {
      reasons.push(`[MISSING_FILE] Audio file for "${stage}" (${wavPath}) does not exist`);
    }
  }

  for (const stage of manifestStages) {
    if (!DEPARTURE_RADIO[stage]) {
      reasons.push(`[STALE_STAGE] Stage "${stage}" exists in manifest.json but is not in DEPARTURE_RADIO`);
    }
  }

  return { inSync: reasons.length === 0, reasons };
}

const options = parseArgs();

if (options.help) {
  printUsage();
  process.exit(0);
}

if (options.isCheck) {
  const { inSync, reasons } = await checkAudioSync();
  if (inSync) {
    console.log(`✔ Departure radio audio is up to date (${Object.keys(DEPARTURE_RADIO).length} stages verified).`);
    process.exit(0);
  } else {
    console.error(`✖ Departure radio audio is out of sync with src/config/departureRadio.js:`);
    for (const r of reasons) console.error(`  ${r}`);
    console.error(`\nTo update audio clips, run:\n  npm run audio:departure\n`);
    process.exit(1);
  }
}

let existingManifest = null;
try {
  existingManifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
} catch {}

const stagesToProcess = options.stage
  ? [options.stage]
  : Object.keys(DEPARTURE_RADIO);

if (options.stage && !DEPARTURE_RADIO[options.stage]) {
  throw new Error(`Unknown stage "${options.stage}". Valid stages: ${Object.keys(DEPARTURE_RADIO).join(', ')}`);
}

function stageNeedsSynthesis(stage) {
  if (options.isForce) return true;
  if (!existingManifest || !existingManifest[stage]) return true;
  const entry = existingManifest[stage];
  const expectedLines = DEPARTURE_RADIO[stage].map(([speaker, text]) => ({ speaker, voice: voices[speaker], text }));
  if (JSON.stringify(entry.lines) !== JSON.stringify(expectedLines)) return true;
  const wavPath = path.join(output, entry.file || `${stage}.wav`);
  try {
    const stat = fsSync.statSync(wavPath);
    if (stat.size < 1000) return true;
  } catch {
    return true;
  }
  return false;
}

const synthesisPlan = stagesToProcess.map(stage => ({
  stage,
  needsSynthesis: stageNeedsSynthesis(stage),
}));

const needWork = synthesisPlan.filter(p => p.needsSynthesis);

if (options.isDryRun) {
  console.log(`--- Departure Audio Synthesis Dry Run ---`);
  for (const { stage, needsSynthesis } of synthesisPlan) {
    if (needsSynthesis) {
      console.log(`  [SYNTHESIZE] ${stage} -> needs Gemini TTS generation`);
    } else {
      console.log(`  [REUSE]      ${stage} -> existing audio file and manifest up to date`);
    }
  }
  console.log(`\nSummary: ${needWork.length} to synthesize, ${synthesisPlan.length - needWork.length} reused.`);
  process.exit(0);
}

if (needWork.length === 0 && !options.stage) {
  console.log(`✔ All ${stagesToProcess.length} departure radio stages are already up to date. (Use --force to regenerate)`);
  process.exit(0);
}

let key = null;
if (needWork.length > 0) {
  key = findGeminiApiKey();
  if (!key) {
    throw new Error('Gemini API key is required to synthesize audio.\nSet GEMINI_API_KEY (or GOOGLE_API_KEY, GEMINI_FREE_KEY) in ~/.env or the environment.');
  }
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
}

await fs.mkdir(cache, { recursive: true });
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flight3d-gemini-'));
const manifest = existingManifest ? { ...existingManifest } : {};
let lastRequest = 0;

try {
  for (const { stage, needsSynthesis } of synthesisPlan) {
    const lines = DEPARTURE_RADIO[stage];
    if (!needsSynthesis && existingManifest && existingManifest[stage]) {
      const srcWav = path.join(output, existingManifest[stage].file || `${stage}.wav`);
      await fs.copyFile(srcWav, path.join(temp, `${stage}.wav`));
      manifest[stage] = existingManifest[stage];
      console.log(`[REUSED] ${stage}: up to date (${existingManifest[stage].duration.toFixed(2)}s)`);
      continue;
    }

    console.log(`[SYNTHESIZING] ${stage} with Gemini (${model})...`);
    // Gemini supports at most two named speakers in one request.
    const groups = [];
    for (const line of lines) {
      let group = groups.at(-1);
      if (!group || new Set([...group.map(([speaker]) => speaker), line[0]]).size > 2) {
        group = [];
        groups.push(group);
      }
      group.push(line);
    }

    const clips = [];
    for (const [index, group] of groups.entries()) {
      const speakers = [...new Set(group.map(([speaker]) => speaker))];
      const spoken = group.map(([speaker, text]) => `${speaker}: ${formatPhonetic(text)}`).join('\n');
      const prompt = `Read this scripted English aviation radio exchange exactly, with no introduction or additional dialogue. Calm professional voices, natural conversational intonation, brisk but clearly intelligible. Pilot is an airline pilot, crew is a ground crew member, other roles are air traffic controllers. Brief pauses between turns. No music, radio noise or sound effects.\n${spoken}`;
      const speechConfig = speakers.length === 1
        ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[speakers[0]] } } }
        : { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map(speaker => ({ speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[speaker] } } })) } };
      const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } };
      const hash = createHash('sha256').update(JSON.stringify({ model, body })).digest('hex').slice(0, 20);
      const clean = path.join(cache, `${stage}-${index}-${hash}.wav`);

      try {
        await fs.access(clean);
      } catch {
        const delay = Math.max(0, 22_000 - (Date.now() - lastRequest));
        if (delay) {
          console.log(`  Waiting ${(delay / 1000).toFixed(1)}s for API rate limit...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        lastRequest = Date.now();
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const details = error.error?.details || [];
          const quota = details.flatMap(detail => (detail.violations || []).map(v => ({ metric: v.quotaMetric, id: v.quotaId, value: v.quotaValue })));
          const retryDelay = details.find(detail => detail.retryDelay)?.retryDelay;
          throw new Error(`Gemini HTTP ${response.status} at ${stage}/${index}; stopped. ${JSON.stringify({ quota, retryDelay })}`);
        }

        const data = await response.json();
        const audio = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
        if (!audio?.data) throw new Error(`No audio data received at ${stage}/${index}`);
        const bytes = Buffer.from(audio.data, 'base64');
        const wav = bytes.subarray(0, 4).toString() === 'RIFF';
        if (!wav && !/^audio\/(?:L16|pcm)(?:;|$)/i.test(audio.mimeType)) throw new Error('Unsupported Gemini audio format');
        const raw = path.join(temp, 'input');
        await fs.writeFile(raw, bytes);
        const rate = /rate=(\d+)/i.exec(audio.mimeType)?.[1] || '24000';
        execFileSync('ffmpeg', ['-v', 'error', '-y', ...(!wav ? ['-f', 's16le', '-ar', rate, '-ac', '1'] : []), '-i', raw, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clean]);
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
    console.log(`[GENERATED] ${stage}: ${duration.toFixed(2)}s`);
  }

  // Publish files atomically
  for (const stage of Object.keys(manifest)) {
    const tempFile = path.join(temp, `${stage}.wav`);
    try {
      await fs.access(tempFile);
      await fs.copyFile(tempFile, path.join(output, `${stage}.wav`));
    } catch {}
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✔ Successfully updated departure radio audio manifest and assets.`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
