/**
 * Visual effects for pilot physiology (Blackout, Redout, Tunnel Vision, Grayout).
 *
 * Implements:
 * - Positive G: Tunnel Vision (radial vignette constriction) -> Grayout (desaturation) -> Blackout (darkening to black).
 * - Negative G: Redout (red tint & vignette encroachment) + peripheral blur.
 * - Viewport scaling: 100% intensity in cockpit 1st-person view, 25% intensity in exterior 3rd-person view.
 */

import { CameraSystem } from '../cameras/CameraSystem.js';

export class PilotPhysiologyFx {
  constructor(domElement = null) {
    this.domElement = domElement;
    this.element = null;
    this.grayoutLayer = null;
    this.tunnelLayer = null;
    this.redoutLayer = null;

    this.tunnelRatio = 0.0;
    this.grayoutAlpha = 0.0;
    this.blackoutAlpha = 0.0;
    this.redoutAlpha = 0.0;
    this.blurPx = 0.0;
    this.viewScale = 1.0;

    if (this.domElement) {
      this.initDom();
    }
  }

  initDom() {
    if (this.element || !this.domElement) return;

    const el = document.createElement('div');
    el.id = 'pilot-g-effects';
    el.className = 'pilot-g-effects';
    el.setAttribute('aria-hidden', 'true');

    el.innerHTML = `
      <div class="pilot-g-grayout-blur"></div>
      <div class="pilot-g-tunnel-blackout"></div>
      <div class="pilot-g-redout"></div>
    `;

    this.element = el;
    this.grayoutLayer = el.querySelector('.pilot-g-grayout-blur');
    this.tunnelLayer = el.querySelector('.pilot-g-tunnel-blackout');
    this.redoutLayer = el.querySelector('.pilot-g-redout');

    this.domElement.appendChild(el);
  }

  reset() {
    this.tunnelRatio = 0.0;
    this.grayoutAlpha = 0.0;
    this.blackoutAlpha = 0.0;
    this.redoutAlpha = 0.0;
    this.blurPx = 0.0;

    if (this.element) {
      this.element.classList.remove('active');
      this.element.style.removeProperty('--tunnel-inner');
      this.element.style.removeProperty('--tunnel-outer');
      this.element.style.removeProperty('--blackout-edge');
      this.element.style.removeProperty('--blackout-outer');
      this.element.style.removeProperty('--blackout-fill');
      this.element.style.removeProperty('--g-grayout');
      this.element.style.removeProperty('--g-blur');
      this.element.style.removeProperty('--redout-opacity');
      this.element.style.removeProperty('--redout-center');
      this.element.style.removeProperty('--redout-edge');
      this.element.style.removeProperty('--redout-outer');
    }
  }

  /**
   * Update visual effects on each animation frame.
   *
   * @param {string} cameraMode Current camera mode ('cockpit', 'chase', 'orbit', 'hud', etc.)
   * @param {Object} pilotSnapshot Physiological snapshot from PilotPhysiology
   */
  update(cameraMode, pilotSnapshot = {}) {
    const isCockpit = cameraMode === 'cockpit' || cameraMode === 'hud' ||
      cameraMode === CameraSystem.MODES?.COCKPIT || cameraMode === CameraSystem.MODES?.HUD ||
      cameraMode === 0 || cameraMode === 8;
    // 100% intensity in cockpit 1st-person view, 25% intensity in external 3rd-person view
    this.viewScale = isCockpit ? 1.0 : 0.25;

    const c = Number.isFinite(pilotSnapshot.consciousness) ? pilotSnapshot.consciousness : 1.0;
    const gZ = Number.isFinite(pilotSnapshot.gZ) ? pilotSnapshot.gZ : 1.0;
    const isGLOC = Boolean(pilotSnapshot.isGLOC);

    // 1. Positive G: Tunnel Vision, Grayout, Blackout
    this.tunnelRatio = Math.max(0.0, Math.min(1.0, (1.0 - c) * 1.3));
    const rawGrayout = isGLOC ? 1.0 : (c < 0.8 ? Math.min(1.0, (0.8 - c) / 0.5) : 0.0);
    this.grayoutAlpha = Math.max(0.0, Math.min(1.0, rawGrayout * this.viewScale));

    const rawBlackout = isGLOC ? 1.0 : (c < 0.4 ? Math.min(1.0, (0.4 - c) / 0.4) : 0.0);
    this.blackoutAlpha = Math.max(0.0, Math.min(1.0, rawBlackout * this.viewScale));

    // Tunnel Vision vignette inner and outer radiuses
    // In cockpit (viewScale = 1.0), tunnel vision constricts down towards 8.5%.
    // In exterior view (viewScale = 0.25), constriction and opacity are attenuated so the center remains open.
    const effectiveTunnel = this.tunnelRatio * this.viewScale;
    const innerRadius = Math.max(0, (1.0 - effectiveTunnel * 0.9) * 85);
    const outerRadius = Math.max(innerRadius + 5, innerRadius + (45 * (1.0 - effectiveTunnel * 0.45)));

    // 2. Negative G: Redout & Peripheral Blur
    if (gZ < -1.0) {
      const excessNegG = -gZ - 1.0;
      const rawRedout = Math.min(1.0, (excessNegG / 2.5) + (1.0 - c) * 0.6);
      this.redoutAlpha = Math.max(0.0, Math.min(1.0, rawRedout * this.viewScale));
      this.blurPx = this.redoutAlpha * 8.0;
    } else {
      this.redoutAlpha = 0.0;
      this.blurPx = 0.0;
    }

    const hasEffect = this.blackoutAlpha > 0.01 || effectiveTunnel > 0.05 ||
      this.grayoutAlpha > 0.01 || this.redoutAlpha > 0.01;

    if (!this.element) return;

    if (hasEffect) {
      this.element.classList.add('active');
      const edgeAlpha = Math.min(1.0, 0.85 * (effectiveTunnel + this.blackoutAlpha));
      const outerAlpha = Math.min(1.0, effectiveTunnel * 1.3 + this.blackoutAlpha);

      this.element.style.setProperty('--tunnel-inner', `${innerRadius.toFixed(1)}%`);
      this.element.style.setProperty('--tunnel-outer', `${outerRadius.toFixed(1)}%`);
      this.element.style.setProperty('--blackout-edge', edgeAlpha.toFixed(3));
      this.element.style.setProperty('--blackout-outer', outerAlpha.toFixed(3));
      this.element.style.setProperty('--blackout-fill', this.blackoutAlpha.toFixed(3));
      this.element.style.setProperty('--g-grayout', this.grayoutAlpha.toFixed(3));
      this.element.style.setProperty('--g-blur', `${this.blurPx.toFixed(1)}px`);
      this.element.style.setProperty('--redout-opacity', this.redoutAlpha.toFixed(3));
      this.element.style.setProperty('--redout-center', (0.35 * this.redoutAlpha).toFixed(3));
      this.element.style.setProperty('--redout-edge', (0.85 * this.redoutAlpha).toFixed(3));
      this.element.style.setProperty('--redout-outer', (0.95 * this.redoutAlpha).toFixed(3));
    } else {
      this.element.classList.remove('active');
    }
  }

  dispose() {
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
    this.grayoutLayer = null;
    this.tunnelLayer = null;
    this.redoutLayer = null;
  }
}
