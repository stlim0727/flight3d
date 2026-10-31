import { createEnvelope, validateEnvelope, validateCommand, PILOT_LIMITS } from './PilotProtocol.js';

/** Native user JS is intentionally trusted-only. This wrapper is not a sandbox. */
export function createPilotRuntime({ send, loadModule = loadSourceModule }) {
  let pilot = null;
  let sessionId = null;
  let sequence = 0;
  let generation = 0;
  let logCount = 0;
  let invocationLogs = 0;
  let activeMeta = null;
  let randomState = 1;
  const reply = (type, meta, payload) => send(createEnvelope(type, meta, payload));
  const immutable = (value) => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) immutable(child);
      Object.freeze(value);
    }
    return value;
  };
  const synchronous = (value) => {
    if (value && typeof value.then === 'function') throw new Error('Async pilot hooks are unsupported');
    return value;
  };
  const api = Object.freeze({
    random() {
      // Explicit stable guest RNG, independent of host sensor/environment streams.
      randomState = (randomState + 0x6D2B79F5) >>> 0;
      let z = randomState;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    },
    log(message) {
      if (!activeMeta || logCount >= 100 || invocationLogs >= 4 || typeof message !== 'string') return;
      logCount++;
      invocationLogs++;
      reply('log', activeMeta, { message: message.slice(0, 1024) });
    },
  });

  return async function receive(message) {
    const valid = validateEnvelope(message);
    if (!valid.ok) return;
    const { type, meta, payload } = message;
    const localGeneration = generation;
    try {
      if (type === 'init') {
        if (pilot || sessionId) throw new Error('Pilot already initialized');
        if (typeof payload.source !== 'string' || new TextEncoder().encode(payload.source).byteLength > PILOT_LIMITS.sourceBytes) throw new Error('Invalid pilot source');
        sessionId = meta.sessionId;
        const module = await loadModule(payload.source);
        if (localGeneration !== generation) return;
        if (typeof module.createPilot !== 'function') throw new Error('Module must export createPilot(api)');
        activeMeta = meta;
        invocationLogs = 0;
        pilot = synchronous(module.createPilot(api));
        if (!pilot || typeof pilot.onTick !== 'function' || typeof pilot.reset !== 'function') throw new Error('Pilot must implement reset and onTick');
        synchronous(pilot.reset(immutable(payload.briefing)));
        activeMeta = null;
        sequence = meta.sequence;
        reply('ready', meta, {});
        return;
      }
      if (meta.sessionId !== sessionId) return;
      if (type === 'stop') {
        generation++;
        pilot = null;
        activeMeta = null;
        return;
      }
      if (!pilot || meta.sequence !== sequence + 1) return;
      sequence = meta.sequence;
      invocationLogs = 0;
      activeMeta = meta;
      if (type === 'reset') {
        randomState = 1;
        synchronous(pilot.reset(immutable(payload.briefing)));
        reply('reset-complete', meta, {});
      } else if (type === 'observation') {
        const command = validateCommand(synchronous(pilot.onTick(immutable(payload))));
        if (!command.ok) {
          reply('error', meta, { code: 'invalid-command', message: command.error });
          return;
        }
        reply('command', meta, command.command);
      }
    } catch (error) {
      if (localGeneration === generation) reply('error', meta, {
        code: 'pilot-runtime-error', message: String(error?.message ?? error).slice(0, 512),
      });
    } finally {
      activeMeta = null;
    }
  };
}

async function loadSourceModule(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const receive = createPilotRuntime({ send: (message) => self.postMessage(message) });
  self.onmessage = ({ data }) => { void receive(data); };
}
