export const REENTRY_MARGIN = 16;

export function distanceLabel(meters) {
  const m = Math.max(0, meters);
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function indicatorMode(point, width, height, previous) {
  if (!point.front || !point.inDepth) return 'offscreen';
  const inset = previous === 'offscreen' ? REENTRY_MARGIN : 0;
  return point.x >= inset && point.x <= width - inset
    && point.y >= inset && point.y <= height - inset ? 'onscreen' : 'offscreen';
}

// Use the projected lateral components before perspective division. Dividing by
// depth would reverse the bearing behind the eye and be singular at z = 0.
export function screenBearing({ x, y, z }, scaleX, scaleY, previous) {
  if (![x, y, z, scaleX, scaleY].every(Number.isFinite)) return null;
  const behind = z > 0;
  const directlyBehind = behind && Math.hypot(x, y) <= z * Math.tan(Math.PI / 90);
  if (directlyBehind) return { ...(previous ?? { x: 1, y: 0 }), behind, directlyBehind };
  const dx = x * scaleX, dy = -y * scaleY;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length, behind, directlyBehind } : null;
}

export function edgePosition(bearing, viewport, size, obstacles) {
  const hx = size.width / 2, hy = size.height / 2;
  const left = viewport.left + hx, right = viewport.right - hx;
  const top = viewport.top + hy, bottom = viewport.bottom - hy;
  if (right < left || bottom < top) return null;
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const step = Math.min(bearing.x ? (right - cx) / Math.abs(bearing.x) : Infinity,
    bearing.y ? (bottom - cy) / Math.abs(bearing.y) : Infinity);
  const ideal = { x: cx + step * bearing.x, y: cy + step * bearing.y };

  // Inflate obstacles by the marker footprint and gap. A legal point is the
  // ideal point on an edge, an edge endpoint, or the end of a blocked interval.
  const blocked = obstacles.map(r => ({
    left: r.left - hx - 8, right: r.right + hx + 8,
    top: r.top - hy - 8, bottom: r.bottom + hy + 8,
  }));
  let best = null, bestDistance = Infinity;
  function consider(x, y) {
    if (x < left || x > right || y < top || y > bottom) return;
    if ((x - cx) * bearing.x + (y - cy) * bearing.y < 0) return;
    if (blocked.some(r => x > r.left && x < r.right && y > r.top && y < r.bottom)) return;
    const distance = Math.hypot(x - ideal.x, y - ideal.y);
    if (distance < bestDistance) { best = { x, y }; bestDistance = distance; }
  }
  for (const y of [top, bottom]) {
    for (const x of [ideal.x, left, right]) consider(x, y);
    for (const r of blocked) { consider(r.left, y); consider(r.right, y); }
  }
  for (const x of [left, right]) {
    for (const y of [ideal.y, top, bottom]) consider(x, y);
    for (const r of blocked) { consider(x, r.top); consider(x, r.bottom); }
  }
  return best;
}
