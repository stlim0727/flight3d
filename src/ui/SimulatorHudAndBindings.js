import { t, bindText } from '../i18n/index.js';
import { SHADOW_VIEWS } from '../director/CockpitShadowDemo.js';
import { prepareCockpitShadowDepth } from '../aircraft/CockpitDepth.js';
import { RENDER_QUALITY, RENDER_QUALITY_KEY, resolveRenderQuality } from '../config/renderQuality.js';
import { CameraSystem } from '../cameras/CameraSystem.js';
import { updateControlState, touchLabel } from './FlightPanels.js';
import { FLOW } from './GameFlowController.js';
import { initLobbyScreen } from './LobbyScreen.js';
import { DeveloperPanel } from './DeveloperPanel.js';
import { RenderDiagnosticsPanel } from './RenderDiagnosticsPanel.js';
import { defaultScenarioForRegion } from '../config/scenarioRegistry.js';
import {
  saveSavedAirport,
  saveSavedAircraft,
  saveSavedScenario,
} from '../config/flightSelection.js';

class SimulatorHudAndBindingsMethods {
  initControls() {
    this.controls.onUserInteract = () => {
      this.audio.init();
      this.audio.ensureContextRunning();
    };

    this.controls.onToggleGear = () => {
      if (this.devRunner?.active) return;
      this.gear.toggleGear();
    };

    this.controls.onToggleSpoilers = () => {
      if (this.devRunner?.active) return;
      this.aero.toggleSpoilers();
    };

    this.controls.onCycleFlaps = (inc) => {
      if (this.devRunner?.active) return;
      this.aero.cycleFlaps(inc);
      this.telemetry.flapIndex = this.aero.flapsIndex;
      this.telemetry.flapDegree = this.aero.currentFlapAngle;
    };

    this.controls.onToggleReverser = () => {
      if (this.devRunner?.active) return;
      this.engines.toggleReverser(this.telemetry.onGround);
    };

    this.controls.onCycleEngineFailure = () => {
      if (this.devRunner?.active) return;
      if (this.engines.numEngines === 1) {
        const isFailed = !this.engines.failed[0];
        this.engines.setEngineFailure(0, isFailed);
        this.showToast(() => isFailed ? t('notice.engineFailure', { which: '1' }) : t('notice.enginesRecovered'));
        return;
      }
      // Cycle: both running → #1 out → both out → #2 out → both running
      const failed = this.engines.failed;
      if (!failed[0] && !failed[1]) {
        this.engines.setEngineFailure(0, true);
        this.showToast(() => t('notice.engineFailure', { which: '1 (L)' }));
      } else if (failed[0] && !failed[1]) {
        this.engines.setEngineFailure(1, true);
        this.showToast(() => t('notice.enginesBothFailed'));
      } else if (failed[0] && failed[1]) {
        this.engines.setEngineFailure(0, false);
        this.showToast(() => t('notice.engineFailure', { which: '2 (R)' }));
      } else {
        this.engines.setEngineFailure(1, false);
        this.showToast(() => t('notice.enginesRecovered'));
      }
    };

    this.controls.onCycleCamera = () => {
      const modeName = this.cameraSystem.cycleMode();
      if (this.demoDirector && this.demoDirector.isActive) {
        this.demoDirector.onUserCameraChange();
      }
      this.showToast(() => t('notice.camera', { name: modeName }));
    };

    this.controls.onSelectCamera = (mode) => {
      this.cameraSystem.setMode(mode, true);
      if (this.demoDirector?.isActive) this.demoDirector.onUserCameraChange();
      this.showToast(() => t('notice.camera', { name: this.cameraSystem.getModeName() }));
    };

    this.controls.onToggleLights = () => {
      this.aircraft.lightsOn = !this.aircraft.lightsOn;
      this.aircraft.lightsGroup.visible = this.aircraft.lightsOn;
      this.showToast(() => t('notice.lights', { state: t(this.aircraft.lightsOn ? 'state.on' : 'state.off') }));
    };

    this.controls.onCycleTimeOfDay = (deltaHours) => {
      this.demoDirector?.onUserTimeOfDayChange();
      this.sky.setTimeOfDay(this.sky.timeOfDay + deltaHours, this.position, this.camera.position);
      this.foliage.setTimeOfDay(this.sky.timeOfDay);
      this.water.syncWithAtmosphere(this.sky);
      const h = Math.floor(this.sky.timeOfDay);
      const m = Math.floor((this.sky.timeOfDay % 1) * 60);
      const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      this.showToast(() => t('notice.time', { time: timeStr }));
    };

    this.controls.onToggleAudio = () => {
      this.audio.init();
      this.audio.ensureContextRunning();
      const state = this.audio.cycleVolume();
      this.updateAudioUI(state);
      this.showToast(() => t('sound.value', { value: this.audio.getVolumeState().text }));
    };

    this.controls.onResetLook = () => {
      this.cameraSystem.resetLook();
      this.showToast(() => t('camera.view.centered'));
    };

    this.controls.onDeviceConnected = (device) => {
      this.showToast(() => t('notice.hotasConnected', { name: device.name }));
    };

    this.controls.onDeviceDisconnected = (device) => {
      this.showToast(() => t('notice.hotasDisconnected', { name: device.name }));
    };
  }

