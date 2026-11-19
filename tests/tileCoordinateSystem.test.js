import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wgs84ToTile,
  tileToWgs84,
  tileBoundsWgs84,
  wgs84ToLocal,
  localToWgs84,
  tileBoundsLocal,
  tilesForBbox,
} from '../src/geospatial/TileCoordinateSystem.js';

const RKPC_ORIGIN = { latitude: 33.5113, longitude: 126.4930 };

test('wgs84ToTile computes correct tile coordinates for RKPC', () => {
  // Zoom 10 for Jeju Island
  const t10 = wgs84ToTile(RKPC_ORIGIN.latitude, RKPC_ORIGIN.longitude, 10);
  assert.equal(t10.x, 871);
  assert.equal(t10.y, 410);
  assert.equal(t10.zoom, 10);
  assert.ok(t10.fx >= 0 && t10.fx < 1);
  assert.ok(t10.fy >= 0 && t10.fy < 1);

  // Zoom 13 for Airport vicinity
  const t13 = wgs84ToTile(RKPC_ORIGIN.latitude, RKPC_ORIGIN.longitude, 13);
  assert.equal(t13.x, 6974);
  assert.equal(t13.y, 3285);
  assert.equal(t13.zoom, 13);
});

test('wgs84ToTile and tileToWgs84 are exact mathematical inverses', () => {
  const points = [
    { lat: 33.5113, lon: 126.4930 },
    { lat: 37.4691, lon: 126.4506 }, // RKSI
    { lat: 33.3617, lon: 126.5332 }, // Hallasan
    { lat: 0.0, lon: 0.0 }, // Equator & Prime Meridian
    { lat: -33.8688, lon: 151.2093 }, // Sydney (Southern hemisphere)
  ];

  for (const p of points) {
    const tile = wgs84ToTile(p.lat, p.lon, 14);
    const recovered = tileToWgs84(tile.x + tile.fx, tile.y + tile.fy, 14);
    assert.ok(Math.abs(p.lat - recovered.latitude) < 1e-10, `Latitude mismatch for ${p.lat}`);
    assert.ok(Math.abs(p.lon - recovered.longitude) < 1e-10, `Longitude mismatch for ${p.lon}`);
  }
});

test('tileBoundsWgs84 provides correct bounds and center', () => {
  const bounds = tileBoundsWgs84(6974, 3285, 13);
  assert.ok(bounds.nw.latitude > bounds.se.latitude, 'Northwest lat must be higher than southeast lat');
  assert.ok(bounds.nw.longitude < bounds.se.longitude, 'Northwest lon must be lower than southeast lon');

  assert.ok(bounds.center.latitude < bounds.nw.latitude && bounds.center.latitude > bounds.se.latitude);
  assert.ok(bounds.center.longitude > bounds.nw.longitude && bounds.center.longitude < bounds.se.longitude);
});

test('wgs84ToLocal maps origin to (0, 0) and computes metric distances accurately', () => {
  const [x0, z0] = wgs84ToLocal(RKPC_ORIGIN.latitude, RKPC_ORIGIN.longitude, RKPC_ORIGIN);
  assert.ok(Math.abs(x0) < 1e-5, `Origin X should be 0, got ${x0}`);
  assert.ok(Math.abs(z0) < 1e-5, `Origin Z should be 0, got ${z0}`);

  // Hallasan summit (33.3617, 126.5332) is ~3.7 km East, ~16.6 km South
  const [hx, hz] = wgs84ToLocal(33.3617, 126.5332, RKPC_ORIGIN);
  assert.ok(Math.abs(hx - 3741.4) < 10, `Hallasan X should be ~3741m, got ${hx}`);
  assert.ok(Math.abs(hz - 16591.7) < 10, `Hallasan Z should be ~16592m, got ${hz}`);

  // Invert back to WGS84
  const recoveredHallasan = localToWgs84(hx, hz, RKPC_ORIGIN);
  assert.ok(Math.abs(recoveredHallasan.latitude - 33.3617) < 1e-4);
  assert.ok(Math.abs(recoveredHallasan.longitude - 126.5332) < 1e-4);
});

test('tileBoundsLocal computes non-empty metric envelope', () => {
  const localBounds = tileBoundsLocal(6974, 3285, 13, RKPC_ORIGIN);
  assert.ok(localBounds.widthMeters > 3500 && localBounds.widthMeters < 5000, `Tile width should be ~4km, got ${localBounds.widthMeters}`);
  assert.ok(localBounds.heightMeters > 3500 && localBounds.heightMeters < 5000, `Tile height should be ~4km, got ${localBounds.heightMeters}`);
  assert.ok(localBounds.minX < localBounds.maxX);
  assert.ok(localBounds.minZ < localBounds.maxZ);
});

test('tilesForBbox covers Jeju Island extent at Zoom 10', () => {
  // Jeju Island BBox: West 126.1, South 33.15, East 126.98, North 33.6
  const jejuBbox = [126.1, 33.15, 126.98, 33.6];
  const tiles = tilesForBbox(jejuBbox, 10);
  assert.ok(tiles.length >= 4, `Should return at least 4 tiles for Jeju, got ${tiles.length}`);

  // Core tiles must be included
  assert.ok(tiles.some(t => t.x === 871 && t.y === 410));
  assert.ok(tiles.some(t => t.x === 872 && t.y === 410));
  assert.ok(tiles.some(t => t.x === 871 && t.y === 411));
  assert.ok(tiles.some(t => t.x === 872 && t.y === 411));
});

test('Error handling on non-finite coordinates', () => {
  assert.throws(() => wgs84ToTile(NaN, 126.0, 10), /Invalid WGS84/);
  assert.throws(() => tileToWgs84(Infinity, 10, 10), /Invalid tile/);
  assert.throws(() => wgs84ToLocal(33.0, 126.0, null), /Invalid origin/);
  assert.throws(() => localToWgs84(0, 0, undefined), /Invalid origin/);
});
