import { demoProfiles, resolveDemoProfile } from '../director/demoProfiles.js';
import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';
import { aircraftSpec, airportSpec } from './lobbySpecs.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, scenarioLabelKey } from '../config/scenarioRegistry.js';

const AIRPORT_BUTTONS = { hangang: 'lobby-airport-hangang', incheon: 'lobby-airport-incheon', coastal: 'lobby-airport-coastal', lukla: 'lobby-airport-lukla', neon: 'lobby-airport-neon' };
const AIRCRAFT_BUTTONS = { B738: 'lobby-aircraft-b738', C172: 'lobby-aircraft-c172', F16: 'lobby-aircraft-f16' };
/** Aircraft the lobby offers, so warmup can prepare exactly this set. */
export const LOBBY_AIRCRAFT_IDS = Object.keys(AIRCRAFT_BUTTONS);
const LANGUAGE_BUTTONS = { en: 'lobby-lang-en', ko: 'lobby-lang-ko' };

/**
 * Wire the lobby overlay (markup lives in index.html); it is the only place
 * spawn scenarios and airports are chosen. All dynamic labels go through
 * bindText so a language switch re-renders them.
 */
export function initLobbyScreen({ getAirport, getPreset, getTime, getAircraft, onAirport, onPreset, onTime, onAircraft, onFly, getDemoProfile, onDemoProfile }) {
  const briefingEl = document.getElementById('lobby-briefing');
  const loadingEl = document.getElementById('lobby-loading');
  const selectionEl = document.getElementById('lobby-selection');
  const demoGroup = document.getElementById('lobby-demo-options');
  const demoSelect = document.getElementById('lobby-demo-select');
  const demoBriefing = document.getElementById('lobby-demo-briefing');
  demoSelect?.addEventListener('change', () => { onDemoProfile?.(demoSelect.value); refresh(); });
  const timeSelect = document.getElementById('lobby-time-select');

  // Quick-pick chips mirror the select, which stays the source of truth.
  const timeChips = document.createElement('div');
  timeChips.className = 'lobby-buttons lobby-time-chips';
  timeChips.setAttribute('role', 'group');
  for (const option of timeSelect?.options ?? []) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'btn lobby-time-chip';
    chip.dataset.hours = option.value;
    chip.textContent = option.textContent;
    chip.addEventListener('click', () => {
      timeSelect.value = option.value;
      timeSelect.dispatchEvent(new Event('change'));
    });
    timeChips.append(chip);
  }
  timeSelect?.parentElement?.append(timeChips);

  const tabs = [...document.querySelectorAll('.lobby-tab')];
  function selectTab(selected, focus = false) {
    document.getElementById('btn-fly').hidden = selected.id === 'lobby-tab-dev';
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    document.querySelector('.lobby-panels').scrollTop = 0;
    if (focus) selected.focus();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      const visibleTabs = tabs.filter(item => !item.hidden);
      const index = visibleTabs.indexOf(tab);
      if (event.key === 'ArrowRight') next = (index + 1) % visibleTabs.length;
      if (event.key === 'ArrowLeft') next = (index + visibleTabs.length - 1) % visibleTabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = visibleTabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(visibleTabs[next], true);
    });
  }

  for (const [id, handler] of [
    ['btn-fly', onFly],
    ['lobby-airport-hangang', () => onAirport('hangang')],
    ['lobby-airport-coastal', () => onAirport('coastal')],
    ['lobby-airport-incheon', () => onAirport('incheon')],
    ['lobby-airport-lukla', () => onAirport('lukla')],
    ['lobby-airport-neon', () => onAirport('neon')],
    ['lobby-aircraft-b738', () => onAircraft?.('B738')],
    ['lobby-aircraft-c172', () => onAircraft?.('C172')],
    ['lobby-aircraft-f16', () => onAircraft?.('F16')],
  ]) {
    document.getElementById(id)?.addEventListener('click', handler);
  }
  for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
    document.getElementById(scenario.lobbyButtonId)?.addEventListener('click', () => {
      onPreset(type);
      if (type === 'demo') demoGroup?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
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
    for (const badge of document.querySelectorAll('[data-spec-aircraft]')) {
      bindText(badge, () => aircraftSpec(badge.dataset.specAircraft));
    }
    for (const badge of document.querySelectorAll('[data-spec-airport]')) {
      bindText(badge, () => airportSpec(badge.dataset.specAirport));
    }
    for (const [code, id] of Object.entries(LANGUAGE_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', code === getLanguage());
    }
    const airport = getAirport();
    for (const [key, id] of Object.entries(AIRPORT_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', key === airport);
    }
    const aircraft = getAircraft?.() ?? 'B738';
    for (const [key, id] of Object.entries(AIRCRAFT_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', key === aircraft);
      document.getElementById(id).disabled = airport === 'hangang';
    }
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      const span = document.getElementById(scenario.lobbyButtonId)?.querySelector('span');
      if (span) {
        bindText(span, () => t(scenarioLabelKey(getAirport(), type) ?? 'lobby.spawn'));
      }
    }
    if ((aircraft === 'F16' && !['lukla','incheon'].includes(airport)) && getPreset() === 'demo') onPreset('runway');
    const preset = getPreset();
    // Follow the selected flight even while the menu is closed. The live
    // binding also refreshes the browser tab when the language changes.
    bindText(document.querySelector('title'), () => {
      const airport = getAirport();
      const preset = getPreset();
      const labelKey = scenarioLabelKey(airport, preset);
      return [...new Set(['Flight3d', AIRCRAFT_REGISTRY[getAircraft?.() ?? 'B738']?.name,
        lobbyBriefing(airport, preset)[0], labelKey && t(labelKey)].filter(Boolean))].join(' | ');
    });
    if (demoGroup) demoGroup.hidden = preset !== 'demo';
    if (demoSelect) {
      const choices = demoProfiles(aircraft, airport);
      const selected = resolveDemoProfile(aircraft, airport, getDemoProfile?.());
      onDemoProfile?.(selected.id);
      demoSelect.replaceChildren(...choices.map(choice => {
        const option = document.createElement('option');
        option.value = choice.id;
        option.textContent = t(choice.labelKey);
        return option;
      }));
      demoSelect.value = selected.id;
      if (demoBriefing) bindText(demoBriefing, () => t(resolveDemoProfile(getAircraft?.(), getAirport(), getDemoProfile?.()).briefingKey));
    }
    const flyLabel = document.getElementById('btn-fly')?.querySelector('span');
    if (flyLabel) bindText(flyLabel, () => t(getPreset() === 'demo' ? 'demo.watch' : 'lobby.fly'));
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      const button = document.getElementById(scenario.lobbyButtonId);
      if (!button) continue;
      button.classList.toggle('active', type === preset);
      button.style.display = isScenarioAvailable(airport, type) && !((aircraft === 'F16' && !['lukla','incheon'].includes(airport)) && type === 'demo') ? '' : 'none';
    }
    if (briefingEl) {
      bindText(briefingEl, () => lobbyBriefing(getAirport(), getPreset()).join('\n'));
    }
    if (timeSelect) {
      timeSelect.disabled = airport === 'hangang';
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
      for (const chip of timeChips.children) {
        const on = chip.dataset.hours === timeSelect.value;
        chip.classList.toggle('active', on);
        chip.setAttribute('aria-pressed', String(on));
        chip.disabled = timeSelect.disabled;
      }
    }
  }

  function setWaitingForTerrain(waiting) {
    if (loadingEl) loadingEl.hidden = !waiting;
  }

  /** Show that a choice is being applied while the host defers the heavy work. */
  function setSelectionBusy(busy) {
    if (selectionEl) selectionEl.hidden = !busy;
    const flyBtn = document.getElementById('btn-fly');
    if (flyBtn) flyBtn.disabled = busy;
  }

  refresh();
  return { refresh, setWaitingForTerrain, setSelectionBusy };
}
