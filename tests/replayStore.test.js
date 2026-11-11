import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayStore, replayLabel, AUTO_SAVE_LABEL } from '../src/replay/ReplayStore.js';
import { decodeTrack, fromBase64 } from '../src/replay/ReplayCodec.js';

const INDEX_KEY = 'flight3d.replays.v1';
const payloadKey = id => `flight3d.replay.${id}.v1`;

class MockStorage {
  constructor() { this.store = new Map(); }
  getItem(key) { return this.store.get(key) ?? null; }
  setItem(key, value) { this.store.set(key, String(value)); }
  removeItem(key) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

/** Rejects any write that would push the total stored characters past the quota. */
class QuotaStorage extends MockStorage {
  constructor(capacity) {
    super();
    this.capacity = capacity;
  }

  used() {
    let total = 0;
    for (const value of this.store.values()) total += value.length;
    return total;
  }

  setItem(key, value) {
    const next = this.used() - (this.store.get(key)?.length ?? 0) + String(value).length;
    if (next > this.capacity) throw new Error('QuotaExceededError');
    super.setItem(key, value);
  }
}

function sample(timeSec) {
  return {
    timeSec,
    x: 1200.5, y: 1829.375, z: -440.125,
    quat: [0.0123, 0.9876, -0.1234, 0.0869],
    iasKnots: 254.3, headingDeg: 274.6, gForce: 1.27,
    engine1: { n1: 87.4, n2: 94.1, egt: 612, ff: 1180, failed: false },
  };
}

function track(sampleCount = 20, intervalSec = 0.2) {
  const samples = [];
  for (let index = 0; index < sampleCount; index++) samples.push(sample(index * intervalSec));
  return { intervalSec, durationSec: (sampleCount - 1) * intervalSec, overflow: false,
    metadata: { airport: 'coastal', aircraft: 'B738', scenario: 'approach' }, samples };
}

// Measured payload sizes: 20 samples 2239, 24 → 2666, 30 → 3306, 60 → 6506 base64 characters.
const BUDGET = Object.freeze({ entryBase64Bytes: 8192, entries: 3, totalBase64Bytes: 1_000_000 });

function storeFor(storage = new MockStorage(), budget = BUDGET) {
  return new ReplayStore(storage, { budget });
}

test('replayLabel summarises a track by what was flown, not when', () => {
  assert.equal(replayLabel(track()), 'B738 · coastal · approach');
  assert.equal(replayLabel({ metadata: { aircraft: 'C172' } }), 'C172');
  assert.equal(replayLabel(null), 'flight');
});

test('save stores a playable track and indexes it newest first', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const { entry, error } = store.save(track());
  assert.equal(error, null);
  assert.equal(entry.label, 'B738 · coastal · approach');
  assert.equal(entry.sampleCount, 20);
  assert.equal(entry.intervalSec, 0.2);
  assert.ok(Math.abs(entry.durationSec - 3.8) < 1e-9, entry.durationSec);
  assert.equal(entry.bytes, 2239);
  assert.match(entry.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(entry.metadata.airport, 'coastal');
  assert.equal(storage.getItem(payloadKey(entry.id)).length, 2239);

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, entry.id);
  assert.deepEqual(listed[0].metadata, entry.metadata);

  const loaded = store.get(entry.id);
  assert.equal(loaded.meta.id, entry.id);
  assert.equal(loaded.track.samples.length, 20);
  assert.ok(Math.abs(loaded.track.samples[19].x - 1200.5) < 1e-3);
  assert.equal(loaded.track.metadata.aircraft, 'B738');
});

test('an explicit label is cleaned and clamped', () => {
  const store = storeFor();
  assert.equal(store.save(track(), { label: '  final\tapproach  to\rkanagawa ' }).entry.label,
    'final approach to kanagawa');
  assert.equal(store.save(track(), { label: 'x'.repeat(80) }).entry.label.length, 64);
  assert.equal(store.save(track(), { label: '   ' }).entry.label, 'B738 · coastal · approach');
  assert.equal(store.save(track(), { label: 42 }).entry.label, 'B738 · coastal · approach');
});

