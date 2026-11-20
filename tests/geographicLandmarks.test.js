import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PbfWriter } from 'pbf';
import { GeographicLandmarks, updateGeographicLandmarks } from '../src/environment/GeographicLandmarks.js';
import { GeographicBuildings } from '../src/environment/GeographicBuildings.js';
import { projectToLocal, INCHEON_PATCH } from '../src/geospatial/incheon.js';
import { localToWgs84, wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';

function zigzag(value) {
  return (value << 1) ^ (value >> 31);
}

function encodeMvtLayer(name, features) {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, name);
    layer.writeVarintField(15, 2);
    layer.writeVarintField(5, 4096);
    const keys = [];
    const values = [];
    const keyIndex = key => {
      const idx = keys.indexOf(key);
      if (idx >= 0) return idx;
      keys.push(key);
      return keys.length - 1;
    };
    const valueIndex = value => {
      const tag = `${typeof value}:${String(value)}`;
      const idx = values.findIndex(v => v.tag === tag);
      if (idx >= 0) return idx;
      values.push({ tag, value });
      return values.length - 1;
    };
    for (const feature of features) {
      const tags = Object.entries(feature.properties ?? {})
        .flatMap(([k, v]) => [keyIndex(k), valueIndex(v)]);
      layer.writeMessage(2, (_, msg) => {
        msg.writeVarintField(3, feature.type);
        if (tags.length) msg.writePackedVarint(2, tags);
        if (feature.type === 1) {
          msg.writePackedVarint(4, [9, zigzag(feature.geom[0]), zigzag(feature.geom[1])]);
        } else {
          const pts = feature.geom;
          const cmds = [9, zigzag(pts[0][0]), zigzag(pts[0][1]), 2 | ((pts.length - 1) << 3)];
          let [px, py] = pts[0];
          for (const [x, y] of pts.slice(1)) {
            cmds.push(zigzag(x - px), zigzag(y - py));
            px = x;
            py = y;
          }
          cmds.push(15);
          msg.writePackedVarint(4, cmds);
        }
      }, null);
    }
    for (const key of keys) layer.writeStringField(3, key);
    for (const { value } of values) {
      layer.writeMessage(4, (_, msg) => {
        if (typeof value === 'boolean') msg.writeBooleanField(7, value);
        else if (typeof value === 'number') msg.writeDoubleField(3, value);
        else msg.writeStringField(1, String(value));
      }, null);
    }
  }, null);
  return writer.finish();
}

test('GeographicLandmarks streams divisions/base tiles, includes look-ahead, and reuses ingested base tiles', async () => {
  const origin = INCHEON_PATCH.origin;
  const divisionTile = encodeMvtLayer('division', [{
    type: 1,
    geom: [2048, 2048],
    properties: {
      id: 'incheon-city',
      wikidata: 'Q20934',
      subtype: 'locality',
      class: 'city',
      '@prominence': 92,
      population: 2950000,
      '@name': '인천광역시',
      names: JSON.stringify({ primary: '인천광역시', common: { en: 'Incheon' }, rules: [{ variant: 'short', language: 'ko', value: '인천' }] }),
    },
  }]);
  const baseTile = encodeMvtLayer('infrastructure', [{
    type: 3,
    geom: [[500, 500], [1100, 500], [1100, 1100], [500, 1100]],
    properties: {
      id: 'bridge-1',
      wikidata: 'Q483949',
      subtype: 'bridge',
      class: 'bridge',
      '@name': '인천대교',
      names: JSON.stringify({ primary: '인천대교', common: { en: 'Incheon Bridge' } }),
    },
  }]);

  const fetched = [];
  const layer = new GeographicLandmarks({
    map: 'incheon',
    origin,
    project: projectToLocal,
    terrain: { getHeight: () => 0, isLoaded: true },
    divisionsArchive: {
      getZxy: async (z, x, y) => {
        fetched.push(`div:${z}:${x}/${y}`);
        return { data: divisionTile };
      },
    },
    baseArchive: {
      getZxy: async (z, x, y) => {
        fetched.push(`base:${z}:${x}/${y}`);
        return { data: baseTile };
      },
    },
  });

  const camera = new THREE.PerspectiveCamera(60, 1.5, 1, 50000);
  camera.position.set(0, 500, 0);
  camera.lookAt(10000, 0, 0); // Looking East -> triggers look-ahead at +10km & +17km East
  camera.updateMatrixWorld();

  const wanted = layer.wantedTilesFor(camera.position, camera);
  const wantedKeys = new Set(wanted.map(t => t.key));
  assert.ok(wanted.some(t => t.source === 'divisions' && t.zoom === 9));
  assert.ok(wanted.some(t => t.source === 'divisions' && t.zoom === 10));
  assert.ok(wanted.some(t => t.source === 'base' && t.zoom === 11));
  assert.ok(wanted.some(t => t.source === 'base' && t.zoom === 13));
  for (const distM of [7500, 11500, 15500]) {
    const wgs = localToWgs84(distM, 0, origin);
    const tile = wgs84ToTile(wgs.latitude, wgs.longitude, 13);
    assert.ok(wantedKeys.has(`base:13:${tile.x}/${tile.y}`), `look-ahead tile at ${distM}m included`);
  }

  // Pre-ingest a base z13 tile via GeographicGreenSpace callback; should not be fetched again
  const ac13 = wgs84ToTile(origin.latitude, origin.longitude, 13);
  layer.ingestBaseTile({ x: ac13.x, y: ac13.y }, 13, baseTile);
  assert.ok(layer.hasStreamedData);
  assert.ok(layer.records.some(r => r.names.en === 'Incheon Bridge'));

  // Run enough update ticks to fetch divisions tiles and confirm ingested base z13 is skipped
  for (let i = 0; i < 6; i++) {
    layer.update(camera.position, camera, null);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.ok(fetched.some(key => key.startsWith('div:9:')));
  assert.ok(!fetched.includes(`base:13:${ac13.x}/${ac13.y}`), 'ingested z13 tile must not be refetched');
  assert.ok(layer.records.some(r => r.names.en === 'Incheon'));
  layer.dispose();
});

test('GeographicLandmarks syncs building landmarks from GeographicBuildings and aborts on dispose', async () => {
  const bldgData = encodeMvtLayer('building', [{
    type: 3,
    geom: [[400, 400], [700, 400], [700, 700], [400, 700]],
    properties: {
      id: 'posco-songdo',
      height: 305,
      subtype: 'commercial',
      class: 'commercial',
      '@name': '포스코타워-송도',
      names: JSON.stringify({ primary: '포스코타워-송도', common: { en: 'Posco Tower-Songdo' } }),
    },
  }]);

  const buildings = new GeographicBuildings({
    origin: INCHEON_PATCH.origin,
    project: projectToLocal,
    terrain: { getHeight: () => 5, isLoaded: true },
    archive: { getZxy: async () => ({ data: bldgData }) },
  });

  const pos = new THREE.Vector3(0, 500, 0);
  buildings.update(pos, pos, 1, 1 / 60);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(buildings.landmarksVersion, 1);
  assert.equal(buildings.getLandmarks()[0].names.en, 'Posco Tower-Songdo');

  let aborted = false;
  let rejectPending;
  const landmarkLayer = new GeographicLandmarks({
    map: 'incheon',
    origin: INCHEON_PATCH.origin,
    project: projectToLocal,
    terrain: { getHeight: () => 5, isLoaded: true },
    divisionsArchive: {
      getZxy: (_z, _x, _y, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; });
        rejectPending = reject;
      }),
    },
    baseArchive: { getZxy: async () => null },
  });

  const cam = new THREE.PerspectiveCamera(60, 1.5, 1, 50000);
  cam.position.copy(pos);
  landmarkLayer.update(pos, cam, buildings);
  assert.ok(landmarkLayer.records.some(r => r.names.en === 'Posco Tower-Songdo'));
  assert.ok(landmarkLayer.hasStreamedData);

  landmarkLayer.dispose();
  assert.equal(aborted, true);
  rejectPending?.(new Error('aborted'));
  buildings.dispose();
});

