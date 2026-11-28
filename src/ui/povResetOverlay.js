const EDGE_MARGIN_LEFT = 14;
const EDGE_MARGIN_RIGHT = 14;
const EDGE_MARGIN_TOP = 58;
const EDGE_MARGIN_BOTTOM = 18;
const DEFAULT_BUTTON_SIZE = 36;

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
 * Compute the viewport pixel position for the small POV-reset arrow button
 * anchored along the screen edge in the direction of the default POV.
 *
 * Angle convention matches `CameraSystem.getPovIndicatorAngle()`:
 *   0° = up (top edge), +90° = right (right edge),
 *  -90° = left (left edge), ±180° = down (bottom edge).
 */
export function computePovResetEdgePosition({
  angleDeg = 0,
  cameraSystem = null,
  viewport = null,
  buttonWidth = DEFAULT_BUTTON_SIZE,
  buttonHeight = DEFAULT_BUTTON_SIZE,
} = {}) {
  const vp = resolveViewport(cameraSystem, viewport);
  if (!vp) return null;

  const btnW = buttonWidth > 0 ? buttonWidth : DEFAULT_BUTTON_SIZE;
  const btnH = buttonHeight > 0 ? buttonHeight : DEFAULT_BUTTON_SIZE;

  const minX = vp.left + EDGE_MARGIN_LEFT;
  const maxX = Math.max(minX + btnW, vp.left + vp.width - EDGE_MARGIN_RIGHT);
  const minY = vp.top + EDGE_MARGIN_TOP;
  const maxY = Math.max(minY + btnH, vp.top + vp.height - EDGE_MARGIN_BOTTOM);

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const rx = Math.max(0, (maxX - minX - btnW) * 0.5);
  const ry = Math.max(0, (maxY - minY - btnH) * 0.5);

  const rad = (Number.isFinite(angleDeg) ? angleDeg : 0) * (Math.PI / 180);
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);

  const tx = Math.abs(dx) > 1e-6 ? rx / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? ry / Math.abs(dy) : Infinity;
  const dist = Number.isFinite(Math.min(tx, ty)) ? Math.min(tx, ty) : 0;

  const centerX = cx + dx * dist;
  const centerY = cy + dy * dist;

  return {
    left: Math.round(centerX - btnW * 0.5),
    top: Math.round(centerY - btnH * 0.5),
    angleDeg: Number.isFinite(angleDeg) ? angleDeg : 0,
  };
}

/**
 * Synchronize `#btn-reset-pov` visibility, arrow rotation, and screen-edge
 * placement pointing toward the default forward POV.
 */
export function syncPovResetButton(cameraSystem) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const btn = document.getElementById('btn-reset-pov');
  if (!btn) return;

  const isModified = Boolean(
    cameraSystem
    && typeof cameraSystem.isPovModified === 'function'
    && cameraSystem.isPovModified(),
  );
  const gazeActive = Boolean(
    cameraSystem
    && typeof cameraSystem.isGazeActive === 'function'
    && cameraSystem.isGazeActive(),
  );
  const visible = isModified && !gazeActive;
  btn.hidden = !visible;

  if (!visible) {
    if (btn.style) {
      if (btn.style.left) btn.style.left = '';
      if (btn.style.top) btn.style.top = '';
    }
    return;
  }

  const angle = typeof cameraSystem.getPovIndicatorAngle === 'function'
    ? cameraSystem.getPovIndicatorAngle()
    : 0;
  const arrow = document.getElementById('pov-arrow-icon');
  if (arrow?.style) {
    const rot = `rotate(${angle.toFixed(1)}deg)`;
    if (arrow.style.transform !== rot) arrow.style.transform = rot;
  }

  if (!btn.style) return;
  const rect = typeof btn.getBoundingClientRect === 'function' ? btn.getBoundingClientRect() : null;
  const buttonWidth = btn.offsetWidth || rect?.width || DEFAULT_BUTTON_SIZE;
  const buttonHeight = btn.offsetHeight || rect?.height || DEFAULT_BUTTON_SIZE;
  const pos = computePovResetEdgePosition({
    angleDeg: angle,
    cameraSystem,
    buttonWidth,
    buttonHeight,
  });
  if (!pos) return;

  const leftPx = `${pos.left}px`;
  const topPx = `${pos.top}px`;
  if (btn.style.left !== leftPx) btn.style.left = leftPx;
  if (btn.style.top !== topPx) btn.style.top = topPx;
}
