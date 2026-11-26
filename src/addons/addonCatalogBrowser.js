import { validateCatalog } from './addonContract.js';
import { profileShareParams } from './regionPackBinding.js';

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

export function buildAddonProfileUrl(catalog, selectedIds, { baseUrl = '' } = {}) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) throw new Error('select at least one addon');
  const byId = new Map((catalog?.addons ?? []).map(entry => [entry.id, entry]));
  const pins = selectedIds.map(id => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`unknown addon ${id}`);
    return { id: entry.id, version: entry.version, url: entry.url, sha256: entry.sha256 };
  });
  const profile = { schemaVersion: 1, coreVersion: null, pins };
  return `${baseUrl}${profileShareParams(profile, { packId: selectedIds[0] }).toString()}`;
}

export async function loadAddonCatalog(url, { fetchImpl = globalThis.fetch, validate = validateCatalog } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`catalog fetch failed (${response.status}): ${url}`);
  const document = await response.json();
  const result = validate(document);
  if (!result.ok) throw new Error(`invalid catalog: ${result.errors.join('; ')}`);
  return document;
}
