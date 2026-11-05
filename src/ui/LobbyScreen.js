import { demoProfiles, resolveDemoProfile } from '../director/demoProfiles.js';
import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';
import { aircraftSpec, airportSpec } from './lobbySpecs.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, scenarioLabelKey } from '../config/scenarioRegistry.js';

const AIRPORT_BUTTONS = { hangang: 'lobby-airport-hangang', incheon: 'lobby-airport-incheon', coastal: 'lobby-airport-coastal', lukla: 'lobby-airport-lukla', neon: 'lobby-airport-neon', valley: 'lobby-airport-valley' };
const AIRCRAFT_BUTTONS = { B738: 'lobby-aircraft-b738', C172: 'lobby-aircraft-c172', F16: 'lobby-aircraft-f16' };
/** Aircraft the lobby offers, so warmup can prepare exactly this set. */
export const LOBBY_AIRCRAFT_IDS = Object.keys(AIRCRAFT_BUTTONS);
const LANGUAGE_BUTTONS = { en: 'lobby-lang-en', ko: 'lobby-lang-ko' };

/**
 * Wire the lobby overlay (markup lives in index.html); it is the only place
 * spawn scenarios and airports are chosen. All dynamic labels go through
 * bindText so a language switch re-renders them.
 */
export function initLobbyScreen({ getAirport, getPreset, getTime, isDeviceTime = () => false, getAircraft, onAirport, onPreset, onTime, onDeviceTime = () => {}, onAircraft, onFly, canResume = () => false, canEnd = canResume, onResume, getDemoProfile, onDemoProfile, getPilotMode = () => 'human', onPilotMode = () => {}, onToggleGyro = () => {}, isGyroActive = () => false }) {
  const briefingEl = document.getElementById('lobby-briefing');
  const loadingEl = document.getElementById('lobby-loading');
  const selectionEl = document.getElementById('lobby-selection');
  const demoGroup = document.getElementById('lobby-demo-options');
  const demoSelect = document.getElementById('lobby-demo-select');
  const demoBriefing = document.getElementById('lobby-demo-briefing');
  demoSelect?.addEventListener('change', () => { onDemoProfile?.(demoSelect.value); refresh(); });
  const valleyGroup = document.getElementById('lobby-valley-options');
  const pilotHumanBtn = document.getElementById('lobby-pilot-human');
  const pilotAiBtn = document.getElementById('lobby-pilot-ai');
  const valleyGyroBtn = document.getElementById('lobby-valley-gyro');
  const valleySettingsBtn = document.getElementById('lobby-valley-settings');

  pilotHumanBtn?.addEventListener('click', () => {
    onPilotMode('human');
    refresh();
  });
  pilotAiBtn?.addEventListener('click', () => {
    onPilotMode('ai');
    refresh();
  });
  valleyGyroBtn?.addEventListener('click', async () => {
    await onToggleGyro();
    refresh();
  });
  valleySettingsBtn?.addEventListener('click', () => {
    document.getElementById('lobby-tab-settings')?.click();
  });
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
    if (option.dataset.i18n) bindText(chip, () => t(option.dataset.i18n));
    else chip.textContent = option.textContent;
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
    ['btn-lobby-resume', () => onResume?.()],
    ['lobby-airport-hangang', () => onAirport('hangang')],
    ['lobby-airport-coastal', () => onAirport('coastal')],
    ['lobby-airport-incheon', () => onAirport('incheon')],
    ['lobby-airport-lukla', () => onAirport('lukla')],
    ['lobby-airport-neon', () => onAirport('neon')],
    ['lobby-airport-valley', () => onAirport('valley')],
    ['lobby-aircraft-b738', () => onAircraft?.('B738')],
    ['lobby-aircraft-c172', () => onAircraft?.('C172')],
    ['lobby-aircraft-f16', () => onAircraft?.('F16')],
  ]) {
    document.getElementById(id)?.addEventListener('click', handler);
  }
  for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
    if (type === 'demo') continue;
    document.getElementById(scenario.lobbyButtonId)?.addEventListener('click', () => {
      onPreset(type);
    });
  }
  const demoPresetBtn = document.getElementById(SPAWN_SCENARIOS.demo.lobbyButtonId);
  demoPresetBtn?.addEventListener('click', () => {
    const airport = getAirport();
    const aircraft = getAircraft?.() ?? 'B738';
    const choices = demoProfiles(aircraft, airport);
    onPreset('demo');
    const profileId = demoPresetBtn.dataset.profileId || choices[0]?.id;
    if (profileId) {
      onDemoProfile?.(profileId);
      if (demoSelect) demoSelect.value = profileId;
    }
    refresh();
    demoGroup?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  });
  for (const [code, id] of Object.entries(LANGUAGE_BUTTONS)) {
    document.getElementById(id)?.addEventListener('click', () => {
      if (setLanguage(code)) refresh();
    });
  }
  timeSelect?.addEventListener('change', () => {
    if (timeSelect.value === 'now') {
      onDeviceTime();
      return;
    }
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
      document.getElementById(id).disabled = airport === 'hangang' || airport === 'valley';
    }
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      if (type === 'demo') continue;
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
      const scenarioTitle = preset === 'demo'
        ? t('demo.scenario.title', { title: t(resolveDemoProfile(getAircraft?.(), airport, getDemoProfile?.()).labelKey) })
        : (labelKey && t(labelKey));
      return [...new Set(['Flight3d', AIRCRAFT_REGISTRY[getAircraft?.() ?? 'B738']?.name,
        lobbyBriefing(airport, preset)[0], scenarioTitle].filter(Boolean))].join(' | ');
    });
    if (demoGroup) demoGroup.hidden = preset !== 'demo';
    if (valleyGroup) valleyGroup.hidden = preset !== 'valley';
    const pilotMode = getPilotMode();
    if (pilotHumanBtn) {
      pilotHumanBtn.classList.toggle('active', pilotMode === 'human');
      pilotHumanBtn.setAttribute('aria-checked', String(pilotMode === 'human'));
    }
    if (pilotAiBtn) {
      pilotAiBtn.classList.toggle('active', pilotMode === 'ai');
      pilotAiBtn.setAttribute('aria-checked', String(pilotMode === 'ai'));
    }
    const preflightBox = document.getElementById('lobby-valley-preflight');
    if (preflightBox) {
      preflightBox.hidden = pilotMode !== 'human';
    }
    if (valleyGyroBtn) {
      const gyroOn = Boolean(isGyroActive());
      valleyGyroBtn.classList.toggle('active', gyroOn);
      const gyroLabel = valleyGyroBtn.querySelector('.gyro-label');
      if (gyroLabel) {
        bindText(gyroLabel, () => t(gyroOn ? 'gyro.on' : 'gyro.off'));
      }
    }
    const isDemoAvail = isScenarioAvailable(airport, 'demo') && !(aircraft === 'F16' && !['lukla', 'incheon'].includes(airport));
    const choices = isDemoAvail ? demoProfiles(aircraft, airport) : [];
    const selected = resolveDemoProfile(aircraft, airport, getDemoProfile?.());
    onDemoProfile?.(selected.id);
    if (demoSelect) {
      demoSelect.replaceChildren(...choices.map(choice => {
        const option = document.createElement('option');
        option.value = choice.id;
        option.textContent = t(choice.labelKey);
        return option;
      }));
      demoSelect.value = selected.id;
      if (demoBriefing) bindText(demoBriefing, () => t(resolveDemoProfile(getAircraft?.(), getAirport(), getDemoProfile?.()).briefingKey));
    }
    if (demoPresetBtn) {
      if (choices.length === 0) {
        demoPresetBtn.style.display = 'none';
        delete demoPresetBtn.dataset.profileId;
      } else {
        demoPresetBtn.style.display = '';
        demoPresetBtn.dataset.profileId = choices[0].id;
        const span = demoPresetBtn.querySelector('span');
        if (span) {
          bindText(span, () => t('demo.scenario.title', { title: t(choices[0].labelKey) }));
        }
      }
    }
    const extraChoices = choices.slice(1);
    const existingExtras = [...document.querySelectorAll('.lobby-scenarios .btn-demo-extra')];
    while (existingExtras.length > extraChoices.length) {
      existingExtras.pop().remove();
    }
    let prevElement = demoPresetBtn;
    for (let i = 0; i < extraChoices.length; i++) {
      const choice = extraChoices[i];
      let btn = existingExtras[i];
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'btn btn-preset btn-demo-scenario btn-demo-extra';
        const span = document.createElement('span');
        btn.appendChild(span);
        prevElement?.insertAdjacentElement('afterend', btn);
      }
      btn.dataset.profileId = choice.id;
      btn.onclick = () => {
        onPreset('demo');
        onDemoProfile?.(choice.id);
        if (demoSelect) demoSelect.value = choice.id;
        refresh();
        demoGroup?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      };
      const span = btn.querySelector('span');
      if (span) {
        bindText(span, () => t('demo.scenario.title', { title: t(choice.labelKey) }));
      }
      prevElement = btn;
    }
    const flyLabel = document.getElementById('btn-fly')?.querySelector('span');
    if (flyLabel) bindText(flyLabel, () => t(getPreset() === 'demo' ? 'lobby.startDemo' : 'lobby.startNew'));
    const resume = document.getElementById('btn-lobby-resume');
    if (resume) resume.hidden = !canResume();
    const end = document.getElementById('btn-lobby-end');
    if (end) end.hidden = !canEnd();
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      if (type === 'demo') continue;
      const button = document.getElementById(scenario.lobbyButtonId);
      if (!button) continue;
      button.classList.toggle('active', type === preset);
      button.style.display = isScenarioAvailable(airport, type) ? '' : 'none';
    }
    if (demoPresetBtn) {
      demoPresetBtn.classList.toggle('active', preset === 'demo' && demoPresetBtn.dataset.profileId === selected.id);
    }
    for (const extraBtn of document.querySelectorAll('.lobby-scenarios .btn-demo-extra')) {
      extraBtn.classList.toggle('active', preset === 'demo' && extraBtn.dataset.profileId === selected.id);
    }
    if (briefingEl) {
      bindText(briefingEl, () => lobbyBriefing(getAirport(), getPreset()).join('\n'));
    }
    if (timeSelect) {
      timeSelect.disabled = airport === 'hangang' || airport === 'valley';
      // The clock is continuous (and float-modulo noisy after restore), so show
      // the nearest preset option rather than requiring an exact value match.
      // Distance wraps at midnight so 23:50 shows 22:30, not 06:30.
      const hours = getTime();
      const clockDistance = value => {
        const d = Math.abs(value - hours) % 24;
        return Math.min(d, 24 - d);
      };
      let nearest = null;
      for (const option of timeSelect.options) {
        const value = Number.parseFloat(option.value);
        if (!Number.isFinite(value)) continue;
        if (nearest === null || clockDistance(value) < clockDistance(nearest)) nearest = value;
      }
      if (isDeviceTime()) timeSelect.value = 'now';
      else if (nearest !== null) timeSelect.value = String(nearest);
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
    const resume = document.getElementById('btn-lobby-resume');
    if (resume) resume.disabled = busy;
  }

  refresh();
  return { refresh, setWaitingForTerrain, setSelectionBusy };
}
