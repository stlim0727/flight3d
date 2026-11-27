import * as THREE from 'three';

export function regionContainsOrigin(bounds, origin) {
  if (!bounds || !origin) return false;
  const lat = origin.latitude ?? origin.lat;
  const lon = origin.longitude ?? origin.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return Number.isFinite(bounds.west) && Number.isFinite(bounds.east)
    && Number.isFinite(bounds.south) && Number.isFinite(bounds.north)
    && lon >= bounds.west && lon <= bounds.east
    && lat >= bounds.south && lat <= bounds.north;
}

export function regionPackForOrigin(pack, origin) {
  if (!pack || !origin) return null;
  const candidates = Array.isArray(pack.regions) && pack.regions.length > 0 ? pack.regions : [pack];
  return candidates.find(region => regionContainsOrigin(region?.bounds, origin)) ?? null;
}

export function regionPaletteHex(pack) {
  return {
    deepColor: pack?.palette?.sea?.deepColor ?? null,
    shallowColor: pack?.palette?.sea?.shallowColor ?? null,
    roughness: Number.isFinite(pack?.palette?.sea?.roughness) ? pack.palette.sea.roughness : null,
    daylightScale: Number.isFinite(pack?.palette?.sea?.daylightScale) ? pack.palette.sea.daylightScale : null,
    hazeColor: pack?.palette?.sky?.hazeColor ?? null,
  };
}

export function applyRegionPalette(pack, { water, sky } = {}) {
  const palette = regionPaletteHex(pack);
  water?.setPalette?.(palette);
  sky?.setRegionPalette?.(palette);
  return palette;
}

export function buildingOverrideAt(pack, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return (pack?.buildingOverrides ?? []).find(override => {
    const bounds = override.bounds;
    return Number.isFinite(bounds?.west) && Number.isFinite(bounds?.east)
      && Number.isFinite(bounds?.south) && Number.isFinite(bounds?.north)
      && longitude >= bounds.west && longitude <= bounds.east
      && latitude >= bounds.south && latitude <= bounds.north;
  }) ?? null;
}

export function buildingOverrideTint(override) {
  if (!override?.material?.baseColor) return null;
  return new THREE.Color(override.material.baseColor);
}

export function addonMapBookmarks(pack) {
  const regions = Array.isArray(pack?.regions) && pack.regions.length > 0 ? pack.regions : (pack ? [pack] : []);
  const seen = new Set();
  const bookmarks = [];
  for (const region of regions) {
    for (const bookmark of region?.bookmarks ?? []) {
      const key = `${region.id ?? ''}:${bookmark.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bookmarks.push({
        kind: 'point',
        id: bookmark.id,
        label: bookmark.label,
        latitude: bookmark.latitude,
        longitude: bookmark.longitude,
        headingDeg: bookmark.headingDeg ?? 0,
        altitudeM: bookmark.altitudeM ?? 1200,
        addonId: region.id ?? pack.id,
      });
    }
  }
  return bookmarks;
}
