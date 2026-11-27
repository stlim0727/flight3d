import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { aircraftPackFromProfile } from '../src/addons/aircraftPackBinding.js';
import { buildAddonProfileUrl, pinnedAddonAircraftList, resolveSharedAddonPack } from '../src/addons/addonCatalogBrowser.js';
import { registerAddonAircraft, resolveAircraftConfig, addonAircraftIds } from '../src/config/aircraftConfigs.js';
import { AddonAircraft } from '../src/aircraft/AddonAircraft.js';
import { buildAddonStarter } from '../src/addons/addonStarter.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { stepPhysics } from '../src/core/physicsTiming.js';
import { BODY_CONTACTS, BODY_SUPPORT_POINTS } from '../src/physics/groundContacts.js';
import { airportSpawnPlan } from '../src/config/airportSpawnPlan.js';
import { approachSpawnPlan, cruiseSpawnPlan, runwayEndFrame, takeoffSpawnPlan } from '../src/config/mapFlightPlan.js';
import { REGIONAL_CRUISES, regionalCruiseSpawn } from '../src/config/regionalCruises.js';

const manifest = {
  schemaVersion: 1,
  id: 'demo/aircraft/test-plane',
  publisher: 'demo',
  version: '1.0.0',
  coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
  dependencies: [],
  license: 'CC-BY-4.0',
  attribution: 'Test Plane by demo',
  aircraft: {
    id: 'testplane',
    physics: {
      profile: 'rigid-body-v1', massKg: 1000, wingAreaM2: 16, wingspanM: 11, lengthM: 8,
      id: 'TESTPLANE', name: 'Test Plane',
      massProperties: { currentMassKg: 1000 },
      aerodynamics: { wingspanM: 11, wingAreaM2: 16 },
      specs: { id: 'TESTPLANE', name: 'Test Plane', type: 'generalAviation' },
    },
    model: { url: 'https://example.com/model.glb', sha256: 'a'.repeat(64) },
    controlBindings: { elevator: 'elevator_node' },
    animation: {
      schema: 'transform-v1',
      controls: {
        elevator: { node: 'elevator_node', axis: 'x', input: 'elevator', rangeDeg: [-20, 20] },
      },
    },
  },
  assets: [{ url: 'https://example.com/model.glb', sha256: 'a'.repeat(64) }],
};

test('animation bindings validate as declarative transform data', () => {
  assert.equal(validateAddonManifest(manifest, { coreVersion: '1.8.0' }).ok, true);
  const invalid = structuredClone(manifest);
  invalid.aircraft.animation.controls.elevator.input = 'evil.js';
  const result = validateAddonManifest(invalid, { coreVersion: '1.8.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => message.includes('input is unsupported')));
});

test('aircraft descriptor resolves config, spec and animation controls', () => {
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, sha256: 'a'.repeat(64), manifest }],
  }, manifest.id, { coreVersion: '1.8.0' });
  assert.equal(descriptor.id, 'testplane');
  assert.equal(descriptor.config.id, 'TESTPLANE');
  assert.equal(descriptor.spec.type, 'generalAviation');
  assert.deepEqual(descriptor.controls.elevator.rangeDeg, [-20, 20]);
  registerAddonAircraft([descriptor]);
  assert.equal(resolveAircraftConfig('testplane'), descriptor.config);
  assert.ok(addonAircraftIds().includes('testplane'));
});

test('procedural fallback moves control surfaces from telemetry', async () => {
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, sha256: 'a'.repeat(64), manifest }],
  }, manifest.id, { coreVersion: '1.8.0' });
  const originalError = console.error;
  console.error = () => {};
  const aircraft = new AddonAircraft(descriptor);
  await aircraft.ready;
  console.error = originalError;
  const elevator = aircraft.proceduralGroup.getObjectByName('elevator_node');
  assert.ok(elevator);
  aircraft.update(0.1, { controlInputs: { elevator: 1 } });
  assert.ok(elevator.rotation.x > 0);
  aircraft.update(0.1, { controlInputs: { elevator: -1 } });
  assert.ok(elevator.rotation.x < 0);
  const prop = aircraft.proceduralGroup.getObjectByName('azimuth_node');
  aircraft.update(0.1, { engine1N1: 80 });
  assert.ok(Number.isFinite(prop.rotation.x));
  assert.ok(prop.rotation.x > 0);
});

