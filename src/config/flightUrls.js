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

export function flightCombinations() {
  return VALID_AIRPORTS.flatMap(airport => Object.keys(AIRCRAFT_REGISTRY).flatMap(aircraft =>
    scenariosForAirport(airport).flatMap(scenario => {
      if (requiredAircraft(scenario) && aircraft !== requiredAircraft(scenario)) return [];
      if (airport === 'valley' && aircraft !== 'F16') return [];
      if (resolveScenario(scenario, airport, aircraft) !== scenario) return [];
      return [{ airport, aircraft, scenario }];
    })));
}
