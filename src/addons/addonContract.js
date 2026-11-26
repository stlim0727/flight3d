export const ADDON_SCHEMA_VERSION = 1;
export const CATALOG_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;

const ADDON_TYPES = new Set(['region', 'aircraft', 'scenario']);
const ADDON_ID = /^([a-z0-9][a-z0-9._-]*)\/(region|aircraft|scenario)\/([a-z0-9][a-z0-9._-]*)$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function compareVersions(left, right) {
  const parse = (value, errors, label) => {
    if (typeof value !== 'string' || !VERSION.test(value)) {
      errors.push(`${label} must be a semantic version`);
      return { core: [0, 0, 0], prerelease: [] };
    }
    const [core, prerelease = ''] = value.split('+', 2)[0].split('-', 2);
    return { core: core.split('.').map(Number), prerelease: prerelease ? prerelease.split('.') : [] };
  };
  const errors = [];
  const leftParts = parse(left, errors, 'left version');
  const rightParts = parse(right, errors, 'right version');
  if (errors.length) throw new Error(errors.join('; '));
  for (let index = 0; index < 3; index++) {
    if (leftParts.core[index] !== rightParts.core[index]) return Math.sign(leftParts.core[index] - rightParts.core[index]);
  }
  const leftPre = leftParts.prerelease;
  const rightPre = rightParts.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;
  for (let index = 0; index < Math.min(leftPre.length, rightPre.length); index++) {
    const leftNumeric = /^\d+$/.test(leftPre[index]);
    const rightNumeric = /^\d+$/.test(rightPre[index]);
    if (leftNumeric && rightNumeric) {
      const delta = Number(leftPre[index]) - Number(rightPre[index]);
      if (delta !== 0) return Math.sign(delta);
    } else if (leftPre[index] !== rightPre[index]) {
      return leftPre[index] < rightPre[index] ? -1 : 1;
    }
  }
  return Math.sign(leftPre.length - rightPre.length);
}

export function coreVersionInRange(version, range) {
  if (!range || typeof range !== 'object' || typeof range.min !== 'string' || typeof range.maxExclusive !== 'string') {
    return false;
  }
  return compareVersions(version, range.min) >= 0 && compareVersions(version, range.maxExclusive) < 0;
}

function validBounds(bounds) {
  return bounds && typeof bounds === 'object'
    && [bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)
    && bounds.west < bounds.east && bounds.south < bounds.north
    && bounds.west >= -180 && bounds.east <= 180 && bounds.south >= -90 && bounds.north <= 90;
}

function validAssetSet(assets, errors, label) {
  if (!Array.isArray(assets) || assets.length === 0) {
    errors.push(`${label} needs at least one declared asset`);
    return;
  }
  assets.forEach((asset, index) => validResource(asset, errors, `${label}[${index}]`));
}

function validateBuildingOverrides(overrides, errors, label) {
  if (overrides === undefined) return;
  if (!Array.isArray(overrides) || overrides.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return;
  }
  overrides.forEach((override, index) => {
    const where = `${label}[${index}]`;
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const selectors = [override.id, override.overtureId, override.nameContains].filter(Boolean);
    if (selectors.length === 0 && !validBounds(override.bounds ?? null)) {
      errors.push(`${where} needs a selector (id, overtureId or nameContains) or bounds`);
    }
    if (selectors.length > 1) {
      errors.push(`${where} needs exactly one of id, overtureId or nameContains`);
    }
    if (override.bounds !== undefined && !validBounds(override.bounds)) errors.push(`${where} bounds are invalid`);
    if (!override.model || typeof override.model.url !== 'string' || !HEX_COLOR.test(override.material?.baseColor ?? '')) {
      errors.push(`${where} needs a model url and a baseColor`);
    }
    if (override.model) validResource(override.model, errors, `${where}.model`);
    if (override.collision !== undefined && !['replace', 'suppress'].includes(override.collision)) {
      errors.push(`${where}.collision must be replace or suppress`);
    }
  });
}

function validateRegionPalette(palette, errors) {
  if (palette === undefined) return;
  const deep = palette?.sea?.deepColor;
  const shallow = palette?.sea?.shallowColor;
  if (!HEX_COLOR.test(deep ?? '') || !HEX_COLOR.test(shallow ?? '')) {
    errors.push('region.palette.sea needs deepColor and shallowColor as #rrggbb');
  }
  if (palette?.sky?.hazeColor !== undefined && !HEX_COLOR.test(palette.sky.hazeColor)) {
    errors.push('region.palette.sky.hazeColor must be #rrggbb');
  }
  if (palette?.sea?.roughness !== undefined
    && (!Number.isFinite(palette.sea.roughness) || palette.sea.roughness < 0 || palette.sea.roughness > 1)) {
    errors.push('region.palette.sea.roughness must be between 0 and 1');
  }
}

