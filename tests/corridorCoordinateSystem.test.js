import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCHEON_ORIGIN,
  JEJU_ORIGIN,
  MEAN_SEA_LEVEL_M,
  CORRIDOR_WAYPOINTS,
  haversineDistanceM,
  incheonLocalToWgs84,
  wgs84ToIncheonLocal,
  jejuLocalToWgs84,
  wgs84ToJejuLocal,
  incheonToJejuLocal,
  jejuToIncheonLocal,
  getCorridorDistanceM,
  interpolateRoute,
  projectPointOnRoute,
  getCorridorBbox,
} from '../src/geospatial/CorridorCoordinateSystem.js';

test('CorridorCoordinateSystem verifies elevation standards', () => {
  assert.equal(INCHEON_ORIGIN.elevationM, 7.0, 'Incheon elevation must be 7.0m MSL');
  assert.equal(JEJU_ORIGIN.elevationM, 36.0, 'Jeju elevation must be 36.0m MSL');
  assert.equal(MEAN_SEA_LEVEL_M, 0.0, 'Mean sea level must be 0.0m MSL');
});

test('CorridorCoordinateSystem verifies total route distance', () => {
  const totalMeters = getCorridorDistanceM();
  const totalKm = totalMeters / 1000;
  // Route is 451.2km
  assert.ok(Math.abs(totalKm - 451.2) < 20, `Route distance should be ~451km, got ${totalKm.toFixed(1)}km`);
});

test('CorridorCoordinateSystem maps Incheon and Jeju origins with sub-meter roundtrip accuracy', () => {
  // Incheon origin in Incheon local frame is (0, 0)
  const [ix0, iz0] = wgs84ToIncheonLocal(INCHEON_ORIGIN.latitude, INCHEON_ORIGIN.longitude);
  assert.ok(Math.abs(ix0) < 1e-4);
  assert.ok(Math.abs(iz0) < 1e-4);

  // Jeju origin in Jeju local frame is (0, 0)
  const [jx0, jz0] = wgs84ToJejuLocal(JEJU_ORIGIN.latitude, JEJU_ORIGIN.longitude);
  assert.ok(Math.abs(jx0) < 1e-4);
  assert.ok(Math.abs(jz0) < 1e-4);

  // Roundtrip Incheon <-> Jeju local frames
  const ptInIncheon = [2500, 150000]; // 150km south of Incheon
  const inJeju = incheonToJejuLocal(ptInIncheon[0], ptInIncheon[1]);
  const backToIncheon = jejuToIncheonLocal(inJeju[0], inJeju[1]);

  const errorM = Math.hypot(ptInIncheon[0] - backToIncheon[0], ptInIncheon[1] - backToIncheon[1]);
  assert.ok(errorM < 0.01, `Roundtrip local coordinate error should be < 0.01m, got ${errorM}m`);
});

test('CorridorCoordinateSystem interpolates flight states accurately along 451.2km corridor', () => {
  // At progress 0.0 -> RKSI
  const start = interpolateRoute(0.0);
  assert.ok(Math.abs(start.latitude - INCHEON_ORIGIN.latitude) < 0.01);
  assert.ok(Math.abs(start.longitude - INCHEON_ORIGIN.longitude) < 0.01);
  assert.equal(start.altitudeFt, 23);

  // At progress 1.0 -> RW07 (Jeju)
  const end = interpolateRoute(1.0);
  assert.ok(Math.abs(end.latitude - JEJU_ORIGIN.latitude) < 0.01);
  assert.ok(Math.abs(end.longitude - JEJU_ORIGIN.longitude) < 0.01);
  assert.equal(end.altitudeFt, 118);

  // Mid-route cruise (progress 0.5)
  const mid = interpolateRoute(0.5);
  assert.ok(mid.latitude > JEJU_ORIGIN.latitude && mid.latitude < INCHEON_ORIGIN.latitude);
  assert.ok(mid.altitudeFt >= 20000, `Mid-route altitude should be cruise >= 20,000ft, got ${mid.altitudeFt}`);
  assert.ok(mid.headingDeg >= 150 && mid.headingDeg <= 230, `Southbound heading expected, got ${mid.headingDeg}`);
});

test('CorridorCoordinateSystem projects points onto corridor', () => {
  // BOPTA fix
  const bopta = CORRIDOR_WAYPOINTS.find(w => w.ident === 'BOPTA');
  const proj = projectPointOnRoute(bopta.latitude, bopta.longitude);
  assert.ok(proj.crossTrackDistanceM < 10, 'On-route waypoint cross track distance must be ~0');
  assert.ok(proj.distanceAlongRouteM > 80000 && proj.distanceAlongRouteM < 120000);
});

test('CorridorCoordinateSystem provides valid corridor bounding box', () => {
  const bbox = getCorridorBbox(0.5);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  assert.ok(minLon < 126.0 && maxLon > 126.5);
  assert.ok(minLat < 33.5 && maxLat > 37.5);
});
