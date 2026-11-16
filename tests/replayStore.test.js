import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ReplayStore,
  createMemoryIndexedDB,
  replayLabel,
  AUTO_SAVE_LABEL,
  ROOM_AUTO_SAVE_LABEL,
  extractReportSummary,
  createSortie,
  createSortieContainer,
  createCompressedSortie,
  SORTIE_KIND,
  LEGACY_REPLAY_KIND,
  REPLAY_DB_NAME,
  REPLAY_ENTRIES_STORE,
  REPLAY_PAYLOADS_STORE,
} from '../src/replay/ReplayStore.js';
import {
  encodeTrack,
  decodeTrack,
  toBase64,
  fromBase64,
  compressGzip,
  encodeCompressedContainer,
  REPLAY_CONTAINER_MAGIC,
  REPLAY_CONTAINER_VERSION,
  isGzipBytes,
} from '../src/replay/ReplayCodec.js';

const INDEX_KEY = 'flight3d.replays.v1';
const payloadKey = id => `flight3d.replay.${id}.v1`;

class MockStorage {
  constructor() { this.store = new Map(); }
  getItem(key) { return this.store.get(key) ?? null; }
  setItem(key, value) { this.store.set(key, String(value)); }
  removeItem(key) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

function sample(timeSec, index = 0) {
  const angle = index * 0.17;
  const quatRaw = [
    Math.sin(angle * 0.5) * 0.2,
    Math.cos(angle * 0.3) * 0.7,
    Math.sin(angle * 0.7) * 0.15,
    Math.cos(angle * 0.5) * 0.65,
  ];
  const norm = Math.hypot(...quatRaw) || 1;
  return {
    timeSec,
    x: 1200.5 + index * 37.3 + Math.sin(angle) * 14,
    y: 1829.375 + index * 2.7 + Math.cos(angle * 1.3) * 9,
    z: -440.125 - index * 41.9 + Math.sin(angle * 2.1) * 11,
    quat: quatRaw.map(v => v / norm),
    iasKnots: 220 + (index % 73) * 0.8 + Math.sin(angle) * 5,
    headingDeg: (274.6 + index * 3.1) % 360,
    pitchDeg: Math.sin(angle) * 7.5,
    rollDeg: Math.cos(angle * 0.9) * 24,
    gForce: 1.0 + Math.sin(angle * 1.5) * 0.85,
    engine1: { n1: 75 + (index % 20), n2: 88 + (index % 11), egt: 560 + (index % 90), ff: 1180 + (index % 250), failed: false },
  };
}

function track(sampleCount = 20, intervalSec = 0.2) {
  const samples = [];
  for (let index = 0; index < sampleCount; index++) samples.push(sample(index * intervalSec, index));
  return {
    intervalSec,
    durationSec: (sampleCount - 1) * intervalSec,
    overflow: false,
    metadata: { airport: 'coastal', aircraft: 'B738', scenario: 'approach' },
    samples,
  };
}

const BUDGET = Object.freeze({
  entries: 3,
  entryTrackBytes: 12_000,
  entryReportBytes: 24_000,
  entryDecompressedBytes: 36_013,
  entryCompressedBytes: 12_000,
  totalCompressedBytes: 500_000,
  maxLegacyJsonBytes: 2_000_000,
  entryBase64Bytes: 16_000,
  totalBase64Bytes: 500_000,
});

function storeFor(storage = new MockStorage(), budget = BUDGET, options = {}) {
  return new ReplayStore(storage, { budget, ...options });
}

function getIdbEntry(idb, id) {
  return idb._databases.get(REPLAY_DB_NAME)?.stores.get(REPLAY_ENTRIES_STORE)?.data.get(id) ?? null;
}

function getIdbPayload(idb, id) {
  return idb._databases.get(REPLAY_DB_NAME)?.stores.get(REPLAY_PAYLOADS_STORE)?.data.get(id) ?? null;
}

function deleteIdbPayload(idb, id) {
  idb._databases.get(REPLAY_DB_NAME)?.stores.get(REPLAY_PAYLOADS_STORE)?.data.delete(id);
}

test('replayLabel summarises a track by what was flown, not when', () => {
  assert.equal(replayLabel(track()), 'B738 · coastal · approach');
  assert.equal(replayLabel({ metadata: { aircraft: 'C172' } }), 'C172');
  assert.equal(replayLabel(null), 'flight');
});

test('a combat payload survives IndexedDB save, load, .f3dr.gz export/import, and legacy JSON export/import', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const source = track();
  source.combat = {
    banditIntervalSec: 0.5,
    missileIntervalSec: 0.05,
    targets: [{ id: 1, callsign: 'BANDIT 1' }],
    banditSamples: [{ timeSec: 0, rails: 0b111110,
      targets: [{ x: 10, y: 3000, z: -5000, headingRad: 0, alive: true }] }],
    missileSamples: [{ timeSec: 0.2, id: 1, typeId: 'AIM9X', x: 10, y: 3000, z: -500, quat: [0, 0, 0, 1], powered: true }],
    events: [{ timeSec: 0.2, kind: 'launch', missileId: 1, targetId: 1, locked: true, x: 10, y: 3000, z: -500 }],
  };
  const saved = await store.save(source);
  assert.equal(saved.error, null);
  const loaded = await store.get(saved.entry.id);
  assert.equal(loaded.track.combat.targets[0].callsign, 'BANDIT 1');
  assert.equal(loaded.track.combat.banditSamples[0].rails, 0b111110);
  assert.equal(loaded.track.combat.events[0].kind, 'launch');

  const exportedBytes = await store.exportContainer(saved.entry.id);
  assert.ok(isGzipBytes(exportedBytes));
  const importStore = storeFor(new MockStorage());
  const imported = await importStore.importReplay(exportedBytes);
  assert.equal(imported.error, null);
  const roundTripped = await importStore.get(imported.entry.id);
  assert.equal(roundTripped.track.combat.targets[0].callsign, 'BANDIT 1');
  assert.equal(roundTripped.track.combat.banditSamples[0].rails, 0b111110);
  assert.equal(roundTripped.track.combat.events[0].kind, 'launch');

  const exportedJson = await store.exportJson(saved.entry.id);
  const jsonImported = await importStore.importJson(exportedJson);
  assert.equal(jsonImported.error, null);
  assert.equal((await importStore.get(jsonImported.entry.id)).track.combat.targets[0].callsign, 'BANDIT 1');
});

