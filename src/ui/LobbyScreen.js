import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';

const PRESET_LABEL_KEYS = {
  runway: { lukla: 'lukla.06.ready', coastal: 'runway.takeoff.09l' },
  approach: { lukla: 'canyon.landing', coastal: 'final.approach.3.nm' },
  cruise: { lukla: 'himalayan.cruise.13.000.ft', coastal: 'cruise.6.000.ft' },
  cliff: { lukla: 'downhill.takeoff.rwy.24', coastal: null },
};

const AIRPORT_BUTTONS = { coastal: 'lobby-airport-coastal', lukla: 'lobby-airport-lukla' };
const LANGUAGE_BUTTONS = { en: 'lobby-lang-en', ko: 'lobby-lang-ko' };
const PRESET_BUTTONS = {
  runway: 'lobby-preset-rwy',
  approach: 'lobby-preset-app',
  cruise: 'lobby-preset-cru',
  cliff: 'lobby-preset-cliff',
};

/**
 * Wire the lobby overlay (markup lives in index.html). Renders its own copies
 * of the airport/spawn/time controls so the in-game panels keep theirs; all
 * dynamic labels go through bindText so a language switch re-renders them.
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
  for (const [type, id] of Object.entries(PRESET_BUTTONS)) {
    document.getElementById(id)?.addEventListener('click', () => onPreset(type));
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
    for (const [type, id] of Object.entries(PRESET_BUTTONS)) {
      const span = document.getElementById(id)?.querySelector('span');
      if (span) {
        bindText(span, () => t(PRESET_LABEL_KEYS[type][getAirport()] ?? 'lobby.spawn'));
      }
    }
    const preset = getPreset();
    for (const [type, id] of Object.entries(PRESET_BUTTONS)) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.classList.toggle('active', type === preset);
      if (type === 'cliff') button.style.display = airport === 'lukla' ? '' : 'none';
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
