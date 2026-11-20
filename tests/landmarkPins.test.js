import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { LandmarkPins } from '../src/ui/LandmarkPins.js';
import { inLanguage } from '../src/i18n/index.js';

function fakeContainer() {
  const children = [];
  return {
    hidden: true,
    clientWidth: 1200,
    clientHeight: 800,
    children,
    append(element) { children.push(element); },
  };
}

const childOf = (element, className) => element.children.find(child => child.className === className);
const labelOf = pin => childOf(pin, 'landmark-pin__label');
const iconOf = pin => childOf(childOf(pin, 'landmark-pin__marker'), 'landmark-pin__icon');

test('pin renderer shows localized pin markers with category icons', () => {
  globalThis.document = {
    createElement: () => ({
      className: '', hidden: true, style: {}, textContent: '', innerHTML: '', children: [],
      append(...nodes) { this.children.push(...nodes); },
    }),
  };
  try {
    const origin = { latitude: 37.448, longitude: 126.455 };
    const places = [
      { id: 'station', names: { ko: '첫 번째 장소', en: 'First Place' },
        latitude: origin.latitude + 0.009, longitude: origin.longitude - 0.0039,
        kinds: ['station'], importance: 5 },
      { id: 'peak', names: { ko: '두 번째 장소', en: 'Second Place' },
        latitude: origin.latitude + 0.009, longitude: origin.longitude + 0.0039,
        kinds: ['peak'], importance: 5 },
    ];
    const camera = new PerspectiveCamera(75, 1200 / 800, 1, 100000);
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 100, -1000);
    const sim = {
      camera, activeAirport: 'incheon',
      currentTerrain: { getHeight: () => 0 }, currentAirport: {},
    };

    const container = fakeContainer();
    const pins = new LandmarkPins(container, places);
    inLanguage('en', () => pins.update(sim, true));
    assert.equal(container.hidden, false);
    const visible = container.children.filter(child => !child.hidden);
    assert.deepEqual(visible.map(labelOf).map(label => label.textContent).sort(),
      ['First Place · 1.1 km', 'Second Place · 1.1 km']);
    assert.ok(visible.every(child => child.style.left.endsWith('px') && child.style.top.endsWith('px')));
    assert.ok(visible.every(child => childOf(child, 'landmark-pin__marker')));
    const icons = visible.map(iconOf).map(icon => icon.innerHTML);
    assert.ok(icons.every(svg => svg.startsWith('<svg')));
    assert.equal(new Set(icons).size, 2, 'station and peak use different icons');

    inLanguage('ko', () => pins.update(sim, true));
    assert.ok(container.children.some(child => !child.hidden
      && labelOf(child).textContent.includes('첫 번째 장소')));

    const filteredContainer = fakeContainer();
    const filtered = new LandmarkPins(filteredContainer, places, ['attraction']);
    inLanguage('en', () => filtered.update(sim, true));
    assert.ok(filteredContainer.children.every(child => child.hidden));
  } finally {
    delete globalThis.document;
  }
});
