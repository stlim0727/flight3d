import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AIRPORT_ORIGINS, RUNWAY_THRESHOLDS, realOffsetInIncheonFrame,
  worldPositionToWgs84,
} from '../src/geospatial/airportGeodesy.js';
import { APPROACH_DATA } from '../src/config/approachData.js';
import { REGIONAL_CRUISES, regionalCruiseSpawn } from '../src/config/regionalCruises.js';
import { chartAircraft, insideSoutheastAtlas } from '../src/geospatial/busanChart.js';
import { distanceKm } from '../src/geospatial/airportIndex.js';
import {
  CHART_WATER_ZOOM, chartAircraftMark, chartAirports, chartCenterWaterTiles, chartMetersPerPixel, chartNeedsRecenter,
  chartProjection, chartScaleBar, chartSceneFrame, chartSceneOrigin, chartTileTransform, chartWaterTiles,
  formatChartPosition,
} from '../src/geospatial/regionalChart.js';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';
import { UnifiedWorld } from '../src/world/UnifiedWorld.js';
import { projectToLocal } from '../src/geospatial/incheon.js';
import { PATAGONIA_ORIGIN, patagoniaToWorld } from '../src/geospatial/patagonia.js';
import { applyAirportOverrides } from '../src/config/airportOverrides.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} differs from ${expected}`);
const angleError = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const degrees = radians => (radians * 180 / Math.PI + 360) % 360;

test('prefetch includes the aircraft tile and its nearest neighbour across the date line', () => {
  const center = { latitude: 35, longitude: 179.9999 };
  const { x, y, zoom } = wgs84ToTile(center.latitude, center.longitude, CHART_WATER_ZOOM);
  assert.deepEqual(chartCenterWaterTiles(center), [{ x, y, zoom }, { x: 0, y, zoom }]);
  assert.deepEqual(chartCenterWaterTiles({ latitude: 89, longitude: 7 }), []);
});

const manifest = JSON.parse(readFileSync(new URL('../public/data/airports/manifest.json', import.meta.url)));
function indexAirport(icao) {
  const tileId = manifest.icao[icao];
  const tile = JSON.parse(readFileSync(new URL(`../public/data/airports/${manifest.version}/tiles/${tileId}.json`, import.meta.url)));
  return tile.airports.find(airport => airport.icao === icao);
}

function makeFrame(anchor, customOrigin = null) {
  const world = new UnifiedWorld(anchor);
  world.customOrigin = customOrigin;
  return chartSceneFrame({ activeAirport: anchor, world });
}

test('scene geodesy inverts the frame each real region is drawn in', () => {
  for (const id of ['incheon', 'jeju', 'lukla']) {
    const { x, z } = APPROACH_DATA[id].threshold;
    const position = makeFrame(id).toWgs(x, z);
    assert.ok(distanceKm(position, RUNWAY_THRESHOLDS[id]) * 1000 < 0.01, `${id} threshold`);
    assert.equal(makeFrame(id).origin, AIRPORT_ORIGINS[id]);
  }
  const { x, z } = APPROACH_DATA.incheon.threshold;
  assert.deepEqual(makeFrame('incheon').toWgs(x, z), worldPositionToWgs84('incheon', x, z));
  // The shared Incheon plane is rotated at Lukla; the chart must not use it there.
  const lukla = APPROACH_DATA.lukla.threshold;
  assert.ok(distanceKm(worldPositionToWgs84('lukla', lukla.x, lukla.z), RUNWAY_THRESHOLDS.lukla) * 1000 > 50);

  const jfk = { latitude: 40.6413, longitude: -73.7781 };
  assert.deepEqual(makeFrame('incheon', jfk).toWgs(0, 0), localToWgs84(0, 0, jfk));
});

