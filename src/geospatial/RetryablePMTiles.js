import { PMTiles, SharedPromiseCache } from 'pmtiles';

/** PMTiles shares header/directory promises, including rejected ones. Give a
 * later request a fresh directory lookup after a transport failure. */
export class RetryablePMTiles extends PMTiles {
  async getZxy(zoom, x, y, signal) {
    const cache = this.cache;
    try {
      return await super.getZxy(zoom, x, y, signal);
    } catch (error) {
      if (this.cache === cache && error !== signal?.reason && error?.name !== 'AbortError') {
        this.cache = new SharedPromiseCache();
      }
      throw error;
    }
  }
}
