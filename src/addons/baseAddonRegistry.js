import {
  resolveProfile,
  sha256Hex,
  validateAddonManifest,
  validateCatalog,
} from './addonContract.js';
import { regionPackFromProfile } from './regionPackBinding.js';
import { aircraftPackFromProfile } from './aircraftPackBinding.js';
import { lintAddonSet } from './lintAddonSet.js';

export const BASE_ADDON_REPO = 'stlim0727/flight3d-addons';
export const BASE_ADDON_CATALOG_URL = 'https://stlim0727.github.io/flight3d-addons/catalog.json';
export const BASE_ADDON_PREVIEW_BASE_URL = 'https://stlim0727.github.io/flight3d-addons/previews';
export const BASE_ADDON_API_BASE_URL = `https://api.github.com/repos/${BASE_ADDON_REPO}`;
export const BASE_ADDON_REQUIRED_CHECK = 'validate-addons';

const GIT_SHA_RE = /^[0-9a-f]{40}$/i;
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Parse a Pull Request reference (`42`, `#42`, `pr-42`, or a GitHub PR URL)
 * targeting the official base addon repository. Returns positive integer or null.
 */
export function parseBaseAddonPrNumber(input) {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input > 0 ? input : null;
  }
  const text = String(input ?? '').trim();
  if (!text) return null;
  const direct = /^(?:#|pr[-/\s]*)?(\d+)$/i.exec(text);
  if (direct) {
    const num = Number(direct[1]);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  }
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const expectedPrefix = `/${BASE_ADDON_REPO.toLowerCase()}/pull/`;
    if (!parsed.pathname.toLowerCase().startsWith(expectedPrefix)) return null;
    const rest = parsed.pathname.slice(expectedPrefix.length);
    const match = /^(\d+)(?:\/|$)/.exec(rest);
    if (match) {
      const num = Number(match[1]);
      return Number.isSafeInteger(num) && num > 0 ? num : null;
    }
  } catch {
    // Not a URL.
  }
  return null;
}

function isPinnedOrPreviewUrl(rawUrl, { headSha } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const isHttps = parsed.protocol === 'https:';
  const isLoopbackHttp = parsed.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(parsed.hostname);
  if (!isHttps && !isLoopbackHttp) return false;
  if (parsed.hostname === 'raw.githubusercontent.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const ref = parts[2] ?? '';
    if (!GIT_SHA_RE.test(ref)) return false;
    if (headSha && ref.toLowerCase() !== headSha.toLowerCase()) return false;
  }
  return true;
}

/** Validate a static CI-verified PR preview document published by flight3d-addons. */
export function validatePrPreviewDocument(doc, expectedPrNumber = null) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('PR preview payload must be an object');
  }
  if (doc.schemaVersion !== 1) {
    throw new Error('unsupported PR preview schemaVersion');
  }
  if (!Number.isInteger(doc.prNumber) || doc.prNumber <= 0) {
    throw new Error('PR preview missing valid prNumber');
  }
  if (expectedPrNumber !== null && doc.prNumber !== expectedPrNumber) {
    throw new Error(`PR preview number mismatch (expected ${expectedPrNumber}, got ${doc.prNumber})`);
  }
  if (typeof doc.headSha !== 'string' || !GIT_SHA_RE.test(doc.headSha)) {
    throw new Error(`PR #${doc.prNumber} preview missing valid 40-char commit headSha`);
  }
  const checkName = typeof doc.checkName === 'string' && doc.checkName ? doc.checkName : BASE_ADDON_REQUIRED_CHECK;
  if (doc.ciPassed !== true) {
    throw new Error(`PR #${doc.prNumber} has not passed CI check "${checkName}"`);
  }
  const catalogResult = validateCatalog(doc.catalog);
  if (!catalogResult.ok) {
    throw new Error(`PR #${doc.prNumber} preview catalog invalid: ${catalogResult.errors.join('; ')}`);
  }
  for (const entry of doc.catalog.addons) {
    if (!isPinnedOrPreviewUrl(entry.url, { headSha: doc.headSha })) {
      throw new Error(`PR #${doc.prNumber} entry "${entry.id}" URL must be HTTPS and SHA/preview-pinned`);
    }
  }
  return Object.freeze({
    prNumber: doc.prNumber,
    headSha: doc.headSha,
    ciPassed: true,
    checkName,
    catalog: doc.catalog,
    source: 'preview-json',
  });
}

