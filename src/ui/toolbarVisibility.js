/**
 * Top-menu buttons the pilot may hide (issue #798). Aircraft controls, the
 * overflow button and demo takeover are never listed here, so no stored
 * selection can remove them.
 */
export function toolbarOptionalItems(cameraNames) {
  return [...cameraNames.map(name => `cam-${name}`), 'fullscreen'];
}

/** Known hidden items only, once each, in toolbar order. */
export function normalizeToolbarHidden(hidden, items) {
  const chosen = new Set(Array.isArray(hidden) ? hidden : []);
  return items.filter(id => chosen.has(id));
}

/**
 * Show or hide each optional button (`#btn-<id>`). The camera strip disappears
 * with its last camera so no empty divider remains. Returns the visible camera count.
 */
export function applyToolbarVisibility(hidden, items, doc = document) {
  const chosen = new Set(normalizeToolbarHidden(hidden, items));
  let visibleCameras = 0;
  for (const id of items) {
    const node = doc.getElementById(`btn-${id}`);
    if (!node) continue;
    node.hidden = chosen.has(id);
    if (id.startsWith('cam-') && !node.hidden) visibleCameras += 1;
  }
  const strip = doc.getElementById('camera-strip');
  if (strip && !strip.classList?.contains('flight-strip-panel')) strip.hidden = visibleCameras === 0;
  return visibleCameras;
}
