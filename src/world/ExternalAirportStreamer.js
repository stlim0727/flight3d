import { isExternalDestination } from '../config/externalDestinations.js';
import { loadAirportManifest, findAirportByCode } from '../geospatial/airportIndex.js';
import { projectToLocal } from '../geospatial/incheon.js';

/**
 * Asset readiness for one externally indexed destination. It mounts a single
 * streamed airport region into the existing world/scene; flight physics never
 * branches on its state.
 */

async function defaultLoadAirport(code, { baseUrl, fetchImpl } = {}) {
  const manifest = await loadAirportManifest({ baseUrl, fetchImpl });
  const airport = await findAirportByCode(manifest, code, { baseUrl, fetchImpl });
  if (!airport) throw new Error(`Airport ${code} not found in index`);
  return airport;
}

async function defaultBuildRegion({ airport, baseOffset, outsideHeight }) {
  const { createExternalAirportRegion } = await import('../geospatial/externalAirportSurface.js');
  return createExternalAirportRegion({ airport, baseOffset, outsideHeight });
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function validOffset(offset) {
  return Array.isArray(offset) && offset.length === 2 && offset.every(Number.isFinite);
}

export class ExternalAirportStreamer {
  constructor({
    world,
    scene,
    fetchImpl = globalThis.fetch,
    baseUrl,
    loadAirport,
    buildRegion,
    outsideHeight = 0,
    onStatus,
    loadRadiusM = 60000,
    unloadRadiusM = 120000,
    retryDelayMs = 20000,
    now = () => Date.now(),
  } = {}) {
    this.world = world;
    this.scene = scene;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this._loadAirport = loadAirport ?? defaultLoadAirport;
    this._buildRegion = buildRegion ?? defaultBuildRegion;
    this.outsideHeight = outsideHeight;
    this._onStatus = typeof onStatus === 'function' ? onStatus : null;
    this.loadRadiusM = loadRadiusM;
    this.unloadRadiusM = unloadRadiusM;
    this.retryDelayMs = retryDelayMs;
    this._now = now;

    this._state = 'idle';
    this._code = null;
    this._error = null;
    this._distanceM = null;
    this._loaded = null;
    this._lastOffset = null;
    this._failedAt = 0;
    this._token = 0;
    this._loadingPromise = null;
    this._needsRearm = false;
    this._disposed = false;
  }

  get status() {
    return {
      state: this._state,
      code: this._code,
      error: this._error,
      loaded: Boolean(this._loaded),
      distanceM: this._distanceM,
    };
  }

  statusFor(code) {
    if (this._disposed || !isExternalDestination(code)) return null;
    return this._code === code.trim().toUpperCase() ? this.status : null;
  }

  setDestination(code) {
    if (this._disposed) return;
    const next = isExternalDestination(code) ? code.trim().toUpperCase() : null;
    if (next === this._code) return;
    this._token += 1;
    this._unmount();
    this._loadingPromise = null;
    this._code = next;
    this._state = 'idle';
    this._error = null;
    this._distanceM = null;
    this._failedAt = 0;
    this._needsRearm = false;
    this._lastOffset = null;
    this._report();
  }

  /**
   * Explicit load for spawn/UI paths. Ready and in-flight loads are reused;
   * an explicit call after a failure retries immediately (automatic retries
   * from update() remain rate-limited).
   */
  ensure(code) {
    if (this._disposed) return false;
    if (!isExternalDestination(code)) {
      this.setDestination(code);
      return false;
    }
    const normalized = code.trim().toUpperCase();
    if (this._code !== normalized) this.setDestination(normalized);
    if (this._state === 'ready' && this._loaded) return true;
    if (this._state === 'loading' && this._loadingPromise) return this._loadingPromise;
    return this._startLoad(normalized);
  }

  update({ x, z, speedMps = 0, onGround = false, onRunway = false, destinationCode, now } = {}) {
    if (this._disposed) return;
    try {
      if (destinationCode !== undefined) this.setDestination(destinationCode);
      const code = this._code;
      if (!code) {
        this._distanceM = null;
        return;
      }
      this._distanceM = this._distance(x, z, code);
      if (this._state === 'ready') {
        if (!onGround && !onRunway && this._distanceM > this.unloadRadiusM) this._unload();
        return;
      }
      if (this._state === 'loading') return;
      if (this._state === 'failed' && this._currentTime(now) - this._failedAt < this.retryDelayMs) return;
      if (this._needsRearm && this._distanceM > this.unloadRadiusM) return;
      const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
      if (this._distanceM > this.loadRadiusM + speed * 500) return;
      this._needsRearm = false;
      this._startLoad(code);
    } catch (error) {
      this._fail(error);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._token += 1;
    this._unmount();
    this._loadingPromise = null;
    this._code = null;
    this._state = 'idle';
    this._error = null;
    this._distanceM = null;
    this._failedAt = 0;
    this._needsRearm = false;
    this._lastOffset = null;
    this._report();
  }

  _currentTime(now) {
    const value = Number.isFinite(now) ? now : this._now();
    return Number.isFinite(value) ? value : Date.now();
  }

  _distance(x, z, code) {
    let offset = this.world?.offsets?.get?.(code);
    if (!validOffset(offset)) offset = this._lastOffset;
    if (!validOffset(offset)) return 0;
    this._lastOffset = [offset[0], offset[1]];
    const px = Number.isFinite(x) ? x : 0;
    const pz = Number.isFinite(z) ? z : 0;
    return Math.hypot(px - offset[0], pz - offset[1]);
  }

  _unmount() {
    const loaded = this._loaded;
    if (!loaded) return;
    const worldOffset = this.world?.offsets?.get?.(this._code);
    this._lastOffset = validOffset(worldOffset) ? [worldOffset[0], worldOffset[1]] : loaded.offset;
    this._loaded = null;
    if (loaded.group) {
      try { this.scene?.remove?.(loaded.group); } catch { /* cleanup must continue */ }
    }
    this._disposeRegion(loaded.region);
    try { this.world?.unregister?.(this._code); } catch { /* cleanup must continue */ }
  }

  _disposeRegion(region) {
    try { region?.dispose?.(); } catch { /* cleanup must continue */ }
  }

  _unload() {
    this._token += 1;
    this._unmount();
    this._loadingPromise = null;
    this._state = 'idle';
    this._error = null;
    this._failedAt = 0;
    this._needsRearm = true;
    this._report();
  }

  _fail(error) {
    if (this._disposed) return;
    this._state = 'failed';
    this._error = errorMessage(error);
    this._failedAt = this._currentTime();
    this._report();
  }

  _startLoad(code) {
    this._token += 1;
    const token = this._token;
    this._state = 'loading';
    this._error = null;
    this._failedAt = 0;
    this._report();
    const promise = this._runLoad(token, code);
    this._loadingPromise = promise;
    return promise;
  }

  async _runLoad(token, code) {
    let region = null;
    try {
      const descriptor = await this._loadAirport(code, { baseUrl: this.baseUrl, fetchImpl: this.fetchImpl });
      if (this._stale(token, code)) return false;
      if (!Number.isFinite(descriptor?.latitude) || !Number.isFinite(descriptor?.longitude)) {
        throw new Error(`Invalid airport record for ${code}`);
      }
      // baseOffset is already in the world frame (Incheon scenery origin);
      // registerDynamic() publishes the anchor-relative offset itself.
      const baseOffset = projectToLocal(descriptor.latitude, descriptor.longitude);
      if (this._stale(token, code)) return false;
      region = await this._buildRegion({
        airport: descriptor, baseOffset, outsideHeight: this.outsideHeight, code,
      });
      if (this._stale(token, code)) {
        this._disposeRegion(region);
        return false;
      }
      if (!region || typeof region !== 'object') throw new Error(`No region built for ${code}`);
      const group = region.group ?? null;
      if (group) this.scene?.add?.(group);
      try {
        this.world.registerDynamic(code, region);
      } catch (error) {
        if (group) {
          try { this.scene?.remove?.(group); } catch { /* continue cleanup */ }
        }
        this._disposeRegion(region);
        region = null;
        throw error;
      }
      const published = this.world?.offsets?.get?.(code);
      const offset = validOffset(published)
        ? [published[0], published[1]]
        : [baseOffset[0], baseOffset[1]];
      this._loaded = { region, descriptor, baseOffset, offset, group };
      this._lastOffset = offset;
      this._state = 'ready';
      this._error = null;
      this._report();
      return true;
    } catch (error) {
      if (region) this._disposeRegion(region);
      if (this._stale(token, code)) return false;
      this._state = 'failed';
      this._error = errorMessage(error);
      this._failedAt = this._currentTime();
      this._report();
      return false;
    } finally {
      if (!this._stale(token, code)) this._loadingPromise = null;
    }
  }

  _stale(token, code) {
    return this._disposed || token !== this._token || this._code !== code;
  }

  _report() {
    if (!this._onStatus) return;
    try { this._onStatus(this.status); } catch { /* reporting must not break the machine */ }
  }
}

export default ExternalAirportStreamer;
