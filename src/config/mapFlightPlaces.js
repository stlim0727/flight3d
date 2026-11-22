// Airport and cruise-point catalog for the lobby map flight planner.
// Airport rows come from the committed OurAirports index, not hand-authored codes.
import { findAirportsInRegion, loadAirportManifest } from '../geospatial/airportIndex.js';
import { REGIONAL_CRUISES } from './regionalCruises.js';

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

export function indexedAirportPlaces(airports) {
  return airports
    .filter(airport => airport.country === 'KR' && airport.runways?.length)
    .map(airport => Object.freeze({
      code: airport.icao || airport.ident,
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
  const airports = await findAirportsInRegion(manifest, KOREA_CENTRE, { fetchImpl, baseUrl });
  return {
    airports: indexedAirportPlaces(airports),
    points: cruisePlaces(),
  };
}
