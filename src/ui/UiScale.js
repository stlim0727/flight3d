/**
 * Dynamic Resolution-Based UI Scale Controller
 *
 * Automatically computes an ergonomic scale multiplier (--ui-scale) on high-resolution
 * desktop displays (e.g. 1440p, 4K, 5K) so menus, telemetry strips, buttons, and text
 * remain legible and comfortable to interact with.
 *
 * Sizing rules:
 * - 1920x1080 (1080p desktop) is the baseline (scale = 1.0).
 * - Mobile / tablet displays (width <= 1024px) or viewports smaller than 1080p remain at 1.0
 *   to preserve existing compact-ui / touch layouts.
 * - On higher resolutions (1440p -> ~1.333, 4K -> 2.0), scale smoothly with the viewport.
 * - Uses the minimum of width/1920 and height/1080 to prevent oversized elements on ultra-wide
 *   (21:9 / 32:9) or tall aspect ratios.
 * - Clamped to a maximum of 2.25 to prevent extreme blowout on 5K/8K displays.
 */

export const BASE_VIEWPORT_WIDTH = 1920;
export const BASE_VIEWPORT_HEIGHT = 1080;
export const MAX_UI_SCALE = 2.25;
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
