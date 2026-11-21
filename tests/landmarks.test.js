import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import {
  LANDMARK_PLACES,
  landmarkName,
  landmarkPriorityScore,
  landmarkRangeM,
  landmarksForMap,
  nearestLandmarks,
  normalizeLandmarkPlaces,
  resolveLandmarkHeight,
} from '../src/config/landmarks.js';

test('all maps supply finite landmark anchors using their own coordinate frames', () => {
  const terrain = { getHeight: () => 200, terrain: { centerline: [{ x: 12, z: -4200 }] } };
  const airport = { controlTowerData: { x: 40, z: 10, y: 2840, height: 16 } };
  for (const map of ['incheon', 'jeju', 'lukla', 'neon', 'coastal', 'valley']) {
    const records = landmarksForMap(map, terrain, airport);
    assert.ok(records.length > 0, map);
    for (const record of records) {
      assert.ok(record.en && record.ko, map);
      assert.ok([record.x, record.z, record.height].every(Number.isFinite), map);
    }
  }
  const tower = map => landmarksForMap(map).find(record => record.en === 'Lotte World Tower');
  assert.ok(tower('incheon').x > 25000);
  assert.ok(Math.abs(tower('jeju').z) > 400000);
  assert.deepEqual(landmarksForMap('unknown'), []);
});

test('catalog rows normalize into localized names and invalid rows are skipped', () => {
  const records = normalizeLandmarkPlaces([
    { id: 'station', names: { ko: '서울역', en: 'Seoul Station' }, latitude: 37.5547,
      longitude: 126.9706, kinds: ['station', 'subway'], importance: 2.6, icao: 'RKSS' },
    { id: 'unranked', names: { en: 'Unranked' }, latitude: 37, longitude: 127 },
    { id: 'no-coordinates', names: { en: 'Nowhere' } },
    { id: 'invalid-latitude', names: { en: 'Off globe' }, latitude: 91, longitude: 2 },
    null,
  ]);
  assert.equal(records.length, 2);
  assert.equal(landmarkName(records[0], 'ko'), '서울역');
  assert.equal(landmarkName(records[0], 'en'), 'Seoul Station');
  assert.equal(landmarkName(records[0], 'fr'), 'Seoul Station');
  assert.equal(records[0].importance, 3);
  assert.equal(records[1].importance, 5);
  assert.deepEqual(records[0].kinds, ['station', 'subway']);
  assert.equal(records[0].icao, 'RKSS');
  assert.equal(LANDMARK_PLACES.find(place => place.id === 'incheon-airport').icao, 'RKSI');
  assert.equal(LANDMARK_PLACES.find(place => place.id === 'jeju-airport').icao, 'RKPC');
});

test('custom catalog rows project into each geographic map and use ground height when omitted', () => {
  const terrain = { getHeight: () => 120 };
  const places = [{ id: 'custom', names: { ko: '맞춤 장소', en: 'Custom Place' },
    latitude: 37.2598, longitude: 127.0344, kinds: ['attraction'] }];
  const incheon = landmarksForMap('incheon', terrain, {}, places);
  const jeju = landmarksForMap('jeju', terrain, {}, places);
  assert.equal(incheon.length, 1);
  assert.equal(incheon[0].height, 120);
  assert.ok(Math.abs(incheon[0].x) > 20000);
  assert.equal(jeju[0].height, 120);
  assert.notEqual(incheon[0].z, jeju[0].z);
});

test('nearest landmarks select by distance, category and range', () => {
  const records = [
    { id: 'near', x: 500, z: 0, height: 10, kinds: ['station'] },
    { id: 'behind', x: -1000, z: 0, height: 10, kinds: ['station'] },
    { id: 'far', x: 30000, z: 0, height: 10, kinds: ['attraction'] },
    { id: 'out-of-range', x: 60000, z: 0, height: 10, kinds: ['station'] },
  ];
  const origin = new Vector3(0, 0, 0);
  const ids = options => nearestLandmarks(records, origin, options).map(candidate => candidate.record.id);
  assert.deepEqual(ids({ limit: 2 }), ['near', 'behind']);
  assert.deepEqual(ids({ limit: 2, kinds: ['attraction'] }), ['far']);
  assert.deepEqual(ids({ maxDistanceM: 500 }), []);
  assert.equal(ids({ limit: Infinity }).length, 3);
});

test('importance scales visible range and hides distant low-ranked places', () => {
  assert.equal(landmarkRangeM({ importance: 5 }), 45000);
  assert.equal(landmarkRangeM({ importance: 1 }), 9000);
  assert.equal(landmarkRangeM({}), 45000);
  const records = [
    { id: 'major', x: 20000, z: 0, height: 0, importance: 5 },
    { id: 'minor', x: 20000, z: 0, height: 0, importance: 2 },
  ];
  assert.deepEqual(nearestLandmarks(records, new Vector3(), { limit: Infinity })
    .map(candidate => candidate.record.id), ['major']);
});

test('prominence priority lets major landmarks outrank closer minor POIs while keeping same-importance nearest-first', () => {
  assert.ok(landmarkPriorityScore({ importance: 5, prominence: 0.9 }, 8000)
    > landmarkPriorityScore({ importance: 2, prominence: 0.4 }, 500));

  const records = [
    { id: 'near-subway', x: 0, z: -400, height: 0, importance: 1, prominence: 0.45, kinds: ['station'] },
    { id: 'major-city', x: 0, z: -4000, height: 0, importance: 5, prominence: 0.95, kinds: ['city'] },
    { id: 'far-city', x: 0, z: -8000, height: 0, importance: 5, prominence: 0.95, kinds: ['city'] },
  ];
  const ranked = nearestLandmarks(records, new Vector3(0, 0, 0), { limit: 3 });
  assert.deepEqual(ranked.map(c => c.record.id), ['major-city', 'far-city', 'near-subway']);
});

test('resolveLandmarkHeight tracks terrain height dynamically for groundRelative records', () => {
  let ground = 10;
  const terrain = { getHeight: () => ground };
  const building = { id: 'tower', x: 100, z: 200, groundRelative: true, heightOffsetM: 250 };
  const peak = { id: 'peak', x: 100, z: 200, groundRelative: false, height: 1947, elevationM: 1947 };

  assert.equal(resolveLandmarkHeight(building, terrain), 260);
  ground = 45;
  assert.equal(resolveLandmarkHeight(building, terrain), 295);
  assert.equal(resolveLandmarkHeight(peak, terrain), 1947);
});
