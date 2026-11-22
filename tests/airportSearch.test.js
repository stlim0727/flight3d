import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchText, searchMapPlaces } from '../src/config/airportSearch.js';

const AIRPORTS = [
  { code: 'RKSI', iata: 'ICN', name: 'Incheon International Airport', latitude: 37.4691, longitude: 126.451 },
  { code: 'RKPC', iata: 'CJU', name: 'Jeju International Airport', latitude: 33.5113, longitude: 126.493 },
  { code: 'RKTY', iata: '', name: 'Daegu Airport', latitude: 35.964, longitude: 128.659 },
  { code: 'RKJJ', iata: 'JDJ', name: 'Gwangju Airport (광주공항)', latitude: 35.14, longitude: 126.81 },
  { code: 'RKSE', iata: '', name: '제주국제공항', latitude: 33.5, longitude: 126.5 },
  { code: 'BAD1', iata: 'BAD', name: 'Nowhere Airport', latitude: NaN, longitude: 126 },
];

const POINTS = [
  { id: 'jamsil', label: 'Jamsil', latitude: 37.5054, longitude: 127.137, headingDeg: 284, altitudeM: 1150, airport: 'incheon' },
  { id: 'jeju-city', label: '제주시 (Jeju City)', latitude: 33.51, longitude: 126.57, headingDeg: 262, altitudeM: 1250, airport: 'jeju' },
  { id: 'broken', label: 'Broken View', latitude: 37, longitude: Infinity, headingDeg: 0, altitudeM: 900, airport: 'jeju' },
];

function catalog() {
  return {
    airports: AIRPORTS.map(airport => ({ ...airport })),
    points: POINTS.map(point => ({ ...point })),
  };
}

test('normalizeSearchText folds case, accents, punctuation and spacing', () => {
  assert.equal(normalizeSearchText('  RKSI  '), 'rksi');
  assert.equal(normalizeSearchText('Café—Zürich!'), 'cafe zurich');
  assert.equal(normalizeSearchText('   제주   '), '제주');
  assert.equal(normalizeSearchText('RK/PC?!'), 'rk pc');
  assert.equal(normalizeSearchText('!!!'), '');
});

test('normalizeSearchText rejects non-string input', () => {
  for (const value of [null, undefined, 42, {}, ['rksi']]) {
    assert.equal(normalizeSearchText(value), '');
  }
});

test('ICAO query returns one airport with the full result shape', () => {
  assert.deepEqual(searchMapPlaces(catalog(), 'rkpc'), [{
    kind: 'airport',
    id: 'RKPC',
    label: 'RKPC · Jeju International Airport',
    detail: 'IATA CJU',
    latitude: 33.5113,
    longitude: 126.493,
  }]);
});

test('IATA and normalized queries resolve the same airport', () => {
  assert.deepEqual(searchMapPlaces(catalog(), 'icn').map(match => match.id), ['RKSI']);
  assert.deepEqual(searchMapPlaces(catalog(), ' cju ').map(match => match.id), ['RKPC']);
  assert.deepEqual(searchMapPlaces(catalog(), '  rksi!  ').map(match => match.id), ['RKSI']);
});

test('English and Korean name substrings match airports', () => {
  assert.deepEqual(searchMapPlaces(catalog(), 'international').map(match => match.id), ['RKPC', 'RKSI']);
  assert.deepEqual(searchMapPlaces(catalog(), 'gwangju').map(match => match.id), ['RKJJ']);
  assert.deepEqual(searchMapPlaces(catalog(), '제주').map(match => match.id), ['RKSE', 'jeju-city']);
  assert.deepEqual(searchMapPlaces(catalog(), '국제').map(match => match.id), ['RKSE']);
});

test('exact codes outrank code prefixes, which outrank name and token matches', () => {
  const ranked = {
    airports: [
      { code: 'JEJU', iata: 'J1', name: 'Jeju Exact Airfield', latitude: 33.5, longitude: 126.5 },
      { code: 'JEJX', iata: 'J2', name: 'Jeju Prefix Airfield', latitude: 33.51, longitude: 126.51 },
      { code: 'RKPC', iata: 'CJU', name: 'Jeju International Airport', latitude: 33.52, longitude: 126.52 },
      { code: 'ABCD', iata: '', name: 'Some Jeju View Airport', latitude: 33.53, longitude: 126.53 },
    ],
    points: [{ id: 'jeju-city', label: 'Jeju City', latitude: 33.54, longitude: 126.54 }],
  };
  assert.deepEqual(searchMapPlaces(ranked, 'jeju').map(match => match.id),
    ['JEJU', 'JEJX', 'RKPC', 'jeju-city', 'ABCD']);
});

