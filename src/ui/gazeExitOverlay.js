import * as THREE from 'three';
import { t } from '../i18n/index.js';

const projectedPos = new THREE.Vector3();

const TARGET_GAP_PX = 24;
const EDGE_MARGIN_X = 12;
const EDGE_MARGIN_TOP = 56;
const EDGE_MARGIN_BOTTOM = 16;
const DEFAULT_BUTTON_WIDTH = 140;
const DEFAULT_BUTTON_HEIGHT = 32;

function resolveViewport(cameraSystem, explicitViewport) {
  if (explicitViewport && explicitViewport.width > 0 && explicitViewport.height > 0) {
    return {
      left: explicitViewport.left ?? 0,
      top: explicitViewport.top ?? 0,
      width: explicitViewport.width,
      height: explicitViewport.height,
    };
  }
  const rect = cameraSystem?.domElement?.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return null;
}

/**
 * Compute the viewport pixel position for the gaze-exit button right next to
 * the projected 3D gaze target, flipping sides near the right edge and
 * clamping inside safe viewport bounds.
 */
export function computeGazeExitScreenPosition({
  cameraSystem,
  viewport = null,
  buttonWidth = DEFAULT_BUTTON_WIDTH,
  buttonHeight = DEFAULT_BUTTON_HEIGHT,
  gapPx = TARGET_GAP_PX,
} = {}) {
  const vp = resolveViewport(cameraSystem, viewport);
  if (!vp) return null;

  let targetX = vp.left + vp.width * 0.5;
  let targetY = vp.top + vp.height * 0.5;

  const worldPos = typeof cameraSystem?.getGazeTargetPosition === 'function'
    ? cameraSystem.getGazeTargetPosition()
    : null;
  const camera = cameraSystem?.camera;

  if (worldPos && camera && typeof camera.projectionMatrix !== 'undefined') {
    camera.updateMatrixWorld?.();
    projectedPos.copy(worldPos).project(camera);
    if (
      Number.isFinite(projectedPos.x)
      && Number.isFinite(projectedPos.y)
      && Number.isFinite(projectedPos.z)
      && projectedPos.z >= -1
      && projectedPos.z <= 1
    ) {
      targetX = vp.left + (projectedPos.x + 1) * 0.5 * vp.width;
      targetY = vp.top + (1 - projectedPos.y) * 0.5 * vp.height;
    }
  }

  const btnW = buttonWidth > 0 ? buttonWidth : DEFAULT_BUTTON_WIDTH;
  const btnH = buttonHeight > 0 ? buttonHeight : DEFAULT_BUTTON_HEIGHT;

  const minLeft = vp.left + EDGE_MARGIN_X;
  const maxLeft = Math.max(minLeft, vp.left + vp.width - EDGE_MARGIN_X - btnW);
  const preferRight = targetX + gapPx;
  const rawLeft = preferRight <= maxLeft ? preferRight : targetX - gapPx - btnW;
  const left = Math.min(maxLeft, Math.max(minLeft, rawLeft));

  const minTop = vp.top + EDGE_MARGIN_TOP;
  const maxTop = Math.max(minTop, vp.top + vp.height - EDGE_MARGIN_BOTTOM - btnH);
  const rawTop = targetY - btnH * 0.5;
  const top = Math.min(maxTop, Math.max(minTop, rawTop));

  return {
    left: Math.round(left),
    top: Math.round(top),
    targetX,
    targetY,
  };
}

/**
 * Synchronize `#btn-gaze-exit` visibility, target label, and screen position
 * right beside the active gaze target.
 */
export function syncGazeExitButton(cameraSystem) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btn-gaze-exit');
  if (!btn) return;

  const gazeActive = Boolean(
    cameraSystem
    && typeof cameraSystem.isGazeActive === 'function'
    && cameraSystem.isGazeActive(),
  );
  btn.hidden = !gazeActive;
  if (!gazeActive) {
    if (btn.style) {
      if (btn.style.left) btn.style.left = '';
      if (btn.style.top) btn.style.top = '';
    }
    return;
  }

  const labelEl = document.getElementById('gaze-exit-label');
  const targetLabel = typeof cameraSystem.getGazeTargetLabel === 'function'
    ? cameraSystem.getGazeTargetLabel()
    : '';
  if (labelEl) {
    const nextLabel = targetLabel ? t('gaze.exit.target', { target: targetLabel }) : t('gaze.exit');
    if (labelEl.textContent !== nextLabel) labelEl.textContent = nextLabel;
  }

  if (!btn.style) return;
  const rect = typeof btn.getBoundingClientRect === 'function' ? btn.getBoundingClientRect() : null;
  const buttonWidth = btn.offsetWidth || rect?.width || DEFAULT_BUTTON_WIDTH;
  const buttonHeight = btn.offsetHeight || rect?.height || DEFAULT_BUTTON_HEIGHT;
  const pos = computeGazeExitScreenPosition({ cameraSystem, buttonWidth, buttonHeight });
  if (!pos) return;

  const leftPx = `${pos.left}px`;
  const topPx = `${pos.top}px`;
  if (btn.style.left !== leftPx) btn.style.left = leftPx;
  if (btn.style.top !== topPx) btn.style.top = topPx;
}