  updateHUD() {
    const elIas = document.getElementById('hud-ias');
    const elAlt = document.getElementById('hud-alt');
    const elHdg = document.getElementById('hud-hdg');
    const elVsi = document.getElementById('hud-vsi');
    const elN1 = document.getElementById('hud-n1');
    const elFlaps = document.getElementById('hud-flaps');
    const elGear = document.getElementById('hud-gear');
    const elSpoilers = document.getElementById('hud-spoilers');
    const elGForce = document.getElementById('hud-g');
    const elStall = document.getElementById('hud-stall');
    const elCam = document.getElementById('hud-cam');

    if (elIas) elIas.textContent = `${Math.round(this.telemetry.iasKnots)} KT`;
    if (elAlt) elAlt.textContent = `${Math.round(this.telemetry.altitudeFt)} FT`;
    if (elHdg) elHdg.textContent = `${Math.round(this.telemetry.headingDeg).toString().padStart(3, '0')}°`;
    if (elVsi) elVsi.textContent = `${Math.round(this.telemetry.vsiFpm)} FPM`;
    if (elN1) elN1.textContent = `${Math.round(this.telemetry.engine1 ? this.telemetry.engine1.n1 : 22)}%`;
    if (elFlaps) elFlaps.textContent = `${Math.round(this.telemetry.flapDegree)}°`;
    if (elGear) {
      const states = Object.values(this.telemetry.gearDamage || {});
      const failed = states.includes('collapsed');
      const damaged = states.includes('damaged');
      elGear.textContent = failed ? 'FAIL' : damaged ? 'DMG' : this.telemetry.gearState > 0.95 ? 'DOWN' : (this.telemetry.gearState < 0.05 ? 'UP' : 'TRANS');
      elGear.className = failed ? 'status-danger' : damaged ? 'status-amber' : this.telemetry.gearState > 0.95 ? 'status-green' : (this.telemetry.gearState < 0.05 ? 'status-dim' : 'status-amber');
    }
    if (elSpoilers) {
      elSpoilers.textContent = this.telemetry.spoilers > 0.1 ? 'EXT' : 'ARM';
      elSpoilers.className = this.telemetry.spoilers > 0.1 ? 'status-amber' : 'status-green';
    }
    if (elGForce) elGForce.textContent = `${this.telemetry.gForce.toFixed(2)} G`;
    if (elStall) {
      elStall.style.display = this.telemetry.isStalled ? 'block' : 'none';
    }
    const warning = document.getElementById('hud-warning');
    if (warning) {
      const alert = this.isCrashed ? null : this.telemetry.warnings?.[0];
      warning.textContent = alert?.text || '';
      warning.hidden = !alert;
      warning.style.color = alert?.priority >= 85 ? '#ff5555' : '#ffbe55';
    }
    if (elCam) elCam.textContent = this.cameraSystem.getModeName();
    this.updateAutopilotUI();
    updateControlState(this.telemetry, this.cameraSystem, { demoActive: Boolean(this.demoDirector?.isActive) });
    this.hudView.update();
  }

  flightPhase() {
    const t0 = this.telemetry;
    if (t0.onGround) return 'GND';
    if (this.autopilot.lateralMode === 'APP') return 'APP';
    if (t0.vsiFpm > 300) return 'CLB';
    if (t0.vsiFpm < -300) return 'DES';
    return 'CRZ';
  }

