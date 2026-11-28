import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';
import { initLobbyScreen } from '../src/ui/LobbyScreen.js';
import { clearAirportIndexCache } from '../src/geospatial/airportIndex.js';
import { clearPlaceIndexCache } from '../src/geospatial/placeIndex.js';
import { getLanguage, t } from '../src/i18n/index.js';
import { airportDisplayName } from '../src/config/airportProfile.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';
import { mapViewBoxFor, MAP_WIDTH } from '../src/ui/mapBrowser.js';
import { installSimulatorHudAndBindings } from '../src/ui/SimulatorHudAndBindings.js';

class MockElement {
  constructor(id = '', tagName = 'DIV') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) this._classes.add(c);
        else this._classes.delete(c);
      },
      contains(c) { return this._classes.has(c); },
    };
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.dataset = {};
    this.options = [];
    this.value = '';
    this.tabIndex = 0;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(evt, fn) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(fn);
  }
  click() {
    if (this.onclick) this.onclick();
    this.listeners['click']?.forEach(fn => fn({ preventDefault() {} }));
  }
  focus() {
    this.listeners['focus']?.forEach(fn => fn());
  }
  blur() {
    this.listeners['blur']?.forEach(fn => fn());
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children) {
    for (const c of children) this.appendChild(c);
  }
  contains(other) { return other === this || this.children.includes(other); }
  closest() { return null; }
  replaceChildren(...children) {
    this.children = [];
    for (const c of children) this.appendChild(c);
    this.options = this.children.filter(c => c.tagName === 'OPTION');
  }
  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }
  querySelector(sel) {
    if (sel === 'span') return this.children.find(c => c.tagName === 'SPAN') || null;
    if (sel === '[data-i18n]') return this.children.find(c => c.dataset?.i18n) || null;
    return null;
  }
  querySelectorAll() {
    return [];
  }
  insertAdjacentElement(pos, el) {
    if (pos === 'afterend' && this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(idx + 1, 0, el);
      el.parentElement = this.parentElement;
    }
  }
}

function setupMockDOM() {
  const elements = new Map();
  function getOrCreate(id, tag = 'div') {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(id, tag));
    }
    return elements.get(id);
  }

  const commonIds = [
    'btn-fly', 'btn-lobby-resume', 'btn-lobby-restart', 'btn-lobby-end',
    'btn-pause-resume', 'btn-pause-restart', 'btn-pause-exit', 'btn-pause-end',
    'lobby-screen', 'lobby-tab-scenario', 'lobby-tab-scenario-label',
    'lobby-tab-multi', 'lobby-tab-settings', 'lobby-tab-dev',
    'lobby-panel-scenario', 'lobby-panel-managed-flight',
    'lobby-managed-aircraft', 'lobby-managed-airport',
    'lobby-managed-scenario', 'lobby-managed-time',
    'lobby-briefing', 'lobby-loading', 'lobby-selection',
    'lobby-demo-options', 'lobby-demo-select', 'lobby-demo-briefing',
    'lobby-valley-options', 'lobby-pilot-human', 'lobby-pilot-ai',
    'lobby-valley-gyro', 'lobby-valley-settings', 'lobby-valley-preflight',
    'lobby-time-select', 'dev-enabled',
    'lobby-aircraft-b738', 'lobby-aircraft-c172', 'lobby-aircraft-f16',
    'lobby-lang-en', 'lobby-lang-ko', 'btn-lobby-fold', 'btn-lobby-unfold', 'btn-lobby-back',
  ];
  for (const id of commonIds) {
    const tag = id.includes('select') ? 'select' : id.includes('btn') || id.includes('preset') || id.includes('airport') || id.includes('aircraft') || id.includes('lang') || id.includes('pilot') || id.includes('gyro') || id.includes('settings') || id.includes('tab') ? 'button' : 'div';
    getOrCreate(id, tag);
  }

  const scenarioTab = getOrCreate('lobby-tab-scenario');
  scenarioTab.setAttribute('aria-selected', 'true');
  scenarioTab.setAttribute('aria-controls', 'lobby-panel-scenario');

  const flyBtn = getOrCreate('btn-fly');
  const flySpan = new MockElement('', 'span');
  flyBtn.appendChild(flySpan);

  const mockDoc = {
    getElementById: id => elements.get(id) || null,
    querySelectorAll: sel => {
      if (sel === '.lobby-tab') {
        return [
          getOrCreate('lobby-tab-scenario'),
          getOrCreate('lobby-tab-multi'),
          getOrCreate('lobby-tab-settings'),
          getOrCreate('lobby-tab-dev'),
        ];
      }
      return [];
    },
    querySelector: sel => {
      if (sel === 'title') return new MockElement('title', 'title');
      if (sel === '.lobby-panels') return new MockElement('', 'div');
      return null;
    },
    createElement: tag => new MockElement('', tag),
  };
  return { elements, mockDoc };
}

