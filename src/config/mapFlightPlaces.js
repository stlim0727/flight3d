// Airport and cruise-point catalog for the lobby map flight planner.
// Airport rows come from the committed OurAirports index, not hand-authored codes.
import { findAirportsInRegion, loadAirportManifest } from '../geospatial/airportIndex.js';
import { registerExternalDestinations } from './externalDestinations.js';
import { REGIONAL_CRUISES } from './regionalCruises.js';
import { haversineDistanceM, JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { INCHEON_PATCH } from '../geospatial/incheon.js';

const KOREA_CENTRE = Object.freeze({ latitude: 36.4, longitude: 127.9, radiusKm: 700 });

export function cruisePlaces() {
  return Object.entries(REGIONAL_CRUISES).map(([id, place]) => Object.freeze({
    id,
    label: place.en ?? place.ko ?? id,
    latitude: place.latitude,
    longitude: place.longitude,
    headingDeg: place.headingDeg,
    altitudeM: place.altitudeM,
    airport: place.airport,
  }));
}


/** Pick the geographic scene anchor whose frame can stream this map plan. */
export function mapPlanRegion(plan, places = {}) {
  if (plan?.state === 'cruise') {
    return places.points?.find(point => point.id === plan.pointId)?.airport ?? null;
  }
  const airport = places.airports?.find(entry => entry.code === plan?.airportCode);
  if (!airport || !Number.isFinite(airport.latitude) || !Number.isFinite(airport.longitude)) return null;
  const incheon = haversineDistanceM(airport.latitude, airport.longitude, INCHEON_PATCH.origin.latitude, INCHEON_PATCH.origin.longitude);
  const jeju = haversineDistanceM(airport.latitude, airport.longitude, JEJU_ORIGIN.latitude, JEJU_ORIGIN.longitude);
  return jeju < incheon ? 'jeju' : 'incheon';
}
export function indexedAirportPlaces(airports) {
  return airports
    .filter(airport => airport.country === 'KR' && airport.runways?.length)
    .map(airport => Object.freeze({
      code: airport.icao || airport.ident,
      iata: airport.iata ?? '',
      name: airport.name,
      latitude: airport.latitude,
      longitude: airport.longitude,
      elevationM: airport.elevationM,
      runways: airport.runways,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Fetch only the tiles overlapping Korea; every listed runway is index-backed. */
export async function loadMapFlightPlaces({ fetchImpl, baseUrl } = {}) {
  const manifest = await loadAirportManifest({ fetchImpl, baseUrl });
  const airports = indexedAirportPlaces(await findAirportsInRegion(manifest, KOREA_CENTRE, { fetchImpl, baseUrl }));
  registerExternalDestinations(airports.map(airport => airport.code));
  return {
    airports,
    points: cruisePlaces(),
  };
}