test('save stores compressed Blob and ArrayBuffer payloads in IndexedDB and indexes newest first', async () => {
  for (const payloadType of ['blob', 'arrayBuffer']) {
    const idb = createMemoryIndexedDB();
    const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb, payloadType });
    const { entry, error } = await store.save(track());
    assert.equal(error, null);
    assert.equal(entry.label, 'B738 · coastal · approach');
    assert.equal(entry.sampleCount, 20);
    assert.equal(entry.intervalSec, 0.2);
    assert.ok(Math.abs(entry.durationSec - 3.8) < 1e-9, entry.durationSec);
    assert.match(entry.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(entry.metadata.airport, 'coastal');

    const storedBlob = getIdbPayload(idb, entry.id);
    if (payloadType === 'blob') {
      assert.ok(storedBlob instanceof Blob);
      assert.equal(entry.bytes, storedBlob.size);
    } else {
      assert.ok(storedBlob instanceof ArrayBuffer);
      assert.equal(entry.bytes, storedBlob.byteLength);
    }
    const rawHeader = new Uint8Array(storedBlob instanceof Blob ? await storedBlob.arrayBuffer() : storedBlob);
    assert.equal(isGzipBytes(rawHeader), true, 'stored IndexedDB payload must be gzip compressed');
    assert.ok(entry.bytes < encodeTrack(track()).byteLength, 'gzip container should be smaller than uncompressed binary track');

    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, entry.id);
    assert.deepEqual(listed[0].metadata, entry.metadata);

    const loaded = await store.get(entry.id);
    assert.equal(loaded.meta.id, entry.id);
    assert.equal(loaded.track.samples.length, 20);
    assert.ok(Math.abs(loaded.track.samples[19].x - sample(3.8, 19).x) < 1e-2);
    assert.equal(loaded.track.metadata.aircraft, 'B738');
  }
});

test('an explicit label is cleaned and clamped', async () => {
  const store = storeFor();
  assert.equal((await store.save(track(), { label: '  final\tapproach  to\rkanagawa ' })).entry.label,
    'final approach to kanagawa');
  assert.equal((await store.save(track(), { label: 'x'.repeat(80) })).entry.label.length, 64);
  assert.equal((await store.save(track(), { label: '   ' })).entry.label, 'B738 · coastal · approach');
  assert.equal((await store.save(track(), { label: 42 })).entry.label, 'B738 · coastal · approach');
});

test('unplayable tracks are refused before anything is written to IndexedDB', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  assert.deepEqual(await store.save(null), { entry: null, error: 'tooShort' });
  assert.equal((await store.save({ ...track(), samples: [sample(0)] })).error, 'tooShort');
  assert.equal((await store.save({ ...track(), overflow: true })).error, 'tooLong');
  assert.equal((await storeFor(new MockStorage(), { ...BUDGET, entryTrackBytes: 12 }).save(track())).error, 'tooLong');
  assert.equal((await storeFor(new MockStorage(), { ...BUDGET, entryCompressedBytes: 50 }).save(track(40))).error, 'tooLong');
  assert.equal(idb._databases.get(REPLAY_DB_NAME)?.stores.get(REPLAY_ENTRIES_STORE)?.data.size ?? 0, 0);
  assert.equal(idb._databases.get(REPLAY_DB_NAME)?.stores.get(REPLAY_PAYLOADS_STORE)?.data.size ?? 0, 0);
});

test('a corrupt legacy index reads as an empty library instead of throwing', async () => {
  const storage = new MockStorage();
  storage.setItem(INDEX_KEY, '{not json');
  const store = storeFor(storage);
  await store.ready();
  assert.deepEqual(store.list(), []);
  assert.equal(typeof store.error, 'string');
  assert.notEqual(store.error, '');

  const mixedStorage = new MockStorage();
  const validTrack = track(10);
  mixedStorage.setItem(payloadKey('good'), JSON.stringify(createSortie({ label: 'Good' }, validTrack)));
  mixedStorage.setItem(INDEX_KEY, JSON.stringify([
    null,
    'plain string',
    { id: 7, durationSec: 1, bytes: 1, metadata: {} },
    { id: 'good', durationSec: 1.8, bytes: 500, sampleCount: 10, intervalSec: 0.2,
      label: 'Good', metadata: { airport: 'coastal' }, savedAt: '2026-01-01T00:00:00.000Z' },
  ]));
  const mixedStore = storeFor(mixedStorage);
  await mixedStore.ready();
  assert.deepEqual(mixedStore.list().map(row => row.id), ['good']);
});

test('rename and remove keep IndexedDB entries and payloads in step', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const first = (await store.save(track())).entry;
  const second = (await store.save(track(30))).entry;

  assert.equal(await store.rename(first.id, '  Lukla run-in  '), true);
  assert.equal((await store.get(first.id)).meta.label, 'Lukla run-in');
  assert.equal((await store.get(first.id)).report.label, 'Lukla run-in');
  assert.equal(await store.rename(first.id, '   '), false);
  assert.equal(await store.rename('missing', 'x'), false);

  assert.equal(await store.remove(second.id), true);
  assert.equal(await store.get(second.id), null);
  assert.deepEqual(store.list().map(row => row.id), [first.id]);
  assert.equal(getIdbEntry(idb, second.id), null);
  assert.equal(getIdbPayload(idb, second.id), null);
  assert.equal(await store.remove(second.id), false);
});

