import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPlaceIndexCache,
  loadPlaceManifest,
  loadPlaceSearchIndex,
  placeDataBaseUrl,
} from '../src/geospatial/placeIndex.js';

const BASE = 'https://example.test/places/';

function entry(overrides = {}) {
  return {
    id: 'geonames:252919',
    label: 'Santorini Island',
    aliases: ['Santorini', 'Σαντορίνη'],
    latitude: 36.40572,
    longitude: 25.45682,
    country: 'GR',
    kind: 'island',
    detail: 'island · GR',
    ...overrides,
  };
}

function serve(manifest, artifact) {
  const files = new Map([[`${BASE}manifest.json`, manifest]]);
  if (artifact) files.set(`${BASE}${manifest.searchIndex.path}`, artifact);
  const requested = [];
  const fetchImpl = async url => {
    requested.push(String(url));
    if (!files.has(String(url))) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files.get(String(url))), { status: 200 });
  };
  return { fetchImpl, requested };
}

function fixture(places = [entry()]) {
  const manifest = {
    schemaVersion: 1,
    kind: 'flight3d-place-index',
    version: 'fixture',
    searchIndex: { path: 'fixture/places.json', schemaVersion: 1, count: places.length },
  };
  const artifact = { schemaVersion: 1, version: 'fixture', kind: 'flight3d-place-index', places };
  return { manifest, artifact };
}

test('placeDataBaseUrl resolves under the configured Vite base', () => {
  assert.equal(placeDataBaseUrl('/flight3d/'), '/flight3d/data/places/');
  assert.equal(placeDataBaseUrl('/flight3d'), '/flight3d/data/places/');
});

test('manifest and artifact are cached and validated together', async () => {
  clearPlaceIndexCache();
  const { manifest, artifact } = fixture();
  const { fetchImpl, requested } = serve(manifest, artifact);
  const loaded = await loadPlaceManifest({ baseUrl: BASE, fetchImpl });
  assert.deepEqual(loaded, manifest);

  const places = await loadPlaceSearchIndex(loaded, { baseUrl: BASE, fetchImpl });
  assert.deepEqual(places, artifact.places);
  assert.ok(Object.isFrozen(places));

  await loadPlaceManifest({ baseUrl: BASE, fetchImpl });
  await loadPlaceSearchIndex(loaded, { baseUrl: BASE, fetchImpl });
  assert.deepEqual(requested, [`${BASE}manifest.json`, `${BASE}fixture/places.json`], 'both files are cached');
});

test('count mismatch and invalid entries reject the artifact', async () => {
  clearPlaceIndexCache();
  const { manifest, artifact } = fixture();
  manifest.searchIndex.count = 2;
  const stale = serve(manifest, artifact);
  await assert.rejects(
    loadPlaceSearchIndex(manifest, { baseUrl: BASE, fetchImpl: stale.fetchImpl }),
    /Invalid place search index/,
  );

  clearPlaceIndexCache();
  const valid = fixture();
  const broken = serve(valid.manifest, {
    ...valid.artifact,
    places: [entry({ latitude: '36.4' })],
  });
  const loadedManifest = await loadPlaceManifest({ baseUrl: BASE, fetchImpl: broken.fetchImpl });
  await assert.rejects(
    loadPlaceSearchIndex(loadedManifest, { baseUrl: BASE, fetchImpl: broken.fetchImpl }),
    /Invalid place search index entry/,
  );
});

test('unsupported manifests and failed requests reject', async () => {
  clearPlaceIndexCache();
  const { fetchImpl } = serve({ schemaVersion: 2, kind: 'other' });
  await assert.rejects(loadPlaceManifest({ baseUrl: BASE, fetchImpl }), /Unsupported place index manifest/);

  clearPlaceIndexCache();
  const missingFetch = async () => new Response('not found', { status: 404 });
  await assert.rejects(
    loadPlaceManifest({ baseUrl: BASE, fetchImpl: missingFetch }),
    /Place index request failed \(404\)/,
  );
});
