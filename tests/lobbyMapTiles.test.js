import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTileUrl, mapTileZoomFor, tilesForViewBox } from '../src/ui/lobbyMapTiles.js';

test('tile URLs use the Esri street map service', () => {
  assert.match(mapTileUrl(6, 54, 25), /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Street_Map\/MapServer\/tile\/6\/25\/54$/);
  assert.equal(mapTileUrl(6, 54, 25), mapTileUrl(6, 54, 25));
});

test('tile zoom increases as the visible map area shrinks', () => {
  assert.equal(mapTileZoomFor(320), 6);
  assert.equal(mapTileZoomFor(160), 7);
  assert.equal(mapTileZoomFor(80), 8);
  assert.equal(mapTileZoomFor(-1), 6);
});

test('overview tiles cover the map with no invalid geometry', () => {
  const tiles = tilesForViewBox('0 0 320 240');
  assert.ok(tiles.length >= 2, 'overview must span more than one tile');
  for (const tile of tiles) {
    assert.ok(tile.x < 320 && tile.y < 240, 'tile must intersect the map');
    assert.ok(tile.x + tile.width > 0 && tile.y + tile.height > 0, 'tile must intersect the map');
    assert.ok([tile.x, tile.y, tile.width, tile.height].every(Number.isFinite));
    assert.ok(tile.width > 0 && tile.height > 0);
  }

});
test('zoomed tiles use a higher zoom and stay within the requested viewBox', () => {
  const viewBox = [80, 30, 160, 120];
  const tiles = tilesForViewBox(viewBox.join(' '));
  assert.ok(tiles.length > 0);
  for (const tile of tiles) {
    assert.match(tile.url, /World_Street_Map\/MapServer\/tile\/7\/\d+\/\d+$/);
    assert.ok(tile.x < viewBox[0] + viewBox[2] && tile.x + tile.width > viewBox[0]);
    assert.ok(tile.y < viewBox[1] + viewBox[3] && tile.y + tile.height > viewBox[1]);
  }
  assert.deepEqual(tilesForViewBox('0 0 0 240'), []);
  assert.deepEqual(tilesForViewBox('broken'), []);
});
