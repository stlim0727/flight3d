import { RECORD_BYTES, REMOTE_RECORD_BYTES, HEADER_BYTES, REPLAY_INTERVAL_SEC, frameBytes } from './replayConfig.js';

export const REPLAY_TRACK_VERSION = 2;
// Multiplayer room tracks only: solo flights stay v2 so older builds can still import them.
export const ROOM_TRACK_VERSION = 3;
export const REPLAY_MAGIC = 'F3DR1';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const BOOL_FIELDS = Object.freeze(['onGround', 'isTransit', 'touchdown', 'isStalled', 'isPreStall',
  'isStallWarning', 'reverserActive', 'apEngaged']);
const GEAR_DAMAGE_STATES = Object.freeze(['normal', 'damaged', 'collapsed']);

// [name, offset, type, scale]. Scale is the encode-time multiplier, so it is the largest value
// divided by the wanted resolution: iasKnots 10 means 0.1 kt per count, egt 0.25 means 4 °C.
const SCALARS = Object.freeze([
  ['x', 0, 'f32', 1], ['y', 4, 'f32', 1], ['z', 8, 'f32', 1], ['timeSec', 12, 'f32', 1],
  ['elevator', 26, 'i8', 127], ['aileron', 27, 'i8', 127], ['rudder', 28, 'i8', 127],
  ['pitchTrim', 29, 'i8', 10], ['flapDegree', 30, 'u8', 1], ['flapIndex', 31, 'u8', 1],
  ['spoilers', 32, 'u8', 255], ['gearState', 33, 'u8', 255], ['throttle', 34, 'u8', 255],
  ['iasKnots', 38, 'u16', 10], ['tasKnots', 40, 'u16', 10], ['groundSpeedKnots', 42, 'u16', 10],
  ['vsiFpm', 44, 'i16', 1], ['radioAltFt', 46, 'i16', 2], ['mach', 48, 'u16', 1000],
  ['gForce', 50, 'i16', 100], ['pitchDeg', 52, 'i16', 100], ['rollDeg', 54, 'i16', 100],
  ['headingDeg', 56, 'u16', 100],
]);
const ENGINE_FIELDS = Object.freeze([['n1', 2], ['n2', 2], ['egt', 0.25], ['ff', 0.1]]);
const SELECTED_FIELDS = Object.freeze([['selectedHeading', 67, 'u16', 100],
  ['selectedAltitude', 69, 'u16', 0.125], ['selectedSpeed', 71, 'u16', 10]]);
const COMPRESSION_LEGS = Object.freeze(['nose', 'mainLeft', 'mainRight']);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

const ACCESSORS = Object.freeze({
  f32: ['setFloat32', 'getFloat32'], i8: ['setInt8', 'getInt8'], u8: ['setUint8', 'getUint8'],
  i16: ['setInt16', 'getInt16'], u16: ['setUint16', 'getUint16'],
});

function clampQuantized(value, type) {
  if (type === 'i8') return Math.max(-128, Math.min(127, Math.round(value)));
  if (type === 'u8') return Math.max(0, Math.min(255, Math.round(value)));
  if (type === 'i16') return Math.max(-32768, Math.min(32767, Math.round(value)));
  return Math.max(0, Math.min(65535, Math.round(value)));
}

function writeScalar(dv, offset, type, value, scale) {
  if (type === 'f32') { dv[ACCESSORS.f32[0]](offset, finite(value)); return; }
  dv[ACCESSORS[type][0]](offset, clampQuantized(finite(value) * scale, type));
}

function readScalar(dv, offset, type, scale) {
  if (type === 'f32') return dv[ACCESSORS.f32[1]](offset);
  return dv[ACCESSORS[type][1]](offset) / scale;
}

/** Smallest-three: the dominant component is dropped and rebuilt from the unit norm plus a sign bit. */
function writeQuaternion(dv, offset, quat) {
  const raw = [0, 1, 2, 3].map(index => (Number.isFinite(quat?.[index]) ? quat[index] : 0));
  // Physics always supplies a unit quaternion; project anything else so the dropped component
  // rebuilds correctly instead of silently skewing the attitude.
  const norm = Math.hypot(...raw);
  const parts = norm > 1e-6 ? raw.map(value => Math.max(-1, Math.min(1, value / norm))) : [0, 0, 0, 1];
  let drop = 0;
  for (let index = 1; index < 4; index++) if (Math.abs(parts[index]) > Math.abs(parts[drop])) drop = index;
  const kept = parts.filter((_, index) => index !== drop);
  dv.setUint8(offset, (drop & 3) | (parts[drop] < 0 ? 0x10 : 0));
  for (let index = 0; index < 3; index++) {
    dv.setInt16(offset + 1 + index * 2, clampQuantized(kept[index] * 32767, 'i16'));
  }
}

