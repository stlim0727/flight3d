import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../scripts/airport-index/lib.mjs';
import {
  airportDataBaseUrl,
  clearAirportIndexCache,
  findAirportByCode,
  findAirportsInRegion,
  loadAirportManifest,
  matchAirportPin,
  tileIdsForBounds,
} from '../src/geospatial/airportIndex.js';

const AIRPORT_COLUMNS = 'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords';
const RUNWAY_COLUMNS = 'id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_latitude_deg,le_longitude_deg,le_elevation_ft,le_heading_degT,le_displaced_threshold_ft,he_ident,he_latitude_deg,he_longitude_deg,he_elevation_ft,he_heading_degT,he_displaced_threshold_ft';

const PLACES = [
  { id: '1001', ident: 'RKSI', icao: 'RKSI', iata: 'ICN', name: 'Incheon International Airport', latitude: 37.4691, longitude: 126.451 },
  { id: '1002', ident: 'VNLK', icao: 'VNLK', iata: 'LUA', name: 'Tenzing-Hillary Airport', latitude: 27.6868, longitude: 86.7295 },
  { id: '1003', ident: 'KJFK', icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy International Airport', latitude: 40.6394, longitude: -73.7793 },
  { id: '1004', ident: 'RKPC', icao: 'RKPC', iata: 'CJU', name: 'Jeju International Airport', latitude: 33.5113, longitude: 126.493 },
  { id: '1005', ident: 'NZSP', icao: 'NZSP', iata: '', name: 'Amundsen-Scott South Pole Station Airport', latitude: -90, longitude: -1 },
  { id: '1006', ident: 'OPGW', icao: 'OPGD', iata: '', name: 'Gwadar International Airport (Old)', latitude: 35.1, longitude: 129.1 },
  { id: '1007', ident: 'OPGW-NEW', icao: 'OPGW', iata: '', name: 'New Gwadar International Airport', latitude: 35.12, longitude: 129.12 },
];
function fixture() {
  const airports = PLACES.map(place => [
    place.id, place.ident, 'medium_airport', place.name, place.latitude, place.longitude,
    '23', 'AS', 'KR', 'KR-28', 'City', 'no', place.icao, place.iata, place.ident, '', '', '', '',
  ].join(','));
  const runways = PLACES.map((place, index) => [
    2001 + index, place.id, place.ident, '2000', '100', 'ASPH', '1', '0',
    '09', place.latitude, place.longitude, '23', '90', '0',
    '27', place.latitude + 0.005, place.longitude, '23', '270', '0',
  ].join(','));
  return buildIndex({
    airportsCsv: `${AIRPORT_COLUMNS}\n${airports.join('\n')}\n`,
    runwaysCsv: `${RUNWAY_COLUMNS}\n${runways.join('\n')}\n`,
    sources: { airports: { sha256: 'a' }, runways: { sha256: 'b' } },
    version: 'fixture',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
}
function serve({ manifest, tiles }, baseUrl = 'https://example.test/airports/') {
  const files = new Map([[`${baseUrl}manifest.json`, manifest]]);
  for (const [tileId, tile] of tiles) files.set(`${baseUrl}${manifest.version}/tiles/${tileId}.json`, tile);
  const requested = [];
  const fetchImpl = async url => {
    requested.push(url);
    if (!files.has(url)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files.get(url)), { status: 200 });
  };
  return { baseUrl, fetchImpl, requested };
}

test('regional lookup fetches only intersecting tiles and filters by radius', async () => {
  clearAirportIndexCache();
  const fixtureData = fixture();
  const { baseUrl, fetchImpl, requested } = serve(fixtureData);
  const manifest = await loadAirportManifest({ baseUrl, fetchImpl });
  assert.deepEqual(requested, [`${baseUrl}manifest.json`]);

  const nearby = await findAirportsInRegion(manifest, { latitude: 37.4691, longitude: 126.451, radiusKm: 100 }, { baseUrl, fetchImpl });
  assert.deepEqual(nearby.map(airport => airport.icao), ['RKSI']);
  assert.equal(requested.length, 2);
  assert.ok(requested.includes(`${baseUrl}fixture/tiles/12-30.json`));
  assert.ok(!requested.includes(`${baseUrl}fixture/tiles/13-10.json`));

  await loadAirportManifest({ baseUrl, fetchImpl });
  await findAirportsInRegion(manifest, { latitude: 37.4691, longitude: 126.451, radiusKm: 100 }, { baseUrl, fetchImpl });
  assert.equal(requested.length, 2, 'manifest and tiles are cached');
});

test('code lookup resolves from the manifest without scanning other tiles', async () => {
  clearAirportIndexCache();
  const { baseUrl, fetchImpl, requested } = serve(fixture());
  const manifest = await loadAirportManifest({ baseUrl, fetchImpl });
  const aircraft = await findAirportByCode(manifest, ' jfk ', { baseUrl, fetchImpl });
  assert.equal(aircraft.icao, 'KJFK');
  assert.ok(requested.includes(`${baseUrl}fixture/tiles/13-10.json`));
  assert.equal(requested.length, 2);
  assert.equal(await findAirportByCode(manifest, 'ZZZZ', { baseUrl, fetchImpl }), null);
  assert.equal(requested.length, 2);
});

test('tile bounds wrap at the antimeridian and cover all longitudes near a pole', () => {
  assert.deepEqual(tileIdsForBounds({ north: 0, south: -10, west: 175, east: -175 }, 10), ['8-35', '8-0', '9-35', '9-0']);
  const polar = tileIdsForBounds({ north: 90, south: 80, west: -180, east: 180 }, 10);
  assert.equal(polar.length, 36);
  assert.deepEqual(polar.slice(0, 2), ['17-0', '17-1']);
  assert.deepEqual(tileIdsForBounds({ north: 0, south: 10, west: 0, east: 10 }, 10), []);
});

test('pin linking prefers codes, falls back to name plus position, and rejects ambiguity', async () => {
  clearAirportIndexCache();
  const { baseUrl, fetchImpl } = serve(fixture());
  const manifest = await loadAirportManifest({ baseUrl, fetchImpl });
  const { tiles } = fixture();
  const incheon = tiles.get('12-30').airports;

  assert.equal(matchAirportPin({ icao: 'RKSI', names: { en: 'Wrong Name' } }, incheon).icao, 'RKSI');
  assert.equal(matchAirportPin({ icao: 'ZZZZ', names: { en: 'Incheon International Airport' }, latitude: 37.4691, longitude: 126.451 }, incheon), null);
  assert.equal(matchAirportPin({ names: { ko: '인천국제공항', en: 'Incheon Int’l Airport' }, latitude: 37.4691, longitude: 126.451 }, incheon).icao, 'RKSI');
  assert.equal(matchAirportPin({ names: { en: 'Incheon International Airport' }, latitude: 35.1, longitude: 129.1 }, incheon), null);
  const duplicate = { ...incheon[0], id: '9999', name: 'Incheon International Airport' };
  assert.equal(matchAirportPin({ names: { en: 'Incheon International Airport' }, latitude: 37.4691, longitude: 126.451 }, [incheon[0], duplicate]), null);
  assert.equal(matchAirportPin({ names: { en: 'Unknown Airport' }, latitude: 37.4691, longitude: 126.451 }, incheon), null);
  assert.equal(matchAirportPin({ iata: 'ICN' }, incheon).icao, 'RKSI');
});

test('default data URL follows the deployed base path', () => {
  assert.equal(airportDataBaseUrl('/flight3d'), '/flight3d/data/airports/');
  assert.equal(airportDataBaseUrl('/flight3d/'), '/flight3d/data/airports/');
  assert.equal(airportDataBaseUrl('/'), '/data/airports/');
});

test('queries reaching a pole load every longitude tile', async () => {
  clearAirportIndexCache();
  const { baseUrl, fetchImpl, requested } = serve(fixture());
  const manifest = await loadAirportManifest({ baseUrl, fetchImpl });
  const found = await findAirportsInRegion(manifest, { latitude: -80, longitude: -180, radiusKm: 2000 }, { baseUrl, fetchImpl });
  assert.ok(found.some(airport => airport.icao === 'NZSP'));
  assert.ok(requested.includes(`${baseUrl}fixture/tiles/0-17.json`));
});

test('official ICAO codes win over a conflicting source ident', async () => {
  clearAirportIndexCache();
  const { baseUrl, fetchImpl } = serve(fixture());
  const manifest = await loadAirportManifest({ baseUrl, fetchImpl });
  const resolved = await findAirportByCode(manifest, 'OPGW', { baseUrl, fetchImpl });
  assert.equal(resolved.icao, 'OPGW');
  const airports = fixture().tiles.get('12-30').airports;
  assert.equal(matchAirportPin({ icao: 'OPGW' }, airports)?.icao, 'OPGW');
});
