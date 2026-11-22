import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCoordinates, projectToMap, mapViewBoxFor, fitMapViewBoxToAspect, MAP_WIDTH, MAP_HEIGHT } from '../src/ui/mapBrowser.js';

test('map projection keeps Korean airports inside the compact SVG', () => {
  const gimpo = projectToMap(37.5583, 126.791);
  const jeju = projectToMap(33.512, 126.493);
  assert.ok(gimpo.x > 0 && gimpo.x < MAP_WIDTH && gimpo.y > 0 && gimpo.y < MAP_HEIGHT);
  assert.ok(jeju.y > gimpo.y, 'Jeju should be lower on the map');
  assert.equal(projectToMap(NaN, 127), null);
  assert.equal(projectToMap(37, 140), null);
});

test('viewBox centres on the selected place and stays clamped', () => {
  const centred = mapViewBoxFor(37.5054, 127.137, 2).split(' ').map(Number);
  assert.equal(centred[2], MAP_WIDTH / 2);
  assert.equal(centred[3], MAP_HEIGHT / 2);
  assert.ok(centred[0] > 0 && centred[0] < MAP_WIDTH / 2);
  assert.equal(centred[1], 0);
  assert.equal(mapViewBoxFor(NaN, 127), `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
});

test('map clicks convert projected coordinates back to latitude and longitude', () => {
  const { x, y } = projectToMap(35.125, 129.5);
  assert.deepEqual(mapCoordinates(x, y), { latitude: 35.125, longitude: 129.5 });
  assert.equal(mapCoordinates(-1, 0), null);
  assert.equal(mapCoordinates(0, NaN), null);
});

test('aspect fitting keeps a square phone map centred and inside bounds', () => {
  assert.equal(fitMapViewBoxToAspect('0 0 320 240', 4 / 3), '0.00 0.00 320.00 240.00');
  const square = fitMapViewBoxToAspect('0 60 320 120', 1).split(' ').map(Number);
  assert.ok(Math.abs(square[2] - square[3]) < 0.01, 'viewBox must match the square viewport');
  assert.equal(square[1], 0);
  assert.ok(square[0] > 0 && square[0] + square[2] <= MAP_WIDTH);
  assert.ok(square[3] <= MAP_HEIGHT);
  assert.equal(fitMapViewBoxToAspect('not a viewBox', 1), 'not a viewBox');
});