test('control inputs use their declared domains', async () => {
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, sha256: 'a'.repeat(64), manifest }],
  }, manifest.id, { coreVersion: '1.8.0' });
  const animated = {
    ...descriptor,
    controls: {
      gear: { node: 'gear_node', axis: 'y', input: 'gearState', rangeDeg: [0, 90] },
      flaps: { node: 'flaps_node', axis: 'x', input: 'flapsIndex', rangeDeg: [0, 40] },
      azimuth: { node: 'azimuth_node', axis: 'x', input: 'rpm', continuous: true, rpmRange: [25, 100] },
    },
  };
  const originalError = console.error;
  console.error = () => {};
  const aircraft = new AddonAircraft(animated);
  await aircraft.ready;
  console.error = originalError;
  aircraft.update(0.016, { gearState: 0, flapsIndex: 0, engine1N1: 25 });
  assert.equal(aircraft.proceduralGroup.getObjectByName('gear_node').rotation.y, 0);
  assert.equal(aircraft.proceduralGroup.getObjectByName('flaps_node').rotation.x, 0);
  const idleStep = aircraft.proceduralGroup.getObjectByName('azimuth_node').rotation.x;
  aircraft.update(0.016, { gearState: 1, flapsIndex: 3, engine1N1: 100 });
  assert.ok(Math.abs(aircraft.proceduralGroup.getObjectByName('gear_node').rotation.y - Math.PI / 2) < 1e-9);
  assert.ok(aircraft.proceduralGroup.getObjectByName('flaps_node').rotation.x > 0);
  const fullStep = aircraft.proceduralGroup.getObjectByName('azimuth_node').rotation.x - idleStep;
  assert.ok(fullStep > idleStep * 2, `idle=${idleStep}, full=${fullStep}`);
  assert.equal(aircraft.ensureCockpitModel(), false);
  assert.equal(aircraft.cockpit.cockpitModelFailed, true);
});

test('starter aircraft physics never inherits built-in propulsion or gear', () => {
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: starter.id, version: starter.version, sha256: 'a'.repeat(64), manifest: starter }],
  }, starter.id, { coreVersion: '1.8.0' });
  assert.equal(descriptor.config.propulsion.numEngines, 1);
  assert.notEqual(descriptor.config.propulsion.engineName, 'CFM56-7B26');
  assert.equal(descriptor.config.landingGear.cgGroundHeightM, 1.3);
  assert.equal(descriptor.config.aerodynamics.flapAngles.length, 1);
});

test('starter aircraft mass and fuel loading survive refuel and fuel burn', () => {
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: starter.id, version: starter.version, sha256: 'a'.repeat(64), manifest: starter }],
  }, starter.id, { coreVersion: '1.8.0' });
  const aero = new Aerodynamics(descriptor.config);
  const engines = new EngineModel(descriptor.config);
  engines.loadConfig(descriptor.config);
  engines.bindMassProperties(aero.massProperties);
  engines.refuel(aero);
  assert.equal(engines.fuelKg, 120);
  assert.equal(aero.massProperties.fuelKg, 120);
  const before = aero.massProperties.fuelKg;
  const supplied = aero.massProperties.consume(0.5);
  assert.equal(supplied, 0.5);
  assert.ok(aero.massProperties.fuelKg < before);
  assert.ok(aero.mass > 0);
  aero.setFlapPosition(5);
  assert.equal(aero.flapsIndex, 0);
  assert.equal(aero.currentFlapAngle, 0);
});