function readQuaternion(dv, offset, out) {
  const byte = dv.getUint8(offset);
  const drop = byte & 3;
  const kept = [0, 1, 2].map(index => dv.getInt16(offset + 1 + index * 2) / 32767);
  const remaining = Math.max(0, 1 - kept.reduce((sum, value) => sum + value * value, 0));
  const parts = [];
  for (let index = 0, cursor = 0; index < 4; index++) {
    parts.push(index === drop ? (byte & 0x10 ? -Math.sqrt(remaining) : Math.sqrt(remaining)) : kept[cursor++]);
  }
  const length = Math.hypot(...parts) || 1;
  out[0] = parts[0] / length; out[1] = parts[1] / length;
  out[2] = parts[2] / length; out[3] = parts[3] / length;
  return out;
}

function writeDamage(dv, offset, damage, ids) {
  let packed = 0;
  ids.forEach((id, index) => {
    if (index > 3) return;
    const state = damage?.[id];
    const code = state === 'collapsed' ? 2 : state === 'damaged' ? 1 : 0;
    packed |= code << (index * 2);
  });
  dv.setUint8(offset, packed);
}

function readDamage(dv, offset, ids) {
  const packed = dv.getUint8(offset);
  const damage = {};
  ids.forEach((id, index) => {
    if (index > 3) return;
    damage[id] = GEAR_DAMAGE_STATES[(packed >> (index * 2)) & 3];
  });
  return damage;
}

function writeSample(dv, base, sample, ids, version) {
  for (const [name, offset, type, scale] of SCALARS) writeScalar(dv, base + offset, type, sample[name], scale);
  writeQuaternion(dv, base + 16, sample.quat);
  let flags = 0;
  BOOL_FIELDS.forEach((name, index) => { if (sample[name]) flags |= 1 << index; });
  dv.setUint8(base + 23, flags);
  writeDamage(dv, base + 24, sample.gearDamage, ids.gear);
  let bodyMask = 0;
  ids.body.forEach((id, index) => {
    if (index > 7) return;
    if (sample.bodyDamage?.[id] >= 0.3) bodyMask |= 1 << index;
  });
  dv.setUint8(base + 25, bodyMask);
  const compressions = sample.compressions || {};
  COMPRESSION_LEGS.forEach((leg, index) => writeScalar(dv, base + 35 + index, 'u8', compressions[leg], 100));
  let flags2 = 0;
  if (sample.engine1?.failed) flags2 |= 1;
  if (sample.engine2?.failed) flags2 |= 2;
  if (sample.parkBrake) flags2 |= 4;
  dv.setUint8(base + 66, flags2);
  for (let engine = 0; engine < 2; engine++) {
    const state = sample[`engine${engine + 1}`] || {};
    ENGINE_FIELDS.forEach(([name, scale], index) => {
      writeScalar(dv, base + 58 + engine * 4 + index, 'u8', state[name], scale);
    });
  }
  for (const [name, offset, type, scale] of SELECTED_FIELDS) {
    writeScalar(dv, base + offset, type, sample[name], scale);
  }
  for (let offset = 73; offset < RECORD_BYTES; offset++) dv.setUint8(base + offset, 0);
  // v2 uses four reserved bytes for full-range fuel flow, retaining 80-byte records.
  for (let engine = 0; engine < 2; engine++) {
    writeScalar(dv, base + 73 + engine * 2, 'u16', sample[`engine${engine + 1}`]?.ff, 0.1);
  }
  // v3 marks respawns and restarts so playback never blends across a teleport.
  if (version >= 3) dv.setUint8(base + 77, segmentByte(sample.segment));
}

function segmentByte(segment) {
  return (Number.isSafeInteger(segment) ? segment : 0) & 255;
}

const REMOTE_FLAGS = Object.freeze(['visible', 'crashed', 'held', 'stale']);

/** A remote aircraft is a visual record only: pose, gear and flaps, never instruments. */
function writeRemote(dv, base, sample) {
  const visible = sample?.visible === true;
  for (let offset = 0; offset < REMOTE_RECORD_BYTES; offset++) dv.setUint8(base + offset, 0);
  if (visible) {
    writeScalar(dv, base, 'f32', sample.x, 1);
    writeScalar(dv, base + 4, 'f32', sample.y, 1);
    writeScalar(dv, base + 8, 'f32', sample.z, 1);
    writeScalar(dv, base + 19, 'u8', sample.gearState, 255);
    writeScalar(dv, base + 20, 'u8', sample.flapDegree, 2);
  }
  writeQuaternion(dv, base + 12, visible ? sample.quat : null);
  let flags = 0;
  REMOTE_FLAGS.forEach((name, index) => { if (sample?.[name] === true) flags |= 1 << index; });
  dv.setUint8(base + 21, visible ? flags : 0);
  dv.setUint8(base + 22, segmentByte(sample?.segment));
}

