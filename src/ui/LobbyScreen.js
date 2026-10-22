import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, scenarioLabelKey } from '../config/scenarioRegistry.js';

const AIRPORT_BUTTONS = { coastal: 'lobby-airport-coastal' };
const LANGUAGE_BUTTONS = { en: 'lobby-lang-en', ko: 'lobby-lang-ko' };

/**
 * Wire the lobby overlay (markup lives in index.html); it is the only place
 * spawn scenarios and airports are chosen. All dynamic labels go through
 * bindText so a language switch re-renders them.
 */
export function initLobbyScreen({ getAirport, getPreset, getTime, onAirport, onPreset, onTime, onFly }) {
  const briefingEl = document.getElementById('lobby-briefing');
  const loadingEl = document.getElementById('lobby-loading');
  const timeSelect = document.getElementById('lobby-time-select');

  for (const [id, handler] of [
    ['btn-fly', onFly],
    ['lobby-airport-coastal', () => onAirport('coastal')],
  ]) {
    document.getElementById(id)?.addEventListener('click', handler);
  }
  for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
    document.getElementById(scenario.lobbyButtonId)?.addEventListener('click', () => onPreset(type));
  }
  for (const [code, id] of Object.entries(LANGUAGE_BUTTONS)) {
    document.getElementById(id)?.addEventListener('click', () => {
      if (setLanguage(code)) refresh();
    });
  }
  timeSelect?.addEventListener('change', () => {
    const hours = Number.parseFloat(timeSelect.value);
    if (Number.isFinite(hours)) onTime(hours);
  });

  function refresh() {
    for (const [code, id] of Object.entries(LANGUAGE_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', code === getLanguage());
    }
    const airport = getAirport();
    for (const [key, id] of Object.entries(AIRPORT_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', key === airport);
    }
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      const span = document.getElementById(scenario.lobbyButtonId)?.querySelector('span');
      if (span) {
        bindText(span, () => t(scenarioLabelKey(getAirport(), type) ?? 'lobby.spawn'));
      }
    }
    const preset = getPreset();
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      const button = document.getElementById(scenario.lobbyButtonId);
      if (!button) continue;
      button.classList.toggle('active', type === preset);
      button.style.display = isScenarioAvailable(airport, type) ? '' : 'none';
    }
    if (briefingEl) {
      bindText(briefingEl, () => lobbyBriefing(getAirport(), getPreset()).join('\n'));
    }
    if (timeSelect) timeSelect.value = String(getTime());
  }

  function setWaitingForTerrain(waiting) {
    if (loadingEl) loadingEl.hidden = !waiting;
  }

  refresh();
  return { refresh, setWaitingForTerrain };
}
