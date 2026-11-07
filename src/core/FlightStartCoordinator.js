/**
 * Serializes scene preparation and scenario installation under one physics hold.
 * Ports supply the simulator and UI effects; this policy has no DOM/Three imports.
 */
export class FlightStartCoordinator {
  constructor({ isLocked, hold, spawn, scene, loading, recover }) {
    Object.assign(this, { isLocked, hold, spawn, scene, loading, recover });
    this.busy = false;
  }

  start(options = {}) {
    return this.#run(() => this.spawn(options));
  }

  rebuild() {
    return this.#run(async () => {
      this.loading.open();
      await this.scene.prepare();
      await this.spawn({});
      await this.loading.ready();
    }, () => this.loading.close());
  }

  async #run(install, cleanup = () => {}) {
    if (this.isLocked() || this.busy) return false;
    this.busy = true;
    const wasHeld = this.hold.get();
    this.hold.set(true);
    try {
      // Invoke immediately: ordinary presets still spawn inside the click task.
      await install();
      return true;
    } catch (error) {
      this.recover(error);
      return false;
    } finally {
      try {
        // Keep physics parked through the final loading-card paint and cleanup.
        cleanup();
      } finally {
        this.hold.set(wasHeld);
        this.busy = false;
      }
    }
  }
}
