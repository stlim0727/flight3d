import test from 'node:test';
import assert from 'node:assert/strict';
import { projectToMap, mapViewBoxFor, MAP_WIDTH, MAP_HEIGHT } from '../src/ui/mapBrowser.js';

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
