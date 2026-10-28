import { t } from '../i18n/index.js';
import { APPROACH_DATA } from '../config/approachData.js';
import { SPAWN_SCENARIOS, isScenarioAvailable } from '../config/scenarioRegistry.js';

const AIRPORT_NAME_KEYS = {
  incheon: 'incheon.airport',
  coastal: 'coastal.airport',
  lukla: 'lukla.vnlk',
  neon: 'neon.metropolis',
};

/**
 * Plain-text briefing lines for the lobby, derived from the airport's approach
 * data and the selected spawn scenario. The scenario line only appears when
 * the scenario registry offers that scenario at the selected airport.
 * DOM-free so node tests can assert it.
 */
export function lobbyBriefing(airportKey, presetType) {
  if (presetType === 'hangang' && isScenarioAvailable(airportKey, presetType)) {
    return [t('hangang.title'), t('hangang.briefing'), t('hangang.provenance')];
  }
  const data = APPROACH_DATA[airportKey];
  if (!data) return [];
  const lines = [
    t(AIRPORT_NAME_KEYS[airportKey]),
    t('lobby.briefing.runway', {
      heading: String(Math.round(data.headingDeg)).padStart(3, '0'),
      elevationFt: Math.round(data.elevationFt),
      gsAngle: data.gsAngleDeg,
    }),
  ];
  if (isScenarioAvailable(airportKey, presetType)) {
    lines.push(t(SPAWN_SCENARIOS[presetType].briefingKey));
  }
  if (airportKey === 'incheon') lines.push(t('incheon.limitations'));
  return lines;
}
