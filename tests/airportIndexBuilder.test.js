import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, normalizeAirport, normalizeRunway, parseCsv, tileIdFor, tileBounds } from '../scripts/airport-index/lib.mjs';
import { distanceKm } from '../src/geospatial/airportIndex.js';

const AIRPORT_COLUMNS = [
  'id', 'ident', 'type', 'name', 'latitude_deg', 'longitude_deg', 'elevation_ft',
  'continent', 'iso_country', 'iso_region', 'municipality', 'scheduled_service',
  'icao_code', 'iata_code', 'gps_code', 'local_code', 'home_link', 'wikipedia_link', 'keywords',
];
const RUNWAY_COLUMNS = [
  'id', 'airport_ref', 'airport_ident', 'length_ft', 'width_ft', 'surface', 'lighted', 'closed',
  'le_ident', 'le_latitude_deg', 'le_longitude_deg', 'le_elevation_ft', 'le_heading_degT', 'le_displaced_threshold_ft',
  'he_ident', 'he_latitude_deg', 'he_longitude_deg', 'he_elevation_ft', 'he_heading_degT', 'he_displaced_threshold_ft',
];

function csv(columns, rows) {
  const quote = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map(row => columns.map(column => quote(row[column])).join(','))].join('\n');
}

function airport(overrides = {}) {
  return {
    id: '1001', ident: 'RKSI', type: 'large_airport', name: 'Incheon International Airport',
    latitude_deg: '37.469101', longitude_deg: '126.450996', elevation_ft: '23',
    continent: 'AS', iso_country: 'KR', iso_region: 'KR-28', municipality: 'Seoul',
    icao_code: 'RKSI', iata_code: 'ICN', ...overrides,
  };
}

function runway(overrides = {}) {
  return {
    id: '2001', airport_ref: '1001', airport_ident: 'RKSI', length_ft: '12303', width_ft: '197',
    surface: 'ASPH', lighted: '1', closed: '0',
    le_ident: '15L', le_latitude_deg: '37.483898', le_longitude_deg: '126.440002',
    le_elevation_ft: '23', le_heading_degT: '145', le_displaced_threshold_ft: '0',
    he_ident: '33R', he_latitude_deg: '37.456401', he_longitude_deg: '126.460999',
    he_elevation_ft: '23', he_heading_degT: '325', he_displaced_threshold_ft: '0',
    ...overrides,
  };
}

function build(airportRows, runwayRows) {
  return buildIndex({
    airportsCsv: csv(AIRPORT_COLUMNS, airportRows),
    runwaysCsv: csv(RUNWAY_COLUMNS, runwayRows),
    sources: { airports: { sha256: 'a' }, runways: { sha256: 'b' } },
    version: 'test-version',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
}

test('CSV parser handles quoted fields, embedded commas and CRLF without a dependency', () => {
  const rows = parseCsv('id,name\r\n1,"Jeju, International ""A"""\r\n2,Seoul\n');
  assert.deepEqual(rows, [
    { id: '1', name: 'Jeju, International "A"' },
    { id: '2', name: 'Seoul' },
  ]);
});

test('only airports with validated land runways enter the index', () => {
  const record = normalizeAirport(airport());
  assert.equal(record.elevationM, 7.01);
  assert.equal(record.icao, 'RKSI');
  assert.equal(normalizeAirport(airport({ type: 'heliport', id: '1002' })), null);
  assert.equal(normalizeAirport(airport({ type: 'closed', id: '1003' })), null);
  assert.equal(normalizeAirport(airport({ latitude_deg: 'NaN' })), null);
  assert.equal(normalizeRunway(runway({ closed: '1' }), record), null);
  assert.equal(normalizeRunway(runway({ width_ft: '9' }), record), null);
  assert.equal(normalizeRunway(runway({ surface: 'UNK' }), record), null);
  assert.equal(normalizeRunway(runway({ le_elevation_ft: '' }), record), null);
  assert.equal(normalizeRunway(runway({ length_ft: '30000' }), record), null);
  assert.equal(normalizeRunway(runway({ airport_ref: '9999' }), record), null);
  assert.ok(normalizeRunway(runway(), record));
});

test('displaced thresholds are stored apart from physical ends', () => {
  const result = build(
    [airport(), airport({ id: '1002', ident: 'RKSU', icao_code: 'RKSU', iata_code: 'KSU', name: 'New Airport', latitude_deg: '37.5', longitude_deg: '126.5' })],
    [
      runway({ id: '2001', le_displaced_threshold_ft: '1000' }),
      runway({ id: '2002', airport_ref: '1002', airport_ident: 'RKSU', closed: '1' }),
      runway({ id: '2003', airport_ref: '1002', airport_ident: 'RKSU', le_latitude_deg: '37.5005', le_longitude_deg: '126.5005', le_elevation_ft: '23', he_latitude_deg: '37.5205', he_longitude_deg: '126.5205', he_elevation_ft: '23' }),
    ],
  );
  const { manifest, tiles } = result;
  assert.equal(manifest.counts.airports, 2);
  assert.equal(manifest.counts.runways, 2);
  assert.equal(manifest.counts.exclusions.invalidRunway, 1);
  const tile = tiles.get('12-30');
  assert.ok(tile);
  assert.deepEqual(tile.bounds, tileBounds('12-30'));
  const incheon = tile.airports.find(entry => entry.icao === 'RKSI');
  const end = incheon.runways[0].ends[0];
  assert.equal(end.physical.elevationM, 7.01);
  assert.equal(end.displacedThresholdM, 304.8);
  assert.ok(Math.abs(distanceKm(end.physical, end.threshold) - 0.3048) < 0.005);
  assert.notDeepEqual(end.physical, end.threshold);
  assert.ok(end.headingDegT > 140 && end.headingDegT < 150);
  assert.equal(manifest.icao.RKSI, '12-30');
  assert.equal(manifest.iata.KSU, '12-30');
  assert.deepEqual(manifest.counts.exclusions, {
    nonLandAirport: 0, invalidAirport: 0, noUsableRunway: 0, invalidRunway: 1,
  });
});

test('a fresh source row needs no per-airport code change and rebuilds identically', () => {
  const rows = [airport(), airport({ id: '1002', ident: 'ZZZZ', icao_code: 'ZZZZ', iata_code: '', name: 'Fresh Field', latitude_deg: '37.5', longitude_deg: '126.5' })];
  const runways = [
    runway(),
    runway({ id: '2002', airport_ref: '1002', airport_ident: 'ZZZZ', le_latitude_deg: '37.5005', le_longitude_deg: '126.5005', he_latitude_deg: '37.5205', he_longitude_deg: '126.5205' }),
  ];
  const first = build(rows, runways);
  const second = build(rows, runways);
  assert.deepEqual([...first.tiles.values()], [...second.tiles.values()]);
  assert.equal(first.manifest.generatedAt, second.manifest.generatedAt);
  assert.equal(first.manifest.icao.ZZZZ, '12-30');
  assert.equal(tileIdFor(37.469101, 126.450996), '12-30');
  assert.equal(tileIdFor(0, 180), null);
});
