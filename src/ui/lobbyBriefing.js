import { t } from '../i18n/index.js';
import { APPROACH_DATA } from '../config/approachData.js';
import { SPAWN_SCENARIOS, isScenarioAvailable } from '../config/scenarioRegistry.js';

const AIRPORT_NAME_KEYS = {
  coastal: 'coastal.airport',
  lukla: 'lukla.vnlk',
};

/**
 * Plain-text briefing lines for the lobby, derived from the airport's approach
 * data and the selected spawn scenario. The scenario line only appears when
 * the scenario registry offers that scenario at the selected airport.
 * DOM-free so node tests can assert it.
 */
export function lobbyBriefing(airportKey, presetType) {
  const data = APPROACH_DATA[airportKey];
  if (!data) return [];
  const lines = [
    t(AIRPORT_NAME_KEYS[airportKey]),
    t('lobby.briefing.runway', {
      heading: String(data.headingDeg).padStart(3, '0'),
      elevationFt: data.elevationFt,
      gsAngle: data.gsAngleDeg,
    }),
  ];
  if (isScenarioAvailable(airportKey, presetType)) {
    lines.push(t(SPAWN_SCENARIOS[presetType].briefingKey));
  }
  return lines;
}