test('derived addon physics rejects fuel and tank configurations that cannot load', () => {
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const profile = () => ({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: starter.id, version: starter.version, sha256: 'a'.repeat(64), manifest: structuredClone(starter) }],
  });
  const invalidFuel = structuredClone(starter);
  invalidFuel.aircraft.physics.fuelCapacityKg = invalidFuel.aircraft.physics.massKg;
  assert.throws(
    () => aircraftPackFromProfile({
      schemaVersion: 1, coreVersion: '1.8.0',
      pins: [{ id: invalidFuel.id, version: invalidFuel.version, sha256: 'a'.repeat(64), manifest: invalidFuel }],
    }, invalidFuel.id, { coreVersion: '1.8.0' }),
    /positive empty mass/,
  );
  const invalidTanks = structuredClone(starter);
  invalidTanks.aircraft.physics.massDistribution = {
    referenceMassKg: 1200,
    initialFuelKg: 120,
    tanks: [],
    stations: [{ id: 'payload', capacityKg: 1200, position: { x: 0, y: 0, z: 0 } }],
  };
  assert.throws(
    () => aircraftPackFromProfile({
      schemaVersion: 1, coreVersion: '1.8.0',
      pins: [{ id: invalidTanks.id, version: invalidTanks.version, sha256: 'a'.repeat(64), manifest: invalidTanks }],
    }, invalidTanks.id, { coreVersion: '1.8.0' }),
    /tanks need positive capacity/,
  );
  for (const [label, fuelCapacityKg, tanks, initialFuelKg] of [
    ['oversized tank capacity', 120, [120, 120], 120],
    ['fuel without declared capacity', 0, [120], 0],
    ['initial fuel above capacity', 120, [120], 200],
  ]) {
    const invalid = structuredClone(starter);
    invalid.aircraft.physics.fuelCapacityKg = fuelCapacityKg;
    invalid.aircraft.physics.massDistribution = {
      referenceMassKg: 1200,
      initialFuelKg,
      tanks: tanks.map((capacityKg, index) => ({
        id: `tank${index}`, capacityKg, position: { x: 0, y: 0, z: 0 }, priority: 0,
      })),
      stations: [{ id: 'payload', capacityKg: 1200, position: { x: 0, y: 0, z: 0 } }],
    };
    assert.throws(
      () => aircraftPackFromProfile({
        schemaVersion: 1, coreVersion: '1.8.0',
        pins: [{ id: invalid.id, version: invalid.version, sha256: 'a'.repeat(64), manifest: invalid }],
      }, invalid.id, { coreVersion: '1.8.0' }),
      undefined,
      label,
    );
  }
  assert.ok(aircraftPackFromProfile(profile(), starter.id, { coreVersion: '1.8.0' }));
});

test('headless approach preset starts and advances with an addon aircraft', () => {
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: starter.id, version: starter.version, sha256: 'a'.repeat(64), manifest: starter }],
  }, starter.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);
  const sim = createHeadlessSimulation({ aircraftId: descriptor.id, airportId: 'jeju' });
  sim.setPreset('approach');
  assert.equal(sim.aero.flapsIndex, 0);
  assert.equal(sim.engines.fuelKg > 0, true);
  const startX = sim.position.x;
  for (let tick = 0; tick < 120; tick++) {
    sim.totalSimTime += sim.physicsDt;
    sim.integratePhysics(sim.physicsDt);
  }
  assert.ok(Math.abs(sim.position.x - startX) > 1);
  assert.equal(Number.isFinite(sim.telemetry.iasKnots), true);
});