test('chart is offered in real regions and never in fictional arenas', () => {
  for (const anchor of ['incheon', 'jeju', 'lukla', 'patagonia']) {
    const world = new UnifiedWorld(anchor);
    assert.equal(chartSceneOrigin({ activeAirport: anchor, world }), AIRPORT_ORIGINS[anchor], anchor);
  }
  for (const anchor of ['coastal', 'neon', 'valley']) {
    assert.equal(chartSceneOrigin({ activeAirport: anchor, world: new UnifiedWorld(anchor) }), null, anchor);
  }
  // The generated valley mission keeps the previous real anchor underneath.
  assert.equal(chartSceneOrigin({ activeAirport: 'generated-valley', world: new UnifiedWorld('incheon') }), null);
  const custom = new UnifiedWorld('incheon');
  custom.customOrigin = Object.freeze({ latitude: 40.6413, longitude: -73.7781 });
  assert.equal(chartSceneOrigin({ activeAirport: 'incheon', world: custom }), custom.customOrigin);
  for (const activeAirport of ['coastal', 'neon', 'valley']) {
    assert.equal(chartSceneOrigin({ activeAirport, world: custom }), null);
  }
  assert.equal(chartSceneOrigin({ activeAirport: 'generated-valley', world: custom }), null);
  assert.equal(chartSceneOrigin({ activeAirport: 'incheon' }), null);
});

// World position the streamed surface gives an index coordinate (see externalAirportSurface).
function streamedWorld(point, anchor, customOrigin) {
  if (customOrigin) return wgs84ToLocal(point.latitude, point.longitude, customOrigin);
  const [x, z] = projectToLocal(point.latitude, point.longitude);
  const [ox, oz] = realOffsetInIncheonFrame(anchor);
  return [x - ox, z - oz];
}

const bearingOf = ([ax, as], [bx, bs]) => degrees(Math.atan2(bx - ax, as - bs));

test('aircraft on a scene runway sits on the charted runway with its heading', () => {
  const cases = [
    // [icao, anchor, custom origin, true heading of the scene runway for its first end]
    ['RKSI', 'incheon', null, null],
    ['RKPC', 'jeju', null, null],
    ['VNLK', 'lukla', null, null],
    // A distant map start streams in its own tangent plane at the picked point.
    ['KJFK', 'incheon', { latitude: 40.64, longitude: -73.78 }, null],
  ];
  for (const [icao, anchor, customOrigin] of cases) {
    const frame = makeFrame(anchor, customOrigin);
    const airport = applyAirportOverrides(indexAirport(icao));
    const center = frame.toWgs(...streamedWorld(airport, anchor, customOrigin));
    const projection = chartProjection(center);
    const { runways } = chartAirports([indexAirport(icao)], projection, frame.placeAirport);
    assert.ok(runways.length > 0, icao);
    for (const runway of airport.runways) {
      const [a, b] = runway.ends.map(end => end.physical);
      if (!a || !b) continue;
      const [ax, az] = streamedWorld(a, anchor, customOrigin);
      const [bx, bz] = streamedWorld(b, anchor, customOrigin);
      const mark = chartAircraftMark(projection, frame.toWgs, { x: ax, z: az }, { x: bx - ax, z: bz - az });
      const label = `${icao} ${runway.ends[0].ident}`;
      const drawn = runways.find(r => Math.hypot(r.from[0] - mark.point[0], r.from[1] - mark.point[1]) < 0.5);
      assert.ok(drawn, `${label} start`);
      const end = chartAircraftMark(projection, frame.toWgs, { x: bx, z: bz }, { x: 0, z: 0 }).point;
      assert.ok(Math.hypot(drawn.to[0] - end[0], drawn.to[1] - end[1]) < 0.5, `${label} far end`);
      assert.ok(angleError(degrees(mark.heading), bearingOf(drawn.from, drawn.to)) < 0.05, `${label} heading`);
      // Scene north is chart north: the scene's world heading equals the chart heading.
      const sceneHeading = degrees(Math.atan2(bx - ax, -(bz - az)));
      const tolerance = customOrigin || anchor === 'incheon' || anchor === 'jeju' ? 0.1 : 0.6;
      assert.ok(angleError(degrees(mark.heading), sceneHeading) < tolerance,
        `${label}: chart ${degrees(mark.heading)} vs scene ${sceneHeading}`);
    }
  }
});

test('Lukla and distant starts chart the real runway direction', () => {
  for (const [icao, anchor, customOrigin] of [['VNLK', 'lukla', null], ['KJFK', 'incheon', { latitude: 40.64, longitude: -73.78 }]]) {
    const frame = makeFrame(anchor, customOrigin);
    const indexed = indexAirport(icao);
    const projection = chartProjection(indexed);
    const { runways } = chartAirports([indexed], projection, frame.placeAirport);
    const headings = indexed.runways.map(r => r.ends[0].headingDegT).filter(Number.isFinite);
    assert.ok(runways.length > 0 && headings.length > 0, icao);
    for (const runway of runways) {
      const bearing = bearingOf(runway.from, runway.to);
      const error = Math.min(...headings.flatMap(h => [angleError(bearing, h), angleError(bearing, h + 180)]));
      assert.ok(error < 2, `${icao} charted ${bearing} vs ${headings}`);
    }
  }
});