test('unplayable tracks are refused before anything is written', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  assert.deepEqual(store.save(null), { entry: null, error: 'tooShort' });
  assert.equal(store.save({ ...track(), samples: [sample(0)] }).error, 'tooShort');
  assert.equal(store.save({ ...track(), overflow: true }).error, 'tooLong');
  assert.equal(storeFor(storage, { ...BUDGET, entryBase64Bytes: 12 }).save(track()).error, 'tooLong');
  assert.equal(storage.store.size, 0, 'a refused save must not touch storage');
});

test('a corrupt index reads as an empty library instead of throwing', () => {
  const storage = new MockStorage();
  storage.setItem(INDEX_KEY, '{not json');
  const store = storeFor(storage);
  assert.deepEqual(store.list(), []);
  assert.equal(typeof store.error, 'string');
  assert.notEqual(store.error, '');
  storage.setItem(INDEX_KEY, JSON.stringify([
    null, 'plain string', { id: 7, durationSec: 1, bytes: 1, metadata: {} },
    { id: 'good', durationSec: 1, bytes: 1, metadata: { airport: 'coastal' }, savedAt: 'now' },
  ]));
  assert.deepEqual(store.list().map(row => row.id), ['good']);
});

test('rename and remove keep the index and the payloads in step', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const first = store.save(track()).entry;
  const second = store.save(track(30)).entry;

  assert.equal(store.rename(first.id, '  Lukla run-in  '), true);
  assert.equal(store.get(first.id).meta.label, 'Lukla run-in');
  assert.equal(store.rename(first.id, '   '), false);
  assert.equal(store.rename('missing', 'x'), false);

  assert.equal(store.remove(second.id), true);
  assert.equal(store.get(second.id), null);
  assert.deepEqual(store.list().map(row => row.id), [first.id]);
  assert.equal(storage.getItem(payloadKey(second.id)), null);
  assert.equal(store.remove(second.id), false);
});

test('the entry count budget evicts the oldest saves and drops their payloads', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const ids = [];
  for (let index = 0; index < 5; index++) ids.push(store.save(track(20 + index)).entry.id);
  assert.equal(store.list().length, 3);
  assert.deepEqual(store.list().map(row => row.sampleCount).sort((a, b) => a - b), [22, 23, 24]);
  for (const id of ids.slice(0, 2)) {
    assert.equal(storage.getItem(payloadKey(id)), null, 'payload survived eviction');
  }
  assert.equal(store.get(ids[4]).track.samples.length, 24);
});

test('the total byte budget evicts oldest until the library fits', () => {
  const storage = new MockStorage();
  const store = storeFor(storage, { ...BUDGET, entries: 8, totalBase64Bytes: 6000 });
  const oldest = store.save(track(20)).entry;
  const middle = store.save(track(24)).entry;
  const newest = store.save(track(30)).entry;
  assert.deepEqual(store.list().map(row => row.id).sort(), [middle.id, newest.id].sort());
  assert.equal(storage.getItem(payloadKey(oldest.id)), null);
  assert.equal(store.get(oldest.id), null);
  assert.equal(store.get(middle.id).track.samples.length, 24);
  // Saving past the budget sheds older entries until it fits, so only the newest is guaranteed.
  const big = store.save(track(60)).entry;
  assert.deepEqual(store.list().map(row => row.id), [big.id]);
  assert.equal(storage.getItem(payloadKey(middle.id)), null);
  assert.equal(storage.getItem(payloadKey(newest.id)), null);
  assert.equal(store.get(big.id).track.samples.length, 60);
});