test('the entry count budget evicts the oldest saves and drops their IndexedDB payloads', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const ids = [];
  for (let index = 0; index < 5; index++) {
    ids.push((await store.save(track(20 + index))).entry.id);
  }
  assert.equal(store.list().length, 3);
  assert.deepEqual(store.list().map(row => row.sampleCount).sort((a, b) => a - b), [22, 23, 24]);
  for (const id of ids.slice(0, 2)) {
    assert.equal(getIdbPayload(idb, id), null, 'payload survived eviction');
    assert.equal(getIdbEntry(idb, id), null, 'entry survived eviction');
  }
  assert.equal((await store.get(ids[4])).track.samples.length, 24);
});

test('the total compressed byte budget evicts oldest until the library fits', async () => {
  const idb = createMemoryIndexedDB();
  // Measure realistic compressed sizes for 20, 24, 30, and 80 varied samples first.
  const measureStore = storeFor(new MockStorage(), { ...BUDGET, entries: 8, totalCompressedBytes: 500_000 });
  const s20 = (await measureStore.save(track(20))).entry.bytes;
  const s24 = (await measureStore.save(track(24))).entry.bytes;
  const s30 = (await measureStore.save(track(30))).entry.bytes;
  const s80 = (await measureStore.save(track(80))).entry.bytes;
  assert.ok(s20 < s24 && s24 < s30 && s30 < s80);

  // Allow middle + newest (s24 + s30), but not oldest + middle + newest (s20 + s24 + s30).
  const totalBudget = s24 + s30 + 20;
  assert.ok(s20 + s24 + s30 > totalBudget);
  const store = storeFor(new MockStorage(), { ...BUDGET, entries: 8, totalCompressedBytes: totalBudget }, { indexedDB: idb });
  const oldest = (await store.save(track(20))).entry;
  const middle = (await store.save(track(24))).entry;
  const newest = (await store.save(track(30))).entry;
  assert.deepEqual(store.list().map(row => row.id).sort(), [middle.id, newest.id].sort());
  assert.equal(getIdbPayload(idb, oldest.id), null);
  assert.equal(await store.get(oldest.id), null);
  assert.equal((await store.get(middle.id)).track.samples.length, 24);

  // Saving an entry larger than the remaining space evicts older entries until it fits.
  const tightStore = storeFor(new MockStorage(), { ...BUDGET, entries: 8, totalCompressedBytes: s80 + 50 }, { indexedDB: idb });
  const big = (await tightStore.save(track(80))).entry;
  assert.deepEqual(tightStore.list().map(row => row.id), [big.id]);
  assert.equal(getIdbPayload(idb, middle.id), null);
  assert.equal(getIdbPayload(idb, newest.id), null);
  assert.equal((await tightStore.get(big.id)).track.samples.length, 80);
});

test('a quota failure leaves no half-saved entry and reports the error', async () => {
  const idb = createMemoryIndexedDB({ quotaBytes: 50 });
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const result = await store.save(track());
  assert.equal(result.entry, null);
  assert.equal(result.error, 'QuotaExceededError');
  assert.equal(store.error, 'QuotaExceededError');
  assert.deepEqual(store.list(), []);
  assert.equal(idb._databases.get(REPLAY_DB_NAME)?.stores.get(REPLAY_ENTRIES_STORE)?.data.size ?? 0, 0);
});

test('an oversized payload under IDB quota evicts the oldest existing save instead of failing outright', async () => {
  const measureStore = storeFor();
  const s20 = (await measureStore.save(track(20))).entry.bytes;
  const s80 = (await measureStore.save(track(80))).entry.bytes;
  const idb = createMemoryIndexedDB({ quotaBytes: s80 + 600 });
  const store = storeFor(new MockStorage(), { ...BUDGET, totalCompressedBytes: s20 + s80 + 5000 }, { indexedDB: idb });
  const old = (await store.save(track(20))).entry;
  const big = (await store.save(track(80))).entry;
  assert.equal(big.sampleCount, 80);
  assert.equal(await store.get(old.id), null);
  assert.equal(getIdbPayload(idb, old.id), null);
  assert.deepEqual(store.list().map(row => row.id), [big.id]);
  assert.equal(store.error, null);
});

test('a save whose payload vanished from IndexedDB reads as missing rather than as a crash', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const { entry } = await store.save(track());
  deleteIdbPayload(idb, entry.id);
  assert.equal(await store.get(entry.id), null);
  assert.equal(store.error, 'missingPayload');
  assert.equal(await store.exportContainer(entry.id), null);
  assert.equal(await store.exportJson(entry.id), null);
});

