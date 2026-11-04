import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { createSurfaceModel, surfaceAt, surfaceContact, waterContact } from '../src/physics/SurfaceModel.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { NeonCity } from '../src/environment/NeonCity.js';
import { hangangSurfaceModel, HANGANG_COURSE } from '../src/config/hangangCourse.js';
import { HangangCollision } from '../src/director/HangangCollision.js';
import { SihwaRegion } from '../src/geospatial/SihwaRegion.js';

test('one selector handles dry land, submerged ground, absent ground and elevated water', () => {
  const plane = { type: 'WATER', height: 0 };
  for (const [height, expected] of [[null, 'WATER'], [-10, 'WATER'], [0, 'TERRAIN'], [2, 'TERRAIN']]) {
    const layers = createSurfaceModel(() => height, [plane]);
    assert.equal(surfaceAt(layers, 0, 0).type, expected);
    assert.equal(surfaceAt([...layers].reverse(), 0, 0).type, expected);
  }
  assert.equal(surfaceAt(createSurfaceModel(() => -10), 0, 0).type, 'TERRAIN');
  assert.equal(surfaceAt([], 0, 0), null);
  const lake = createSurfaceModel(() => 98, [{ type: 'WATER', height: 100 }]);
  assert.equal(waterContact(lake, new Vector3(0, 100.5, 0)).type, 'WATER');
  assert.equal(waterContact(lake, new Vector3(0, 100.51, 0)), null);
});

test('high probes never call the geometry sampler, and low probes use their own coordinates', () => {
  let calls = 0;
  const terrain = { getHeight: () => 0,
    surfaceModel: createSurfaceModel(x => { calls++; return x > 0 ? null : 0; }, [{type:'WATER',height:0}]) };
  const detector = new CollisionDetector(terrain, null);
  const p = (x, y) => ({ pos: new Vector3(x, y, 0) });
  const check = probes => detector.checkWater(new Vector3(-20, 2, 0), probes, 30, 0);
  assert.equal(check([p(20, 10)]), null);
  assert.equal(calls, 0);
  assert.equal(check([p(-20, .2), p(20, 10)]), null);
  assert.deepEqual(check([p(-20, 10), p(20, .2)]).point, new Vector3(20, .2, 0));
});

test('Neon dry-ground contact stays TERRAIN through ocean/neon environment switches', () => {
  const city = new NeonCity();
  const ocean = { getHeight: () => -10, surfaceModel: createSurfaceModel(() => -10, [{type:'WATER',height:0}]) };
  const detector = new CollisionDetector(ocean, null);
  detector.loadAircraftConfig({ id: 'C172' });
  const check = () => detector.checkCollision(new Vector3(0,.2,1000), new Quaternion(), new Vector3(30,0,0), 0,0,0);
  for (let i = 0; i < 2; i++) {
    assert.equal(check().type, 'WATER');
    detector.setEnvironment(city.terrain, city.airport, city);
    assert.equal(check().type, 'TERRAIN');
    detector.setEnvironment(ocean, null);
  }
});

test('Han River common model and swept collider agree on bank, island and water types', () => {
  const model = hangangSurfaceModel();
  assert.equal(surfaceContact(model, new Vector3(0, 0, 100)).type, 'WATER');
  assert.equal(surfaceContact(model, new Vector3(460, 1, 100)).type, 'TERRAIN');
  const island = HANGANG_COURSE.nodeulseom;
  assert.equal(surfaceAt(model, island.x, island.z).type, 'TERRAIN');
  const detector = new HangangCollision();
  const water = detector.update(new Vector3(0, 1, 100), new Quaternion());
  assert.equal(water.type, 'WATER');
  assert.equal(detector.update(new Vector3(460, 2, 100), new Quaternion()), water);
  detector.reset();
  assert.equal(detector.update(new Vector3(460, 2, 100), new Quaternion()).type, 'TERRAIN');
});

test('slow water contact is not reclassified as a terrain strike', () => {
  const terrain = { getHeight: () => 0, surfaceModel: createSurfaceModel(() => null, [{type:'WATER',height:0}]) };
  const detector = new CollisionDetector(terrain, { isOnRunway: () => false });
  assert.equal(detector.checkCollision(new Vector3(0,1,0),new Quaternion(),new Vector3(),1,0,0),null);
});

test('regional zero-height triangles remain ground while absent triangles expose water', () => {
  const region = new SihwaRegion({schemaVersion:1}, new Float32Array([0,0,0, 100,0,0, 0,0,100]),
    new Uint32Array([0,1,2]), {land:{type:'Polygon',coordinates:[]}}, {});
  const model = createSurfaceModel((x,z)=>region.sampleSurfaceHeight(x,z), [{type:'WATER',height:0}]);
  assert.equal(surfaceAt(model,10,10).type,'TERRAIN');
  assert.equal(surfaceAt(model,200,200).type,'WATER');
  region.geometry.dispose();
});

test('Han River boundary classification follows the contacting part rather than aircraft centre', () => {
  const detector = new HangangCollision();
  assert.equal(detector.update(new Vector3(449.5,1.85,100),new Quaternion())?.type,'TERRAIN');
  detector.reset();
  assert.equal(detector.update(new Vector3(450.5,1.7,100),new Quaternion())?.type,'WATER');
});
