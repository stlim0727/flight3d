import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { LandmarkPins } from '../src/ui/LandmarkPins.js';
import { landmarkPinIcon } from '../src/ui/landmarkPinIcons.js';
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

test('pin renderer merges streamed landmarks, prioritizes major landmarks over overlap, and skips redundant icon writes', () => {
  globalThis.document = {
    createElement: () => {
      let html = '';
      let iconWrites = 0;
      return {
        className: '', hidden: true, style: {}, textContent: '', children: [],
        get innerHTML() { return html; },
        set innerHTML(value) { iconWrites++; html = value; },
        get iconWrites() { return iconWrites; },
        append(...nodes) { this.children.push(...nodes); },
      };
    },
  };
  try {
    const camera = new PerspectiveCamera(75, 1200 / 800, 1, 100000);
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 100, -1000);

    const streamLayer = {
      version: 1,
      records: [
        // Overlapping screen projection along ray x/(-z)=+0.24 (clear of Incheon Airport to the left):
        // major bridge at ~5.1km must defeat minor subway at ~617m
        { id: 'minor-sub', names: { ko: '동네역', en: 'Local Station' }, x: 144, z: -600,
          groundRelative: true, heightOffsetM: 88, kinds: ['station'], importance: 1, prominence: 0.4, streamed: true },
        { id: 'gwangan-bridge', names: { ko: '광안대교', en: 'Gwangan Bridge' }, x: 1200, z: -5000,
          groundRelative: true, heightOffsetM: 45, kinds: ['bridge'], importance: 5, prominence: 0.85, streamed: true },
        // Duplicate of Incheon Airport curated record should be collapsed by dedupeLandmarks
        { id: 'stream-icn-dup', names: { ko: '인천공항', en: 'Incheon International Airport' },
          x: -380, z: -2300, groundRelative: true, heightOffsetM: 28, kinds: ['airport'], importance: 5, streamed: true },
      ],
    };

    const sim = {
      camera,
      activeAirport: 'incheon',
      currentTerrain: { getHeight: () => 0 },
      currentAirport: {},
      geographicLandmarkLayer: streamLayer,
    };

    const container = fakeContainer();
    const pins = new LandmarkPins(container);
    inLanguage('ko', () => pins.update(sim, true));
    const visibleLabels = container.children.filter(c => !c.hidden).map(c => labelOf(c).textContent);
    assert.ok(visibleLabels.some(text => text.startsWith('광안대교')), 'major bridge must win overlap slot');
    assert.ok(!visibleLabels.some(text => text.startsWith('동네역')), 'minor overlapping station must be suppressed');
    assert.equal(visibleLabels.filter(text => text.includes('인천')).length, 1, 'duplicate airport collapsed');

    const bridgePin = container.children.find(c => !c.hidden && labelOf(c).textContent.startsWith('광안대교'));
    const writesAfterFirstFrame = iconOf(bridgePin).iconWrites;
    assert.equal(writesAfterFirstFrame, 1);

    // Second frame with same icon should not rewrite innerHTML
    inLanguage('ko', () => pins.update(sim, true));
    assert.equal(iconOf(bridgePin).iconWrites, writesAfterFirstFrame);

    // New icon kinds produce distinct SVGs
    const kindIcons = ['city', 'bridge', 'park', 'water'].map(kind => landmarkPinIcon({ kinds: [kind] }));
    assert.equal(new Set(kindIcons).size, 4);
    assert.notEqual(kindIcons[0], landmarkPinIcon({ kinds: ['unknown'] }));

    // Switching to a distant customOrigin must drop built-in Incheon catalog pins
    sim.world = { customOrigin: { latitude: 40.6413, longitude: -73.7781 } };
    sim.geographicLandmarkLayer = { version: 2, records: [] };
    inLanguage('en', () => pins.update(sim, true));
    assert.ok(container.children.every(c => c.hidden), 'Incheon catalog pin must not appear at JFK custom origin');
  } finally {
    delete globalThis.document;
  }
});
