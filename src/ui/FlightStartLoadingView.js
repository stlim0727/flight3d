/** Browser presentation for a scene swap; the coordinator owns its lifetime. */
export class FlightStartLoadingView {
  constructor({ stage, setBusy, latency, document = globalThis.document }) {
    Object.assign(this, { paintStage: stage, setBusy, latency, document });
  }

  open() {
    this.latency?.noteSelectionStart();
    this.overlay = this.document.getElementById('startup-overlay');
    const progress = this.document.getElementById('startup-progress');
    this.overlay.classList.remove('scene-ready');
    this.overlay.hidden = false;
    progress.hidden = false;
    progress.max = 3;
    progress.value = 0;
    this.setBusy(true);
  }

  stage(value, key) {
    // Hidden tabs cannot paint the two-frame loading stages.
    if (this.document.hidden) return Promise.resolve();
    return this.paintStage(value, key);
  }

  ready() { return this.stage(3, 'startup.ready'); }

  close() {
    if (this.overlay) this.overlay.hidden = true;
    this.setBusy(false);
    this.latency?.noteSelectionApplied();
  }
}
