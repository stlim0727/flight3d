import { createEnvelope, validateEnvelope, validateCommand, validatePlainData, PILOT_LIMITS } from './PilotProtocol.js';

let nextSession = 0;
const failure = (code, message = code) => Object.assign(new Error(message), { code });

/** Trusted local-code host. A Worker isolates scheduling and DOM, not hostile code. */
export class PilotHost {
  constructor({ workerFactory, startupTimeoutMs = 1000, tickTimeoutMs = 250, onLog = () => {} } = {}) {
    this.workerFactory = workerFactory ?? (() => new Worker(new URL('./pilot.worker.js', import.meta.url), { type: 'module' }));
    this.startupTimeoutMs = startupTimeoutMs;
    this.tickTimeoutMs = tickTimeoutMs;
    this.onLog = onLog;
    this.state = 'idle';
    this.worker = null;
    this.pending = null;
    this.generation = 0;
    this.sequence = 0;
    this.sessionId = null;
    this.logCount = 0;
  }

  async start(source, briefing) {
    this.stop();
    if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).byteLength > PILOT_LIMITS.sourceBytes) {
      this.state = 'faulted';
      throw failure('invalid-source');
    }
    const valid = validatePlainData(briefing);
    if (!valid.ok || briefing === null || typeof briefing !== 'object' || Array.isArray(briefing)) {
      this.state = 'faulted';
      throw failure('invalid-briefing');
    }
    this.state = 'starting';
    this.sessionId = `pilot-${++nextSession}`;
    this.sequence = 0;
    this.logCount = 0;
    const generation = this.generation;
    try {
      this.worker = this.workerFactory();
      this.worker.onmessage = ({ data }) => {
        if (generation === this.generation) this.receive(data);
      };
      this.worker.onerror = () => {
        if (generation === this.generation) this.fault(failure('pilot-runtime-error'));
      };
      this.worker.onmessageerror = () => {
        if (generation === this.generation) this.fault(failure('pilot-message-error'));
      };
      await this.request('init', { source, briefing }, { sampleTick: 0, sequence: 0 }, 'ready', this.startupTimeoutMs);
      // A stopped/replaced startup must never revive a previous session.
      if (generation !== this.generation) throw failure('pilot-stopped');
      this.state = 'ready';
    } catch (error) {
      if (generation === this.generation) this.fault(error);
      throw error;
    }
  }

  async tick(payload, { sampleTick, sequence = this.sequence + 1 } = {}) {
    if (this.pending) throw failure('pilot-busy');
    if (this.state !== 'ready' && this.state !== 'running') throw failure('pilot-not-ready');
    if (!Number.isSafeInteger(sampleTick) || sampleTick < 0 || sequence !== this.sequence + 1) throw failure('invalid-tick-meta');
    const valid = validatePlainData(payload);
    if (!valid.ok || payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw failure('invalid-observation');
    this.sequence = sequence;
    this.state = 'running';
    return this.request('observation', payload, { sampleTick, sequence }, 'command', this.tickTimeoutMs);
  }

  request(type, payload, meta, responseType, timeoutMs) {
    return new Promise((resolve, reject) => {
      const message = createEnvelope(type, { sessionId: this.sessionId, ...meta }, payload);
      const valid = validateEnvelope(message, { type });
      if (!valid.ok) { reject(failure('invalid-pilot-message', valid.error)); return; }
      const timer = setTimeout(() => this.fault(failure('pilot-timeout')), timeoutMs);
      this.pending = { resolve, reject, timer, responseType, ...meta };
      try {
        this.worker.postMessage(message);
      } catch {
        this.fault(failure('pilot-message-error'));
      }
    });
  }

  receive(message) {
    const valid = validateEnvelope(message);
    if (!valid.ok) {
      this.fault(failure('invalid-pilot-message', valid.error));
      return;
    }
    const { type, meta, payload } = message;
    const pending = this.pending;
    // Late replies (including the previous request's duplicate) cannot affect current control.
    if (!pending || meta.sessionId !== this.sessionId || meta.sequence !== pending.sequence || meta.sampleTick !== pending.sampleTick) return;
    if (type === 'log') {
      if (++this.logCount <= 100 && typeof payload.message === 'string') {
        try { this.onLog(payload.message.slice(0, 1024)); } catch { /* Diagnostics cannot break flight. */ }
      }
      return;
    }
    if (type === 'error') {
      this.fault(failure(payload.code === 'invalid-command' ? 'invalid-command' : 'pilot-runtime-error',
        typeof payload.message === 'string' ? payload.message.slice(0, 512) : 'pilot-runtime-error'));
      return;
    }
    if (type !== pending.responseType) {
      this.fault(failure('invalid-pilot-message'));
      return;
    }
    let result = payload;
    if (type === 'command') {
      const command = validateCommand(payload);
      if (!command.ok) {
        this.fault(failure('invalid-command'));
        return;
      }
      result = command.command;
    }
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(result);
  }

  fault(error) {
    this.dispose(error);
    this.state = 'faulted';
  }

  stop(reason = 'pilot-stopped') {
    this.dispose(failure(reason));
    this.state = 'stopped';
  }

  dispose(error) {
    this.generation++;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.sessionId = null;
  }
}
