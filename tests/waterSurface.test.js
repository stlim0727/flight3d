import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { Terrain } from '../src/environment/Terrain.js';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';
import { GeneratedValleyTerrain } from '../src/environment/GeneratedValleyTerrain.js';
import { IncheonFlightSurface } from '../src/geospatial/IncheonFlightSurface.js';
import { SihwaRegion } from '../src/geospatial/SihwaRegion.js';
import { hangangIsWater, riverCenter, HANGANG_COURSE } from '../src/config/hangangCourse.js';

const probe = (x, y, z = 0) => ({ pos: new Vector3(x, y, z) });

test('water contact uses each low probe location, not the aircraft center or another probe', () => {
  const detector = new CollisionDetector({ getHeight: () => 0, isWater: x => x > 0 }, null);
  const check = (centerX, probes) => detector.checkWater(new Vector3(centerX, 2, 0), probes, 30, 0);
  assert.equal(check(10, [probe(-10, 0.2), probe(10, 2)]), null);
  assert.deepEqual(check(-10, [probe(-10, 2), probe(10, 0.2)]).point, new Vector3(10, 0.2, 0));
  assert.equal(check(10, [probe(10, 0.51)]), null);
  assert.equal(detector.checkWater(new Vector3(), [probe(10, 0)], 0, 0), null);
  assert.ok(detector.checkWater(new Vector3(), [probe(10, 0)], 0, -2));
  detector.terrain.waterLevel = 20;
  assert.ok(check(10, [probe(10, 20.5)]));
  assert.equal(check(10, [probe(10, 20.51)]), null);
});

test('missing membership never infers water from low ground or the render water object', () => {
  const detector = new CollisionDetector({ getHeight: () => -10 }, null, null, null, { mesh: { visible: true } });
  assert.equal(detector.checkWater(new Vector3(), [probe(0, 0)], 30, 0), null);
});

test('coastal membership follows sea level, while dry terrain types remain dry below zero', () => {
  for (const height of [-10, -0.01, 0, 0.2, 2.5]) {
    assert.equal(Terrain.prototype.isWater.call({ getHeight: () => height }, 0, 0), height < 0);
    assert.equal(LuklaTerrain.prototype.isWater.call({}, 0, 0), false);
    assert.equal(GeneratedValleyTerrain.prototype.isWater.call({}, 0, 0), false);
  }
});

test('Incheon coastline preserves low land and regional triangle membership preserves sea-level land', () => {
  const core = Object.create(IncheonFlightSurface.prototype);
  core.isLand = x => x > 0;
  assert.equal(core.isWater(1, 0), false);
  assert.equal(core.isWater(-1, 0), true);
  const coast = { land: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } };
  const region = new SihwaRegion({ schemaVersion: 1 },
    new Float32Array([7000, 0, 0, 7100, 0, 0, 7000, 0, 100]), new Uint32Array([0, 1, 2]), coast, {});
  core.region = region;
  assert.equal(core.getHeight(7010, 10), 0);
  assert.equal(core.isWater(7010, 10), false);
  assert.equal(core.isWater(7200, 10), true);
  core.region = null;
  assert.equal(core.isWater(7200, 10), true);
  region.geometry.dispose();
});

test('Han River membership excludes its banks and Nodeulseom footprint', () => {
  const z = 100;
  assert.equal(hangangIsWater(riverCenter(z), z), true);
  assert.equal(hangangIsWater(riverCenter(z) + 449, z), true);
  assert.equal(hangangIsWater(riverCenter(z) + 450, z), false);
  const island = HANGANG_COURSE.nodeulseom;
  assert.equal(hangangIsWater(island.x, island.z), false);
  assert.equal(hangangIsWater(island.x + island.bottomRadius + 1, island.z), true);
});
