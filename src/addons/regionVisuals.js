import * as THREE from 'three';

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
  return (pack?.bookmarks ?? []).map(bookmark => ({
    kind: 'point',
    id: bookmark.id,
    label: bookmark.label,
    latitude: bookmark.latitude,
    longitude: bookmark.longitude,
    headingDeg: bookmark.headingDeg ?? 0,
    altitudeM: bookmark.altitudeM ?? 1200,
    addonId: pack.id,
  }));
}
