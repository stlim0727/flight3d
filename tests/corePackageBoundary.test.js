import test from 'node:test';
import assert from 'node:assert/strict';
import * as packageApi from '@stlim0727/flightsim-core';
import { FlightPhysicsCore } from '../src/physics/FlightPhysicsCore.js';
import { FlightControlLaws } from '../src/controls/FlightControlLaws.js';
import { FlightWarningsCore } from '../src/systems/FlightWarningsCore.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';
import { AutopilotController } from '../src/physics/Autopilot.js';
import { approachDeviation } from '../src/config/approachData.js';
import {
  analyticTerrainProvider,
  assertTerrainProviderContract,
  createGroundHeightQuery,
  createGroundSurfaceQueries,
  resolveGroundHeight,
  toNormalVector3,
} from '../src/environment/TerrainProvider.js';

test('compatibility imports share package classes, terrain helpers, and aircraft configuration instances', () => {
  assert.equal(FlightPhysicsCore, packageApi.FlightPhysicsCore);
  assert.equal(FlightControlLaws, packageApi.FlightControlLaws);
  assert.equal(FlightWarningsCore, packageApi.FlightWarningsCore);
  assert.deepEqual(Object.keys(AIRCRAFT_REGISTRY), ['B738', 'F16', 'C172']);
  for (const id of Object.keys(AIRCRAFT_REGISTRY)) {
    assert.equal(AIRCRAFT_REGISTRY[id], packageApi.AIRCRAFT_REGISTRY[id]);
  }
  assert.equal(analyticTerrainProvider, packageApi.analyticTerrainProvider);
  assert.equal(assertTerrainProviderContract, packageApi.assertTerrainProviderContract);
  assert.equal(createGroundHeightQuery, packageApi.createGroundHeightQuery);
  assert.equal(createGroundSurfaceQueries, packageApi.createGroundSurfaceQueries);
  assert.equal(resolveGroundHeight, packageApi.resolveGroundHeight);
  assert.equal(toNormalVector3, packageApi.toNormalVector3);
});

test('Flight3d supplies navigation while independent core accepts caller-owned approaches', () => {
  const state = { airportKey: 'coastal', x: -4350, z: 0, altitudeFt: 554.8,
    headingDeg: 90, rollDeg: 0, pitchDeg: 0, vsiFpm: -700, iasKnots: 145,
    tasKnots: 145, throttle: 0.5 };
  const local = new AutopilotController();
  assert.ok(local instanceof packageApi.AutopilotController);
  assert.equal(local.approachDeviation, approachDeviation);
  local.engage('APP', state);
  assert.equal(local.lateralMode, 'APP');

  const independent = new packageApi.AutopilotController();
  independent.engage('APP', state);
  assert.equal(independent.appArmed, true);
  const customNavigation = () => null;
  const overridden = new AutopilotController({ approachDeviation: customNavigation });
  assert.equal(overridden.approachDeviation, customNavigation);
  overridden.engage('APP', state);
  assert.equal(overridden.appArmed, true);
});
