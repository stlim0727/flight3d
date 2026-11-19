import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => noop,
    has: () => false,
  });
  globalThis.document = {
    createElement: () => ({ getContext: () => mockCtx, width: 512, height: 512 }),
  };
}

import { APPROACH_DATA, approachDeviation } from '../src/config/approachData.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import jejuMetadata from '../public/scenery/jeju/terrain-metadata.json' with { type: 'json' };

test('APPROACH_DATA.jeju defines Runway 07 geometry and elevation', () => {
  const jeju = APPROACH_DATA.jeju;
  assert.ok(jeju, 'APPROACH_DATA.jeju must be defined');
  assert.equal(jeju.headingDeg, 67);
  assert.equal(jeju.gsAngleDeg, 3.0);
  assert.equal(jeju.elevationFt, 118);
  assert.ok(jeju.threshold && Number.isFinite(jeju.threshold.x) && Number.isFinite(jeju.threshold.z));
  assert.ok(jeju.end && Number.isFinite(jeju.end.x) && Number.isFinite(jeju.end.z));

  // Threshold to end distance should match RW07 length (~3,180 m)
  const length = Math.hypot(jeju.end.x - jeju.threshold.x, jeju.end.z - jeju.threshold.z);
  assert.ok(Math.abs(length - 3180) < 10, `Runway length should be ~3,180 m, got ${length}`);

  // Test approach deviation calculation
  const onCourse = approachDeviation('jeju', { x: jeju.threshold.x, altitudeFt: 118, z: jeju.threshold.z });
  assert.equal(onCourse.courseDeg, 67);
  assert.equal(onCourse.crossTrackM, 0);
  assert.ok(Math.abs(onCourse.distanceToThresholdM) < 0.01);
  assert.ok(Math.abs(onCourse.glideslopeErrorFt) < 0.01);
  assert.ok(Number.isFinite(onCourse.referenceSinkFpm));
});

test('CDUCanvas supports Jeju and Incheon airport waypoint sequencing', () => {
  const cdu = new CDUCanvas();
  cdu.setAirport('jeju');
  assert.equal(cdu.airportId, 'jeju');
  assert.equal(cdu.activeWpt, 'RW07');

  cdu.setAirport('incheon');
  assert.equal(cdu.airportId, 'incheon');
  assert.equal(cdu.activeWpt, 'RW15R');
});

test('NDCanvas renders in Jeju mode without error', () => {
  const nd = new NDCanvas();
  nd.setAirport('jeju');
  assert.equal(nd.airportId, 'jeju');
  assert.doesNotThrow(() => nd.render());
});

test('public/scenery/jeju/terrain-metadata.json contains valid runway and Hallasan specs', () => {
  assert.equal(jejuMetadata.schemaVersion, 1);
  assert.equal(jejuMetadata.origin.latitude, 33.5113);
  assert.equal(jejuMetadata.origin.longitude, 126.4930);
  assert.equal(jejuMetadata.elevationM, 36.0);
  assert.equal(jejuMetadata.hallasan.elevationM, 1947.0);

  // Check runways
  assert.equal(jejuMetadata.runways.length, 2);
  const rw07 = jejuMetadata.runways.find(r => r.id === '07/25');
  assert.ok(rw07);
  assert.equal(rw07.lengthM, 3180);
  assert.equal(rw07.headingDeg, 67);

  const rw13 = jejuMetadata.runways.find(r => r.id === '13/31');
  assert.ok(rw13);
  assert.equal(rw13.lengthM, 1900);
  assert.equal(rw13.headingDeg, 132);
});
