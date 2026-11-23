import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKMARKS_KEY,
  loadBookmarks,
  saveBookmarks,
  toggleBookmark,
  removeBookmark,
  bookmarkKey,
  isBookmarked,
} from '../src/config/airportBookmarks.js';

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    get raw() { return Object.fromEntries(store); },
  };
}

const airport = {
  kind: 'airport',
  id: 'RKSI',
  label: 'Incheon International',
  latitude: 37.469,
  longitude: 126.451,
  code: 'RKSI',
  iata: 'ICN',
};
const point = {
  kind: 'point',
  id: 'jeju-cruise',
  label: 'Jeju cruise',
  latitude: 33.5,
  longitude: 126.5,
};
const savedAirport = {
  kind: 'airport',
  id: 'RKSI',
  label: 'Incheon International',
  latitude: 37.469,
  longitude: 126.451,
  code: 'RKSI',
  iata: 'ICN',
};
const savedPoint = {
  kind: 'point',
  id: 'jeju-cruise',
  label: 'Jeju cruise',
  latitude: 33.5,
  longitude: 126.5,
};

test('storage key and bookmark key follow the versioned convention', () => {
  assert.equal(BOOKMARKS_KEY, 'flight3d.bookmarks.v1');
  assert.equal(bookmarkKey(airport), 'airport:RKSI');
  assert.equal(bookmarkKey(point), 'point:jeju-cruise');
});

test('missing saved data loads as an empty list', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadBookmarks(storage), []);
  assert.equal(isBookmarked(airport, storage), false);
  assert.deepEqual(removeBookmark('airport:RKSI', storage), []);
});

test('valid bookmarks round-trip through memory storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(saveBookmarks([airport, point], storage), [savedAirport, savedPoint]);
  assert.deepEqual(loadBookmarks(storage), [savedAirport, savedPoint]);
  assert.deepEqual(JSON.parse(storage.raw[BOOKMARKS_KEY]), [savedAirport, savedPoint]);
  assert.equal(isBookmarked(airport, storage), true);
  assert.equal(isBookmarked(point, storage), true);
});

test('optional code/iata are kept when valid and unknown fields dropped', () => {
  const storage = memoryStorage();
  const result = saveBookmarks([{
    ...airport,
    code: 123,
    iata: 'X'.repeat(200),
    headingDeg: 270,
  }], storage);
  assert.deepEqual(result, [{
    kind: 'airport',
    id: 'RKSI',
    label: 'Incheon International',
    latitude: 37.469,
    longitude: 126.451,
  }]);
});

test('malformed bookmark fields are rejected on read and write', () => {
  const invalid = [
    null,
    undefined,
    42,
    'airport:RKSI',
    [],
    {},
    { ...airport, kind: 'waypoint' },
    { ...airport, kind: undefined },
    { ...airport, id: '' },
    { ...airport, id: '   ' },
    { ...airport, label: '' },
    { ...airport, label: '\t\n' },
    { ...airport, id: 'x'.repeat(121) },
    { ...airport, label: 'x'.repeat(121) },
    { ...airport, latitude: NaN },
    { ...airport, latitude: Infinity },
    { ...airport, latitude: 90.1 },
    { ...airport, latitude: -91 },
    { ...airport, longitude: 180.1 },
    { ...airport, longitude: -180.1 },
    { ...airport, latitude: '37.469' },
    { ...airport, longitude: null },
  ];
  for (const entry of invalid) {
    const storage = memoryStorage();
    assert.deepEqual(saveBookmarks([entry], storage), [], `should reject ${JSON.stringify(entry)}`);
    storage.setItem(BOOKMARKS_KEY, JSON.stringify([entry, savedPoint]));
    assert.deepEqual(loadBookmarks(storage), [savedPoint], `should skip ${JSON.stringify(entry)}`);
  }
});

test('saving deduplicates by kind:id and caps the list at 50', () => {
  const storage = memoryStorage();
  const many = Array.from({ length: 60 }, (_, index) => ({
    kind: 'airport',
    id: `A${index}`,
    label: `Airport ${index}`,
    latitude: index - 30,
    longitude: 0,
  }));
  const result = saveBookmarks([...many, { ...many[0], label: 'Renamed' }], storage);
  assert.equal(result.length, 50);
  assert.deepEqual(result.slice(0, 2), [
    { kind: 'airport', id: 'A0', label: 'Airport 0', latitude: -30, longitude: 0 },
    { kind: 'airport', id: 'A1', label: 'Airport 1', latitude: -29, longitude: 0 },
  ]);
  assert.equal(new Set(loadBookmarks(storage).map(bookmarkKey)).size, 50);

  const dedupeStorage = memoryStorage();
  assert.deepEqual(saveBookmarks([airport, { ...airport, label: 'Second label' }, point], dedupeStorage),
    [savedAirport, savedPoint]);
});

test('load tolerates corrupt JSON and unexpected payloads', () => {
  for (const raw of ['not json', '{', 'null', '{}', '{"bookmarks":"nope"}', '"airport:RKSI"']) {
    const storage = memoryStorage({ [BOOKMARKS_KEY]: raw });
    assert.deepEqual(loadBookmarks(storage), [], `should ignore ${raw}`);
  }
  const wrapped = memoryStorage({ [BOOKMARKS_KEY]: JSON.stringify({ bookmarks: [savedPoint] }) });
  assert.deepEqual(loadBookmarks(wrapped), [savedPoint]);
});

test('toggle, remove and isBookmarked survive reloads', () => {
  const storage = memoryStorage();
  assert.deepEqual(toggleBookmark(airport, storage), [savedAirport]);
  assert.deepEqual(toggleBookmark(point, storage), [savedAirport, savedPoint]);
  assert.deepEqual(loadBookmarks(storage), [savedAirport, savedPoint]);
  assert.equal(isBookmarked({ ...airport, label: 'Different label' }, storage), true);
  assert.equal(isBookmarked({ ...point, id: 'other-cruise' }, storage), false);

  const afterRemove = toggleBookmark(airport, storage);
  assert.deepEqual(afterRemove, [savedPoint]);
  assert.deepEqual(loadBookmarks(storage), [savedPoint]);
  assert.equal(isBookmarked(airport, storage), false);

  assert.deepEqual(removeBookmark('point:jeju-cruise', storage), []);
  assert.deepEqual(loadBookmarks(storage), []);
  assert.deepEqual(removeBookmark('airport:RKSI', storage), []);
  assert.deepEqual(toggleBookmark(null, storage), []);
});

test('throwing storage getters and setters never escape', () => {
  const explodingAccessors = {
    get getItem() { throw new Error('blocked read'); },
    get setItem() { throw new Error('blocked write'); },
  };
  const explodingMethods = {
    getItem() { throw new Error('blocked read'); },
    setItem() { throw new Error('blocked write'); },
  };
  for (const storage of [explodingAccessors, explodingMethods]) {
    assert.deepEqual(loadBookmarks(storage), []);
    assert.doesNotThrow(() => saveBookmarks([airport], storage));
    assert.doesNotThrow(() => toggleBookmark(airport, storage));
    assert.doesNotThrow(() => removeBookmark('airport:RKSI', storage));
    assert.doesNotThrow(() => isBookmarked(airport, storage));
  }
});

test('guarded access to globalThis.localStorage cannot throw', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('localStorage unavailable'); },
  });
  try {
    assert.deepEqual(loadBookmarks(), []);
    assert.doesNotThrow(() => saveBookmarks([airport]));
    assert.doesNotThrow(() => toggleBookmark(airport));
    assert.doesNotThrow(() => isBookmarked(airport));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
