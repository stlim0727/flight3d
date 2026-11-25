import { AIRCRAFT_REGISTRY } from './aircraftConfigs.js';
import { VALID_AIRPORTS, resolveFlightSelection, resolveScenario } from './flightSelection.js';
import { requiredAircraft, scenariosForAirport } from './scenarioRegistry.js';

export const FLIGHT_BASE_URL = 'https://stlim0727.github.io/flight3d/';

/** URL choices override preferences; omitted choices retain saved values. */
export function resolveFlightUrl(search, saved) {
  const params = new URLSearchParams(search);
  return resolveFlightSelection({ airport: params.get('terrain') ?? saved.airport,
    aircraft: params.get('aircraft') ?? saved.aircraft, scenario: params.get('scenario') ?? saved.scenario });
}

export function flightUrl({ airport, aircraft, scenario }, base = FLIGHT_BASE_URL) {
  const url = new URL(base);
  url.search = new URLSearchParams({ aircraft, terrain: airport, scenario }).toString();
  return url.href;
}

export function parsePoseUrlParams(search) {
  if (!search) return null;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const latStr = params.get('lat') ?? params.get('latitude');
  const lonStr = params.get('lon') ?? params.get('longitude');
  const xStr = params.get('x');
  const zStr = params.get('z');
  const altStr = params.get('alt') ?? params.get('altitude') ?? params.get('height') ?? params.get('y');
  const hdgStr = params.get('heading') ?? params.get('hdg') ?? params.get('yaw');
  const freezeStr = params.get('freeze') ?? params.get('pause') ?? params.get('fixed');
  const camStr = params.get('camera') ?? params.get('cam');

  const hasGeo = latStr !== null && lonStr !== null;
  const hasLocal = xStr !== null && zStr !== null;
  if (!hasGeo && !hasLocal) return null;

  const lat = hasGeo ? Number(latStr) : null;
  const lon = hasGeo ? Number(lonStr) : null;
  const x = hasLocal ? Number(xStr) : null;
  const z = hasLocal ? Number(zStr) : null;
  const alt = altStr !== null ? Number(altStr) : null;
  const heading = hdgStr !== null ? Number(hdgStr) : 0;
  const freeze = freezeStr !== null ? (freezeStr !== '0' && freezeStr !== 'false') : true;

  if (hasGeo && (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
    return null;
  }
  if (hasLocal && (!Number.isFinite(x) || !Number.isFinite(z))) {
    return null;
  }

  return {
    lat,
    lon,
    x,
    z,
    alt: Number.isFinite(alt) ? alt : null,
    heading: Number.isFinite(heading) ? heading : 0,
    freeze,
    camera: camStr || 'chase',
  };
}

export function flightCombinations() {
  return VALID_AIRPORTS.flatMap(airport => Object.keys(AIRCRAFT_REGISTRY).flatMap(aircraft =>
    scenariosForAirport(airport).flatMap(scenario => {
      if (requiredAircraft(scenario) && aircraft !== requiredAircraft(scenario)) return [];
      if (airport === 'valley' && aircraft !== 'F16') return [];
      if (resolveScenario(scenario, airport, aircraft) !== scenario) return [];
      return [{ airport, aircraft, scenario }];
    })));
}