test('cruise points keep their point shape and can be found by name or id', () => {
  assert.deepEqual(searchMapPlaces(catalog(), 'jamsil'), [{
    kind: 'point',
    id: 'jamsil',
    label: 'Jamsil',
    detail: 'cruise',
    latitude: 37.5054,
    longitude: 127.137,
  }]);
  assert.deepEqual(searchMapPlaces(catalog(), 'jeju city').map(match => match.id), ['jeju-city']);
});

test('airport detail falls back to type or coordinates when IATA is absent', () => {
  assert.equal(searchMapPlaces(catalog(), 'daegu')[0].detail, '35.964, 128.659');
  const places = {
    airports: [{ code: 'RKTY', name: 'Daegu Heliport', type: 'heliport', latitude: 35.964, longitude: 128.659 }],
    points: [],
  };
  assert.equal(searchMapPlaces(places, 'rkty')[0].detail, 'heliport');
});

test('limit caps results without changing ranking', () => {
  const all = searchMapPlaces(catalog(), 'airport');
  assert.deepEqual(all.map(match => match.id), ['RKJJ', 'RKPC', 'RKSI', 'RKTY']);
  assert.deepEqual(searchMapPlaces(catalog(), 'airport', 2).map(match => match.id), ['RKJJ', 'RKPC']);
  assert.deepEqual(searchMapPlaces(catalog(), 'airport', 0), []);
  assert.deepEqual(searchMapPlaces(catalog(), 'airport', Number.NaN).map(match => match.id), all.map(match => match.id));
});

test('empty and invalid queries return no matches', () => {
  for (const query of ['', '   ', '!!!', null, undefined, 42, {}, ['jeju']]) {
    assert.deepEqual(searchMapPlaces(catalog(), query), []);
  }
});
test('invalid catalogs and non-finite coordinates are ignored', () => {
  for (const places of [null, undefined, {}, [], { airports: 'nope', points: null }]) {
    assert.deepEqual(searchMapPlaces(places, 'jeju'), []);
  }
  assert.deepEqual(searchMapPlaces(catalog(), 'nowhere'), []);
  assert.deepEqual(searchMapPlaces(catalog(), 'broken'), []);
  assert.ok(!searchMapPlaces(catalog(), 'airport').some(match => match.id === 'BAD1'));
});

test('search does not mutate its input or return catalog objects', () => {
  const places = catalog();
  const before = structuredClone(places);
  const results = searchMapPlaces(places, 'airport', 2);
  assert.deepEqual(places, before);
  assert.deepEqual(places.airports.map(airport => airport.code),
    ['RKSI', 'RKPC', 'RKTY', 'RKJJ', 'RKSE', 'BAD1']);
  assert.notEqual(results[0], places.airports[1]);
  results[0].label = 'changed';
  assert.deepEqual(places, before);
});

test('cruise points match localized aliases', () => {
  const places = {
    points: [{ id: 'jamsil', label: 'Jamsil', aliases: ['잠실', 'Jamsil'], latitude: 37.5054, longitude: 127.137 }],
  };
  const matches = searchMapPlaces(places, '잠실');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, 'point');
  assert.equal(matches[0].id, 'jamsil');
});

test('special regions match by code, id, label, and localized aliases without coordinates', () => {
  const places = {
    regions: [
      { kind: 'region', id: 'lukla', code: 'VNLK', label: 'Lukla (VNLK)', nameKey: 'lukla.vnlk', aliases: ['VNLK', 'LUA', 'Lukla', '루클라'] },
      { kind: 'region', id: 'neon', code: 'NEO', label: 'Neon Metropolis', nameKey: 'neon.metropolis', aliases: ['Neon', '네온', '네온 메트로폴리스'] },
      { kind: 'region', id: 'coastal', code: 'CST', label: 'Coastal Airport', nameKey: 'coastal.airport', aliases: ['Coastal', '국제공항'] },
    ],
  };
  assert.deepEqual(searchMapPlaces(places, 'vnlk'), [{
    kind: 'region',
    id: 'lukla',
    label: 'Lukla (VNLK)',
    detail: 'VNLK',
    nameKey: 'lukla.vnlk',
  }]);
  assert.deepEqual(searchMapPlaces(places, '루클라').map(match => match.id), ['lukla']);
  assert.deepEqual(searchMapPlaces(places, '네온').map(match => match.id), ['neon']);
  assert.deepEqual(searchMapPlaces(places, 'coastal').map(match => match.id), ['coastal']);
});
