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

test('pin renderer shows localized pinpoint markers for catalog rows', () => {
  globalThis.document = {
    createElement: () => ({ className: '', hidden: true, style: {}, textContent: '' }),
  };
  try {
    const origin = { latitude: 37.448, longitude: 126.455 };
    const places = [-0.0039, 0.0039].map((offset, index) => ({
      id: `place-${index}`,
      names: { ko: index ? '두 번째 장소' : '첫 번째 장소', en: index ? 'Second Place' : 'First Place' },
      latitude: origin.latitude + 0.009,
      longitude: origin.longitude + offset,
      kinds: ['station'],
    }));
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
    assert.deepEqual(visible.map(child => child.textContent).sort(),
      ['First Place · 1.1 km', 'Second Place · 1.1 km']);
    assert.ok(visible.every(child => child.style.left.endsWith('px') && child.style.top.endsWith('px')));

    inLanguage('ko', () => pins.update(sim, true));
    assert.ok(container.children.some(child => !child.hidden && child.textContent.includes('첫 번째 장소')));

    const filteredContainer = fakeContainer();
    const filtered = new LandmarkPins(filteredContainer, places, ['attraction']);
    inLanguage('en', () => filtered.update(sim, true));
    assert.ok(filteredContainer.children.every(child => child.hidden));
  } finally {
    delete globalThis.document;
  }
});
