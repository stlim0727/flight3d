export const FLOW = {
  LOBBY: 'lobby',
  FLIGHT: 'flight',
  PAUSED: 'paused',
};

/**
 * Pure game-flow state machine (no DOM/THREE). LOBBY shows the cinematic
 * background with the menu up; FLIGHT is normal play; PAUSED freezes physics
 * but keeps rendering. While in LOBBY the host must keep the demo scenario
 * running: after the demo stops on its own, the countdown in update() arms a
 * one-shot restart via consumeDemoRestart().
 *
 * When the menu is opened from a live flight (returnToLobby(true)) it instead
 * holds that flight: resumableFlight freezes physics in LOBBY and update() skips
 * the cinematic loop, so the aircraft stays put until enterFlight() resumes it.
 */
export class GameFlowController {
  constructor({
    restartDelay = 1.5,
    loopCapWindowSec = 10,
    loopCapCount = 3,
    isDemoActive = () => false,
    isDemoWaiting = () => false,
    onStateChange = () => {},
  } = {}) {
    this.restartDelay = restartDelay;
    this.loopCapWindowSec = loopCapWindowSec;
    this.loopCapCount = loopCapCount;
    this.isDemoActive = isDemoActive;
    this.isDemoWaiting = isDemoWaiting;
    this.onStateChange = onStateChange;

    this.cinematicAvailable = true;
    this.state = FLOW.LOBBY;
    this.resumableFlight = false;  // LOBBY is holding a live flight, not the cinematic
    this._countdown = null;        // seconds until restart fires; null = not armed
    this._restartPending = false;
    this._demoWasActive = false;
    this._lastRestartAt = null;
    this._fastEnds = 0;            // consecutive demo runs that ended too fast
    this._elapsed = 0;
    this._armRestart();
  }

  blocksFlightInput() {
    return this.state !== FLOW.FLIGHT;
  }

  isPhysicsFrozen() {
    return this.state === FLOW.PAUSED || (this.state === FLOW.LOBBY && (this.resumableFlight || !this.cinematicAvailable));
  }

  setCinematicAvailable(available) {
    this.cinematicAvailable = available;
    this._disarmRestart();
    if (available && this.state === FLOW.LOBBY && !this.resumableFlight) this._armRestart();
  }

  enterLobby() {
    // Publish the hold before the state change: onStateChange reads both together to decide
    // whether the menu is framing a live sortie or the cinematic.
    this.resumableFlight = false;
    this._setState(FLOW.LOBBY);
    this._resetLoopCap();
    this._armRestart();
  }

  /** Used by start/resume actions and browser harnesses; pure state change. */
  enterFlight() {
    this.resumableFlight = false;
    this._setState(FLOW.FLIGHT);
    this._disarmRestart();
  }

  pause() {
    if (this.state !== FLOW.FLIGHT) return false;
    this._setState(FLOW.PAUSED);
    return true;
  }

  resume() {
    if (this.state !== FLOW.PAUSED) return false;
    this._setState(FLOW.FLIGHT);
    return true;
  }

  /**
   * Move to the main menu. With `resumable` (entered from FLIGHT/PAUSED) the live
   * flight is held frozen behind the menu instead of re-running the cinematic, so
   * the host can drop straight back into it. Default keeps the cinematic loop.
   * Allowed from FLIGHT (HUD button) as well as PAUSED (pause menu).
   */
  returnToLobby(resumable = false) {
    if (this.state === FLOW.LOBBY) return false;
    this.resumableFlight = resumable;
    this._setState(FLOW.LOBBY);
    this._resetLoopCap();
    if (resumable) {
      this._disarmRestart();
    } else {
      this._armRestart();
    }
    return true;
  }

  /** True while the menu is holding a live flight the Resume action can release. */
  canResumeFromLobby() {
    return this.state === FLOW.LOBBY && this.resumableFlight;
  }

  /** Drop a held flight and let the cinematic backdrop take over again. */
  abandonResumableFlight() {
    if (!this.canResumeFromLobby()) return false;
    this.resumableFlight = false;
    this._resetLoopCap();
    this._armRestart();
    return true;
  }

  /**
   * Park whatever the menu is showing while the host rebuilds the scene for a pending
   * start: physics freezes and the cinematic stays disarmed, so a scenery swap cannot
   * drop the aircraft it is replacing before the new scenario spawns it.
   */
  holdForPendingStart() {
    if (this.state !== FLOW.LOBBY) return false;
    this.resumableFlight = true;
    this._disarmRestart();
    return true;
  }

  update(dt) {
    this._elapsed += dt;
    if (this.state !== FLOW.LOBBY || this.resumableFlight || !this.cinematicAvailable) return;

    if (this.isDemoActive() || this.isDemoWaiting()) {
      this._demoWasActive = true;
      this._disarmRestart();
      return;
    }
    if (this._demoWasActive) {
      // Demo run just ended: measure it against the loop cap, then re-arm.
      this._demoWasActive = false;
      const fast = this._lastRestartAt !== null
        && this._elapsed - this._lastRestartAt < this.loopCapWindowSec;
      this._fastEnds = fast ? this._fastEnds + 1 : 0;
      this._armRestart();
    }
    if (this._countdown === null || this.isLoopCapTripped()) return;

    this._countdown -= dt;
    if (this._countdown <= 0) {
      this._countdown = null;
      this._restartPending = true;
    }
  }

  /** One-shot: true once the LOBBY restart countdown has elapsed. */
  consumeDemoRestart() {
    if (!this._restartPending || this.state !== FLOW.LOBBY) return false;
    this._restartPending = false;
    this._lastRestartAt = this._elapsed;
    return true;
  }

  /** True when the demo keeps crashing right after restarts; host shows a hint. */
  isLoopCapTripped() {
    return this._fastEnds >= this.loopCapCount;
  }

  _resetLoopCap() {
    this._fastEnds = 0;
    this._lastRestartAt = null;
  }

  _armRestart() {
    this._demoWasActive = this.isDemoActive() || this.isDemoWaiting();
    this._countdown = this._demoWasActive ? null : this.restartDelay;
    this._restartPending = false;
  }

  _disarmRestart() {
    this._countdown = null;
    this._restartPending = false;
  }

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(next);
  }
}
