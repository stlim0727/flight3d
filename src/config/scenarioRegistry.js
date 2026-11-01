/**
 * Single source of truth for lobby spawn scenarios. Each scenario declares
 * which airports offer it, per-airport button labels, its briefing line, and
 * the DOM id of its lobby button. Consumers (LobbyScreen, lobbyBriefing,
 * Simulator.setPreset/setAirport) derive availability from this table instead
 * of duplicating airport conditionals.
 */
export { DEV_SCENARIOS } from '../dev/scenarios/index.js';

export const SPAWN_SCENARIOS = {
  runway: {
    airports: ['coastal', 'lukla', 'incheon', 'neon'],
    labelKeys: { incheon: 'incheon.runway', coastal: 'runway.takeoff.09l', lukla: 'lukla.24.ready', neon: 'neon.runway' },
    briefingKey: 'lobby.briefing.scenario.runway',
    lobbyButtonId: 'lobby-preset-rwy',
  },
  approach: {
    airports: ['coastal', 'lukla', 'incheon', 'neon'],
    labelKeys: { incheon: 'incheon.approach', coastal: 'final.approach.3.nm', lukla: 'canyon.landing', neon: 'neon.canyon' },
    briefingKey: 'lobby.briefing.scenario.approach',
    lobbyButtonId: 'lobby-preset-app',
  },
  hangang: {
    airports: ['hangang'],
    labelKeys: { hangang: 'hangang.title' },
    briefingKey: 'hangang.briefing',
    lobbyButtonId: 'lobby-preset-hangang',
  },
  cruise: {
    airports: ['coastal', 'lukla', 'incheon', 'neon'],
    labelKeys: { incheon: 'incheon.cruise', coastal: 'cruise.6.000.ft', lukla: 'himalayan.cruise.13.000.ft', neon: 'neon.cruise' },
    briefingKey: 'lobby.briefing.scenario.cruise',
    lobbyButtonId: 'lobby-preset-cru',
  },
  cliff: {
    airports: ['lukla'],
    labelKeys: { lukla: 'downhill.takeoff.rwy.24' },
    briefingKey: 'lobby.briefing.scenario.cliff',
    lobbyButtonId: 'lobby-preset-cliff',
  },
  valley: {
    airports: ['lukla'],
    labelKeys: { lukla: 'valley.slalom.title' },
    briefingKey: 'lobby.briefing.scenario.valley',
    lobbyButtonId: 'lobby-preset-valley',
  },
  demo: {
    airports: ['coastal', 'lukla', 'incheon'],
    labelKeys: { incheon: 'lobby.preset.demo', coastal: 'lobby.preset.demo', lukla: 'lobby.preset.demo' },
    briefingKey: 'lobby.briefing.scenario.demo',
    lobbyButtonId: 'lobby-preset-demo',
  },
};

export const DEFAULT_SCENARIO = 'runway';
export const defaultScenarioForRegion = region => region === 'hangang' ? 'hangang' : DEFAULT_SCENARIO;

export function isScenarioAvailable(airportKey, scenarioType) {
  const scenario = Object.hasOwn(SPAWN_SCENARIOS, scenarioType) ? SPAWN_SCENARIOS[scenarioType] : undefined;
  return Boolean(scenario && airportKey && scenario.airports.includes(airportKey));
}

export function scenariosForAirport(airportKey) {
  return Object.keys(SPAWN_SCENARIOS).filter((type) => isScenarioAvailable(airportKey, type));
}

export function scenarioLabelKey(airportKey, scenarioType) {
  const scenario = Object.hasOwn(SPAWN_SCENARIOS, scenarioType) ? SPAWN_SCENARIOS[scenarioType] : undefined;
  return scenario ? scenario.labelKeys[airportKey] : undefined;
}