test('export (.f3dr.gz) and import support container and legacy JSON formats while rejecting malformed inputs', async () => {
  const source = storeFor();
  const summary = { reason: 'landed', peakG: 1.8, peakAltFt: 3200, touchdown: { sinkRateFpm: -120, contactG: 1.15 } };
  const { entry } = await source.save(track(40), { label: 'Sunset pattern', summary });

  // New compressed binary container (.f3dr.gz) without Base64 encoding
  const exportedContainer = await source.exportContainer(entry.id);
  assert.ok(exportedContainer instanceof Uint8Array);
  assert.equal(isGzipBytes(exportedContainer), true);
  const exportedBlob = await source.exportBlob(entry.id);
  assert.ok(exportedBlob instanceof Blob);
  assert.equal(exportedBlob.type, 'application/gzip');

  const target = storeFor(new MockStorage());
  const importedBin = await target.importFile(new File([exportedBlob], 'sunset.f3dr.gz', { type: 'application/gzip' }));
  assert.equal(importedBin.error, null);
  assert.equal(importedBin.entry.label, 'Sunset pattern');
  assert.deepEqual(importedBin.entry.summary, summary);
  assert.equal(importedBin.entry.sampleCount, 40);
  assert.notEqual(importedBin.entry.id, entry.id);
  assert.equal((await target.get(importedBin.entry.id)).track.samples.length, 40);

  // Legacy flight3d.sortie.v1 JSON still imports cleanly
  const sortieJson = await source.exportJson(entry.id);
  const parsed = JSON.parse(sortieJson);
  assert.equal(parsed.kind, SORTIE_KIND);
  const importedSortie = await target.importJson(sortieJson);
  assert.equal(importedSortie.error, null);
  assert.equal(importedSortie.entry.label, 'Sunset pattern');
  assert.deepEqual(importedSortie.entry.summary, summary);

  // Legacy flight3d.replay.v1 JSON still imports cleanly
  const legacy = {
    kind: LEGACY_REPLAY_KIND,
    entry: { label: 'Old flight', durationSec: 10 },
    payload: parsed.track,
  };
  const legacyImported = await target.importJson(JSON.stringify(legacy));
  assert.equal(legacyImported.error, null);
  assert.equal(legacyImported.entry.label, 'Old flight');
  assert.equal((await target.get(legacyImported.entry.id)).track.samples.length, 40);

  // Malformed binary containers, corrupt gzip streams, zip bombs, and invalid JSON are all refused.
  const badVersionRaw = createSortieContainer({ label: 'bad' }, track(5));
  badVersionRaw[4] = REPLAY_CONTAINER_VERSION + 1;
  const badVersionGz = await compressGzip(badVersionRaw);
  const zipBombGz = await compressGzip(new Uint8Array(120_000));
  const hugeHeader = new Uint8Array(64);
  for (let i = 0; i < 4; i++) hugeHeader[i] = REPLAY_CONTAINER_MAGIC.charCodeAt(i);
  hugeHeader[4] = REPLAY_CONTAINER_VERSION;
  new DataView(hugeHeader.buffer).setUint32(5, 1_000_000);
  const hugeHeaderGz = await compressGzip(hugeHeader);

  const malformedInputs = [
    '[',
    'not json at all',
    JSON.stringify({ kind: 'other', payload: 'abc' }),
    JSON.stringify({ kind: 'flight3d.replay.v1' }),
    JSON.stringify({ kind: 'flight3d.replay.v1', payload: '!!!' }),
    JSON.stringify({ kind: 'flight3d.replay.v1', payload: parsed.track.slice(0, 40) }),
    JSON.stringify({ kind: 'flight3d.sortie.v1' }),
    JSON.stringify({ kind: 'flight3d.sortie.v1', track: '!!!' }),
    JSON.stringify({ kind: 'flight3d.sortie.v1', track: parsed.track.slice(0, 40) }),
    exportedContainer.subarray(0, exportedContainer.length - 6),
    new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    badVersionGz,
    zipBombGz,
    hugeHeaderGz,
    new Blob([new Uint8Array(BUDGET.entryCompressedBytes + 10)], { type: 'application/gzip' }),
  ];

  for (const junk of malformedInputs) {
    const refused = await target.importReplay(junk);
    assert.equal(refused.entry, null, 'malformed replay input must be rejected');
    assert.equal(typeof refused.error, 'string');
    assert.notEqual(refused.error, '');
  }
  assert.equal(target.list().length, 3, 'a failed import must not modify the library');
});

test('the store degrades quietly when the platform has no storage', async () => {
  const store = new ReplayStore(undefined, { budget: BUDGET });
  assert.deepEqual(store.list(), []);
  assert.equal(await store.get('x'), null);
  assert.equal(await store.exportContainer('x'), null);
  assert.equal(await store.exportBlob('x'), null);
  assert.equal(await store.exportJson('x'), null);
  assert.equal(await store.rename('x', 'y'), false);
  assert.equal(await store.remove('x'), false);
  const refused = await store.save(track());
  assert.equal(refused.entry, null);
  assert.equal(refused.error, 'Storage unavailable');
});

test('failed IndexedDB transaction leaves original payloads and entries intact', async () => {
  let rejectWrites = false;
  const idb = createMemoryIndexedDB({
    failOnWrite: () => (rejectWrites ? Object.assign(new Error('disk error'), { name: 'AbortError' }) : null),
  });
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const original = (await store.save(track(20))).entry;
  rejectWrites = true;
  const failed = await store.save(track(40));
  assert.equal(failed.entry, null);
  assert.equal(failed.error, 'disk error');
  assert.deepEqual(store.list().map(row => row.id), [original.id]);
  rejectWrites = false;
  assert.equal((await store.get(original.id)).track.samples.length, 20);
});

test('F16 high fuel flow survives save and .f3dr.gz export/import', async () => {
  const source = track();
  source.metadata.aircraft = 'F16';
  source.samples[0].engine1.ff = 4500;
  source.samples[0].engine2 = { ff: 3900 };
  const store = storeFor();
  const saved = (await store.save(source)).entry;
  assert.equal((await store.get(saved.id)).track.samples[0].engine1.ff, 4500);
  const target = storeFor();
  const imported = (await target.importReplay(await store.exportContainer(saved.id))).entry;
  assert.equal((await target.get(imported.id)).track.samples[0].engine1.ff, 4500);
  assert.equal((await target.get(imported.id)).track.samples[0].engine2.ff, 3900);
});

test('saveAuto keeps exactly one latest-flight entry, replacing the previous one', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const first = (await store.saveAuto(track(20))).entry;
  assert.equal(first.label, AUTO_SAVE_LABEL);
  assert.equal(first.auto, true);

  const second = (await store.saveAuto(track(30))).entry;
  assert.equal(second.auto, true);
  assert.deepEqual(store.list().map(row => row.id), [second.id]);
  assert.equal((await store.get(second.id)).track.samples.length, 30);
  assert.equal(getIdbPayload(idb, first.id), null, 'the replaced auto payload must be dropped');
  assert.equal(await store.get(first.id), null);
});

