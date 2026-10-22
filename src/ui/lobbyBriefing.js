import { t } from '../i18n/index.js';
import { APPROACH_DATA } from '../config/approachData.js';

const AIRPORT_NAME_KEYS = {
  coastal: 'coastal.airport',
  lukla: 'lukla.vnlk',
};

const SCENARIO_KEYS = {
  runway: 'lobby.briefing.scenario.runway',
  approach: 'lobby.briefing.scenario.approach',
  cruise: 'lobby.briefing.scenario.cruise',
  cliff: 'lobby.briefing.scenario.cliff',
};

/**
 * Plain-text briefing lines for the lobby, derived from the airport's approach
 * data and the selected spawn scenario. DOM-free so node tests can assert it.
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
  const scenarioKey = SCENARIO_KEYS[presetType];
  if (scenarioKey && !(airportKey === 'coastal' && presetType === 'cliff')) {
    lines.push(t(scenarioKey));
  }
  return lines;
}
