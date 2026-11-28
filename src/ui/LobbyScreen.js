import { regionalCruise } from '../config/regionalCruises.js';
import { demoProfiles, resolveDemoProfile } from '../director/demoProfiles.js';
import { bindText, getLanguage, setLanguage, t } from '../i18n/index.js';
import { lobbyBriefing } from './lobbyBriefing.js';
import { aircraftSpec } from './lobbySpecs.js';
import { resolveAircraftConfig } from '../config/aircraftConfigs.js';
import { SPAWN_SCENARIOS, isScenarioAvailable, requiredAircraft, scenarioLabelKey } from '../config/scenarioRegistry.js';
import { REGION_NAME_KEYS } from '../world/UnifiedWorld.js';
import { DEFAULT_AIRPORT, DESTINATION_CHOICES, resolveDestination, saveSavedDestination } from '../config/flightSelection.js';
import { mergeScoredResults, placeCruiseAltitude, searchAirportIndexScored, searchMapPlacesScored, searchPlaceIndexScored } from '../config/airportSearch.js';
import { loadBookmarks, toggleBookmark, bookmarkKey, isBookmarked } from '../config/airportBookmarks.js';
import { registerExternalDestinations } from '../config/externalDestinations.js';
import { defaultMapBookmarks, indexedAirportPlace, indexedAirportPlaces, specialRegionPlaces } from '../config/mapFlightPlaces.js';
import { loadAirportManifest, loadAirportSearchIndex, findAirportByCode } from '../geospatial/airportIndex.js';
import { loadPlaceManifest, loadPlaceSearchIndex } from '../geospatial/placeIndex.js';
import { MAP_WIDTH, MAP_HEIGHT, mapCoordinates, projectToMap, fitMapViewBoxToAspect, markerScaleForViewBoxWidth, clusterMapPoints, unwrapMapX } from './mapBrowser.js';
import { tilesForViewBox } from './lobbyMapTiles.js';
import { airportDisplayName, airportProfile } from '../config/airportProfile.js';
const MAP_SEARCH_LIMIT = 20;
const BUILTIN_REGION_AIRPORT_CODES = Object.freeze({ incheon: 'RKSI', jeju: 'RKPC' });
const AIRCRAFT_BUTTONS = { B738: 'lobby-aircraft-b738', C172: 'lobby-aircraft-c172', F16: 'lobby-aircraft-f16' };
/** Aircraft the lobby offers, so warmup can prepare exactly this set. */
export const LOBBY_AIRCRAFT_IDS = Object.keys(AIRCRAFT_BUTTONS);
const LANGUAGE_BUTTONS = { en: 'lobby-lang-en', ko: 'lobby-lang-ko' };
/** Airports that keep their own sky time (Neon is always night), so the lobby clock picker is locked. */
const FIXED_TIME_AIRPORTS = new Set(['neon', 'valley']);
const POINT_PROFILE = Object.freeze({ tier: 'cruise', reason: 'point', landable: false, tooShort: false });

/** What a map place offers the current aircraft; points and unknowns start in cruise only. */
function mapPlaceProfile(place, aircraft) {
  if (!place) return null;
  if (place.kind === 'point' || place.kind === 'region') return POINT_PROFILE;
  return airportProfile(place, aircraft);
}

/** Reason line under the locked takeoff/approach buttons. */
function startReasonKey(profile) {
  if (profile.tooShort) return 'lobby.reason.runwayTooShort';
  if (profile.reason === 'military') return 'lobby.reason.military';
  if (profile.reason === 'unpaved') return 'lobby.reason.unpaved';
  return 'lobby.reason.cruiseOnly';
}

/** Show a reason line under a locked control, or hide it when nothing is locked. */
function setReason(element, key, params) {
  if (!element) return;
  element.hidden = !key;
  if (key) bindText(element, () => t(key, params));
  else bindText(element, () => '');
}

