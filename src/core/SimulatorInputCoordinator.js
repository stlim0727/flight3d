import { t } from '../i18n/index.js';
import { pickGazeTarget } from '../cameras/gazeTargetPicker.js';
import { loadSimulatorPreferences, saveSimulatorPreferences } from '../config/simulatorPreferences.js';
import { initFlightPanels } from '../ui/FlightPanels.js';

/**
 * Coordinates user input bindings, flight control toolbar bindings,
 * window activity / focus management, input blockage, and camera gaze picking.
 */
export class SimulatorInputCoordinator {
  constructor(sim = null) {
    this.sim = sim;
    this._onBlur = null;
    this._onFocus = null;
    this._onVisibilityChange = null;
    this._onPageHide = null;
    this._onPageShow = null;
  }

  /**
   * Shield keyboard shortcuts during loading and in the startup disclosure overlay.
   */
  static installStartupInputShield() {
    if (typeof document === 'undefined') return;
    document.getElementById('startup-overlay')?.addEventListener('keydown', event => event.stopPropagation());
    window.addEventListener('keydown', event => {
      if (document.body.classList.contains('booting') && !event.target?.closest?.('#startup-overlay')) {
        if (event.key !== 'Tab') event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true });
  }

  /**
   * Bind top/bottom flight panels toolbar events to flight controls, aero trim, and parking brake.
   */
  bindFlightPanels({ controls, aero, audio, isCrashedGetter = () => false } = {}) {
    initFlightPanels({
      onMapUnfold: () => audio?.playMapUnfold?.(),
      onMapFold: () => audio?.playMapFold?.(),
      toolbarHidden: loadSimulatorPreferences().toolbarHidden,
      onToolbarHiddenChange: toolbarHidden => saveSimulatorPreferences({ toolbarHidden }),
      onSelectCamera: mode => controls?.onSelectCamera?.(mode),
      onAdjustTrim: delta => {
        if (controls?.aircraftControlsDisabled || controls?.inputBlocked || isCrashedGetter()) return;
        aero?.setTrim?.(delta);
        if (controls && aero) controls.pitchTrim = aero.pitchTrim;
      },
      onToggleParkingBrake: () => {
        if (controls?.onToggleParkingBrake) controls.onToggleParkingBrake();
        else if (controls && !controls.aircraftControlsDisabled && !controls.inputBlocked && !isCrashedGetter()) {
          controls.setParkingBrake(!controls.parkingBrake);
        }
      },
    });
  }

  /**
   * Bind window visibility and focus events to pause/resume simulation and zero control surfaces.
   */
  bindBrowserActivity(sim = this.sim) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const sync = () => sim.setBrowserActive(!document.hidden && document.hasFocus());
    this._onBlur = () => sim.setBrowserActive(false);
    this._onFocus = sync;
    this._onVisibilityChange = sync;
    this._onPageHide = () => sim.setBrowserActive(false);
    this._onPageShow = sync;

    window.addEventListener('blur', this._onBlur);
    window.addEventListener('focus', this._onFocus);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('pageshow', this._onPageShow);
    sync();
  }

  /**
   * Handle changes to browser active/backgrounded status, releasing controls on blur.
   */
  syncBrowserActive(sim, active) {
    const backgrounded = !active;
    if (sim.browserBackgrounded === backgrounded) return;
    sim.browserBackgrounded = backgrounded;
    sim.flightPerformance?.flush?.('browser-activity');
    sim.flightGpuTimer?.clear?.();
    sim.lastFrameDelta = null;
    // Discard wall time and any fractional physics debt on both edges.
    sim.clock?.getDelta?.();
    sim.physicsAccumulator = 0;
    if (backgrounded) {
      sim.frameTransitions?.cancel?.();
      sim.multiplayer?.roomReplay?.gap?.();
      this.releaseAllControls(sim.controls);
    }
    sim.syncAudioPause();
    if (active) sim.audio?.ensureContextRunning?.();
  }

  /**
   * Release keyboard and touch axes on controls.
   */
  releaseAllControls(controls) {
    if (!controls) return;
    controls.releaseAllKeys?.();
    controls.setTouchStick?.(0, 0);
    controls.setTouchRudder?.(0);
    controls.setTouchBrakes?.(0);
  }

