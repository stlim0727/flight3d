// Neon Metropolis demos flown end to end in the headless production physics with the
// Neon towers and bridges in the collision detector (#697): the urban wind the lobby
// installs, and the still-air control with the field removed after every demo preset.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { stepPhysics } from '../src/core/physicsTiming.js';
import { NeonCity } from '../src/environment/NeonCity.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { demoProfiles, resolveDemoProfile } from '../src/director/demoProfiles.js';
import { isScenarioAvailable } from '../src/config/scenarioRegistry.js';
import { UrbanWindField } from '../src/physics/UrbanWindField.js';
import { setSimulationWind } from '../src/physics/WindField.js';
import {
  cityRoute, climbOutClearance, collisionBuildings, CITY_ROUTE_CENTERS,
} from '../src/director/scenarios/cessnaRoutes.js';

const city = new NeonCity();

function fly(aircraft, profile, wind) {
  const sim = createHeadlessSimulation({ aircraftId: aircraft, airportId: 'neon', terrain: city.terrain, airport: city.airport });
  sim.collisionDetector.setEnvironment(city.terrain, city.airport, city);
  sim.tireSmokeSystem.emitSmokeBurst ??= () => {};
  Object.assign(sim.cameraSystem, { setMode: () => true, resetDroneOrbit() {} });
  if (!wind) {
    const setPreset = sim.setPreset.bind(sim);
    sim.setPreset = (...args) => { const result = setPreset(...args); setSimulationWind(sim); return result; };
  }
  const director = new DemoFlightDirector(sim);
  sim.demoDirector = director;
  assert.notEqual(director.start('neon', profile), false, `${aircraft}/${profile} starts`);
  assert.equal(director.profile, profile);
  assert.equal(sim.windField instanceof UrbanWindField, wind, `${aircraft}/${profile} wind ${wind}`);
  let seconds = 0;
  while (seconds < 300 && director.isActive && !sim.isCrashed) { stepPhysics(sim); seconds += sim.physicsDt; }
  const result = director.getActiveScenario().result;
  assert.equal(sim.isCrashed, false, `${aircraft}/${profile} wind ${wind}: ${sim.crashResult?.description}`);
  assert.equal(director.isActive, false, `${aircraft}/${profile} still active at ${seconds.toFixed(1)} s`);
  assert.equal(result.status, 'completed', `${aircraft}/${profile} wind ${wind}: ${JSON.stringify(result)}`);
  assert.deepEqual(sim.gear.contacts.map(contact => contact.damageState), sim.gear.contacts.map(() => 'normal'));
  return { sim, director, result, seconds };
}

describe('Neon Metropolis demos', () => {
  it('offers the Neon demos in the lobby, without the coastal-only montage and landing', () => {
    assert.equal(isScenarioAvailable('neon', 'demo'), true);
    assert.deepEqual(demoProfiles('C172', 'neon').map(p => p.id), ['scenic', 'maneuvers']);
    assert.equal(demoProfiles('C172', 'neon')[0].labelKey, 'demo.c172.city');
    assert.deepEqual(demoProfiles('B738', 'neon').map(p => p.id), ['neon-departure']);
    assert.equal(resolveDemoProfile('B738', 'neon', 'classic').id, 'neon-departure');
    assert.deepEqual(demoProfiles('B738', 'coastal').map(p => p.id), ['classic']);
    assert.deepEqual(demoProfiles('F16', 'neon'), []);
  });

  it('plans city routes against the buildings the collision detector tests', () => {
    const neon = [{ x: 1, z: 1 }], hidden = [{ x: 2, z: 2 }];
    assert.equal(collisionBuildings({ collisionDetector: { foliage: { buildingData: neon } }, foliage: { buildingData: hidden } }), neon);
    assert.deepEqual(collisionBuildings({ collisionDetector: { foliage: null }, foliage: { buildingData: hidden } }), []);
    assert.equal(collisionBuildings({ foliage: { buildingData: hidden } }), hidden);
    assert.deepEqual(collisionBuildings({}), []);
  });

  it('checks the climb-out beyond the pass with the altitude it has gained', () => {
    const end = { x: 0, z: 0 }, east = { x: 1, z: 0 };
    const tower = (x, z, height) => ({ x, z, y: 0, height, width: 20, depth: 20 });
    assert.ok(climbOutClearance(end, east, 50, [tower(800, 0, 300)]) < 0, 'tower on the climb-out line');
    assert.ok(climbOutClearance(end, east, 50, [tower(800, 200, 300)]) > 150, 'tower beside the line');
    // 1,500 m out the climb is planned 120 m higher, so a 140 m block there only counts
    // from the lower segments before it, 100 m short of it.
    assert.ok(climbOutClearance(end, east, 50, [tower(1500, 0, 140)]) >= 40);
    assert.ok(climbOutClearance(end, east, 50, [tower(300, 0, 140)]) < 0);
  });

  it('routes the Cessna city pass through Neon streets clear of every tower to the end of its climb-out', () => {
    const route = cityRoute(city.terrain, city.buildingData, { centers: CITY_ROUTE_CENTERS.neon });
    assert.ok(route.clearance >= 40, `corridor clearance ${route.clearance}`);
    const end = { x: route.start.x + route.direction.x * route.length, z: route.start.z + route.direction.z * route.length };
    assert.ok(climbOutClearance(end, route.direction, route.altitude, city.buildingData) >= 40);
    // Towers stand on both sides of the pass: it is a street, not the shoreline.
    assert.ok(route.score >= 40, `score ${route.score}`);
  });

  for (const wind of [true, false]) {
    const label = wind ? 'urban wind' : 'still air';

    it(`flies the C172 city pass to completion in ${label}`, () => {
      const { result } = fly('C172', 'scenic', wind);
      assert.ok(result.minClearanceM >= 45, `clearance ${result.minClearanceM}`);
    });

    it(`flies the C172 manoeuvres above the Neon skyline in ${label}`, () => {
      const { result } = fly('C172', 'maneuvers', wind);
      const skyline = Math.max(...city.buildingData.map(b => b.y + b.height));
      assert.ok(result.minClearanceM > skyline, `clearance ${result.minClearanceM} vs skyline ${skyline}`);
    });

    it(`departs the B738 along the runway and canyon line to the skyline altitude in ${label}`, () => {
      const { sim, result } = fly('B738', 'neon-departure', wind);
      assert.equal(result.airborne, true);
      assert.ok(result.liftoffX < 150, `lifts off ${result.liftoffX} before the island`);
      assert.ok(result.maxCenterlineM < 8, `takeoff roll ${result.maxCenterlineM} m off the centreline`);
      assert.ok(result.maxAirborneLineM < 15, `climb ${result.maxAirborneLineM} m off the canyon line`);
      assert.ok(sim.position.y >= 760 && sim.position.x > 4000);
      assert.equal(sim.gear.gearState, 0);
      assert.equal(sim.controls.parkingBrake, false);
    });
  }
});
