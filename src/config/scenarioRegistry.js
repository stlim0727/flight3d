/**
 * Single source of truth for lobby spawn scenarios. Each scenario declares
 * which airports offer it, per-airport button labels, its briefing line, and
 * the DOM ids of its lobby/in-game buttons. Consumers (LobbyScreen,
 * lobbyBriefing, Simulator.setPreset/setAirport) derive availability from
 * this table instead of duplicating airport conditionals.
 */
export const SPAWN_SCENARIOS = {
  runway: {
    airports: ['coastal', 'lukla'],
    labelKeys: { coastal: 'runway.takeoff.09l', lukla: 'lukla.06.ready' },
    briefingKey: 'lobby.briefing.scenario.runway',
    lobbyButtonId: 'lobby-preset-rwy',
    barButtonId: 'btn-preset-rwy',
  },
  approach: {
    airports: ['coastal', 'lukla'],
    labelKeys: { coastal: 'final.approach.3.nm', lukla: 'canyon.landing' },
    briefingKey: 'lobby.briefing.scenario.approach',
    lobbyButtonId: 'lobby-preset-app',
    barButtonId: 'btn-preset-app',
  },
  cruise: {
    airports: ['coastal', 'lukla'],
    labelKeys: { coastal: 'cruise.6.000.ft', lukla: 'himalayan.cruise.13.000.ft' },
    briefingKey: 'lobby.briefing.scenario.cruise',
    lobbyButtonId: 'lobby-preset-cru',
    barButtonId: 'btn-preset-cru',
  },
  cliff: {
    airports: ['lukla'],
    labelKeys: { lukla: 'downhill.takeoff.rwy.24' },
    briefingKey: 'lobby.briefing.scenario.cliff',
    lobbyButtonId: 'lobby-preset-cliff',
    barButtonId: 'btn-preset-cliff',
  },
};

export const DEFAULT_SCENARIO = 'runway';

export function isScenarioAvailable(airportKey, scenarioType) {
  const scenario = SPAWN_SCENARIOS[scenarioType];
  return Boolean(scenario && airportKey && scenario.airports.includes(airportKey));
}

export function scenariosForAirport(airportKey) {
  return Object.keys(SPAWN_SCENARIOS).filter((type) => isScenarioAvailable(airportKey, type));
}

export function scenarioLabelKey(airportKey, scenarioType) {
  const scenario = SPAWN_SCENARIOS[scenarioType];
  return scenario ? scenario.labelKeys[airportKey] : undefined;
}