function validateAircraftBinding(aircraft, errors) {
  if (!aircraft || typeof aircraft !== 'object') {
    errors.push('aircraft declaration is required');
    return;
  }
  if (!IDENTIFIER.test(aircraft.id ?? '') || aircraft.id.length > 24) {
    errors.push('aircraft.id must be a short lowercase identifier');
  }
  if (!aircraft.physics || !['rigid-body-v1', 'flight-model-v1'].includes(aircraft.physics.profile)) {
    errors.push('aircraft.physics.profile must be a supported physics profile');
  }
  for (const field of ['massKg', 'wingAreaM2', 'wingspanM', 'lengthM']) {
    if (!Number.isFinite(aircraft.physics?.[field]) || aircraft.physics[field] <= 0) {
      errors.push(`aircraft.physics.${field} must be positive`);
    }
  }
  if (aircraft.model) validResource(aircraft.model, errors, 'aircraft.model');
  else errors.push('aircraft.model is required');
  if (aircraft.cockpit) validResource(aircraft.cockpit, errors, 'aircraft.cockpit');
  const bindings = aircraft.controlBindings;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    errors.push('aircraft.controlBindings must map controls to node names');
  } else {
    for (const [control, node] of Object.entries(bindings)) {
      if (!['azimuth', 'elevator', 'rudder', 'flaps', 'gear'].includes(control) || typeof node !== 'string' || !node) {
        errors.push(`invalid control binding for ${control}`);
      }
    }
  }
  if (aircraft.script) errors.push('external scripts are not allowed in v1');
}

function validateScenarioDeclaration(scenario, errors) {
  if (!scenario || typeof scenario !== 'object') {
    errors.push('scenario declaration is required');
    return;
  }
  if (!IDENTIFIER.test(scenario.id ?? '')) errors.push('scenario.id is invalid');
  if (!['preset', 'tour', 'challenge'].includes(scenario.kind)) {
    errors.push('scenario.kind must be preset, tour or challenge');
  }
  if (!scenario.start || typeof scenario.start !== 'object') {
    errors.push('scenario.start is required');
  } else {
    const frame = scenario.start.frame;
    if (!['wgs84', 'airport-local'].includes(frame)) errors.push('scenario.start.frame must be wgs84 or airport-local');
    if (!Number.isFinite(scenario.start.latitude) || !Number.isFinite(scenario.start.longitude)) {
      errors.push('scenario.start needs finite latitude and longitude');
    }
    for (const field of ['altitudeM', 'headingDeg']) {
      if (!Number.isFinite(scenario.start[field])) errors.push(`scenario.start.${field} must be finite`);
    }
  }
  if (!Array.isArray(scenario.objectives) || scenario.objectives.length === 0) {
    errors.push('scenario needs at least one objective');
  } else {
    scenario.objectives.forEach((objective, index) => {
      const where = `scenario.objectives[${index}]`;
      if (!objective || !['reach-waypoint', 'maintain-altitude-band', 'land-at', 'photograph-landmark'].includes(objective.type)) {
        errors.push(`${where}.type is unsupported in v1`);
        return;
      }
      if (!objective.id || typeof objective.id !== 'string') errors.push(`${where}.id is required`);
      if (objective.type === 'reach-waypoint' && (!validBounds(objective.bounds ?? null)
        || !Number.isFinite(objective.altitudeM))) {
        errors.push(`${where} needs bounds and a finite altitudeM`);
      }
      if (objective.type === 'land-at' && !IDENTIFIER.test(objective.airportId ?? '')) {
        errors.push(`${where}.airportId is invalid`);
      }
      if (objective.type === 'photograph-landmark' && !IDENTIFIER.test(objective.landmarkId ?? '')) {
        errors.push(`${where}.landmarkId is invalid`);
      }
    });
  }
  if (!Array.isArray(scenario.events)) {
    errors.push('scenario.events must be an array');
  } else {
    scenario.events.forEach((event, index) => {
      const where = `scenario.events[${index}]`;
      if (!event || typeof event !== 'object') {
        errors.push(`${where} must be an object`);
        return;
      }
      if (!['on-objective-complete', 'on-touchdown', 'on-time-elapsed'].includes(event.trigger)) {
        errors.push(`${where}.trigger is unsupported in v1`);
      }
      if (!['set-briefing', 'advance-objective', 'complete-scenario'].includes(event.action)) {
        errors.push(`${where}.action is unsupported in v1`);
      }
      if (event.script) errors.push(`${where}.script is forbidden in v1`);
    });
  }
  if (!Array.isArray(scenario.requiredAddons)) errors.push('scenario.requiredAddons must be an array');
  else {
    for (const requirement of scenario.requiredAddons) {
      if (!requirement || !ADDON_ID.test(requirement.id ?? '') || !VERSION.test(requirement.version ?? '')) {
        errors.push('scenario.requiredAddons entries need a valid id and exact version');
      }
    }
  }
}

