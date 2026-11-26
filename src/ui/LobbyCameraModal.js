import { t } from '../i18n/index.js';
import { CameraSystem } from '../cameras/CameraSystem.js';

const MODE_NAME_KEYS = {
  [CameraSystem.MODES.COCKPIT]: 'cockpit',
  [CameraSystem.MODES.CHASE]: 'chase',
  [CameraSystem.MODES.WING]: 'wing',
  [CameraSystem.MODES.HUD]: 'hud',
  [CameraSystem.MODES.FLYBY]: 'flyby',
};

function formatAxisVal(val, axis) {
  if (Math.abs(val) < 0.001) return '0 cm';
  const cm = Math.round(val * 100);
  if (axis === 'y') {
    const sign = cm > 0 ? '+' : '';
    const tag = cm > 0 ? t('ui.cockpitPov.up') : t('ui.cockpitPov.down');
    return `${sign}${cm} cm (${tag})`;
  }
  if (axis === 'z') {
    const tag = cm < 0 ? t('ui.cockpitPov.fwd') : t('ui.cockpitPov.aft');
    return `${Math.abs(cm)} cm (${tag})`;
  }
  if (axis === 'x') {
    const tag = cm < 0 ? t('ui.cockpitPov.left') : t('ui.cockpitPov.right');
    return `${Math.abs(cm)} cm (${tag})`;
  }
  return `${cm} cm`;
}

export class LobbyCameraModal {
  constructor(simulator) {
    this.simulator = simulator;
    this.cameraSystem = simulator?.cameraSystem || simulator;

    this.dialog = typeof document !== 'undefined' ? document.getElementById('lobby-camera-modal') : null;
    if (this.dialog?.style) this.dialog.style.pointerEvents = 'auto';
    this.lobbyBtn = typeof document !== 'undefined' ? document.getElementById('btn-lobby-camera') : null;
    this.lobbyBtnLabel = typeof document !== 'undefined' ? document.getElementById('lobby-camera-btn-label') : null;
    this.titleEl = typeof document !== 'undefined' ? document.getElementById('lobby-camera-title') : null;
    this.startModeSelect = typeof document !== 'undefined' ? document.getElementById('lobby-camera-start-mode') : null;
    this.closeBtn = typeof document !== 'undefined' ? document.getElementById('btn-lobby-camera-close') : null;
    this.doneBtn = typeof document !== 'undefined' ? document.getElementById('btn-lobby-camera-done') : null;
    this.resetBtn = typeof document !== 'undefined' ? document.getElementById('btn-lobby-camera-reset') : null;

    this.previewCanvas = typeof document !== 'undefined' ? document.getElementById('lobby-camera-preview-canvas') : null;
    this.previewCtx = this.previewCanvas?.getContext?.('2d') || null;

    this.sliderY = typeof document !== 'undefined' ? document.getElementById('lobby-pov-y') : null;
    this.outputY = typeof document !== 'undefined' ? document.getElementById('lobby-pov-y-val') : null;
    this.sliderZ = typeof document !== 'undefined' ? document.getElementById('lobby-pov-z') : null;
    this.outputZ = typeof document !== 'undefined' ? document.getElementById('lobby-pov-z-val') : null;
    this.sliderX = typeof document !== 'undefined' ? document.getElementById('lobby-pov-x') : null;
    this.outputX = typeof document !== 'undefined' ? document.getElementById('lobby-pov-x-val') : null;

    this.savedCameraMode = null;
    this.savedUserModeSelected = null;
    this.savedAutoSwitch = null;
    this.savedCustomViewUpdater = null;
    this.isOpen = false;

    this.initBindings();
    this.updateLobbyButtonLabel();
  }

  getAircraftId() {
    const hasHeldSortie = Boolean(this.simulator?.gameFlow?.canResumeFromLobby?.());
    if (hasHeldSortie) {
      return this.simulator?.currentAircraftId || 'C172';
    }
    return this.simulator?.lobby?.aircraft || this.simulator?.currentAircraftId || 'C172';
  }

  getAircraftDisplayName(id = this.getAircraftId()) {
    if (id === 'C172') return 'C172';
    if (id === 'F16') return 'F-16';
    if (id === 'B738') return 'B737';
    return id;
  }

