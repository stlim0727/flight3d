import { resolveProfile, sha256Hex, validateAddonManifest, validateCatalog } from './addonContract.js';
import { profileShareParams, readProfileShareParams, regionPackFromProfile } from './regionPackBinding.js';
import { aircraftPackFromProfile } from './aircraftPackBinding.js';
import {
  buildAddonPackFromProfile,
  loadBaseAddonPrCatalog,
  resolveCatalogAddons,
} from './baseAddonRegistry.js';

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

/** All aircraft descriptors pinned by a shared addon profile. */
export function pinnedAddonAircraftList(pack) {
  if (Array.isArray(pack?.aircrafts) && pack.aircrafts.length > 0) return pack.aircrafts;
  return pack?.aircraft ? [pack.aircraft] : [];
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
  const prParam = params.get('addonPr');
  if (prParam) {
    const prPreview = await loadBaseAddonPrCatalog(prParam, {
      fetchImpl,
      coreVersion,
    });
    const pack = await resolveCatalogAddons(prPreview.catalog, {
      coreVersion,
      fetchImpl,
      packId: params.get('pack') || null,
      metadata: {
        prNumber: prPreview.prNumber,
        headSha: prPreview.headSha,
        ciPassed: prPreview.ciPassed,
      },
    });
    if (!pack) {
      throw new Error(`PR #${prPreview.prNumber} does not provide any compatible addon packs`);
    }
    return pack;
  }
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
    if (manifest.region) {
      return regionPackFromProfile(profile, manifest.id, { coreVersion: effectiveCore });
    }
    if (manifest.aircraft) {
      const aircraft = aircraftPackFromProfile(profile, manifest.id, { coreVersion: effectiveCore });
      return Object.freeze({
        id: manifest.id,
        version: aircraft.version,
        sha256: checksum,
        profile,
        aircraft,
        aircrafts: Object.freeze([aircraft]),
      });
    }
    return Object.freeze({
      id: manifest.id,
      version: manifest.version,
      sha256: checksum,
      profile,
    });
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
  return buildAddonPackFromProfile(resolved, {
    requestedPackId: params.get('pack'),
    coreVersion: effectiveCore,
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
  if (parts.length < 2) return value;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !repo || !/^[A-Za-z0-9._-]+$/.test(repo)) return value;
  if (parts.length === 2) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog.json`;
  }
  if (parts[2] === 'tree') {
    const ref = parts.slice(3).join('/');
    if (!ref || !/^[A-Za-z0-9._/-]+$/.test(ref)) return value;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/catalog.json`;
  }
  if (parts[2] === 'blob' && parts.at(-1) === 'catalog.json') {
    const ref = parts.slice(3, -1).join('/');
    if (!ref || !/^[A-Za-z0-9._/-]+$/.test(ref)) return value;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/catalog.json`;
  }
  return value;
}

export async function loadAddonCatalog(url, { fetchImpl = globalThis.fetch, validate = validateCatalog } = {}) {
  const response = await fetchImpl(resolveCatalogUrl(url));
  if (!response.ok) throw new Error(`catalog fetch failed (${response.status}): ${resolveCatalogUrl(url)}`);
  const document = await response.json();
  const result = validate(document);
  if (!result.ok) throw new Error(`invalid catalog: ${result.errors.join('; ')}`);
  return document;
}
