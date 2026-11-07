/** Start/retry a runner and report readiness, independently of its lifetime loop. */
export class PilotMissionStartController {
  constructor({ runner, readRequest, beforeStart, createPacer }) {
    Object.assign(this, { runner, readRequest, beforeStart, createPacer });
  }

  async start(overrides = {}) {
    const { source, playback, ...options } = this.readRequest(overrides);
    if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
      throw new Error('시드는 0 이상의 정수여야 합니다.');
    }
    // stop() aborts preparation, but the old adapter must finish before replacement.
    if (this.runner.preparing) throw new Error('A mission is already preparing or stopping');
    if (this.runner.active) this.runner.stop('retry');
    this.beforeStart({ ...options, source, playback });
    this.runner.paceTick = options.pilotKind === 'human' || playback === 'realtime' ? this.createPacer() : null;
    const completion = this.runner.start(source, options);
    // Observe both promises: an early start rejection and a preparation rejection
    // must reach the caller, without waiting for the whole flight to finish.
    const readiness = this.runner.readyPromise;
    if (typeof readiness?.then !== 'function') {
      // Observe lifetime rejection even for a malformed runner implementation.
      void Promise.resolve(completion).catch(() => {});
      throw new Error('Mission readiness signal is missing.');
    }
    const record = await Promise.race([completion, readiness]);
    if (!record || !['running', 'succeeded'].includes(record.status)) {
      throw new Error(record?.detail || record?.reason || 'Mission did not become ready.');
    }
    return record;
  }
}
