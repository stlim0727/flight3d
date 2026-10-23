import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, scenarioLabelKey } from '../config/scenarioRegistry.js';

const AIRPORT_BUTTONS = { coastal: 'lobby-airport-coastal', lukla: 'lobby-airport-lukla' };
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

  const tabs = [...document.querySelectorAll('.lobby-tab')];
  function selectTab(selected, focus = false) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    document.querySelector('.lobby-panels').scrollTop = 0;
    if (focus) selected.focus();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next], true);
    });
  }

  for (const [id, handler] of [
    ['btn-fly', onFly],
    ['lobby-airport-coastal', () => onAirport('coastal')],
    ['lobby-airport-lukla', () => onAirport('lukla')],
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
    if (timeSelect) {
      // The clock is continuous (and float-modulo noisy after restore), so show
      // the nearest preset option rather than requiring an exact value match.
      const hours = getTime();
      let nearest = null;
      for (const option of timeSelect.options) {
        const value = Number.parseFloat(option.value);
        if (!Number.isFinite(value)) continue;
        if (nearest === null || Math.abs(value - hours) < Math.abs(nearest - hours)) nearest = value;
      }
      if (nearest !== null) timeSelect.value = String(nearest);
    }
  }

  function setWaitingForTerrain(waiting) {
    if (loadingEl) loadingEl.hidden = !waiting;
  }

  refresh();
  return { refresh, setWaitingForTerrain };
}
