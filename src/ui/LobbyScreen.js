import { REGIONAL_CRUISES, regionalCruise } from '../config/regionalCruises.js';
import { demoProfiles, resolveDemoProfile } from '../director/demoProfiles.js';
import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';
import { aircraftSpec, airportSpec } from './lobbySpecs.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, requiredAircraft, scenarioLabelKey } from '../config/scenarioRegistry.js';
import { REGION_NAME_KEYS } from '../world/UnifiedWorld.js';
import { DESTINATION_CHOICES, resolveDestination, saveSavedDestination } from '../config/flightSelection.js';
import { searchMapPlaces } from '../config/airportSearch.js';
import { loadBookmarks, toggleBookmark, bookmarkKey, isBookmarked } from '../config/airportBookmarks.js';
import { indexedAirportPlaces } from '../config/mapFlightPlaces.js';
import { loadAirportManifest, findAirportByCode } from '../geospatial/airportIndex.js';
import { mapViewBoxFor, projectToMap } from './mapBrowser.js';
const AIRPORT_BUTTONS = { incheon: 'lobby-airport-incheon', jeju: 'lobby-airport-jeju', coastal: 'lobby-airport-coastal', lukla: 'lobby-airport-lukla', neon: 'lobby-airport-neon', valley: 'lobby-airport-valley' };
const AIRCRAFT_BUTTONS = { B738: 'lobby-aircraft-b738', C172: 'lobby-aircraft-c172', F16: 'lobby-aircraft-f16' };
/** Aircraft the lobby offers, so warmup can prepare exactly this set. */
export const LOBBY_AIRCRAFT_IDS = Object.keys(AIRCRAFT_BUTTONS);
const LANGUAGE_BUTTONS = { en: 'lobby-lang-en', ko: 'lobby-lang-ko' };
/** Airports that keep their own sky time (Neon is always night), so the lobby clock picker is locked. */
const FIXED_TIME_AIRPORTS = new Set(['neon', 'valley']);