function readRemote(dv, base, timeSec) {
  const sample = { timeSec, x: dv.getFloat32(base), y: dv.getFloat32(base + 4), z: dv.getFloat32(base + 8),
    quat: readQuaternion(dv, base + 12, [0, 0, 0, 1]),
    gearState: readScalar(dv, base + 19, 'u8', 255), flapDegree: readScalar(dv, base + 20, 'u8', 2) };
  const flags = dv.getUint8(base + 21);
  REMOTE_FLAGS.forEach((name, index) => { sample[name] = Boolean(flags & (1 << index)); });
  sample.segment = dv.getUint8(base + 22);
  return sample;
}

function readSample(dv, base, ids, version) {
  const sample = { quat: [0, 0, 0, 1] };
  for (const [name, offset, type, scale] of SCALARS) sample[name] = readScalar(dv, base + offset, type, scale);
  sample.quat = readQuaternion(dv, base + 16, sample.quat);
  const flags = dv.getUint8(base + 23);
  BOOL_FIELDS.forEach((name, index) => { sample[name] = Boolean(flags & (1 << index)); });
  sample.gearDamage = readDamage(dv, base + 24, ids.gear);
  const bodyMask = dv.getUint8(base + 25);
  const bodyDamage = {};
  ids.body.forEach((id, index) => {
    if (index > 7) return;
    bodyDamage[id] = bodyMask & (1 << index) ? 0.3 : 0;
  });
  sample.bodyDamage = bodyDamage;
  const compressions = {};
  COMPRESSION_LEGS.forEach((leg, index) => {
    compressions[leg] = readScalar(dv, base + 35 + index, 'u8', 100);
  });
  sample.compressions = compressions;
  const flags2 = dv.getUint8(base + 66);
  sample.parkBrake = Boolean(flags2 & 4);
  for (let engine = 0; engine < 2; engine++) {
    const state = {};
    ENGINE_FIELDS.forEach(([name, scale], index) => {
      state[name] = readScalar(dv, base + 58 + engine * 4 + index, 'u8', scale);
    });
    if (version >= 2) state.ff = readScalar(dv, base + 73 + engine * 2, 'u16', 0.1);
    state.failed = Boolean(flags2 & (1 << engine));
    sample[`engine${engine + 1}`] = state;
  }
  for (const [name, offset, type, scale] of SELECTED_FIELDS) {
    sample[name] = readScalar(dv, base + offset, type, scale);
  }
  sample.segment = version >= 3 ? dv.getUint8(base + 77) : 0;
  return sample;
}

function trackDamageIds(track) {
  return {
    gear: Array.isArray(track.gearIds) && track.gearIds.length ? track.gearIds : COMPRESSION_LEGS,
    body: Array.isArray(track.bodyIds) ? track.bodyIds : [],
  };
}

function remoteTracks(track) {
  return Array.isArray(track?.remotes) ? track.remotes : [];
}

/** The remote pilot list lives in metadata, so a decoder knows each frame's width before reading it. */
function encodedMetadata(track) {
  const remotes = remoteTracks(track);
  const metadata = remotes.length
    ? { ...track.metadata, remotes: remotes.map(({ samples, ...pilot }) => pilot) }
    : track?.metadata || {};
  return encoder.encode(JSON.stringify(metadata));
}

export function decodedByteLength(track) {
  const samples = track?.samples || [];
  return HEADER_BYTES + encodedMetadata(track).length + samples.length * frameBytes(remoteTracks(track).length);
}

export function encodeTrack(track) {
  if (!track || !Array.isArray(track.samples)) throw new Error('replay track requires a samples array');
  const remotes = remoteTracks(track);
  if (remotes.some(remote => !Array.isArray(remote?.samples) || remote.samples.length !== track.samples.length)) {
    throw new Error('replay remote tracks must share the local frames');
  }
  const version = remotes.length ? ROOM_TRACK_VERSION : REPLAY_TRACK_VERSION;
  const frame = frameBytes(remotes.length);
  const metadata = encodedMetadata(track);
  if (metadata.length > 0xffff) throw new Error('replay track metadata is too large');
  const bytes = new Uint8Array(HEADER_BYTES + metadata.length + track.samples.length * frame);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < REPLAY_MAGIC.length; index++) bytes[index] = REPLAY_MAGIC.charCodeAt(index);
  view.setUint8(5, version);
  view.setUint16(6, Math.round(finite(track.intervalSec ?? REPLAY_INTERVAL_SEC) * 1000));
  view.setUint32(8, track.samples.length);
  view.setFloat32(12, finite(track.durationSec));
  view.setUint16(16, metadata.length);
  bytes.set(metadata, HEADER_BYTES);
  const ids = trackDamageIds(track);
  const base = HEADER_BYTES + metadata.length;
  for (let index = 0; index < track.samples.length; index++) {
    const frameBase = base + index * frame;
    writeSample(view, frameBase, track.samples[index], ids, version);
    remotes.forEach((remote, slot) => {
      writeRemote(view, frameBase + RECORD_BYTES + slot * REMOTE_RECORD_BYTES, remote.samples[index]);
    });
  }
  return bytes;
}