  initBindings() {
    this.lobbyBtn?.addEventListener('click', () => {
      this.toggle();
    });

    this.closeBtn?.addEventListener('click', () => {
      this.close();
    });

    this.doneBtn?.addEventListener('click', () => {
      this.close();
    });

    this.resetBtn?.addEventListener('click', () => {
      this.resetToDefaults();
    });

    this.startModeSelect?.addEventListener('change', () => {
      const mode = parseInt(this.startModeSelect.value, 10);
      if (Number.isFinite(mode) && typeof this.cameraSystem?.setPreferredStartMode === 'function') {
        this.cameraSystem.setPreferredStartMode(mode);
        this.updateLobbyButtonLabel();
      }
    });

    const handleSliderInput = () => {
      const x = parseFloat(this.sliderX?.value || '0');
      const y = parseFloat(this.sliderY?.value || '0');
      const z = parseFloat(this.sliderZ?.value || '0');
      const aircraftId = this.getAircraftId();
      this.cameraSystem?.setCockpitUserOffset?.(x, y, z, aircraftId);
      this.updateOutputs();
    };

    this.sliderX?.addEventListener('input', handleSliderInput);
    this.sliderY?.addEventListener('input', handleSliderInput);
    this.sliderZ?.addEventListener('input', handleSliderInput);

    if (this.dialog) {
      const stepButtons = this.dialog.querySelectorAll('.lobby-pov-step');
      for (const btn of stepButtons) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const axis = btn.dataset.axis;
          const dir = parseInt(btn.dataset.dir, 10) || 1;
          this.stepAxis(axis, dir);
        });
      }

      this.dialog.addEventListener('click', (e) => {
        if (e.target === this.dialog) this.close();
      });

      this.dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      });

      // Keep the 3D canvas from treating dialog gestures as camera drags.
      for (const type of ['mousedown', 'pointerdown', 'touchstart', 'wheel']) {
        this.dialog.addEventListener(type, event => event.stopPropagation(), { passive: true });
      }
    }

    if (this.cameraSystem) {
      const prevOffsetHandler = this.cameraSystem.onCockpitUserOffsetChange;
      this.cameraSystem.onCockpitUserOffsetChange = (offset) => {
        if (typeof prevOffsetHandler === 'function') prevOffsetHandler(offset);
        if (this.isOpen) this.syncFromCamera();
      };

      const prevModeHandler = this.cameraSystem.onPreferredStartModeChange;
      this.cameraSystem.onPreferredStartModeChange = (mode) => {
        if (typeof prevModeHandler === 'function') prevModeHandler(mode);
        this.updateLobbyButtonLabel();
      };
    }
  }

  updateLobbyButtonLabel() {
    if (!this.lobbyBtnLabel) return;
    const mode = typeof this.cameraSystem?.getPreferredStartMode === 'function'
      ? this.cameraSystem.getPreferredStartMode()
      : CameraSystem.MODES.CHASE;
    const modeKey = MODE_NAME_KEYS[mode] || 'chase';
    const modeName = t(`ui.camera.name.${modeKey}`) || t(`ui.camera.${modeKey}`) || '추적';
    const labelPattern = t('ui.lobbyCamera.btn') || '카메라 · {mode} ▾';
    this.lobbyBtnLabel.textContent = labelPattern.replace('{mode}', modeName);
  }

  updateTitle() {
    if (!this.titleEl) return;
    const aircraft = this.getAircraftDisplayName();
    const pattern = t('ui.lobbyCamera.title') || '카메라 설정 · {aircraft}';
    this.titleEl.textContent = pattern.replace('{aircraft}', aircraft);
  }

  syncFromCamera() {
    if (!this.cameraSystem?.getCockpitUserOffset) return;
    const offset = this.cameraSystem.getCockpitUserOffset();
    if (this.sliderX) this.sliderX.value = String(offset.x);
    if (this.sliderY) this.sliderY.value = String(offset.y);
    if (this.sliderZ) this.sliderZ.value = String(offset.z);
    this.updateOutputs();
  }

  updateOutputs() {
    const x = parseFloat(this.sliderX?.value || '0');
    const y = parseFloat(this.sliderY?.value || '0');
    const z = parseFloat(this.sliderZ?.value || '0');

    if (this.outputY) this.outputY.textContent = formatAxisVal(y, 'y');
    if (this.outputZ) this.outputZ.textContent = formatAxisVal(z, 'z');
    if (this.outputX) this.outputX.textContent = formatAxisVal(x, 'x');
  }

  stepAxis(axis, dir) {
    const slider = axis === 'x' ? this.sliderX : axis === 'y' ? this.sliderY : this.sliderZ;
    if (!slider) return;

    const step = parseFloat(slider.step) || 0.005;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let val = parseFloat(slider.value) || 0;

    val += dir * step * 2;
    val = Math.max(min, Math.min(max, Math.round(val * 1000) / 1000));
    slider.value = String(val);

    const x = parseFloat(this.sliderX?.value || '0');
    const y = parseFloat(this.sliderY?.value || '0');
    const z = parseFloat(this.sliderZ?.value || '0');
    const aircraftId = this.getAircraftId();
    this.cameraSystem?.setCockpitUserOffset?.(x, y, z, aircraftId);
    this.updateOutputs();
  }

  resetToDefaults() {
    const aircraftId = this.getAircraftId();
    this.cameraSystem?.resetCockpitUserOffset?.(aircraftId);
    if (this.sliderX) this.sliderX.value = '0';
    if (this.sliderY) this.sliderY.value = '0';
    if (this.sliderZ) this.sliderZ.value = '0';
    this.updateOutputs();
  }

  renderPreview(sourceCanvas) {
    if (!this.isOpen || !this.previewCanvas || !this.previewCtx || !sourceCanvas) return;
    const destW = this.previewCanvas.width;
    const destH = this.previewCanvas.height;
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    if (!srcW || !srcH || !destW || !destH) return;

    try {
      this.previewCtx.drawImage(sourceCanvas, 0, 0, srcW, srcH, 0, 0, destW, destH);
    } catch {}
  }

  open() {
    if (!this.dialog) return;

    const hasHeldSortie = Boolean(this.simulator?.gameFlow?.canResumeFromLobby?.());
    const aircraftId = this.getAircraftId();

    // Only switch the live simulation airframe when we are in a fresh lobby without a held sortie
    if (!hasHeldSortie && typeof this.simulator?.setAircraft === 'function' && this.simulator.currentAircraftId !== aircraftId) {
      this.simulator.setAircraft(aircraftId);
    }

    // Load offset for chosen aircraft
    this.cameraSystem?.loadCockpitUserOffset?.(aircraftId);

    this.isOpen = true;
    this.dialog.removeAttribute('hidden');
    this.dialog.hidden = false;
    if (typeof this.dialog.showModal === 'function' && !this.dialog.open) {
      try { this.dialog.showModal(); } catch { this.dialog.setAttribute('open', ''); }
    } else {
      this.dialog.setAttribute('open', '');
    }
    this.lobbyBtn?.setAttribute('aria-expanded', 'true');

    this.updateTitle();

    const startMode = typeof this.cameraSystem?.getPreferredStartMode === 'function'
      ? this.cameraSystem.getPreferredStartMode()
      : CameraSystem.MODES.CHASE;
    if (this.startModeSelect) this.startModeSelect.value = String(startMode);

    // Save prior camera selection state before switching to cockpit for preview
    if (this.cameraSystem) {
      this.savedCameraMode = this.cameraSystem.mode;
      this.savedUserModeSelected = this.cameraSystem.userModeSelected;
      this.savedAutoSwitch = this.cameraSystem.autoSwitch;
      this.savedCustomViewUpdater = this.cameraSystem.customViewUpdater;
      if (typeof this.cameraSystem.setMode === 'function') {
        // Use isUserAction=true to bypass userModeSelected guard and enter cockpit view
        this.cameraSystem.setMode(CameraSystem.MODES.COCKPIT, true);
      }
    }

    this.syncFromCamera();
    this.updateOutputs();
  }

  close() {
    if (!this.dialog) return;
    this.isOpen = false;
    this.dialog.hidden = true;
    this.dialog.setAttribute('hidden', '');
    if (typeof this.dialog.close === 'function' && this.dialog.open) {
      try { this.dialog.close(); } catch { this.dialog.removeAttribute('open'); }
    } else {
      this.dialog.removeAttribute('open');
    }
    this.lobbyBtn?.setAttribute('aria-expanded', 'false');

    // Restore prior camera mode and selection state
    if (this.cameraSystem && this.savedCameraMode !== null) {
      if (typeof this.cameraSystem.setMode === 'function') {
        this.cameraSystem.setMode(this.savedCameraMode, true);
      }
      if (this.savedUserModeSelected !== null && this.savedUserModeSelected !== undefined) {
        this.cameraSystem.userModeSelected = this.savedUserModeSelected;
      }
      if (this.savedAutoSwitch !== null && this.savedAutoSwitch !== undefined) {
        this.cameraSystem.autoSwitch = this.savedAutoSwitch;
      }
      if (this.savedCustomViewUpdater !== undefined) {
        this.cameraSystem.customViewUpdater = this.savedCustomViewUpdater;
      }
      this.savedCameraMode = null;
      this.savedUserModeSelected = null;
      this.savedAutoSwitch = null;
      this.savedCustomViewUpdater = null;
    }

    this.updateLobbyButtonLabel();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