function gaMapSupportManifest() {
  return {
    schemaVersion: 1,
    id: 'demo/aircraft/light-prop',
    publisher: 'demo',
    version: '1.0.0',
    coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: 'Light Prop by demo',
    aircraft: {
      id: 'lightprop',
      physics: {
        profile: 'rigid-body-v1',
        massKg: 1050,
        wingAreaM2: 16.2,
        wingspanM: 11,
        lengthM: 8.2,
        id: 'LIGHTPROP',
        name: 'Light Prop',
        configurationLimits: { flap: [0, 110, 85, 85], gearOperating: 85, gearExtended: 85 },
        massDistribution: {
          referenceMassKg: 1050,
          initialFuelKg: 110,
          initialPayloadKg: 173,
          tanks: [{ id: 'main', capacityKg: 144, priority: 0, position: { x: 0, y: 0, z: 0 } }],
          stations: [{ id: 'payload', capacityKg: 387, position: { x: 0, y: 0, z: 0 } }],
        },
        massProperties: {
          emptyWeightKg: 767,
          maxTakeoffWeightKg: 1157,
          currentMassKg: 1050,
          Ixx: 1285,
          Iyy: 1825,
          Izz: 2667,
        },
        aerodynamics: {
          wingspanM: 11,
          wingAreaM2: 16.2,
          meanChordM: 1.47,
          tailArmM: 4,
          tailAreaM2: 4,
          tailInducedFactor: 0.1,
          oswaldEfficiency: 0.8,
          cl0Clean: 0.35,
          claPerRad: 5.1,
          alphaStallDeg: 14,
          clFlapBoostMax: 0.65,
          spoilerLiftDump: 0,
          cd0Clean: 0.027,
          gearDrag: 0.015,
          spoilerDrag: 0,
          transonicMachBuffet: 0.6,
          cm0: -0.04,
          cma: -0.75,
          cmDe: -1.35,
          cmQ: -14,
          clBeta: -0.09,
          clDa: 0.22,
          clP: -0.5,
          cnBeta: 0.12,
          cnDr: -0.09,
          cnR: -0.18,
          adverseYaw: -0.02,
          flapAngles: [0, 10, 20, 30],
        },
        stallWarning: { type: 'pneumaticHorn', referenceMarginKnots: 7.5 },
        propulsion: {
          numEngines: 1,
          engineName: 'Lycoming IO-360-L2A',
          maxStaticThrustPerEngineN: 3200,
          idleN1Percent: 25,
          togaN1Percent: 100,
          spoolUpTimeSec: 0.8,
          spoolDownTimeSec: 0.8,
          reverseThrustEfficiency: 0,
          baseFuelFlowKgPerHour: 28,
          maxFuelFlowKgPerHour: 48,
          fuelCapacityKg: 144,
          momentArmMeters: 0,
        },
        audio: { engineType: 'piston', idleRpm: 700, maxRpm: 2700, cylinders: 4, propellerBlades: 2 },
        landingGear: {
          isFixed: true,
          cgGroundHeightM: 1.35,
          gearTransitTimeSec: 0.1,
          bodySupportPoints: {
            nose: { x: 0, y: -1.1, z: -1.5 },
            mainLeft: { x: -1.05, y: -1.15, z: 0.4 },
            mainRight: { x: 1.05, y: -1.15, z: 0.4 },
          },
          contacts: [
            { id: 'nose', name: 'Nose Gear', localPos: { x: 0, y: -1.1, z: -1.5 }, wheelRadius: 0.2, restLength: 0.5, kSpring: 120000, cDamper: 15000, isSteerable: true, maxSteeringDeg: 30 },
            { id: 'mainLeft', name: 'Left Main Gear', localPos: { x: -1.05, y: -1.15, z: 0.4 }, wheelRadius: 0.25, restLength: 0.5, kSpring: 180000, cDamper: 20000, isSteerable: false },
            { id: 'mainRight', name: 'Right Main Gear', localPos: { x: 1.05, y: -1.15, z: 0.4 }, wheelRadius: 0.25, restLength: 0.5, kSpring: 180000, cDamper: 20000, isSteerable: false },
          ],
          rollingFriction: 0.025,
          maxBrakingFriction: 0.4,
          tireLateralFriction: 0.7,
        },
        specs: { id: 'LIGHTPROP', name: 'Light Prop', type: 'generalAviation' },
      },
      model: { url: 'https://example.com/light-prop.glb', sha256: 'a'.repeat(64) },
      controlBindings: { elevator: 'elevator_node' },
    },
    assets: [{ url: 'https://example.com/light-prop.glb', sha256: 'a'.repeat(64) }],
  };
}