function formatFlightTime(hours, deviceTime = false) {
  if (deviceTime) return t('lobby.time.now');
  if (!Number.isFinite(hours)) return '--:--';
  const totalMinutes = Math.round(((hours % 24 + 24) % 24) * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Wire the lobby overlay (markup lives in index.html); it is the only place
 * spawn scenarios and airports are chosen. All dynamic labels go through
 * bindText so a language switch re-renders them.
 */
export function initLobbyScreen({ getAirport, getPreset, getTime, isDeviceTime = () => false, getAircraft, onAirport, onPreset, onTime, onDeviceTime = () => {}, onAircraft, onFly, onRestart, canResume = () => false, canEnd = canResume, onResume, getDemoProfile, onDemoProfile, getPilotMode = () => 'human', onPilotMode = () => {}, onToggleGyro = () => {}, isGyroActive = () => false, onTabChange = () => {}, getDestination = () => 'none', onDestination = () => {}, getMapPlan = () => null, onMapPlan = () => {}, onMapPlacesAdded = () => {} }) {
  const briefingEl = document.getElementById('lobby-briefing');
  const loadingEl = document.getElementById('lobby-loading');
  const selectionEl = document.getElementById('lobby-selection');
  const demoGroup = document.getElementById('lobby-demo-options');
  const demoSelect = document.getElementById('lobby-demo-select');
  const demoBriefing = document.getElementById('lobby-demo-briefing');
  demoSelect?.addEventListener('change', () => { onDemoProfile?.(demoSelect.value); refresh(); });
  const destinationSelect = document.getElementById('lobby-destination');
  if (destinationSelect) {
    for (const id of DESTINATION_CHOICES) {
      const option = document.createElement('option');
      option.value = id;
      destinationSelect.append(option);
    }
    destinationSelect.addEventListener('change', () => {
      const value = resolveDestination(destinationSelect.value);
      saveSavedDestination(value);
      onDestination?.(value);
      refresh();
    });
  }

  // Optional map flight plan. Departure defaults to "not selected"; the
  // existing region buttons remain the scene anchor and are never forced.
  const mapStateSelect = document.getElementById('lobby-map-state');
  const mapAirportSelect = document.getElementById('lobby-map-airport');
  const mapRunwaySelect = document.getElementById('lobby-map-runway');
  const mapPointSelect = document.getElementById('lobby-map-point');
  const mapDepartureSelect = document.getElementById('lobby-map-departure');
  const mapSearchInput = document.getElementById('lobby-map-search');
  const mapResults = document.getElementById('lobby-map-results');
  const mapBookmarksEl = document.getElementById('lobby-map-bookmarks');
  const mapBookmarkToggle = document.getElementById('lobby-map-bookmark-toggle');
  const mapSvg = document.getElementById('lobby-map-svg');
  const mapMarkers = document.getElementById('lobby-map-markers');
  const mapStatus = document.getElementById('lobby-map-search-status');
  const mapBrowserControls = [mapSearchInput, mapBookmarkToggle, mapResults, mapBookmarksEl, mapMarkers].filter(Boolean);
  let mapBookmarks = loadBookmarks();
  const mapSelects = [mapStateSelect, mapAirportSelect, mapRunwaySelect, mapPointSelect, mapDepartureSelect].filter(Boolean);
  let mapCatalog = { airports: [], points: [] };
  const mapStateLabel = state => state === 'none'
    ? t('lobby.map.none')
    : t({ runway: 'incheon.runway', cruise: 'incheon.cruise', approach: 'incheon.approach' }[state] ?? state);
  const addOption = (select, value, label) => {
    if (!select) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  };
  for (const state of ['none', 'runway', 'cruise', 'approach']) addOption(mapStateSelect, state, mapStateLabel(state));
  const emitMapPlan = () => {
    onMapPlan?.({
      state: mapStateSelect?.value ?? 'none',
      airportCode: mapAirportSelect?.value ?? '',
      runwayKey: mapRunwaySelect?.value ?? '',
      pointId: mapPointSelect?.value ?? '',
      departure: mapDepartureSelect?.value ?? '',
    });
    refresh();
  };
  for (const select of mapSelects) select.addEventListener('change', emitMapPlan);

  function findMapPlace(kind, id) {
    const list = kind === 'point' ? mapCatalog.points : mapCatalog.airports;
    return list.find(place => (place.id ?? place.code) === id) ?? null;
  }
  function currentMapPlace() {
    if (mapPointSelect?.value) {
      const point = findMapPlace('point', mapPointSelect.value);
      return point ? { ...point, kind: 'point', label: point.label } : null;
    }
    if (!mapAirportSelect?.value) return null;
    const airport = findMapPlace('airport', mapAirportSelect.value);
    return airport ? { ...airport, kind: 'airport', label: airport.name } : null;
  }
  function bookmarkFromPlace(place) {
    return {
      kind: place.kind,
      id: place.id ?? place.code,
      label: place.label ?? place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      iata: place.iata ?? '',
    };
  }
  function renderPlaceList(container, items, emptyKey, activeKey) {
    if (!container) return;
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('span');
      empty.textContent = t(emptyKey);
      container.append(empty);
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn${item.key === activeKey ? ' active' : ''}`;
      button.dataset.placeKind = item.kind;
      button.dataset.placeId = item.id;
      button.textContent = `${item.label}${item.detail ? ` · ${item.detail}` : ''}`;
      container.append(button);
    }
  }
  function renderMapBrowser() {
    if (!mapSearchInput) return;
    mapSearchInput.placeholder = t('lobby.map.search.placeholder');
    const query = mapSearchInput.value ?? '';
    const results = searchMapPlaces(mapCatalog, query);
    const active = currentMapPlace();
    const activeKey = active ? `${active.kind}:${active.id ?? active.code}` : '';
    renderPlaceList(mapResults, results.map(result => ({ ...result, key: `${result.kind}:${result.id}` })),
      'lobby.map.search.empty', activeKey);
    renderPlaceList(mapBookmarksEl, mapBookmarks.map(bookmark => ({
      ...bookmark,
      key: bookmarkKey(bookmark),
      detail: bookmark.iata || bookmark.code || '',
    })), 'lobby.map.bookmarks.empty', activeKey);

    if (mapMarkers) {
      mapMarkers.replaceChildren();
      const places = [
        ...mapCatalog.airports.map(airport => ({ ...airport, kind: 'airport', id: airport.code, label: airport.name })),
        ...mapCatalog.points.map(point => ({ ...point, kind: 'point', label: point.label })),
      ];
      for (const place of places) {
        const projected = projectToMap(place.latitude, place.longitude);
        if (!projected) continue;
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        marker.setAttribute('cx', projected.x.toFixed(1));
        marker.setAttribute('cy', projected.y.toFixed(1));
        marker.setAttribute('r', '3');
        marker.setAttribute('class', `lobby-map-marker${(place.kind === 'airport' ? `airport:${place.id}` : `point:${place.id}`) === activeKey ? ' active' : ''}`);
        marker.dataset.placeKind = place.kind;
        marker.dataset.placeId = place.id;
        mapMarkers.append(marker);
      }
    }
    if (mapSvg && active) mapSvg.setAttribute('viewBox', mapViewBoxFor(active.latitude, active.longitude));
    if (mapStatus) mapStatus.textContent = query
      ? (results.length ? `${results.length} ${t('lobby.map.results')}` : t('lobby.map.search.empty')) : '';
    if (mapBookmarkToggle) {
      bindText(mapBookmarkToggle, () => t(active && isBookmarked(bookmarkFromPlace(active)) ? 'lobby.bookmark.remove' : 'lobby.bookmark.add'));
      mapBookmarkToggle.disabled = !active;
    }
  }
  async function resolveBookmarkPlace(bookmark) {
    const cached = findMapPlace(bookmark.kind, bookmark.id);
    if (cached) return cached;
    if (bookmark.kind === 'airport' && (bookmark.code || bookmark.id)) {
      try {
        const manifest = await loadAirportManifest();
        const airport = await findAirportByCode(manifest, bookmark.code || bookmark.id);
        const [place] = airport ? indexedAirportPlaces([airport]) : [];
        if (place) {
          mapCatalog.airports = [...mapCatalog.airports.filter(entry => entry.code !== place.code), place];
          if (mapAirportSelect && ![...mapAirportSelect.options].some(option => option.value === place.code)) {
            addOption(mapAirportSelect, place.code, `${place.code} · ${place.name}`);
          }
          onMapPlacesAdded?.([place]);
          return place;
        }
      } catch { /* fall through to the stored bookmark */ }
    }
    return { ...bookmark, kind: bookmark.kind, id: bookmark.id, label: bookmark.label };
  }
  async function selectMapPlace(place, state) {
    if (!place) return;
    if (place.kind === 'point' || (place.id && findMapPlace('point', place.id))) {
      const pointId = place.id ?? place.code;
      if (mapAirportSelect) mapAirportSelect.value = '';
      if (mapRunwaySelect) mapRunwaySelect.value = '';
      if (mapPointSelect) mapPointSelect.value = pointId;
      if (mapStateSelect) mapStateSelect.value = 'cruise';
      emitMapPlan();
      return;
    }
    const code = place.code ?? place.id;
    let airport = findMapPlace('airport', code);
    if (!airport) {
      airport = {
        code, iata: place.iata ?? '', name: place.label ?? place.name ?? code,
        latitude: place.latitude, longitude: place.longitude, runways: place.runways ?? [],
      };
      mapCatalog.airports = [...mapCatalog.airports, airport];
      if (mapAirportSelect && ![...mapAirportSelect.options].some(option => option.value === code)) {
        addOption(mapAirportSelect, code, `${code} · ${airport.name}`);
      }
      onMapPlacesAdded?.([airport]);
    }
    if (mapPointSelect) mapPointSelect.value = '';
    if (mapAirportSelect) mapAirportSelect.value = code;
    if (mapStateSelect) mapStateSelect.value = state ?? (['none', 'cruise'].includes(mapStateSelect.value) ? 'runway' : mapStateSelect.value);
    emitMapPlan();
    if (mapRunwaySelect && !mapRunwaySelect.value && mapRunwaySelect.options.length > 1) {
      mapRunwaySelect.value = mapRunwaySelect.options[1].value;
      emitMapPlan();
    }
  }
  async function onMapPlaceClick(event) {
    const target = event.target?.closest?.('[data-place-kind]');
    if (!target) return;
    const kind = target.dataset.placeKind;
    const id = target.dataset.placeId;
    if (mapBookmarksEl?.contains?.(target)) {
      const bookmark = mapBookmarks.find(entry => bookmarkKey(entry) === `${kind}:${id}`);
      if (bookmark) selectMapPlace(await resolveBookmarkPlace(bookmark));
      return;
    }
    selectMapPlace(findMapPlace(kind, id));
  }
  mapSearchInput?.addEventListener('input', renderMapBrowser);
  mapResults?.addEventListener('click', onMapPlaceClick);
  mapBookmarksEl?.addEventListener('click', onMapPlaceClick);
  mapMarkers?.addEventListener('click', onMapPlaceClick);
  mapBookmarkToggle?.addEventListener('click', () => {
    const active = currentMapPlace();
    if (!active) return;
    mapBookmarks = toggleBookmark(bookmarkFromPlace(active));
    renderMapBrowser();
  });
  function setMapPlaces(places = {}) {
    mapCatalog = { airports: places.airports ?? [], points: places.points ?? [] };
    if (mapAirportSelect) {
      mapAirportSelect.replaceChildren();
      addOption(mapAirportSelect, '', t('lobby.map.none'));
      for (const airport of mapCatalog.airports) addOption(mapAirportSelect, airport.code, `${airport.code} · ${airport.name}`);
    }
    if (mapPointSelect) {
      mapPointSelect.replaceChildren();
      addOption(mapPointSelect, '', t('lobby.map.none'));
      for (const point of mapCatalog.points) addOption(mapPointSelect, point.id, point.label);
    }
    if (mapDepartureSelect) {
      mapDepartureSelect.replaceChildren();
      addOption(mapDepartureSelect, '', t('lobby.map.none'));
      for (const id of DESTINATION_CHOICES.filter(value => value !== 'none')) addOption(mapDepartureSelect, id, t(REGION_NAME_KEYS[id] ?? id));
    }
    renderMapBrowser();
    refresh();
  }
  const valleyGroup = document.getElementById('lobby-valley-options');
  const pilotHumanBtn = document.getElementById('lobby-pilot-human');
  const pilotAiBtn = document.getElementById('lobby-pilot-ai');
  const valleyGyroBtn = document.getElementById('lobby-valley-gyro');
  const valleySettingsBtn = document.getElementById('lobby-valley-settings');
  const lobbyScreen = document.getElementById('lobby-screen');
  const lobbyFoldBtn = document.getElementById('btn-lobby-fold');
  const lobbyUnfoldBtn = document.getElementById('btn-lobby-unfold');
  const lobbyBackBtn = document.getElementById('btn-lobby-back');

  function updateBackButton() {
    if (!lobbyBackBtn) return;
    const scenarioTab = document.getElementById('lobby-tab-scenario');
    const isScenarioActive = scenarioTab?.getAttribute('aria-selected') === 'true';
    lobbyBackBtn.hidden = isScenarioActive && !canResume();
  }

  function setLobbyFolded(folded) {
    const isFolded = Boolean(folded);
    lobbyScreen?.classList.toggle('is-folded', isFolded);
    if (lobbyUnfoldBtn) lobbyUnfoldBtn.hidden = !isFolded;
    if (lobbyFoldBtn) lobbyFoldBtn.setAttribute('aria-expanded', String(!isFolded));
    const activeModal = document.querySelector('dialog[open], .modal-backdrop.visible, #replay-library:not([hidden]), #feedback-dialog-overlay:not([hidden]), #demo-restart-dialog:not([hidden]), #joystick-dialog-overlay:not([hidden]), [aria-modal="true"]:not([hidden]):not(.flow-overlay)');
    if (!activeModal) {
      if (isFolded) lobbyUnfoldBtn?.focus();
      else lobbyFoldBtn?.focus();
    }
  }

  lobbyFoldBtn?.addEventListener('click', () => setLobbyFolded(true));
  lobbyUnfoldBtn?.addEventListener('click', () => setLobbyFolded(false));
  lobbyBackBtn?.addEventListener('click', () => {
    const scenarioTab = document.getElementById('lobby-tab-scenario');
    const isScenarioActive = scenarioTab?.getAttribute('aria-selected') === 'true';
    if (!isScenarioActive) {
      scenarioTab?.click();
      return;
    }
    if (canResume()) {
      onResume?.();
      return;
    }
    setLobbyFolded(true);
  });

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
    const isHeld = canResume();
    const flyBtn = document.getElementById('btn-fly');
    if (flyBtn) flyBtn.hidden = isHeld || selected.id === 'lobby-tab-dev' || selected.id === 'lobby-tab-multi';
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const targetId = tab.getAttribute('aria-controls');
      if (tab.id === 'lobby-tab-scenario') {
        const scenarioPanel = document.getElementById('lobby-panel-scenario');
        const managedPanel = document.getElementById('lobby-panel-managed-flight');
        if (scenarioPanel) scenarioPanel.hidden = !active || isHeld;
        if (managedPanel) managedPanel.hidden = !active || !isHeld;
      } else {
        const panel = targetId ? document.getElementById(targetId) : null;
        if (panel) panel.hidden = !active;
      }
    }
    const panels = document.querySelector('.lobby-panels');
    if (panels) panels.scrollTop = 0;
    updateBackButton();
    onTabChange(selected.id);
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
    ['btn-lobby-restart', () => onRestart?.()],
    ['lobby-airport-coastal', () => onAirport('coastal')],
    ['lobby-airport-incheon', () => onAirport('incheon')],
    ['lobby-airport-jeju', () => onAirport('jeju')],
    ['lobby-airport-lukla', () => onAirport('lukla')],
    ['lobby-airport-neon', () => onAirport('neon')],
    ['lobby-airport-valley', () => onAirport('valley')],
    ['lobby-aircraft-b738', () => onAircraft?.('B738')],
    ['lobby-aircraft-c172', () => onAircraft?.('C172')],
    ['lobby-aircraft-f16', () => onAircraft?.('F16')],
  ]) {
    document.getElementById(id)?.addEventListener('click', handler);
  }
  const regionalSelect = document.getElementById('lobby-regional-cruise');
  if (regionalSelect) {
    for (const id of Object.keys(REGIONAL_CRUISES)) {
      const option = document.createElement('option');
      option.value = id;
      bindText(option, () => t(`regional.cruise.${id}`));
      regionalSelect.append(option);
    }
    regionalSelect.addEventListener('change', () => {
      const id = regionalSelect.value;
      const region = regionalCruise(id);
      if (!region) return;
      if (getAirport() !== region.airport) onAirport(region.airport);
      onPreset(id);
    });
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
    if (destinationSelect) {
      destinationSelect.value = resolveDestination(getDestination?.());
      for (const option of destinationSelect.options) {
        option.textContent = option.value === 'none'
          ? t('lobby.destination.none')
          : t(REGION_NAME_KEYS[option.value] ?? option.value);
      }
    }
    const plan = getMapPlan?.() ?? {};
    if (mapStateSelect) mapStateSelect.value = plan.state ?? 'none';
    if (mapAirportSelect) mapAirportSelect.value = plan.airportCode ?? '';
    if (mapPointSelect) mapPointSelect.value = plan.pointId ?? '';
    if (mapDepartureSelect) mapDepartureSelect.value = plan.departure ?? '';
    if (mapRunwaySelect) {
      const airport = mapCatalog.airports.find(entry => entry.code === plan.airportCode);
      const runways = [];
      for (const runway of airport?.runways ?? []) {
        for (const end of runway.ends ?? []) {
          runways.push({
            value: `${runway.id}:${end.ident}`,
            label: `${end.ident || runway.id} · ${Math.round(end.headingDegT ?? 0)}°`,
          });
        }
      }
      mapRunwaySelect.replaceChildren();
      addOption(mapRunwaySelect, '', t('lobby.map.none'));
      for (const runway of runways) addOption(mapRunwaySelect, runway.value, runway.label);
      mapRunwaySelect.value = runways.some(runway => runway.value === plan.runwayKey) ? plan.runwayKey : '';
    }
    renderMapBrowser();
    const aircraft = getAircraft?.() ?? 'B738';
    for (const [key, id] of Object.entries(AIRCRAFT_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', key === aircraft);
      document.getElementById(id).disabled = airport === 'valley' || Boolean(requiredAircraft(getPreset()));
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
    if (regionalSelect) regionalSelect.value = regionalCruise(preset) ? preset : '';
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
    const isHeld = canResume();
    const panelScenario = document.getElementById('lobby-panel-scenario');
    const panelManaged = document.getElementById('lobby-panel-managed-flight');
    const tabScenario = document.getElementById('lobby-tab-scenario');
    const tabLabel = document.getElementById('lobby-tab-scenario-label');
    const tabMulti = document.getElementById('lobby-tab-multi');

    if (tabLabel) {
      bindText(tabLabel, () => t(isHeld ? 'lobby.tab.managed' : 'lobby.tab.single'));
    }
    if (tabMulti) {
      tabMulti.hidden = isHeld;
    }

    const isScenarioActive = tabScenario?.getAttribute('aria-selected') === 'true';
    if (isScenarioActive) {
      if (panelScenario) panelScenario.hidden = isHeld;
      if (panelManaged) panelManaged.hidden = !isHeld;
    }

    if (panelManaged && isHeld) {
      const managedAircraft = document.getElementById('lobby-managed-aircraft');
      const managedAirport = document.getElementById('lobby-managed-airport');
      const managedScenario = document.getElementById('lobby-managed-scenario');
      const managedTime = document.getElementById('lobby-managed-time');

      if (managedAircraft) {
        bindText(managedAircraft, () => {
          const id = getAircraft?.() ?? 'B738';
          return AIRCRAFT_REGISTRY[id]?.name || id;
        });
      }
      if (managedAirport) {
        bindText(managedAirport, () => {
          const id = getAirport?.() ?? 'coastal';
          const btn = document.getElementById(AIRPORT_BUTTONS[id]);
          return btn?.querySelector('span')?.textContent?.trim() || id;
        });
      }
      if (managedScenario) {
        bindText(managedScenario, () => {
          const airportId = getAirport?.() ?? 'coastal';
          const presetId = getPreset?.() ?? 'runway';
          if (presetId === 'demo') {
            const profile = resolveDemoProfile(getAircraft?.(), airportId, getDemoProfile?.());
            return t('demo.scenario.title', { title: t(profile.labelKey) });
          }
          const key = scenarioLabelKey(airportId, presetId);
          return key ? t(key) : presetId;
        });
      }
      if (managedTime) {
        bindText(managedTime, () => formatFlightTime(getTime?.(), isDeviceTime?.()));
      }
    }

    const flyLabel = document.getElementById('btn-fly')?.querySelector('[data-i18n]')
      || document.getElementById('btn-fly')?.querySelector('span:not(.btn-icon)')
      || document.getElementById('btn-fly')?.querySelector('span');
    if (flyLabel) bindText(flyLabel, () => t(getPreset() === 'demo' ? 'lobby.startDemo' : 'lobby.startNew'));
    const flyBtn = document.getElementById('btn-fly');
    if (flyBtn) {
      const isDevOrMultiActive = document.getElementById('lobby-tab-dev')?.getAttribute('aria-selected') === 'true' || document.getElementById('lobby-tab-multi')?.getAttribute('aria-selected') === 'true';
      flyBtn.hidden = isHeld || isDevOrMultiActive;
    }
    const resume = document.getElementById('btn-lobby-resume');
    if (resume) resume.hidden = !isHeld;
    const restart = document.getElementById('btn-lobby-restart');
    if (restart) restart.hidden = !isHeld;
    updateBackButton();
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
      timeSelect.disabled = FIXED_TIME_AIRPORTS.has(airport);
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
    if (regionalSelect) regionalSelect.disabled = busy;
    for (const select of mapSelects) select.disabled = busy;
    if (destinationSelect) destinationSelect.disabled = busy;
    for (const control of mapBrowserControls) control.disabled = busy;
    const flyBtn = document.getElementById('btn-fly');
    if (flyBtn) flyBtn.disabled = busy;
    const resume = document.getElementById('btn-lobby-resume');
    if (resume) resume.disabled = busy;
    const restart = document.getElementById('btn-lobby-restart');
    if (restart) restart.disabled = busy;
  }

  refresh();
  return { refresh, setWaitingForTerrain, setSelectionBusy, setFolded: setLobbyFolded, setMapPlaces };
}
