import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePoseUrlParams } from '../src/config/flightUrls.js';

test('parsePoseUrlParams parses geographic parameters correctly', () => {
  const result = parsePoseUrlParams('?lat=35.1652&lon=128.939&alt=150&heading=354');
  assert.deepEqual(result, {
    lat: 35.1652,
    lon: 128.939,
    x: null,
    z: null,
    alt: 150,
    heading: 354,
    freeze: true,
    camera: 'chase',
  });
});

test('parsePoseUrlParams handles aliases, camera, and explicit freeze=0', () => {
  const result = parsePoseUrlParams('?latitude=37.5&longitude=127.0&altitude=500&hdg=90&freeze=0&camera=cockpit');
  assert.deepEqual(result, {
    lat: 37.5,
    lon: 127.0,
    x: null,
    z: null,
    alt: 500,
    heading: 90,
    freeze: false,
    camera: 'cockpit',
  });
});

test('parsePoseUrlParams parses local x/z coordinates', () => {
  const result = parsePoseUrlParams('?x=160&z=1400&alt=20&heading=353.9');
  assert.deepEqual(result, {
    lat: null,
    lon: null,
    x: 160,
    z: 1400,
    alt: 20,
    heading: 353.9,
    freeze: true,
    camera: 'chase',
  });
});

test('parsePoseUrlParams returns null when required coordinates are missing or invalid', () => {
  assert.equal(parsePoseUrlParams(''), null);
  assert.equal(parsePoseUrlParams('?terrain=coastal'), null);
  assert.equal(parsePoseUrlParams('?lat=120&lon=128'), null); // lat > 90
  assert.equal(parsePoseUrlParams('?lat=35&lon=200'), null); // lon > 180
  assert.equal(parsePoseUrlParams('?lat=abc&lon=128'), null);
});
