import { parseProfile, serializeProfile } from './addonContract.js';
import { profileShareParams } from './regionPackBinding.js';

export const SAVED_ADDON_PROFILE_KEY = 'flight3d.addons.v1';
export const SAVED_ADDON_CATALOG_KEY = 'flight3d.addons.catalog.v1';

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

function buildCatalogPins(catalog, selectedIds) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw new Error('select at least one addon');
  }
  const byId = new Map((catalog?.addons ?? []).map(entry => [entry.id, entry]));
  return selectedIds.map(id => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`unknown addon ${id}`);
    return { id: entry.id, version: entry.version, url: entry.url, sha256: entry.sha256 };
  });
}

function writeSavedAddonProfile(profile, storage) {
  const validated = parseProfile(serializeProfile(profile));
  const target = safeStorage(storage);
  if (!target) throw new Error('local storage unavailable');
  target.setItem(SAVED_ADDON_PROFILE_KEY, serializeProfile(validated));
  return validated;
}

export function loadSavedAddonProfile(storage) {
  try {
    const saved = safeStorage(storage)?.getItem(SAVED_ADDON_PROFILE_KEY);
    if (!saved) return null;
    const profile = parseProfile(saved);
    return profile.pins.length > 0 ? profile : null;
  } catch {
    return null;
  }
}

export function saveSelectedAddons(catalog, selectedIds, { coreVersion = null, storage } = {}) {
  const pins = buildCatalogPins(catalog, selectedIds);
  return writeSavedAddonProfile({ schemaVersion: 1, coreVersion, pins }, storage);
}

export function mergeSelectedAddons(catalog, selectedIds, { coreVersion = null, storage } = {}) {
  const selectedPins = buildCatalogPins(catalog, selectedIds);
  const catalogIds = new Set((catalog?.addons ?? []).map(entry => entry.id));
  const saved = loadSavedAddonProfile(storage);
  const keptPins = (saved?.pins ?? []).filter(pin => !catalogIds.has(pin.id));
  return writeSavedAddonProfile({
    schemaVersion: 1,
    coreVersion: coreVersion ?? saved?.coreVersion ?? null,
    pins: [...selectedPins, ...keptPins],
  }, storage);
}

export function removeSavedAddonPin(id, version, { storage } = {}) {
  const saved = loadSavedAddonProfile(storage);
  const pins = saved?.pins?.filter(pin => pin.id !== id || pin.version !== version) ?? [];
  if (pins.length === 0) {
    clearSavedAddonProfile(storage);
    return null;
  }
  const profile = writeSavedAddonProfile({
    schemaVersion: 1,
    coreVersion: saved.coreVersion,
    pins,
  }, storage);
  return profile.pins;
}

export function clearSavedAddonProfile(storage) {
  try { safeStorage(storage)?.removeItem(SAVED_ADDON_PROFILE_KEY); }
  catch { /* Storage unavailable. */ }
}

export function loadSavedAddonCatalogUrl(storage) {
  try {
    const saved = safeStorage(storage)?.getItem(SAVED_ADDON_CATALOG_KEY);
    return saved && /^https?:\/\//.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveAddonCatalogUrl(url, { storage } = {}) {
  const target = safeStorage(storage);
  if (!target) return;
  try {
    if (url) target.setItem(SAVED_ADDON_CATALOG_KEY, String(url));
    else target.removeItem(SAVED_ADDON_CATALOG_KEY);
  } catch { /* Storage unavailable. */ }
}

export function savedAddonSearchParams(storage) {
  const saved = loadSavedAddonProfile(storage);
  if (!saved) return null;
  return profileShareParams(saved, { packId: saved.pins[0].id });
}

export function hasExplicitAddonParams(search) {
  const params = new URLSearchParams(search);
  return ['pack', 'version', 'profile', 'addonManifest', 'addonSha256', 'addonPr'].some(key => params.has(key));
}

export function resolveAddonSearch(search, { storage } = {}) {
  if (hasExplicitAddonParams(search)) return search;
  const savedParams = savedAddonSearchParams(storage);
  if (!savedParams) return search;
  const params = new URLSearchParams(search);
  for (const [key, value] of savedParams) params.set(key, value);
  return `?${params.toString()}`;
}
