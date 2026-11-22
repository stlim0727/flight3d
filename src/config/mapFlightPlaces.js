// Airport and cruise-point catalog for the lobby map flight planner.
// Airport rows come from the committed OurAirports index, not hand-authored codes.
import { findAirportsInRegion, loadAirportManifest } from '../geospatial/airportIndex.js';
import { registerExternalDestinations } from './externalDestinations.js';
import { REGIONAL_CRUISES } from './regionalCruises.js';
import { haversineDistanceM, JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { INCHEON_PATCH } from '../geospatial/incheon.js';

const DEFAULT_AIRPORT_BOOKMARKS = ['RKSI', 'RKSS', 'RKPC', 'RKPK'];
const DEFAULT_POINT_BOOKMARKS = ['jamsil', 'suwon', 'busan'];
const KOREA_CENTRE = Object.freeze({ latitude: 36.4, longitude: 127.9, radiusKm: 700 });

export function cruisePlaces() {
  return Object.entries(REGIONAL_CRUISES).map(([id, place]) => Object.freeze({
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
  }));
}


export function defaultMapBookmarks({ airports = [], points = [] } = {}) {
  return [
    ...DEFAULT_AIRPORT_BOOKMARKS.map(code => airports.find(airport => airport.code === code))
      .filter(Boolean).map(airport => ({ ...airport, kind: 'airport', id: airport.code, label: airport.name })),
    ...DEFAULT_POINT_BOOKMARKS.map(id => points.find(point => point.id === id))
      .filter(Boolean).map(point => ({ ...point, kind: 'point' })),
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
  return jeju < incheon ? 'jeju' : 'incheon';
}
/** Adapt one full index record into the place shape used by the map selects. */
export function indexedAirportPlace(airport) {
  const code = airport?.icao || airport?.ident;
  if (!code) return null;
  return Object.freeze({
    code,
    iata: airport.iata ?? '',
    name: airport.name,
    latitude: airport.latitude,
    longitude: airport.longitude,
    elevationM: airport.elevationM,
    country: airport.country,
    type: airport.type,
    tileId: airport.tileId,
    runways: airport.runways ?? [],
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
  };
}
