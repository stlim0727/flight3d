import { validateAddonManifest } from './addonContract.js';

const ADDON_ID = /^[a-z0-9][a-z0-9._-]*\/(?:region|aircraft|scenario)\/[a-z0-9][a-z0-9._-]*$/;

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);
const SUPPORTED_SCENARIO_OBJECTIVES = new Set([
  'reach-waypoint', 'maintain-altitude-band', 'land-at', 'photograph-landmark',
]);

function overlaps(a, b) {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

function assetHosts(manifest) {
  const urls = [];
  if (manifest.aircraft?.model?.url) urls.push(manifest.aircraft.model.url);
  if (manifest.aircraft?.cockpit?.url) urls.push(manifest.aircraft.cockpit.url);
  for (const asset of manifest.assets ?? []) if (typeof asset.url === 'string') urls.push(asset.url);
  for (const override of manifest.region?.buildingOverrides ?? []) {
    if (typeof override?.model?.url === 'string') urls.push(override.model.url);
  }
  return urls;
}

function validateAssetUrl(manifestId, url, allowedHosts, errors) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    errors.push(`${manifestId}: invalid asset URL ${url}`);
    return;
  }
  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp = parsed.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(parsed.hostname);
  if (!isHttps && !isLocalHttp) {
    errors.push(`${manifestId}: asset URL protocol not allowed: ${parsed.protocol}`);
    return;
  }
  if (!parsed.hostname) {
    errors.push(`${manifestId}: invalid asset URL ${url}`);
    return;
  }
  if (allowedHosts && !allowedHosts.has(parsed.hostname)) {
    errors.push(`${manifestId}: asset host not allowed: ${parsed.hostname}`);
  }
}

export function lintAddonSet(manifests, { coreVersion, allowedAssetHosts } = {}) {
  const allowedHosts = allowedAssetHosts == null
    ? null
    : (typeof allowedAssetHosts.has === 'function' ? allowedAssetHosts : new Set(allowedAssetHosts));
  const byId = new Map();
  const addonType = manifest => String(manifest?.id ?? '').split('/')[1];
  const errors = [];
  const warnings = [];

  for (const manifest of manifests) {
    const result = validateAddonManifest(manifest, { coreVersion });
    errors.push(...result.errors.map(message => `${manifest?.id ?? '<unknown>'}: ${message}`));
    if (!ADDON_ID.test(manifest?.id ?? '')) continue;
    if (byId.has(manifest.id)) {
      errors.push(`${manifest.id}: duplicate manifest in set`);
      continue;
    }
    byId.set(manifest.id, manifest);
    for (const url of assetHosts(manifest)) {
      validateAssetUrl(manifest.id, url, allowedHosts, errors);
    }
    if (manifest.aircraft?.script || manifest.scenario?.script
      || manifest.scenario?.events?.some(event => event?.script)) {
      errors.push(`${manifest.id}: scripts are forbidden in v1`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) {
      errors.push(`cyclic dependency at ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency.id);
    visiting.delete(id);
    visited.add(id);
  };
  for (const manifest of manifests) visit(manifest.id);

  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies ?? []) {
      const target = byId.get(dependency.id);
      if (!target) {
        errors.push(`${manifest.id}: missing dependency ${dependency.id}@${dependency.version}`);
      } else if (target.version !== dependency.version) {
        errors.push(`${manifest.id}: dependency ${dependency.id} expects ${dependency.version}, got ${target.version}`);
      }
    }

    if (manifest.aircraft?.extends && ADDON_ID.test(manifest.aircraft.extends)) {
      const parent = byId.get(manifest.aircraft.extends);
      if (parent && !parent.aircraft) {
        errors.push(`${manifest.id}: aircraft.extends ${manifest.aircraft.extends} is not an aircraft addon`);
      }
    }

    const overrides = manifest.region?.buildingOverrides ?? [];
    const paletteRegions = manifests.filter(item => item.region?.palette);
    for (const override of overrides) {
      if (!override?.bounds) continue;
      if (!paletteRegions.some(item => item.id !== manifest.id && overlaps(item.region.bounds, override.bounds))) {
        warnings.push(`${manifest.id}: building override has no palette/region pack covering its bounds`);
      }
      if (!Number.isFinite(override.model?.scale) || override.model.scale <= 0) {
        warnings.push(`${manifest.id}: override model scale is not declared; using 1.0`);
      }
    }

    if (addonType(manifest) === 'scenario') {
      const scenario = manifest.scenario ?? {};
      const reachable = new Set();
      const walk = id => {
        if (reachable.has(id)) return;
        reachable.add(id);
        for (const dependency of byId.get(id)?.dependencies ?? []) walk(dependency.id);
      };
      walk(manifest.id);
      for (const requirement of scenario.requiredAddons ?? []) {
        const target = byId.get(requirement.id);
        if (!target || target.version !== requirement.version) {
          errors.push(`${manifest.id}: required addon ${requirement.id}@${requirement.version} is not pinned`);
        } else if (!reachable.has(requirement.id)) {
          errors.push(`${manifest.id}: required addon ${requirement.id} is not reachable from scenario dependencies`);
        }
      }
      const aircraftPacks = [...byId.values()].filter(item => item.aircraft);
      if (aircraftPacks.length && !aircraftPacks.some(item => scenario.requiredAddons?.some(
        requirement => requirement.id === item.id && requirement.version === item.version))) {
        errors.push(`${manifest.id}: scenario must pin one aircraft pack explicitly`);
      }
      for (const objective of scenario.objectives ?? []) {
        if (!SUPPORTED_SCENARIO_OBJECTIVES.has(objective.type)) continue;
        if (objective.landmarkId) {
          const hasLandmark = [...byId.values()].some(item => item.region?.buildingOverrides?.some(
            override => override.id === objective.landmarkId));
          if (!hasLandmark) errors.push(`${manifest.id}: unknown landmark ${objective.landmarkId}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