  updateAutopilotUI() {
    const isDemo = Boolean(this.demoDirector?.isActive);
    const btnToggle = document.getElementById('btn-ap-toggle');
    if (btnToggle) {
      btnToggle.disabled = isDemo;
      btnToggle.classList.toggle('ap-active', this.autopilot.master);
    }
    const elPhase = document.getElementById('hud-phase');
    if (elPhase) {
      const text = t(`phase.${this.flightPhase().toLowerCase()}`);
      if (elPhase.textContent !== text) elPhase.textContent = text;
    }
    const elModes = document.getElementById('hud-ap-modes');
    if (elModes) {
      const modes = this.autopilot.annunciation();
      if (elModes.textContent !== modes) elModes.textContent = modes;
    }
    const pressed = {
      'btn-ap': this.autopilot.master,
      'btn-ap-hdg': this.autopilot.lateralMode === 'HDG',
      'btn-ap-alt': this.autopilot.verticalMode === 'ALT',
      'btn-ap-spd': this.autopilot.speedMode,
      'btn-ap-app': this.autopilot.lateralMode === 'APP' || this.autopilot.appArmed,
    };
    for (const [id, on] of Object.entries(pressed)) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.disabled = isDemo;
      btn.classList.toggle('ap-active', on);
      btn.classList.toggle('ap-armed', id === 'btn-ap-app' && this.autopilot.appArmed);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  updateApToggleUI() {
    const bar = document.getElementById('ap-bar');
    const btn = document.getElementById('btn-ap-toggle');
    if (!bar || !btn) return;
    const collapsed = bar.classList.contains('ap-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = 'AP';
    document.getElementById('ap-panel').hidden = collapsed;
    bindText(btn, () => t(collapsed ? 'ap.expand' : 'ap.collapse'), 'aria-label');
    bindText(btn, () => t(collapsed ? 'ap.expand.tip' : 'ap.collapse.tip'), 'title');
    btn.classList.toggle('ap-active', this.autopilot.master);
  }

  updateAudioUI(state) {
    if (!state && this.audio) state = this.audio.getVolumeState();
    if (!state) return;

    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
      btnMute.textContent = state.muted ? '🔇' : '🔊';
      btnMute.setAttribute('aria-pressed', String(state.muted));
      bindText(btnMute, () => t(state.muted ? 'ui.unmute' : 'ui.mute'), 'aria-label');
      bindText(btnMute, () => t(state.muted ? 'ui.unmute' : 'ui.mute'), 'title');
    }
    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      if (state.muted) {
        btnSound.className = 'btn btn-preset btn-sound-toggle muted';
        bindText(btnSound, () => t('muted'));
      } else {
        btnSound.className = 'btn btn-preset btn-sound-toggle';
        bindText(btnSound, () => t('sound.100'));
      }
    }
  }

