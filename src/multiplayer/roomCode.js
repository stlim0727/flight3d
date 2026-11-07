import { PROTOCOL_VERSION, FLIGHT_REVISION, compatibilityFailure } from './compatibility.js';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const validRoom = room => typeof room === 'string' && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(room);
export function newRoom() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map(n => ROOM_ALPHABET[n & 31]).join('');
}
export function parseRoom(value) {
  if (typeof value !== 'string') return null;
  let code = value.trim();
  if (/^https?:/i.test(code)) {
    try { const url = new URL(code); code = url.searchParams.get('r') ?? url.searchParams.get('room') ?? ''; }
    catch { return null; }
  }
  code = code.replace(/[\s-]/g, '').toUpperCase();
  return validRoom(code) ? code : null;
}
export function roomPeerId(room) {
  if (!validRoom(room)) throw new Error('invalid-room');
  return `flight3d-v${PROTOCOL_VERSION}-${room}`;
}
export function inviteUrl(room, base) {
  if (!validRoom(room)) throw new Error('invalid-room');
  const url = new URL(base);
  url.search = new URLSearchParams({ r: room, mp: String(PROTOCOL_VERSION), fr: String(FLIGHT_REVISION) }).toString();
  url.hash = '';
  return url.href;
}

/** URL hints diagnose incompatible routing before opening a microphone/connection.
 * Plain codes have no version information; their handshake remains authoritative. */
export function inviteCompatibilityFailure(value) {
  if (typeof value !== 'string' || !/^https?:/i.test(value.trim())) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return 'malformed-invite'; }
  const protocol = url.searchParams.get('mp') ?? '2';
  const flight = url.searchParams.get('fr') ?? '1';
  if (!/^[1-9]\d*$/.test(protocol) || !/^[1-9]\d*$/.test(flight)) return 'malformed-invite';
  return compatibilityFailure({ version: Number(protocol), contract: { flight: Number(flight) } });
}