function applyInPlaceAircraftSwitch(sim, aircraftId, config) {
  sim.currentAircraftId = aircraftId;
  sim.currentAircraftConfig = config;
  sim.aero.loadConfig(config);
  sim.engines.loadConfig(config);
  sim.engines.bindMassProperties(sim.aero.massProperties);
  sim.gear.loadConfig(config);
  sim.collisionDetector.loadAircraftConfig(config);
}

test('full-config addon with map bodySupportPoints normalizes and runs across scenarios without freezing', () => {
  const gaManifest = gaMapSupportManifest();
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: gaManifest.id, version: gaManifest.version, sha256: 'a'.repeat(64), manifest: gaManifest }],
  }, gaManifest.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);

  const validIds = new Set(BODY_CONTACTS.map(point => point.id));
  const points = descriptor.config.landingGear.bodySupportPoints;
  assert.ok(Array.isArray(points));
  assert.equal(points.length, 3);
  for (const point of points) {
    assert.ok(validIds.has(point.id), `unexpected canonical body ID: ${point.id}`);
    assert.equal(typeof point.key, 'string');
    assert.equal(Array.isArray(point.position), true);
    assert.equal(point.position.length, 3);
    assert.ok(point.position.every(Number.isFinite));
    assert.ok(Number.isFinite(point.weight) && point.weight > 0);
  }

  const sim = createHeadlessSimulation({ aircraftId: 'B738', airportId: 'coastal' });
  sim.setPreset('runway');
  for (let tick = 0; tick < 10; tick++) stepPhysics(sim);

  applyInPlaceAircraftSwitch(sim, descriptor.id, descriptor.config);
  sim.setPreset('cruise');
  const startPos = sim.position.clone();
  for (let tick = 0; tick < 240; tick++) stepPhysics(sim);
  assert.equal(sim.isCrashed, false);
  assert.ok(sim.position.distanceTo(startPos) > 40, 'cruise sortie must advance');
  assert.ok(sim.telemetry.massKg > 900 && sim.telemetry.massKg < 1200, `unexpected mass ${sim.telemetry.massKg}`);
  assert.ok(sim.telemetry.iasKnots > 70 && sim.telemetry.iasKnots < 120, `unexpected IAS ${sim.telemetry.iasKnots}`);

  sim.setPreset('approach');
  for (let tick = 0; tick < 120; tick++) stepPhysics(sim);
  assert.equal(sim.isCrashed, false);
  assert.ok(Number.isFinite(sim.telemetry.iasKnots) && sim.telemetry.iasKnots > 50);

  sim.setPreset('runway');
  for (let tick = 0; tick < 240; tick++) stepPhysics(sim);
  assert.equal(sim.isCrashed, false);
  assert.equal(sim.telemetry.onGround, true);
  assert.deepEqual(Object.values(sim.telemetry.bodyDamage), [0, 0, 0, 0, 0, 0, 0]);

  // Forced body ground contact must not throw BODY_DAMAGE_LIMITS lookup errors.
  sim.position.y -= 1.5;
  for (let tick = 0; tick < 10; tick++) stepPhysics(sim);
  assert.ok(Number.isFinite(sim.telemetry.altitudeFt));
});

test('derived starter addon scales bodySupportPoints and survives runway transition from B738', () => {
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'trainer', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: starter.id, version: starter.version, sha256: 'a'.repeat(64), manifest: starter }],
  }, starter.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);

  assert.notEqual(descriptor.config.landingGear.bodySupportPoints, BODY_SUPPORT_POINTS);
  assert.equal(descriptor.config.landingGear.bodySupportPoints.length, BODY_CONTACTS.length);

  const sim = createHeadlessSimulation({ aircraftId: 'B738', airportId: 'coastal' });
  sim.setPreset('runway');
  for (let tick = 0; tick < 10; tick++) stepPhysics(sim);

  applyInPlaceAircraftSwitch(sim, descriptor.id, descriptor.config);
  sim.setPreset('runway');
  for (let tick = 0; tick < 240; tick++) stepPhysics(sim);
  assert.equal(sim.isCrashed, false);
  assert.equal(sim.telemetry.bodyDamage.belly, 0);
});

