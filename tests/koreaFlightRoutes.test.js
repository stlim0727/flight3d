import test from 'node:test';
import assert from 'node:assert/strict';
import routeData from '../src/config/koreaFlightRoutes.json' with { type: 'json' };

test('koreaFlightRoutes defines valid Incheon-Jeju flight plan', () => {
  assert.equal(routeData.name, 'RKSI-RKPC');
  assert.equal(routeData.departure.icao, 'RKSI');
  assert.equal(routeData.destination.icao, 'RKPC');
  assert.ok(routeData.distanceKm > 400 && routeData.distanceKm < 500);
  assert.ok(routeData.distanceNm > 200 && routeData.distanceNm < 300);
  assert.equal(routeData.cruiseAltitudeFt, 28000);

  // Waypoints sequential check
  assert.ok(routeData.route.length >= 7);
  assert.equal(routeData.route[0].ident, 'RKSI');
  assert.equal(routeData.route.at(-1).ident, 'RW07');

  // Verify latitude progresses southward from Incheon to Jeju
  for (let i = 1; i < routeData.route.length; i++) {
    const prev = routeData.route[i - 1];
    const curr = routeData.route[i];
    assert.ok(curr.latitude < prev.latitude, `Waypoint ${curr.ident} must be south of ${prev.ident}`);
    assert.ok(Number.isFinite(curr.latitude) && Number.isFinite(curr.longitude));
    assert.ok(curr.altitudeFt >= 0);
  }
});
