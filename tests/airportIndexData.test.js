import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { distanceKm, matchAirportPin } from '../src/geospatial/airportIndex.js';
import { LANDMARK_PLACES } from '../src/config/landmarks.js';
import { SURFACE_CATEGORIES } from '../scripts/airport-index/lib.mjs';
const ROOT = new URL('../public/data/airports/', import.meta.url);
const SNAPSHOTS = new URL('../scripts/airport-index/snapshots/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('source-metadata.json', SNAPSHOTS), 'utf8'));
const versionDir = new URL(`${manifest.version}/tiles/`, ROOT);
const tileIds = readdirSync(versionDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));

function readTile(tileId) {
  return JSON.parse(readFileSync(new URL(`${tileId}.json`, versionDir), 'utf8'));
}

test('manifest pins the source snapshot and keeps every tile under one version', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'flight3d-airport-index');
  for (const name of ['airports', 'runways']) {
    assert.equal(manifest.sources[name].sha256, metadata.sources[name].sha256);
    assert.equal(manifest.sources[name].bytes, metadata.sources[name].bytes);
    const gzipped = readFileSync(new URL(`${name}.csv.gz`, SNAPSHOTS));
    const raw = gunzipSync(gzipped);
    assert.equal(raw.length, metadata.sources[name].bytes);
    assert.equal(metadata.sources[name].sha256, createHash('sha256').update(raw).digest('hex'));
  }
  const listed = Object.keys(manifest.tiles).sort();
  assert.deepEqual(tileIds.sort(), listed);
  assert.ok(listed.length > 100);
  for (const tileId of listed) {
    const tile = readTile(tileId);
    assert.equal(tile.version, manifest.version);
    assert.equal(tile.tile, tileId);
    assert.equal(tile.schemaVersion, 1);
    assert.deepEqual(tile.bounds, manifest.tiles[tileId] && {
      south: manifest.tiles[tileId].south,
      west: manifest.tiles[tileId].west,
      north: manifest.tiles[tileId].north,
      east: manifest.tiles[tileId].east,
    });
  }
});

test('every indexed runway has two verified ends and a separate landing threshold', () => {
  const seenAirports = new Set();
  const seenRunways = new Set();
  let airports = 0;
  let runways = 0;
  for (const tileId of tileIds) {
    const tile = readTile(tileId);
    for (const airport of tile.airports) {
      airports++;
      seenAirports.add(airport.id);
      if (airport.icao) assert.equal(manifest.icao[airport.icao], tileId);
      if (airport.iata) assert.equal(manifest.iata[airport.iata], tileId);
      assert.ok(airport.latitude >= tile.bounds.south && airport.latitude < tile.bounds.north);
      assert.ok(airport.longitude >= tile.bounds.west && airport.longitude < tile.bounds.east);
      assert.ok(airport.runways.length > 0);
      for (const runway of airport.runways) {
        runways++;
        seenRunways.add(runway.id);
        assert.ok(runway.lengthM >= 152.4);
        assert.ok(runway.widthM >= 4.572);
        assert.ok(runway.surface.split('/').every(category => SURFACE_CATEGORIES.includes(category)), runway.surface);
        assert.equal(runway.ends.length, 2);
        for (const end of runway.ends) {
          assert.ok(Number.isFinite(end.physical.latitude) && Number.isFinite(end.physical.longitude));
          assert.ok(Number.isFinite(end.physical.elevationM));
          assert.ok(Number.isFinite(end.headingDegT) && end.headingDegT >= 0 && end.headingDegT < 360);
          assert.ok(end.displacedThresholdM >= 0);
          assert.ok(Number.isFinite(end.threshold.latitude) && Number.isFinite(end.threshold.longitude));
          assert.ok(distanceKm(end.physical, end.threshold) <= end.displacedThresholdM / 1000 + 0.002);
          if (end.displacedThresholdM === 0) assert.deepEqual(end.threshold, end.physical);
          else assert.notDeepEqual(end.threshold, end.physical);
        }
      }
    }
  }
  assert.equal(airports, manifest.counts.airports);
  assert.equal(runways, manifest.counts.runways);
  assert.equal(seenAirports.size, airports);
  assert.equal(seenRunways.size, runways);
});

