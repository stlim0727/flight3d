import { PROTOCOL_VERSION, FLIGHT_REVISION } from './compatibility.js';
import { HEARTBEAT_INTERVAL_MS, LocalRoomDirectoryStore } from './roomDirectory.js';

export class RoomDirectoryClient {
  constructor({ directoryUrl, fetchFn = globalThis.fetch, localStore = null } = {}) {
    this.directoryUrl = typeof directoryUrl === 'string' ? directoryUrl.replace(/\/+$/, '') : null;
    this.fetchFn = fetchFn;
    this.localStore = localStore;
    if (this.directoryUrl === null && !this.localStore && typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
      try {
        this.localStore = new LocalRoomDirectoryStore();
      } catch {}
    }
    this.registeredId = null;
    this.token = null;
    this.leaseGeneration = null;
    this.expiresAt = null;
    this.heartbeatTimer = null;
  }

  get isRegistered() {
    return Boolean(this.registeredId && this.token);
  }

  _resolveUrl(path) {
    const base = this.directoryUrl || (typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost');
    const prefix = this.directoryUrl || '';
    return new URL(`${prefix}${path}`, base);
  }

  async fetchRooms({
    protocolMajor = PROTOCOL_VERSION,
    flightRevision = FLIGHT_REVISION,
    status,
    timeoutMs = 5000,
  } = {}) {
    if (this.directoryUrl !== null) {
      const url = this._resolveUrl('/v1/rooms');
      if (protocolMajor !== undefined) url.searchParams.set('protocol', String(protocolMajor));
      if (flightRevision !== undefined) url.searchParams.set('flight', String(flightRevision));
      if (status !== undefined) url.searchParams.set('status', status);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.fetchFn(url.href, { signal: controller.signal });
        if (!res.ok) {
          return { ok: false, status: res.status, error: `http-${res.status}`, rooms: [] };
        }
        const data = await res.json();
        return { ok: true, rooms: Array.isArray(data?.rooms) ? data.rooms : [] };
      } catch (err) {
        return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error'), rooms: [] };
      } finally {
        clearTimeout(timer);
      }
    }

    if (this.localStore) {
      try {
        const rooms = await this.localStore.listRooms({ protocolMajor, flightRevision, status });
        return { ok: true, rooms: Array.isArray(rooms) ? rooms : [], isLocal: true };
      } catch (err) {
        return { ok: false, error: err.message || 'local-store-error', rooms: [] };
      }
    }

    return { ok: false, error: 'no-directory-url', rooms: [] };
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
    if (this.directoryUrl !== null) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = this._resolveUrl('/v1/rooms');
        const res = await this.fetchFn(url.href, {
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

        let data = {};
        try {
          data = await res.json();
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) throw err;
          if (res.status === 201) return { ok: false, status: res.status, error: 'invalid-json' };
        }
        if (res.status !== 201 || !data?.id || !data?.token) {
          return { ok: false, status: res.status, error: data?.error || `http-${res.status}` };
        }

        this.registeredId = data.id;
        this.token = data.token;
        this.leaseGeneration = data.leaseGeneration;
        this.expiresAt = data.expiresAt;

        return { ok: true, registration: data };
      } catch (err) {
        return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error') };
      } finally {
        clearTimeout(timer);
      }
    }

    if (this.localStore) {
      try {
        const data = await this.localStore.registerRoom({
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
        });
        this.registeredId = data.id;
        this.token = data.token;
        this.leaseGeneration = data.leaseGeneration;
        this.expiresAt = data.expiresAt;
        return { ok: true, registration: data, isLocal: true };
      } catch (err) {
        return { ok: false, error: err.message || 'local-store-error' };
      }
    }

    return { ok: false, error: 'no-directory-url' };
  }

  async heartbeat(updates = {}, { timeoutMs = 5000 } = {}) {
    if (!this.isRegistered) return { ok: false, error: 'not-registered' };

    if (this.directoryUrl !== null) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = this._resolveUrl(`/v1/rooms/${encodeURIComponent(this.registeredId)}/heartbeat`);
        const res = await this.fetchFn(url.href, {
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

        let data = {};
        try {
          data = await res.json();
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) throw err;
        }
        if (!res.ok) {
          if ([401, 403, 404, 409].includes(res.status)) {
            this.stopHeartbeat();
            this.registeredId = null;
            this.token = null;
          }
          return { ok: false, status: res.status, error: data?.error || `http-${res.status}` };
        }

        if (data.expiresAt) this.expiresAt = data.expiresAt;
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network-error') };
      } finally {
        clearTimeout(timer);
      }
    }

    if (this.localStore) {
      try {
        const res = await this.localStore.heartbeat(this.registeredId, this.token, { leaseGeneration: this.leaseGeneration, ...updates });
        if (res.status === 200) {
          if (res.body?.expiresAt) this.expiresAt = res.body.expiresAt;
          return { ok: true, data: res.body, isLocal: true };
        } else {
          this.stopHeartbeat();
          this.registeredId = null;
          this.token = null;
          return { ok: false, status: res.status, error: res.error };
        }
      } catch (err) {
        return { ok: false, error: err.message || 'local-store-error' };
      }
    }

    return { ok: false, error: 'no-directory-url' };
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
    if (!this.isRegistered) {
      this.registeredId = null;
      this.token = null;
      this.leaseGeneration = null;
      return { ok: true };
    }

    const id = this.registeredId;
    const token = this.token;
    const leaseGeneration = this.leaseGeneration;

    this.registeredId = null;
    this.token = null;
    this.leaseGeneration = null;

    return this.unregisterLease({ id, token, leaseGeneration }, { timeoutMs });
  }

  async unregisterLease({ id, token, leaseGeneration } = {}, { timeoutMs = 3000 } = {}) {
    if (!id || !token) return { ok: true };
    if (this.registeredId === id) {
      this.stopHeartbeat();
      this.registeredId = null;
      this.token = null;
      this.leaseGeneration = null;
    }

    if (this.directoryUrl !== null) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = this._resolveUrl(`/v1/rooms/${encodeURIComponent(id)}`);
        await this.fetchFn(url.href, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ token, leaseGeneration }),
          signal: controller.signal,
        });
        return { ok: true };
      } catch {
        // Best-effort unregister
        return { ok: false };
      } finally {
        clearTimeout(timer);
      }
    }

    if (this.localStore) {
      try {
        await this.localStore.deleteRoom(id, token, { leaseGeneration });
        return { ok: true, isLocal: true };
      } catch {
        return { ok: false };
      }
    }

    return { ok: true };
  }
}
