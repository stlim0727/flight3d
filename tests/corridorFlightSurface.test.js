import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CorridorFlightSurface } from '../src/environment/CorridorFlightSurface.js';
import {
  INCHEON_ORIGIN,
  JEJU_ORIGIN,
  CORRIDOR_WAYPOINTS,
  wgs84ToJejuLocal,
} from '../src/geospatial/CorridorCoordinateSystem.js';
import { WaterDitching } from '../src/physics/WaterDitching.js';
import { BODY_SUPPORT_POINTS } from '../src/physics/groundContacts.js';

test('CorridorFlightSurface queries surface elevation continuously across corridor', () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });

  // 1. Jeju Airport (0, 0 in Jeju frame)
  const jejuElev = surface.getHeight(0, 0);
  assert.equal(jejuElev, 36.0, 'Jeju airport runway must be 36.0m');

  // 2. Open Ocean (Yellow Sea at BOPTA)
  const bopta = CORRIDOR_WAYPOINTS.find(w => w.ident === 'BOPTA');
  const [bx, bz] = wgs84ToJejuLocal(bopta.latitude, bopta.longitude);
  const boptaElev = surface.getHeight(bx, bz);
  assert.equal(boptaElev, 0.0, 'Yellow Sea water level at BOPTA must be 0.0m MSL');
  assert.equal(surface.getWaterLevel(bx, bz), 0.0);
  assert.equal(surface.isWater(bx, bz), true);

  // 3. Normal vector over open water must be vertical [0, 1, 0]
  const normal = surface.getNormal(bx, bz);
  assert.ok(Math.abs(normal.x) < 1e-4);
  assert.ok(Math.abs(normal.y - 1.0) < 1e-4);
  assert.ok(Math.abs(normal.z) < 1e-4);

  // 4. Chuja Islands
  const [cx, cz] = wgs84ToJejuLocal(33.9600, 126.3000);
  const chujaElev = surface.getHeight(cx, cz);
  assert.ok(chujaElev > 100 && chujaElev <= 154, `Chuja summit should be ~154m, got ${chujaElev}m`);
  assert.equal(surface.isWater(cx, cz), false);

  // 5. Incheon Airport
  const [ix, iz] = wgs84ToJejuLocal(INCHEON_ORIGIN.latitude, INCHEON_ORIGIN.longitude);
  const incheonElev = surface.getHeight(ix, iz);
  assert.equal(incheonElev, 7.0, 'Incheon airport runway must be 7.0m');
});

test('CorridorFlightSurface integrates seamlessly with WaterDitching along the corridor', async (t) => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const ditching = new WaterDitching();

  const aero = {
    mass: 66000,
    invIxx: 1 / 1650000,
    invIyy: 1 / 3450000,
    invIzz: 1 / 4850000,
    cg: { x: 0, y: 0, z: 0 },
  };

  const testWaypoints = ['BOPTA', 'OLMEN', 'SOSDO', 'DOTOL', 'TAMNA'];

  for (const ident of testWaypoints) {
    await t.test(`permits emergency ditching over ocean at ${ident}`, () => {
      const ditching = new WaterDitching();
      const wpt = CORRIDOR_WAYPOINTS.find(w => w.ident === ident);
      const [wx, wz] = wgs84ToJejuLocal(wpt.latitude, wpt.longitude);

      const mesh = new THREE.Object3D();
      mesh.position.set(wx, 1.0, wz); // Belly 1m above ocean surface (0.0m)
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(4.0)); // 4° pitch up
      mesh.updateMatrixWorld(true);

      const linearVel = new THREE.Vector3(0, -1.2, -65); // 1.2 m/s sink rate, 65 m/s (~126 kt)
      const angularVel = new THREE.Vector3(0, 0, 0);

      const result = ditching.update(
        0.016,
        mesh,
        linearVel,
        angularVel,
        surface,
        aero,
        BODY_SUPPORT_POINTS,
        0.0, // Gear up
        4.0, // Pitch 4 deg
        0.0  // Roll 0 deg
      );

      assert.equal(result.catastrophic, false, `Emergency ditching at ${ident} must not be catastrophic`);
      assert.equal(result.ditchingContact, true, `Water contact initiated at ${ident}`);
      assert.equal(result.onWater, true, `Airframe on water at ${ident}`);
      assert.ok(result.forces.y > 0, `Buoyant normal force must be positive at ${ident}`);
      assert.ok(result.forces.z > 0, `Hydrodynamic drag must oppose forward motion at ${ident}`);
    });
  }

  await t.test('detects catastrophic crash on excessive sink rate over oceanic corridor', () => {
    const ditching = new WaterDitching();
    const sosdo = CORRIDOR_WAYPOINTS.find(w => w.ident === 'SOSDO');
    const [sx, sz] = wgs84ToJejuLocal(sosdo.latitude, sosdo.longitude);

    const mesh = new THREE.Object3D();
    mesh.position.set(sx, 0.5, sz);
    mesh.updateMatrixWorld(true);

    // Hard slam: 6.0 m/s sink rate > 4.5 m/s limit
    const linearVel = new THREE.Vector3(0, -6.0, -70);
    const angularVel = new THREE.Vector3(0, 0, 0);

    const result = ditching.update(
      0.016,
      mesh,
      linearVel,
      angularVel,
      surface,
      aero,
      BODY_SUPPORT_POINTS,
      0.0,
      2.0,
      0.0
    );

    assert.equal(result.catastrophic, true, 'Hard water impact must trigger catastrophic crash');
  });
});

test('CorridorFlightSurface delegates to IncheonFlightSurface using INCHEON_SCENERY_ORIGIN', () => {
  let queriedLocalX = null;
  let queriedLocalZ = null;
  const mockIncheonSurface = {
    getHeight: (x, z) => {
      queriedLocalX = x;
      queriedLocalZ = z;
      return 7.0;
    },
    isOnRunway: (x, z) => true,
    isRunwaySafetyArea: (x, z) => true,
  };

  const surface = new CorridorFlightSurface({
    activeOrigin: JEJU_ORIGIN,
    incheonSurface: mockIncheonSurface,
  });

  // Query Incheon scenery origin in Jeju frame
  const [x, z] = wgs84ToJejuLocal(37.448, 126.455);
  const h = surface.getHeight(x, z);

  assert.equal(h, 7.0);
  assert.ok(Math.abs(queriedLocalX) < 1.0, `Scenery local X must be ~0, got ${queriedLocalX}`);
  assert.ok(Math.abs(queriedLocalZ) < 1.0, `Scenery local Z must be ~0, got ${queriedLocalZ}`);
  assert.equal(surface.isOnRunway(x, z), true);
});