test('airports without a dedicated scene are indexed with real runway geometry', () => {
  const codes = ['RKSI', 'RKPC', 'VNLK', 'KJFK', 'RJTT', 'WSSS'];
  for (const code of codes) {
    const tileId = manifest.icao[code];
    assert.ok(tileId, `missing ${code}`);
    const airport = readTile(tileId).airports.find(entry => entry.icao === code);
    assert.equal(airport.icao, code);
    assert.ok(airport.runways.some(runway => runway.lengthM > 500 && runway.widthM > 20));
  }
  const displaced = readTile(manifest.icao.KJFK).airports.find(entry => entry.icao === 'KJFK');
  assert.ok(displaced.runways.some(runway => runway.ends.some(end => end.displacedThresholdM > 0)));
  assert.ok(Object.keys(manifest.iata).length > 1000);
});

test('curated airport pins link by ICAO to indexed runways', () => {
  const pins = LANDMARK_PLACES.filter(place => place.kinds?.includes('airport') && place.icao);
  assert.ok(pins.length >= 2);
  for (const pin of pins) {
    const tileId = manifest.icao[pin.icao];
    assert.ok(tileId, `index is missing ${pin.icao}`);
    const match = matchAirportPin(pin, readTile(tileId).airports);
    assert.equal(match?.icao, pin.icao);
    assert.ok(match.runways.length > 0);
  }
});

test('committed data keeps official codes and drops non-surface records', () => {
  const opgwTile = readTile(manifest.icao.OPGW);
  assert.equal(opgwTile.airports.find(airport => airport.icao === 'OPGW').icao, 'OPGW');
  const nzhn = readTile(manifest.icao.NZHN).airports.find(airport => airport.icao === 'NZHN');
  assert.ok(!nzhn.runways.some(runway => runway.surface === 'DELETE DUPLICATE'));
});

test('the committed global search artifact matches the versioned tile records', () => {
  assert.equal(manifest.searchIndex.schemaVersion, 1);
  assert.ok(manifest.searchIndex.path.startsWith(`${manifest.version}/`));
  assert.equal(manifest.searchIndex.count, manifest.counts.airports);
  const search = JSON.parse(readFileSync(new URL(manifest.searchIndex.path, ROOT), 'utf8'));
  assert.equal(search.schemaVersion, 1);
  assert.equal(search.version, manifest.version);
  assert.equal(search.airports.length, manifest.searchIndex.count);

  const indexed = new Map();
  for (const tileId of tileIds) {
    for (const airport of readTile(tileId).airports) indexed.set(airport.icao || airport.ident, { airport, tileId });
  }
  const seen = new Set();
  for (const entry of search.airports) {
    assert.deepEqual(Object.keys(entry).sort(), ['code', 'country', 'iata', 'latitude', 'longitude', 'name', 'tileId', 'type']);
    const expected = indexed.get(entry.code);
    assert.ok(expected, `unknown search code ${entry.code}`);
    assert.equal(entry.tileId, expected.tileId);
    if (manifest.icao[entry.code]) assert.equal(manifest.icao[entry.code], entry.tileId);
    else assert.equal(manifest.ident[entry.code] ?? manifest.iata[entry.code], entry.tileId);
    assert.ok(manifest.icao[entry.code] || manifest.iata[entry.code] || manifest.ident[entry.code], `unresolvable ${entry.code}`);
    assert.equal(entry.iata, expected.airport.iata);
    assert.equal(entry.name, expected.airport.name);
    assert.equal(entry.latitude, expected.airport.latitude);
    assert.equal(entry.longitude, expected.airport.longitude);
    assert.equal(entry.country, expected.airport.country);
    assert.equal(entry.type, expected.airport.type);
    assert.ok(!seen.has(entry.code), `duplicate search code ${entry.code}`);
    seen.add(entry.code);
  }
  assert.deepEqual([...seen].sort(), [...indexed.keys()].sort());
  for (const code of ['KJFK', 'RJTT', 'WSSS', 'VNLK']) assert.ok(seen.has(code), `missing ${code}`);
});
