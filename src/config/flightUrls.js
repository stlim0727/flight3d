import { AIRCRAFT_REGISTRY } from './aircraftConfigs.js';
import { VALID_AIRPORTS, resolveAirport, resolveAircraft, resolveScenario } from './flightSelection.js';
import { scenariosForAirport } from './scenarioRegistry.js';

export const FLIGHT_BASE_URL = 'https://stlim0727.github.io/flight3d/';

/** URL choices override preferences; omitted choices retain saved values. */
export function resolveFlightUrl(search, saved) {
  const params = new URLSearchParams(search);
  const airport = resolveAirport(params.get('terrain') ?? saved.airport);
  const aircraft = airport === 'hangang' ? 'C172' : airport === 'valley' ? 'F16' : resolveAircraft(params.get('aircraft') ?? saved.aircraft);
  const scenario = resolveScenario(params.get('scenario') ?? saved.scenario, airport, aircraft);
  return { airport, aircraft, scenario };
}

export function flightUrl({ airport, aircraft, scenario }, base = FLIGHT_BASE_URL) {
  const url = new URL(base);
  url.search = new URLSearchParams({ aircraft, terrain: airport, scenario }).toString();
  return url.href;
}

export function flightCombinations() {
  return VALID_AIRPORTS.flatMap(airport => Object.keys(AIRCRAFT_REGISTRY).flatMap(aircraft =>
    scenariosForAirport(airport).flatMap(scenario => {
      if (airport === 'hangang' && aircraft !== 'C172') return [];
      if (airport === 'valley' && aircraft !== 'F16') return [];
      if (resolveScenario(scenario, airport, aircraft) !== scenario) return [];
      return [{ airport, aircraft, scenario }];
    })));
}