test('a quota failure leaves no half-saved entry and reports the error', () => {
  const storage = new QuotaStorage(10);
  const store = storeFor(storage);
  const result = store.save(track());
  assert.equal(result.entry, null);
  assert.equal(result.error, 'QuotaExceededError');
  assert.equal(store.error, 'QuotaExceededError');
  assert.deepEqual(store.list(), []);
  assert.equal(storage.store.size, 0);
});

test('an oversized payload evicts the oldest existing save instead of failing outright', () => {
  const storage = new QuotaStorage(8000);
  const store = storeFor(storage, { ...BUDGET, totalBase64Bytes: 8192 });
  const old = store.save(track(20)).entry;
  const big = store.save(track(60)).entry;
  assert.equal(big.sampleCount, 60);
  assert.equal(store.get(old.id), null);
  assert.equal(storage.getItem(payloadKey(old.id)), null);
  assert.deepEqual(store.list().map(row => row.id), [big.id]);
  assert.equal(store.error, null);
});

test('a save whose payload vanished reads as missing rather than as a crash', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const { entry } = store.save(track());
  storage.removeItem(payloadKey(entry.id));
  assert.equal(store.get(entry.id), null);
  assert.equal(store.error, 'missingPayload');
  assert.equal(store.exportJson(entry.id), null);
});

test('export and import move a replay between storages', () => {
  const source = storeFor();
  const { entry } = source.save(track(40), { label: 'Sunset pattern' });
  const parsed = JSON.parse(source.exportJson(entry.id));
  assert.equal(parsed.kind, 'flight3d.replay.v1');
  assert.equal(parsed.entry.label, 'Sunset pattern');

  const target = storeFor(new MockStorage());
  const imported = target.importJson(JSON.stringify(parsed));
  assert.equal(imported.error, null);
  assert.equal(imported.entry.label, 'Sunset pattern');
  assert.equal(imported.entry.sampleCount, 40);
  assert.notEqual(imported.entry.id, entry.id);
  assert.equal(target.get(imported.entry.id).track.samples.length, 40);

  for (const junk of ['[', 'not json at all', JSON.stringify({ kind: 'other', payload: 'abc' }),
    JSON.stringify({ kind: 'flight3d.replay.v1' }),
    JSON.stringify({ kind: 'flight3d.replay.v1', payload: '!!!' }),
    JSON.stringify({ kind: 'flight3d.replay.v1', payload: parsed.payload.slice(0, 40) })]) {
    const refused = target.importJson(junk);
    assert.equal(refused.entry, null, `accepted ${junk.slice(0, 24)}`);
    assert.equal(typeof refused.error, 'string');
    assert.notEqual(refused.error, '');
  }
  assert.equal(target.list().length, 1, 'a failed import must not touch the library');
});

test('the store degrades quietly when the platform has no storage', () => {
  const store = new ReplayStore(undefined, { budget: BUDGET });
  assert.deepEqual(store.list(), []);
  assert.equal(store.get('x'), null);
  assert.equal(store.exportJson('x'), null);
  assert.equal(store.rename('x', 'y'), false);
  assert.equal(store.remove('x'), false);
  const refused = store.save(track());
  assert.equal(refused.entry, null);
  assert.equal(refused.error, 'Storage unavailable');
});

test('stored payloads are padding-free base64url', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const { entry } = store.save(track());
  const raw = storage.getItem(payloadKey(entry.id));
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  assert.equal(decodeTrack(fromBase64(raw)).samples.length, 20);
});

test('a successful quota retry removes already purged payloads from the index', () => {
  const storage = new QuotaStorage(100000);
  const store = storeFor(storage);
  const first = store.save(track()).entry;
  const second = store.save(track()).entry;
  // Enough for two payloads and their index, but not for a third payload-first write.
  storage.capacity = storage.used() + 10;
  const third = store.save(track()).entry;
  assert.ok(third);
  assert.ok(store.list().every(row => store.get(row.id)), 'every surviving index row must be playable');
  assert.ok(!store.get(first.id) || !store.get(second.id));
});