/** Point a locked control at the line that explains why it is locked. */
function describeLock(control, reasonElement, locked) {
  if (!control) return;
  if (locked && reasonElement?.id) control.setAttribute('aria-describedby', reasonElement.id);
  else control.removeAttribute?.('aria-describedby');
}

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
export function initLobbyScreen({ getAirport, getPreset, getTime, isDeviceTime = () => false, getAircraft, getAircraftOptions = () => [], onAirport, onPreset, onTime, onDeviceTime = () => {}, onAircraft, onFly, onRestart, canResume = () => false, canEnd = canResume, onResume, getDemoProfile, onDemoProfile, getPilotMode = () => 'human', onPilotMode = () => {}, onToggleGyro = () => {}, isGyroActive = () => false, onTabChange = () => {}, getDestination = () => 'none', onDestination = () => {}, getMapPlan = () => null, onMapPlan = () => {}, onMapPlacesAdded = () => {}, getAddonBookmarks = () => [], getHeldFlight }) {
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
  const mapDefaultBookmarks = document.getElementById('lobby-map-default-bookmarks');
  const mapBookmarkToggle = document.getElementById('lobby-map-bookmark-toggle');
  const placeBookmarkToggle = document.getElementById('lobby-place-bookmark');
  const mapSvg = document.getElementById('lobby-map-svg');
  const mapMarkers = document.getElementById('lobby-map-markers');
  const mapOverview = document.getElementById('lobby-map-overview');
  const mapTiles = document.getElementById('lobby-map-tiles');
  const mapZoomIn = document.getElementById('lobby-map-zoom-in');
  const mapZoomOut = document.getElementById('lobby-map-zoom-out');
  let mapFocus = null;
  let mapZoom = 0;
  let mapTileSignature = '';
  let mapTilesEnabled = false;
  let suppressClickUntil = 0;
  let mapSelectionBusy = false;
  let customPoint = null;
  let normalizingMapPlan = false;
  const mapStatus = document.getElementById('lobby-map-search-status');
  const mapSearchRetry = document.getElementById('lobby-map-search-retry');
  const aircraftSummary = document.getElementById('lobby-aircraft-summary');
  const aircraftPicker = document.getElementById('lobby-aircraft-picker');
  const placeSummary = document.getElementById('lobby-place-summary');
  const mapPlaceStatus = document.getElementById('lobby-map-place-status');
  const startReason = document.getElementById('lobby-start-reason');
  const aircraftReason = document.getElementById('lobby-aircraft-reason');
  const timeReason = document.getElementById('lobby-time-reason');
  const missionSummary = document.getElementById('lobby-mission-summary');
  const mapDialog = document.getElementById('lobby-map-dialog');
  const mapDialogClose = document.getElementById('lobby-map-dialog-close');
  const placePicker = document.getElementById('lobby-place-picker');
  const mapBrowserControls = [mapSearchInput, mapBookmarkToggle, placeBookmarkToggle, mapResults, mapBookmarksEl, mapOverview].filter(Boolean);
  let mapBookmarks = loadBookmarks();
  let mapCenteredKey = '';
  let mapPlanTileId = null;
  const mapSelects = [mapStateSelect, mapAirportSelect, mapRunwaySelect, mapPointSelect, mapDepartureSelect].filter(Boolean);
  let mapCatalog = { airports: [], points: [], regions: specialRegionPlaces() };

  let mapClusters = [];
  // The global artifact is fetched only when the place browser is used. Its
  // state is separate from the local catalog so a load failure cannot hide
  // Korean places or bookmarks.
  const airportIndexState = { status: 'idle', entries: [], error: null, selectionError: null, pending: null };
  const placeIndexState = { status: 'idle', entries: [], error: null, pending: null };
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
      ...(customPoint && mapPointSelect?.value === customPoint.id ? { point: customPoint } : {}),
      departure: mapDepartureSelect?.value ?? '',
      ...(mapPlanTileId ? { tileId: mapPlanTileId } : {}),
    });
    refresh();
  };
  for (const select of mapSelects) {
    select.addEventListener('change', () => {
      if (select === mapAirportSelect && mapAirportSelect.value) {
        mapRunwaySelect.value = '';
        mapPointSelect.value = '';
        mapStateSelect.value = airportStartState(findMapPlace('airport', mapAirportSelect.value));
      } else if (select === mapPointSelect && mapPointSelect.value) {
        mapAirportSelect.value = '';
        mapRunwaySelect.value = '';
        mapStateSelect.value = 'cruise';
      } else if ((select === mapAirportSelect || select === mapPointSelect)
        && !mapAirportSelect?.value && !mapPointSelect?.value) {
        mapStateSelect.value = 'none';
      }
      emitMapPlan();
    });
  }

  function airportStartState(airport) {
    if (!airport || !airportProfile(airport, getAircraft?.()).landable) return 'cruise';
    const state = getPreset();
    if (regionalCruise(state)) return 'cruise';
    return ['runway', 'cruise', 'approach'].includes(state) ? state : 'runway';
  }

  function findMapPlace(kind, id) {
    if (kind === 'region') return (mapCatalog.regions ?? []).find(place => place.id === id) ?? null;
    if (kind === 'point' && customPoint?.id === id) return customPoint;
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

  function mapActiveKey() {
    const active = currentMapPlace();
    if (active) return `${active.kind}:${active.id ?? active.code}`;
    const airport = getAirport();
    return BUILTIN_REGION_AIRPORT_CODES[airport]
      ? `airport:${BUILTIN_REGION_AIRPORT_CODES[airport]}`
      : (airport ? `region:${airport}` : '');
  }
  function bookmarkFromPlace(place) {
    return {
      kind: place.kind,
      id: place.id ?? place.code,
      label: place.label ?? place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      iata: place.iata ?? '',
      ...(place.tileId ? { tileId: place.tileId } : {}),
      ...(Number.isFinite(place.altitudeM) ? { altitudeM: place.altitudeM } : {}),
      ...(Number.isFinite(place.headingDeg) ? { headingDeg: place.headingDeg } : {}),
      ...(Number.isFinite(place.elevationM) ? { elevationM: place.elevationM } : {}),
    };
  }
  function globalSearchEntries() {
    const localCodes = new Set([
      ...mapCatalog.airports.map(airport => airport.code),
      ...(mapCatalog.regions ?? []).map(region => region.code).filter(Boolean),
    ]);
    return airportIndexState.entries.filter(entry => !localCodes.has(entry.code));
  }
  function renderMapSearchStatus(query, count) {
    if (!mapStatus) return;
    const indexFailed = airportIndexState.status === 'error' || placeIndexState.status === 'error';
    if (mapSearchRetry) mapSearchRetry.hidden = !indexFailed;
    if (indexFailed) {
      mapStatus.textContent = `${t('lobby.map.search.error')} · ${t('lobby.map.search.retry')}`;
    } else if (airportIndexState.selectionError) {
      mapStatus.textContent = t('lobby.map.search.tileError');
    } else if (airportIndexState.status === 'loading' || placeIndexState.status === 'loading') {
      mapStatus.textContent = t('lobby.map.search.loading');
    } else {
      mapStatus.textContent = query
        ? (count ? `${count} ${t('lobby.map.results')}` : t('lobby.map.search.empty')) : '';
    }
  }
  function ensureAirportSearchIndex() {
    if (airportIndexState.status === 'ready' || airportIndexState.status === 'loading') {
      return airportIndexState.pending ?? Promise.resolve();
    }
    airportIndexState.status = 'loading';
    airportIndexState.error = null;
    renderMapBrowser();
    const pending = (async () => {
      const manifest = await loadAirportManifest();
      airportIndexState.entries = await loadAirportSearchIndex(manifest);
      airportIndexState.status = 'ready';
      airportIndexState.selectionError = null;
    })().catch(error => {
      airportIndexState.error = error;
      airportIndexState.status = 'error';
      throw error;
    }).finally(() => {
      airportIndexState.pending = null;
      renderMapBrowser();
    });
    airportIndexState.pending = pending;
    return pending;
  }
  function requestAirportSearchIndex() {
    const pending = ensureAirportSearchIndex();
    pending.catch(() => {}); // The status element reports the failure; the next input or click retries.
    return pending;
  }

  function ensurePlaceSearchIndex() {
    if (placeIndexState.status === 'ready' || placeIndexState.status === 'loading') {
      return placeIndexState.pending ?? Promise.resolve();
    }
    placeIndexState.status = 'loading';
    placeIndexState.error = null;
    renderMapBrowser();
    const pending = (async () => {
      const manifest = await loadPlaceManifest();
      placeIndexState.entries = await loadPlaceSearchIndex(manifest);
      placeIndexState.status = 'ready';
    })().catch(error => {
      placeIndexState.error = error;
      placeIndexState.status = 'error';
      throw error;
    }).finally(() => {
      placeIndexState.pending = null;
      renderMapBrowser();
    });
    placeIndexState.pending = pending;
    return pending;
  }
  function requestPlaceSearchIndex() {
    const pending = ensurePlaceSearchIndex();
    pending.catch(() => {}); // The status element reports the failure; the next input or click retries.
    return pending;
  }
  function setMapSearchState(status, { error = null, entries = null, selectionError = null } = {}) {
    if (entries) airportIndexState.entries = entries;
    airportIndexState.status = status;
    airportIndexState.error = error;
    airportIndexState.selectionError = selectionError;
    renderMapBrowser();
  }
  function renderPlaceList(container, items, emptyKey, activeKey, { allowBookmark = false } = {}) {
    if (!container) return;
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('span');
      empty.textContent = t(emptyKey);
      container.append(empty);
      return;
    }
    const savedKeys = allowBookmark ? new Set(mapBookmarks.map(bookmarkKey)) : null;
    for (const item of items) {
      const itemKey = item.key ?? `${item.kind}:${item.id}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn${allowBookmark ? ' lobby-map-result-select' : ''}${itemKey === activeKey ? ' active' : ''}`;
      button.dataset.placeKind = item.kind;
      button.dataset.placeId = item.id;
      button.dataset.placeSource = item.source ?? '';
      button.textContent = `${item.label}${item.detail ? ` · ${item.detail}` : ''}`;
      if (!allowBookmark || (item.kind !== 'airport' && item.kind !== 'point')) {
        container.append(button);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'lobby-map-result-row';
      row.dataset.placeKind = item.kind;
      row.dataset.placeId = item.id;
      row.dataset.placeSource = item.source ?? '';
      const saved = savedKeys.has(itemKey);
      const bookmarkBtn = document.createElement('button');
      bookmarkBtn.type = 'button';
      bookmarkBtn.className = `btn lobby-map-result-bookmark${saved ? ' bookmarked' : ''}`;
      bookmarkBtn.dataset.bookmarkToggle = 'true';
      bookmarkBtn.dataset.bookmarkKind = item.kind;
      bookmarkBtn.dataset.bookmarkId = item.id;
      bookmarkBtn.dataset.bookmarkSource = item.source ?? '';
      bookmarkBtn.setAttribute('aria-pressed', String(saved));
      const bookmarkLabel = t(saved ? 'lobby.bookmark.remove' : 'lobby.bookmark.add');
      bookmarkBtn.setAttribute('aria-label', `${bookmarkLabel}: ${item.label}`);
      bookmarkBtn.setAttribute('title', bookmarkLabel);
      bookmarkBtn.textContent = saved ? '★' : '☆';
      row.append(button, bookmarkBtn);
      container.append(row);
    }
  }
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const mapViewBox = () => mapSvg?.getAttribute?.('viewBox') ?? `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`;
  const svgViewBox = () => {
    const [x, y, width, height] = mapViewBox().split(/\s+/).map(Number);
    return { x, y, width, height };
  };
  const MIN_VIEWBOX_SPAN = Math.min(MAP_WIDTH, MAP_HEIGHT) / 2 ** 12;
  const clampViewBox = box => {
    const ratio = box.width > 0 && box.height > 0 ? box.width / box.height : 1;
    let width = Math.max(MIN_VIEWBOX_SPAN, Math.min(MAP_WIDTH, box.width));
    let height = width / ratio;
    if (height > MAP_HEIGHT) {
      height = MAP_HEIGHT;
      width = height * ratio;
    }
    if (height < MIN_VIEWBOX_SPAN) {
      height = MIN_VIEWBOX_SPAN;
      width = height * ratio;
    }
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    return {
      x: Number.isFinite(centerX) ? centerX - width / 2 : 0,
      y: Math.max(0, Math.min(MAP_HEIGHT - height, centerY - height / 2)),
      width, height,
    };
  };
  const updatePinScale = () => {
    if (!mapMarkers?.children) return;
    const scale = markerScaleForViewBoxWidth(svgViewBox().width);
    for (const marker of mapMarkers.children) {
      const x = marker.dataset?.mapX;
      const y = marker.dataset?.mapY;
      if (!x || !y || typeof marker.setAttribute !== 'function') continue;
      marker.setAttribute('transform', `translate(${x} ${y}) scale(${scale.toFixed(3)})`);
    }
  };
  const clientToMap = (clientX, clientY) => {
    if (typeof mapSvg?.getScreenCTM !== 'function' || typeof mapSvg.createSVGPoint !== 'function') return null;
    const transform = mapSvg.getScreenCTM();
    if (!transform) return null;
    const cursor = mapSvg.createSVGPoint();
    cursor.x = clientX;
    cursor.y = clientY;
    const point = cursor.matrixTransform(transform.inverse());
    return { x: point.x, y: point.y };
  };
  function enableMapTiles() {
    if (mapTilesEnabled) return;
    mapTilesEnabled = true;
    renderMapTiles();
  }
  function openMapDialog() {
    if (!mapDialog) return;
    if (typeof mapDialog.showModal === 'function') {
      if (!mapDialog.open) mapDialog.showModal();
    } else {
      mapDialog.setAttribute('open', '');
    }
    enableMapTiles();
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches) mapSearchInput?.focus?.();
  }
  function closeMapDialog() {
    if (!mapDialog || !mapDialog.open) return;
    if (typeof mapDialog.close === 'function') mapDialog.close();
    else mapDialog.removeAttribute('open');
  }
  placePicker?.querySelector('summary')?.addEventListener('click', event => {
    event.preventDefault();
    openMapDialog();
  });
  mapDialogClose?.addEventListener('click', closeMapDialog);
  mapDialog?.addEventListener('click', event => {
    if (event.target === mapDialog) closeMapDialog();
  });
  function renderMapTiles() {
    if (!mapTilesEnabled || !mapTiles || typeof mapTiles.replaceChildren !== 'function') return;
    const tiles = tilesForViewBox(mapViewBox());
    const signature = tiles
      .map(tile => `${tile.url}:${tile.x.toFixed(1)},${tile.y.toFixed(1)},${tile.width.toFixed(1)},${tile.height.toFixed(1)}`)
      .join('|');
    if (signature === mapTileSignature) return;
    mapTileSignature = signature;
    const images = tiles.map(tile => {
      const image = document.createElementNS(svgNamespace, 'image');
      image.setAttribute('class', 'lobby-map-tile');
      image.setAttribute('href', tile.url);
      image.setAttribute('x', tile.x.toFixed(2));
      image.setAttribute('y', tile.y.toFixed(2));
      image.setAttribute('width', tile.width.toFixed(2));
      image.setAttribute('height', tile.height.toFixed(2));
      image.setAttribute('preserveAspectRatio', 'none');
      image.setAttribute('pointer-events', 'none');
      return image;
    });
    mapTiles.replaceChildren(...images);
  }
  function applyViewBox(next, { updateFocus = true, zoom } = {}) {
    if (!mapSvg?.setAttribute) return null;
    const box = clampViewBox(next);
    mapSvg.setAttribute('viewBox', `${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.width.toFixed(2)} ${box.height.toFixed(2)}`);
    if (updateFocus) mapFocus = mapCoordinates(box.x + box.width / 2, box.y + box.height / 2);
    mapZoom = Number.isFinite(zoom)
      ? Math.max(0, Math.min(12, Math.round(zoom)))
      : Math.max(0, Math.min(12, Math.round(Math.log2(MAP_WIDTH / box.width))));
    renderMapMarkers();
    renderMapTiles();
    return box;
  }
  function setMapView(focus, zoom) {
    if (!mapSvg?.setAttribute) return;
    mapFocus = focus && Number.isFinite(focus.latitude) && Number.isFinite(focus.longitude) ? focus : null;
    mapZoom = Number.isFinite(zoom) ? Math.max(0, Math.min(12, Math.round(zoom))) : 0;
    const current = svgViewBox();
    const referenceX = Number.isFinite(current.x) ? current.x + current.width / 2 : MAP_WIDTH / 2;
    const point = mapFocus ? projectToMap(mapFocus.latitude, mapFocus.longitude) : null;
    const centerX = point ? unwrapMapX(point.x, referenceX) : referenceX;
    const width = MAP_WIDTH / 2 ** mapZoom;
    const height = MAP_HEIGHT / 2 ** mapZoom;
    const y = point
      ? Math.max(0, Math.min(MAP_HEIGHT - height, point.y - height / 2))
      : Math.max(0, Math.min(MAP_HEIGHT - height, (MAP_HEIGHT - height) / 2));
    const base = `${(centerX - width / 2).toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`;
    const bounds = typeof mapSvg.getBoundingClientRect === 'function' ? mapSvg.getBoundingClientRect() : null;
    const aspect = bounds?.width > 0 && bounds?.height > 0 ? bounds.width / bounds.height : MAP_WIDTH / MAP_HEIGHT;
    const fitted = fitMapViewBoxToAspect(base, aspect).split(/\s+/).map(Number);
    applyViewBox({ x: fitted[0], y: fitted[1], width: fitted[2], height: fitted[3] }, { updateFocus: false, zoom: mapZoom });
  }
  function currentMapFocus() {
    if (mapFocus) return mapFocus;
    const [x, y, width, height] = mapViewBox().split(/\s+/).map(Number);
    return mapCoordinates(x + width / 2, y + height / 2);
  }
  function mapPlaces() {
    return [
      ...mapCatalog.airports.map(airport => ({ ...airport, kind: 'airport', id: airport.code, label: airport.name })),
      ...mapCatalog.points.map(point => ({ ...point, kind: 'point', label: point.label })),
      ...(customPoint ? [customPoint] : []),
    ];
  }
  function renderMapMarkers(activeKey = mapActiveKey()) {
    if (!mapMarkers?.replaceChildren) return;
    mapMarkers.replaceChildren();
    const box = svgViewBox();
    mapClusters = clusterMapPoints(
      mapPlaces().flatMap(place => {
        const projected = projectToMap(place.latitude, place.longitude);
        return projected ? [{ ...projected, place }] : [];
      }),
      box.width,
    );
    const firstCopy = Math.floor(box.x / MAP_WIDTH) - 1;
    const lastCopy = Math.floor((box.x + box.width) / MAP_WIDTH) + 1;
    const instances = mapClusters.flatMap((cluster, index) => {
      const copies = [];
      for (let copy = firstCopy; copy <= lastCopy; copy += 1) {
        copies.push({ cluster, index, x: cluster.x + copy * MAP_WIDTH });
      }
      return copies;
    });
    for (const { cluster, index, x } of instances) {
      const marker = document.createElementNS(svgNamespace, 'g');
      marker.setAttribute('transform', `translate(${x.toFixed(2)} ${cluster.y.toFixed(2)})`);
      marker.dataset.mapX = x.toFixed(2);
      marker.dataset.mapY = cluster.y.toFixed(2);
      if (cluster.places.length > 1) {
        const containsActive = cluster.places.some(place =>
          (place.kind === 'airport' ? `airport:${place.id}` : `point:${place.id}`) === activeKey);
        marker.setAttribute('class', `lobby-map-marker lobby-map-cluster${containsActive ? ' active' : ''}`);
        marker.dataset.clusterIndex = String(index);
        const hit = document.createElementNS(svgNamespace, 'circle');
        hit.setAttribute('class', 'lobby-map-marker-hit');
        hit.setAttribute('cx', '0');
        hit.setAttribute('cy', '0');
        hit.setAttribute('r', '13');
        const badge = document.createElementNS(svgNamespace, 'circle');
        badge.setAttribute('class', 'lobby-map-cluster-badge');
        badge.setAttribute('cx', '0');
        badge.setAttribute('cy', '0');
        badge.setAttribute('r', '10');
        const count = document.createElementNS(svgNamespace, 'text');
        count.setAttribute('class', 'lobby-map-cluster-count');
        count.setAttribute('text-anchor', 'middle');
        count.setAttribute('dy', '0.35em');
        count.textContent = String(cluster.places.length);
        const title = document.createElementNS(svgNamespace, 'title');
        title.textContent = t('lobby.map.cluster.title', { count: cluster.places.length });
        marker.append(hit, badge, count, title);
        mapMarkers.append(marker);
        continue;
      }
      const place = cluster.places[0];
      const active = (place.kind === 'airport' ? `airport:${place.id}` : `point:${place.id}`) === activeKey;
      // Pins mark places this aircraft can take off from and land at; a
      // gold centre marks full scenery. Everything else is a cruise-only dot.
      const profile = mapPlaceProfile(place, getAircraft?.());
      const landable = profile.landable;
      const tierClass = profile.tier === 'full' && landable ? ' full' : (landable ? '' : ' cruise-only');
      marker.setAttribute('class', `lobby-map-marker${tierClass}${active ? ' active' : ''}`);
      marker.dataset.placeKind = place.kind;
      marker.dataset.placeId = place.id;
      marker.dataset.landable = String(landable);
      marker.dataset.tier = profile.tier;
      const hit = document.createElementNS(svgNamespace, 'circle');
      hit.setAttribute('class', 'lobby-map-marker-hit');
      hit.setAttribute('cx', '0');
      hit.setAttribute('cy', landable ? '-9' : '0');
      hit.setAttribute('r', '11');
      marker.append(hit);
      if (landable) {
        const pin = document.createElementNS(svgNamespace, 'path');
        pin.setAttribute('class', 'lobby-map-marker-pin');
        pin.setAttribute('d', 'M0 0C-1.6-2.6-7-7.5-7-12A7 7 0 1 1 7-12C7-7.5 1.6-2.6 0 0Z');
        const dot = document.createElementNS(svgNamespace, 'circle');
        dot.setAttribute('class', 'lobby-map-marker-dot');
        dot.setAttribute('cx', '0');
        dot.setAttribute('cy', '-12');
        dot.setAttribute('r', profile.tier === 'full' ? '3.2' : '2.6');
        marker.append(pin);
        marker.append(dot);
      } else {
        const ring = document.createElementNS(svgNamespace, 'circle');
        ring.setAttribute('class', 'lobby-map-marker-pin');
        ring.setAttribute('cx', '0');
        ring.setAttribute('cy', '0');
        ring.setAttribute('r', '4.5');
        marker.append(ring);
      }
      const title = document.createElementNS(svgNamespace, 'title');
      const name = place.kind === 'airport' ? airportDisplayName(place, getLanguage()) : place.label;
      const tierKey = !landable ? 'lobby.map.tier.cruise' : (profile.tier === 'full' ? 'lobby.map.tier.full' : 'lobby.map.tier.runway');
      title.textContent = `${name} · ${t(tierKey)}`;
      marker.append(title);
      mapMarkers.append(marker);
    }
    updatePinScale();
  }

  function renderMapBrowser() {
    if (!mapSearchInput && !mapDefaultBookmarks && !mapBookmarksEl && !mapMarkers) return;
    if (mapSearchInput) mapSearchInput.placeholder = t('lobby.map.search.placeholder');
    const query = mapSearchInput?.value ?? '';
    const airportResults = query && airportIndexState.status === 'ready'
      ? searchAirportIndexScored(globalSearchEntries(), query) : [];
    const placeResults = query && placeIndexState.status === 'ready'
      ? searchPlaceIndexScored(placeIndexState.entries, query) : [];
    const results = mergeScoredResults(
      searchMapPlacesScored(mapCatalog, query),
      [...airportResults, ...placeResults],
      MAP_SEARCH_LIMIT,
    ).map(result => typeof result.id === 'string' && result.id.startsWith('geonames:')
      ? { ...result, source: 'place-index' } : result);
    const active = currentMapPlace();
    const activeKey = mapActiveKey();
    if (mapSvg && active && activeKey !== mapCenteredKey) setMapView(active, 6);
    mapCenteredKey = activeKey;
    const formatPlaceItem = item => item.kind === 'region'
      ? { ...item, label: item.nameKey ? t(item.nameKey) : item.label, detail: '' }
      : item;
    if (query.trim()) {
      renderPlaceList(mapResults, results.map(formatPlaceItem), 'lobby.map.search.empty', activeKey, { allowBookmark: true });
    } else {
      mapResults?.replaceChildren();
    }
    const withBookmarkLabels = bookmark => formatPlaceItem({
      ...bookmark,
      key: bookmarkKey(bookmark),
      detail: bookmark.iata || bookmark.code || '',
    });
    renderPlaceList(mapBookmarksEl, mapBookmarks.map(withBookmarkLabels), 'lobby.map.bookmarks.empty', activeKey);
    renderPlaceList(mapDefaultBookmarks, [...defaultMapBookmarks(mapCatalog), ...(getAddonBookmarks() ?? [])].map(withBookmarkLabels),
      'lobby.map.search.empty', activeKey);

    renderMapMarkers(activeKey);
    renderMapSearchStatus(query, results.length);
    const activeBookmarked = Boolean(active && isBookmarked(bookmarkFromPlace(active)));
    if (mapBookmarkToggle) {
      bindText(mapBookmarkToggle, () => t(activeBookmarked ? 'lobby.bookmark.remove' : 'lobby.bookmark.add'));
      mapBookmarkToggle.disabled = !active;
    }
    if (placeBookmarkToggle) {
      const bookmarkLabel = t(activeBookmarked ? 'lobby.bookmark.remove' : 'lobby.bookmark.add');
      placeBookmarkToggle.hidden = !active;
      placeBookmarkToggle.disabled = !active;
      placeBookmarkToggle.classList.toggle('bookmarked', activeBookmarked);
      placeBookmarkToggle.setAttribute('aria-pressed', String(activeBookmarked));
      placeBookmarkToggle.setAttribute('aria-label', bookmarkLabel);
      placeBookmarkToggle.setAttribute('title', bookmarkLabel);
      placeBookmarkToggle.textContent = activeBookmarked ? '★' : '☆';
    }
    renderMapTiles();
  }
  async function resolveBookmarkPlace(bookmark) {
    const cached = findMapPlace(bookmark.kind, bookmark.id);
    if (cached) return cached;
    if (bookmark.kind === 'airport' && (bookmark.code || bookmark.id)) {
      try {
        const manifest = await loadAirportManifest();
        const code = bookmark.code || bookmark.id;
        if (bookmark.tileId) registerExternalDestinations([{ code, tileId: bookmark.tileId }]);
        const airport = await findAirportByCode(manifest, code, bookmark.tileId ? { tileId: bookmark.tileId } : {});
        const place = airport ? { ...indexedAirportPlace(airport), tileId: bookmark.tileId } : null;
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
    if (bookmark.kind === 'point' && typeof bookmark.id === 'string' && bookmark.id.startsWith('geonames:')) {
      try {
        await ensurePlaceSearchIndex();
        const entry = placeIndexState.entries.find(item => item.id === bookmark.id);
        if (entry) {
          return {
            ...entry,
            kind: 'point',
            altitudeM: placeCruiseAltitude(entry),
            headingDeg: 90,
          };
        }
      } catch { /* fall through to the stored bookmark */ }
    }
    return { ...bookmark, kind: bookmark.kind, id: bookmark.id, label: bookmark.label };
  }
  function resolveBookmarkCandidate(kind, id, source) {
    if (source === 'place-index') {
      const place = placeIndexState.entries.find(entry => entry.id === id);
      if (place) {
        return bookmarkFromPlace({
          ...place,
          kind: 'point',
          altitudeM: placeCruiseAltitude(place),
          headingDeg: 90,
        });
      }
    }
    if (source === 'global' && kind === 'airport') {
      const entry = airportIndexState.entries.find(item => item.code === id);
      if (entry) {
        return bookmarkFromPlace({ ...entry, kind: 'airport', id: entry.code, label: entry.name });
      }
    }
    const local = findMapPlace(kind, id);
    if (local) {
      return bookmarkFromPlace({
        ...local,
        kind,
        id: local.id ?? local.code,
        label: local.label ?? local.name,
      });
    }
    return mapBookmarks.find(entry => bookmarkKey(entry) === `${kind}:${id}`) ?? null;
  }
  async function selectGlobalAirport(code) {
    setSelectionBusy(true);
    try {
      const manifest = await loadAirportManifest();
      const entry = airportIndexState.entries.find(item => item.code === code);
      if (entry?.tileId) registerExternalDestinations([{ code, tileId: entry.tileId }]);
      const airport = await findAirportByCode(manifest, code, entry?.tileId ? { tileId: entry.tileId } : {});
      const place = airport ? { ...indexedAirportPlace(airport), tileId: entry?.tileId } : null;
      if (!place) throw new Error(`Airport not found in index: ${code}`);
      airportIndexState.selectionError = null;
      selectMapPlace(place);
    } catch (error) {
      airportIndexState.selectionError = error;
      renderMapBrowser();
    } finally {
      setSelectionBusy(false);
    }
  }
  function selectMapPlace(place) {
    if (!place) return;
    mapPlanTileId = place.tileId ?? null;
    if (place.kind === 'region') {
      if (mapStateSelect) mapStateSelect.value = 'none';
      if (mapAirportSelect) mapAirportSelect.value = '';
      if (mapRunwaySelect) mapRunwaySelect.value = '';
      if (mapPointSelect) mapPointSelect.value = '';
      setMapView(null, 0);
      mapCenteredKey = '';
      onAirport?.(place.id);
      closeMapDialog();
      refresh();
      return;
    }
    if (place.kind === 'point' || (place.id && findMapPlace('point', place.id))) {
      const pointId = place.id;
      if (!mapCatalog.points.some(point => point.id === pointId)) {
        const oldOption = [...(mapPointSelect?.options ?? [])].find(option => option.value === customPoint?.id);
        oldOption?.remove();
        customPoint = { ...place, kind: 'point' };
        addOption(mapPointSelect, pointId, place.label);
      }
      if (mapAirportSelect) mapAirportSelect.value = '';
      if (mapRunwaySelect) mapRunwaySelect.value = '';
      if (mapPointSelect) mapPointSelect.value = pointId;
      if (mapStateSelect) mapStateSelect.value = 'cruise';
      emitMapPlan();
      closeMapDialog();
      return;
    }
    const code = place.code ?? place.id;
    let airport = findMapPlace('airport', code);
    if (!airport) {
      airport = place.code === code && Number.isFinite(place.latitude) ? { ...place } : {
        code, iata: place.iata ?? '', name: place.label ?? place.name ?? code,
        latitude: place.latitude, longitude: place.longitude, runways: place.runways ?? [],
      };
      mapCatalog.airports = [...mapCatalog.airports, airport];
      onMapPlacesAdded?.([airport]);
    }
    if (mapAirportSelect && ![...mapAirportSelect.options].some(option => option.value === code)) {
      addOption(mapAirportSelect, code, `${code} · ${airport.name}`);
    }
    if (mapPointSelect) mapPointSelect.value = '';
    if (mapRunwaySelect && mapAirportSelect?.value !== code) mapRunwaySelect.value = '';
    if (mapAirportSelect) mapAirportSelect.value = code;
    if (mapStateSelect) mapStateSelect.value = airportStartState(airport);
    emitMapPlan();
    closeMapDialog();
  }
  async function onMapPlaceClick(event) {
    if (mapSelectionBusy) return;
    const bookmarkTarget = event.target?.closest?.('[data-bookmark-toggle]');
    if (bookmarkTarget?.dataset?.bookmarkToggle === 'true') {
      const candidate = resolveBookmarkCandidate(
        bookmarkTarget.dataset.bookmarkKind,
        bookmarkTarget.dataset.bookmarkId,
        bookmarkTarget.dataset.bookmarkSource,
      );
      if (!candidate) return;
      mapBookmarks = toggleBookmark(candidate);
      renderMapBrowser();
      return;
    }
    const target = event.target?.closest?.('[data-place-kind]');
    if (!target) return;
    const kind = target.dataset.placeKind;
    const id = target.dataset.placeId;
    if (mapBookmarksEl?.contains?.(target)) {
      const bookmark = mapBookmarks.find(entry => bookmarkKey(entry) === `${kind}:${id}`);
      if (bookmark) selectMapPlace(await resolveBookmarkPlace(bookmark));
      return;
    }
    if (target.dataset.placeSource === 'global' && kind === 'airport') {
      await selectGlobalAirport(id);
      return;
    }
    if (target.dataset.placeSource === 'place-index') {
      const place = placeIndexState.entries.find(entry => entry.id === id);
      if (place) {
        selectMapPlace({
          ...place,
          kind: 'point',
          altitudeM: placeCruiseAltitude(place),
          headingDeg: 90,
        });
      }
      return;
    }
    selectMapPlace(findMapPlace(kind, id));
  }
  mapSearchInput?.addEventListener('input', () => {
    // Unavailable indexes are retried explicitly, not on every keystroke.
    if (airportIndexState.status !== 'error') requestAirportSearchIndex();
    if (placeIndexState.status !== 'error') requestPlaceSearchIndex();
    renderMapBrowser();
  });
  mapSearchInput?.addEventListener('focus', () => {
    requestAirportSearchIndex();
    requestPlaceSearchIndex();
  });
  mapSearchRetry?.addEventListener('click', () => {
    if (airportIndexState.status === 'error') requestAirportSearchIndex();
    if (placeIndexState.status === 'error') requestPlaceSearchIndex();
  });
  mapResults?.addEventListener('click', onMapPlaceClick);
  mapBookmarksEl?.addEventListener('click', onMapPlaceClick);
  mapDefaultBookmarks?.addEventListener('click', onMapPlaceClick);
  function zoomToCluster(cluster) {
    const points = cluster.places
      .map(place => projectToMap(place.latitude, place.longitude))
      .filter(Boolean);
    if (!points.length) return;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const center = mapCoordinates((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    if (!center) return;
    const span = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const fit = Math.ceil(Math.log2(MAP_WIDTH / (span * 3)));
    const nextZoom = Math.max(0, Math.min(12, Math.max(mapZoom + 1, fit)));
    if (nextZoom <= mapZoom) {
      renderPlaceList(mapResults, cluster.places.map(place => ({
        ...place,
        key: `${place.kind}:${place.id}`,
        label: place.kind === 'airport' ? airportDisplayName(place, getLanguage()) : place.label,
        detail: place.iata || place.code || '',
      })), 'lobby.map.search.empty', mapActiveKey(), { allowBookmark: true });
      if (mapStatus) mapStatus.textContent = t('lobby.map.cluster.choose');
      return;
    }
    enableMapTiles();
    setMapView(center, nextZoom);
  }

  mapSvg?.addEventListener('click', event => {
    if (mapSelectionBusy || Date.now() < suppressClickUntil) return;
    const clusterTarget = event.target?.closest?.('[data-cluster-index]');
    if (clusterTarget) {
      const cluster = mapClusters[Number(clusterTarget.dataset.clusterIndex)];
      if (cluster) zoomToCluster(cluster);
      return;
    }
    if (event.target.closest('[data-place-kind]')) {
      onMapPlaceClick(event);
      return;
    }
    const transform = mapSvg.getScreenCTM();
    if (!transform) return;
    const cursor = mapSvg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const { x, y } = cursor.matrixTransform(transform.inverse());
    const coordinates = mapCoordinates(x, y);
    if (!coordinates) return;
    const latitude = coordinates.latitude.toFixed(5);
    const longitude = coordinates.longitude.toFixed(5);
    selectMapPlace({ ...coordinates, kind: 'point', id: `map:${latitude},${longitude}`, label: `${latitude}, ${longitude}` });
  });
  mapOverview?.addEventListener('click', () => { enableMapTiles(); setMapView(mapFocus, 0); });
  mapZoomIn?.addEventListener('click', () => { enableMapTiles(); setMapView(currentMapFocus(), Math.min(12, mapZoom + 1)); });
  mapZoomOut?.addEventListener('click', () => { enableMapTiles(); setMapView(currentMapFocus(), Math.max(0, mapZoom - 1)); });
  mapSearchInput?.addEventListener('focus', enableMapTiles, { once: true });
  document.getElementById('lobby-place-picker')?.addEventListener('toggle', event => {
    if (event.target?.open) enableMapTiles();
  });
  const activePointers = new Map();
  let dragStart = null;
  let pinchStart = null;
  mapSvg?.addEventListener?.('pointerdown', event => {
    enableMapTiles();
    if (typeof event.pointerId !== 'number') return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 1) {
      dragStart = { clientX: event.clientX, clientY: event.clientY, box: svgViewBox(), moved: false };
    } else if (activePointers.size === 2) {
      const [first, second] = [...activePointers.values()];
      const box = svgViewBox();
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      pinchStart = {
        distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
        width: box.width,
        height: box.height,
        anchor: clientToMap(midpoint.x, midpoint.y)
          ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        rect: typeof mapSvg.getBoundingClientRect === 'function' ? mapSvg.getBoundingClientRect() : null,
      };
      for (const id of activePointers.keys()) {
        try { mapSvg.setPointerCapture?.(id); } catch { /* ignored */ }
      }
      dragStart = null;
    }
  });
  mapSvg?.addEventListener?.('pointermove', event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2 && pinchStart) {
      const [first, second] = [...activePointers.values()];
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      const factor = Math.max(0.05, Math.min(20, pinchStart.distance / distance));
      const width = Math.max(1, Math.min(MAP_WIDTH, pinchStart.width * factor));
      const height = Math.min(MAP_HEIGHT, width * (pinchStart.height / pinchStart.width));
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const rect = pinchStart.rect;
      const anchor = pinchStart.anchor;
      const relativeX = rect?.width > 0 ? (midpoint.x - rect.x) / rect.width : 0.5;
      const relativeY = rect?.height > 0 ? (midpoint.y - rect.y) / rect.height : 0.5;
      applyViewBox({
        x: anchor.x - relativeX * width,
        y: anchor.y - relativeY * height,
        width, height,
      });
      suppressClickUntil = Date.now() + 200;
      return;
    }
    if (!dragStart || activePointers.size !== 1) return;
    const dx = event.clientX - dragStart.clientX;
    const dy = event.clientY - dragStart.clientY;
    if (Math.hypot(dx, dy) > 4) {
      dragStart.moved = true;
      try { mapSvg.setPointerCapture?.(event.pointerId); } catch { /* ignored */ }
    }
    if (!dragStart.moved) return;
    const bounds = typeof mapSvg.getBoundingClientRect === 'function' ? mapSvg.getBoundingClientRect() : null;
    if (!bounds?.width || !bounds?.height) return;
    applyViewBox({
      ...dragStart.box,
      x: dragStart.box.x - (dx / bounds.width) * dragStart.box.width,
      // One-finger touch drags reserve the vertical axis for the lobby panel's
      // scroll; two-finger gestures still pan and zoom the map in both axes.
      y: event.pointerType === 'touch'
        ? dragStart.box.y
        : dragStart.box.y - (dy / bounds.height) * dragStart.box.height,
    });
    suppressClickUntil = Date.now() + 200;
  });
  const finishPointer = event => {
    if (!activePointers.delete(event.pointerId)) return;
    try { mapSvg.releasePointerCapture?.(event.pointerId); } catch { /* ignored */ }
    if (activePointers.size < 2) pinchStart = null;
    if (activePointers.size === 0) {
      if (dragStart?.moved) suppressClickUntil = Date.now() + 200;
      dragStart = null;
    } else if (activePointers.size === 1) {
      const [remaining] = [...activePointers.values()];
      dragStart = { clientX: remaining.x, clientY: remaining.y, box: svgViewBox(), moved: true };
    }
  };
  mapSvg?.addEventListener?.('pointerup', finishPointer);
  mapSvg?.addEventListener?.('pointercancel', finishPointer);
  mapSvg?.addEventListener?.('wheel', event => {
    enableMapTiles();
    if (typeof event.preventDefault === 'function') event.preventDefault();
    const box = svgViewBox();
    const width = Math.max(1, Math.min(MAP_WIDTH, box.width * (event.deltaY > 0 ? 1.25 : 0.8)));
    const height = Math.min(MAP_HEIGHT, width * (box.height / box.width));
    const anchor = clientToMap(event.clientX, event.clientY)
      ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const relative = { x: (anchor.x - box.x) / box.width, y: (anchor.y - box.y) / box.height };
    applyViewBox({ x: anchor.x - relative.x * width, y: anchor.y - relative.y * height, width, height });
    suppressClickUntil = Date.now() + 200;
  }, { passive: false });
  if (mapSvg && typeof ResizeObserver !== 'undefined' && typeof mapSvg.getBoundingClientRect === 'function') {
    new ResizeObserver(() => setMapView(mapFocus, mapZoom)).observe(mapSvg);
  }
  const onActiveBookmarkToggle = () => {
    const active = currentMapPlace();
    if (!active) return;
    mapBookmarks = toggleBookmark(bookmarkFromPlace(active));
    renderMapBrowser();
  };
  mapBookmarkToggle?.addEventListener('click', onActiveBookmarkToggle);
  placeBookmarkToggle?.addEventListener('click', onActiveBookmarkToggle);
  function setMapPlaces(places = {}) {
    mapCatalog = { airports: places.airports ?? [], points: places.points ?? [], regions: places.regions ?? specialRegionPlaces() };
    if (mapAirportSelect) {
      mapAirportSelect.replaceChildren();
      addOption(mapAirportSelect, '', t('lobby.map.none'));
      for (const airport of mapCatalog.airports) addOption(mapAirportSelect, airport.code, `${airport.code} · ${airport.name}`);
    }
    if (mapPointSelect) {
      mapPointSelect.replaceChildren();
      addOption(mapPointSelect, '', t('lobby.map.none'));
      for (const point of mapCatalog.points) addOption(mapPointSelect, point.id, point.label);
      if (customPoint) addOption(mapPointSelect, customPoint.id, customPoint.label);
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
  if (timeReason) timeSelect?.parentElement?.append(timeReason);

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
    ['lobby-aircraft-b738', () => onAircraft?.('B738')],
    ['lobby-aircraft-c172', () => onAircraft?.('C172')],
    ['lobby-aircraft-f16', () => onAircraft?.('F16')],
  ]) {
    document.getElementById(id)?.addEventListener('click', () => {
      handler();
      if (id.startsWith('lobby-aircraft-') && aircraftPicker?.open) {
        aircraftPicker.open = false;
        aircraftPicker.querySelector('summary')?.focus();
      }
    });
  }
  const aircraftButtons = { ...AIRCRAFT_BUTTONS };
  if (aircraftPicker) {
    for (const aircraftId of getAircraftOptions().filter(id => !aircraftButtons[id])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `lobby-aircraft-${aircraftId}`;
      button.className = 'btn btn-aircraft';
      const label = document.createElement('span');
      label.textContent = resolveAircraftConfig(aircraftId)?.name ?? aircraftId;
      button.append(label);
      button.addEventListener('click', () => {
        onAircraft?.(aircraftId);
        aircraftPicker.open = false;
        aircraftPicker.querySelector('summary')?.focus();
      });
      aircraftPicker.querySelector('.lobby-buttons')?.append(button);
      aircraftButtons[aircraftId] = button.id;
    }
  }
  for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
    if (type === 'demo') continue;
    const button = document.getElementById(scenario.lobbyButtonId);
    button?.addEventListener('click', () => {
      const place = currentMapPlace();
      if (button.dataset.startLabel && place) {
        if (type !== 'cruise' && !mapPlaceProfile(place, getAircraft?.()).landable) return;
        mapStateSelect.value = type;
        emitMapPlan();
      } else if (button.dataset.startLabel) {
        if (!isScenarioAvailable(getAirport(), type)) onAirport?.(DEFAULT_AIRPORT);
        onPreset(type);
      } else {
        if (!isScenarioAvailable(getAirport(), type) && scenario.airports?.[0]) {
          onAirport?.(scenario.airports[0]);
        }
        onPreset(type);
      }
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
    for (const [code, id] of Object.entries(LANGUAGE_BUTTONS)) {
      document.getElementById(id)?.classList.toggle('active', code === getLanguage());
    }
    const airport = getAirport();
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
    const plannedAirport = findMapPlace('airport', plan.airportCode);
    if (mapRunwaySelect) {
      const runways = [];
      for (const runway of plannedAirport?.runways ?? []) {
        for (const end of runway.ends ?? []) {
          runways.push({
            value: `${runway.id}:${end.ident}`,
            label: `${end.ident || runway.id} · ${Math.round(end.headingDegT ?? 0)}°`,
          });
        }
      }
      mapRunwaySelect.replaceChildren();
      addOption(mapRunwaySelect, '', t('lobby.map.automatic'));
      const runwayLabel = mapRunwaySelect.closest('label');
      if (runwayLabel) runwayLabel.hidden = plan.state === 'cruise' || !runways.length;
      for (const runway of runways) addOption(mapRunwaySelect, runway.value, runway.label);
      mapRunwaySelect.value = runways.some(runway => runway.value === plan.runwayKey) ? plan.runwayKey : '';
    }
    renderMapBrowser();
    const place = currentMapPlace();
    const placeName = () => (place?.kind === 'airport' ? airportDisplayName(place, getLanguage()) : place?.label);
    if (placeSummary) bindText(placeSummary, () => {
      const preset = getPreset();
      if (place) return placeName();
      return regionalCruise(preset) ? t(`regional.cruise.${preset}`) : t(REGION_NAME_KEYS[airport] ?? airport);
    });
    const placeProfile = mapPlaceProfile(place, getAircraft?.() ?? 'B738');
    const runwayParams = () => ({
      place: placeName(),
      length: (placeProfile?.longestRunwayM ?? 0).toLocaleString('en-US'),
      min: (placeProfile?.minRunwayM ?? 0).toLocaleString('en-US'),
      aircraft: resolveAircraftConfig(getAircraft?.() ?? 'B738')?.name ?? getAircraft?.() ?? 'B738',
    });
    if (place) {
      // Just the place name; why a start is locked is said under the start buttons.
      if (mapPlaceStatus) {
        mapPlaceStatus.hidden = false;
        bindText(mapPlaceStatus, placeName);
      }
      mapPlaceStatus?.classList.toggle('cruise-only', !placeProfile.landable);
    } else {
      setReason(mapPlaceStatus, null);
    }
    // A saved takeoff/approach plan can outlive the aircraft or rules that allowed
    // it (e.g. switching to the B737 at a short field); fall back to cruise.
    if (place && !placeProfile.landable && ['runway', 'approach'].includes(mapStateSelect?.value) && !normalizingMapPlan) {
      normalizingMapPlan = true;
      try {
        mapStateSelect.value = 'cruise';
        emitMapPlan();
      } finally {
        normalizingMapPlan = false;
      }
      return;
    }
    const aircraft = getAircraft?.() ?? 'B738';
    if (aircraftSummary) bindText(aircraftSummary, () => resolveAircraftConfig(aircraft)?.name ?? aircraft);
    const lockedAircraft = requiredAircraft(getPreset()) ?? (airport === 'valley' ? aircraft : null);
    setReason(aircraftReason, lockedAircraft ? 'lobby.reason.aircraftLocked' : null,
      { aircraft: resolveAircraftConfig(lockedAircraft)?.name ?? lockedAircraft });
    for (const [key, id] of Object.entries(aircraftButtons)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('active', key === aircraft);
      el.disabled = Boolean(lockedAircraft);
      describeLock(el, aircraftReason, el.disabled);
    }
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      if (type === 'demo') continue;
      const button = document.getElementById(scenario.lobbyButtonId);
      const span = button?.querySelector('span');
      if (span) {
        bindText(span, () => t(
          button.dataset.startLabel
            ?? scenarioLabelKey(getAirport(), type)
            ?? scenarioLabelKey(scenario.airports?.[0], type)
            ?? 'lobby.spawn'
        ));
      }
    }
    if ((aircraft === 'F16' && !['lukla','incheon'].includes(airport)) && getPreset() === 'demo') onPreset('runway');
    const preset = getPreset();
    if (missionSummary) {
      const label = ['runway', 'cruise', 'approach'].includes(preset) || regionalCruise(preset)
        ? null : scenarioLabelKey(airport, preset);
      bindText(missionSummary, () => label ? t(label) : '');
    }
    // Follow the selected flight even while the menu is closed. The live
    // binding also refreshes the browser tab when the language changes.
    bindText(document.querySelector('title'), () => {
      const airport = getAirport();
      const preset = getPreset();
      const labelKey = scenarioLabelKey(airport, preset);
      const scenarioTitle = preset === 'demo'
        ? t('demo.scenario.title', { title: t(resolveDemoProfile(getAircraft?.(), airport, getDemoProfile?.()).labelKey) })
        : (labelKey && t(labelKey));
      return [...new Set(['Flight3d', resolveAircraftConfig(getAircraft?.() ?? 'B738')?.name,
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
      const held = getHeldFlight?.() ?? {};
      const heldAirport = held.airport ?? getAirport?.() ?? 'coastal';
      const heldPreset = held.scenario ?? getPreset?.() ?? 'runway';
      const heldAircraft = held.aircraft ?? getAircraft?.() ?? 'B738';
      const heldTime = held.timeOfDay ?? getTime?.();
      const heldDeviceTime = held.deviceTime ?? isDeviceTime?.();
      const managedAircraft = document.getElementById('lobby-managed-aircraft');
      const managedAirport = document.getElementById('lobby-managed-airport');
      const managedScenario = document.getElementById('lobby-managed-scenario');
      const managedTime = document.getElementById('lobby-managed-time');

      if (managedAircraft) {
        bindText(managedAircraft, () => {
          return resolveAircraftConfig(heldAircraft)?.name || heldAircraft;
        });
      }
      if (managedAirport) {
        bindText(managedAirport, () => {
          if (held.airportLabel) return held.airportLabel;
          if (!getHeldFlight) {
            const activePlace = currentMapPlace();
            if (activePlace) return activePlace.label;
          }
          const id = heldAirport ?? getAirport?.() ?? DEFAULT_AIRPORT;
          return t(REGION_NAME_KEYS[id] ?? id);
        });
      }
      if (managedScenario) {
        bindText(managedScenario, () => {
          if (heldPreset === 'demo') {
            const profile = resolveDemoProfile(heldAircraft, heldAirport, held.demoProfile ?? getDemoProfile?.());
            return t('demo.scenario.title', { title: t(profile.labelKey) });
          }
          const key = scenarioLabelKey(heldAirport, heldPreset);
          return held.scenarioLabel || (key ? t(key) : heldPreset);
        });
      }
      if (managedTime) {
        bindText(managedTime, () => formatFlightTime(heldTime, heldDeviceTime));
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
    const cruiseOnly = Boolean(place && !placeProfile.landable);
    setReason(startReason, cruiseOnly ? startReasonKey(placeProfile) : null, runwayParams());
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      if (type === 'demo') continue;
      const button = document.getElementById(scenario.lobbyButtonId);
      if (!button) continue;
      const isSelected = type === preset || (type === 'cruise' && Boolean(regionalCruise(preset)));
      button.classList.toggle('active', isSelected);
      if (button.dataset.startLabel) {
        button.setAttribute('aria-pressed', String(isSelected));
        button.disabled = cruiseOnly && type !== 'cruise';
        describeLock(button, startReason, button.disabled);
      }
      button.style.display = '';
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
      setReason(timeReason, timeSelect.disabled ? 'lobby.reason.timeFixed' : null);
      describeLock(timeSelect, timeReason, timeSelect.disabled);
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
        describeLock(chip, timeReason, chip.disabled);
      }
    }
  }

  function setWaitingForTerrain(waiting) {
    if (loadingEl) loadingEl.hidden = !waiting;
  }

  /** Show that a choice is being applied while the host defers the heavy work. */
  function setSelectionBusy(busy) {
    if (selectionEl) selectionEl.hidden = !busy;
    mapSelectionBusy = busy;
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
  return { refresh, setWaitingForTerrain, setSelectionBusy, setFolded: setLobbyFolded, setMapPlaces, setMapSearchState, requestAirportSearchIndex, requestPlaceSearchIndex, enableMapTiles };
}