test('GeographicLandmarks backs off after fetch error and updateGeographicLandmarks manages lifecycle and attribution', async () => {
  const prevDoc = globalThis.document;
  const attribution = { hidden: true };
  globalThis.document = { getElementById: id => (id === 'geographic-buildings-attribution' ? attribution : null) };
  try {
    let calls = 0;
    const layer = new GeographicLandmarks({
      map: 'jeju',
      origin: { latitude: 33.5113, longitude: 126.493 },
      project: () => [0, 0],
      terrain: { getHeight: () => 10, isLoaded: true },
      divisionsArchive: {
        getZxy: async () => {
          calls++;
          throw new Error('network down');
        },
      },
      baseArchive: { getZxy: async () => null },
    });
    const cam = new THREE.PerspectiveCamera(60, 1.5, 1, 50000);
    cam.position.set(0, 300, 0);
    layer.update(cam.position, cam, null);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 1);
    assert.equal(layer.retryAt.size, 1);
    layer.dispose();

    const sim = {
      activeAirport: 'incheon',
      currentTerrain: { mesh: {}, getHeight: () => 0, isLoaded: false },
      position: new THREE.Vector3(0, 100, 0),
      camera: cam,
      geographicBuildingLayer: { group: { children: [] }, landmarksVersion: 0, getLandmarks: () => [] },
    };
    updateGeographicLandmarks(sim);
    assert.ok(sim.geographicLandmarkLayer instanceof GeographicLandmarks);
    assert.equal(attribution.hidden, true);

    sim.geographicLandmarkLayer.hasStreamedData = true;
    updateGeographicLandmarks(sim);
    assert.equal(attribution.hidden, false);

    sim.activeAirport = 'coastal';
    updateGeographicLandmarks(sim);
    assert.equal(sim.geographicLandmarkLayer, null);
    assert.equal(attribution.hidden, true);

    // Generic world/custom map providing terrain.origin works automatically without hardcoded frames
    sim.activeAirport = 'paris-sandbox';
    sim.currentTerrain = { mesh: {}, origin: { latitude: 48.8566, longitude: 2.3522 }, getHeight: () => 35, isLoaded: false };
    updateGeographicLandmarks(sim);
    assert.ok(sim.geographicLandmarkLayer instanceof GeographicLandmarks);
    assert.deepEqual(sim.geographicLandmarkLayer.origin, { latitude: 48.8566, longitude: 2.3522 });
    sim.geographicLandmarkLayer.dispose();
  } finally {
    globalThis.document = prevDoc;
  }
});
