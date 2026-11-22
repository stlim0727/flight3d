import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAirportIndexCache } from '../src/geospatial/airportIndex.js';
import {
  externalDestinationTileId,
  isExternalDestination,
  registerExternalDestinations,
} from '../src/config/externalDestinations.js';
import { ExternalAirportStreamer } from '../src/world/ExternalAirportStreamer.js';
import { UnifiedWorld } from '../src/world/UnifiedWorld.js';

function indexData(entries, maps = {}) {
  const baseUrl = `https://idents.test/${Date.now()}-${Math.random()}/data/airports/`;
  const manifest = {
    schemaVersion: 1,
    version: 'v1',
    tileDegrees: 10,
    tiles: Object.fromEntries(entries.map(([tileId]) => [tileId, {}])),
    icao: maps.icao ?? {},
    iata: maps.iata ?? {},
    ident: maps.ident ?? {},
  };
  const files = new Map([[`${baseUrl}manifest.json`, manifest]]);
  for (const [tileId, airports] of entries) {
    files.set(`${baseUrl}v1/tiles/${tileId}.json`, {
      schemaVersion: 1, version: 'v1', tile: tileId, airports,
    });
  }
  const fetchImpl = async url => {
    if (!files.has(url)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files.get(url)), { status: 200 });
  };
  return { baseUrl, fetchImpl, manifest };
}

function streamerFor(world, index, options = {}) {
  const scene = { add() {}, remove() {} };
  return new ExternalAirportStreamer({
    world,
    scene,
    baseUrl: index.baseUrl,
    fetchImpl: index.fetchImpl,
    buildRegion: ({ airport, baseOffset }) => ({
      group: { position: { set() {} }, visible: true },
      terrain: { isLoaded: true, centre: { x: 0, z: 0 } },
      airport,
      baseOffset,
      extent: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      dispose() {},
    }),
    ...options,
  });
}

test('safe ident codes register and reserved or unsafe tokens do not', () => {
  registerExternalDestinations([
    '01A', 'SA34', 'BR-1941', 'US-6882', 'QJP', ' caJ3 ',
    'coastal', 'JEJU', '../etc', 'A/B', 'A_B', '-AB', 'AB-', 'AB--CD', 'ABCDEFGHIJKLM',
  ]);
  for (const code of ['01A', 'SA34', 'BR-1941', 'US-6882', 'QJP', 'CAJ3']) {
    assert.equal(isExternalDestination(code), true, code);
  }
  for (const code of ['coastal', 'JEJU', '../etc', 'A/B', 'A_B', '-AB', 'AB-', 'AB--CD', 'ABCDEFGHIJKLM']) {
    assert.equal(isExternalDestination(code), false, code);
  }
  assert.equal(externalDestinationTileId('01A'), null);
  registerExternalDestinations([{ code: 'br-1941', tileId: '6-34' }]);
  assert.equal(externalDestinationTileId('BR-1941'), '6-34');
  assert.equal(externalDestinationTileId('coastal'), null);
});

test('numeric and hyphenated idents stream and publish UnifiedWorld destination info', async () => {
  clearAirportIndexCache();
  const cases = [
    { code: '01A', tileId: '15-2', latitude: 62.940833, longitude: -152.269722 },
    { code: 'BR-1941', tileId: '6-34', latitude: -20.1, longitude: -50.2 },
  ];
  const index = indexData(cases.map(({ code, tileId, latitude, longitude }) => [
    tileId,
    [{ id: code, ident: code, icao: '', iata: '', name: code, latitude, longitude, elevationM: 0 }],
  ]), { ident: Object.fromEntries(cases.map(({ code, tileId }) => [code, tileId])) });

  for (const { code, tileId } of cases) {
    const world = new UnifiedWorld();
    registerExternalDestinations([{ code, tileId }]);
    assert.equal(externalDestinationTileId(code), tileId);
    const streamer = streamerFor(world, index);
    try {
      assert.equal(await streamer.ensure(code), true, code);
      assert.equal(streamer.statusFor(code).state, 'ready');
      assert.equal(streamer.statusFor(code).loaded, true);
      const info = world.destinationInfo(0, 0, code);
      assert.ok(info, code);
      assert.equal(info.id, code);
      assert.equal(info.target, 'centre');
      assert.ok(Number.isFinite(info.distanceM));
      assert.ok(Array.isArray(world.destinationOffsets.get(code)));
    } finally {
      streamer.dispose();
    }
  }
  clearAirportIndexCache();
});

test('a remembered or explicit tileId resolves an ident/IATA collision deterministically', async () => {
  clearAirportIndexCache();
  const cheongju = {
    id: 'rktu', ident: 'RKTU', icao: 'RKTU', iata: 'CJJ', name: 'Cheongju International',
    latitude: 36.715, longitude: 127.506, elevationM: 60,
  };
  const ellen = {
    id: 'cjj', ident: 'CJJ', icao: '', iata: '', name: 'Ellen Church Field',
    latitude: 39.841, longitude: -75.71, elevationM: 10,
  };
  const index = indexData([
    ['12-30', [cheongju]],
    ['13-8', [ellen]],
  ], { icao: { RKTU: '12-30' }, iata: { CJJ: '12-30' }, ident: { CJJ: '13-8' } });

  registerExternalDestinations([{ code: 'CJJ', tileId: '13-8' }]);
  const rememberedWorld = new UnifiedWorld();
  const remembered = streamerFor(rememberedWorld, index);
  try {
    assert.equal(await remembered.ensure('CJJ'), true);
    assert.equal(rememberedWorld.regions.get('CJJ').airport.id, 'cjj');
  } finally {
    remembered.dispose();
  }

  const explicitWorld = new UnifiedWorld();
  const explicit = streamerFor(explicitWorld, index);
  try {
    assert.equal(await explicit.ensure('CJJ', { tileId: '12-30' }), true);
    assert.equal(explicitWorld.regions.get('CJJ').airport.id, 'rktu');
  } finally {
    explicit.dispose();
  }
  clearAirportIndexCache();
});
