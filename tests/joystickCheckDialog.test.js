import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JoystickCheckDialog } from '../src/ui/JoystickCheckDialog.js';
import { HotasController } from '../src/controls/HotasController.js';

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.hidden = false;
    this._textContent = '';
    this.value = '';
    this.checked = false;
    this.id = '';
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = String(val);
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = String(val);
    if (name === 'value') this.value = String(val);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  get classList() {
    return {
      add: (cls) => {
        const current = (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!current.includes(cls)) current.push(cls);
        this.attributes.set('class', current.join(' '));
      },
      remove: (cls) => {
        const current = (this.getAttribute('class') || '').split(/\s+/).filter(c => c && c !== cls);
        this.attributes.set('class', current.join(' '));
      },
      toggle: (cls, force) => {
        const has = this.classList.contains(cls);
        const shouldAdd = force !== undefined ? force : !has;
        if (shouldAdd) this.classList.add(cls);
        else this.classList.remove(cls);
        return shouldAdd;
      },
      contains: (cls) => (this.getAttribute('class') || '').split(/\s+/).includes(cls),
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {
    // noop
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    const fns = this.listeners.get(type) || [];
    for (const fn of fns) fn(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(val) {
    this.setAttribute('class', val);
  }

  matches(selector) {
    if (!selector) return false;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.includes('[') && selector.endsWith(']')) {
      const idx = selector.indexOf('[');
      const tag = selector.slice(0, idx);
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const inner = selector.slice(idx + 1, -1);
      if (inner.includes('=')) {
        const [k, v] = inner.split('=');
        const cleanV = v.replace(/['"]/g, '');
        return this.getAttribute(k) === cleanV;
      }
      return this.hasAttribute(inner);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    // If selector has comma, split
    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim());
      for (const part of parts) {
        results.push(...this.querySelectorAll(part));
      }
      return Array.from(new Set(results));
    }

    const walk = (node) => {
      if (node !== this && node.matches(selector)) {
        results.push(node);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  set innerHTML(html) {
    this.children = [];
    // Parse tags into MockElements
    const tagRe = /<(\/?[a-zA-Z0-9]+)([^>]*?)>/g;
    let match;
    let currentSelect = null;
    while ((match = tagRe.exec(html)) !== null) {
      const tagName = match[1].toLowerCase();
      const attrsStr = match[2];
      if (tagName === '/select') {
        currentSelect = null;
        continue;
      }
      if (tagName.startsWith('/')) {
        continue;
      }
      const el = new MockElement(tagName);
      const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
      let a;
      while ((a = attrRe.exec(attrsStr)) !== null) {
        el.setAttribute(a[1], a[2] !== undefined ? a[2] : '');
      }

      if (tagName === 'select') {
        currentSelect = el;
        this.appendChild(el);
      } else if (tagName === 'option') {
        if (currentSelect) currentSelect.appendChild(el);
        this.appendChild(el);
      } else {
        this.appendChild(el);
      }
    }
  }
}

describe('JoystickCheckDialog - Initialization & DOM Structure', () => {
  let sim, mockStorage, savedPreferences, origDoc, origWin;

  beforeEach(() => {
    savedPreferences = {};
    mockStorage = {
      getItem: (key) => savedPreferences[key] || null,
      setItem: (key, val) => { savedPreferences[key] = val; },
    };

    const docElements = new Map();
    const docListeners = new Map();
    origDoc = globalThis.document;
    origWin = globalThis.window;

    const mockBody = new MockElement('body');
    globalThis.document = {
      body: mockBody,
      createElement: (tag) => new MockElement(tag),
      getElementById: (id) => docElements.get(id) || (mockBody.id === id ? mockBody : mockBody.querySelector(`#${id}`)),
      addEventListener: (event, fn) => {
        if (!docListeners.has(event)) docListeners.set(event, []);
        docListeners.get(event).push(fn);
      },
      dispatchEvent: (event) => {
        const type = typeof event === 'string' ? event : event?.type;
        for (const fn of (docListeners.get(type) || [])) fn(event);
      },
    };
    globalThis.window = {
      requestAnimationFrame: (cb) => setTimeout(cb, 10),
      cancelAnimationFrame: (id) => clearTimeout(id),
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const controls = {
      hotas: null,
      onUserInteract() {},
    };
    const hotas = new HotasController(controls, {
      profileOverride: 'auto',
      throttleInverted: false,
      pitchInverted: false,
      rudderMode: 'auto',
      deadzoneStick: 0.04,
      deadzoneRudder: 0.05,
      getGamepads: () => [],
    });
    controls.hotas = hotas;

    sim = {
      controls,
      storage: mockStorage,
    };
  });

  afterEach(() => {
    globalThis.document = origDoc;
    globalThis.window = origWin;
  });

  it('creates dialog DOM with full accessibility and interactive controls', () => {
    const dialog = new JoystickCheckDialog(sim);
    assert.ok(dialog.dialog !== null);
    assert.strictEqual(dialog.dialog.getAttribute('role'), 'dialog');
    assert.strictEqual(dialog.dialog.getAttribute('aria-modal'), 'true');
    assert.strictEqual(dialog.dialog.hidden, true);

    // Profile select
    const profileSelect = dialog.dialog.querySelector('[data-profile-select]');
    assert.ok(profileSelect !== null);
    assert.ok(profileSelect.querySelector('option[value="hotas-one"]'));
    assert.ok(profileSelect.querySelector('option[value="hotas-one-xbox"]'));

    // Flight meters
    assert.ok(dialog.dialog.querySelector('[data-val-pitch]'));
    assert.ok(dialog.dialog.querySelector('[data-val-roll]'));
    assert.ok(dialog.dialog.querySelector('[data-val-throttle]'));
    assert.ok(dialog.dialog.querySelector('[data-val-rudder]'));
    assert.ok(dialog.dialog.querySelector('[data-val-brakes]'));

    // Calibration toggles
    assert.ok(dialog.dialog.querySelector('[data-check-throttle-invert]'));
    assert.ok(dialog.dialog.querySelector('[data-check-pitch-invert]'));
    assert.ok(dialog.dialog.querySelector('[data-select-rudder-mode]'));
    assert.ok(dialog.dialog.querySelector('[data-range-deadzone]'));

    // Hardware tips
    assert.ok(dialog.dialog.querySelector('.joystick-tips-card'));
  });

  it('opens and closes cleanly, syncing hotas config with form controls', () => {
    sim.controls.hotas.applyConfig({
      profileOverride: 'hotas-one-xbox',
      throttleInverted: true,
      pitchInverted: true,
      rudderMode: 'twist',
      deadzoneStick: 0.08,
    });

    const dialog = new JoystickCheckDialog(sim);
    dialog.open();

    assert.strictEqual(dialog.isOpen, true);
    assert.strictEqual(dialog.dialog.hidden, false);
    assert.strictEqual(dialog.profileSelect.value, 'hotas-one-xbox');
    assert.strictEqual(dialog.throttleInvertCheck.checked, true);
    assert.strictEqual(dialog.pitchInvertCheck.checked, true);
    assert.strictEqual(dialog.rudderModeSelect.value, 'twist');
    assert.strictEqual(dialog.deadzoneSlider.value, '0.08');
    assert.strictEqual(dialog.deadzoneVal.textContent, '8%');

    dialog.close();
    assert.strictEqual(dialog.isOpen, false);
    assert.strictEqual(dialog.dialog.hidden, true);
  });

  it('updates hotas settings and persists preferences on input changes', () => {
    const dialog = new JoystickCheckDialog(sim);
    dialog.open();

    // Change profile
    dialog.profileSelect.value = 'hotas-one';
    dialog.profileSelect.dispatchEvent(new Event('change'));
    assert.strictEqual(sim.controls.hotas.profileOverride, 'hotas-one');

    // Toggle throttle invert
    dialog.throttleInvertCheck.checked = true;
    dialog.throttleInvertCheck.dispatchEvent(new Event('change'));
    assert.strictEqual(sim.controls.hotas.throttleInverted, true);

    // Toggle pitch invert
    dialog.pitchInvertCheck.checked = true;
    dialog.pitchInvertCheck.dispatchEvent(new Event('change'));
    assert.strictEqual(sim.controls.hotas.pitchInverted, true);

    // Change rudder mode
    dialog.rudderModeSelect.value = 'pedals';
    dialog.rudderModeSelect.dispatchEvent(new Event('change'));
    assert.strictEqual(sim.controls.hotas.rudderMode, 'pedals');

    // Deadzone slider
    dialog.deadzoneSlider.value = '0.07';
    dialog.deadzoneSlider.dispatchEvent(new Event('input'));
    assert.strictEqual(sim.controls.hotas.deadzoneStick, 0.07);
    assert.strictEqual(dialog.deadzoneVal.textContent, '7%');

    // Verify storage persistence
    const saved = JSON.parse(mockStorage.getItem('flight3d.preferences.v1') || '{}');
    assert.ok(saved.joystick);
    assert.strictEqual(saved.joystick.profileOverride, 'hotas-one');
    assert.strictEqual(saved.joystick.throttleInverted, true);
    assert.strictEqual(saved.joystick.pitchInverted, true);
    assert.strictEqual(saved.joystick.rudderMode, 'pedals');
    assert.strictEqual(saved.joystick.deadzoneStick, 0.07);

    dialog.close();
  });

  it('restores default configuration on reset button click', () => {
    sim.controls.hotas.applyConfig({
      profileOverride: 'hotas-one-xbox',
      throttleInverted: true,
      pitchInverted: true,
      rudderMode: 'pedals',
      deadzoneStick: 0.12,
    });

    const dialog = new JoystickCheckDialog(sim);
    dialog.open();
    assert.strictEqual(sim.controls.hotas.profileOverride, 'hotas-one-xbox');

    const resetBtn = dialog.dialog.querySelector('[data-joystick-reset]');
    assert.ok(resetBtn !== null);
    resetBtn.click();

    assert.strictEqual(sim.controls.hotas.profileOverride, 'auto');
    assert.strictEqual(sim.controls.hotas.throttleInverted, false);
    assert.strictEqual(sim.controls.hotas.pitchInverted, false);
    assert.strictEqual(sim.controls.hotas.rudderMode, 'auto');
    assert.strictEqual(sim.controls.hotas.deadzoneStick, 0.04);

    assert.strictEqual(dialog.profileSelect.value, 'auto');
    assert.strictEqual(dialog.throttleInvertCheck.checked, false);
    assert.strictEqual(dialog.pitchInvertCheck.checked, false);
    assert.strictEqual(dialog.rudderModeSelect.value, 'auto');
    assert.strictEqual(dialog.deadzoneSlider.value, '0.04');

    dialog.close();
  });

  it('renders live telemetry, connection badge, and button highlights when controller is active', () => {
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      mapping: '',
      axes: [0.6, -0.8, -1.0, 0.5, 0.0], // Roll right, Pitch down (dive), TOGA (-1.0), Rudder right
      buttons: [
        { pressed: true, value: 1.0 }, // Trigger pressed
        { pressed: false, value: 0.0 },
        { pressed: true, value: 1.0 }, // Button 2 pressed
      ],
    };
    sim.controls.hotas.getGamepadsFn = () => [mockGamepad];

    const dialog = new JoystickCheckDialog(sim);
    dialog.open();

    // Run one telemetry cycle
    sim.controls.hotas.update(1 / 60);
    dialog.updateTelemetry();

    // Check device badge
    assert.strictEqual(dialog.statusBadge.classList.contains('connected'), true);
    assert.strictEqual(dialog.nameEl.textContent, 'Thrustmaster T.Flight Hotas One');

    // Check meters
    assert.ok(dialog.valPitch.textContent.includes('Dive'));
    assert.ok(dialog.valRoll.textContent.includes('Right'));
    assert.ok(dialog.valThrottle.textContent.includes('TOGA 100%'));
    assert.ok(dialog.valBrakes.textContent.includes('100%'));

    // Check button highlights
    assert.strictEqual(dialog.buttonsGrid.children.length >= 16, true);
    assert.strictEqual(dialog.buttonsGrid.children[0].classList.contains('is-pressed'), true);
    assert.strictEqual(dialog.buttonsGrid.children[1].classList.contains('is-pressed'), false);
    assert.strictEqual(dialog.buttonsGrid.children[2].classList.contains('is-pressed'), true);

    // Check rudder source display
    assert.ok(dialog.sourceRudder);
    assert.ok(dialog.sourceRudder.textContent.length > 0);

    // Verify floating pin detection badge
    mockGamepad.axes = [0, 0, 1.0, 0, 1.0]; // Floating Axis 4 at 1.0
    sim.controls.hotas.update(1 / 60);
    dialog.updateTelemetry();
    assert.strictEqual(dialog.sourceRudder.classList.contains('warning'), true);
    assert.ok(dialog.sourceRudder.textContent.includes('부유 핀') || dialog.sourceRudder.textContent.includes('Floating'));

    dialog.close();
  });
});