test('partial physics.id addon fills missing runtime defaults for headless stepping', () => {
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, sha256: 'a'.repeat(64), manifest }],
  }, manifest.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);

  const sim = createHeadlessSimulation({ aircraftId: descriptor.id, airportId: 'coastal' });
  sim.setPreset('cruise');
  assert.ok(sim.engines.fuelKg > 0, `expected positive fuel for ${descriptor.id}, got ${sim.engines.fuelKg}`);
  const startFuelKg = sim.engines.fuelKg;
  sim.controls.throttle = 1;
  sim.engines.setThrottle(1);
  const startX = sim.position.x;
  for (let tick = 0; tick < 120; tick++) stepPhysics(sim);
  assert.equal(sim.isCrashed, false);
  assert.ok(Math.abs(sim.position.x - startX) > 10);
  assert.ok(sim.engines.thrust[0] > 0, `expected positive thrust, got ${sim.engines.thrust[0]}`);
  assert.ok(sim.engines.fuelKg < startFuelKg, `expected fuel burn from ${startFuelKg}, got ${sim.engines.fuelKg}`);
});

test('spawn planners give GA addon aircraft non-zero GA speeds and configured ground clearance', () => {
  const gaManifest = gaMapSupportManifest();
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: gaManifest.id, version: gaManifest.version, sha256: 'a'.repeat(64), manifest: gaManifest }],
  }, gaManifest.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);

  for (const code of ['RKPC', 'RKSI', 'VNLK']) {
    const cruise = airportSpawnPlan(code, 'cruise', { aircraftId: descriptor.id });
    assert.ok(cruise, `${code} cruise spawn missing`);
    const speed = Math.hypot(cruise.vx, cruise.vz);
    assert.ok(speed >= 45 && speed <= 60, `${code} GA cruise speed expected ~48-53 m/s, got ${speed}`);
    const approach = airportSpawnPlan(code, 'approach', { aircraftId: descriptor.id });
    assert.ok(approach, `${code} approach spawn missing`);
    assert.ok(Math.hypot(approach.vx, approach.vz) > 25, `${code} approach speed must be non-zero`);
  }

  const regional = regionalCruiseSpawn(REGIONAL_CRUISES.jamsil, descriptor.id);
  assert.ok(Math.abs(Math.hypot(regional.vx, regional.vz) - 48) < 1e-6);

  const synthetic = {
    latitude: 37.4,
    longitude: 126.4,
    elevationM: 20,
    runways: [{
      id: '09/27',
      ends: [
        { ident: '09', physical: { x: -1500, z: 0, elevationM: 20 }, threshold: { x: -1400, z: 0, elevationM: 20 } },
        { ident: '27', physical: { x: 1500, z: 0, elevationM: 20 }, threshold: { x: 1500, z: 0, elevationM: 20 } },
      ],
    }],
  };
  const frame = runwayEndFrame(synthetic, '09/27', '09');
  const takeoff = takeoffSpawnPlan({ frame, aircraftId: descriptor.id });
  assert.equal(takeoff.groundClearanceM, 1.35);
  assert.equal(takeoff.y, 21.35);
  const mapApproach = approachSpawnPlan({ frame, aircraftId: descriptor.id });
  assert.ok(Math.abs(Math.hypot(mapApproach.vx, mapApproach.vz) - 33) < 1e-6);
  assert.equal(mapApproach.groundClearanceM, 1.35);
  const mapCruise = cruiseSpawnPlan({
    latitude: 37.5, longitude: 127.1, headingDeg: 90, altitudeM: 1000, aircraftId: descriptor.id,
  });
  assert.ok(Math.abs(Math.hypot(mapCruise.vx, mapCruise.vz) - 48) < 1e-6);
});

