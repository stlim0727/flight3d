import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { PMTiles } from 'pmtiles';
import { GeographicLandmarks } from '../src/environment/GeographicLandmarks.js';
import { extractBuildingLandmarks } from '../src/geospatial/overtureLandmarks.js';
import { LandmarkPins } from '../src/ui/LandmarkPins.js';
import { inLanguage } from '../src/i18n/index.js';
import { wgs84ToLocal, wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';

const BUILDINGS_ARCHIVE = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/buildings.pmtiles',
);

const NOISE_RE = /\bapartments?\b|아파트|Ligne d'|Shuto Expressway|Limehouse Curve|東海道本線/i;

const REGIONS = [
  ['Paris (Eiffel)', 48.845, 2.275, 450, 45],
  ['New York (Manhattan)', 40.700, -74.020, 500, 15],
  ['Tokyo (Bay->Tower)', 35.630, 139.750, 500, 0],
  ['London (Thames)', 51.495, -0.145, 400, 70],
  ['San Francisco', 37.795, -122.490, 450, 30],
  ['Swiss Alps (Zermatt)', 46.015, 7.750, 3200, 215],
  ['Sydney (Harbour)', -33.845, 151.235, 400, 230],
  ['Busan', 35.142, 129.075, 1200, 66],
  ['Suwon', 37.253, 127.044, 1100, 320],
  ['Jeju (Airport->Hallasan)', 33.495, 126.500, 600, 165],
  ['Lukla (->Everest)', 27.687, 86.729, 3200, 30],
];

function createStubDocument() {
  return {
    createElement: () => ({
      className: '',
      hidden: true,
      style: {},
      textContent: '',
      innerHTML: '',
      children: [],
      append(...nodes) {
        this.children.push(...nodes);
      },
    }),
  };
}

function inspectRenderedPins(container, localeLabel, regionLabel) {
  assert.equal(container.hidden, false, `${regionLabel} (${localeLabel}): container must be visible`);
  const visible = container.children.filter(child => !child.hidden);
  const hidden = container.children.filter(child => child.hidden);
  assert.ok(visible.length >= 1, `${regionLabel} (${localeLabel}): expected at least 1 visible pin`);
  assert.equal(visible.length + hidden.length, 5, `${regionLabel} (${localeLabel}): expected 5 pin slots`);

  const seenNames = new Set();
  const points = [];
  const labels = [];

  for (const pin of visible) {
    const label = pin.children.find(c => c.className === 'landmark-pin__label')?.textContent ?? '';
    const icon = pin.children
      .find(c => c.className === 'landmark-pin__marker')
      ?.children.find(c => c.className === 'landmark-pin__icon')?.innerHTML ?? '';
    const x = Number.parseFloat(pin.style.left);
    const y = Number.parseFloat(pin.style.top);

    assert.match(label, /^.+\s·\s\d+\.\d+\skm$/, `${regionLabel} (${localeLabel}): bad label "${label}"`);
    assert.ok(icon.startsWith('<svg'), `${regionLabel} (${localeLabel}): missing <svg> icon on "${label}"`);
    assert.ok(Number.isFinite(x) && x >= 0 && x <= 1280, `${regionLabel} (${localeLabel}): x out of bounds: ${x}`);
    assert.ok(Number.isFinite(y) && y >= 0 && y <= 720, `${regionLabel} (${localeLabel}): y out of bounds: ${y}`);
    assert.equal(NOISE_RE.test(label), false, `${regionLabel} (${localeLabel}): unexpected noise pin "${label}"`);

    const namePart = label.split(' · ')[0];
    assert.equal(seenNames.has(namePart), false, `${regionLabel} (${localeLabel}): duplicate pin "${namePart}"`);
    seenNames.add(namePart);

    for (const prev of points) {
      const overlaps = Math.abs(prev.x - x) < 146 && Math.abs(prev.y - y) < 42;
      assert.equal(overlaps, false, `${regionLabel} (${localeLabel}): pins overlap ("${prev.label}" & "${label}")`);
    }
    points.push({ x, y, label });
    labels.push(label);
  }
  return labels;
}

const prevDocument = globalThis.document;
globalThis.document = createStubDocument();

try {
  const results = [];
  for (const [label, lat, lon, altitudeM, headingDeg] of REGIONS) {
    const origin = { latitude: lat, longitude: lon };
    const project = (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
    const terrain = { origin, getHeight: () => 0, isLoaded: true };
    const layer = new GeographicLandmarks({
      map: 'open-world',
      origin,
      project,
      terrain,
    });

    const camera = new PerspectiveCamera(60, 1280 / 720, 1, 100000);
    camera.position.set(0, altitudeM, 0);
    const headingRad = headingDeg * Math.PI / 180;
    camera.lookAt(Math.sin(headingRad) * 10000, altitudeM * 0.5, -Math.cos(headingRad) * 10000);
    camera.updateMatrixWorld();

    const wanted = layer.wantedTilesFor(camera.position, camera);
    const bldgTile = wgs84ToTile(lat, lon, 14);
    const [, bldgRes] = await Promise.all([
      Promise.all(wanted.map(tile => layer.load(tile))),
      BUILDINGS_ARCHIVE.getZxy(14, bldgTile.x, bldgTile.y).catch(() => null),
    ]);
    const bldgLandmarks = bldgRes?.data ? extractBuildingLandmarks(bldgRes.data, bldgTile, 14) : [];
    layer.syncBuildingLandmarks({ landmarksVersion: 1, getLandmarks: () => bldgLandmarks });
    layer.rebuildRecords();

    assert.ok(layer.records.length > 0, `${label}: expected discovered Overture records`);

    const container = {
      hidden: true,
      clientWidth: 1280,
      clientHeight: 720,
      children: [],
      append(element) {
        this.children.push(element);
      },
    };
    const pins = new LandmarkPins(container);
    const sim = {
      camera,
      activeAirport: 'open-world',
      currentTerrain: terrain,
      currentAirport: {},
      geographicLandmarkLayer: layer,
    };

    let koLabels;
    let enLabels;
    inLanguage('ko', () => {
      pins.update(sim, true);
      koLabels = inspectRenderedPins(container, 'ko', label);
    });
    inLanguage('en', () => {
      pins.update(sim, true);
      enLabels = inspectRenderedPins(container, 'en', label);
    });

    results.push({ label, total: layer.records.length, ko: koLabels, en: enLabels });
    layer.dispose();
  }

  console.log(`Verified ${results.length} global regions renderlessly with 0 manual catalog entries:\n`);
  for (const row of results) {
    console.log(`[${row.label}] (records: ${row.total})`);
    console.log(`  ko: ${row.ko.join(' | ')}`);
    console.log(`  en: ${row.en.join(' | ')}`);
  }
} finally {
  globalThis.document = prevDocument;
}
