import test from 'node:test';
import assert from 'node:assert/strict';
import { initLobbyScreen } from '../src/ui/LobbyScreen.js';
import { DEFAULT_AIRPORT } from '../src/config/flightSelection.js';
import { SPAWN_SCENARIOS } from '../src/config/scenarioRegistry.js';
import { setLanguage, t } from '../src/i18n/index.js';

class MockElement {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.options = [];
    this.attributes = {};
  }
  _className = '';
  set className(val) {
    this._className = val;
    this.classList._classes = new Set(val.split(/\s+/).filter(Boolean));
  }
  get className() {
    return this._className;
  }
  classList = {
    _classes: new Set(),
    add: (...cls) => {
      cls.forEach(c => this.classList._classes.add(c));
      this._className = [...this.classList._classes].join(' ');
    },
    remove: (...cls) => {
      cls.forEach(c => this.classList._classes.delete(c));
      this._className = [...this.classList._classes].join(' ');
    },
    toggle: (c, force) => {
      if (force === undefined) {
        if (this.classList._classes.has(c)) this.classList.remove(c);
        else this.classList.add(c);
      } else if (force) this.classList.add(c);
      else this.classList.remove(c);
    },
    contains: (c) => this.classList._classes.has(c),
  };
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(evt, fn) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(fn);
  }
  click(target = this) {
    if (this.onclick) this.onclick();
    const event = { preventDefault() {}, target };
    let cur = this;
    while (cur) {
      cur.listeners['click']?.forEach(fn => fn(event));
      cur = cur.parentElement;
    }
  }
  dispatchEvent(event) {
    this.listeners[event.type]?.forEach(fn => fn(event));
  }
  contains(el) {
    if (this === el) return true;
    return this.children.some(child => child.contains?.(el));
  }
  closest(sel) {
    const match = el => {
      if (sel === '[data-place-kind]') return Boolean(el.dataset?.placeKind);
      if (sel.startsWith('.')) return el.classList?.contains?.(sel.slice(1));
      if (sel.startsWith('#')) return el.id === sel.slice(1);
      return el.tagName === sel.toUpperCase();
    };
    let cur = this;
    while (cur) {
      if (match(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children) {
    for (const c of children) this.appendChild(c);
  }
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
    return null;
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

  const titleEl = new MockElement('', 'title');
  const scenarioContainer = new MockElement('', 'div');
  scenarioContainer.className = 'lobby-group lobby-scenarios';

  const lobbyButtons = new MockElement('', 'div');
  lobbyButtons.className = 'lobby-buttons';
  scenarioContainer.appendChild(lobbyButtons);

  for (const scenario of Object.values(SPAWN_SCENARIOS)) {
    if (!scenario.lobbyButtonId) continue;
    const btn = getOrCreate(scenario.lobbyButtonId, 'button');
    btn.className = 'btn btn-preset';
    const span = new MockElement('', 'span');
    btn.appendChild(span);
    lobbyButtons.appendChild(btn);
  }
  elements.get('lobby-preset-rwy').dataset.startLabel = 'lobby.takeoff';
  elements.get('lobby-preset-cru').dataset.startLabel = 'lobby.cruiseStart';
  elements.get('lobby-preset-app').dataset.startLabel = 'lobby.approachStart';

  // Pre-create standard lobby elements
  const commonIds = [
    'btn-fly', 'btn-lobby-resume', 'btn-lobby-end',
    'lobby-briefing', 'lobby-loading', 'lobby-selection',
    'lobby-demo-options', 'lobby-demo-select', 'lobby-demo-briefing',
    'lobby-valley-options', 'lobby-pilot-human', 'lobby-pilot-ai',
    'lobby-valley-gyro', 'lobby-valley-settings', 'lobby-valley-preflight',
    'lobby-time-select', 'lobby-tab-settings', 'dev-enabled',
    'lobby-map-search', 'lobby-map-results', 'lobby-map-bookmarks',
    'lobby-map-default-bookmarks', 'lobby-map-bookmark-toggle', 'lobby-map-overview',
    'lobby-aircraft-b738', 'lobby-aircraft-c172', 'lobby-aircraft-f16',
    'lobby-lang-en', 'lobby-lang-ko',
  ];
  for (const id of commonIds) {
    const tag = id.includes('select') ? 'select' : id.includes('search') ? 'input' : id.includes('btn') || id.includes('preset') || id.includes('aircraft') || id.includes('lang') || id.includes('pilot') || id.includes('gyro') || id.includes('settings') || id.includes('toggle') || id.includes('overview') ? 'button' : 'div';
    getOrCreate(id, tag);
  }

  getOrCreate('btn-fly').appendChild(new MockElement('', 'span'));
  getOrCreate('lobby-valley-gyro').appendChild(new MockElement('', 'span')).className = 'gyro-label';

  const mockDocument = {
    getElementById: id => elements.get(id) || null,
    querySelector: sel => {
      if (sel === 'title') return titleEl;
      if (sel === '#btn-fly') return elements.get('btn-fly');
      if (sel === '#lobby-preset-demo') return elements.get('lobby-preset-demo');
      return null;
    },
    querySelectorAll: sel => {
      if (sel.includes('.btn-demo-extra')) {
        return lobbyButtons.children.filter(c => c.classList.contains('btn-demo-extra'));
      }
      if (sel === '.lobby-tab') return [];
      if (sel.includes('data-spec')) return [];
      return [];
    },
    createElement: tag => new MockElement('', tag),
    documentElement: { lang: 'ko' },
  };

  return { mockDocument, elements, lobbyButtons, titleEl };
}

test('inline demo scenario buttons render side-by-side with normal scenarios and append (데모) / (Demo)', () => {
  const originalDoc = globalThis.document;
  try {
    const { mockDocument, elements, lobbyButtons, titleEl } = setupMockDOM();
    globalThis.document = mockDocument;

    let airport = 'incheon';
    let aircraft = 'B738';
    let preset = 'runway';
    let demoProfile = 'sihwa-tour';

    setLanguage('ko');

    const screen = initLobbyScreen({
      getAirport: () => airport,
      getPreset: () => preset,
      getTime: () => 12,
      getAircraft: () => aircraft,
      getDemoProfile: () => demoProfile,
      onAirport: a => { airport = a; },
      onPreset: p => { preset = p; },
      onTime: () => {},
      onAircraft: a => { aircraft = a; },
      onDemoProfile: d => { demoProfile = d; },
      onFly: () => {},
    });

    // 1. Initial state at Incheon with B738:
    // Regular scenario runway is active
    assert.equal(elements.get('lobby-preset-rwy').classList.contains('active'), true);
    assert.equal(elements.get('lobby-preset-demo').classList.contains('active'), false);

    // B738 at Incheon offers 3 demo choices:
    // 1) incheon-departure, 2) jeju-bangkok-2503, 3) sihwa-tour
    // Button 0 (#lobby-preset-demo) + 2 extra buttons
    const demoBtn0 = elements.get('lobby-preset-demo');
    const extraBtns = lobbyButtons.children.filter(c => c.classList.contains('btn-demo-extra'));
    assert.equal(demoBtn0.style.display, '');
    assert.equal(extraBtns.length, 2);

    // Verify button titles in Korean
    assert.equal(demoBtn0.querySelector('span').textContent, '인천 탑승구 → 푸시백 → 이륙 (데모)');
    assert.equal(extraBtns[0].querySelector('span').textContent, '제주항공 2503편 방콕행 출발 (데모)');
    assert.equal(extraBtns[1].querySelector('span').textContent, '시화 해안 둘러보기 (데모)');

    // 2. Select the 3rd demo button (시화 해안 둘러보기)
    extraBtns[1].click();
    assert.equal(preset, 'demo');
    assert.equal(demoProfile, 'sihwa-tour');
    assert.equal(elements.get('lobby-demo-select').value, 'sihwa-tour');

    // Only the clicked demo button is active
    assert.equal(elements.get('lobby-preset-rwy').classList.contains('active'), false);
    assert.equal(demoBtn0.classList.contains('active'), false);
    assert.equal(extraBtns[0].classList.contains('active'), false);
    assert.equal(extraBtns[1].classList.contains('active'), true);

    // Document title reflects the chosen demo flight with (데모)
    assert.ok(titleEl.textContent.includes('시화 해안 둘러보기 (데모)'));

    // 3. Select the 1st demo button (#lobby-preset-demo: incheon-departure)
    demoBtn0.click();
    assert.equal(preset, 'demo');
    assert.equal(demoProfile, 'incheon-departure');
    assert.equal(elements.get('lobby-demo-select').value, 'incheon-departure');
    assert.equal(demoBtn0.classList.contains('active'), true);
    assert.equal(extraBtns[0].classList.contains('active'), false);
    assert.equal(extraBtns[1].classList.contains('active'), false);
    assert.ok(titleEl.textContent.includes('인천 탑승구 → 푸시백 → 이륙 (데모)'));

    // 4. English locale appends (Demo)
    setLanguage('en');
    assert.equal(demoBtn0.querySelector('span').textContent, 'Incheon gate → pushback → takeoff (Demo)');
    assert.equal(extraBtns[0].querySelector('span').textContent, 'Jeju Air 2503 Bangkok departure (Demo)');
    assert.equal(extraBtns[1].querySelector('span').textContent, 'Sihwa coastal tour (Demo)');
    assert.ok(titleEl.textContent.includes('Incheon gate → pushback → takeoff (Demo)'));

    // 5. Switching to regular scenario (Runway)
    elements.get('lobby-preset-rwy').click();
    screen.refresh();
    assert.equal(preset, 'runway');
    assert.equal(elements.get('lobby-preset-rwy').classList.contains('active'), true);
    assert.equal(demoBtn0.classList.contains('active'), false);
    assert.equal(extraBtns[0].classList.contains('active'), false);
    assert.equal(extraBtns[1].classList.contains('active'), false);

    // 6. Switch aircraft to C172 at Incheon (2 demo choices: incheon-tour, sihwa-tour)
    aircraft = 'C172';
    screen.refresh();
    const c172Extras = lobbyButtons.children.filter(c => c.classList.contains('btn-demo-extra'));
    assert.equal(c172Extras.length, 1);
    assert.equal(demoBtn0.querySelector('span').textContent, 'Incheon close-up circuit (Demo)');
    assert.equal(c172Extras[0].querySelector('span').textContent, 'Sihwa coastal tour (Demo)');

    // 7. Switch to Valley (no demo scenarios available)
    airport = 'valley';
    aircraft = 'F16';
    preset = 'valley';
    screen.refresh();
    assert.equal(demoBtn0.style.display, 'none');
    const valleyExtras = lobbyButtons.children.filter(c => c.classList.contains('btn-demo-extra'));
    assert.equal(valleyExtras.length, 0);

    setLanguage('ko');
  } finally {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  }
});

test('time-of-day picker is locked at fixed-time airports (Neon, Valley)', () => {
  const originalDoc = globalThis.document;
  try {
    const { mockDocument, elements } = setupMockDOM();
    globalThis.document = mockDocument;

    const timeSelect = elements.get('lobby-time-select');
    const timeGroup = new MockElement('', 'label');
    timeGroup.appendChild(timeSelect);
    for (const value of ['now', '12', '22.5']) {
      const option = new MockElement('', 'option');
      option.value = value;
      option.textContent = value;
      timeSelect.options.push(option);
    }

    let airport = 'incheon';
    const screen = initLobbyScreen({
      getAirport: () => airport,
      getPreset: () => 'runway',
      getTime: () => 12,
      getAircraft: () => 'C172',
      getDemoProfile: () => null,
      onAirport: () => {},
      onPreset: () => {},
      onTime: () => {},
      onAircraft: () => {},
      onDemoProfile: () => {},
      onFly: () => {},
    });
    const chips = timeGroup.children.find(c => c.classList.contains('lobby-time-chips')).children;
    assert.equal(chips.length, 3);

    for (const [id, locked] of [['incheon', false], ['neon', true], ['valley', true], ['coastal', false]]) {
      airport = id;
      screen.refresh();
      assert.equal(timeSelect.disabled, locked, `${id} select`);
      assert.ok(chips.every(chip => chip.disabled === locked), `${id} chips`);
    }
  } finally {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  }
});

test('all mission buttons remain visible with localized labels and switch to their target region on click', () => {
  const originalDoc = globalThis.document;
  try {
    const { mockDocument, elements } = setupMockDOM();
    globalThis.document = mockDocument;
    setLanguage('ko');

    let airport = 'coastal';
    let preset = 'runway';
    const screen = initLobbyScreen({
      getAirport: () => airport,
      getPreset: () => preset,
      getTime: () => 12,
      getAircraft: () => 'B738',
      getDemoProfile: () => null,
      onAirport: a => { airport = a; },
      onPreset: p => { preset = p; },
      onTime: () => {},
      onAircraft: () => {},
      onDemoProfile: () => {},
      onFly: () => {},
    });

    const missionExpectations = [
      ['lobby-preset-challenge', 'incheon', 'challenge', 'incheon.challenge'],
      ['lobby-preset-bridge', 'neon', 'bridge', 'neon.bridge'],
      ['lobby-preset-cliff', 'lukla', 'cliff', 'downhill.takeoff.rwy.24'],
      ['lobby-preset-valley', 'valley', 'valley', 'valley.slalom.title'],
    ];
    for (const [id, , , labelKey] of missionExpectations) {
      const btn = elements.get(id);
      assert.equal(btn.style.display, '', `${id} must stay visible`);
      assert.equal(btn.querySelector('span').textContent, t(labelKey));
      assert.notEqual(btn.querySelector('span').textContent, t('lobby.spawn'));
    }

    for (const [id, expectedAirport, expectedPreset] of missionExpectations) {
      airport = 'coastal';
      preset = 'runway';
      screen.refresh();
      elements.get(id).click();
      screen.refresh();
      assert.equal(airport, expectedAirport, `${id} should switch airport`);
      assert.equal(preset, expectedPreset, `${id} should switch preset`);
    }
  } finally {
    setLanguage('ko');
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  }
});

test('clicking a start-state button from valley returns to DEFAULT_AIRPORT', () => {
  const originalDoc = globalThis.document;
  try {
    const { mockDocument, elements } = setupMockDOM();
    globalThis.document = mockDocument;

    let airport = 'valley';
    let preset = 'valley';
    const screen = initLobbyScreen({
      getAirport: () => airport,
      getPreset: () => preset,
      getTime: () => 12,
      getAircraft: () => 'F16',
      getDemoProfile: () => null,
      onAirport: a => { airport = a; },
      onPreset: p => { preset = p; },
      onTime: () => {},
      onAircraft: () => {},
      onDemoProfile: () => {},
      onFly: () => {},
    });

    assert.equal(elements.get('lobby-preset-rwy').style.display, '');
    elements.get('lobby-preset-rwy').click();
    screen.refresh();
    assert.equal(airport, DEFAULT_AIRPORT);
    assert.equal(preset, 'runway');
  } finally {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  }
});

test('special regions render in default bookmarks and search results, invoke onAirport, and highlight active state', () => {
  const originalDoc = globalThis.document;
  try {
    const { mockDocument, elements } = setupMockDOM();
    globalThis.document = mockDocument;
    setLanguage('ko');

    let airport = 'incheon';
    let mapPlan = null;
    const screen = initLobbyScreen({
      getAirport: () => airport,
      getPreset: () => 'runway',
      getTime: () => 12,
      getAircraft: () => 'B738',
      getDemoProfile: () => null,
      getMapPlan: () => mapPlan,
      onMapPlan: plan => { mapPlan = plan?.state === 'none' ? null : plan; },
      onAirport: a => { airport = a; mapPlan = null; },
      onPreset: () => {},
      onTime: () => {},
      onAircraft: () => {},
      onDemoProfile: () => {},
      onFly: () => {},
    });

    screen.setMapPlaces({
      airports: [
        { code: 'RKSI', iata: 'ICN', name: 'Incheon International Airport', latitude: 37.4691, longitude: 126.451, runways: [{ id: '15R/33L', ends: [{ ident: '15R', headingDegT: 150 }] }] },
      ],
      points: [],
    });

    const defaults = elements.get('lobby-map-default-bookmarks').children;
    const rksiDefault = defaults.find(btn => btn.dataset.placeId === 'RKSI');
    const luklaDefault = defaults.find(btn => btn.dataset.placeId === 'lukla');
    const neonDefault = defaults.find(btn => btn.dataset.placeId === 'neon');
    const coastalDefault = defaults.find(btn => btn.dataset.placeId === 'coastal');

    assert.ok(rksiDefault && luklaDefault && neonDefault && coastalDefault);
    assert.equal(rksiDefault.classList.contains('active'), true, 'incheon without mapPlan highlights RKSI');
    assert.equal(luklaDefault.textContent, t('lukla.vnlk'));
    assert.equal(neonDefault.textContent, t('neon.metropolis'));
    assert.equal(coastalDefault.textContent, t('coastal.airport'));

    const searchInput = elements.get('lobby-map-search');
    for (const query of ['VNLK', '루클라']) {
      searchInput.value = query;
      searchInput.dispatchEvent({ type: 'input' });
      const results = elements.get('lobby-map-results').children;
      const luklaResult = results.find(btn => btn.dataset.placeKind === 'region' && btn.dataset.placeId === 'lukla');
      assert.ok(luklaResult, `query ${query} should find region:lukla`);
      assert.equal(luklaResult.textContent, t('lukla.vnlk'));
    }

    const luklaSearchBtn = elements.get('lobby-map-results').children.find(btn => btn.dataset.placeId === 'lukla');
    luklaSearchBtn.click();
    assert.equal(airport, 'lukla');
    assert.equal(mapPlan, null);

    const refreshedDefaults = elements.get('lobby-map-default-bookmarks').children;
    assert.equal(refreshedDefaults.find(btn => btn.dataset.placeId === 'lukla').classList.contains('active'), true);
    assert.equal(refreshedDefaults.find(btn => btn.dataset.placeId === 'RKSI').classList.contains('active'), false);
  } finally {
    setLanguage('ko');
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  }
});