test('room and legacy solo auto slots replace independently without evicting an extra save', async () => {
  const store = storeFor();
  const manual = (await store.save(track(), { label: 'Keep' })).entry;
  const solo = (await store.saveAuto(track())).entry;
  const first = (await store.saveRoomAuto(track())).entry;
  const next = (await store.saveRoomAuto(track(24))).entry;
  assert.equal(next.label, ROOM_AUTO_SAVE_LABEL);
  assert.equal(store.list().length, 3);
  assert.ok(await store.get(manual.id));
  assert.ok(await store.get(solo.id));
  assert.equal(await store.get(first.id), null);
  const newSolo = (await store.saveAuto(track(24))).entry;
  assert.ok(await store.get(next.id));
  assert.ok(await store.get(manual.id));
  assert.ok(await store.get(newSolo.id));
  assert.equal(await store.get(solo.id), null);
  await store.rename(next.id, 'Keep room');
  assert.equal((await store.get(next.id)).meta.autoSlot, undefined);
  await store.remove(manual.id);
  await store.saveRoomAuto(track());
  assert.ok(await store.get(next.id), 'renamed room is no longer replaced');
});

test('failed room auto replacement restores the old payload and index', async () => {
  let failWrite = false;
  const idb = createMemoryIndexedDB({
    failOnWrite: () => (failWrite ? new Error('index denied') : null),
  });
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const original = (await store.saveRoomAuto(track())).entry;
  failWrite = true;
  assert.equal((await store.saveRoomAuto(track(24))).entry, null);
  failWrite = false;
  assert.equal((await store.get(original.id)).track.samples.length, 20);
});

test('saveAuto refuses an unplayable track without disturbing the kept flight', async () => {
  const idb = createMemoryIndexedDB();
  const store = storeFor(new MockStorage(), BUDGET, { indexedDB: idb });
  const kept = (await store.saveAuto(track())).entry;
  assert.equal((await store.saveAuto(null)).error, 'tooShort');
  assert.equal((await store.saveAuto({ ...track(), overflow: true })).error, 'tooLong');
  assert.deepEqual(store.list().map(row => row.id), [kept.id]);
  assert.equal((await store.get(kept.id)).track.samples.length, 20);
});

test('renaming an auto save promotes it so later flights no longer overwrite it', async () => {
  const store = storeFor();
  const auto = (await store.saveAuto(track(20))).entry;
  assert.equal(await store.rename(auto.id, '  Lukla keep  '), true);
  assert.equal((await store.get(auto.id)).meta.label, 'Lukla keep');
  assert.equal((await store.get(auto.id)).meta.auto, undefined, 'a promoted save is no longer disposable');

  const next = (await store.saveAuto(track(30))).entry;
  assert.notEqual(next.id, auto.id);
  assert.deepEqual(store.list().map(row => row.label).sort(), ['Lukla keep', AUTO_SAVE_LABEL].sort());
  assert.equal((await store.get(auto.id)).track.samples.length, 20, 'the promoted save must survive the next flight');
});

test('an auto save coexists with manual saves in the same library', async () => {
  const store = storeFor();
  const manual = (await store.save(track(24))).entry;
  const auto = (await store.saveAuto(track(20))).entry;
  assert.deepEqual(store.list().map(row => row.id).sort(), [auto.id, manual.id].sort());
  assert.equal((await store.get(manual.id)).meta.auto, undefined);
});

test('extractReportSummary extracts compact stats and skips heavy samples', () => {
  assert.equal(extractReportSummary(null), null);
  assert.equal(extractReportSummary({}), null);

  const fullReport = {
    version: 2,
    reason: 'landed',
    durationSec: 120.5,
    metadata: { aircraft: 'b738', airport: 'incheon', scenario: 'pattern' },
    peaks: {
      gForce: { gForce: 2.148, timeSec: 45.2 },
      altitudeFt: { altitudeFt: 3450.2, timeSec: 60.1 },
      iasKnots: { iasKnots: 275.8, timeSec: 50.0 },
    },
    touchdowns: [{ sinkRateFpm: -130.4, contactG: 1.182 }],
    crash: null,
    samples: new Array(500).fill({ alt: 100 }),
  };

  const summary = extractReportSummary(fullReport);
  assert.deepEqual(summary, {
    reason: 'landed',
    peakG: 2.15,
    peakAltFt: 3450,
    peakIasKnots: 276,
    touchdown: { sinkRateFpm: -130, contactG: 1.18 },
  });
  assert.equal(summary.samples, undefined, 'summary must omit full sample dumps');
});

test('createSortie, createSortieContainer, and createCompressedSortie unify report and binary track', async () => {
  const t = track(30);
  const report = { reason: 'landed', durationSec: 30, metadata: t.metadata };
  const sortie = createSortie(report, t);

  assert.equal(sortie.kind, SORTIE_KIND);
  assert.equal(sortie.report, report);
  assert.equal(typeof sortie.track, 'string');
  assert.equal(decodeTrack(fromBase64(sortie.track)).samples.length, 30);

  const fromStr = createSortie(report, sortie.track);
  assert.equal(fromStr.kind, SORTIE_KIND);
  assert.equal(fromStr.track, sortie.track);
  assert.equal(createSortie(report, null).track, null);
  assert.equal(createSortie(report, { samples: [] }).track, null);
  assert.equal(createSortie(report, { ...t, overflow: true }).track, null);

  const container = createSortieContainer(report, t);
  assert.equal(String.fromCharCode(...container.subarray(0, 4)), REPLAY_CONTAINER_MAGIC);
  const gz = await createCompressedSortie(report, t);
  assert.equal(isGzipBytes(gz), true);
  assert.equal(createSortieContainer(report, null).byteLength > 0, true);
});

