import { PROTOCOL_VERSION, FLIGHT_REVISION } from './compatibility.js';
import { HEARTBEAT_INTERVAL_MS } from './roomDirectory.js';

export class RoomDirectoryClient {
  constructor({ directoryUrl, fetchFn = globalThis.fetch } = {}) {
    this.directoryUrl = directoryUrl ? directoryUrl.replace(/\/+$/, '') : null;
    this.fetchFn = fetchFn;
    this.registeredId = null;
    this.token = null;
    this.leaseGeneration = null;
    this.expiresAt = null;
    this.heartbeatTimer = null;
  }

  get isRegistered() {
    return Boolean(this.registeredId && this.token);
  }

  async fetchRooms({
    protocolMajor = PROTOCOL_VERSION,
    flightRevision = FLIGHT_REVISION,
    status,
    timeoutMs = 5000,
  } = {}) {
    if (!this.directoryUrl) return { ok: false, error: 'no-directory-url', rooms: [] };

    const url = new URL(`${this.directoryUrl}/v1/rooms`);
    if (protocolMajor !== undefined) url.searchParams.set('protocol', String(protocolMajor));
    if (flightRevision !== undefined) url.searchParams.set('flight', String(flightRevision));
    if (status !== undefined) url.searchParams.set('status', status);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await this.fetchFn(url.href, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        return { ok: false, status: res.status, error: `http-${res.status}`, rooms: [] };
      }
      const data = await res.json();
      return { ok: true, rooms: Array.isArray(data.rooms) ? data.rooms : [] };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error'), rooms: [] };
    }
  }

  async register({
    roomCode,
    name,
    airport,
    aircraft,
    scenario,
    currentPlayers = 1,
    maxPlayers = 2,
    status = 'waiting',
    protocolMajor = PROTOCOL_VERSION,
    flightRevision = FLIGHT_REVISION,
    timeoutMs = 5000,
  }) {
    if (!this.directoryUrl) return { ok: false, error: 'no-directory-url' };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await this.fetchFn(`${this.directoryUrl}/v1/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json().catch(() => ({}));
      if (res.status !== 201) {
        return { ok: false, status: res.status, error: data.error || `http-${res.status}` };
      }

      this.registeredId = data.id;
      this.token = data.token;
      this.leaseGeneration = data.leaseGeneration;
      this.expiresAt = data.expiresAt;

      return { ok: true, registration: data };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error') };
    }
  }

  async heartbeat(updates = {}, { timeoutMs = 5000 } = {}) {
    if (!this.isRegistered || !this.directoryUrl) return { ok: false, error: 'not-registered' };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await this.fetchFn(`${this.directoryUrl}/v1/rooms/${encodeURIComponent(this.registeredId)}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          token: this.token,
          leaseGeneration: this.leaseGeneration,
          ...updates,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ([401, 403, 404, 409].includes(res.status)) {
          this.stopHeartbeat();
          this.registeredId = null;
          this.token = null;
        }
        return { ok: false, status: res.status, error: data.error || `http-${res.status}` };
      }

      if (data.expiresAt) this.expiresAt = data.expiresAt;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error') };
    }
  }

  startHeartbeat({ intervalMs = HEARTBEAT_INTERVAL_MS, getStatus } = {}) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isRegistered) return;
      const updates = typeof getStatus === 'function' ? getStatus() : {};
      await this.heartbeat(updates);
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async unregister({ timeoutMs = 3000 } = {}) {
    this.stopHeartbeat();
    if (!this.isRegistered || !this.directoryUrl) {
      this.registeredId = null;
      this.token = null;
      return { ok: true };
    }

    const id = this.registeredId;
    const token = this.token;
    const leaseGeneration = this.leaseGeneration;

    this.registeredId = null;
    this.token = null;
    this.leaseGeneration = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      await this.fetchFn(`${this.directoryUrl}/v1/rooms/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token, leaseGeneration }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { ok: true };
    } catch {
      // Best-effort unregister
      return { ok: false };
    }
  }
}