function selectRequiredCheckRun(checkRuns, requiredCheck) {
  const matching = (Array.isArray(checkRuns) ? checkRuns : []).filter(run => run?.name === requiredCheck);
  if (matching.length === 0) return null;
  matching.sort((left, right) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
  return matching.at(-1);
}

async function fetchBasePrCatalogViaGithubApi(prNumber, {
  fetchImpl,
  apiBaseUrl,
  rawBaseUrl,
  requiredCheck,
  coreVersion,
}) {
  const prRes = await fetchImpl(`${apiBaseUrl}/pulls/${prNumber}`);
  if (!prRes?.ok) {
    throw new Error(`base addon PR #${prNumber} lookup failed (${prRes?.status ?? 'network'})`);
  }
  const prData = await prRes.json();
  const headSha = prData?.head?.sha;
  const headRepo = prData?.head?.repo?.full_name ?? BASE_ADDON_REPO;
  if (typeof headSha !== 'string' || !GIT_SHA_RE.test(headSha)) {
    throw new Error(`PR #${prNumber} is missing a valid head commit SHA`);
  }

  const checksRes = await fetchImpl(
    `${apiBaseUrl}/commits/${headSha}/check-runs?per_page=100`,
  );
  if (!checksRes?.ok) {
    throw new Error(`PR #${prNumber} CI status lookup failed (${checksRes?.status ?? 'network'})`);
  }
  const checksPayload = await checksRes.json();
  const checkRun = selectRequiredCheckRun(checksPayload?.check_runs, requiredCheck);
  if (!checkRun) {
    throw new Error(`PR #${prNumber} has no CI check "${requiredCheck}" for ${headSha.slice(0, 7)}`);
  }
  if (checkRun.status !== 'completed') {
    throw new Error(`PR #${prNumber} CI check "${requiredCheck}" is ${checkRun.status}`);
  }
  if (checkRun.conclusion !== 'success') {
    throw new Error(`PR #${prNumber} CI check "${requiredCheck}" failed (${checkRun.conclusion ?? 'unknown'})`);
  }

  const filesRes = await fetchImpl(`${apiBaseUrl}/pulls/${prNumber}/files?per_page=100`);
  if (!filesRes?.ok) {
    throw new Error(`PR #${prNumber} file list lookup failed (${filesRes?.status ?? 'network'})`);
  }
  const prFiles = await filesRes.json();
  const manifestPaths = (Array.isArray(prFiles) ? prFiles : [])
    .filter(file => file?.status !== 'removed' && typeof file?.filename === 'string' && /^addons\/.+\/addon\.json$/.test(file.filename))
    .map(file => file.filename);
  if (manifestPaths.length === 0) {
    throw new Error(`PR #${prNumber} does not contain any addons/*/addon.json manifest`);
  }

  const manifests = [];
  const entries = [];
  for (const filename of manifestPaths) {
    const rawUrl = `${rawBaseUrl}/${headRepo}/${headSha}/${filename}`;
    const manifestRes = await fetchImpl(rawUrl);
    if (!manifestRes?.ok) {
      throw new Error(`failed to fetch ${filename} at ${headSha.slice(0, 7)} (${manifestRes?.status ?? 'network'})`);
    }
    const bytes = await manifestRes.arrayBuffer();
    const sha256 = await sha256Hex(bytes);
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(`malformed manifest JSON in ${filename}`);
    }
    const validation = validateAddonManifest(manifest, { coreVersion });
    if (!validation.ok) {
      throw new Error(`invalid PR manifest ${filename}: ${validation.errors.join('; ')}`);
    }
    manifests.push(manifest);
    entries.push({
      id: manifest.id,
      version: manifest.version,
      title: manifest.title ?? manifest.attribution ?? manifest.id,
      publisher: manifest.publisher,
      compatible: true,
      url: rawUrl,
      sha256,
    });
  }

  const lint = lintAddonSet(manifests, { coreVersion });
  if (!lint.ok) {
    throw new Error(`PR #${prNumber} addon lint failed: ${lint.errors.join('; ')}`);
  }
  const catalog = { schemaVersion: 1, addons: entries };
  const catalogCheck = validateCatalog(catalog);
  if (!catalogCheck.ok) {
    throw new Error(`PR #${prNumber} catalog invalid: ${catalogCheck.errors.join('; ')}`);
  }

  return Object.freeze({
    prNumber,
    headSha,
    ciPassed: true,
    checkName: requiredCheck,
    catalog,
    source: 'github-api',
  });
}

/**
 * Load a CI-verified addon catalog for a PR against stlim0727/flight3d-addons.
 * Reads static `previews/pr-<N>.json` first, falling back to GitHub Check Runs +
 * commit-pinned raw files only when the static preview file is absent/unreachable.
 * Explicitly failed/pending preview records (`ciPassed !== true`) fail closed immediately.
 */
