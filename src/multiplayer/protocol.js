import { Quaternion, Vector3 } from 'three';

export const VERSION = 2;
export const AIRPORTS = ['coastal', 'incheon', 'neon'];
export const AIRCRAFT = ['C172', 'B738', 'F16'];
export const SCENARIOS = ['runway', 'cruise'];
export const DEFAULT_CONFIG = Object.freeze({ airport: 'coastal', aircraft: 'C172', scenario: 'cruise' });
export const validConfig = c => c && AIRPORTS.includes(c.airport) && AIRCRAFT.includes(c.aircraft) && SCENARIOS.includes(c.scenario);
export const cleanName = name => String(name ?? '').replace(/[\p{C}<>]/gu, '').trim().slice(0, 12) || 'Pilot';
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
  return `flight3d-v2-${room}`;
}
export function inviteUrl(room, base) {
  if (!validRoom(room)) throw new Error('invalid-room');
  const url = new URL(base);
  url.search = new URLSearchParams({ r: room }).toString();
  url.hash = '';
  return url.href;
}
const finiteArray = (a, count, limit) => Array.isArray(a) && a.length === count && a.every(n => Number.isFinite(n) && Math.abs(n) <= limit);
const integer = n => Number.isSafeInteger(n) && n >= 0;
export function validSnapshot(s) {
  return s && integer(s.seq) && integer(s.epoch) && integer(s.round)
    && finiteArray(s.p, 3, 1e7) && finiteArray(s.q, 4, 1)
    && Math.abs(s.q.reduce((sum, n) => sum + n * n, 0) - 1) < .02
    && finiteArray(s.v, 3, 2000) && typeof s.crashed === 'boolean'
    && typeof s.held === 'boolean' && typeof s.talking === 'boolean'
    && Number.isFinite(s.gear) && s.gear >= 0 && s.gear <= 1
    && Number.isFinite(s.flaps) && s.flaps >= 0 && s.flaps <= 90;
}

/** Arrival-clock interpolation avoids trusting a remote wall clock. Never blend respawns. */
export class RemoteTrack {
  constructor() { this.clear(); }
  clear() { this.samples = []; this.seq = -1; this.epoch = -1; }
  push(s, now) {
    if (!validSnapshot(s) || s.seq <= this.seq || s.epoch < this.epoch) return false;
    if (s.epoch !== this.epoch || (this.samples.length && new Vector3(...s.p).distanceTo(new Vector3(...this.samples.at(-1).p)) > 1000)) this.samples = [];
    this.seq = s.seq; this.epoch = s.epoch;
    this.samples.push({ ...s, at: now });
    this.samples = this.samples.slice(-8);
    return true;
  }
  sample(now) {
    const last = this.samples.at(-1);
    if (!last || now - last.at > 3000) return null;
    const target = now - 120;
    const a = [...this.samples].reverse().find(s => s.at <= target) ?? this.samples[0];
    const b = this.samples.find(s => s.at >= target) ?? last;
    const alpha = a === b ? 0 : Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at)));
    const p = new Vector3(...a.p).lerp(new Vector3(...b.p), alpha);
    const q = new Quaternion(...a.q).slerp(new Quaternion(...b.q), alpha);
    return { ...last, p: p.toArray(), q: q.toArray(), stale: now - last.at > 500 };
  }
}

export function slotOffset(scenario, slot, quaternion) {
  if (!slot) return new Vector3();
  // Aircraft forward is local -Z; +X is right. Runway spacing exceeds B738 length.
  return new Vector3(scenario === 'runway' ? 0 : 60, 0, scenario === 'runway' ? 80 : 20)
    .applyQuaternion(quaternion);
}
