// Airport and cruise-point catalog for the lobby map flight planner.
// Airport rows come from the committed OurAirports index, not hand-authored codes.
import { findAirportsInRegion, loadAirportManifest } from '../geospatial/airportIndex.js';
import { registerExternalDestinations } from './externalDestinations.js';
import { applyAirportOverrides } from './airportOverrides.js';
import { REGIONAL_CRUISES } from './regionalCruises.js';
import { haversineDistanceM, JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { PARIS_SHOWCASE } from './parisShowcase.js';
import { INCHEON_PATCH } from '../geospatial/incheon.js';

const DEFAULT_AIRPORT_BOOKMARKS = ['RKSI', 'RKSS', 'RKPC', 'RKPK'];
const DEFAULT_POINT_BOOKMARKS = ['jamsil', 'suwon', 'busan', 'paris-eiffel'];
// Global cruise point for the Paris showcase. The start sits at the showcase
// route's downstream end (~90 m AGL over the Seine), heading toward Pont d'Iéna
// and the tower; its distant coordinates trigger a custom tangent-plane origin.
const GLOBAL_CRUISE_PLACES = Object.freeze([
  Object.freeze({
    id: 'paris-eiffel',
    label: 'Paris · Eiffel Tower',
    ko: '파리 · 에펠탑',
    en: 'Paris · Eiffel Tower',
    aliases: ['Paris', 'Eiffel Tower', '에펠탑', '파리'],
    latitude: PARIS_SHOWCASE.route[0].latitude,
    longitude: PARIS_SHOWCASE.route[0].longitude,
    headingDeg: 276,
    altitudeM: 120,
    airport: 'incheon',
  }),
]);
const KOREA_CENTRE = Object.freeze({ latitude: 36.4, longitude: 127.9, radiusKm: 700 });

export function cruisePlaces() {
  return [...Object.entries(REGIONAL_CRUISES).map(([id, place]) => Object.freeze({
    id,
    label: id === 'jamsil' ? 'Seoul · Jamsil' : place.en ?? place.ko ?? id,
    ko: place.ko ?? '',
    en: place.en ?? '',
    aliases: [...(id === 'jamsil' ? ['Seoul', '서울'] : []), place.ko, place.en].filter(Boolean),
    latitude: place.latitude,
    longitude: place.longitude,
    headingDeg: place.headingDeg,
    altitudeM: place.altitudeM,
    airport: place.airport,
  })), ...GLOBAL_CRUISE_PLACES];
}


export function specialRegionPlaces() {
  return Object.freeze([
    Object.freeze({
      kind: 'region',
      id: 'lukla',
      code: 'VNLK',
      label: 'Lukla (VNLK)',
      nameKey: 'lukla.vnlk',
      aliases: ['VNLK', 'LUA', 'Lukla', '루클라', '네팔', 'Nepal', 'Himalaya', '히말라야'],
    }),
    Object.freeze({
      kind: 'region',
      id: 'neon',
      code: 'NEO',
      label: 'Neon Metropolis',
      nameKey: 'neon.metropolis',
      aliases: ['Neon', 'Neon Metropolis', '네온', '네온 메트로폴리스'],
    }),
    Object.freeze({
      kind: 'region',
      id: 'coastal',
      code: 'CST',
      label: 'Coastal Airport',
      nameKey: 'coastal.airport',
      aliases: ['Coastal', 'Coastal Airport', '국제공항'],
    }),
  ]);
}

export function defaultMapBookmarks({ airports = [], points = [], regions = [] } = {}) {
  return [
    ...DEFAULT_AIRPORT_BOOKMARKS.map(code => airports.find(airport => airport.code === code))
      .filter(Boolean).map(airport => ({ ...airport, kind: 'airport', id: airport.code, label: airport.name })),
    ...DEFAULT_POINT_BOOKMARKS.map(id => points.find(point => point.id === id))
      .filter(Boolean).map(point => ({ ...point, kind: 'point' })),
    ...regions.map(region => ({ ...region, kind: 'region' })),
  ];
}

export function mapCruisePoint(plan, places = {}) {
  const point = places.points?.find(entry => entry.id === plan?.pointId) ?? plan?.point;
  const airport = places.airports?.find(entry => entry.code === plan?.airportCode);
  const location = point ?? airport;
  if (!Number.isFinite(location?.latitude) || !Number.isFinite(location.longitude)) return null;
  return {
    ...location,
    headingDeg: location.headingDeg ?? 90,
    altitudeM: location.altitudeM ?? (airport ? Math.max(0, airport.elevationM ?? 0) + 1200 : 3500),
  };
}

/** Pick the geographic scene anchor whose frame can stream this map plan. */
export function mapPlanRegion(plan, places = {}) {
  const location = plan?.state === 'cruise'
    ? mapCruisePoint(plan, places)
    : places.airports?.find(entry => entry.code === plan?.airportCode);
  if (location?.airport) return location.airport;
  if (!Number.isFinite(location?.latitude) || !Number.isFinite(location.longitude)) return null;
  const incheon = haversineDistanceM(location.latitude, location.longitude, INCHEON_PATCH.origin.latitude, INCHEON_PATCH.origin.longitude);
  const jeju = haversineDistanceM(location.latitude, location.longitude, JEJU_ORIGIN.latitude, JEJU_ORIGIN.longitude);
  return (jeju < incheon && location.latitude < 34.2) ? 'jeju' : 'incheon';
}

// Beyond 500 km from the built-in anchor, projecting onto Incheon's tangent
// plane introduces severe orthographic shear and degrades float32 precision.
export const CUSTOM_ORIGIN_THRESHOLD_M = 500_000;

/**
 * Return a local WGS84 tangent-plane origin when a map plan lies far outside
 * the built-in regional frame, or null when the anchor frame stays accurate.
 */
export function mapPlanCustomOrigin(plan, places = {}, anchor = 'incheon') {
  const location = plan?.state === 'cruise'
    ? mapCruisePoint(plan, places)
    : places.airports?.find(entry => entry.code === plan?.airportCode);
  if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) return null;
  const anchorOrigin = anchor === 'jeju' ? JEJU_ORIGIN : INCHEON_PATCH.origin;
  const distanceM = haversineDistanceM(
    location.latitude, location.longitude,
    anchorOrigin.latitude, anchorOrigin.longitude,
  );
  if (distanceM <= CUSTOM_ORIGIN_THRESHOLD_M) return null;
  return Object.freeze({ latitude: location.latitude, longitude: location.longitude });
}

