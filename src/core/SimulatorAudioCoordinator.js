import { syncCombatAudio } from '../weapons/combatPresentation.js';
import { FLOW } from '../ui/GameFlowController.js';

/**
 * Coordinates audio subsystem lifecycle, user-gesture unlock bindings,
 * mute/pause synchronizations, and per-frame audio telemetry updates.
 */
export class SimulatorAudioCoordinator {
  constructor(audio, sim = null) {
    this.audio = audio;
    this.sim = sim;
    this.listenersAttached = false;
    this.hintContext = null;
    this.audioHint = null;
    this.interactionEvents = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'];
    this._ensureAudioBound = () => this.ensureAudio();
    this._syncAudioHintBound = () => this.syncAudioHint();
  }

  isMultiplayerVoiceBlocked() {
    const mp = this.sim?.multiplayer;
    return Boolean(
      mp?.playbackBlocked ||
      (mp?.active && mp?.audio?.srcObject && mp?.audio?.paused) ||
      (mp?.active && mp?.voice?.context && mp?.voice?.context?.state !== 'running')
    );
  }

  initInteractionListeners(audioHint = typeof document !== 'undefined' ? document.getElementById('audio-start-hint') : null) {
    this.audioHint = audioHint;
    this.attachInteractionListeners();
    this.audioHint?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ensureAudio();
    });
    this.ensureAudio();
  }

  attachInteractionListeners() {
    if (this.listenersAttached || typeof window === 'undefined') return;
    this.interactionEvents.forEach(evt => {
      window.addEventListener(evt, this._ensureAudioBound, { passive: true, capture: true });
    });
    this.listenersAttached = true;
  }

  detachInteractionListeners() {
    if (!this.listenersAttached || typeof window === 'undefined') return;
    this.interactionEvents.forEach(evt => {
      window.removeEventListener(evt, this._ensureAudioBound, { capture: true });
    });
    this.listenersAttached = false;
  }

  syncAudioHint() {
    const state = this.audio?.ctx?.state;
    const isRunning = state === 'running';
    const isVoiceBlocked = this.isMultiplayerVoiceBlocked();
    const audioHint = this.audioHint;
    if (audioHint) {
      if ((isRunning && !isVoiceBlocked) || this.audio?.isMuted) {
        audioHint.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        audioHint.style.opacity = '0';
        audioHint.style.transform = 'translate(-50%, 8px)';
        setTimeout(() => {
          const stillRunning = this.audio?.ctx?.state === 'running';
          const stillBlocked = this.isMultiplayerVoiceBlocked();
          if ((stillRunning && !stillBlocked) || this.audio?.isMuted) {
            audioHint.hidden = true;
          }
        }, 250);
      } else {
        audioHint.hidden = false;
        audioHint.style.opacity = '1';
        audioHint.style.transform = 'translate(-50%, 0)';
      }
    }
    if (isRunning && !isVoiceBlocked) {
      this.detachInteractionListeners();
    } else if (!this.audio?.isMuted && (!isRunning || isVoiceBlocked)) {
      this.attachInteractionListeners();
    }
  }

  ensureAudio() {
    if (this.sim?.browserBackgrounded && typeof document !== 'undefined' && !document.hidden && document.hasFocus?.()) {
      this.sim.setBrowserActive(true);
    }
    if (!this.audio) return;
    if (!this.audio.isInitialized) {
      this.audio.init();
    }
    this.audio.ensureContextRunning();
    this.sim?.multiplayer?.playAudio?.();
    if (this.audio.ctx && this.hintContext !== this.audio.ctx) {
      this.hintContext?.removeEventListener?.('statechange', this._syncAudioHintBound);
      this.hintContext = this.audio.ctx;
      this.hintContext?.addEventListener?.('statechange', this._syncAudioHintBound);
    }
    this.syncAudioHint();
  }

  syncAudioPause({ browserBackgrounded, flowState, isRestartConfirmOpen } = {}) {
    if (this.sim?.gameFlow && this.sim.gameFlow.state !== FLOW.FLIGHT) {
      this.sim.flightPerformance?.flush('flight-held');
      this.sim.flightGpuTimer?.clear();
      this.sim.lastFrameDelta = null;
    }
    const backgrounded = browserBackgrounded ?? (this.sim?.browserBackgrounded === true);
    const state = flowState ?? this.sim?.gameFlow?.state;
    const confirmOpen = isRestartConfirmOpen ?? Boolean(this.sim?.demoDirector?.isRestartConfirmOpen);
    const canResume = this.sim?.gameFlow?.canResumeFromLobby ? this.sim.gameFlow.canResumeFromLobby() : false;
    const held = state === FLOW.DEBRIEF || state === FLOW.PAUSED || canResume || confirmOpen;
    const radioPaused = backgrounded || state !== FLOW.FLIGHT || confirmOpen;
    if (this.audio?.setRadioPaused) {
      this.audio.setRadioPaused(radioPaused);
    } else if (this.audio?.departureRadio?.setPaused) {
      this.audio.departureRadio.setPaused(radioPaused);
    }
    if (this.audio?.setPaused) {
      this.audio.setPaused(backgrounded || held);
    } else if (this.audio?.setMuted) {
      this.audio.setMuted(backgrounded || held);
    }
  }

  syncGunAudio(isFiring = Boolean(this.sim?.missileCombat?.cannon?.firing)) {
    if (!this.audio) return;
    if (isFiring) this.audio.startGunFire();
    else this.audio.stopGunFire();
  }

  syncCombatAudio(missileCombat = this.sim?.missileCombat, camera = this.sim?.camera, paused = false) {
    if (!this.audio || !missileCombat) return;
    syncCombatAudio(missileCombat, {
      audio: this.audio,
      camera,
      paused,
    });
  }

  update(frameDelta, telemetry = this.sim?.telemetry, isCockpit = false, cameraDistanceMeters = 0) {
    if (!this.audio) return;
    this.audio.update(frameDelta, telemetry, isCockpit, cameraDistanceMeters);
  }
}