test('built-in scene thresholds land on the charted runway ends', () => {
  for (const [id, icao] of [['incheon', 'RKSI'], ['jeju', 'RKPC'], ['lukla', 'VNLK']]) {
    const frame = makeFrame(id);
    const projection = chartProjection(RUNWAY_THRESHOLDS[id]);
    const { runways } = chartAirports([indexAirport(icao)], projection, frame.placeAirport);
    const nearest = Math.min(...runways.flatMap(r => [Math.hypot(...r.from), Math.hypot(...r.to)]));
    assert.ok(nearest < 40, `${id} scene threshold is ${nearest.toFixed(1)} m from a charted end`);
  }
});

test('Busan keeps the Southeast atlas in the Incheon plane', () => {
  const spawn = regionalCruiseSpawn(REGIONAL_CRUISES.busan, 'C172');
  const forward = { x: spawn.vx, z: spawn.vz };
  const { toWgs } = makeFrame('incheon');
  assert.deepEqual(chartAircraft(spawn, forward, 0, toWgs), chartAircraft(spawn, forward, 0));
  assert.ok(insideSoutheastAtlas(toWgs(spawn.x, spawn.z)));
  assert.ok(!insideSoutheastAtlas(RUNWAY_THRESHOLDS.incheon));
  assert.ok(!insideSoutheastAtlas(RUNWAY_THRESHOLDS.jeju));
  assert.ok(!insideSoutheastAtlas(null));
});

test('paper scale, re-centring and water tiles cover the unfolded view', () => {
  for (const [width, height] of [[1100, 720], [544, 272], [360, 300]]) {
    const m = chartMetersPerPixel(width, height);
    assert.ok(width * m >= 40000 - 1e-6 && height * m >= 28000 - 1e-6, `${width}x${height}`);
    const projection = chartProjection(RUNWAY_THRESHOLDS.jeju);
    const tiles = chartWaterTiles(projection, width, height, m);
    assert.ok(tiles.length > 0 && tiles.length <= 30, `${tiles.length} tiles`);
    for (const [east, south] of [[0, 0], [-width * m / 2, -height * m / 2], [width * m / 2, height * m / 2]]) {
      const corner = projection.unproject(east, south);
      const tile = wgs84ToTile(corner.latitude, corner.longitude, CHART_WATER_ZOOM);
      assert.ok(tiles.some(t => t.x === tile.x && t.y === tile.y), `corner ${east},${south}`);
    }
    assert.equal(chartNeedsRecenter([0, 0], width, height, m), false);
    assert.equal(chartNeedsRecenter([width * m * 0.3, 0], width, height, m), true);
    assert.equal(chartNeedsRecenter([0, -height * m * 0.3], width, height, m), true);
    assert.equal(chartNeedsRecenter([NaN, 0], width, height, m), true);
  }
});

test('date-line charts wrap adjacent columns and high-latitude sheets bound tile requests', () => {
  for (const latitude of [0, 83]) {
    const tiles = chartWaterTiles(chartProjection({ latitude, longitude: 179.99 }), 800, 500, 56);
    assert.ok(tiles.length > 0 && tiles.length <= 64);
    const columns = new Set(tiles.map(tile => tile.x));
    assert.ok(columns.has(0) && columns.has(2 ** tiles[0].zoom - 1));
    assert.equal(new Set(tiles.map(tile => [tile.x, tile.y].join('/'))).size, tiles.length);
  }
  assert.deepEqual(chartWaterTiles(chartProjection({ latitude: 89.9, longitude: 0 }), 800, 500, 56), []);
});

test('tile transform maps tile units onto the projected corners', () => {
  const projection = chartProjection(RUNWAY_THRESHOLDS.incheon);
  const { x, y } = wgs84ToTile(RUNWAY_THRESHOLDS.incheon.latitude, RUNWAY_THRESHOLDS.incheon.longitude, CHART_WATER_ZOOM);
  const [a, b, c, d, e, f] = chartTileTransform(projection, x, y);
  for (const [u, v, tolerance] of [[0, 0, 1e-6], [1, 0, 1e-6], [0, 1, 1e-6], [1, 1, 40], [0.5, 0.5, 40]]) {
    const expected = projection.project(tileToWgs84(x + u, y + v, CHART_WATER_ZOOM));
    near(a * u + c * v + e, expected[0], tolerance, `east ${u},${v}`);
    near(b * u + d * v + f, expected[1], tolerance, `south ${u},${v}`);
  }
});

