import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';
import { initLobbyScreen } from '../src/ui/LobbyScreen.js';
import { clearAirportIndexCache } from '../src/geospatial/airportIndex.js';
import { t } from '../src/i18n/index.js';
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
const MAP_BROWSER_IDS = ['lobby-map-search', 'lobby-map-results', 'lobby-map-bookmarks', 'lobby-map-default-bookmarks', 'lobby-map-search-status', 'lobby-map-search-retry', 'lobby-map-bookmark-toggle', 'lobby-map-svg', 'lobby-map-markers', 'lobby-map-overview', 'lobby-map-tiles'];

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
  clearAirportIndexCache();
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
    assert.equal(retry.hidden, true, 'retry control hides after a successful load');
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
  }
});

test('UI State Contract: a tile failure keeps the loaded global search results', async () => {
  const { elements, mockDoc } = setupMapDOM();
  const originalDoc = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const { files } = globalFixture();
  clearAirportIndexCache();
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
