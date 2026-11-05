import test from 'node:test';
import assert from 'node:assert/strict';
import { initLobbyScreen } from '../src/ui/LobbyScreen.js';
import { SPAWN_SCENARIOS } from '../src/config/scenarioRegistry.js';
import { setLanguage } from '../src/i18n/index.js';

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
  click() {
    if (this.onclick) this.onclick();
    this.listeners['click']?.forEach(fn => fn({ preventDefault() {} }));
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
    const btn = getOrCreate(scenario.lobbyButtonId, 'button');
    btn.className = 'btn btn-preset';
    const span = new MockElement('', 'span');
    btn.appendChild(span);
    lobbyButtons.appendChild(btn);
  }

  // Pre-create standard lobby elements
  const commonIds = [
    'btn-fly', 'btn-lobby-resume', 'btn-lobby-end',
    'lobby-briefing', 'lobby-loading', 'lobby-selection',
    'lobby-demo-options', 'lobby-demo-select', 'lobby-demo-briefing',
    'lobby-valley-options', 'lobby-pilot-human', 'lobby-pilot-ai',
    'lobby-valley-gyro', 'lobby-valley-settings', 'lobby-valley-preflight',
    'lobby-time-select', 'lobby-tab-settings', 'dev-enabled',
    'lobby-airport-hangang', 'lobby-airport-incheon', 'lobby-airport-coastal',
    'lobby-airport-lukla', 'lobby-airport-neon', 'lobby-airport-valley',
    'lobby-aircraft-b738', 'lobby-aircraft-c172', 'lobby-aircraft-f16',
    'lobby-lang-en', 'lobby-lang-ko',
  ];
  for (const id of commonIds) {
    const tag = id.includes('select') ? 'select' : id.includes('btn') || id.includes('preset') || id.includes('airport') || id.includes('aircraft') || id.includes('lang') || id.includes('pilot') || id.includes('gyro') || id.includes('settings') ? 'button' : 'div';
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
