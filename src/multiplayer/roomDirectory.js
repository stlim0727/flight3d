import { validRoom } from './roomCode.js';

export const DIRECTORY_API_VERSION = 'v1';
export const HEARTBEAT_INTERVAL_MS = 15000;
export const HEARTBEAT_TTL_MS = 45000;

export async function hashToken(token) {
  if (typeof token !== 'string' || !token) return '';
  const buffer = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function validateRoomRegistration(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid-request-body');
  const roomCode = typeof input.roomCode === 'string' ? input.roomCode.trim().toUpperCase() : '';
  if (!validRoom(roomCode)) throw new Error('invalid-room-code');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 24) throw new Error('invalid-host-name');

  const airport = typeof input.airport === 'string' ? input.airport.trim() : '';
  if (!airport || airport.length > 32) throw new Error('invalid-airport');

  const aircraft = typeof input.aircraft === 'string' ? input.aircraft.trim() : '';
  if (!aircraft || aircraft.length > 16) throw new Error('invalid-aircraft');

  const scenario = typeof input.scenario === 'string' ? input.scenario.trim() : '';
  if (!scenario || scenario.length > 32) throw new Error('invalid-scenario');

  const currentPlayers = Number.isSafeInteger(input.currentPlayers) ? input.currentPlayers : 1;
  if (currentPlayers < 1 || currentPlayers > 4) throw new Error('invalid-current-players');

  const maxPlayers = Number.isSafeInteger(input.maxPlayers) ? input.maxPlayers : 2;
  if (maxPlayers < currentPlayers || maxPlayers > 4) throw new Error('invalid-max-players');

  const status = typeof input.status === 'string' ? input.status.trim() : 'waiting';
  if (!['waiting', 'full', 'flying'].includes(status)) throw new Error('invalid-status');

  const protocolMajor = Number.isSafeInteger(input.protocolMajor) ? input.protocolMajor : null;
  if (!protocolMajor || protocolMajor < 1) throw new Error('invalid-protocol-major');

  const flightRevision = Number.isSafeInteger(input.flightRevision) ? input.flightRevision : null;
  if (!flightRevision || flightRevision < 1) throw new Error('invalid-flight-revision');

  return {
    roomCode,
    name,
    airport,
    aircraft,
    scenario,
    currentPlayers,
    maxPlayers,
    status,
    protocolMajor,
    flightRevision,
  };
}

export function publicRoomSummary(room) {
  return {
    id: room.id,
    roomCode: room.roomCode,
    name: room.name,
    airport: room.airport,
    aircraft: room.aircraft,
    scenario: room.scenario,
    currentPlayers: room.currentPlayers,
    maxPlayers: room.maxPlayers,
    status: room.status,
    protocolMajor: room.protocolMajor,
    flightRevision: room.flightRevision,
    createdAt: room.createdAt,
    lastHeartbeatAt: room.lastHeartbeatAt,
    expiresAt: room.expiresAt,
  };
}

/**
 * In-memory room directory store.
 * Fully compliant with the backend MVP contract and safe for local dev, test suites, or standalone processes.
 */
export class MemoryRoomDirectoryStore {
  constructor({ ttlMs = HEARTBEAT_TTL_MS, maxRooms = 200 } = {}) {
    this.ttlMs = ttlMs;
    this.maxRooms = maxRooms;
    this.rooms = new Map();
    this.roomCodeToId = new Map();
    this.roomLocks = new Map();
  }

  pruneExpired(now = Date.now()) {
    for (const [id, room] of this.rooms.entries()) {
      if (room.expiresAt <= now) {
        this.rooms.delete(id);
        if (this.roomCodeToId.get(room.roomCode) === id) {
          this.roomCodeToId.delete(room.roomCode);
        }
      }
    }
  }