function validResource(resource, errors, label) {
  if (!resource || typeof resource !== 'object' || typeof resource.url !== 'string' || !resource.url
    || typeof resource.sha256 !== 'string' || !SHA256.test(resource.sha256)) {
    errors.push(`${label} needs a url and sha256 hex digest`);
  }
}

export function validateAddonManifest(manifest, { coreVersion } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  if (manifest.schemaVersion !== ADDON_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  const match = typeof manifest.id === 'string' ? ADDON_ID.exec(manifest.id) : null;
  if (!match) errors.push('id must be <publisher>/<type>/<name>');
  const [, publisher, type, name] = match ?? [];
  if (match && !ADDON_TYPES.has(type)) errors.push('unsupported addon type');
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) errors.push('invalid version');
  if (manifest.publisher !== publisher) errors.push('publisher must match the id namespace');
  if (typeof manifest.license !== 'string' || !manifest.license) errors.push('license is required');
  if (typeof manifest.attribution !== 'string' || !manifest.attribution) errors.push('attribution is required');
  if (!manifest.coreRange || typeof manifest.coreRange !== 'object'
    || typeof manifest.coreRange.min !== 'string' || typeof manifest.coreRange.maxExclusive !== 'string') {
    errors.push('coreRange needs min and maxExclusive');
  } else {
    let rangeValid = true;
    try {
      if (compareVersions(manifest.coreRange.min, manifest.coreRange.maxExclusive) >= 0) rangeValid = false;
    } catch {
      rangeValid = false;
    }
    if (!rangeValid) errors.push('coreRange must be a valid min < maxExclusive interval');
    if (coreVersion !== undefined && !coreVersionInRange(coreVersion, manifest.coreRange)) {
      errors.push(`core version ${coreVersion} is outside the declared range`);
    }
  }
  if (!Array.isArray(manifest.dependencies)) errors.push('dependencies must be an array');
  else {
    const ids = new Set();
    for (const dependency of manifest.dependencies) {
      if (!dependency || typeof dependency.id !== 'string' || !ADDON_ID.test(dependency.id)
        || typeof dependency.version !== 'string' || !VERSION.test(dependency.version)) {
        errors.push('each dependency needs an id and an exact version');
      } else if (dependency.id === manifest.id) {
        errors.push('an addon cannot depend on itself');
      } else if (ids.has(dependency.id)) {
        errors.push(`duplicate dependency ${dependency.id}`);
      } else {
        ids.add(dependency.id);
      }
    }
  }

  if (type === 'region') {
    if (!validBounds(manifest.region?.bounds)) errors.push('region bounds are invalid');
    if (!Number.isFinite(manifest.region?.origin?.latitude) || !Number.isFinite(manifest.region?.origin?.longitude)) {
      errors.push('region origin needs WGS84 latitude and longitude');
    }
    if (typeof manifest.region?.verticalDatum !== 'string' || !manifest.region.verticalDatum) {
      errors.push('region verticalDatum is required');
    }
    const tiles = manifest.region?.tiles;
    if (!tiles || !['pmtiles', 'xyz-image', 'terrain-rgb'].includes(tiles.format)
      || !Number.isInteger(tiles.minZoom) || !Number.isInteger(tiles.maxZoom)
      || tiles.minZoom < 0 || tiles.maxZoom < tiles.minZoom || tiles.maxZoom > 22) {
      errors.push('region tiles need a supported format and a valid zoom range');
    }
    validResource({ url: tiles?.url, sha256: tiles?.checksum }, errors, 'region tiles');
  }
  if (type === 'region') {
    validateBuildingOverrides(manifest.region?.buildingOverrides, errors, 'region.buildingOverrides');
    validateRegionPalette(manifest.region?.palette, errors);
  }
  if (type === 'aircraft') {
    validateAircraftBinding(manifest.aircraft, errors);
    validAssetSet(manifest.assets, errors, 'assets');
  }
  if (type === 'scenario') {
    validateScenarioDeclaration(manifest.scenario, errors);
    if (manifest.assets !== undefined) validAssetSet(manifest.assets, errors, 'assets');
  }
  return { ok: errors.length === 0, errors, id: manifest.id, version: manifest.version, type };
}

