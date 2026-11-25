import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCoordinates, projectToMap, mapViewBoxFor, fitMapViewBoxToAspect, markerScaleForViewBoxWidth, MAP_WIDTH, MAP_HEIGHT } from '../src/ui/mapBrowser.js';

test('projection covers airports worldwide and keeps south below north', () => {
  const gimpo = projectToMap(37.5583, 126.791);
  const jfk = projectToMap(40.6394, -73.7793);
  const sydney = projectToMap(-33.9399, 151.1753);
  for (const point of [gimpo, jfk, sydney]) {
    assert.ok(point && point.x >= 0 && point.x <= MAP_WIDTH && point.y >= 0 && point.y <= MAP_HEIGHT);
  }
  assert.ok(jfk.x < gimpo.x, 'JFK should be west of Seoul');
  assert.ok(sydney.y > gimpo.y, 'Sydney should be below Seoul');
  assert.equal(projectToMap(NaN, 127), null);
  assert.equal(projectToMap(37, 181), null);
});

test('viewBox centres on a place at a tile zoom level and clamps at world zoom', () => {
  const centre = projectToMap(37.5054, 127.137);
  const centred = mapViewBoxFor(37.5054, 127.137, 6).split(' ').map(Number);
  assert.equal(centred[2], MAP_WIDTH / 64);
  assert.equal(centred[3], MAP_HEIGHT / 64);
  assert.ok(Math.abs(centred[0] + centred[2] / 2 - centre.x) < 1);
  assert.ok(Math.abs(centred[1] + centred[3] / 2 - centre.y) < 1);
  assert.equal(mapViewBoxFor(0, 0, 0), `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
  assert.equal(mapViewBoxFor(NaN, 127), `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
});

test('map clicks convert projected coordinates back to latitude and longitude', () => {
  for (const [latitude, longitude] of [[35.125, 129.5], [40.6394, -73.7793], [-33.9399, 151.1753]]) {
    const { x, y } = projectToMap(latitude, longitude);
    const restored = mapCoordinates(x, y);
    assert.ok(Math.abs(restored.latitude - latitude) < 1e-6);
    assert.ok(Math.abs(restored.longitude - longitude) < 1e-6);
  }
  assert.equal(mapCoordinates(-1, 0), null);
  assert.equal(mapCoordinates(0, NaN), null);
});

test('aspect fitting keeps a square phone map centred and inside bounds', () => {
  assert.equal(
    fitMapViewBoxToAspect(`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`, 4 / 3),
    `0.00 ${((MAP_HEIGHT - MAP_HEIGHT * 3 / 4) / 2).toFixed(2)} ${MAP_WIDTH.toFixed(2)} ${(MAP_HEIGHT * 3 / 4).toFixed(2)}`,
  );
  const square = fitMapViewBoxToAspect('256 384 512 256', 1).split(' ').map(Number);
  assert.ok(Math.abs(square[2] - square[3]) < 0.01, 'viewBox must match the square viewport');
  assert.deepEqual(square.slice(0, 2), [256, 256]);
  assert.ok(square[0] + square[2] <= MAP_WIDTH && square[1] + square[3] <= MAP_HEIGHT);
  assert.equal(fitMapViewBoxToAspect('not a viewBox', 1), 'not a viewBox');
});

test('map markers stay readable and tappable from overview to deep zoom', () => {
  const mapWidthPx = 334;
  const pinUnits = 14;
  const hitUnits = 22;
  for (const viewBoxWidth of [MAP_WIDTH, MAP_WIDTH / 64, MAP_WIDTH / 4096]) {
    const scale = markerScaleForViewBoxWidth(viewBoxWidth);
    const pinPx = scale * pinUnits / viewBoxWidth * mapWidthPx;
    const hitPx = scale * hitUnits / viewBoxWidth * mapWidthPx;
    assert.ok(pinPx > 28 && pinPx < 31, `pin should stay ~29 px at ${viewBoxWidth}`);
    assert.ok(hitPx >= 44, `hit target should stay tappable at ${viewBoxWidth}`);
  }
  assert.ok(markerScaleForViewBoxWidth(NaN) > 0, 'invalid widths must not collapse markers');
});
