import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { regionPackFromProfile, profileShareParams, readProfileShareParams } from '../src/addons/regionPackBinding.js';
import { resolveProfile } from '../src/addons/addonContract.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manifestUrl = 'https://packs.example/poc/addon.json';
const manifest = {
  schemaVersion: 1,
  id: 'poc/region/sample-bay',
  publisher: 'poc',
  version: '1.0.0',
  coreRange: { min: '1.0.0', maxExclusive: '2.0.0' },
  dependencies: [],
  license: 'CC-BY-4.0',
  attribution: 'POC',
  region: {
    bounds: { west: 126.4, south: 34.2, east: 126.6, north: 34.4 },
    origin: { latitude: 34.3, longitude: 126.5 },
    verticalDatum: 'EGM2008',
    tiles: {
      format: 'xyz-image',
      url: 'https://packs.example/poc/tiles/{z}/{y}/{x}.png',
      checksum: hash('tiles'), minZoom: 8, maxZoom: 14,
    },
  },
};
const catalog = {
  schemaVersion: 1,
  addons: [{ id: manifest.id, version: manifest.version, url: manifestUrl, sha256: hash(manifest) }],
};

async function profile() {
  return resolveProfile(catalog, [manifest.id], {
    coreVersion: '1.8.0',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify(manifest)) }),
  });
}

test('a resolved profile pins the tile URL to its exact addon version', async () => {
  const binding = regionPackFromProfile(await profile(), manifest.id, { coreVersion: '1.8.0' });
  assert.equal(binding.urlTemplate, 'https://packs.example/poc/tiles/1.0.0/{z}/{y}/{x}.png');
  assert.equal(binding.sha256, hash(manifest));
  assert.equal(binding.cacheOptions.urlTemplate, binding.urlTemplate);
});

test('share params restore the same pins and detect tampering', async () => {
  const full = await profile();
  const params = profileShareParams(full, { packId: manifest.id });
  assert.equal(params.get('pack'), manifest.id);
  assert.equal(params.get('version'), '1.0.0');
  const restored = readProfileShareParams(params.toString());
  assert.deepEqual(restored.pins, full.pins.map(({ id, version, url, sha256 }) => ({ id, version, url, sha256 })));
  assert.throws(() => readProfileShareParams('?profile=not-json'), /malformed/);
  const tampered = Buffer.from(JSON.stringify({ ...restored, pins: [] })).toString('base64url');
  assert.throws(() => readProfileShareParams(`?profile=${tampered}&pack=${manifest.id}`), /malformed|unsupported/);
});

test('PMTiles packs stay archive URLs and share profiles use browser-safe base64url', async () => {
  const pmtiles = { ...manifest, region: { ...manifest.region,
    tiles: { ...manifest.region.tiles, format: 'pmtiles', url: 'https://packs.example/poc/tiles.pmtiles' } } };
  const catalogPm = { schemaVersion: 1, addons: [{ id: pmtiles.id, version: pmtiles.version,
    url: manifestUrl, sha256: hash(pmtiles) }] };
  const full = await resolveProfile(catalogPm, [pmtiles.id], {
    coreVersion: '1.8.0',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify(pmtiles)) }),
  });
  const binding = regionPackFromProfile(full, pmtiles.id, { coreVersion: '1.8.0' });
  assert.equal(binding.urlTemplate, 'https://packs.example/poc/tiles.pmtiles');
  const params = profileShareParams(full, { packId: pmtiles.id });
  assert.doesNotMatch(params.get('profile'), /[+/=]/);
  assert.equal(readProfileShareParams(params.toString()).pins.length, 1);
});

test('xyz tile URLs preserve query strings when a version segment is added', async () => {
  const withQuery = { ...manifest, region: { ...manifest.region,
    tiles: { ...manifest.region.tiles, url: 'https://packs.example/poc/tiles/{z}/{y}/{x}.png?token=secret' } } };
  const catalogQuery = { schemaVersion: 1, addons: [{ id: withQuery.id, version: withQuery.version,
    url: manifestUrl, sha256: hash(withQuery) }] };
  const full = await resolveProfile(catalogQuery, [withQuery.id], {
    coreVersion: '1.8.0',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify(withQuery)) }),
  });
  const binding = regionPackFromProfile(full, withQuery.id, { coreVersion: '1.8.0' });
  assert.equal(binding.urlTemplate, 'https://packs.example/poc/tiles/1.0.0/{z}/{y}/{x}.png?token=secret');
});
