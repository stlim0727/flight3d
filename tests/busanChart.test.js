import assert from 'node:assert/strict';
import test from 'node:test';
import { chartAircraft, chartTilePoint, chartView } from '../src/geospatial/busanChart.js';
import { regionalCruiseSpawn, REGIONAL_CRUISES } from '../src/config/regionalCruises.js';
import { wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

function screen({ transform: [a, b, c, d, x, y] }, [east, south]) {
  return [a * east + c * south + x, b * east + d * south + y];
}

test('Busan spawn and nose use the same local chart frame', () => {
  const spawn = regionalCruiseSpawn(REGIONAL_CRUISES.busan, 'C172');
  const { point, heading } = chartAircraft(spawn, { x: spawn.vx, z: spawn.vz }, 0);
  assert.ok(Math.hypot(...point) < 0.01);
  near(heading * 180 / Math.PI, 67.58, 0.01);
  assert.equal(chartAircraft(spawn, { x: 0, z: 0 }, heading).heading, heading);
});

test('chart rotation preserves scale and covers both Gwangan approaches', () => {
  const center = [4400, -900];
  for (const angle of [0, Math.PI / 2, Math.PI * 3 / 4]) {
    const view = chartView(center, 640, 336, angle);
    const [x, y] = screen(view, center);
    near(x, 320, 1e-8);
    near(y, 168, 1e-8);
    const east = screen(view, [center[0] + 1000, center[1]]);
    near(east[0] - x, Math.cos(angle) * 1000 / view.metersPerPixel, 1e-8);
    near(east[1] - y, -Math.sin(angle) * 1000 / view.metersPerPixel, 1e-8);

    for (const [lat, lon, tileY, e, s] of [
      [35.136391, 129.114404, 3241, 3591.2, 621.6],
      [35.163739, 129.131766, 3240, 5171.7, -2413.3],
    ]) {
      const { x: tx, y: ty, fx, fy } = wgs84ToTile(lat, lon, 13);
      assert.deepEqual([tx, ty], [7034, tileY]);
      assert.ok(view.tiles.some(tile => tile.x === tx && tile.y === ty));
      const point = chartTilePoint(tx + fx, ty + fy);
      near(point[0], e, 0.1);
      near(point[1], s, 0.1);
      const [px, py] = screen(view, point);
      assert.ok(px > 0 && px < 640 && py > 0 && py < 336);
    }
  }
});