test('example aircraft addon omitting fuelCapacityKg binds default fuel and burns fuel under headless thrust', () => {
  const exampleManifest = JSON.parse(
    readFileSync(new URL('../examples/packs/aircraft/addon.json', import.meta.url), 'utf8'),
  );
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: exampleManifest.id, version: exampleManifest.version, sha256: 'a'.repeat(64), manifest: exampleManifest }],
  }, exampleManifest.id, { coreVersion: '1.8.0' });

  assert.equal(descriptor.config.propulsion.fuelCapacityKg, 185);
  assert.equal(descriptor.config.massProperties.emptyWeightKg, 1665);
  assert.ok(Array.isArray(descriptor.config.massDistribution.tanks) && descriptor.config.massDistribution.tanks.length > 0);
  assert.equal(descriptor.config.massDistribution.tanks[0].capacityKg, 185);
  assert.equal(descriptor.config.massDistribution.initialFuelKg, 185);

  registerAddonAircraft([descriptor]);
  const sim = createHeadlessSimulation({ aircraftId: descriptor.id, airportId: 'coastal' });
  assert.ok(sim.engines.fuelKg > 0);

  sim.setPreset('cruise');
  assert.ok(sim.engines.fuelKg > 0);
  const startFuelKg = sim.engines.fuelKg;
  sim.controls.throttle = 1;
  sim.engines.setThrottle(1);
  for (let tick = 0; tick < 120; tick++) stepPhysics(sim);

  assert.equal(sim.isCrashed, false);
  assert.ok(sim.engines.thrust[0] > 0, `expected positive thrust, got ${sim.engines.thrust[0]}`);
  assert.ok(sim.engines.fuelKg < startFuelKg, `expected fuel burn from ${startFuelKg}, got ${sim.engines.fuelKg}`);
});

test('derived addon preserves author-supplied physics.massProperties and partial propulsion defaults', () => {
  const custom = buildAddonStarter({
    publisher: 'demo', name: 'custom-inertia', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  delete custom.aircraft.physics.fuelCapacityKg;
  custom.aircraft.physics.massKg = 1850;
  custom.aircraft.physics.massProperties = {
    currentMassKg: 1800,
    Ixx: 2400,
    Iyy: 3100,
    Izz: 4200,
  };
  custom.aircraft.physics.propulsion = {
    numEngines: 2,
    engineName: 'Twin Prop',
  };

  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: custom.id, version: custom.version, sha256: 'a'.repeat(64), manifest: custom }],
  }, custom.id, { coreVersion: '1.8.0' });

  assert.equal(descriptor.config.massProperties.Ixx, 2400);
  assert.equal(descriptor.config.massProperties.Iyy, 3100);
  assert.equal(descriptor.config.massProperties.Izz, 4200);
  assert.equal(descriptor.config.massProperties.currentMassKg, 1800);
  assert.equal(descriptor.config.massProperties.emptyWeightKg, 1665);
  assert.equal(descriptor.config.massDistribution.initialFuelKg, 135);
  assert.equal(descriptor.config.massDistribution.initialPayloadKg, 0);
  assert.equal(descriptor.config.propulsion.numEngines, 2);
  assert.equal(descriptor.config.propulsion.engineName, 'Twin Prop');
  assert.equal(descriptor.config.propulsion.fuelCapacityKg, 185);
  assert.ok(descriptor.config.propulsion.maxStaticThrustPerEngineN > 0);
});

