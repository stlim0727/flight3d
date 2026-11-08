import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';
import { initLobbyScreen } from '../src/ui/LobbyScreen.js';
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
    'lobby-airport-incheon', 'lobby-airport-coastal',
    'lobby-airport-lukla', 'lobby-airport-neon', 'lobby-airport-valley',
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
    assert.equal(tabLabel.textContent, '싱글', 'Tab label must be 싱글');

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
    const managedTime = elements.get('lobby-managed-time');
    assert.ok(managedAircraft.textContent.includes('Boeing 737') || managedAircraft.textContent.includes('B738'));
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
