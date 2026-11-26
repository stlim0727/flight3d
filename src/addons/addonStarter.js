export const ADDON_KINDS = ['region', 'aircraft', 'scenario'];

const ID_SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PLACEHOLDER_SHA256 = '0'.repeat(64);

function nextMajor(version) {
  const major = Number(String(version).split('.', 1)[0]);
  return `${major + 1}.0.0`;
}

function requireFields(options, errors) {
  const { publisher, name, kind, version, coreVersion } = options;
  if (!ID_SLUG.test(publisher ?? '')) errors.push('publisher must match ^[a-z0-9][a-z0-9._-]*$');
  if (!ID_SLUG.test(name ?? '')) errors.push('name must match ^[a-z0-9][a-z0-9._-]*$');
  if (!ADDON_KINDS.includes(kind)) errors.push(`kind must be one of ${ADDON_KINDS.join(', ')}`);
  if (!VERSION.test(version ?? '')) errors.push('version must be a semantic version');
  if (!VERSION.test(coreVersion ?? '')) errors.push('coreVersion must be a semantic version');
}

function regionTemplate({ id, publisher, version, coreVersion, title }) {
  return {
    schemaVersion: 1,
    id,
    publisher,
    version,
    coreRange: { min: coreVersion, maxExclusive: nextMajor(coreVersion) },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: `${title} by ${publisher}`,
    region: {
      bounds: { west: 126.4, south: 34.2, east: 126.6, north: 34.4 },
      origin: { latitude: 34.3, longitude: 126.5 },
      verticalDatum: 'EGM2008',
      tiles: {
        format: 'xyz-image',
        url: `https://packs.example/${publisher}/${nameFromId(id)}/${version}/{z}/{y}/{x}.png`,
        checksum: PLACEHOLDER_SHA256,
        minZoom: 8,
        maxZoom: 14,
      },
    },
  };
}

function nameFromId(id) {
  return id.split('/')[2];
}

function aircraftTemplate({ id, publisher, version, coreVersion, title }) {
  const name = nameFromId(id);
  const modelUrl = `https://packs.example/${publisher}/${name}/${version}/model.glb`;
  const cockpitUrl = `https://packs.example/${publisher}/${name}/${version}/cockpit.glb`;
  return {
    schemaVersion: 1,
    id,
    publisher,
    version,
    coreRange: { min: coreVersion, maxExclusive: nextMajor(coreVersion) },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: `${title} by ${publisher}`,
    aircraft: {
      id: name.slice(0, 24),
      physics: { profile: 'rigid-body-v1', massKg: 1200, wingAreaM2: 16, wingspanM: 11, lengthM: 8 },
      model: { url: modelUrl, sha256: PLACEHOLDER_SHA256 },
      cockpit: { url: cockpitUrl, sha256: PLACEHOLDER_SHA256 },
      controlBindings: { elevator: 'elevator_node', rudder: 'rudder_node' },
    },
    assets: [{ url: modelUrl, sha256: PLACEHOLDER_SHA256 }],
  };
}

function scenarioTemplate({ id, publisher, version, coreVersion, title }) {
  return {
    schemaVersion: 1,
    id,
    publisher,
    version,
    coreRange: { min: coreVersion, maxExclusive: nextMajor(coreVersion) },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: `${title} by ${publisher}`,
    scenario: {
      id: nameFromId(id),
      kind: 'tour',
      title,
      briefing: 'Replace this with your scenario briefing.',
      start: { frame: 'wgs84', latitude: 34.3, longitude: 126.5, altitudeM: 1000, headingDeg: 90 },
      objectives: [{
        id: 'first-waypoint',
        type: 'reach-waypoint',
        bounds: { west: 126.55, south: 34.35, east: 126.65, north: 34.45 },
        altitudeM: 1000,
      }],
      events: [{ trigger: 'on-objective-complete', action: 'set-briefing', message: 'Fly to the first waypoint.' }],
      requiredAddons: [],
    },
  };
}

const TEMPLATES = {
  region: regionTemplate,
  aircraft: aircraftTemplate,
  scenario: scenarioTemplate,
};

export function buildAddonStarter(options) {
  const errors = [];
  requireFields(options, errors);
  const id = `${options.publisher}/${options.kind}/${options.name}`;
  const title = options.title ?? options.name;
  if (errors.length) return { ok: false, errors, files: {} };
  const manifest = TEMPLATES[options.kind]({ id, publisher: options.publisher, version: options.version, coreVersion: options.coreVersion, title });
  const files = {
    'addon.json': manifest,
    'catalog.json': {
      schemaVersion: 1,
      addons: [{
        id,
        version: options.version,
        url: `https://packs.example/${options.publisher}/${options.kind}/${options.name}/${options.version}/addon.json`,
        sha256: PLACEHOLDER_SHA256,
      }],
    },
    '.github/workflows/validate-addon.yml': [
      'name: Validate addon',
      'on: [push, pull_request]',
      'jobs:',
      '  validate:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          repository: stlim0727/flight3d',
      '          path: .flight3d',
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 22',
      '      - run: node .flight3d/scripts/addon-contract.mjs validate addon.json --core ' + options.coreVersion,
    ].join('\n') + '\n',
    'README.md': [
      `# ${title}`,
      '',
      `Addon ID: \`${id}\` (version \`${options.version}\`).`,
      '',
      'Replace every `packs.example` URL and placeholder SHA-256 value before publishing.',
      'Use `node /path/to/flight3d/scripts/addon-dev.mjs catalog addon.json <url>` to fill the catalog checksum.',
      'Run `node /path/to/flight3d/scripts/addon-contract.mjs validate addon.json --core ' + options.coreVersion + '` before committing.',
    ].join('\n') + '\n',
  };
  return { ok: true, errors: [], files };
}
