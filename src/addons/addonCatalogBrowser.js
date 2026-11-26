import { resolveProfile, sha256Hex, validateAddonManifest, validateCatalog } from './addonContract.js';
import { profileShareParams, readProfileShareParams, regionPackFromProfile } from './regionPackBinding.js';
import { aircraftPackFromProfile } from './aircraftPackBinding.js';

const KIND_FROM_ID = /^[a-z0-9][a-z0-9._-]*\/(region|aircraft|scenario)\/[a-z0-9][a-z0-9._-]*$/;

export function listAddons(catalog, { search = '', kind = 'all' } = {}) {
  const result = validateCatalog(catalog);
  if (!result.ok) throw new Error(`invalid catalog: ${result.errors.join('; ')}`);
  const needle = String(search).trim().toLowerCase();
  return catalog.addons.filter(entry => {
    if (kind !== 'all' && !entry.id.includes(`/${kind}/`)) return false;
    if (!needle) return true;
    return `${entry.id} ${entry.title ?? ''} ${entry.publisher ?? ''}`.toLowerCase().includes(needle);
  }).map(entry => ({
    id: entry.id,
    version: entry.version,
    kind: entry.id.split('/')[1],
    title: entry.title ?? entry.id.split('/').at(-1),
    publisher: entry.publisher ?? entry.id.split('/')[0],
    compatible: entry.compatible !== false,
    url: entry.url,
    sha256: entry.sha256,
  }));
}

export function buildAddonProfileUrl(
  catalog,
  selectedIds,
  { baseUrl = '', coreVersion = null, profileShareParams: shareParams = profileShareParams } = {},
) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) throw new Error('select at least one addon');
  const byId = new Map((catalog?.addons ?? []).map(entry => [entry.id, entry]));
  const pins = selectedIds.map(id => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`unknown addon ${id}`);
    return { id: entry.id, version: entry.version, url: entry.url, sha256: entry.sha256 };
  });
  const profile = { schemaVersion: 1, coreVersion: coreVersion ?? null, pins };
  return `${baseUrl}${shareParams(profile, { packId: selectedIds[0] }).toString()}`;
}

export async function resolveSharedAddonPack(search, { coreVersion, fetchImpl = globalThis.fetch } = {}) {
  const params = new URLSearchParams(search);
  const encoded = params.get('addonManifest');
  if (encoded) {
    let manifestBytes;
    let manifest;
    try {
      const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
      const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
      manifestBytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
      throw new Error('malformed pinned addon manifest');
    }
    const checksum = await sha256Hex(manifestBytes);
    const expected = params.get('addonSha256');
    if (expected && expected !== checksum) throw new Error('pinned addon checksum mismatch');
    const effectiveCore = coreVersion ?? '1.0.0';
    const result = validateAddonManifest(manifest, { coreVersion: effectiveCore });
    if (!result.ok) throw new Error(`invalid pinned addon: ${result.errors.join('; ')}`);
    const profile = {
      schemaVersion: 1,
      coreVersion: effectiveCore,
      pins: [{ id: manifest.id, version: manifest.version, url: encoded, sha256: checksum, manifest }],
    };
    return regionPackFromProfile(profile, manifest.id, { coreVersion: effectiveCore });
  }

  const sharedProfile = readProfileShareParams(search);
  if (!sharedProfile) return null;
  const effectiveCore = sharedProfile.coreVersion ?? coreVersion;
  const catalog = { schemaVersion: 1, addons: sharedProfile.pins };
  const resolved = await resolveProfile(
    catalog,
    sharedProfile.pins.map(pin => pin.id),
    { coreVersion: effectiveCore, fetchImpl },
  );
  const requestedPack = params.get('pack');
  const requestedPin = requestedPack ? resolved.pins.find(pin => pin.id === requestedPack) : null;
  const regionPin = requestedPin?.manifest?.region
    ? requestedPin
    : resolved.pins.find(pin => pin.manifest?.region);
  if (regionPin) {
    return regionPackFromProfile(resolved, regionPin.id, { coreVersion: effectiveCore });
  }
  const aircraftPin = requestedPin?.manifest?.aircraft
    ? requestedPin
    : resolved.pins.find(pin => pin.manifest?.aircraft);
  if (aircraftPin) {
    const aircraft = aircraftPackFromProfile(resolved, aircraftPin.id, { coreVersion: effectiveCore });
    return Object.freeze({
      id: aircraftPin.id,
      version: aircraft.version,
      sha256: aircraft.sha256,
      profile: resolved,
      aircraft,
    });
  }
  const primaryPin = requestedPin ?? resolved.pins[0];
  return Object.freeze({
    id: primaryPin.id,
    version: primaryPin.version,
    sha256: primaryPin.sha256,
    profile: resolved,
  });
}

export function resolveCatalogUrl(input) {
  const value = String(input ?? '').trim();
  if (/^https?:\/\//.test(value)) return resolveGitHostCatalogUrl(value);
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/.test(value)) {
    return `https://raw.githubusercontent.com/${value}/main/catalog.json`;
  }
  return value;
}

function resolveGitHostCatalogUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.hostname !== 'github.com') return value;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !/^[A-Za-z0-9._-]+$/.test(parts[0]) || !/^[A-Za-z0-9._-]+$/.test(parts[1])) return value;
  const branch = parts[2] === 'tree' || parts[2] === 'blob' ? parts[3] : null;
  const ref = branch && /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : 'main';
  return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${ref}/catalog.json`;
}

export async function loadAddonCatalog(url, { fetchImpl = globalThis.fetch, validate = validateCatalog } = {}) {
  const response = await fetchImpl(resolveCatalogUrl(url));
  if (!response.ok) throw new Error(`catalog fetch failed (${response.status}): ${resolveCatalogUrl(url)}`);
  const document = await response.json();
  const result = validate(document);
  if (!result.ok) throw new Error(`invalid catalog: ${result.errors.join('; ')}`);
  return document;
}
