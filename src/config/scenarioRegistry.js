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
  challenge: {
    airports: ['incheon'],
    labelKeys: { incheon: 'incheon.challenge' },
    briefingKey: 'lobby.briefing.scenario.challenge',
    lobbyButtonId: 'lobby-preset-challenge',
  },
  cruise: {
    airports: ['coastal', 'lukla', 'incheon', 'neon'],
    labelKeys: { incheon: 'incheon.cruise', coastal: 'cruise.6.000.ft', lukla: 'himalayan.cruise.13.000.ft', neon: 'neon.cruise' },
    briefingKey: 'lobby.briefing.scenario.cruise',
    lobbyButtonId: 'lobby-preset-cru',
  },
  // Low flight along the Neon Metropolis river and under its bridges (#551); the swept
  // bridge contact is modelled for the C172, so that aircraft is selected.
  bridge: {
    airports: ['neon'],
    labelKeys: { neon: 'neon.bridge' },
    briefingKey: 'lobby.briefing.scenario.bridge',
    lobbyButtonId: 'lobby-preset-bridge',
    aircraft: 'C172',
  },
  cliff: {
    airports: ['lukla'],
    labelKeys: { lukla: 'downhill.takeoff.rwy.24' },
    briefingKey: 'lobby.briefing.scenario.cliff',
    lobbyButtonId: 'lobby-preset-cliff',
  },
  valley: {
    airports: ['valley'],
    labelKeys: { valley: 'valley.slalom.title' },
    briefingKey: 'lobby.briefing.scenario.valley',
    lobbyButtonId: 'lobby-preset-valley',
  },
  demo: {
    airports: ['coastal', 'lukla', 'incheon', 'neon'],
    labelKeys: { incheon: 'lobby.preset.demo', coastal: 'lobby.preset.demo', lukla: 'lobby.preset.demo', neon: 'lobby.preset.demo' },
    briefingKey: 'lobby.briefing.scenario.demo',
    lobbyButtonId: 'lobby-preset-demo',
  },
};

export const DEFAULT_SCENARIO = 'runway';
export const defaultScenarioForRegion = region => region === 'valley' ? 'valley' : DEFAULT_SCENARIO;

// The aircraft a scenario always flies, or undefined when any may fly it.
export function requiredAircraft(scenarioType) {
  return Object.hasOwn(SPAWN_SCENARIOS, scenarioType) ? SPAWN_SCENARIOS[scenarioType].aircraft : undefined;
}

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
