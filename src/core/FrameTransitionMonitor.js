/** Bounded state-to-render timing; the caller supplies paint scheduling and telemetry. */
export class FrameTransitionMonitor {
  constructor({ clock, afterPaint, isHidden, emit, longTasks = () => null }) {
    Object.assign(this, { clock, afterPaint, isHidden, emit, longTasks });
    this.pending = null;
    this.previous = null;
    this.restartPending = false;
  }

  /** The next flight transition respawns the aircraft; it is a restart, not a resume. */
  expectRestart() { this.restartPending = true; }

  flowChanged(state, resumable, context = {}) {
    const previous = this.previous;
    this.previous = { state, resumable };
    const restart = this.restartPending;
    this.restartPending = false;
    if (state !== 'flight') { this.cancel(); return; }
    if (restart) { this.cancel(); return; }
    if (previous?.state === 'paused' || (previous?.state === 'lobby' && previous.resumable)) {
      this.begin('resume', { from: previous.state, ...context });
    }
  }

  begin(kind, context = {}) {
    this.cancel();
    if (!this.isHidden()) this.pending = { kind, context, start: this.clock() };
  }

  cancel() { this.pending = null; }

  /** Context passed here describes the rendered frame, so it supersedes the state-change
   * snapshot (a resume restores its flight camera after `flowChanged`). */
  rendered(renderMs, context = {}) {
    const pending = this.pending;
    if (!pending || pending.rendered !== undefined) return;
    if (this.isHidden()) { this.cancel(); return; }
    Object.assign(pending.context, context);
    pending.rendered = this.clock();
    this.afterPaint(() => {
      if (this.pending !== pending) return;
      this.cancel();
      if (this.isHidden()) return;
      const end = this.clock();
      this.emit({
        version: 1, kind: pending.kind, ...pending.context,
        firstFrameMs: Math.max(0, Math.round(pending.rendered - pending.start)),
        renderMs: Math.max(0, Math.round(renderMs)),
        paintOpportunityMs: Math.max(0, Math.round(end - pending.start)),
        longTasks: this.longTasks(pending.start, end),
      });
    });
  }
}
