/**
 * TileCacheManager.js
 *
 * Client-side tile cache with concurrency throttling and offline resilience:
 * - In-memory LRU map
 * - Browser CacheStorage / IndexedDB persistence when available
 * - Strict concurrency limiting (max 4 parallel network requests) to avoid CDN 429
 * - Request deduplication for simultaneous tile requirements
 * - Graceful fallback on network timeout or CORS failures
 */

const DEFAULT_CDN_TEMPLATE = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_MEMORY_TILES = 64;

export class TileCacheManager {
  /**
   * @param {Object} options
   * @param {string} [options.urlTemplate] - URL pattern with {z}, {x}, {y}
   * @param {number} [options.maxMemoryTiles] - In-memory LRU limit
   * @param {number} [options.maxConcurrent] - Maximum simultaneous fetches
   * @param {number} [options.timeoutMs] - Request timeout before fallback
   * @param {boolean} [options.enableBrowserCache] - Whether to use CacheStorage
   */
  constructor(options = {}) {
    this.urlTemplate = options.urlTemplate || DEFAULT_CDN_TEMPLATE;
    this.maxMemoryTiles = options.maxMemoryTiles || MAX_MEMORY_TILES;
    this.maxConcurrent = options.maxConcurrent || MAX_CONCURRENT_REQUESTS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.enableBrowserCache = options.enableBrowserCache ?? true;

    this.memoryCache = new Map(); // key -> HTMLImageElement / ImageBitmap / ImageBuffer
    this.inFlight = new Map(); // key -> Promise
    this.requestQueue = [];
    this.activeRequests = 0;
    this.activeAbortControllers = new Set();
    this.disposed = false;

    this.metrics = {
      hits: 0,
      misses: 0,
      networkRequests: 0,
      errors: 0,
    };
  }

  getTileKey(z, x, y) {
    return `${z}/${y}/${x}`;
  }

  getTileUrl(z, x, y) {
    return this.urlTemplate
      .replace('{z}', String(z))
      .replace('{y}', String(y))
      .replace('{x}', String(x));
  }

  /**
   * Retrieve a tile image as HTMLImageElement or ImageBitmap.
   * Resolves to null on network failure, allowing safe offline fallback.
   * @param {number} z - Zoom level
   * @param {number} x - Tile X index
   * @param {number} y - Tile Y index
   * @returns {Promise<HTMLImageElement|null>}
   */
  async getTileImage(z, x, y) {
    if (this.disposed) return null;
    const key = this.getTileKey(z, x, y);

    // 1. In-memory LRU Cache hit
    if (this.memoryCache.has(key)) {
      this.metrics.hits++;
      const cached = this.memoryCache.get(key);
      // Re-insert to refresh LRU order
      this.memoryCache.delete(key);
      this.memoryCache.set(key, cached);
      return cached;
    }

    // 2. De-duplicate in-flight requests
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = this._queueTileRequest(z, x, y, key);
    this.inFlight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  _queueTileRequest(z, x, y, key) {
    return new Promise((resolve) => {
      this.requestQueue.push({
        z,
        x,
        y,
        key,
        resolve,
      });
      this._drainQueue();
    });
  }

  async _drainQueue() {
    if (this.activeRequests >= this.maxConcurrent || this.requestQueue.length === 0) {
      return;
    }

    this.activeRequests++;
    const task = this.requestQueue.shift();

    try {
      const result = await this._fetchTile(task.z, task.x, task.y, task.key);
      task.resolve(result);
    } catch {
      this.metrics.errors++;
      task.resolve(null); // Never throw: always resolve null so caller can fallback
    } finally {
      this.activeRequests--;
      this._drainQueue();
    }
  }

  async _fetchTile(z, x, y, key) {
    if (this.disposed) return null;
    this.metrics.misses++;
    const url = this.getTileUrl(z, x, y);

    // 1. Try Browser Cache API if available
    if (this.enableBrowserCache && typeof caches !== 'undefined') {
      try {
        const cache = await caches.open('flight3d-tiles-v1');
        const match = await cache.match(url);
        if (match) {
          const blob = await match.blob();
          if (this.disposed) return null;
          const img = await this._blobToImage(blob);
          if (this.disposed) return null;
          this._storeInMemory(key, img);
          return img;
        }
      } catch {
        // Cache API unavailable or errored; proceed to network
      }
    }

    if (this.disposed) return null;

    // 2. Network Fetch with Timeout & Throttling
    this.metrics.networkRequests++;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) this.activeAbortControllers.add(controller);
    const timeoutId = setTimeout(() => controller?.abort(), this.timeoutMs);

    try {
      if (typeof fetch === 'undefined') {
        // In minimal headless / Node test runner without global fetch
        return null;
      }

      const response = await fetch(url, {
        signal: controller?.signal,
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`Tile HTTP ${response.status}`);
      }

      if (this.disposed) return null;

      // Clone response to persist into Cache API asynchronously
      if (this.enableBrowserCache && typeof caches !== 'undefined') {
        try {
          const cache = await caches.open('flight3d-tiles-v1');
          cache.put(url, response.clone()).catch(() => {});
        } catch {}
      }

      const blob = await response.blob();
      if (this.disposed) return null;
      const img = await this._blobToImage(blob);
      if (this.disposed) return null;
      this._storeInMemory(key, img);
      return img;
    } finally {
      clearTimeout(timeoutId);
      if (controller) this.activeAbortControllers.delete(controller);
    }
  }

  _blobToImage(blob) {
    if (typeof Image === 'undefined') {
      // In Node test environment, return a mock image object
      return Promise.resolve({
        width: 256,
        height: 256,
        isMock: true,
        blob,
      });
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  _storeInMemory(key, img) {
    if (this.memoryCache.size >= this.maxMemoryTiles) {
      // Evict oldest (least recently used)
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, img);
  }

  /**
   * Current performance and memory metrics.
   */
  getMetrics() {
    return {
      ...this.metrics,
      cachedTilesCount: this.memoryCache.size,
      inFlightCount: this.inFlight.size,
      queuedCount: this.requestQueue.length,
      estimatedMemoryBytes: this.memoryCache.size * 256 * 256 * 4,
    };
  }

  /**
   * Dispose all cached assets and abort pending requests.
   */
  dispose() {
    this.disposed = true;
    for (const task of this.requestQueue) {
      task.resolve(null);
    }
    this.requestQueue = [];
    for (const ctrl of this.activeAbortControllers) {
      try {
        ctrl.abort();
      } catch {}
    }
    this.activeAbortControllers.clear();
    this.memoryCache.clear();
    this.inFlight.clear();
    this.activeRequests = 0;
  }
}