test('importJson and .f3dr.gz export preserve full reports and updated labels', async () => {
  const store = storeFor();
  const t = track(35);
  const debriefReport = {
    version: 2,
    reason: 'landed',
    metadata: t.metadata,
    durationSec: t.durationSec,
    peaks: { gForce: { gForce: 2.3 } },
    touchdowns: [{ sinkRateFpm: -140, contactG: 1.25 }],
    samples: [{ t: 0 }, { t: 1 }],
  };
  const sortie = createSortie(debriefReport, t);

  const { entry, error } = await store.importJson(JSON.stringify(sortie));
  assert.equal(error, null);
  assert.ok(entry);
  assert.equal(entry.sampleCount, 35);
  assert.deepEqual(entry.summary, {
    reason: 'landed',
    peakG: 2.3,
    touchdown: { sinkRateFpm: -140, contactG: 1.25 },
  });

  assert.deepEqual((await store.get(entry.id)).report.samples, debriefReport.samples);
  assert.ok(await store.rename(entry.id, 'Coastal Approach'));
  const exported = JSON.parse(await store.exportJson(entry.id));
  assert.equal(exported.kind, SORTIE_KIND);
  assert.equal(exported.report.label, 'Coastal Approach');
  assert.deepEqual(exported.report.samples, debriefReport.samples);
  assert.deepEqual(exported.report.touchdowns, debriefReport.touchdowns);

  // Exporting as .f3dr.gz after rename embeds the updated label and preserves the full report.
  const target = storeFor();
  const reimported = await target.importReplay(await store.exportContainer(entry.id));
  assert.equal(reimported.entry.label, 'Coastal Approach');
  assert.deepEqual((await target.get(reimported.entry.id)).report.samples, debriefReport.samples);
});

test('large full report samples are decimated to fit report and compressed budgets without rejecting a valid track', async () => {
  const store = storeFor(new MockStorage(), {
    entries: 3,
    entryTrackBytes: 6_000,
    entryReportBytes: 6_000,
    entryDecompressedBytes: 12_013,
    entryCompressedBytes: 6_000,
    totalCompressedBytes: 500_000,
    entryBase64Bytes: 8_192,
  });
  const t = track(30);
  const reportSamples = Array.from({ length: 900 }, (_, i) => ({
    timeSec: i * 0.2,
    altitudeFt: 1000 + i,
    iasKnots: 150,
    gForce: i === 250 ? 6.4 : 1.0,
    pitchDeg: 2.0,
    rollDeg: 0,
    headingDeg: 90,
  }));
  const fullReport = {
    version: 2,
    reason: 'landed',
    metadata: t.metadata,
    durationSec: 180,
    peaks: { gForce: reportSamples[250] },
    touchdowns: [{ sinkRateFpm: -120, contactG: 1.15 }],
    samples: reportSamples,
  };
  const { entry, error } = await store.save(t, { report: fullReport });
  assert.equal(error, null);
  assert.ok(entry);
  assert.ok(entry.bytes <= 6_000, `expected <= 6000 compressed bytes, got ${entry.bytes}`);

  const loaded = await store.get(entry.id);
  assert.equal(loaded.track.samples.length, 30);
  assert.equal(loaded.report.samplesDecimatedForBudget, true);
  assert.ok(loaded.report.samples.some(s => s.gForce === 6.4), 'peak-G sample kept');
  assert.equal(loaded.report.samples.at(-1).timeSec, reportSamples.at(-1).timeSec, 'final sample kept');
});

test('localStorage migration transfers sortie, legacy raw base64, and auto entries safely and cleans originals after IDB commit', async () => {
  const storage = new MockStorage();
  const idb = createMemoryIndexedDB();
  const t1 = track(20);
  const t2 = track(25);
  const t3 = track(15);
  const report1 = { label: 'Manual Sortie', reason: 'landed', durationSec: t1.durationSec,
    metadata: t1.metadata, peaks: { gForce: { gForce: 2.1 } }, touchdowns: [], samples: [{ timeSec: 0, altitudeFt: 500 }] };

  const row1 = {
    id: 'legacy-1', savedAt: '2026-01-01T00:00:00.000Z', label: 'Manual Sortie',
    durationSec: t1.durationSec, intervalSec: t1.intervalSec, sampleCount: t1.samples.length,
    bytes: 2000, metadata: t1.metadata, summary: { reason: 'landed', peakG: 2.1 },
  };
  const row2 = {
    id: 'legacy-raw-2', savedAt: '2026-01-02T00:00:00.000Z', label: 'Raw Legacy',
    durationSec: t2.durationSec, intervalSec: t2.intervalSec, sampleCount: t2.samples.length,
    bytes: 2500, metadata: t2.metadata,
  };
  const row3 = {
    id: 'legacy-auto-3', savedAt: '2026-01-03T00:00:00.000Z', label: AUTO_SAVE_LABEL,
    durationSec: t3.durationSec, intervalSec: t3.intervalSec, sampleCount: t3.samples.length,
    bytes: 1500, metadata: t3.metadata, auto: true, autoSlot: 'solo',
  };

  storage.setItem(INDEX_KEY, JSON.stringify([row1, row2, row3]));
  storage.setItem(payloadKey(row1.id), JSON.stringify(createSortie(report1, t1)));
  storage.setItem(payloadKey(row2.id), toBase64(encodeTrack(t2)));
  storage.setItem(payloadKey(row3.id), JSON.stringify(createSortie({ label: AUTO_SAVE_LABEL }, t3)));

  const store = storeFor(storage, { ...BUDGET, entries: 8 }, { indexedDB: idb });
  const migration = await store.ready();
  assert.equal(migration.migrated, 3);
  assert.equal(migration.error, null);
  assert.equal(storage.getItem(INDEX_KEY), null, 'legacy index must be cleared once all rows migrate');
  for (const id of [row1.id, row2.id, row3.id]) {
    assert.equal(storage.getItem(payloadKey(id)), null, `legacy payload ${id} must be deleted after IDB commit`);
    assert.ok(getIdbPayload(idb, id), `migrated payload ${id} must exist in IDB`);
  }
  assert.equal(store.list().length, 3);
  const loaded1 = await store.get(row1.id);
  assert.equal(loaded1.meta.label, 'Manual Sortie');
  assert.deepEqual(loaded1.report.samples, report1.samples);
  assert.equal((await store.get(row2.id)).track.samples.length, 25);
  assert.equal((await store.get(row3.id)).meta.auto, true);
});

