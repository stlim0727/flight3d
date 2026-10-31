/** Versioned plain-data boundary for trusted local pilot Workers. Not a sandbox. */
export const PILOT_PROTOCOL_VERSION = '1.0.0';
export const PILOT_LIMITS = Object.freeze({ sourceBytes: 256 * 1024, observationBytes: 64 * 1024, commandBytes: 4096, depth: 8 });
export const COMMAND_AXES = Object.freeze({ elevator: [-1, 1], aileron: [-1, 1], rudder: [-1, 1], throttle: [0, 1], brakes: [0, 1] });

const failure = (error) => ({ ok: false, error });
const plain = (value) => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Reject getters, cycles, unsupported prototypes and non-JSON values before reading fields. */
export function validatePlainData(value, { maxBytes = PILOT_LIMITS.observationBytes, maxDepth = PILOT_LIMITS.depth } = {}) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > maxBytes || depth > maxDepth) throw new Error('payload-too-complex');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || (!Array.isArray(item) && !plain(item))) throw new Error('invalid-plain-data');
    if (ancestors.has(item)) throw new Error('cyclic-payload');
    ancestors.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== 'string') throw new Error('invalid-plain-data');
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid-plain-data');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  try {
    visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) return failure('payload-too-large');
    return { ok: true };
  } catch (error) {
    return failure(error.message);
  }
}

export function validateCommand(payload) {
  const data = validatePlainData(payload, { maxBytes: PILOT_LIMITS.commandBytes });
  if (!data.ok) return data;
  if (!plain(payload)) return failure('invalid-command');
  const command = {};
  for (const [axis, [min, max]] of Object.entries(COMMAND_AXES)) {
    if (!Object.hasOwn(payload, axis) || typeof payload[axis] !== 'number' ||
        !Number.isFinite(payload[axis]) || payload[axis] < min || payload[axis] > max) return failure('invalid-command');
    command[axis] = payload[axis];
  }
  return { ok: true, command };
}

const TYPES = new Set(['init', 'ready', 'reset', 'reset-complete', 'observation', 'command', 'error', 'stop', 'log']);
export function validateEnvelope(message, expected = {}) {
  const data = validatePlainData(message, {
    maxBytes: expected.type === 'command' || expected.type === 'log' ? PILOT_LIMITS.commandBytes
      : expected.type === 'init' || expected.type === undefined ? PILOT_LIMITS.sourceBytes + PILOT_LIMITS.observationBytes
      : PILOT_LIMITS.observationBytes,
  });
  if (!data.ok) return data;
  if (!plain(message) || !TYPES.has(message.type) || !plain(message.meta) || !plain(message.payload)) return failure('invalid-envelope');
  const limit = message.type === 'init' ? PILOT_LIMITS.sourceBytes + PILOT_LIMITS.observationBytes
    : message.type === 'command' || message.type === 'log' ? PILOT_LIMITS.commandBytes : PILOT_LIMITS.observationBytes;
  const typedData = validatePlainData(message, { maxBytes: limit });
  if (!typedData.ok) return typedData;
  const meta = message.meta;
  if (typeof meta.protocolVersion !== 'string' || !/^1\.\d+\.\d+$/.test(meta.protocolVersion)) return failure('unsupported-protocol');
  if (typeof meta.sessionId !== 'string' || meta.sessionId.length === 0 || meta.sessionId.length > 128 ||
      !Number.isSafeInteger(meta.sequence) || meta.sequence < 0 ||
      !Number.isSafeInteger(meta.sampleTick) || meta.sampleTick < 0) return failure('invalid-envelope');
  for (const key of ['type', 'sessionId', 'sequence']) {
    if (expected[key] !== undefined && (key === 'type' ? message.type : meta[key]) !== expected[key]) return failure(`unexpected-${key}`);
  }
  return { ok: true, message };
}

export function createEnvelope(type, meta, payload) {
  return { type, meta: { protocolVersion: PILOT_PROTOCOL_VERSION, ...meta }, payload };
}

/** Public configuration only: no seed, spawn state, simulator or evaluation telemetry. */
export function createBriefing(manifest) {
  const fields = ['missionId', 'aircraftId', 'runway', 'successConditions', 'timeoutSeconds', 'configuration', 'recommendedSpeeds', 'sensorProfile'];
  const briefing = { decisionPeriodSeconds: 0.2, capabilities: { visualContacts: false, trainingNavigation: true } };
  for (const field of fields) {
    if (Object.hasOwn(manifest, field)) {
      const result = validatePlainData(manifest[field]);
      if (!result.ok) throw new TypeError(`Invalid briefing ${field}: ${result.error}`);
      briefing[field] = JSON.parse(JSON.stringify(manifest[field]));
    }
  }
  // Runway metadata is explicitly selected even if the internal manifest also stores geometry.
  if (briefing.runway) briefing.runway = Object.fromEntries(
    ['id', 'headingDeg', 'lengthM', 'widthM', 'elevationM'].filter(key => Object.hasOwn(briefing.runway, key)).map(key => [key, briefing.runway[key]]),
  );
  return briefing;
}
