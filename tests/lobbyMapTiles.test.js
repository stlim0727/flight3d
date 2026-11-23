import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTileUrl, mapTileZoomFor, tilesForViewBox } from '../src/ui/lobbyMapTiles.js';

test('tile URLs use the Esri street map service', () => {
  assert.match(mapTileUrl(6, 54, 25), /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Street_Map\/MapServer\/tile\/6\/25\/54$/);
  assert.equal(mapTileUrl(6, 54, 25), mapTileUrl(6, 54, 25));
});

test('tile zoom follows the global viewBox halving level', () => {
  assert.equal(mapTileZoomFor(1024), 0);
  assert.equal(mapTileZoomFor(256), 2);
  assert.equal(mapTileZoomFor(16), 6);
  assert.equal(mapTileZoomFor(-1), 0);
});

test('world overview uses one zoom-zero tile', () => {
  const tiles = tilesForViewBox('0 0 1024 1024');
  assert.equal(tiles.length, 1);
  assert.match(tiles[0].url, /World_Street_Map\/MapServer\/tile\/0\/0\/0$/);
  assert.equal(tiles[0].width, 1024);
  assert.equal(tiles[0].height, 1024);
});

test('zoomed tiles cover the viewBox with valid geometry', () => {
  const viewBox = [256, 384, 16, 16];
  const tiles = tilesForViewBox(viewBox.join(' '));
  assert.ok(tiles.length > 0);
  for (const tile of tiles) {
    assert.match(tile.url, /World_Street_Map\/MapServer\/tile\/6\/\d+\/\d+$/);
    assert.ok(tile.x < viewBox[0] + viewBox[2] && tile.x + tile.width > viewBox[0]);
    assert.ok(tile.y < viewBox[1] + viewBox[3] && tile.y + tile.height > viewBox[1]);
    assert.ok([tile.x, tile.y, tile.width, tile.height].every(Number.isFinite));
  }
  assert.deepEqual(tilesForViewBox('0 0 0 1024'), []);
  assert.deepEqual(tilesForViewBox('broken'), []);
});
