import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayPanel } from '../src/ui/ReplayPanel.js';
import { t } from '../src/i18n/index.js';
import en from '../src/i18n/locales/en/replay.js';
import ko from '../src/i18n/locales/ko/replay.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.hidden = false; this.disabled = false; this.textContent = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  focus() { globalThis.document.activeElement = this; }
  findAll(predicate, out = []) {
    for (const child of this.children) { if (predicate(child)) out.push(child); child.findAll?.(predicate, out); }
    return out;
  }
}

function makePanel({ inRoom }) {
  globalThis.document = { activeElement: null, createElement: tag => new FakeElement(tag) };
  const parts = { '[data-list]': new FakeElement(), '[data-status]': new FakeElement(), '[data-close]': new FakeElement('button') };
  const library = new FakeElement();
  library.hidden = true;
  library.querySelector = selector => parts[selector];
  const entry = { id: 'a1', label: 'Sortie', durationSec: 60, savedAt: 0 };
  const panel = Object.create(ReplayPanel.prototype);
  Object.assign(panel, {
    library,
    sim: { multiplayer: { active: inRoom }, replayStore: { list: () => [entry], get: () => ({ track: {} }) } },
  });
  const watchButtons = () => parts['[data-list]'].findAll(el => el.dataset.action === 'watch');
  return { panel, library, parts, watchButtons };
}

test('saved replay library opens while still in a multiplayer room (#642)', () => {
  const { panel, library, parts, watchButtons } = makePanel({ inRoom: true });
  panel.openLibrary();
  assert.equal(library.hidden, false, 'button must open the library instead of silently doing nothing');
  assert.equal(parts['[data-status]'].textContent, t('replay.multiplayerBlocked'));
  assert.equal(watchButtons().length, 1);
  assert.equal(watchButtons()[0].disabled, true, 'playback stays blocked because the room owns the aircraft pose');
});

test('saved replay library keeps watch enabled outside multiplayer', () => {
  const { panel, library, parts, watchButtons } = makePanel({ inRoom: false });
  panel.openLibrary();
  assert.equal(library.hidden, false);
  assert.equal(parts['[data-status]'].textContent, '');
  assert.equal(watchButtons()[0].disabled, false);
});

test('closing an already hidden library does not steal focus', () => {
  const { panel } = makePanel({ inRoom: true });
  const other = new FakeElement('button');
  panel.previousFocus = { focus: () => assert.fail('focus must not move') };
  globalThis.document.activeElement = other;
  panel.closeLibrary();
  assert.equal(globalThis.document.activeElement, other);
});

test('multiplayer blocked hint is localized in both languages', () => {
  assert.ok(en['replay.multiplayerBlocked']);
  assert.ok(ko['replay.multiplayerBlocked']);
});