test('failed or interrupted localStorage migration preserves originals and retries cleanly without duplicates', async () => {
  const storage = new MockStorage();
  const t1 = track(20);
  const t2 = track(24);
  const t3 = track(28);
  const rows = [
    { id: 'mig-1', savedAt: '2026-01-01T00:00:00.000Z', label: 'First', durationSec: t1.durationSec,
      intervalSec: 0.2, sampleCount: 20, bytes: 2000, metadata: t1.metadata },
    { id: 'mig-2', savedAt: '2026-01-02T00:00:00.000Z', label: 'Second', durationSec: t2.durationSec,
      intervalSec: 0.2, sampleCount: 24, bytes: 2400, metadata: t2.metadata },
    { id: 'mig-3', savedAt: '2026-01-03T00:00:00.000Z', label: 'Third', durationSec: t3.durationSec,
      intervalSec: 0.2, sampleCount: 28, bytes: 2800, metadata: t3.metadata },
  ];
  storage.setItem(INDEX_KEY, JSON.stringify(rows));
  storage.setItem(payloadKey('mig-1'), JSON.stringify(createSortie({ label: 'First' }, t1)));
  storage.setItem(payloadKey('mig-2'), JSON.stringify(createSortie({ label: 'Second' }, t2)));
  storage.setItem(payloadKey('mig-3'), JSON.stringify(createSortie({ label: 'Third' }, t3)));

  // Simulate interruption: first commit succeeds, second fails in IndexedDB.
  let failSecond = true;
  const idb = createMemoryIndexedDB({
    failOnWrite: op => (failSecond && op.op === 'put' && (op.key === 'mig-2' || op.value?.id === 'mig-2')
      ? Object.assign(new Error('Interrupted write'), { name: 'AbortError' }) : null),
  });
  const store = storeFor(storage, { ...BUDGET, entries: 8 }, { indexedDB: idb });
  const firstAttempt = await store.ready();
  assert.equal(firstAttempt.migrated, 1);
  assert.equal(firstAttempt.remaining, 2);
  assert.ok(firstAttempt.error);

  // mig-1 migrated and was cleaned up; mig-2 and mig-3 originals remain untouched in localStorage.
  assert.equal(storage.getItem(payloadKey('mig-1')), null);
  assert.ok(storage.getItem(payloadKey('mig-2')));
  assert.ok(storage.getItem(payloadKey('mig-3')));
  assert.deepEqual(JSON.parse(storage.getItem(INDEX_KEY)).map(r => r.id), ['mig-2', 'mig-3']);

  // Also simulate an interrupted cleanup where mig-1 was left in localStorage despite already being in IDB.
  storage.setItem(INDEX_KEY, JSON.stringify(rows));
  storage.setItem(payloadKey('mig-1'), JSON.stringify(createSortie({ label: 'First' }, t1)));

  // Retry after failure clears: should finish mig-2 and mig-3 without duplicating mig-1.
  failSecond = false;
  const retryStore = storeFor(storage, { ...BUDGET, entries: 8 }, { indexedDB: idb });
  const retryResult = await retryStore.ready();
  assert.equal(retryResult.error, null);
  assert.equal(retryResult.migrated, 2);
  assert.equal(retryStore.list().length, 3, 'retry must not duplicate already-migrated entries');
  assert.deepEqual(retryStore.list().map(r => r.id).sort(), ['mig-1', 'mig-2', 'mig-3']);
  assert.equal(storage.getItem(INDEX_KEY), null);
  for (const id of ['mig-1', 'mig-2', 'mig-3']) assert.equal(storage.getItem(payloadKey(id)), null);
});