test('UI State Contract: Next Flight Preparation hides held flight controls and exposes flight condition selectors', () => {
  const { elements, mockDoc } = setupMockDOM();
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;

  try {
    let flyCalled = false;
    let resumeCalled = false;
    let restartCalled = false;

    initLobbyScreen({
      getAirport: () => 'coastal',
      getPreset: () => 'runway',
      getTime: () => 12.5,
      getAircraft: () => 'B738',
      onAirport: () => {},
      onPreset: () => {},
      onTime: () => {},
      onAircraft: () => {},
      onFly: () => { flyCalled = true; },
      onRestart: () => { restartCalled = true; },
      canResume: () => false,
      canEnd: () => false,
      onResume: () => { resumeCalled = true; },
    });

    const scenarioPanel = elements.get('lobby-panel-scenario');
    const managedPanel = elements.get('lobby-panel-managed-flight');
    const flyBtn = elements.get('btn-fly');
    const resumeBtn = elements.get('btn-lobby-resume');
    const restartBtn = elements.get('btn-lobby-restart');
    const endBtn = elements.get('btn-lobby-end');
    const tabLabel = elements.get('lobby-tab-scenario-label');

    // In Next Flight Preparation (no flight held):
    assert.equal(scenarioPanel.hidden, false, 'Condition selectors must be visible');
    assert.equal(managedPanel.hidden, true, 'Managed flight panel must be hidden');
    assert.equal(flyBtn.hidden, false, 'New flight start button must be visible');
    assert.equal(resumeBtn.hidden, true, 'Resume button must be hidden');
    assert.equal(restartBtn.hidden, true, 'Restart button must be hidden');
    assert.equal(endBtn.hidden, true, 'End flight button must be hidden');
    assert.equal(tabLabel.textContent, '자유비행', 'The tab identifies free flight');

    flyBtn.click();
    assert.equal(flyCalled, true);
    assert.equal(resumeCalled, false);
    assert.equal(restartCalled, false);
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: In-Flight Menu Management hides condition selectors and shows held sortie controls', () => {
  const { elements, mockDoc } = setupMockDOM();
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;

  try {
    let flyCalled = false;
    let resumeCalled = false;
    let restartCalled = false;

    initLobbyScreen({
      getAirport: () => 'coastal',
      getPreset: () => 'runway',
      getTime: () => 16.8,
      getAircraft: () => 'B738',
      onAirport: () => {},
      onPreset: () => {},
      onTime: () => {},
      onAircraft: () => {},
      onFly: () => { flyCalled = true; },
      onRestart: () => { restartCalled = true; },
      canResume: () => true,
      canEnd: () => true,
      onResume: () => { resumeCalled = true; },
    });

    const scenarioPanel = elements.get('lobby-panel-scenario');
    const managedPanel = elements.get('lobby-panel-managed-flight');
    const flyBtn = elements.get('btn-fly');
    const resumeBtn = elements.get('btn-lobby-resume');
    const restartBtn = elements.get('btn-lobby-restart');
    const endBtn = elements.get('btn-lobby-end');
    const tabLabel = elements.get('lobby-tab-scenario-label');
    const multiTab = elements.get('lobby-tab-multi');

    // In In-Flight Menu Management (held flight):
    assert.equal(scenarioPanel.hidden, true, 'Flight condition selectors MUST BE HIDDEN while flight is held');
    assert.equal(managedPanel.hidden, false, 'Managed flight summary card MUST be visible');
    assert.equal(flyBtn.hidden, true, 'Start new flight button MUST BE HIDDEN');
    assert.equal(resumeBtn.hidden, false, 'Resume button MUST be visible');
    assert.equal(restartBtn.hidden, false, 'Restart button MUST be visible');
    assert.equal(endBtn.hidden, false, 'End flight button MUST be visible');
    assert.equal(tabLabel.textContent, '진행 중 비행', 'Tab label must reflect managed flight');
    assert.equal(multiTab.hidden, true, 'Multiplayer tab is hidden while holding singleplayer flight');

    // Verify held flight summary information
    const managedAircraft = elements.get('lobby-managed-aircraft');
    const managedAirport = elements.get('lobby-managed-airport');
    const managedTime = elements.get('lobby-managed-time');
    assert.ok(managedAircraft.textContent.includes('Boeing 737') || managedAircraft.textContent.includes('B738'));
    assert.equal(managedAirport.textContent, t('coastal.airport'));
    assert.equal(elements.get('lobby-airport-coastal'), undefined);
    assert.equal(managedTime.textContent, '16:48');

    // Actions: verify onRestart called exactly once
    let restartCount = 0;
    restartBtn.listeners['click'] = [() => { restartCount++; }];
    restartBtn.click();
    assert.equal(restartCount, 1, 'Restart must be invoked exactly once');
    resumeBtn.click();
    assert.equal(resumeCalled, true, 'Clicking resume button triggers onResume');
    assert.equal(flyCalled, false, 'Fly button was hidden and not triggered');
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: held flight card shows flown sortie, not pending lobby choices', () => {
  const { elements, mockDoc } = setupMockDOM();
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;

  try {
    initLobbyScreen({
      getAirport: () => 'coastal',
      getPreset: () => 'cruise',
      getTime: () => 12.5,
      getAircraft: () => 'B738',
      onAirport: () => {},
      onPreset: () => {},
      onTime: () => {},
      onAircraft: () => {},
      onFly: () => {},
      onRestart: () => {},
      canResume: () => true,
      canEnd: () => true,
      onResume: () => {},
      getHeldFlight: () => ({
        airport: '-51.28557, -74.25806',
        airportLabel: '-51.28557, -74.25806',
        aircraft: 'F16',
        scenario: 'cruise',
        scenarioLabel: '한라산 순항 · 실제 비행',
        timeOfDay: 12.5,
        deviceTime: false,
      }),
    });

    assert.equal(elements.get('lobby-managed-airport').textContent, '-51.28557, -74.25806');
    assert.equal(elements.get('lobby-managed-scenario').textContent, '한라산 순항 · 실제 비행');
    assert.match(elements.get('lobby-managed-aircraft').textContent, /F-16 Fighting Falcon/);
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: Camera selection hold freezes physics without stealing focus or opening pause menu', () => {
  const gameFlow = new GameFlowController();
  gameFlow.enterFlight();
  assert.equal(gameFlow.state, FLOW.FLIGHT);
  assert.equal(gameFlow.isPhysicsFrozen(), false);

  // 1. Focusing camera select in singleplayer holds camera selection
  gameFlow.holdCameraSelection();
  assert.equal(gameFlow.isCameraSelectionHeld(), true);
  assert.equal(gameFlow.isPhysicsFrozen(), true, 'Physics must be frozen during camera selection');
  assert.equal(gameFlow.state, FLOW.FLIGHT, 'Flow state must remain FLIGHT so pause menu does not open or steal focus');

  // 2. Committing or closing camera selection releases hold
  gameFlow.releaseCameraSelection();
  assert.equal(gameFlow.isCameraSelectionHeld(), false);
  assert.equal(gameFlow.isPhysicsFrozen(), false, 'Physics resumes after camera selection');

  // 3. Opening pause menu while camera selection is held
  gameFlow.holdCameraSelection();
  assert.equal(gameFlow.isPhysicsFrozen(), true);
  gameFlow.pause('manual');
  assert.equal(gameFlow.state, FLOW.PAUSED);
  // Releasing camera hold while paused leaves physics frozen due to FLOW.PAUSED
  gameFlow.releaseCameraSelection();
  assert.equal(gameFlow.isPhysicsFrozen(), true);
  gameFlow.resume('manual');
  assert.equal(gameFlow.state, FLOW.FLIGHT);
  assert.equal(gameFlow.isPhysicsFrozen(), false);
});

test('UI State Contract: In-flight time-of-day cycling is gated behind developer mode', () => {
  class MockSim {}
  installSimulatorHudAndBindings(MockSim);
  const sim = new MockSim();
  sim.controls = {};
  sim.sky = { timeOfDay: 14.0 };
  sim.setTimeOfDay = hours => { sim.sky.timeOfDay = hours; };
  sim.developerMode = { enabled: false };
  sim.initControls();

  // In regular flight (developerMode disabled):
  sim.controls.onCycleTimeOfDay(1.5);
  assert.equal(sim.sky.timeOfDay, 14.0, 'Hotkeys must NOT cycle time when dev mode is disabled');

  // With developer mode enabled:
  sim.developerMode.enabled = true;
  sim.controls.onCycleTimeOfDay(1.5);
  assert.equal(sim.sky.timeOfDay, 15.5, 'Hotkeys cycle time when dev mode is enabled');
});

test('UI State Contract: Multi-pause state guard prevents early resume when overlapping pause reasons exist', () => {
  const gameFlow = new GameFlowController();
  gameFlow.enterFlight();
  assert.equal(gameFlow.state, FLOW.FLIGHT);

  // 1. Camera selection dropdown opens during singleplayer flight -> acquires pause('camera')
  assert.equal(gameFlow.pause('camera'), true);
  assert.equal(gameFlow.state, FLOW.PAUSED);
  assert.equal(gameFlow.isPausedFor('camera'), true);
  assert.equal(gameFlow.isPhysicsFrozen(), true);

  // 2. User presses ESC while camera select is open -> acquires pause('manual')
  assert.equal(gameFlow.pause('manual'), false, 'Already paused returns false for transition');
  assert.equal(gameFlow.isPausedFor('manual'), true);
  assert.equal(gameFlow.state, FLOW.PAUSED);

  // 3. Camera select blurs / closes -> releases 'camera'
  assert.equal(gameFlow.resume('camera'), false, 'Cannot resume to FLIGHT while manual pause is still active');
  assert.equal(gameFlow.state, FLOW.PAUSED, 'State must stay PAUSED');
  assert.equal(gameFlow.isPausedFor('camera'), false);
  assert.equal(gameFlow.isPausedFor('manual'), true);

  // 4. User unpauses from pause menu -> releases 'manual'
  assert.equal(gameFlow.resume('manual'), true, 'Releasing last pause source resumes to FLIGHT');
  assert.equal(gameFlow.state, FLOW.FLIGHT);
  assert.equal(gameFlow.isPhysicsFrozen(), false);
});

const MAP_SELECT_IDS = ['lobby-map-state', 'lobby-map-airport', 'lobby-map-runway', 'lobby-map-point', 'lobby-map-departure'];
const MAP_BROWSER_IDS = ['lobby-map-dialog', 'lobby-map-confirm', 'lobby-map-search', 'lobby-map-results', 'lobby-map-bookmarks', 'lobby-map-default-bookmarks', 'lobby-map-search-status', 'lobby-map-search-retry', 'lobby-map-bookmark-toggle', 'lobby-place-bookmark', 'lobby-map-svg', 'lobby-map-markers', 'lobby-map-overview', 'lobby-map-tiles'];

function setupMapDOM() {
  const { elements, mockDoc } = setupMockDOM();
  for (const id of MAP_SELECT_IDS) elements.set(id, new MockElement(id, 'select'));
  for (const id of MAP_BROWSER_IDS) elements.set(id, new MockElement(id, id === 'lobby-map-search' ? 'input' : 'div'));
  mockDoc.createElementNS = (namespace, tag) => new MockElement('', tag);
  return { elements, mockDoc };
}

function globalFixture() {
  const base = 'http://localhost/data/airports/';
  const manifest = {
    schemaVersion: 1,
    kind: 'flight3d-airport-index',
    version: 'fixture',
    tileDegrees: 10,
    tiles: { '12-30': {}, '13-10': {} },
    icao: { RKSI: '12-30', KJFK: '13-10' },
    iata: { ICN: '12-30', JFK: '13-10' },
    searchIndex: { path: 'fixture/search.json', schemaVersion: 1, count: 1 },
  };
  const artifact = {
    schemaVersion: 1,
    version: 'fixture',
    airports: [{ code: 'KJFK', iata: 'JFK', name: 'John F. Kennedy International Airport', latitude: 40.6394, longitude: -73.7793, country: 'US', type: 'large_airport', tileId: '13-10' }],
  };
  const tile = {
    schemaVersion: 1,
    version: 'fixture',
    tile: '13-10',
    airports: [{
      id: '1', icao: 'KJFK', iata: 'JFK', name: artifact.airports[0].name,
      latitude: 40.6394, longitude: -73.7793, elevationM: 4, country: 'US', type: 'large_airport',
      runways: [{ id: '1', ends: [{ ident: '04L', headingDegT: 40 }, { ident: '22R', headingDegT: 220 }] }],
    }],
  };
  const files = new Map([
    [`${base}manifest.json`, manifest],
    [`${base}fixture/search.json`, artifact],
    [`${base}fixture/tiles/13-10.json`, tile],
  ]);
  const placeBase = 'http://localhost/data/places/';
  files.set(`${placeBase}manifest.json`, {
    schemaVersion: 1,
    kind: 'flight3d-place-index',
    version: 'fixture',
    searchIndex: { path: 'fixture/places.json', schemaVersion: 1, count: 1 },
  });
  files.set(`${placeBase}fixture/places.json`, {
    schemaVersion: 1,
    version: 'fixture',
    places: [{ id: 'geonames:1', label: 'Testville', aliases: ['Testville'], detail: 'city · XX', latitude: 0, longitude: 0, country: 'XX', kind: 'city', elevationM: 0 }],
  });
  return { base, files };
}

test('UI State Contract: global airport search shows loading, error, retry, counts and empty results', async () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const { files } = globalFixture();
  const requested = [];
  let offline = true;
  clearPlaceIndexCache();
  globalThis.document = mockDoc;
  globalThis.fetch = async url => {
    requested.push(String(url));
    if (offline) throw new Error('offline');
    if (!files.has(String(url))) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify(files.get(String(url))), { status: 200 });
  };
  globalThis.localStorage = {
    getItem: () => JSON.stringify([{ kind: 'airport', id: 'RKSI', label: 'Incheon', latitude: 37.4691, longitude: 126.451 }]),
    setItem() {},
  };
  try {
    let plan = null;
    const added = [];
    const screen = initLobbyScreen({
      getAirport: () => 'incheon', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getDestination: () => 'none', getMapPlan: () => plan,
      onMapPlan: value => { plan = value; }, onMapPlacesAdded: airports => added.push(...airports),
    });
    screen.setMapPlaces({
      airports: [{ code: 'RKSI', iata: 'ICN', name: 'Incheon International Airport', latitude: 37.4691, longitude: 126.451, runways: [] }],
      points: [],
    });
    const search = elements.get('lobby-map-search');
    const status = elements.get('lobby-map-search-status');
    const results = elements.get('lobby-map-results');
    const bookmarks = elements.get('lobby-map-bookmarks');

    assert.equal(results.children.length, 0, 'empty search query must not display false-empty search messages');

    search.value = 'jfk';
    search.listeners.input[0]();
    assert.equal(status.textContent, t('lobby.map.search.loading'));
    await screen.requestAirportSearchIndex().catch(() => {});
    assert.equal(status.textContent, `${t('lobby.map.search.error')} · ${t('lobby.map.search.retry')}`);

    search.value = 'incheon';
    search.listeners.input[0]();
    await screen.requestAirportSearchIndex().catch(() => {});
    assert.ok(results.children.some(child => child.dataset.placeId === 'RKSI'), 'local results survive an index failure');
    assert.ok(bookmarks.children.some(child => child.dataset.placeId === 'RKSI'), 'bookmarks survive an index failure');

    offline = false;
    const retry = elements.get('lobby-map-search-retry');
    assert.equal(retry.hidden, false, 'retry control is visible while the index is unavailable');
    retry.listeners.click[0]();
    await screen.requestAirportSearchIndex();
    await screen.requestPlaceSearchIndex();
    assert.equal(retry.hidden, true, 'retry control hides after both indexes load');
    search.value = 'jfk';
    search.listeners.input[0]();
    const globalButton = results.children.find(child => child.dataset.placeSource === 'global');
    assert.ok(globalButton, 'a global result appears after retry');
    assert.equal(status.textContent, `1 ${t('lobby.map.results')}`);
    search.value = 'zzzz';
    search.listeners.input[0]();
    assert.equal(status.textContent, t('lobby.map.search.empty'));

    const tileRequests = () => requested.filter(url => url.endsWith('/tiles/13-10.json')).length;
    assert.equal(tileRequests(), 0);
    results.listeners.click[0]({ target: { closest: () => globalButton } });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(tileRequests(), 1, 'selection resolves through exactly one tile lookup');
    assert.equal(plan?.airportCode, 'KJFK');
    assert.equal(plan?.state, 'runway');
    assert.equal(added.length, 1);
    assert.equal(added[0].code, 'KJFK');
    assert.equal(added[0].country, 'US');
    assert.equal(added[0].runways.length, 1);
    assert.equal(elements.get('lobby-map-airport').value, 'KJFK');
    assert.equal(elements.get('lobby-map-departure').value, '');
  } finally {
    globalThis.document = originalDoc;
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    clearAirportIndexCache();
    clearPlaceIndexCache();
  }
});

test('UI State Contract: a tile failure keeps the loaded global search results', async () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const { files } = globalFixture();
  clearPlaceIndexCache();
  globalThis.document = mockDoc;
  globalThis.fetch = async url => {
    if (String(url).includes('/tiles/')) throw new Error('tile offline');
    const body = files.get(String(url));
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('missing', { status: 404 });
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  try {
    let plan = null;
    const screen = initLobbyScreen({
      getAirport: () => 'incheon', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getDestination: () => 'none', getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    screen.setMapPlaces({ airports: [], points: [] });
    const search = elements.get('lobby-map-search');
    const results = elements.get('lobby-map-results');
    const status = elements.get('lobby-map-search-status');
    await screen.requestAirportSearchIndex();
    search.value = 'jfk';
    search.listeners.input[0]();
    const globalButton = results.children.find(child => child.dataset.placeSource === 'global');
    assert.ok(globalButton, 'global result loaded before the tile failure');
    results.listeners.click[0]({ target: { closest: () => globalButton } });
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(status.textContent, t('lobby.map.search.tileError'));
    assert.equal(plan, null, 'a failed tile lookup must not emit a partial map plan');
    assert.ok(results.children.some(child => child.dataset.placeId === 'KJFK'), 'search results stay visible');
    assert.equal(elements.get('lobby-map-search-retry').hidden, true, 'index retry is not offered for a tile error');
  } finally {
    globalThis.document = originalDoc;
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    clearAirportIndexCache();
    clearPlaceIndexCache();
  }
});

test('UI State Contract: an airport without runways never offers a runway start', () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;
  try {
    let plan = null;
    const screen = initLobbyScreen({
      getAirport: () => 'incheon', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    screen.setMapPlaces({
      airports: [{ code: 'ZZZZ', iata: '', name: 'No Runways Field', latitude: 37, longitude: 127, runways: [] }],
      points: [],
    });
    elements.get('lobby-map-search').value = 'zzzz';
    screen.setMapSearchState('ready');
    const button = elements.get('lobby-map-results').children.find(child => child.dataset.placeId === 'ZZZZ');
    assert.ok(button);
    elements.get('lobby-map-results').listeners.click[0]({ target: { closest: () => button } });
    assert.equal(plan?.state, 'cruise');
    assert.equal(plan?.runwayKey, '');
    assert.equal(elements.get('lobby-map-runway').value, '');
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: map pins tell runway airports from cruise-only places and locked starts say why', () => {
  const { elements, mockDoc } = setupMapDOM();
  for (const [id, label] of [['lobby-preset-rwy', 'lobby.takeoff'], ['lobby-preset-cru', 'lobby.cruiseStart'], ['lobby-preset-app', 'lobby.approachStart']]) {
    const button = new MockElement(id, 'button');
    button.dataset.startLabel = label;
    button.style = {};
    elements.set(id, button);
  }
  for (const id of ['lobby-start-reason', 'lobby-map-place-status']) elements.set(id, new MockElement(id, 'p'));
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;
  try {
    let plan = null;
    let aircraft = 'B738';
    const screen = initLobbyScreen({
      getAirport: () => 'incheon', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => aircraft,
      getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    const runway = (lengthM, surface = 'ASP') => ({ id: '1', lengthM, surface, ends: [{ ident: '09', headingDegT: 90 }, { ident: '27', headingDegT: 270 }] });
    const airports = [
      { code: 'RKSI', iata: 'ICN', name: 'Incheon International Airport', latitude: 37.4691, longitude: 126.451, runways: [runway(3750)] },
      { code: 'RKSS', iata: 'GMP', name: 'Seoul Gimpo International Airport', latitude: 37.5583, longitude: 126.7906, runways: [runway(3600)] },
      { code: 'RKSW', iata: 'SWU', name: 'Suwon Airport', latitude: 37.2394, longitude: 127.007, runways: [runway(2743)] },
      { code: 'XSHT', iata: '', name: 'Short Field Airport', latitude: 36.5, longitude: 127.5, runways: [runway(1100)] },
      { code: 'ZZZZ', iata: '', name: 'No Runways Field', latitude: 37, longitude: 127, runways: [] },
    ];
    // Inspect individual pins at a zoom where the new cluster badge has split.
    elements.get('lobby-map-svg').setAttribute('viewBox', mapViewBoxFor(37.1, 127, 8));
    screen.setMapPlaces({ airports, points: [{ id: 'sea-point', label: 'Open Sea', latitude: 36, longitude: 125 }] });
    const nameOf = code => airportDisplayName(airports.find(airport => airport.code === code), getLanguage());
    const marker = id => elements.get('lobby-map-markers').children.find(child => child.dataset.placeId === id);
    const markerClasses = id => marker(id).getAttribute('class').split(/\s+/);
    assert.equal(marker('RKSI').dataset.tier, 'full');
    assert.ok(markerClasses('RKSI').includes('full'), 'full-scenery airports get the gold-centre pin');
    assert.equal(marker('RKSS').dataset.tier, 'runway');
    for (const id of ['RKSI', 'RKSS']) {
      assert.equal(marker(id).dataset.landable, 'true');
      assert.ok(!markerClasses(id).includes('cruise-only'));
      assert.ok(marker(id).children.some(child => child.tagName === 'PATH'), `${id} keeps the pin`);
    }
    for (const id of ['RKSW', 'XSHT', 'ZZZZ', 'sea-point']) {
      assert.equal(marker(id).dataset.landable, 'false', `${id} is cruise-only for the B737`);
      assert.ok(markerClasses(id).includes('cruise-only'), `${id} draws the cruise-only marker`);
      assert.ok(!marker(id).children.some(child => child.tagName === 'PATH'), `${id} has no runway pin`);
    }
    assert.equal(marker('RKSW').children.at(-1).textContent, `${nameOf('RKSW')} · ${t('lobby.map.tier.cruise')}`);
    assert.equal(marker('RKSS').children.at(-1).textContent, `${nameOf('RKSS')} · ${t('lobby.map.tier.runway')}`);

    const start = elements.get('lobby-start-reason');
    const status = elements.get('lobby-map-place-status');
    const takeoff = elements.get('lobby-preset-rwy');
    const approach = elements.get('lobby-preset-app');
    const cruise = elements.get('lobby-preset-cru');
    assert.equal(start.hidden, true, 'no reason before a cruise-only place is chosen');
    assert.equal(status.hidden, true, 'no place status before a map place is chosen');

    const pick = code => {
      elements.get('lobby-map-search').value = code.toLowerCase();
      screen.setMapSearchState('ready');
      const button = elements.get('lobby-map-results').children.find(child => child.dataset.placeId === code);
      assert.ok(button, `${code} is searchable`);
      elements.get('lobby-map-results').listeners.click[0]({ target: { closest: () => button } });
      screen.refresh();
    };

    pick('ZZZZ');
    assert.equal(takeoff.disabled, true);
    assert.equal(approach.disabled, true);
    assert.equal(cruise.disabled, false);
    assert.equal(start.hidden, false);
    assert.equal(start.textContent, t('lobby.reason.cruiseOnly'));
    assert.equal(takeoff.getAttribute('aria-describedby'), 'lobby-start-reason');
    assert.equal(cruise.getAttribute('aria-describedby'), null, 'the open cruise start is not described as locked');
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, nameOf('ZZZZ'), 'the status line is just the place name');
    assert.equal(status.classList.contains('cruise-only'), true);

    pick('RKSI');
    assert.equal(takeoff.disabled, false);
    assert.equal(start.hidden, true);
    assert.equal(takeoff.getAttribute('aria-describedby'), null);
    assert.equal(status.textContent, nameOf('RKSI'));
    assert.equal(status.classList.contains('cruise-only'), false);

    pick('RKSS');
    assert.equal(takeoff.disabled, false);
    assert.equal(plan.state, 'runway');
    assert.equal(status.textContent, nameOf('RKSS'));

    pick('RKSW');
    assert.equal(plan.state, 'cruise', 'a military airfield never plans a runway start');
    assert.equal(takeoff.disabled, true);
    assert.equal(start.textContent, t('lobby.reason.military'));
    assert.equal(status.textContent, nameOf('RKSW'));

    // A short field opens for the Cessna and closes again for the B737.
    aircraft = 'C172';
    pick('XSHT');
    assert.equal(takeoff.disabled, false);
    assert.equal(plan.state, 'runway');
    const b737 = AIRCRAFT_REGISTRY.B738.name;
    aircraft = 'B738';
    screen.refresh();
    assert.equal(plan.state, 'cruise', 'switching to an aircraft the runway cannot take drops the runway plan');
    assert.equal(takeoff.disabled, true);
    assert.equal(start.textContent, t('lobby.reason.runwayTooShort', { length: '1,100', min: '1,800', aircraft: b737 }));
    assert.equal(status.textContent, nameOf('XSHT'));
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: dense map bookmarks share a numbered marker that zooms in', () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalStorage = globalThis.localStorage;
  globalThis.document = mockDoc;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  try {
    let plan = null;
    const screen = initLobbyScreen({
      getAirport: () => 'coastal', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    const runway = lengthM => ({ id: '1', lengthM, surface: 'ASP', ends: [{ ident: '09', headingDegT: 90 }, { ident: '27', headingDegT: 270 }] });
    screen.setMapPlaces({
      airports: [
        { code: 'RKSI', name: 'Incheon', latitude: 37.4691, longitude: 126.451, runways: [runway(3750)] },
        { code: 'RKSS', name: 'Gimpo', latitude: 37.5583, longitude: 126.7906, runways: [runway(3600)] },
        { code: 'KJFK', name: 'JFK', latitude: 40.6394, longitude: -73.7793, runways: [runway(4400)] },
      ],
      points: [],
    });
    const markers = () => elements.get('lobby-map-markers').children;
    const cluster = markers().find(marker => marker.dataset.clusterIndex !== undefined);
    assert.ok(cluster, 'nearby pins collapse into one cluster');
    assert.equal(cluster.children.find(child => child.tagName === 'TEXT')?.textContent, '2');
    assert.ok(cluster.children.some(child => child.textContent === t('lobby.map.cluster.title', { count: 2 })));
    assert.ok(markers().some(marker => marker.dataset.placeId === 'KJFK'), 'a distant pin stays separate');
    assert.ok(!markers().some(marker => marker.dataset.placeId === 'RKSI' || marker.dataset.placeId === 'RKSS'));

    const svg = elements.get('lobby-map-svg');
    svg.listeners.click[0]({ target: { closest: selector => selector === '[data-cluster-index]' ? cluster : null } });
    const width = Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
    assert.ok(width < 1024, 'clicking a cluster zooms into its area');
    assert.ok(markers().some(marker => marker.dataset.placeId === 'RKSI'));
    assert.ok(markers().some(marker => marker.dataset.placeId === 'RKSS'));
    assert.equal(markers().filter(marker => marker.dataset.clusterIndex !== undefined).length, 0);
    assert.equal(plan, null, 'zooming to a cluster must not select a place');
  } finally {
    globalThis.document = originalDoc;
    globalThis.localStorage = originalStorage;
  }
});

test('UI State Contract: a cluster that cannot zoom further lists its members for selection', () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalStorage = globalThis.localStorage;
  const zoomIn = new MockElement('lobby-map-zoom-in', 'button');
  elements.set('lobby-map-zoom-in', zoomIn);
  globalThis.document = mockDoc;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  try {
    let plan = null;
    const screen = initLobbyScreen({
      getAirport: () => 'coastal', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    for (let i = 0; i < 12; i++) zoomIn.listeners.click[0]();
    const svg = elements.get('lobby-map-svg');
    svg.setAttribute('viewBox', mapViewBoxFor(37.4691, 126.451, 12));
    const runway = { id: '1', lengthM: 3750, surface: 'ASP', ends: [{ ident: '09', headingDegT: 90 }, { ident: '27', headingDegT: 270 }] };
    screen.setMapPlaces({
      airports: [{ code: 'RKSI', name: 'Incheon', latitude: 37.4691, longitude: 126.451, runways: [runway] }],
      points: [{ id: 'close-point', label: 'Nearby point', latitude: 37.4641, longitude: 126.451 }],
    });
    const markers = () => elements.get('lobby-map-markers').children;
    const cluster = markers().find(marker => marker.dataset.clusterIndex !== undefined);
    assert.ok(cluster, 'very close places stay clustered at maximum zoom');
    const before = svg.getAttribute('viewBox');
    svg.listeners.click[0]({ target: { closest: selector => selector === '[data-cluster-index]' ? cluster : null } });
    assert.equal(svg.getAttribute('viewBox'), before, 'no further zoom remains');
    const results = elements.get('lobby-map-results');
    assert.deepEqual(results.children.map(button => button.dataset.placeId), ['RKSI', 'close-point']);
    assert.equal(elements.get('lobby-map-search-status').textContent, t('lobby.map.cluster.choose'));

    const memberButton = results.children.find(button => button.dataset.placeId === 'close-point');
    results.listeners.click[0]({ target: { closest: () => memberButton } });
    assert.equal(plan?.pointId, 'close-point', 'the listed member can still be selected');
  } finally {
    globalThis.document = originalDoc;
    globalThis.localStorage = originalStorage;
  }
});

test('UI State Contract: horizontal pan wraps into repeating worlds', () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalStorage = globalThis.localStorage;
  globalThis.document = mockDoc;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  try {
    const screen = initLobbyScreen({
      getAirport: () => 'coastal', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
    });
    const svg = elements.get('lobby-map-svg');
    svg.getBoundingClientRect = () => ({ x: 0, y: 0, width: 400, height: 300 });
    screen.enableMapTiles();
    screen.setMapPlaces({
      airports: [{ code: 'RKSI', name: 'Incheon', latitude: 37.4691, longitude: 126.451, runways: [] }],
      points: [],
    });

    svg.listeners.pointerdown[0]({ pointerId: 1, clientX: 300, clientY: 150 });
    svg.listeners.pointermove[0]({ pointerId: 1, clientX: -200, clientY: 150 });
    const [x, , width] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    assert.ok(x > MAP_WIDTH, 'dragging past the edge keeps panning instead of clamping');
    assert.ok(elements.get('lobby-map-tiles').children.some(image => Number(image.getAttribute('x')) >= MAP_WIDTH), 'tiles repeat on the far side');
    const markers = elements.get('lobby-map-markers').children;
    assert.ok(markers.some(marker => Number(marker.dataset.mapX) > x && Number(marker.dataset.mapX) < x + width), 'a marker is drawn in the repeated copy');
    svg.listeners.pointerup[0]({ pointerId: 1 });
  } finally {
    globalThis.document = originalDoc;
    globalThis.localStorage = originalStorage;
  }
});

test('UI State Contract: lobby map tiles stay deferred until enableMapTiles is called', () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;
  try {
    const screen = initLobbyScreen({
      getAirport: () => 'coastal', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
    });
    const tilesEl = elements.get('lobby-map-tiles');
    assert.equal(tilesEl.children.length, 0, 'map tiles should not load during initial boot');
    screen.enableMapTiles();
    assert.ok(tilesEl.children.length > 0, 'map tiles should populate after enableMapTiles');
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: held flight card without airportLabel does not leak pending map place', () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;
  try {
    let plan = null;
    const screen = initLobbyScreen({
      getAirport: () => 'coastal',
      getPreset: () => 'runway',
      getTime: () => 12,
      getAircraft: () => 'B738',
      getMapPlan: () => plan,
      onMapPlan: value => { plan = value; },
      canResume: () => true,
      canEnd: () => true,
      getHeldFlight: () => ({
        airport: 'lukla',
        aircraft: 'C172',
        scenario: 'approach',
        timeOfDay: 9.5,
        deviceTime: false,
      }),
    });
    const runway = { id: '1', lengthM: 3750, surface: 'ASP', ends: [{ ident: '09', headingDegT: 90 }] };
    screen.setMapPlaces({
      airports: [{ code: 'KJFK', iata: 'JFK', name: 'John F. Kennedy International Airport', latitude: 40.6394, longitude: -73.7793, runways: [runway] }],
      points: [],
    });
    elements.get('lobby-map-search').value = 'jfk';
    screen.setMapSearchState('ready');
    const jfkBtn = elements.get('lobby-map-results').children.find(child => child.dataset.placeId === 'KJFK');
    assert.ok(jfkBtn, 'map search exposes KJFK');
    elements.get('lobby-map-results').listeners.click[0]({ target: { closest: () => jfkBtn } });
    assert.equal(plan?.airportCode, 'KJFK');

    assert.equal(
      elements.get('lobby-managed-airport').textContent,
      t('lukla.vnlk'),
      'held flight card must keep the active flight airport rather than leaking pending map place',
    );
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: addon aircraft button tracks active state and scenario lock in LobbyScreen', () => {
  const { elements, mockDoc } = setupMockDOM();
  const addonId = 'demo-addon-ui';
  const picker = new MockElement('lobby-aircraft-picker', 'details');
  const buttonsGroup = new MockElement('', 'div');
  const summary = new MockElement('', 'summary');
  picker.appendChild(summary);
  picker.appendChild(buttonsGroup);
  picker.querySelector = sel => {
    if (sel === '.lobby-buttons') return buttonsGroup;
    if (sel === 'summary') return summary;
    return null;
  };
  elements.set('lobby-aircraft-picker', picker);
  elements.set('lobby-aircraft-reason', new MockElement('lobby-aircraft-reason', 'p'));
  const baseGetById = mockDoc.getElementById;
  mockDoc.getElementById = id => baseGetById(id) || buttonsGroup.children.find(child => child.id === id) || null;

  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;
  try {
    let aircraft = 'B738';
    let airport = 'coastal';
    let preset = 'runway';
    const screen = initLobbyScreen({
      getAirport: () => airport,
      getPreset: () => preset,
      getTime: () => 12,
      getAircraft: () => aircraft,
      getAircraftOptions: () => ['B738', 'C172', 'F16', addonId],
      onAirport: value => { airport = value; },
      onPreset: value => { preset = value; },
      onTime: () => {},
      onAircraft: value => { aircraft = value; },
      onFly: () => {},
    });

    const addonBtn = mockDoc.getElementById(`lobby-aircraft-${addonId}`);
    assert.ok(addonBtn, 'addon aircraft button should be created in the picker');
    assert.equal(addonBtn.classList.contains('active'), false);
    assert.equal(addonBtn.disabled, false);

    picker.open = true;
    addonBtn.click();
    assert.equal(aircraft, addonId);
    assert.equal(picker.open, false, 'clicking addon aircraft closes the picker');
    screen.refresh();
    assert.equal(addonBtn.classList.contains('active'), true, 'selected addon button gets .active');
    assert.equal(elements.get('lobby-aircraft-b738').classList.contains('active'), false);
    assert.equal(addonBtn.disabled, false);

    airport = 'valley';
    preset = 'valley';
    screen.refresh();
    assert.equal(addonBtn.disabled, true, 'addon aircraft button disables when valley locks aircraft');
    assert.equal(addonBtn.getAttribute('aria-describedby'), 'lobby-aircraft-reason');

    airport = 'neon';
    preset = 'bridge';
    screen.refresh();
    assert.equal(addonBtn.disabled, true, 'addon aircraft button disables when bridge locks aircraft');
    assert.equal(addonBtn.getAttribute('aria-describedby'), 'lobby-aircraft-reason');
  } finally {
    globalThis.document = originalDoc;
  }
});

test('UI State Contract: offline place search finds landmarks and starts a cruise', async () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  clearAirportIndexCache();
  clearPlaceIndexCache();
  const base = 'http://localhost/data/places/';
  const manifest = {
    schemaVersion: 1,
    kind: 'flight3d-place-index',
    version: 'fixture',
    searchIndex: { path: 'fixture/places.json', schemaVersion: 1, count: 2 },
  };
  const artifact = {
    schemaVersion: 1,
    version: 'fixture',
    places: [
      { id: 'geonames:252919', label: 'Santorini Island', aliases: ['Santorini'], detail: 'island · GR', latitude: 36.40572, longitude: 25.45682, country: 'GR', kind: 'island', elevationM: 42 },
      { id: 'geonames:6254976', label: 'Tour Eiffel', aliases: ['Eiffel Tower', '에펠 탑'], detail: 'landmark · FR', latitude: 48.85832, longitude: 2.29452, country: 'FR', kind: 'landmark', elevationM: 0 },
    ],
  };
  const files = new Map([
    [`${base}manifest.json`, manifest],
    [`${base}fixture/places.json`, artifact],
  ]);
  globalThis.document = mockDoc;
  globalThis.fetch = async url => {
    const body = files.get(String(url));
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('missing', { status: 404 });
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  try {
    let plan = null;
    const screen = initLobbyScreen({
      getAirport: () => 'incheon', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getDestination: () => 'none', getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    screen.setMapPlaces({ airports: [], points: [] });
    await screen.requestPlaceSearchIndex();
    await screen.requestAirportSearchIndex().catch(() => {});

    const search = elements.get('lobby-map-search');
    const results = elements.get('lobby-map-results');
    search.value = 'eiffel tower';
    search.listeners.input[0]();
    const placeButton = results.children.find(child => child.dataset.placeSource === 'place-index');
    assert.ok(placeButton, 'place index result appears by alias');
    assert.equal(placeButton.dataset.placeId, 'geonames:6254976');

    results.listeners.click[0]({ target: { closest: () => placeButton } });
    assert.equal(elements.get('lobby-map-state').value, 'cruise');
    assert.equal(elements.get('lobby-map-point').value, 'geonames:6254976');
    assert.equal(plan?.state, 'cruise');
    assert.equal(plan?.pointId, 'geonames:6254976');
  } finally {
    globalThis.document = originalDoc;
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    clearAirportIndexCache();
    clearPlaceIndexCache();
  }
});

test('UI State Contract: search dropdown and lobby place row let users bookmark places without losing the modal or selection', async () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  clearAirportIndexCache();
  clearPlaceIndexCache();
  const store = new Map();
  const { files } = globalFixture();
  const placeBase = 'http://localhost/data/places/';
  files.set(`${placeBase}fixture/places.json`, {
    schemaVersion: 1,
    version: 'fixture',
    places: [
      { id: 'geonames:1260454', label: 'Pangong Tso', aliases: ['Pangong Lake', '판공초'], detail: 'lake · IN', latitude: 33.75, longitude: 78.66, country: 'IN', kind: 'lake', elevationM: 4249 },
    ],
  });
  globalThis.document = mockDoc;
  globalThis.fetch = async url => {
    const body = files.get(String(url));
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('missing', { status: 404 });
  };
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  try {
    let plan = null;
    const dialog = elements.get('lobby-map-dialog');
    dialog.open = true;
    dialog.close = () => { dialog.open = false; };
    const screen = initLobbyScreen({
      getAirport: () => 'incheon', getPreset: () => 'runway', getTime: () => 12, getAircraft: () => 'B738',
      getDestination: () => 'none', getMapPlan: () => plan, onMapPlan: value => { plan = value; },
    });
    screen.setMapPlaces({ airports: [], points: [] });
    await screen.requestPlaceSearchIndex();
    await screen.requestAirportSearchIndex();

    const search = elements.get('lobby-map-search');
    const results = elements.get('lobby-map-results');
    const bookmarks = elements.get('lobby-map-bookmarks');
    const placeBookmark = elements.get('lobby-place-bookmark');
    assert.equal(placeBookmark.hidden, true, 'lobby place bookmark button stays hidden until a map place is active');

    // 1. Bookmark Pangong Tso directly from the search dropdown without closing the dialog.
    search.value = 'pangong';
    search.listeners.input[0]();
    const row = results.children.find(child => child.dataset.placeId === 'geonames:1260454');
    assert.ok(row, 'Pangong Tso result row appears');
    const starBtn = row.children.find(child => child.dataset.bookmarkToggle === 'true');
    assert.ok(starBtn, 'search result row includes a bookmark toggle button');
    assert.equal(starBtn.textContent, '☆');

    results.listeners.click[0]({
      target: { closest: selector => (selector === '[data-bookmark-toggle]' ? starBtn : null) },
    });
    assert.equal(dialog.open, true, 'bookmarking a search result must keep the map dialog open');
    assert.equal(plan, null, 'bookmarking a search result must not select or emit a plan');
    assert.ok(bookmarks.children.some(child => child.dataset.placeId === 'geonames:1260454'), 'Pangong Tso appears in saved places');
    const updatedRow = results.children.find(child => child.dataset.placeId === 'geonames:1260454');
    const updatedStar = updatedRow.children.find(child => child.dataset.bookmarkToggle === 'true');
    assert.equal(updatedStar.textContent, '★', 'dropdown star reflects bookmarked state');

    // 2. Selecting Pangong Tso keeps the dialog open (dismissing the dropdown) so the user can inspect/bookmark it before confirming.
    const selectBtn = updatedRow.children.find(child => child.dataset.placeId === 'geonames:1260454');
    results.listeners.click[0]({
      target: { closest: selector => (selector === '[data-place-kind]' ? selectBtn : null) },
    });
    assert.equal(dialog.open, true, 'selecting a search result must keep the map dialog open until confirmed');
    assert.equal(results.children.length, 0, 'selecting a search result dismisses the dropdown so the map is visible');
    assert.equal(plan?.pointId, 'geonames:1260454');
    assert.equal(plan?.point?.altitudeM, 4950, 'high-elevation lake keeps its computed cruise altitude');
    assert.equal(placeBookmark.hidden, false, 'scenario menu bookmark button appears for the active map place');
    assert.equal(placeBookmark.textContent, '★');

    // Confirming closes the dialog and returns to the scenario start menu.
    elements.get('lobby-map-confirm').listeners.click[0]();
    assert.equal(dialog.open, false, 'clicking the confirm button closes the map dialog');

    // 3. Toggling the scenario menu bookmark button removes and re-adds the active place.
    placeBookmark.listeners.click[0]();
    assert.equal(placeBookmark.textContent, '☆');
    assert.ok(!bookmarks.children.some(child => child.dataset.placeId === 'geonames:1260454'));
    placeBookmark.listeners.click[0]();
    assert.equal(placeBookmark.textContent, '★');
    assert.ok(bookmarks.children.some(child => child.dataset.placeId === 'geonames:1260454'));

    // 4. Global airport result can also be bookmarked directly from the dropdown.
    search.value = 'jfk';
    search.listeners.input[0]();
    const jfkRow = results.children.find(child => child.dataset.placeId === 'KJFK');
    const jfkStar = jfkRow?.children.find(child => child.dataset.bookmarkToggle === 'true');
    assert.ok(jfkStar, 'global airport result includes a bookmark button');
    results.listeners.click[0]({
      target: { closest: selector => (selector === '[data-bookmark-toggle]' ? jfkStar : null) },
    });
    assert.ok(bookmarks.children.some(child => child.dataset.placeId === 'KJFK'), 'global airport bookmark is saved');
  } finally {
    globalThis.document = originalDoc;
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    clearAirportIndexCache();
    clearPlaceIndexCache();
  }
});