  /**
   * Compute input blockage state and clear controls when blocked.
   */
  updateInputBlocked(sim = this.sim) {
    if (!sim?.controls) return;
    sim.controls.inputBlocked = sim.multiplayer?.modalOpen ||
      sim.multiplayer?.room?.session.state === 'starting' ||
      sim.gameFlow.blocksFlightInput() ||
      sim.shadowDemo.active ||
      Boolean(sim.devRunner?.blocksInput) ||
      Boolean(sim.pilotArena?.active && sim.pilotArena?.record?.pilotKind !== 'human') ||
      Boolean(sim.demoDirector?.isRestartConfirmOpen);

    if (sim.controls.inputBlocked) {
      this.releaseAllControls(sim.controls);
    }
  }

  /**
   * Dispatches canvas clicks to pick and focus gaze targets for the camera system.
   */
  handleGazeCanvasClick(sim, clientX, clientY) {
    if (sim.gameFlow?.state === 'lobby' || sim.gameFlow?.isPaused?.()) return;
    const rect = sim.renderer?.domElement?.getBoundingClientRect?.();
    if (!rect) return;
    const replayCombat = sim.replayDirector?.combatState();
    const combat = replayCombat ?? {
      targets: sim.missileCombat?.targets,
    };
    const combatView = replayCombat ? sim.replayDirector?.combatView?.() : sim.missileCombatView;
    const bandits = [];
    for (const target of combat?.targets ?? []) {
      if (!target?.alive || !target.position) continue;
      const view = combatView?.targetViews?.get(target.id);
      bandits.push({
        id: target.id,
        label: target.callsign || t('gaze.target.bandit'),
        mesh: view?.mesh ?? null,
        getPosition: () => (target.alive ? target.position : null),
      });
    }
    const aircraft = [];
    const remoteCandidates = [];
    if (sim.multiplayer?.remote) remoteCandidates.push({ id: 'remote', visual: sim.multiplayer.remote });
    if (sim.replayDirector?.active && Array.isArray(sim.replayDirector.remotes)) {
      sim.replayDirector.remotes.forEach((entry, index) => {
        if (entry?.visual) remoteCandidates.push({ id: `replay-remote-${index}`, visual: entry.visual });
      });
    }
    for (const { id, visual } of remoteCandidates) {
      if (!visual || visual.disposed || !visual.group?.visible) continue;
      aircraft.push({
        id,
        label: visual.group.userData?.name || visual.aircraft || t('gaze.target.aircraft'),
        mesh: visual.group,
        getPosition: () => (!visual.disposed && visual.group?.visible ? visual.group.position : null),
      });
    }
    const parkedAircraft = sim.currentAirport?.parked?.group ? [sim.currentAirport.parked.group] : [];
    const buildings = [];
    for (const entry of sim.currentAirport?.getGazeTargets?.() ?? []) {
      buildings.push({
        object: entry.object,
        kind: entry.kind || 'building',
        label: t(`gaze.target.${entry.kind || 'building'}`),
      });
    }
    if (sim.ships?.group?.visible) {
      const shipRecords = [...(sim.ships.vessels ?? []), ...(sim.ships.speedboats ?? [])];
      if (shipRecords.length > 0) {
        for (const ship of shipRecords) {
          if (!ship?.mesh) continue;
          buildings.push({
            object: ship.mesh,
            kind: 'ship',
            label: t('gaze.target.ship'),
            dynamic: true,
          });
        }
      } else {
        buildings.push({
          object: sim.ships.group,
          kind: 'ship',
          label: t('gaze.target.ship'),
        });
      }
    }
    const picked = pickGazeTarget({
      clientX,
      clientY,
      rect,
      camera: sim.camera,
      sources: {
        bandits,
        aircraft,
        parkedAircraft,
        parkedLabel: t('gaze.target.parkedAircraft'),
        buildings,
      },
    });
    if (picked) {
      sim.cameraSystem.setGazeTarget(picked);
      sim.showToast(() => t('notice.gaze.on', { target: picked.label || t('gaze.target.building') }));
    }
  }
}