  async registerRoom(data, now = Date.now()) {
    const valid = validateRoomRegistration(data);

    let resolveLock;
    const lockPromise = new Promise(resolve => { resolveLock = resolve; });
    while (this.roomLocks.has(valid.roomCode)) {
      await this.roomLocks.get(valid.roomCode).catch(() => {});
    }
    this.roomLocks.set(valid.roomCode, lockPromise);

    try {
      this.pruneExpired(now);

      // If there's an existing unexpired registration for this room code, supersede it
      const existingId = this.roomCodeToId.get(valid.roomCode);
      let leaseGeneration = 1;
      if (existingId && this.rooms.has(existingId)) {
        const prev = this.rooms.get(existingId);
        leaseGeneration = (prev.leaseGeneration || 1) + 1;
        this.rooms.delete(existingId);
      }

      if (this.rooms.size >= this.maxRooms) {
        throw new Error('capacity-exceeded');
      }

      const id = `room_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 14)}`;
      const token = `tok_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)}`;
      const tokenHash = await hashToken(token);

      // Re-check and atomically clear any concurrent entry before saving
      const concurrentId = this.roomCodeToId.get(valid.roomCode);
      if (concurrentId && this.rooms.has(concurrentId)) {
        const prev = this.rooms.get(concurrentId);
        leaseGeneration = (prev.leaseGeneration || leaseGeneration) + 1;
        this.rooms.delete(concurrentId);
      }

      const roomRecord = {
        id,
        tokenHash,
        leaseGeneration,
        ...valid,
        createdAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + this.ttlMs,
      };

      this.rooms.set(id, roomRecord);
      this.roomCodeToId.set(valid.roomCode, id);

      return {
        id,
        token,
        leaseGeneration,
        expiresAt: roomRecord.expiresAt,
        room: publicRoomSummary(roomRecord),
      };
    } finally {
      if (this.roomLocks.get(valid.roomCode) === lockPromise) {
        this.roomLocks.delete(valid.roomCode);
      }
      resolveLock();
    }
  }

  async heartbeat(id, token, updates = {}, now = Date.now()) {
    this.pruneExpired(now);
    const room = this.rooms.get(id);
    if (!room || room.expiresAt <= now) {
      return { status: 404, error: 'room-not-found' };
    }

    const tokenHash = await hashToken(token);
    if (!safeEqual(tokenHash, room.tokenHash)) {
      return { status: 403, error: 'invalid-token' };
    }

    if (updates.leaseGeneration !== undefined && updates.leaseGeneration !== room.leaseGeneration) {
      return { status: 409, error: 'stale-lease-generation' };
    }

    if (Number.isSafeInteger(updates.currentPlayers) && updates.currentPlayers >= 1 && updates.currentPlayers <= 4) {
      room.currentPlayers = updates.currentPlayers;
    }
    if (Number.isSafeInteger(updates.maxPlayers) && updates.maxPlayers >= room.currentPlayers && updates.maxPlayers <= 4) {
      room.maxPlayers = updates.maxPlayers;
    }
    if (typeof updates.status === 'string' && ['waiting', 'full', 'flying'].includes(updates.status)) {
      room.status = updates.status;
    }

    room.lastHeartbeatAt = now;
    room.expiresAt = now + this.ttlMs;

    return {
      status: 200,
      body: {
        ok: true,
        expiresAt: room.expiresAt,
        room: publicRoomSummary(room),
      },
    };
  }

  async deleteRoom(id, token, { leaseGeneration } = {}, now = Date.now()) {
    this.pruneExpired(now);
    const room = this.rooms.get(id);
    if (!room) {
      return { status: 404, error: 'room-not-found' };
    }

    const tokenHash = await hashToken(token);
    if (!safeEqual(tokenHash, room.tokenHash)) {
      return { status: 403, error: 'invalid-token' };
    }

    if (leaseGeneration !== undefined && leaseGeneration !== room.leaseGeneration) {
      return { status: 409, error: 'stale-lease-generation' };
    }

    this.rooms.delete(id);
    if (this.roomCodeToId.get(room.roomCode) === id) {
      this.roomCodeToId.delete(room.roomCode);
    }

    return { status: 200, body: { ok: true } };
  }