  showToast(msg) {
    // The shadow demo resets through setPreset('runway'); its own status panel
    // describes the held aircraft, so a "ready for takeoff" toast would lie.
    if (this.quietPresetToast) return;
    const toast = document.getElementById('toast-msg');
    if (!toast) return;
    bindText(toast, () => typeof msg === 'function' ? msg() : msg);
    toast.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2500);
  }

  renderScene() {
    if (this.renderDiagnostics?.active) { this.renderDiagnostics.render(); return; }
    // Hide only for this render, retaining visibility state across aircraft swaps,
    // asynchronous model loads and the return to any exterior/cockpit camera.
    const hiddenAirframe = this.cameraSystem.mode === CameraSystem.MODES.HUD && !this.isCrashed;
    const visible = this.aircraft.group.visible;
    if (hiddenAirframe) this.aircraft.group.visible = false;
    try { this.renderStandardScene(); }
    finally { this.aircraft.group.visible = visible; }
  }

  renderStandardScene(aoQuality = this.renderQuality) {
    prepareCockpitShadowDepth(this.aircraft.group);
    this.sky.prepareRender(this.camera, this.aircraft.group.position);
    this.renderer.render(this.scene, this.camera);
    if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT &&
        (!this.cameraSystem.photoCockpit || this.cameraSystem.isLookingAwayFromCenter())) {
      // Photo mode only reaches the 3D interior mid head-turn; the cabin then
      // fills the viewport and the AO early-out cannot fire, so run that
      // transitional view at a reduced AO scale.
      const transitional = this.cameraSystem.photoCockpit && this.cameraSystem.isLookingAwayFromCenter();
      this.cockpitOcclusion.render(this.renderer, aoQuality, transitional);
    }
  }

  updateShadowDemoUi() {
    const demo = this.shadowDemo;
    if (!demo) return;
    const panel = document.getElementById('shadow-demo');
    if (panel) panel.hidden = !demo.active;
    const status = document.getElementById('shadow-status');
    if (status) bindText(status, () => t('shadow.status', {
      step: demo.index + 1, total: SHADOW_VIEWS.length,
      direction: t(SHADOW_VIEWS[demo.index ?? 0].key),
    }));
    const pause = document.getElementById('shadow-pause');
    if (pause) {
      bindText(pause, () => t(demo.paused ? 'shadow.resume' : 'shadow.pause'));
      pause.setAttribute('aria-pressed', String(demo.paused));
    }
    if (this.gameFlow) this.syncFlowUi();
  }

  setRenderQuality(value) {
    this.renderDiagnosticsPanel?.close();
    this.renderQuality = resolveRenderQuality(value);
    const preset = RENDER_QUALITY[this.renderQuality];
    this.sky.setShadowMapSize(preset.shadowMapSize);
    if (this.terrain.getQuality() !== preset.terrain) this.terrain.setQuality(preset.terrain);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
    document.getElementById('render-quality').value = this.renderQuality;
    try { localStorage.setItem(RENDER_QUALITY_KEY, this.renderQuality); } catch { /* Session-only setting. */ }
  }

  initUI() {
    const cockpitQuality = document.getElementById('cockpit-quality');
    cockpitQuality.value = this.cockpitOcclusion.enabled ? 'detailed' : 'performance';
    cockpitQuality.addEventListener('change', () => {
      this.cockpitOcclusion.enabled = cockpitQuality.value !== 'performance';
      try { localStorage.setItem('flight3d.cockpitQuality', cockpitQuality.value); } catch { /* Session-only setting. */ }
    });
    const qualitySelect = document.getElementById('render-quality');
    qualitySelect.value = this.renderQuality;
    qualitySelect.addEventListener('change', () => this.setRenderQuality(qualitySelect.value));
    document.getElementById('btn-flaps-ext')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onCycleFlaps(1);
    });
    document.getElementById('btn-flaps-ret')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onCycleFlaps(-1);
    });
    document.getElementById('btn-gear')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onToggleGear();
    });
    document.getElementById('btn-spoilers')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onToggleSpoilers();
    });
    document.getElementById('btn-reverser')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onToggleReverser();
    });
    document.getElementById('btn-cam-reset')?.addEventListener('click', () => {
      this.cameraSystem.resetLook();
      this.showToast(() => t('camera.view.centered'));
    });
    document.getElementById('btn-mute')?.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.isMuted);
      if (!this.audio.isMuted) {
        this.audio.init();
        this.audio.ensureContextRunning();
      }
      this.updateAudioUI();
    });
    document.getElementById('btn-sound')?.addEventListener('click', () => this.controls.onToggleAudio());
    document.getElementById('btn-diag')?.addEventListener('click', () => this.diagnostics.toggle());
    document.getElementById('btn-touch-toggle')?.addEventListener('click', () => {
      this.touchControls.toggle();
      const state = this.touchControls.enabled ? 'state.on' : 'state.off';
      this.showToast(() => t('touch.controls.value', { value: t(state) }));
    });
    document.getElementById('incheon-attribution-chip')?.addEventListener('click', (event) => {
      const aside = event.currentTarget.closest('#incheon-attribution');
      const expanded = aside.classList.toggle('expanded');
      event.currentTarget.setAttribute('aria-expanded', String(expanded));
    });
    const fullscreenButton = document.getElementById('btn-fullscreen');
    const syncFullscreenUI = () => {
      if (!fullscreenButton) return;
      const active = Boolean(document.fullscreenElement);
      bindText(fullscreenButton, () => t(active ? 'fullscreen.exit' : 'fullscreen.enter'));
      fullscreenButton.setAttribute('aria-pressed', String(active));
    };
    fullscreenButton?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (err) {
        this.showToast(() => t('fullscreen.unavailable'));
      }
    });
    // Esc exits fullscreen natively without a usable keydown, so resize and
    // the pressed state are reconciled from the fullscreenchange event.
    document.addEventListener('fullscreenchange', () => {
      syncFullscreenUI();
      this.handleResize();
    });
    syncFullscreenUI();
    for (const [id, mode] of [
      ['btn-ap', 'MASTER'], ['btn-ap-hdg', 'HDG'], ['btn-ap-alt', 'ALT'],
      ['btn-ap-spd', 'SPD'], ['btn-ap-app', 'APP'],
    ]) {
      document.getElementById(id)?.addEventListener('click', () => {
        if (this.demoDirector?.isActive) return;
        const on = this.autopilot.toggle(mode, this.telemetry);
        if (mode === 'MASTER') {
          this.showToast(() => t('notice.autopilot', { state: t(on ? 'state.on' : 'state.off') }));
        } else {
          this.showToast(() => t('notice.ap.modes', { modes: this.autopilot.annunciation() || t('state.off') }));
        }
        this.updateAutopilotUI();
      });
    }
    document.getElementById('btn-ap-toggle')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      document.getElementById('ap-bar')?.classList.toggle('ap-collapsed');
      this.updateApToggleUI();
    });
    const closeApPanel = () => {
      const bar = document.getElementById('ap-bar');
      if (bar.classList.contains('ap-collapsed')) return;
      bar.classList.add('ap-collapsed');
      this.updateApToggleUI();
    };
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#ap-bar, #hud-autopilot')) closeApPanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || document.getElementById('ap-panel').hidden) return;
      event.preventDefault();
      event.stopPropagation();
      closeApPanel();
      document.getElementById(this.cameraSystem.mode === CameraSystem.MODES.HUD ? 'hud-autopilot' : 'btn-ap-toggle').focus({ preventScroll: true });
    });
    this.updateApToggleUI();

    // Initialize Demo Director UI bindings
    this.demoDirector.initUI();

    // Lobby + pause menu bindings
    this.lobbyScreen = initLobbyScreen({
      getAirport: () => this.lobby.airport,
      getPreset: () => this.lobby.preset,
      getTime: () => this.sky.timeOfDay,
      getAircraft: () => this.lobby.aircraft || this.currentAircraftId || 'B738',
      getDemoProfile: () => this.lobby.demoProfile,
      onDemoProfile: id => { this.lobby.demoProfile = id; },
      onAirport: id => {
        this.lobby.airport = id;
        this.lobby.preset = defaultScenarioForRegion(id);
        if (id === 'hangang') this.lobby.aircraft = 'C172';
        saveSavedScenario(this.lobby.preset);
        saveSavedAirport(id);
        this.lobbyScreen?.refresh();
        this.queueLobbySelection();
      },
      onPreset: type => {
        this.lobby.preset = type;
        saveSavedScenario(type);
        this.lobbyScreen.refresh();
      },
      onTime: hours => this.setTimeOfDay(hours),
      onAircraft: id => {
        this.lobby.aircraft = id;
        saveSavedAircraft(id);
        this.lobbyScreen?.refresh();
        this.queueLobbySelection();
      },
      onFly: () => this.fly(),
    });
    this.renderDiagnosticsPanel = new RenderDiagnosticsPanel(this);
    this.developerPanel = new DeveloperPanel(this);
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => this.gameFlow.resume());
    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.gameFlow.resume();
      if (this.devRunner.active) { this.devRunner.restart(); return; }
      this.setPreset(this.lastPresetType || 'runway');
    });
    document.getElementById('btn-pause-lobby')?.addEventListener('click', () => this.gameFlow.returnToLobby(true));
    document.getElementById('menu-toggle')?.addEventListener('click', () => this.toggleMainMenu());

    document.getElementById('shadow-prev')?.addEventListener('click', () => this.shadowDemo.next(-1));
    document.getElementById('shadow-next')?.addEventListener('click', () => this.shadowDemo.next());
    document.getElementById('shadow-pause')?.addEventListener('click', () => this.shadowDemo.togglePause());
    document.getElementById('shadow-exit')?.addEventListener('click', () => {
      this.devRunner.stop();
      this.shadowDemo.stop();
      this.lastPresetType = 'runway';
      this.gameFlow.returnToLobby(true);
    });

    // ESC chain: the demo director consumes ESC first (take manual control);
    // otherwise panels/help modal close before the pause menu opens.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (this.isCrashed) return;
      if (document.getElementById('hud-overlay')?.classList.contains('panel-open')) return;
      const helpModal = document.getElementById('help-modal');
      if (helpModal?.classList.contains('visible')) {
        helpModal.classList.remove('visible');
        return;
      }
      if (this.gameFlow.state === FLOW.FLIGHT) this.gameFlow.pause();
      else if (this.gameFlow.state === FLOW.PAUSED) this.gameFlow.resume();
    });

    // Initialize Audio UI state
    this.updateAudioUI();

    // Flight Guide Modal
    const helpModal = document.getElementById('help-modal');
    document.getElementById('btn-help')?.addEventListener('click', () => {
      helpModal?.classList.toggle('visible');
    });
    document.getElementById('btn-help-close')?.addEventListener('click', () => {
      helpModal?.classList.remove('visible');
    });

    // Crash report: header toggles the full report; the main menu button is the
    // persistent top-left one. Back to the lobby is also [Space / R / Enter].
    document.getElementById('btn-crash-toggle')?.addEventListener('click', () => {
      this.setCrashReportMinimized(!this.isCrashReportMinimized);
    });

    const toggleYokes = () => {
      const visible = this.aircraft.cockpit.toggleYokes();
      const button = document.getElementById('btn-yokes');
      if (button) {
        bindText(button, () => touchLabel(visible ? t('hide.yokes.j') : t('show.yokes.j')));
        button.setAttribute('aria-pressed', String(!visible));
      }
    };
    document.getElementById('btn-yokes')?.addEventListener('click', toggleYokes);
    window.addEventListener('keydown', e => {
      if (this.gameFlow.blocksFlightInput()) return;
      if (e.code === 'KeyJ' && !e.repeat && !e.target?.closest?.('input, textarea, select, [contenteditable]')) {
        toggleYokes();
      }
    });

    // Toggle Cockpit Photo Mode by clicking HUD Camera item
    document.getElementById('hud-cam')?.addEventListener('click', () => {
      if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT) {
        if (!this.cameraSystem.supportsPhotoCockpit) {
          this.showToast(() => t('3d.virtual.cockpit'));
          return;
        }
        const isPhoto = this.cameraSystem.toggleCockpitPhoto();
        this.showToast(() => isPhoto ? t('photo.cockpit.panel') : t('3d.virtual.cockpit'));
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.target?.closest?.('select')) return;
      if (this.gameFlow.blocksFlightInput()) return;
      if (this.isCrashed && (e.code === 'Space' || e.code === 'KeyR' || e.code === 'Enter')) {
        this.exitCrashToLobby();
      }
      if (e.code === 'F2') {
        if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT) {
          if (!this.cameraSystem.supportsPhotoCockpit) {
            this.showToast(() => t('3d.virtual.cockpit'));
            return;
          }
          const isPhoto = this.cameraSystem.toggleCockpitPhoto();
          this.showToast(() => isPhoto ? t('photo.cockpit.panel') : t('3d.virtual.cockpit'));
        }
      }
      if (e.code === 'KeyO') {
        this.cameraSystem.resetLook();
        this.showToast(() => t('camera.view.centered'));
      }
    });
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    const isCockpit = this.cameraSystem && this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    let targetFov = isCockpit ? 60 : 54;
    if (this.camera.aspect < 1.0) {
      const targetHFov = (isCockpit ? 76 : 64) * (Math.PI / 180);
      const vFovRad = 2 * Math.atan(Math.tan(targetHFov / 2) / this.camera.aspect);
      targetFov = Math.min(100, Math.max(54, vFovRad * (180 / Math.PI)));
    }
    this.cameraSystem.applyBaseFov(targetFov);
    // The projection must be rebuilt for the new aspect even when the zoomed
    // vertical FOV happens to be unchanged.
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.onResize(window.innerWidth, window.innerHeight);
    }
  }
}

export function installSimulatorHudAndBindings(TargetClass) {
  for (const key of Object.getOwnPropertyNames(SimulatorHudAndBindingsMethods.prototype)) {
    if (key !== "constructor") {
      Object.defineProperty(
        TargetClass.prototype,
        key,
        Object.getOwnPropertyDescriptor(SimulatorHudAndBindingsMethods.prototype, key),
      );
    }
  }
}
