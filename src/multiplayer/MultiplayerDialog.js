/** Owns only the pause introduced by this modal; an existing user pause survives. */
export class MultiplayerDialog {
  constructor(sim, dialog, dismiss) {
    this.sim = sim; this.dialog = dialog; this.ownsPause = false;
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  }
  open() {
    if (this.dialog.open) return;
    this.ownsPause = this.sim.gameFlow.state === 'flight';
    if (this.ownsPause) this.sim.gameFlow.pause();
    this.dialog.showModal();
    this.sim.syncFlowUi();
  }
  hold() {
    if (this.dialog.open && this.sim.gameFlow.state === 'flight') {
      this.ownsPause = true; this.sim.gameFlow.pause();
    }
  }
  close({ resume = true } = {}) {
    const owned = this.ownsPause; this.ownsPause = false;
    if (this.dialog.open) this.dialog.close();
    if (resume && owned && this.sim.gameFlow.state === 'paused') this.sim.gameFlow.resume();
    this.sim.syncFlowUi();
  }
}