test('derived addon respects explicit zero fuelCapacityKg and infers fuelCapacityKg from tanks when omitted', () => {
  const glider = buildAddonStarter({
    publisher: 'demo', name: 'glider', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  glider.aircraft.physics.fuelCapacityKg = 0;

  const gliderDescriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: glider.id, version: glider.version, sha256: 'a'.repeat(64), manifest: glider }],
  }, glider.id, { coreVersion: '1.8.0' });

  assert.equal(gliderDescriptor.config.propulsion.fuelCapacityKg, 0);
  assert.equal(gliderDescriptor.config.massProperties.emptyWeightKg, glider.aircraft.physics.massKg);
  assert.deepEqual(gliderDescriptor.config.massDistribution.tanks, []);
  assert.equal(gliderDescriptor.config.massDistribution.initialFuelKg, 0);

  const tanked = buildAddonStarter({
    publisher: 'demo', name: 'twin-tank', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  delete tanked.aircraft.physics.fuelCapacityKg;
  tanked.aircraft.physics.massDistribution = {
    referenceMassKg: 1200,
    initialFuelKg: 100,
    tanks: [
      { id: 'left', capacityKg: 75, position: { x: -1, y: 0, z: 0 }, priority: 0 },
      { id: 'right', capacityKg: 75, position: { x: 1, y: 0, z: 0 }, priority: 0 },
    ],
    stations: [{ id: 'payload', capacityKg: 1200, position: { x: 0, y: 0, z: 0 } }],
  };

  const tankedDescriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: tanked.id, version: tanked.version, sha256: 'a'.repeat(64), manifest: tanked }],
  }, tanked.id, { coreVersion: '1.8.0' });

  assert.equal(tankedDescriptor.config.propulsion.fuelCapacityKg, 150);
  assert.equal(tankedDescriptor.config.massProperties.emptyWeightKg, 1050);
});

test('shared profile pinning two aircraft packs registers and resolves both aircraft IDs', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  globalThis.atob ??= b64 => Buffer.from(b64, 'base64').toString('binary');
  const packOne = buildAddonStarter({
    publisher: 'demo', name: 'multi-one', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0', title: 'Multi One',
  }).files['addon.json'];
  const packTwo = buildAddonStarter({
    publisher: 'demo', name: 'multi-two', kind: 'aircraft', version: '1.2.0', coreVersion: '1.8.0', title: 'Multi Two',
  }).files['addon.json'];
  const bytesOne = Buffer.from(JSON.stringify(packOne), 'utf8');
  const bytesTwo = Buffer.from(JSON.stringify(packTwo), 'utf8');
  const shaOne = createHash('sha256').update(bytesOne).digest('hex');
  const shaTwo = createHash('sha256').update(bytesTwo).digest('hex');
  const catalog = {
    schemaVersion: 1,
    addons: [
      { id: packOne.id, version: packOne.version, url: 'https://packs.example/multi-one.json', sha256: shaOne },
      { id: packTwo.id, version: packTwo.version, url: 'https://packs.example/multi-two.json', sha256: shaTwo },
    ],
  };
  const profileUrl = buildAddonProfileUrl(catalog, [packOne.id, packTwo.id], {
    baseUrl: 'https://flight.example/?',
    coreVersion: '1.8.0',
  });
  const fetchImpl = async url => {
    if (url === 'https://packs.example/multi-one.json') return { ok: true, arrayBuffer: async () => bytesOne };
    if (url === 'https://packs.example/multi-two.json') return { ok: true, arrayBuffer: async () => bytesTwo };
    return { ok: false, status: 404 };
  };

  const resolved = await resolveSharedAddonPack(new URL(profileUrl).search, { fetchImpl });
  assert.equal(resolved.aircrafts.length, 2);
  assert.deepEqual(resolved.aircrafts.map(item => item.id), ['multi-one', 'multi-two']);

  const list = pinnedAddonAircraftList(resolved);
  assert.equal(list.length, 2);
  assert.deepEqual(pinnedAddonAircraftList({ aircraft: resolved.aircrafts[1] }), [resolved.aircrafts[1]]);

  registerAddonAircraft(list);
  assert.equal(resolveAircraftConfig('multi-one'), resolved.aircrafts[0].config);
  assert.equal(resolveAircraftConfig('multi-two'), resolved.aircrafts[1].config);
  assert.ok(addonAircraftIds().includes('multi-one'));
  assert.ok(addonAircraftIds().includes('multi-two'));
});
