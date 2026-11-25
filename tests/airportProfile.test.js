import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FULL_SCENERY_AIRPORTS, KOREAN_AIRPORT_NAMES, KOREAN_MILITARY_AIRFIELDS, MIN_RUNWAY_M,
  airportDisplayName, airportProfile, isMilitaryAirfield,
} from '../src/config/airportProfile.js';
import { AIRPORT_OVERRIDES } from '../src/config/airportOverrides.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';
import { loadMapFlightPlaces } from '../src/config/mapFlightPlaces.js';

const runway = (lengthM, surface = 'ASP') => ({ id: String(lengthM), lengthM, surface, ends: [{ ident: '09' }, { ident: '27' }] });

test('airport tiers: full scenery, runway only and cruise-only reasons', () => {
  assert.equal(airportProfile({ code: 'RKSI', runways: [runway(3750)] }).tier, 'full');
  assert.equal(airportProfile({ code: 'RKSS', name: 'Seoul Gimpo International Airport', runways: [runway(3600)] }).tier, 'runway');
  assert.deepEqual(
    [airportProfile({ code: 'RKSW', name: 'Suwon Airport', runways: [runway(2743)] }).tier, airportProfile({ code: 'RKSW', runways: [runway(2743)] }).reason],
    ['cruise', 'military'],
    'Suwon is an air base even though the index calls it an airport',
  );
  assert.equal(airportProfile({ code: 'XGRS', name: 'Grass Strip', runways: [runway(900, 'GRE')] }).reason, 'unpaved');
  assert.equal(airportProfile({ code: 'ZZZZ', runways: [] }).reason, 'noRunway');
  for (const profile of [airportProfile({ code: 'RKSW', runways: [runway(2743)] }), airportProfile({ code: 'ZZZZ', runways: [] })]) {
    assert.equal(profile.landable, false);
  }
});

test('airport tiers: runway length gates takeoff per aircraft, but not curated full-scenery fields', () => {
  const ulsan = { code: 'RKPU', name: 'Ulsan Airport', runways: [runway(2000)] };
  const shortField = { code: 'XSHT', name: 'Short Field Airport', runways: [runway(1100)] };
  assert.equal(airportProfile(ulsan, 'B738').landable, true);
  assert.equal(airportProfile(shortField, 'B738').tooShort, true);
  assert.equal(airportProfile(shortField, 'B738').landable, false);
  assert.equal(airportProfile(shortField, 'B738').minRunwayM, MIN_RUNWAY_M.B738);
  assert.equal(airportProfile(shortField, 'C172').landable, true);
  assert.equal(airportProfile(shortField).landable, true, 'no aircraft means no length gate');
  const unknown = { code: 'XUNK', name: 'Unknown Data Airport', runways: [{ id: '1', ends: [{ ident: '04' }, { ident: '22' }] }] };
  assert.deepEqual([airportProfile(unknown, 'B738').tier, airportProfile(unknown, 'B738').landable], ['runway', true],
    'missing surface and length data never lock a start');
  assert.equal(airportProfile({ code: 'VNLK', runways: [runway(527)] }, 'B738').landable, true, 'Lukla keeps its curated B737 scenario');
  assert.equal(
    airportProfile({ code: 'XMIX', name: 'Mixed Field Airport', runways: [runway(2500, 'GRS'), runway(1000)] }, 'B738').longestRunwayM,
    1000,
    'only paved runways count toward the length when any exist',
  );
  for (const id of Object.keys(MIN_RUNWAY_M)) assert.ok(AIRCRAFT_REGISTRY[id], `${id} is a real aircraft`);
});

test('airport tiers: military names are detected only when the name is not also an airport', () => {
  assert.equal(isMilitaryAirfield({ code: 'KXXX', name: 'Edwards Air Force Base AFB' }), true);
  assert.equal(isMilitaryAirfield({ code: 'KXXX', name: 'Some Army Airfield' }), true);
  assert.equal(isMilitaryAirfield({ code: 'RKJK', name: 'Gunsan Airport / Gunsan Air Base' }), false, 'joint civil airport');
  assert.equal(isMilitaryAirfield({ code: 'KJFK', name: 'John F. Kennedy International Airport' }), false);
  assert.equal(isMilitaryAirfield({ code: 'RKSW', name: 'Suwon Airport' }), true);
});

test('airport tiers: full-scenery codes all have curated overrides', () => {
  for (const code of FULL_SCENERY_AIRPORTS) assert.ok(AIRPORT_OVERRIDES[code], `${code} has overrides`);
});

test('airport display names: Korean names for ko, index names for en, with the ICAO code', () => {
  const suwon = { code: 'RKSW', name: 'Suwon Airport' };
  assert.equal(airportDisplayName(suwon, 'ko'), '수원 공군기지 (RKSW)');
  assert.equal(airportDisplayName(suwon, 'en'), 'Suwon Airport (RKSW)');
  assert.equal(airportDisplayName({ code: 'KJFK', name: 'John F. Kennedy International Airport' }, 'ko'), 'John F. Kennedy International Airport (KJFK)');
  assert.equal(airportDisplayName({ code: 'ZZZZ' }, 'ko'), 'ZZZZ');
});

test('airport tiers: the committed Korean catalog splits into full, runway and military airfields', async () => {
  const base = path.resolve('public/data/airports');
  const fetchImpl = async url => new Response(fs.readFileSync(path.join(base, String(url).replace(/^.*data\/airports\//, ''))));
  const { airports } = await loadMapFlightPlaces({ fetchImpl, baseUrl: 'http://fixture/data/airports/' });
  assert.ok(airports.length > 20, 'catalog loaded');
  const byTier = { full: [], runway: [], cruise: [] };
  for (const airport of airports) byTier[airportProfile(airport, 'B738').tier].push(airport.code);
  assert.deepEqual(byTier.full.sort(), ['RKPC', 'RKSI']);
  for (const code of ['RKSS', 'RKPK', 'RKTN', 'RKTU', 'RKJJ']) assert.ok(byTier.runway.includes(code), `${code} is a civil runway airport`);
  for (const code of ['RKSW', 'RKSO', 'RKSM', 'RK16', 'RK60']) assert.ok(byTier.cruise.includes(code), `${code} is cruise-only`);
  for (const airport of airports) {
    if (KOREAN_MILITARY_AIRFIELDS.has(airport.code)) assert.ok(KOREAN_AIRPORT_NAMES[airport.code], `${airport.code} has a Korean name`);
    const profile = airportProfile(airport, 'B738');
    if (profile.landable && profile.tier === 'runway') {
      assert.ok(profile.longestRunwayM >= MIN_RUNWAY_M.B738, `${airport.code} landable for the B737 has a long enough runway`);
    }
  }
});