export function decodeTrack(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('replay track requires bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_BYTES) throw new Error('replay track is truncated');
  const magic = String.fromCharCode(...bytes.subarray(0, 5));
  if (magic !== REPLAY_MAGIC) throw new Error(`not a flight3d replay track (${magic})`);
  const version = view.getUint8(5);
  if (version < 1 || version > ROOM_TRACK_VERSION) throw new Error(`unsupported replay track version ${version}`);
  const count = view.getUint32(8);
  const metadataLength = view.getUint16(16);
  if (bytes.length < HEADER_BYTES + metadataLength) throw new Error('replay track is truncated');
  let metadata = {};
  try {
    metadata = JSON.parse(decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataLength)));
  } catch {
    throw new Error('replay track metadata is corrupt');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('replay track metadata is corrupt');
  }
  const pilots = version >= 3 ? metadata.remotes : [];
  if (!Array.isArray(pilots) || (version >= 3 && !pilots.length)
    || pilots.some(pilot => !pilot || typeof pilot !== 'object' || Array.isArray(pilot))) {
    throw new Error('replay track metadata is corrupt');
  }
  const frame = frameBytes(pilots.length);
  const expected = HEADER_BYTES + metadataLength + count * frame;
  if (bytes.length !== expected) throw new Error(`replay track length ${bytes.length} does not match ${expected}`);
  const intervalSec = view.getUint16(6) / 1000;
  const durationSec = view.getFloat32(12);
  if (!(intervalSec > 0) || !Number.isFinite(durationSec) || durationSec < 0) {
    throw new Error('replay track timing is corrupt');
  }
  const ids = trackDamageIds({ gearIds: metadata.gearIds, bodyIds: metadata.bodyIds });
  const samples = [];
  const remotes = pilots.map(pilot => ({ ...pilot, samples: [] }));
  for (let index = 0; index < count; index++) {
    const frameBase = HEADER_BYTES + metadataLength + index * frame;
    const sample = readSample(view, frameBase, ids, version);
    if (![sample.timeSec, sample.x, sample.y, sample.z, ...sample.quat].every(Number.isFinite)
      || sample.timeSec < 0 || (index > 0 && sample.timeSec <= samples[index - 1].timeSec)) {
      throw new Error('replay track sample is corrupt');
    }
    samples.push(sample);
    remotes.forEach((remote, slot) => {
      const pose = readRemote(view, frameBase + RECORD_BYTES + slot * REMOTE_RECORD_BYTES, sample.timeSec);
      if (![pose.x, pose.y, pose.z].every(Number.isFinite)) throw new Error('replay track sample is corrupt');
      remote.samples.push(pose);
    });
  }
  const decoded = { version, intervalSec, durationSec,
    metadata, samples, gearIds: ids.gear, bodyIds: metadata.bodyIds || [] };
  if (remotes.length) decoded.remotes = remotes;
  return decoded;
}

export function toBase64(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const remaining = bytes.length - index;
    output += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    output += remaining > 1 ? ALPHABET[(chunk >> 6) & 63] : '';
    output += remaining > 2 ? ALPHABET[chunk & 63] : '';
  }
  return output;
}

const LOOKUP = new Int8Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index++) LOOKUP[ALPHABET.charCodeAt(index)] = index;
// Tolerate the standard alphabet so imported files and hand-pasted payloads decode alike.
LOOKUP[43] = 62; LOOKUP[47] = 63;

export function fromBase64(text) {
  if (typeof text !== 'string' || !text.length) throw new Error('replay payload is empty');
  const bytes = new Uint8Array(Math.ceil(text.length * 3 / 4));
  let cursor = 0;
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    let value = code < 128 ? LOOKUP[code] : -1;
    if (value < 0) {
      if (code === 61 || code === 10 || code === 13 || code === 32) continue;
      throw new Error('replay payload is not base64');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[cursor++] = (buffer >> bits) & 255;
    }
  }
  if (cursor === 0) throw new Error('replay payload is empty');
  return bytes.subarray(0, cursor);
}

export { BOOL_FIELDS, COMPRESSION_LEGS };
