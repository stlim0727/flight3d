import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initFlightPanels } from '../src/ui/FlightPanels.js';

class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) { names.forEach(n => this._classes.add(n)); }
  remove(...names) { names.forEach(n => this._classes.delete(n)); }
  contains(name) { return this._classes.has(name); }
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this._classes.add(name);
      else this._classes.delete(name);
      return force;
    }
    if (this._classes.has(name)) {
      this._classes.delete(name);
      return false;
    }
    this._classes.add(name);
    return true;
  }
}

class MockElement {
  constructor(tag = 'div', id = '', registry = null) {
    this.tagName = tag.toUpperCase();
    this._id = id;
    this.registry = registry;
    this.className = '';
    this.classList = new MockClassList();
    this.children = [];
    this.attributes = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this.hidden = false;
    this.listeners = new Map();
    this.dataset = {};
    if (id && registry) registry.set(id, this);
  }
  get id() { return this._id; }
  set id(val) {
    this._id = val;
    if (val && this.registry) this.registry.set(val, this);
  }
  set innerHTML(html) {
    this._innerHTML = html;
    const idMatches = [...html.matchAll(/id="([^"]+)"/g)];
    for (const match of idMatches) {
      const el = new MockElement('div', match[1]);
      this.children.push(el);
    }
  }
  get scrollWidth() { return 100; }
  get scrollLeft() { return 0; }
  set scrollLeft(v) {}
  getBoundingClientRect() {
    return { top: 0, bottom: 44, left: 0, right: 100, width: 100, height: 44 };
  }
  getClientRects() { return [this.getBoundingClientRect()]; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  hasAttribute(k) { return this.attributes.has(k); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node) {
        node.parentElement = this;
        this.children.push(node);
      }
    }
  }
  prepend(...nodes) {
    for (const node of nodes.reverse()) {
      if (node) this.children.unshift(node);
    }
  }
  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    for (const fn of handlers) fn(event);
  }
  click() {
    this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} });
  }
  blur() {}
  focus() {}
  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this.children.find(c => c.id === id) || null;
    }
    return null;
  }
  querySelectorAll() { return []; }
}

test('camera toolbar collapse/expand toggle button lifecycle and interaction', () => {
  const elements = new Map();
  const createElement = (tag, id = '') => {
    return new MockElement(tag, id, elements);
  };

  // Setup DOM fixtures required by initFlightPanels
  const hudOverlay = createElement('div', 'hud-overlay');
  const strip = createElement('div');
  strip.className = 'hud-strip';
  hudOverlay.append(strip);

  createElement('button', 'btn-fullscreen');
  const apBar = createElement('div', 'ap-bar');
  apBar.append(createElement('button', 'btn-ap-toggle'));
  createElement('div', 'ap-panel');
  const povActions = createElement('div', 'pov-actions-bar');
  povActions.append(
    createElement('button', 'btn-reset-pov'),
    createElement('button', 'btn-gaze-exit'),
    createElement('button', 'btn-cockpit-pov'),
  );
  createElement('button', 'btn-skip-demo');
  createElement('section', 'lobby-settings');
  createElement('button', 'btn-gear');
  createElement('button', 'btn-flaps-ret');
  createElement('button', 'btn-flaps-ext');
  createElement('button', 'btn-spoilers');
  createElement('button', 'btn-reverser');

  const stored = new Map();
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  const prevStorage = globalThis.localStorage;

  globalThis.localStorage = {
    getItem: k => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: k => stored.delete(k)
  };

  globalThis.document = {
    getElementById: id => elements.get(id) || null,
    querySelector: sel => sel === '.hud-strip' ? strip : null,
    querySelectorAll: () => [],
    createElement: tag => new MockElement(tag, '', elements),
    documentElement: new MockElement('html'),
    body: new MockElement('body'),
    addEventListener: () => {}
  };

  globalThis.window = {
    addEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} })
  };

  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.getComputedStyle = () => ({ display: 'flex', maxWidth: '800px' });

  try {
    let selectedMode = null;
    initFlightPanels({
      onSelectCamera: mode => { selectedMode = mode; },
      onAdjustTrim: () => {},
      onToggleParkingBrake: () => {},
      toolbarHidden: []
    });

    const cameraStrip = elements.get('camera-strip');
    const toggleBtn = elements.get('btn-camera-toggle');

    assert.ok(cameraStrip, '#camera-strip must exist');
    assert.ok(toggleBtn, '#btn-camera-toggle must exist inside camera controls');

    // Initially uncollapsed on desktop
    assert.equal(cameraStrip.classList.contains('is-collapsed'), false);
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');

    // Click toggle to collapse
    toggleBtn.click();
    assert.equal(cameraStrip.classList.contains('is-collapsed'), true);
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');
    assert.equal(globalThis.localStorage.getItem('flight3d_camera_strip_collapsed'), 'true');

    // Clicking the active camera button while collapsed expands it without selecting camera
    selectedMode = null;
    const chaseBtn = elements.get('btn-cam-chase');
    assert.ok(chaseBtn, 'chase camera button exists');
    chaseBtn.click();
    assert.equal(cameraStrip.classList.contains('is-collapsed'), false);
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');
    assert.equal(globalThis.localStorage.getItem('flight3d_camera_strip_collapsed'), 'false');
    assert.equal(selectedMode, null, 'onSelectCamera must not be invoked when uncollapsing via camera button click');

    // Clicking camera button when already expanded selects the camera
    const cockpitBtn = elements.get('btn-cam-cockpit');
    assert.ok(cockpitBtn, 'cockpit camera button exists');
    cockpitBtn.click();
    assert.equal(selectedMode, 0, 'onSelectCamera is invoked when selecting camera in expanded strip');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWindow;
    globalThis.localStorage = prevStorage;
  }
});
