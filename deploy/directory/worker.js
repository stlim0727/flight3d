import { MemoryRoomDirectoryStore, handleDirectoryRequest } from '../../src/multiplayer/roomDirectory.js';

class D1RoomDirectoryStore {
  constructor(db, { ttlMs = 45000, maxRooms = 500 } = {}) {
    this.db = db;
    this.ttlMs = ttlMs;
    this.maxRooms = maxRooms;
  }

  async pruneExpired(now = Date.now()) {
    try {
      await this.db.prepare('DELETE FROM rooms WHERE expires_at <= ?').bind(now).run();
    } catch {
      // Best-effort cleanup
    }
  }

  async registerRoom(data, now = Date.now()) {
    const { validateRoomRegistration, hashToken, publicRoomSummary } = await import('../../src/multiplayer/roomDirectory.js');
    const valid = validateRoomRegistration(data);
    await this.pruneExpired(now);

    // Check count
    const countRow = await this.db.prepare('SELECT COUNT(*) as count FROM rooms WHERE expires_at > ?').bind(now).first();
    if (countRow && countRow.count >= this.maxRooms) {
      throw new Error('capacity-exceeded');
    }

    // Check existing registration for this room code
    const existing = await this.db.prepare('SELECT lease_generation FROM rooms WHERE room_code = ?').bind(valid.roomCode).first();
    const leaseGeneration = existing ? (existing.lease_generation || 1) + 1 : 1;

    // Delete existing room code registration to ensure uniqueness
    await this.db.prepare('DELETE FROM rooms WHERE room_code = ?').bind(valid.roomCode).run();

    const id = `room_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const token = `tok_${crypto.randomUUID().replace(/-/g, '')}`;
    const tokenHash = await hashToken(token);
    const expiresAt = now + this.ttlMs;

    await this.db.prepare(`
      INSERT INTO rooms (
        id, room_code, token_hash, lease_generation, name, airport, aircraft, scenario,
        current_players, max_players, status, protocol_major, flight_revision,
        created_at, last_heartbeat_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, valid.roomCode, tokenHash, leaseGeneration, valid.name, valid.airport, valid.aircraft, valid.scenario,
      valid.currentPlayers, valid.maxPlayers, valid.status, valid.protocolMajor, valid.flightRevision,
      now, now, expiresAt
    ).run();

    const record = {
      id,
      roomCode: valid.roomCode,
      name: valid.name,
      airport: valid.airport,
      aircraft: valid.aircraft,
      scenario: valid.scenario,
      currentPlayers: valid.currentPlayers,
      maxPlayers: valid.maxPlayers,
      status: valid.status,
      protocolMajor: valid.protocolMajor,
      flightRevision: valid.flightRevision,
      createdAt: now,
      lastHeartbeatAt: now,
      expiresAt,
    };

    return {
      id,
      token,
      leaseGeneration,
      expiresAt,
      room: publicRoomSummary(record),
    };
  }

  async heartbeat(id, token, updates = {}, now = Date.now()) {
    const { hashToken, publicRoomSummary } = await import('../../src/multiplayer/roomDirectory.js');
    const row = await this.db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (!row || row.expires_at <= now) {
      return { status: 404, error: 'room-not-found' };
    }

    const tokenHash = await hashToken(token);
    if (tokenHash !== row.token_hash) {
      return { status: 403, error: 'invalid-token' };
    }

    if (updates.leaseGeneration !== undefined && updates.leaseGeneration !== row.lease_generation) {
      return { status: 409, error: 'stale-lease-generation' };
    }

    let currentPlayers = row.current_players;
    let maxPlayers = row.max_players;
    let status = row.status;

    if (Number.isSafeInteger(updates.currentPlayers) && updates.currentPlayers >= 1 && updates.currentPlayers <= 4) {
      currentPlayers = updates.currentPlayers;
    }
    if (Number.isSafeInteger(updates.maxPlayers) && updates.maxPlayers >= currentPlayers && updates.maxPlayers <= 4) {
      maxPlayers = updates.maxPlayers;
    }
    if (typeof updates.status === 'string' && ['waiting', 'full', 'flying'].includes(updates.status)) {
      status = updates.status;
    }

    const expiresAt = now + this.ttlMs;

    await this.db.prepare(`
      UPDATE rooms
      SET current_players = ?, max_players = ?, status = ?, last_heartbeat_at = ?, expires_at = ?
      WHERE id = ?
    `).bind(currentPlayers, maxPlayers, status, now, expiresAt, id).run();

    return {
      status: 200,
      body: {
        ok: true,
        expiresAt,
        room: publicRoomSummary({
          id: row.id,
          roomCode: row.room_code,
          name: row.name,
          airport: row.airport,
          aircraft: row.aircraft,
          scenario: row.scenario,
          currentPlayers,
          maxPlayers,
          status,
          protocolMajor: row.protocol_major,
          flightRevision: row.flight_revision,
          createdAt: row.created_at,
          lastHeartbeatAt: now,
          expiresAt,
        }),
      },
    };
  }

  async deleteRoom(id, token, { leaseGeneration } = {}, now = Date.now()) {
    const { hashToken } = await import('../../src/multiplayer/roomDirectory.js');
    const row = await this.db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (!row) {
      return { status: 404, error: 'room-not-found' };
    }

    const tokenHash = await hashToken(token);
    if (tokenHash !== row.token_hash) {
      return { status: 403, error: 'invalid-token' };
    }

    if (leaseGeneration !== undefined && leaseGeneration !== row.lease_generation) {
      return { status: 409, error: 'stale-lease-generation' };
    }

    await this.db.prepare('DELETE FROM rooms WHERE id = ?').bind(id).run();
    return { status: 200, body: { ok: true } };
  }

  async listRooms({ protocolMajor, flightRevision, status, limit = 50, now = Date.now() } = {}) {
    let sql = 'SELECT * FROM rooms WHERE expires_at > ?';
    const params = [now];

    if (protocolMajor !== undefined) {
      sql += ' AND protocol_major = ?';
      params.push(protocolMajor);
    }
    if (flightRevision !== undefined) {
      sql += ' AND flight_revision = ?';
      params.push(flightRevision);
    }
    if (status !== undefined) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY last_heartbeat_at DESC LIMIT ?';
    params.push(limit);

    const { results } = await this.db.prepare(sql).bind(...params).all();
    const { publicRoomSummary } = await import('../../src/multiplayer/roomDirectory.js');

    return (results || []).map(row => publicRoomSummary({
      id: row.id,
      roomCode: row.room_code,
      name: row.name,
      airport: row.airport,
      aircraft: row.aircraft,
      scenario: row.scenario,
      currentPlayers: row.current_players,
      maxPlayers: row.max_players,
      status: row.status,
      protocolMajor: row.protocol_major,
      flightRevision: row.flight_revision,
      createdAt: row.created_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      expiresAt: row.expires_at,
    }));
  }
}

let memoryStore;

export default {
  async fetch(request, env) {
    const store = env?.DB ? new D1RoomDirectoryStore(env.DB) : (memoryStore ??= new MemoryRoomDirectoryStore());
    return handleDirectoryRequest(request, store);
  },
};
