import { CHART_TILE_LIMIT } from '../geospatial/regionalChart.js';

export const CHART_RETRY_MS = 10000;
const TIMEOUT_MS = 8000;

const tileKey = ({ zoom, x, y }) => `${zoom}/${x}/${y}`;

/** One archive and decoder per cache. Values stay in native tile units or WGS84. */
export class ChartTileLayer {
  constructor(source, decode) {
    this.source = source;
    this.decode = decode;
    this.cache = new Map();
    this.visible = [];
    this.revision = 0;
  }

  select(tiles) {
    const wanted = new Set(tiles.map(tileKey));
    for (const entry of this.visible) {
      if (entry.state === 'loading' && !wanted.has(entry.key)) {
        entry.controller.abort();
        this.cache.delete(entry.key);
      }
    }
    this.visible = tiles.map(tile => {
      const key = tileKey(tile);
      const entry = this.cache.get(key) ?? { ...tile, key, state: 'new' };
      // Keep the least recently displayed tile first for eviction.
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry;
    });
    const limit = Math.max(CHART_TILE_LIMIT, this.visible.length);
    while (this.cache.size > limit) {
      const [evictKey, evicted] = this.cache.entries().next().value;
      if (evicted.state === 'loading') evicted.controller?.abort();
      this.cache.delete(evictKey);
    }
    this.revision++;
  }

  refresh(now) {
    for (const entry of this.visible) {
      if (entry.state === 'new' || (entry.state === 'failed' && now >= entry.retryAt)) {
        this.load(entry);
      }
    }
  }

  prefetch(tiles) {
    this.select(tiles);
    for (const entry of this.visible) {
      if (entry.state === 'new') this.load(entry, true);
    }
  }

  async load(entry, speculative = false) {
    entry.state = 'loading';
    entry.controller = new AbortController();
    const signal = AbortSignal.any([entry.controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    try {
      const result = await this.source.getZxy(entry.zoom, entry.x, entry.y, signal);
      signal.throwIfAborted();
      entry.data = this.decode(result?.data, entry);
      entry.state = 'ready';
      this.revision++;
    } catch {
      if (entry.controller.signal.aborted) return;
      // A failed background attempt must not delay the first user request.
      if (speculative) {
        entry.state = 'new';
        return;
      }
      entry.state = 'failed';
      entry.retryAt = performance.now() + CHART_RETRY_MS;
    } finally {
      entry.controller = null;
    }
  }
}
