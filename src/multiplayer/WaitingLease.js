export const WAITING_TIMEOUT_MS = 60000;

/** Only an explicit creator button press renews this deadline. Expiry is irreversible.
 * The lease covers only the wait for a friend; PeerRoom stops checking it once one is admitted. */
export class WaitingLease {
  constructor({ now = () => performance.now(), duration = WAITING_TIMEOUT_MS } = {}) {
    this.now = now; this.duration = duration; this.deadline = now() + duration;
  }
  get remaining() { return Math.max(0, this.deadline - this.now()); }
  get expired() { return this.now() >= this.deadline; }
  renew() {
    if (this.expired) return false;
    this.deadline = this.now() + this.duration;
    return true;
  }
}
