import { t } from '../i18n/index.js';

/**
 * Cockpit POV (Eyepoint) Adjustment Panel.
 * Provides user adjustment controls (X lateral, Y vertical, Z fore-aft)
 * strictly for the cockpit camera view.
 */
export class CockpitPovPanel {
  constructor(simulator) {
    this.simulator = simulator;
    this.cameraSystem = simulator?.cameraSystem || simulator;
    this.controls = simulator?.controls || null;

    this.panel = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-panel') : null;
    this.toggleBtn = typeof document !== 'undefined' ? document.getElementById('btn-cockpit-pov') : null;
    this.moreToggleBtn = typeof document !== 'undefined' ? document.getElementById('btn-open-cockpit-pov') : null;
    this.closeBtn = typeof document !== 'undefined' ? document.getElementById('btn-cockpit-pov-close') : null;
    this.resetBtn = typeof document !== 'undefined' ? document.getElementById('btn-cockpit-pov-reset') : null;

    this.sliderY = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-y') : null;
    this.outputY = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-y-val') : null;
    this.sliderZ = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-z') : null;
    this.outputZ = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-z-val') : null;
    this.sliderX = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-x') : null;
    this.outputX = typeof document !== 'undefined' ? document.getElementById('cockpit-pov-x-val') : null;

    this.initBindings();
  }

  initBindings() {
    if (!this.panel) return;

    this.toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.moreToggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.closeBtn?.addEventListener('click', () => {
      this.close();
    });

    this.resetBtn?.addEventListener('click', () => {
      this.reset();
    });

    const handleSliderInput = () => {
      const x = parseFloat(this.sliderX?.value || '0');
      const y = parseFloat(this.sliderY?.value || '0');
      const z = parseFloat(this.sliderZ?.value || '0');
      this.cameraSystem?.setCockpitUserOffset?.(x, y, z);
      this.updateOutputs();
    };

    this.sliderX?.addEventListener('input', handleSliderInput);
    this.sliderY?.addEventListener('input', handleSliderInput);
    this.sliderZ?.addEventListener('input', handleSliderInput);

    // Isolate slider & button keyboard interactions from flight controls (keydown only).
    // keyup is permitted to propagate to window so any flight control keys released
    // while interacting with the panel are cleanly cleared by FlightControls.handleKeyUp.
    const stopFlightKeyPropagation = (e) => {
      if (e.key === 'Escape') return; // Allow Escape to dismiss panel
      e.stopPropagation();
    };
    this.panel.addEventListener('keydown', stopFlightKeyPropagation);

    // Drop held keys when switching focus or pointer interaction into the adjustment panel
    this.panel.addEventListener('pointerdown', () => this.controls?.releaseAllKeys?.());
    this.panel.addEventListener('focusin', () => this.controls?.releaseAllKeys?.());

    // Step buttons (+ / -)
    const stepButtons = this.panel.querySelectorAll('.cockpit-pov-step');
    for (const btn of stepButtons) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const axis = btn.dataset.axis;
        const dir = parseInt(btn.dataset.dir, 10) || 1;
        this.stepAxis(axis, dir);
      });
    }

    if (this.cameraSystem) {
      this.cameraSystem.onCockpitUserOffsetChange = () => {
        this.syncFromCamera();
      };
    }

    // Dismiss on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        this.close();
      }
    });

    this.syncFromCamera();
  }

  isOpen() {
    return Boolean(this.panel && !this.panel.hidden);
  }

  open() {
    if (!this.panel) return;
    // Strictly available in cockpit view
    if (this.cameraSystem && this.cameraSystem.mode !== 0) return;

    this.controls?.releaseAllKeys?.();
    this.panel.hidden = false;
    this.toggleBtn?.setAttribute('aria-expanded', 'true');
    this.moreToggleBtn?.setAttribute('aria-expanded', 'true');
    this.syncFromCamera();
  }

  close() {
    if (!this.panel) return;
    this.panel.hidden = true;
    this.toggleBtn?.setAttribute('aria-expanded', 'false');
    this.moreToggleBtn?.setAttribute('aria-expanded', 'false');
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  stepAxis(axis, dir) {
    const slider = axis === 'x' ? this.sliderX : axis === 'y' ? this.sliderY : this.sliderZ;
    if (!slider) return;

    const step = parseFloat(slider.step) || 0.01;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let val = parseFloat(slider.value) || 0;

    val += dir * step * 2; // Step by 2 increments (0.01m)
    val = Math.max(min, Math.min(max, Math.round(val * 1000) / 1000));
    slider.value = String(val);

    const x = parseFloat(this.sliderX?.value || '0');
    const y = parseFloat(this.sliderY?.value || '0');
    const z = parseFloat(this.sliderZ?.value || '0');
    this.cameraSystem?.setCockpitUserOffset?.(x, y, z);
    this.updateOutputs();
  }

  reset() {
    this.cameraSystem?.resetCockpitUserOffset?.();
    if (this.sliderX) this.sliderX.value = '0';
    if (this.sliderY) this.sliderY.value = '0';
    if (this.sliderZ) this.sliderZ.value = '0';
    this.updateOutputs();
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

    if (this.outputY) {
      if (Math.abs(y) < 0.001) {
        this.outputY.textContent = '0.00 m';
      } else {
        const sign = y > 0 ? '+' : '';
        const tag = y > 0 ? t('ui.cockpitPov.up') : t('ui.cockpitPov.down');
        this.outputY.textContent = `${sign}${(y * 100).toFixed(0)}cm (${tag})`;
      }
    }

    if (this.outputZ) {
      if (Math.abs(z) < 0.001) {
        this.outputZ.textContent = '0.00 m';
      } else {
        // -z is forward/closer to HUD, +z is aft/farther
        const tag = z < 0 ? t('ui.cockpitPov.fwd') : t('ui.cockpitPov.aft');
        const cm = Math.abs(z * 100).toFixed(0);
        this.outputZ.textContent = `${cm}cm (${tag})`;
      }
    }

    if (this.outputX) {
      if (Math.abs(x) < 0.001) {
        this.outputX.textContent = '0.00 m';
      } else {
        const tag = x < 0 ? t('ui.cockpitPov.left') : t('ui.cockpitPov.right');
        const cm = Math.abs(x * 100).toFixed(0);
        this.outputX.textContent = `${cm}cm (${tag})`;
      }
    }
  }

  /**
   * Called when camera mode changes to ensure panel is closed
   * and buttons are hidden outside cockpit view.
   */
  updateMode(mode) {
    const isCockpit = mode === 0; // CameraSystem.MODES.COCKPIT
    if (this.toggleBtn) this.toggleBtn.hidden = !isCockpit;
    if (this.moreToggleBtn) this.moreToggleBtn.hidden = !isCockpit;
    if (!isCockpit && this.isOpen()) {
      this.close();
    }
  }
}
