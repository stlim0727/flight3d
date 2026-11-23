import assert from 'node:assert/strict';
import test from 'node:test';
import { ChartLandmarks } from '../src/ui/ChartLandmarks.js';

test('inspecting another landmark preserves the moving checkpoint until explicitly replaced', t => {
  class Element extends EventTarget {
    setAttribute() {}
    append() {}
    remove() {}
    style = {};
    click() { this.dispatchEvent(new Event('click')); }
  }
  class Matrix {
    transformPoint(point) { return point; }
  }
  const nodes = new Map();
  const map = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  } };
  const canvas = new Element();
  const oldGlobals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix };
  Object.assign(globalThis, { document: { createElement: () => new Element() }, DOMMatrix: Matrix });
  t.after(() => {
    for (const [key, value] of Object.entries(oldGlobals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const ui = new ChartLandmarks(map, canvas);
  const bridge = { id: 'bridge', names: { ko: '광안대교' }, point: [4000, 200] };
  const tower = { id: 'tower', names: { ko: '타워' }, point: [3000, 200] };
  const update = (east, places = [bridge, tower]) =>
    ui.update({ transform: [], metersPerPixel: 1 }, [east, 200], 5000, 500, places);
  update(0);
  ui.buttons.get(bridge.id).click();
  update(0);
  assert.match(ui.label.textContent, /광안대교 · 4\.0 km/);
  ui.mark.click();
  ui.buttons.get(tower.id).click();
  update(1000);
  assert.match(ui.label.textContent, /타워 · 2\.0 km/);
  assert.equal(ui.checkpoint.id, bridge.id);
  ui.inspected = null;
  update(1000, [tower]);
  assert.match(ui.label.textContent, /확인 지점 · 광안대교 · 3\.0 km/);
  ui.buttons.get(tower.id).click();
  ui.mark.click();
  assert.equal(ui.checkpoint.id, tower.id);
  ui.reset();
  update(1000);
  assert.equal(ui.panel.hidden, true);
  assert.equal(ui.checkpoint, null);
});