test('chart airports skip heliports and runways without both ends', () => {
  const projection = chartProjection({ latitude: 37, longitude: 127 });
  const end = (latitude, longitude) => ({ physical: { latitude, longitude } });
  const { runways, labels } = chartAirports([
    { icao: 'AAAA', type: 'large_airport', latitude: 37, longitude: 127,
      runways: [{ widthM: 45, ends: [end(37, 127), end(37.01, 127)] }, { ends: [end(37, 127), {}] }] },
    { ident: 'BB01', type: 'small_airport', latitude: 37.1, longitude: 127,
      runways: [{ ends: [end(37.1, 127), end(37.1, 127.01)] }] },
    { icao: 'HHHH', type: 'heliport', latitude: 37.2, longitude: 127, runways: [{ ends: [end(37.2, 127), end(37.2, 127.001)] }] },
  ], projection);
  assert.equal(runways.length, 2);
  assert.equal(runways[0].widthM, 45);
  assert.equal(runways[1].widthM, 30);
  assert.deepEqual(labels.map(label => [label.code, label.major]), [['AAAA', true]]);
});

test('scale bar and position read cleanly', () => {
  assert.deepEqual(chartScaleBar(50, 120), { km: 5, pixels: 100 });
  assert.equal(chartScaleBar(200, 120).km, 20);
  assert.equal(chartScaleBar(1, 120).km, 1);
  assert.equal(formatChartPosition({ latitude: 37.4563, longitude: 126.4407 }), '37.46°N 126.44°E');
  assert.equal(formatChartPosition({ latitude: -33.9, longitude: -70.79 }), '33.90°S 70.79°W');
});

test('Patagonia chart frame uses Fitz Roy origin, local geodesy, and valid water tiles', () => {
  const world = new UnifiedWorld('patagonia');
  assert.equal(realOffsetInIncheonFrame('patagonia'), null);
  assert.deepEqual(chartSceneOrigin({ activeAirport: 'patagonia', world }), AIRPORT_ORIGINS.patagonia);
  assert.deepEqual(AIRPORT_ORIGINS.patagonia, { latitude: -49.271278, longitude: -73.043222 });

  const frame = makeFrame('patagonia');
  assert.equal(frame.origin, AIRPORT_ORIGINS.patagonia);

  const originWgs = frame.toWgs(0, 0);
  near(originWgs.latitude, PATAGONIA_ORIGIN.lat, 1e-6, 'Fitz Roy latitude');
  near(originWgs.longitude, PATAGONIA_ORIGIN.lon, 1e-6, 'Fitz Roy longitude');

  // patagoniaToWorld is spherical azimuthal equidistant (R=6378137m) while toWgs
  // inverts the WGS84 ellipsoid ENU plane; over 14.1 km they agree within < 50 m.
  const offsetWgs = frame.toWgs(10000, -10000);
  const roundTrip = patagoniaToWorld(offsetWgs.latitude, offsetWgs.longitude);
  const discrepancyM = Math.hypot(roundTrip.x - 10000, roundTrip.z - (-10000));
  assert.ok(discrepancyM < 50, `14.1 km projection discrepancy ${discrepancyM.toFixed(2)} m`);

  const elCalafate = { latitude: -50.2803, longitude: -72.0531 };
  assert.deepEqual(frame.placeAirport(elCalafate), elCalafate);

  const m = chartMetersPerPixel(1100, 720);
  const tiles = chartWaterTiles(chartProjection(frame.origin), 1100, 720, m);
  assert.ok(tiles.length > 0 && tiles.length <= 64, `${tiles.length} tiles`);
  for (const tile of tiles) {
    assert.ok(Number.isInteger(tile.x) && Number.isInteger(tile.y) && Number.isInteger(tile.zoom));
  }
  const centerTile = wgs84ToTile(PATAGONIA_ORIGIN.lat, PATAGONIA_ORIGIN.lon, tiles[0].zoom);
  assert.ok(tiles.some(t => t.x === centerTile.x && t.y === centerTile.y), 'tiles cover Fitz Roy');
});
