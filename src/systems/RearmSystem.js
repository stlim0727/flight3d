/** Ground turnaround: a stopped, undamaged F-16 on pavement gets resupplied. */
export const REARM_SECONDS = 5;
export const REARM_STOP_SPEED_KNOTS = 5;

/**
 * Continuous ground-service state. Progress only exists while the aircraft is
 * stopped on pavement with serviceable gear and hull; every interruption
 * decays the request rather than latching a discrete "rearming" flag.
 */
export class RearmSystem {
  constructor({ seconds = REARM_SECONDS, stopSpeedKnots = REARM_STOP_SPEED_KNOTS } = {}) {
    this.seconds = seconds;
    this.stopSpeedKnots = stopSpeedKnots;
    this.reset();
  }

  reset() {
    this.progress = 0;
    this.state = 'idle';
    this.blockedReason = null;
    this._completed = false;
    this._blockedNotified = false;
    this._startedNotified = false;
    this._events = [];
  }

  stateSnapshot() {
    return {
      state: this.state,
      progress: this.progress,
      blockedReason: this.blockedReason,
      secondsRemaining: Math.max(0, this.seconds * (1 - this.progress)),
    };
  }

  /**
   * @param {number} dt render delta
   * @param {{active:boolean, onGround:boolean, groundSpeedKnots:number, onPavement:boolean,
   *   gearDown:boolean, gearCollapsed:boolean, bodyFailed:boolean,
   *   missilesRemaining:number, missileCapacity:number,
   *   gunRounds:number, gunCapacity:number}} input
   * @returns {Array<object>} rearmStart / rearm / rearmBlocked events
   */
  update(dt, input) {
    const events = this._events;
    events.length = 0;

    if (!input?.active || !input.onGround) {
      this.progress = 0;
      this.state = 'idle';
      this.blockedReason = null;
      this._completed = false;
      this._blockedNotified = false;
      this._startedNotified = false;
      return events;
    }

    if (input.groundSpeedKnots > this.stopSpeedKnots) {
      this.progress = 0;
      this.state = 'moving';
      this.blockedReason = null;
      this._startedNotified = false;
      return events;
    }

    const needsResupply = input.missilesRemaining < input.missileCapacity
      || input.gunRounds < input.gunCapacity;
    if (!needsResupply) {
      this.progress = 0;
      this.state = 'idle';
      this.blockedReason = null;
      this._completed = false;
      this._blockedNotified = false;
      this._startedNotified = false;
      return events;
    }
    if (this._completed) return events;

    let blockedReason = null;
    if (!input.onPavement) blockedReason = 'pavement';
    else if (!input.gearDown || input.gearCollapsed) blockedReason = 'gear';
    else if (input.bodyFailed) blockedReason = 'damage';

    if (blockedReason) {
      this.progress = 0;
      this.state = 'blocked';
      this.blockedReason = blockedReason;
      this._startedNotified = false;
      if (!this._blockedNotified) {
        this._blockedNotified = true;
        events.push({ type: 'rearmBlocked', reason: blockedReason });
      }
      return events;
    }

    this.blockedReason = null;
    this._blockedNotified = false;
    if (!this._startedNotified) {
      this._startedNotified = true;
      events.push({ type: 'rearmStart' });
    }
    this.state = 'rearming';
    this.progress = Math.min(1, this.progress + Math.max(0, dt) / this.seconds);
    if (this.progress >= 1) {
      this.progress = 0;
      this.state = 'complete';
      this._completed = true;
      this._startedNotified = false;
      events.push({ type: 'rearm' });
    }
    return events;
  }
}