test('failed oversized quota replacement restores every original payload and index', () => {
  const storage = new QuotaStorage(4000);
  const store = storeFor(storage);
  const original = store.save(track(20)).entry;
  const before = [...storage.store];
  assert.equal(store.save(track(60)).entry, null);
  assert.deepEqual([...storage.store].sort(), before.sort());
  assert.equal(store.get(original.id).track.samples.length, 20);
});

test('index write failure rolls back evictions after a new payload fit', () => {
  const storage = new QuotaStorage(8000);
  const store = storeFor(storage);
  const original = store.save(track(20)).entry;
  const before = [...storage.store];
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === INDEX_KEY) throw new Error('index unavailable');
    setItem(key, value);
  };
  assert.equal(store.save(track(60)).entry, null);
  assert.deepEqual([...storage.store].sort(), before.sort());
  assert.equal(store.get(original.id).track.samples.length, 20);
});

test('F16 high fuel flow survives save and export/import', () => {
  const source = track();
  source.metadata.aircraft = 'F16';
  source.samples[0].engine1.ff = 4500;
  source.samples[0].engine2 = { ff: 3900 };
  const store = storeFor();
  const saved = store.save(source).entry;
  assert.equal(store.get(saved.id).track.samples[0].engine1.ff, 4500);
  const target = storeFor();
  const imported = target.importJson(store.exportJson(saved.id)).entry;
  assert.equal(target.get(imported.id).track.samples[0].engine1.ff, 4500);
  assert.equal(target.get(imported.id).track.samples[0].engine2.ff, 3900);
});

test('saveAuto keeps exactly one latest-flight entry, replacing the previous one', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const first = store.saveAuto(track(20)).entry;
  assert.equal(first.label, AUTO_SAVE_LABEL);
  assert.equal(first.auto, true);

  const second = store.saveAuto(track(30)).entry;
  assert.equal(second.auto, true);
  assert.deepEqual(store.list().map(row => row.id), [second.id]);
  assert.equal(store.get(second.id).track.samples.length, 30);
  assert.equal(storage.getItem(payloadKey(first.id)), null, 'the replaced auto payload must be dropped');
  assert.equal(store.get(first.id), null);
});

test('saveAuto refuses an unplayable track without disturbing the kept flight', () => {
  const storage = new MockStorage();
  const store = storeFor(storage);
  const kept = store.saveAuto(track()).entry;
  assert.equal(store.saveAuto(null).error, 'tooShort');
  assert.equal(store.saveAuto({ ...track(), overflow: true }).error, 'tooLong');
  const before = [...storage.store];
  assert.deepEqual(store.list().map(row => row.id), [kept.id]);
  assert.deepEqual([...storage.store].sort(), before.sort(), 'a refused auto save must not touch storage');
});

test('renaming an auto save promotes it so later flights no longer overwrite it', () => {
  const store = storeFor();
  const auto = store.saveAuto(track(20)).entry;
  assert.equal(store.rename(auto.id, '  Lukla keep  '), true);
  assert.equal(store.get(auto.id).meta.label, 'Lukla keep');
  assert.equal(store.get(auto.id).meta.auto, undefined, 'a promoted save is no longer disposable');

  const next = store.saveAuto(track(30)).entry;
  assert.notEqual(next.id, auto.id);
  assert.deepEqual(store.list().map(row => row.label).sort(), ['Lukla keep', AUTO_SAVE_LABEL].sort());
  assert.equal(store.get(auto.id).track.samples.length, 20, 'the promoted save must survive the next flight');
});

test('an auto save coexists with manual saves in the same library', () => {
  const store = storeFor();
  const manual = store.save(track(24)).entry;
  const auto = store.saveAuto(track(20)).entry;
  assert.deepEqual(store.list().map(row => row.id).sort(), [auto.id, manual.id].sort());
  assert.equal(store.get(manual.id).meta.auto, undefined);
});