test('exported file size comparison across representative synthetic solo, combat, and multiplayer fixtures', async () => {
  const encoder = new TextEncoder();
  const buildReport = (samplesCount, metadata) => ({
    version: 2,
    reason: 'landed',
    durationSec: (samplesCount - 1) * 0.2,
    metadata,
    peaks: {
      gForce: { timeSec: 12, altitudeFt: 6200, iasKnots: 260, gForce: 2.8 },
      altitudeFt: { timeSec: 20, altitudeFt: 6400, iasKnots: 255, gForce: 1.1 },
      iasKnots: { timeSec: 12, altitudeFt: 6200, iasKnots: 260, gForce: 2.8 },
    },
    touchdowns: [{ timeSec: (samplesCount - 1) * 0.2 - 4, sinkRateFpm: -145, contactG: 1.22 }],
    crash: null,
    samples: Array.from({ length: samplesCount }, (_, i) => {
      const s = sample(i * 0.2, i);
      return {
        timeSec: Number(s.timeSec.toFixed(2)),
        x: Number(s.x.toFixed(2)),
        z: Number(s.z.toFixed(2)),
        altitudeFt: Number((s.y * 3.28084).toFixed(1)),
        iasKnots: Number(s.iasKnots.toFixed(1)),
        gForce: Number(s.gForce.toFixed(3)),
        pitchDeg: Number(s.pitchDeg.toFixed(2)),
        rollDeg: Number(s.rollDeg.toFixed(2)),
        headingDeg: Number(s.headingDeg.toFixed(2)),
      };
    }),
  });

  // Synthetic solo fixture: 180s B738 coastal approach at 5 Hz (900 samples + 900 debrief samples)
  const soloTrack = track(900, 0.2);
  const soloReport = buildReport(900, soloTrack.metadata);

  // Synthetic combat fixture: 120s F16 engagement at 5 Hz (600 poses, 240 2-bandit 2Hz, 300 20Hz missile, 75 5Hz diag, 18 events)
  const combatTrack = track(600, 0.2);
  combatTrack.metadata = { airport: 'coastal', aircraft: 'F16', scenario: 'combat' };
  combatTrack.combat = {
    version: 8,
    banditIntervalSec: 0.5,
    missileIntervalSec: 0.05,
    diagnosticIntervalSec: 0.2,
    targets: [{ id: 1, callsign: 'BANDIT 1' }, { id: 2, callsign: 'BANDIT 2' }],
    banditSamples: Array.from({ length: 240 }, (_, i) => ({
      timeSec: i * 0.5,
      rails: 0x3f - (i > 40 ? 1 : 0),
      targets: [
        { x: 3000 + i * 25, y: 3100 + Math.sin(i * 0.2) * 80, z: -6000 + i * 18,
          headingRad: (i * 0.05) % 3, alive: i < 180, damage: i > 120 ? 0.5 : 0, damageZones: { fuselage: i > 120 ? 0.4 : 0 } },
        { x: -2500 - i * 19, y: 3400 + Math.cos(i * 0.15) * 60, z: -5200 + i * 22,
          headingRad: (-i * 0.04) % 3, alive: true, damage: 0, damageZones: {} },
      ],
    })),
    missileSamples: Array.from({ length: 300 }, (_, i) => ({
      timeSec: 20 + i * 0.05,
      id: 1,
      typeId: 'AIM9X',
      x: 500 + i * 14.5,
      y: 3000 + Math.sin(i * 0.1) * 40,
      z: -1000 - i * 18.2,
      quat: sample(0, i).quat,
      powered: i < 140,
    })),
    diagnosticSamples: Array.from({ length: 75 }, (_, i) => ({
      timeSec: 20 + i * 0.2,
      missileId: 1,
      guidanceActive: i < 70,
      powered: i < 35,
      tracking: i < 72,
      guidanceCutoffReason: 'none',
      seekerState: 'track',
      seekerLossReason: 'none',
      speedMps: 680 - i * 2.1,
      altitudeM: 3000 + i * 3,
      dynamicPressurePa: 45000 - i * 150,
      requestedLateralG: 12.5,
      availableLateralG: 24.0,
      deliveredLateralG: 12.4,
      maneuverDragN: 820,
      baseDragN: 410,
      propellant: Math.max(0, 1 - i / 35),
      signalQuality: 0.92,
      targetRangeM: Math.max(15, 5000 - i * 65),
    })),
    events: Array.from({ length: 18 }, (_, i) => ({
      timeSec: 20 + i * 0.8,
      kind: i === 0 ? 'launch' : i === 17 ? 'kill' : i % 3 === 0 ? 'seeker_state' : 'damage',
      missileId: 1,
      targetId: 1,
      locked: true,
      state: 'track',
      lossReason: 'none',
      hitZone: 'wingL',
      amount: 0.35,
      damage: 0.35,
      x: 1000 + i * 80,
      y: 3050,
      z: -2500 - i * 70,
    })),
  };
  const combatReport = buildReport(600, combatTrack.metadata);

  // Synthetic multiplayer room fixture: 180s 2-pilot C172 room at 5 Hz (900 local + 900 remote frames + 12 timeline states)
  const roomTrack = {
    intervalSec: 0.2,
    durationSec: 179.8,
    overflow: false,
    metadata: {
      airport: 'coastal', aircraft: 'C172', scenario: 'cruise',
      room: {
        code: 'ROOM42', rounds: 2, endReason: 'left', partial: false, sessionDurationSec: 179.8, startOffsetSec: 0,
        local: { name: 'Lead', slot: 0, aircraft: 'C172' },
        timeline: Array.from({ length: 12 }, (_, i) => ({
          timeSec: i * 15,
          states: [
            { visible: true, held: i === 4, crashed: i === 7, stale: false, segment: i >= 8 ? 1 : 0 },
            { visible: i !== 5, held: false, crashed: false, stale: i === 5, segment: 0 },
          ],
        })),
      },
    },
    samples: Array.from({ length: 900 }, (_, i) => ({ ...sample(i * 0.2, i), segment: i >= 525 ? 1 : 0 })),
    remotes: [{
      name: 'Wing', slot: 1, aircraft: 'C172',
      samples: Array.from({ length: 900 }, (_, i) => {
        const s = sample(i * 0.2, i + 50);
        return {
          timeSec: i * 0.2, x: s.x + 120, y: s.y + 15, z: s.z - 80, quat: s.quat,
          gearState: 1, flapDegree: 0, visible: true, crashed: false, held: false, stale: false, segment: 0,
        };
      }),
    }],
  };
  const roomReport = {
    label: 'C172 · coastal · cruise',
    durationSec: roomTrack.durationSec,
    metadata: roomTrack.metadata,
  };

  const results = [];
  for (const [name, rep, trk] of [
    ['solo-180s (synthetic)', soloReport, soloTrack],
    ['combat-120s (synthetic)', combatReport, combatTrack],
    ['multiplayer-180s (synthetic)', roomReport, roomTrack],
  ]) {
    const sortie = createSortie({ ...rep }, trk);
    const compactJsonBytes = encoder.encode(JSON.stringify(sortie)).byteLength;
    const prettyJsonBytes = encoder.encode(JSON.stringify(sortie, null, 2)).byteLength;
    const compactJsonGzBytes = (await compressGzip(encoder.encode(JSON.stringify(sortie)))).byteLength;
    const prettyJsonGzBytes = (await compressGzip(encoder.encode(JSON.stringify(sortie, null, 2)))).byteLength;
    const containerBytes = createSortieContainer({ ...rep }, trk);
    const containerGzBytes = (await createCompressedSortie({ ...rep }, trk)).byteLength;
    assert.ok(containerGzBytes < compactJsonGzBytes, `${name}: .f3dr.gz (${containerGzBytes}) < compact .json.gz (${compactJsonGzBytes})`);
    assert.ok(containerGzBytes < compactJsonBytes, `${name}: .f3dr.gz (${containerGzBytes}) < compact .json (${compactJsonBytes})`);
    results.push({
      fixture: name,
      compactJsonBytes,
      prettyJsonBytes,
      compactJsonGzBytes,
      prettyJsonGzBytes,
      containerBytes: containerBytes.byteLength,
      containerGzBytes,
    });
  }
  console.log('Replay size comparison (bytes):', JSON.stringify(results));
});
