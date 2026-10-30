const degrees = radians => radians * 180 / Math.PI;
export const angleDelta = (angle, zero) => ((angle - zero + 540) % 360) - 180;

/** Gravity projected into screen axes avoids beta/gamma jumps near landscape. */
export function screenTilt(beta, gamma, angle) {
  const b = beta * Math.PI / 180;
  const g = gamma * Math.PI / 180;
  const a = angle * Math.PI / 180;
  const x = Math.cos(b) * Math.sin(g);
  const y = Math.sin(b);
  const z = Math.cos(b) * Math.cos(g);
  // DeviceOrientation's +gamma is -gravity.x; screen +90° puts device
  // +x at screen top and device +y at screen left. Preserve that handedness.
  const right = x * Math.cos(a) + y * Math.sin(a);
  const up = y * Math.cos(a) - x * Math.sin(a);
  return {
    pitch: degrees(Math.atan2(up, z)),
    roll: degrees(Math.atan2(right, Math.hypot(up, z))),
  };
}

export function readGyroScreen(win) {
  const orientation = win.screen?.orientation;
  const rawAngle = orientation?.angle ?? win.orientation;
  const angle = Number.isFinite(rawAngle) ? (rawAngle % 360 + 360) % 360 : 0;
  const type = orientation?.type?.startsWith('landscape') ? 'landscape'
    : orientation?.type?.startsWith('portrait') ? 'portrait'
    : win.innerWidth > win.innerHeight ? 'landscape' : 'portrait';
  return { angle, type };
}