  listRooms({ protocolMajor, flightRevision, status, limit = 50, now = Date.now() } = {}) {
    this.pruneExpired(now);
    const result = [];
    for (const room of this.rooms.values()) {
      if (room.expiresAt <= now) continue;
      if (protocolMajor !== undefined && room.protocolMajor !== protocolMajor) continue;
      if (flightRevision !== undefined && room.flightRevision !== flightRevision) continue;
      if (status !== undefined && room.status !== status) continue;
      result.push(publicRoomSummary(room));
      if (result.length >= limit) break;
    }
    // Return newest or most recently refreshed first
    result.sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);
    return result;
  }
}

/**
 * Universal Web Standard Request / Response handler for `/v1/rooms`.
 * Works seamlessly across Cloudflare Workers, Node fetch servers, or test harnesses.
 */
export async function handleDirectoryRequest(request, store, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const jsonResponse = (data, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...corsHeaders,
      },
    });
  };

  const pathname = url.pathname.replace(/\/+$/, '');

  // Extract auth token from Authorization header (Bearer <token>) or body
  const parseAuthHeader = () => {
    const header = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
  };

  // GET /v1/rooms
  if (method === 'GET' && (pathname === '/v1/rooms' || pathname === '/rooms')) {
    const protocolParam = url.searchParams.get('protocol');
    const flightParam = url.searchParams.get('flight');
    const statusParam = url.searchParams.get('status');
    const limitParam = url.searchParams.get('limit');

    const protocolMajor = protocolParam && /^\d+$/.test(protocolParam) ? Number(protocolParam) : undefined;
    const flightRevision = flightParam && /^\d+$/.test(flightParam) ? Number(flightParam) : undefined;
    const limit = limitParam && /^\d+$/.test(limitParam) ? Math.min(100, Math.max(1, Number(limitParam))) : 50;

    const rooms = await store.listRooms({
      protocolMajor,
      flightRevision,
      status: statusParam || undefined,
      limit,
      now,
    });
    return jsonResponse({ rooms });
  }

  // POST /v1/rooms
  if (method === 'POST' && (pathname === '/v1/rooms' || pathname === '/rooms')) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid-json' }, 400);
    }
    try {
      const result = await store.registerRoom(body, now);
      return jsonResponse(result, 201);
    } catch (err) {
      return jsonResponse({ error: err.message }, 400);
    }
  }

  // POST /v1/rooms/:id/heartbeat
  const heartbeatMatch = /^\/(?:v1\/)?rooms\/([^/]+)\/heartbeat$/.exec(pathname);
  if (method === 'POST' && heartbeatMatch) {
    const id = heartbeatMatch[1];
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional if Bearer token is provided
    }
    const token = parseAuthHeader() || body.token;
    if (!token) {
      return jsonResponse({ error: 'missing-token' }, 401);
    }

    const result = await store.heartbeat(id, token, body, now);
    if (result.status !== 200) {
      return jsonResponse({ error: result.error }, result.status);
    }
    return jsonResponse(result.body, 200);
  }

  // DELETE /v1/rooms/:id
  const deleteMatch = /^\/(?:v1\/)?rooms\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && deleteMatch) {
    const id = deleteMatch[1];
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional if Bearer token is provided
    }
    const token = parseAuthHeader() || body.token;
    if (!token) {
      return jsonResponse({ error: 'missing-token' }, 401);
    }

    const result = await store.deleteRoom(id, token, body, now);
    if (result.status !== 200) {
      return jsonResponse({ error: result.error }, result.status);
    }
    return jsonResponse(result.body, 200);
  }

  return jsonResponse({ error: 'not-found' }, 404);
}