export async function loadBaseAddonPrCatalog(prInput, {
  fetchImpl = globalThis.fetch,
  previewBaseUrl = BASE_ADDON_PREVIEW_BASE_URL,
  apiBaseUrl = BASE_ADDON_API_BASE_URL,
  rawBaseUrl = 'https://raw.githubusercontent.com',
  requiredCheck = BASE_ADDON_REQUIRED_CHECK,
  coreVersion,
  fallbackToGithubApi = true,
} = {}) {
  const prNumber = parseBaseAddonPrNumber(prInput);
  if (!prNumber) throw new Error('invalid base addon PR number');
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable for PR verification');

  const previewUrl = `${String(previewBaseUrl).replace(/\/+$/, '')}/pr-${prNumber}.json`;
  let previewResponse = null;
  try {
    previewResponse = await fetchImpl(previewUrl);
  } catch {
    previewResponse = null;
  }

  if (previewResponse?.ok) {
    const doc = await previewResponse.json();
    return validatePrPreviewDocument(doc, prNumber);
  }

  if (!fallbackToGithubApi) {
    throw new Error(`PR #${prNumber} verified preview not found (${previewResponse?.status ?? 'network'})`);
  }

  return fetchBasePrCatalogViaGithubApi(prNumber, {
    fetchImpl,
    apiBaseUrl,
    rawBaseUrl,
    requiredCheck,
    coreVersion,
  });
}

/** Fetch the official base addon catalog fail-open (returns null if unavailable or invalid). */
export async function loadDefaultBaseAddonCatalog({
  catalogUrl = BASE_ADDON_CATALOG_URL,
  fetchImpl = globalThis.fetch,
  validate = validateCatalog,
} = {}) {
  if (!catalogUrl || typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(catalogUrl);
    if (!response?.ok) return null;
    const document = await response.json();
    const check = validate(document);
    return check?.ok ? document : null;
  } catch {
    return null;
  }
}

/** Build the frozen runtime addon pack structure from a resolved profile. */
export function buildAddonPackFromProfile(resolved, {
  requestedPackId = null,
  coreVersion,
  metadata = null,
} = {}) {
  const effectiveCore = resolved.coreVersion ?? coreVersion;
  const requestedPin = requestedPackId ? resolved.pins.find(pin => pin.id === requestedPackId) : null;
  const regionPins = resolved.pins.filter(pin => pin.manifest?.region);
  const regionPin = requestedPin?.manifest?.region
    ? requestedPin
    : regionPins.find(pin => !String(pin.id).startsWith('demo/'))
      ?? regionPins[0];
  const regions = Object.freeze(regionPins.map(pin =>
    regionPackFromProfile(resolved, pin.id, { coreVersion: effectiveCore })));
  const aircraftPins = resolved.pins.filter(pin => pin.manifest?.aircraft);
  const aircrafts = Object.freeze(aircraftPins.map(pin =>
    aircraftPackFromProfile(resolved, pin.id, { coreVersion: effectiveCore })));
  const aircraft = (requestedPin?.manifest?.aircraft
    ? aircrafts.find(item => item.packId === requestedPin.id)
    : aircrafts[0]) ?? null;
  const meta = metadata && typeof metadata === 'object' ? metadata : {};

  if (regionPin) {
    const primaryRegion = regions.find(region => region.id === regionPin.id)
      ?? regionPackFromProfile(resolved, regionPin.id, { coreVersion: effectiveCore });
    const mergedBookmarks = Object.freeze(regions.flatMap(region => region.bookmarks ?? []));
    const mergedOverrides = Object.freeze(regions.flatMap(region => region.buildingOverrides ?? []));
    return Object.freeze({
      ...primaryRegion,
      bookmarks: mergedBookmarks,
      buildingOverrides: mergedOverrides,
      regions,
      profile: resolved,
      ...(aircraft ? { aircraft, aircrafts } : {}),
      ...meta,
    });
  }
  if (aircraft) {
    return Object.freeze({
      id: aircraft.packId,
      version: aircraft.version,
      sha256: aircraft.sha256,
      profile: resolved,
      aircraft,
      aircrafts,
      ...meta,
    });
  }
  const primaryPin = requestedPin ?? resolved.pins[0];
  return Object.freeze({
    id: primaryPin.id,
    version: primaryPin.version,
    sha256: primaryPin.sha256,
    profile: resolved,
    ...meta,
  });
}

/** Resolve all compatible (or one requested) addons from a validated catalog into a frozen pack. */
export async function resolveCatalogAddons(catalog, {
  coreVersion,
  fetchImpl = globalThis.fetch,
  packId = null,
  metadata = null,
} = {}) {
  const catalogCheck = validateCatalog(catalog);
  if (!catalogCheck.ok) throw new Error(`invalid catalog: ${catalogCheck.errors.join('; ')}`);
  const targetIds = packId
    ? [packId]
    : catalog.addons.filter(entry => entry.compatible !== false).map(entry => entry.id);
  if (targetIds.length === 0) return null;
  const resolved = await resolveProfile(catalog, targetIds, { coreVersion, fetchImpl });
  return buildAddonPackFromProfile(resolved, {
    requestedPackId: packId,
    coreVersion,
    metadata,
  });
}
