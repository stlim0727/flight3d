import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { clearPlaceIndexCache, loadPlaceManifest, loadPlaceSearchIndex } from '../src/geospatial/placeIndex.js';
import { searchPlaceIndex } from '../src/config/airportSearch.js';

const ROOT = new URL('../public/data/places/', import.meta.url);
const SNAPSHOTS = new URL('../scripts/place-index/snapshots/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('source-metadata.json', SNAPSHOTS), 'utf8'));
const artifact = JSON.parse(readFileSync(new URL(manifest.searchIndex.path, ROOT), 'utf8'));

function serveFile(url) {
  if (url.endsWith('manifest.json')) {
    return new Response(JSON.stringify(manifest), { status: 200 });
  }
  if (url.endsWith(manifest.searchIndex.path)) {
    return new Response(JSON.stringify(artifact), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}

test('manifest pins the artifact and the committed snapshots match metadata', async () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'flight3d-place-index');
  assert.equal(artifact.version, manifest.version);
  assert.equal(artifact.places.length, manifest.searchIndex.count);
  assert.equal(manifest.counts.places, artifact.places.length);
  assert.equal(manifest.attribution, 'GeoNames contributors');
  assert.equal(manifest.license, 'Creative Commons Attribution 4.0');

  for (const name of ['cities', 'features']) {
    const raw = gunzipSync(readFileSync(new URL(`${name}.tsv.gz`, SNAPSHOTS)));
    assert.equal(createHash('sha256').update(raw).digest('hex'), metadata.snapshots[name].sha256);
    assert.equal(raw.length, metadata.snapshots[name].bytes);
  }
});

test('committed places cover cities, islands and landmarks with searchable aliases', async () => {
  clearPlaceIndexCache();
  globalThis.fetch = async url => serveFile(String(url));
  try {
    const loaded = await loadPlaceManifest({ baseUrl: new URL(ROOT).href });
    const places = await loadPlaceSearchIndex(loaded, { baseUrl: new URL(ROOT).href });
    assert.ok(places.length > 10000);
    for (const place of places) {
      assert.match(place.id, /^geonames:\d+$/);
      assert.ok(place.label.length > 0);
      assert.ok(place.aliases.length > 0);
      assert.ok(place.latitude >= -90 && place.latitude <= 90);
      assert.ok(place.longitude >= -180 && place.longitude <= 180);
    }

    const santorini = searchPlaceIndex(places, 'santorini');
    assert.ok(santorini.some(place => place.id === 'geonames:252919'), 'island name search works');
    const eiffel = searchPlaceIndex(places, 'Eiffel Tower');
    assert.ok(eiffel.some(place => place.id === 'geonames:6254976'), 'landmark alias search works');
    const seoul = searchPlaceIndex(places, 'Seoul');
    assert.ok(seoul.length > 0, 'city search works');
  } finally {
    clearPlaceIndexCache();
    delete globalThis.fetch;
  }
});
