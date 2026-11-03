/**
 * Dynamic Resolution-Based UI Scale Controller
 *
 * Automatically computes an ergonomic scale multiplier (--ui-scale) on high-resolution
 * desktop displays (e.g. 1080p, 1440p, 4K, 5K) so menus, telemetry strips, buttons, and text
 * remain clearly legible and comfortable to read and interact with from normal desk distance.
 *
 * Sizing rules:
 * - Mobile / tablet displays (width <= 1024px) remain at 1.0 baseline to preserve existing
 *   compact-ui / touch layouts.
 * - Sized proportionally to viewport height & width:
 *   - 1080p (1920x1080): ~1.25x (giving comfortable ~10px labels, ~16px metrics)
 *   - 1440p QHD (2560x1440): ~1.667x (giving crisp ~13px labels, ~22px metrics)
 *   - 4K UHD (3840x2160): ~2.5x (giving sharp ~20px labels, ~33px metrics)
 * - Constrained by the minimum dimension ratio (width vs height) so ultra-wide
 *   (21:9 / 32:9) monitors do not blow out vertical space.
 * - Clamped between 1.0 and 2.8.
 */

export const BASE_VIEWPORT_WIDTH = 1536;
export const BASE_VIEWPORT_HEIGHT = 864;
export const MAX_UI_SCALE = 2.8;
export const MIN_UI_SCALE = 1.0;

export function computeUiScale(width = (typeof window !== 'undefined' ? window.innerWidth : 1920), height = (typeof window !== 'undefined' ? window.innerHeight : 1080)) {
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return MIN_UI_SCALE;
  }
  // Mobile and tablet viewports use compact-ui and touch-controls; keep baseline 1.0
  if (width <= 1024) {
    return MIN_UI_SCALE;
  }

  const scaleByWidth = width / BASE_VIEWPORT_WIDTH;
  const scaleByHeight = height / BASE_VIEWPORT_HEIGHT;
  // Use the smaller dimension ratio so ultra-wide monitors do not blow out vertical space
  const targetScale = Math.min(scaleByWidth, scaleByHeight);

  if (targetScale <= MIN_UI_SCALE) {
    return MIN_UI_SCALE;
  }

  const clamped = Math.min(targetScale, MAX_UI_SCALE);
  // Round to 3 decimal places for stability and clean CSS serialization
  return Math.round(clamped * 1000) / 1000;
}

export function applyUiScale(scale, root = (typeof document !== 'undefined' ? document.documentElement : null)) {
  if (!root || !root.style) return;
  root.style.setProperty('--ui-scale', String(scale));
}

export function initUiScale(windowObj = (typeof window !== 'undefined' ? window : null)) {
  if (!windowObj) return () => {};

  const update = () => {
    const scale = computeUiScale(windowObj.innerWidth, windowObj.innerHeight);
    applyUiScale(scale, windowObj.document?.documentElement);
  };

  update();
  windowObj.addEventListener('resize', update, { passive: true });
  return update;
}
