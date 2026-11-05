import { DEPARTURE_RADIO } from '../config/departureRadio.js';

/** Bundled radio speech. It shares the master gain, but not exterior attenuation. */
export class DepartureRadio {
  constructor({ context, output, muted, baseUrl = '/', audioDir = 'audio/departure', radioConfig = DEPARTURE_RADIO, fetcher = (...args) => fetch(...args) }) {
    this.context = context; this.output = output; this.muted = muted;
    this.baseUrl = baseUrl; this.audioDir = audioDir; this.radioConfig = radioConfig;
    this.fetcher = fetcher;
    this.cache = new Map(); this.pending = new Map();
    this.generation = 0; this.status = 'idle'; this.paused = false;
    this.source = null; this.buffer = null; this.stage = null; this.offset = 0;
    this.lastError = null;
  }

  get busy() { return ['loading', 'playing', 'paused'].includes(this.status); }

  async load(stage) {
    if (!Object.hasOwn(this.radioConfig, stage) || !this.context()) return null;
    if (this.cache.has(stage)) return this.cache.get(stage);
    if (this.pending.has(stage)) return this.pending.get(stage);
    const request = (async () => {
      const response = await this.fetcher(`${this.baseUrl}${this.audioDir}/${stage}.wav`);
      if (!response.ok) throw new Error(`Radio ${stage}: HTTP ${response.status}`);
      const buffer = await this.context().decodeAudioData(await response.arrayBuffer());
      this.cache.set(stage, buffer);
      return buffer;
    })();
    this.pending.set(stage, request);
    try { return await request; }
    finally { this.pending.delete(stage); }
  }

  preload() {
    return Promise.allSettled(Object.keys(this.radioConfig).map(stage => this.load(stage)));
  }

  async play(stage) {
    this.stop();
    if (this.muted() || !this.context() || !this.output()) return false;
    const generation = this.generation;
    this.stage = stage; this.status = 'loading'; this.lastError = null;
    try {
      const buffer = await this.load(stage);
      if (generation !== this.generation) return false;
      if (this.muted()) { this.stop(); return false; }
      if (!buffer) { this.status = 'unavailable'; return false; }
      this.buffer = buffer;
      if (this.paused) this.status = 'paused';
      else this.startSource();
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.status = 'unavailable'; this.lastError = error.message;
      }
      return false; // The captions and flight remain usable if a clip fails.
    }
  }

  startSource() {
    const ctx = this.context();
    if (!this.buffer || this.offset >= this.buffer.duration) { this.stop(); return; }
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output());
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect(); this.source = null;
      this.buffer = null; this.offset = 0; this.status = 'idle';
    };
    this.source = source; this.startedAt = ctx.currentTime;
    this.status = 'playing';
    source.start(0, this.offset);
  }

  releaseSource() {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop(); this.source.disconnect(); this.source = null;
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused && this.source) {
      this.offset += Math.max(0, this.context().currentTime - this.startedAt);
      this.releaseSource(); this.status = 'paused';
    } else if (!paused && this.status === 'paused') this.startSource();
  }

  stop() {
    this.generation++;
    this.releaseSource(); this.buffer = null; this.stage = null;
    this.offset = 0; this.status = 'idle';
  }
}
