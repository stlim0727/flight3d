export const MAP_ATTRIBUTION_ID = 'map-attribution';
export const MAP_ATTRIBUTION_CHIP_ID = 'map-attribution-chip';
export const MAP_ATTRIBUTION_LIST_ID = 'map-attribution-list';

export const MAP_ATTRIBUTION_SOURCE_IDS = Object.freeze([
  'incheon-attribution',
  'open-world-attribution',
  'geographic-buildings-attribution',
  'geographic-roads-attribution',
  'geographic-green-attribution',
]);

/** Expand or collapse the unified map attribution list and sync ARIA state. */
export function setMapAttributionExpanded(expanded, doc = globalThis.document) {
  if (typeof doc?.getElementById !== 'function') return false;
  const isExpanded = Boolean(expanded);
  const container = doc.getElementById(MAP_ATTRIBUTION_ID);
  container?.classList?.toggle?.('expanded', isExpanded);
  const chip = doc.getElementById(MAP_ATTRIBUTION_CHIP_ID);
  chip?.setAttribute?.('aria-expanded', String(isExpanded));
  return isExpanded;
}

/** Collapse the map attribution drawer without changing active sources. */
export function collapseMapAttribution(doc = globalThis.document) {
  return setMapAttributionExpanded(false, doc);
}

/** Toggle the map attribution drawer open/closed. */
export function toggleMapAttribution(doc = globalThis.document) {
  if (typeof doc?.getElementById !== 'function') return false;
  const container = doc.getElementById(MAP_ATTRIBUTION_ID);
  const current = Boolean(container?.classList?.contains?.('expanded'));
  return setMapAttributionExpanded(!current, doc);
}

/**
 * Show `#map-attribution` when at least one source item is visible, and hide
 * (and collapse) it when all sources are hidden. Avoids redundant DOM writes.
 */
export function syncMapAttributionContainer(doc = globalThis.document) {
  if (typeof doc?.getElementById !== 'function') return false;
  let anyVisible = false;
  for (let i = 0; i < MAP_ATTRIBUTION_SOURCE_IDS.length; i += 1) {
    const item = doc.getElementById(MAP_ATTRIBUTION_SOURCE_IDS[i]);
    if (item && !item.hidden) {
      anyVisible = true;
      break;
    }
  }
  const container = doc.getElementById(MAP_ATTRIBUTION_ID);
  if (container) {
    const nextHidden = !anyVisible;
    if (container.hidden !== nextHidden) {
      container.hidden = nextHidden;
      if (nextHidden) collapseMapAttribution(doc);
    }
  }
  return anyVisible;
}

/** Set visibility of a single attribution source and sync the container. */
export function setMapAttributionSource(id, visible, doc = globalThis.document) {
  if (typeof doc?.getElementById !== 'function') return false;
  const item = doc.getElementById(id);
  const nextHidden = !visible;
  if (item && item.hidden !== nextHidden) {
    item.hidden = nextHidden;
  }
  return syncMapAttributionContainer(doc);
}

/** Attach click-to-toggle behavior to `#map-attribution-chip`. */
export function bindMapAttribution(doc = globalThis.document) {
  if (typeof doc?.getElementById !== 'function') return false;
  const chip = doc.getElementById(MAP_ATTRIBUTION_CHIP_ID);
  if (typeof chip?.addEventListener !== 'function') return false;
  chip.addEventListener('click', () => {
    toggleMapAttribution(doc);
  });
  return true;
}