/** Human-readable place label for HUD/debrief/diagnostics on a map-planned flight. */
export function mapPlanLabel(plan, places = {}) {
  if (!plan || plan.state === 'none') return null;
  const airport = places.airports?.find(entry => entry.code === plan.airportCode);
  if (airport) return airport.name ? `${airport.code} · ${airport.name}` : airport.code;
  const point = places.points?.find(entry => entry.id === plan.pointId) ?? plan.point;
  if (!point) return null;
  if (typeof point.id === 'string' && point.id.startsWith('map:')
    && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
    const ns = point.latitude >= 0 ? 'N' : 'S';
    const ew = point.longitude >= 0 ? 'E' : 'W';
    return `${Math.abs(point.latitude).toFixed(2)}°${ns}, ${Math.abs(point.longitude).toFixed(2)}°${ew}`;
  }
  return point.label ?? null;
}

const KOREAN_AIRPORT_ALIASES = {
  RKPK: ['김해', '김해국제공항', '김해공항', '부산'],
  RKSS: ['김포', '김포국제공항', '김포공항', '서울'],
  RKSI: ['인천', '인천국제공항', '인천공항'],
  RKPC: ['제주', '제주국제공항', '제주공항'],
  RKNY: ['양양', '양양국제공항', '양양공항'],
  RKTU: ['청주', '청주국제공항', '청주공항'],
  RKTN: ['대구', '대구국제공항', '대구공항'],
  RKTH: ['포항', '포항경주공항', '포항공항'],
  RKJJ: ['광주', '광주공항'],
  RKJB: ['무안', '무안국제공항', '무안공항'],
  RKPU: ['울산', '울산공항'],
  RKJY: ['여수', '여수공항'],
  RKPS: ['사천', '사천공항'],
  RKJK: ['군산', '군산공항'],
  RKPD: ['정석', '정석비행장'],
  RKTL: ['울진', '울진비행장'],
  RKSM: ['서울공항', '성남'],
};

/** Adapt one full index record into the place shape used by the map selects. */
export function indexedAirportPlace(airport) {
  const code = airport?.icao || airport?.ident;
  if (!code) return null;
  return Object.freeze({
    code,
    iata: airport.iata ?? '',
    name: airport.name,
    aliases: KOREAN_AIRPORT_ALIASES[code] ?? [],
    latitude: airport.latitude,
    longitude: airport.longitude,
    elevationM: airport.elevationM,
    country: airport.country,
    type: airport.type,
    tileId: airport.tileId,
    runways: applyAirportOverrides(airport)?.runways ?? [],
  });
}

export function indexedAirportPlaces(airports) {
  return airports
    .filter(airport => airport.country === 'KR')
    .map(indexedAirportPlace)
    .filter(Boolean)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Fetch only the tiles overlapping Korea; every listed runway is index-backed. */
export async function loadMapFlightPlaces({ fetchImpl, baseUrl } = {}) {
  const manifest = await loadAirportManifest({ fetchImpl, baseUrl });
  const airports = indexedAirportPlaces(await findAirportsInRegion(manifest, KOREA_CENTRE, { fetchImpl, baseUrl }));
  registerExternalDestinations(airports.filter(airport => airport.runways.length).map(airport => airport.code));
  return {
    airports,
    points: cruisePlaces(),
    regions: specialRegionPlaces(),
  };
}
