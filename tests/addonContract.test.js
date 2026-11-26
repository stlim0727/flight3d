import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ADDON_SCHEMA_VERSION,
  compareVersions,
  resolveProfile,
  serializeProfile,
  parseProfile,
  validateAddonManifest,
  validateCatalog,
} from '../src/addons/addonContract.js';

const coreVersion = '1.8.0';
const schemaHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(name = 'sample-bay') {
  return {
    schemaVersion: ADDON_SCHEMA_VERSION,
    id: `demo/region/${name}`,
    publisher: 'demo',
    version: '1.2.0',
    coreRange: { min: '1.0.0', maxExclusive: '2.0.0' },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: 'Demo publisher',
    region: {
      bounds: { west: 126.4, south: 34.2, east: 126.6, north: 34.4 },
      origin: { latitude: 34.3, longitude: 126.5 },
      verticalDatum: 'EGM2008',
      tiles: {
        format: 'pmtiles', url: 'https://packs.example/region.pmtiles',
        checksum: schemaHash('tiles'), minZoom: 8, maxZoom: 14,
      },
    },
  };
}

function fetchFor(manifests) {
  return async url => {
    if (!Object.hasOwn(manifests, url)) return { ok: false, status: 404 };
    const body = Buffer.from(JSON.stringify(manifests[url]));
    return { ok: true, arrayBuffer: async () => body };
  };
}

function catalogFor(manifest, overrides = {}) {
  const url = 'https://packs.example/addon.json';
  return {
    schemaVersion: 1,
    addons: [{
      id: manifest.id, version: manifest.version, url,
      sha256: schemaHash(manifest), ...overrides,
    }],
  };
}

test('validates a region fixture and rejects bad datums and core ranges', () => {
  assert.equal(validateAddonManifest(fixture(), { coreVersion }).ok, true);
  const bad = fixture();
  bad.region.verticalDatum = '';
  bad.coreRange.maxExclusive = '1.5.0';
  const result = validateAddonManifest(bad, { coreVersion });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => message.includes('verticalDatum')));
  assert.ok(result.errors.some(message => message.includes('outside the declared range')));
});

test('resolves a pinned catalog, then round-trips a shareable profile', async () => {
  const manifest = fixture();
  const catalog = catalogFor(manifest);
  const profile = await resolveProfile(catalog, [manifest.id], {
    coreVersion,
    fetchImpl: fetchFor({ [catalog.addons[0].url]: manifest }),
  });
  assert.equal(profile.pins.length, 1);
  assert.equal(profile.pins[0].version, '1.2.0');
  assert.equal(profile.pins[0].manifest.id, manifest.id);
  const restored = parseProfile(serializeProfile(profile));
  assert.equal(restored.pins[0].sha256, profile.pins[0].sha256);
  assert.equal(restored.pins[0].manifest, undefined);
});

test('a checksum mismatch rejects the addon before it can load', async () => {
  const manifest = fixture();
  const catalog = catalogFor(manifest, { sha256: '0'.repeat(64) });
  await assert.rejects(
    resolveProfile(catalog, [manifest.id], {
      coreVersion,
      fetchImpl: fetchFor({ [catalog.addons[0].url]: manifest }),
    }),
    /checksum mismatch/,
  );
});

test('dependencies resolve transitively and conflicts fail closed', async () => {
  const dependency = { ...fixture('base-tiles'), id: 'demo/region/base-tiles', version: '0.9.0' };
  const main = { ...fixture(), dependencies: [{ id: dependency.id, version: dependency.version }] };
  const depUrl = 'https://packs.example/base.json';
  const mainUrl = 'https://packs.example/main.json';
  const catalog = {
    schemaVersion: 1,
    addons: [
      { id: dependency.id, version: dependency.version, url: depUrl, sha256: schemaHash(dependency) },
      { id: main.id, version: main.version, url: mainUrl, sha256: schemaHash(main) },
    ],
  };
  const profile = await resolveProfile(catalog, [main.id], {
    coreVersion,
    fetchImpl: fetchFor({ [depUrl]: dependency, [mainUrl]: main }),
  });
  assert.deepEqual(profile.pins.map(pin => pin.id), [dependency.id, main.id]);

  catalog.addons[0].version = '1.0.0';
  catalog.addons.push({
    ...catalog.addons[0], version: '1.1.0', sha256: schemaHash({ ...dependency, version: '1.1.0' }),
  });
  assert.equal(validateCatalog(catalog).ok, false);
});

test('SemVer precedence treats prereleases below their release and ignores build metadata', () => {
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.1'), -1);
  assert.equal(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10'), -1);
});

test('coreRange is validated even without a target core version', () => {
  const missing = fixture();
  delete missing.coreRange;
  assert.equal(validateAddonManifest(missing).ok, false);
  const invalid = fixture();
  invalid.coreRange = { min: 'garbage', maxExclusive: 'also-invalid' };
  assert.equal(validateAddonManifest(invalid).ok, false);
});

test('catalogs reject duplicate id and version pins', () => {
  const manifest = fixture();
  const entry = { id: manifest.id, version: manifest.version, url: 'https://packs.example/a', sha256: schemaHash(manifest) };
  assert.equal(validateCatalog({ schemaVersion: 1, addons: [entry, { ...entry }] }).ok, false);
});

test('profiles without a target core version round-trip through JSON', async () => {
  const manifest = fixture();
  const catalog = catalogFor(manifest);
  const profile = await resolveProfile(catalog, [manifest.id], {
    fetchImpl: fetchFor({ [catalog.addons[0].url]: manifest }),
  });
  assert.equal(profile.coreVersion, null);
  assert.equal(parseProfile(serializeProfile(profile)).coreVersion, null);
});
