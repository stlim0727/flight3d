import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAP_ATTRIBUTION_ID,
  MAP_ATTRIBUTION_CHIP_ID,
  MAP_ATTRIBUTION_LIST_ID,
  MAP_ATTRIBUTION_SOURCE_IDS,
  bindMapAttribution,
  collapseMapAttribution,
  setMapAttributionExpanded,
  setMapAttributionSource,
  syncMapAttributionContainer,
  toggleMapAttribution,
} from '../src/ui/mapAttribution.js';

function readRepoFile(relPath) {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

function createClassList() {
  const classes = new Set();
  return {
    contains(name) {
      return classes.has(name);
    },
    toggle(name, force) {
      const next = force === undefined ? !classes.has(name) : Boolean(force);
      if (next) classes.add(name);
      else classes.delete(name);
      return next;
    },
  };
}

function createMockDom() {
  const listeners = new Map();
  const elements = new Map();

  const makeElement = (id, hidden = true) => ({
    id,
    hidden,
    classList: createClassList(),
    attributes: id === MAP_ATTRIBUTION_CHIP_ID ? { 'aria-expanded': 'false' } : {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(id)) listeners.set(id, new Map());
      if (!listeners.get(id).has(type)) listeners.get(id).set(type, []);
      listeners.get(id).get(type).push(fn);
    },
    click() {
      const fns = listeners.get(id)?.get('click') || [];
      for (const fn of fns) fn({ currentTarget: this });
    },
  });

  elements.set(MAP_ATTRIBUTION_ID, makeElement(MAP_ATTRIBUTION_ID, true));
  elements.set(MAP_ATTRIBUTION_CHIP_ID, makeElement(MAP_ATTRIBUTION_CHIP_ID, false));
  elements.set(MAP_ATTRIBUTION_LIST_ID, makeElement(MAP_ATTRIBUTION_LIST_ID, false));
  for (const id of MAP_ATTRIBUTION_SOURCE_IDS) {
    elements.set(id, makeElement(id, true));
  }

  return {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
}

test('index.html wraps all map attribution notices in a single collapsible #map-attribution', () => {
  const html = readRepoFile('index.html');

  const asideMatch = html.match(/<aside id="map-attribution"[\s\S]*?<\/aside>/);
  assert.ok(asideMatch, 'index.html must contain <aside id="map-attribution">');
  const asideHtml = asideMatch[0];

  assert.match(asideHtml, /<aside id="map-attribution"[^>]*\bhidden\b/);
  assert.match(asideHtml, /<button id="map-attribution-chip"[^>]*aria-expanded="false"[^>]*aria-controls="map-attribution-list"/);
  assert.match(asideHtml, /<div id="map-attribution-list">/);

  for (const id of MAP_ATTRIBUTION_SOURCE_IDS) {
    assert.ok(asideHtml.includes(`id="${id}"`), `#map-attribution must wrap #${id}`);
    assert.match(asideHtml, new RegExp(`id="${id}"[^>]*\\bhidden\\b`), `#${id} must default to hidden`);
    assert.doesNotMatch(html, new RegExp(`<aside[^>]*\\bid="${id}"`), `#${id} must not be a standalone <aside>`);
  }
});

test('CSS consolidates attribution rules in lobby-and-overlays.css and removes stacked banners from style.css', () => {
  const styleCss = readRepoFile('style.css');
  for (const id of MAP_ATTRIBUTION_SOURCE_IDS) {
    assert.doesNotMatch(styleCss, new RegExp(`#${id}\\b`), `style.css must not style #${id} individually`);
  }

  const lobbyCss = readRepoFile('src/styles/lobby-and-overlays.css');
  assert.ok(lobbyCss.includes('#map-attribution {'), 'lobby-and-overlays.css must define #map-attribution');
  assert.ok(lobbyCss.includes('#map-attribution[hidden]'), 'lobby-and-overlays.css must hide #map-attribution[hidden]');
  assert.ok(lobbyCss.includes('#map-attribution-list > [hidden]'), 'lobby-and-overlays.css must hide #map-attribution-list > [hidden]');
  assert.ok(lobbyCss.includes('#map-attribution.expanded #map-attribution-list'), 'lobby-and-overlays.css must reveal list when expanded');
  assert.doesNotMatch(lobbyCss, /#incheon-attribution\b/, 'lobby-and-overlays.css must not retain legacy #incheon-attribution rules');
});

test('mapAttribution keeps container hidden until at least one source is active', () => {
  const doc = createMockDom();
  const container = doc.getElementById(MAP_ATTRIBUTION_ID);

  assert.equal(syncMapAttributionContainer(doc), false);
  assert.equal(container.hidden, true);

  // Non-Incheon map (e.g. Jeju/Lukla) showing only roads attribution still surfaces the chip.
  assert.equal(setMapAttributionSource('geographic-roads-attribution', true, doc), true);
  assert.equal(container.hidden, false);
  assert.equal(doc.getElementById('incheon-attribution').hidden, true);
  assert.equal(doc.getElementById('geographic-roads-attribution').hidden, false);

  // Adding a second source and then removing sources one-by-one keeps container visible until the last one hides.
  assert.equal(setMapAttributionSource('open-world-attribution', true, doc), true);
  assert.equal(setMapAttributionSource('geographic-roads-attribution', false, doc), true);
  assert.equal(container.hidden, false);

  assert.equal(setMapAttributionSource('open-world-attribution', false, doc), false);
  assert.equal(container.hidden, true);
});

test('bindMapAttribution toggles expanded state, collapseMapAttribution resets it, and hiding last source collapses', () => {
  const doc = createMockDom();
  const container = doc.getElementById(MAP_ATTRIBUTION_ID);
  const chip = doc.getElementById(MAP_ATTRIBUTION_CHIP_ID);

  assert.equal(bindMapAttribution(doc), true);
  setMapAttributionSource('geographic-buildings-attribution', true, doc);
  assert.equal(container.hidden, false);
  assert.equal(container.classList.contains('expanded'), false);
  assert.equal(chip.getAttribute('aria-expanded'), 'false');

  chip.click();
  assert.equal(container.classList.contains('expanded'), true);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');

  chip.click();
  assert.equal(container.classList.contains('expanded'), false);
  assert.equal(chip.getAttribute('aria-expanded'), 'false');

  setMapAttributionExpanded(true, doc);
  assert.equal(container.classList.contains('expanded'), true);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');

  collapseMapAttribution(doc);
  assert.equal(container.classList.contains('expanded'), false);
  assert.equal(chip.getAttribute('aria-expanded'), 'false');

  // Re-expand, then hide the last active source: container hides and collapses so it won't reopen stale.
  chip.click();
  assert.equal(container.classList.contains('expanded'), true);
  setMapAttributionSource('geographic-buildings-attribution', false, doc);
  assert.equal(container.hidden, true);
  assert.equal(container.classList.contains('expanded'), false);
  assert.equal(chip.getAttribute('aria-expanded'), 'false');

  // Re-showing a source opens in collapsed state.
  setMapAttributionSource('geographic-green-attribution', true, doc);
  assert.equal(container.hidden, false);
  assert.equal(container.classList.contains('expanded'), false);
});

test('mapAttribution helpers guard missing or minimal document objects without throwing', () => {
  assert.equal(setMapAttributionExpanded(true, null), false);
  assert.equal(collapseMapAttribution(undefined), false);
  assert.equal(toggleMapAttribution({}), false);
  assert.equal(syncMapAttributionContainer({}), false);
  assert.equal(setMapAttributionSource('incheon-attribution', true, { createElement() {} }), false);
  assert.equal(bindMapAttribution({}), false);
});