export function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || catalog.schemaVersion !== CATALOG_SCHEMA_VERSION || !Array.isArray(catalog.addons)) {
    return { ok: false, errors: ['unsupported catalog'] };
  }
  const seen = new Map();
  for (const entry of catalog.addons) {
    if (!entry || typeof entry.id !== 'string' || !ADDON_ID.test(entry.id)
      || typeof entry.version !== 'string' || !VERSION.test(entry.version)) {
      errors.push('catalog entries need a valid id and exact version');
      continue;
    }
    validResource({ url: entry.url, sha256: entry.sha256 }, errors, `catalog ${entry.id}`);
    if (seen.has(entry.id) && seen.get(entry.id) !== entry.version) {
      errors.push(`conflicting pins for ${entry.id}`);
    }
    seen.set(entry.id, entry.version);
  }
  return { ok: errors.length === 0, errors };
}

export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function pinnedEntry(catalog, id, version) {
  return catalog.addons.find(entry => entry.id === id && entry.version === version);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`manifest fetch failed (${response.status}): ${url}`);
  return response.arrayBuffer();
}

export async function resolveProfile(catalog, requestedIds, { coreVersion, fetchImpl = globalThis.fetch } = {}) {
  const catalogCheck = validateCatalog(catalog);
  if (!catalogCheck.ok) throw new Error(`invalid catalog: ${catalogCheck.errors.join('; ')}`);
  const pins = new Map();
  const visiting = new Set();

  async function resolve(id, version, depth = 0) {
    if (depth > 32) throw new Error('dependency chain too deep');
    if (pins.has(id)) {
      if (pins.get(id).version !== version) throw new Error(`conflicting versions requested for ${id}`);
      return;
    }
    if (visiting.has(id)) throw new Error(`cyclic dependency at ${id}`);
    visiting.add(id);
    const entry = pinnedEntry(catalog, id, version);
    if (!entry) throw new Error(`no catalog pin for ${id}@${version}`);
    const buffer = await fetchJson(entry.url, fetchImpl);
    const checksum = await sha256Hex(buffer);
    if (checksum !== entry.sha256) throw new Error(`checksum mismatch for ${id}@${version}`);
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      throw new Error(`malformed manifest for ${id}@${version}`);
    }
    const result = validateAddonManifest(manifest, { coreVersion });
    if (!result.ok) throw new Error(`invalid manifest ${id}@${version}: ${result.errors.join('; ')}`);
    if (manifest.id !== id || manifest.version !== version) throw new Error(`manifest identity mismatch for ${id}`);
    for (const dependency of manifest.dependencies) {
      await resolve(dependency.id, dependency.version, depth + 1);
    }
    visiting.delete(id);
    pins.set(id, { id, version, url: entry.url, sha256: entry.sha256, manifest });
  }

  for (const id of requestedIds) {
    const entries = catalog.addons.filter(entry => entry.id === id);
    if (entries.length === 0) throw new Error(`unknown addon ${id}`);
    if (entries.length > 1) throw new Error(`ambiguous catalog pin for ${id}`);
    await resolve(id, entries[0].version);
  }
  return { schemaVersion: PROFILE_SCHEMA_VERSION, coreVersion, pins: [...pins.values()] };
}

export function serializeProfile(profile) {
  return JSON.stringify({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    coreVersion: profile.coreVersion,
    pins: profile.pins.map(({ id, version, url, sha256 }) => ({ id, version, url, sha256 })),
  });
}

export function parseProfile(json) {
  const profile = JSON.parse(json);
  if (profile?.schemaVersion !== PROFILE_SCHEMA_VERSION || typeof profile.coreVersion !== 'string'
    || !Array.isArray(profile.pins)) throw new Error('unsupported profile');
  const ids = new Set();
  for (const pin of profile.pins) {
    if (!pin || typeof pin.id !== 'string' || !ADDON_ID.test(pin.id)
      || typeof pin.version !== 'string' || !VERSION.test(pin.version)
      || typeof pin.url !== 'string' || !pin.url || !SHA256.test(pin.sha256)) {
      throw new Error('invalid profile pin');
    }
    if (ids.has(pin.id)) throw new Error(`duplicate profile pin ${pin.id}`);
    ids.add(pin.id);
  }
  return profile;
}
