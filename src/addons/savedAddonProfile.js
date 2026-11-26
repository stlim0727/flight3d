import { parseProfile, serializeProfile } from './addonContract.js';
import { profileShareParams } from './regionPackBinding.js';

export const SAVED_ADDON_PROFILE_KEY = 'flight3d.addons.v1';

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
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
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw new Error('select at least one addon');
  }
  const byId = new Map((catalog?.addons ?? []).map(entry => [entry.id, entry]));
  const pins = selectedIds.map(id => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`unknown addon ${id}`);
    return { id: entry.id, version: entry.version, url: entry.url, sha256: entry.sha256 };
  });
  const profile = parseProfile(serializeProfile({ schemaVersion: 1, coreVersion, pins }));
  const target = safeStorage(storage);
  if (!target) throw new Error('local storage unavailable');
  target.setItem(SAVED_ADDON_PROFILE_KEY, serializeProfile(profile));
  return profile;
}

export function clearSavedAddonProfile(storage) {
  try { safeStorage(storage)?.removeItem(SAVED_ADDON_PROFILE_KEY); }
  catch { /* Storage unavailable. */ }
}

export function savedAddonSearchParams(storage) {
  const saved = loadSavedAddonProfile(storage);
  if (!saved) return null;
  return profileShareParams(saved, { packId: saved.pins[0].id });
}

export function hasExplicitAddonParams(search) {
  const params = new URLSearchParams(search);
  return ['pack', 'version', 'profile', 'addonManifest', 'addonSha256'].some(key => params.has(key));
}

export function resolveAddonSearch(search, { storage } = {}) {
  if (hasExplicitAddonParams(search)) return search;
  const savedParams = savedAddonSearchParams(storage);
  if (!savedParams) return search;
  const params = new URLSearchParams(search);
  for (const [key, value] of savedParams) params.set(key, value);
  return `?${params.toString()}`;
}
