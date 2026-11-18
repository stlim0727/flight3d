/**
 * Determine if an event target is an interactive UI control or on-screen touch flight control
 * that should NOT trigger camera look-around dragging.
 */
export function isInteractiveUI(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(
    '#pilot-arena, #pilot-score-overlay, #feedback-dialog-overlay, .flight-panel, .flight-toolbar, dialog, button, a, input, select, .btn, .modal-card, .presets-bar, .action-panel, .mobile-menu, .hud-strip, #demo-banner, .toast, .stall-banner, .touch-quadrant, .touch-card-header, .touch-throttle-card, .touch-stick-card, .touch-rudder-card, .btn-touch-pill, .btn-touch-brake, .demo-pill-btn, #btn-reset-pov, .btn-reset-pov, #btn-cockpit-pov, .btn-cockpit-pov, #cockpit-pov-panel, .cockpit-pov-panel, #btn-gaze-exit, .btn-gaze-exit, #help-modal, #demo-restart-dialog, #diagnostics-overlay, .menu-backdrop, .debrief-overlay'
  );
}

export function initMouseLook(cs) {
  if (!cs.domElement && typeof window === 'undefined') return;

  if (cs.domElement && cs.domElement.style) {
    cs.domElement.style.cursor = 'grab';
    cs.domElement.style.touchAction = 'none';
  }

  const onMouseDown = (e) => {
    if (cs.activeTouchId !== null) return;
    if (isInteractiveUI(e.target)) return;
    if (e.button === 0 || e.button === 2) {
      cs.isDragging = true;
      cs.prevMouse.x = e.clientX;
      cs.prevMouse.y = e.clientY;
      if (e.button === 0 && !cs.pointerLocked) {
        cs._mouseDownClient = { x: e.clientX, y: e.clientY, button: 0 };
        cs._mouseMoved = false;
      }
      if (cs.domElement && cs.domElement.style) {
        cs.domElement.style.cursor = 'grabbing';
      }
    } else if (e.button === 1) {
      cs.togglePointerLock();
      if (e.preventDefault) e.preventDefault();
    }
  };

  if (cs.domElement && typeof cs.domElement.addEventListener === 'function') {
    cs.domElement.addEventListener('mousedown', onMouseDown);
    cs.domElement.addEventListener('touchstart', (e) => cs.handleTouchStart(e), { passive: false });
    cs.domElement.addEventListener('wheel', (e) => {
      if (cs.usesOpticalZoom()) {
        cs.zoomOpticalBy(Math.exp(-e.deltaY * 0.0015));
      }
    }, { passive: true });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('mouseup', (e) => {
      if (cs.activeTouchId !== null) return;
      const wasDragging = cs.isDragging;
      cs.isDragging = false;
      if (cs.domElement && cs.domElement.style && !cs.pointerLocked) {
        cs.domElement.style.cursor = 'grab';
      }
      if (
        wasDragging
        && !cs.pointerLocked
        && cs._mouseDownClient.button === 0
        && !cs._mouseMoved
        && (!e || e.button === 0)
        && !isInteractiveUI(e?.target)
      ) {
        const dist = e ? Math.hypot(e.clientX - cs._mouseDownClient.x, e.clientY - cs._mouseDownClient.y) : Infinity;
        if (dist <= 6) {
          cs.handleCanvasTap(e.clientX, e.clientY);
        }
      }
      cs._mouseDownClient.button = -1;
      cs._mouseMoved = false;
    });

    window.addEventListener('contextmenu', (e) => {
      if (e.target === cs.domElement || (e.target && e.target.id === 'canvas-container') || (e.target && !isInteractiveUI(e.target))) {
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (cs.activeTouchId !== null) return;
      cs.setCursorPosition(e.clientX, e.clientY);

      if (cs.isDragging || cs.pointerLocked) {
        if (cs.isDragging && !cs.pointerLocked && cs._mouseDownClient.button === 0) {
          if (Math.hypot(e.clientX - cs._mouseDownClient.x, e.clientY - cs._mouseDownClient.y) > 6) {
            cs._mouseMoved = true;
          }
        }
        const dx = cs.pointerLocked && typeof e.movementX === 'number' ? e.movementX : (e.clientX - cs.prevMouse.x);
        const dy = cs.pointerLocked && typeof e.movementY === 'number' ? e.movementY : (e.clientY - cs.prevMouse.y);
        cs.prevMouse.x = e.clientX;
        cs.prevMouse.y = e.clientY;

        if (cs.pointerLocked) cs.applyMouseDelta(dx, dy, false);
        else cs.applyDragDelta(dx, dy, false);
      } else {
        cs.prevMouse.x = e.clientX;
        cs.prevMouse.y = e.clientY;
      }
    });

    window.addEventListener('touchstart', (e) => cs.handleTouchStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => cs.handleTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => cs.handleTouchEnd(e), { passive: false });
    window.addEventListener('touchcancel', (e) => cs.handleTouchEnd(e), { passive: false });

    window.addEventListener('blur', () => {
      cs.isDragging = false;
      cs.activeTouchId = null;
      cs.isPinching = false;
      if (cs.domElement && cs.domElement.style && !cs.pointerLocked) {
        cs.domElement.style.cursor = 'grab';
      }
    });

    window.addEventListener('mouseleave', () => {
      cs.targetCursorNormX = 0;
      cs.targetCursorNormY = 0;
    });

    window.addEventListener('dblclick', (e) => {
      if (isInteractiveUI(e.target)) return;
      cs.resetLook();
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('pointerlockchange', () => {
      cs.pointerLocked = (document.pointerLockElement === cs.domElement);
      if (cs.domElement && cs.domElement.style) {
        cs.domElement.style.cursor = cs.pointerLocked ? 'none' : 'grab';
      }
    });
  }
}

export function handleTouchStart(cs, e) {
  if (!e || e._camHandled) return;
  const touches = e.touches ? Array.from(e.touches) : [];
  const cameraTouches = touches.filter(t => !isInteractiveUI(t.target));
  if (cameraTouches.length === 0) return;
  e._camHandled = true;

  if (cameraTouches.length >= 2) {
    const t0 = cameraTouches[0];
    const t1 = cameraTouches[1];
    cs.pinchDistance = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    cs.isPinching = true;
    cs.touchMoved = true;
    cs.activeTouchId = null;
    cs.isDragging = false;
    cs.lastTapTime = 0;
    if (typeof e.preventDefault === 'function' && e.cancelable) {
      e.preventDefault();
    }
    return;
  }

  const touch = cameraTouches[0];
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const dist = Math.hypot(touch.clientX - cs.lastTapPos.x, touch.clientY - cs.lastTapPos.y);

  if (cs.lastTapTime > 0 && (now - cs.lastTapTime < 350) && dist < 50) {
    cs.resetLook();
    if (typeof cs.onResetLook === 'function') {
      cs.onResetLook();
    }
    cs.lastTapTime = 0;
    cs.activeTouchId = null;
    cs.isDragging = false;
    cs.touchMoved = false;
    if (typeof e.preventDefault === 'function' && e.cancelable) {
      e.preventDefault();
    }
    return;
  }

  cs.lastTapTime = now;
  cs.lastTapPos = { x: touch.clientX, y: touch.clientY };

  cs.activeTouchId = touch.identifier;
  cs.isDragging = true;
  cs.isPinching = false;
  cs.touchStartX = touch.clientX;
  cs.touchStartY = touch.clientY;
  cs.touchMoved = false;
  cs.prevMouse.x = touch.clientX;
  cs.prevMouse.y = touch.clientY;
  cs.setCursorPosition(touch.clientX, touch.clientY);

  if (typeof e.preventDefault === 'function' && e.cancelable) {
    e.preventDefault();
  }
}

export function handleTouchMove(cs, e) {
  if (!e) return;
  const touches = e.touches ? Array.from(e.touches) : [];
  const cameraTouches = touches.filter(t => !isInteractiveUI(t.target));

  if (cs.isPinching) {
    cs.lastTapTime = 0;
    if (cameraTouches.length >= 2) {
      const t0 = cameraTouches[0];
      const t1 = cameraTouches[1];
      const currentDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const deltaDist = currentDist - cs.pinchDistance;
      cs.pinchDistance = currentDist;
      cs.applyPinchZoom(deltaDist);
      if (typeof e.preventDefault === 'function' && e.cancelable) {
        e.preventDefault();
      }
    }
    return;
  }

  if (cs.activeTouchId !== null && cs.isDragging) {
    const touch = cameraTouches.find(t => t.identifier === cs.activeTouchId);
    if (touch) {
      const moveDist = Math.hypot(touch.clientX - cs.touchStartX, touch.clientY - cs.touchStartY);
      if (moveDist > 10) {
        cs.touchMoved = true;
        cs.lastTapTime = 0;
      }

      const dx = touch.clientX - cs.prevMouse.x;
      const dy = touch.clientY - cs.prevMouse.y;
      cs.prevMouse.x = touch.clientX;
      cs.prevMouse.y = touch.clientY;

      cs.applyDragDelta(dx, dy, true);
      cs.setCursorPosition(touch.clientX, touch.clientY);

      if (typeof e.preventDefault === 'function' && e.cancelable) {
        e.preventDefault();
      }
    }
  }
}

export function handleTouchEnd(cs, e) {
  if (!e) return;
  const touches = e.touches ? Array.from(e.touches) : [];
  const cameraTouches = touches.filter(t => !isInteractiveUI(t.target));

  if (cs.touchMoved) {
    cs.lastTapTime = 0;
  }

  if (cs.isPinching) {
    if (cameraTouches.length < 2) {
      cs.isPinching = false;
      cs.pinchDistance = 0;
      if (cameraTouches.length === 1) {
        cs.activeTouchId = cameraTouches[0].identifier;
        cs.isDragging = true;
        cs.touchMoved = true;
        cs.prevMouse.x = cameraTouches[0].clientX;
        cs.prevMouse.y = cameraTouches[0].clientY;
      } else {
        cs.activeTouchId = null;
        cs.isDragging = false;
      }
    }
    return;
  }

  if (cs.activeTouchId !== null) {
    const stillActive = cameraTouches.some(t => t.identifier === cs.activeTouchId);
    if (!stillActive) {
      if (e.type === 'touchend' && !cs.touchMoved) {
        cs.handleCanvasTap(cs.touchStartX, cs.touchStartY);
      }
      cs.activeTouchId = null;
      cs.isDragging = false;
    }
  }
}

export function updateEdgePan(cs, dt, width = (typeof window !== 'undefined' ? window.innerWidth : 1920), height = (typeof window !== 'undefined' ? window.innerHeight : 1080)) {
  if (!cs.enableEdgePan || !cs.isDragging || cs.pointerLocked || dt <= 0) return;
  if (!width || !height) return;

  const margin = cs.edgePanMargin;
  const x = cs.prevMouse.x;
  const y = cs.prevMouse.y;

  let dirX = 0;
  let dirY = 0;

  if (x <= margin) {
    const factor = Math.min(1.0, Math.max(0.3, (margin - x) / margin));
    dirX = -factor;
  } else if (x >= width - margin) {
    const factor = Math.min(1.0, Math.max(0.3, (x - (width - margin)) / margin));
    dirX = factor;
  }

  if (y <= margin) {
    const factor = Math.min(1.0, Math.max(0.3, (margin - y) / margin));
    dirY = -factor;
  } else if (y >= height - margin) {
    const factor = Math.min(1.0, Math.max(0.3, (y - (height - margin)) / margin));
    dirY = factor;
  }

  if (dirX !== 0 || dirY !== 0) {
    const safeDt = Math.min(0.1, dt);
    const virtualDx = dirX * cs.edgePanSpeedX * safeDt;
    const virtualDy = dirY * cs.edgePanSpeedY * safeDt;
    cs.applyMouseDelta(virtualDx, virtualDy);
  }
}
