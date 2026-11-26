import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCoordinates, projectToMap, mapViewBoxFor, fitMapViewBoxToAspect, markerScaleForViewBoxWidth, clusterMapPoints, MAP_WIDTH, MAP_HEIGHT } from '../src/ui/mapBrowser.js';

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

test('nearby map points collapse into one cluster that splits when zoomed in', () => {
  const seoul = [
    { x: 871.4, y: 444.2, place: { id: 'RKSI' } },
    { x: 872.2, y: 443.8, place: { id: 'RKSS' } },
  ];
  const distant = { x: 300, y: 420, place: { id: 'KJFK' } };
  const overview = clusterMapPoints([...seoul, distant], MAP_WIDTH);
  assert.equal(overview.length, 2, 'dense pins share a marker while distant pins stay separate');
  assert.deepEqual(overview[0].places.map(place => place.id), ['RKSI', 'RKSS']);
  assert.ok(Math.abs(overview[0].x - (871.4 + 872.2) / 2) < 1e-6, 'cluster sits at the pins’ centre');
  assert.equal(overview[1].places[0].id, 'KJFK');

  const zoomed = clusterMapPoints([...seoul, distant], MAP_WIDTH / 4096);
  assert.equal(zoomed.length, 3, 'the same pins separate once the view is zoomed in');
  assert.equal(clusterMapPoints([{ x: NaN, y: 1, place: {} }, seoul[0]], MAP_WIDTH).length, 1);
});
