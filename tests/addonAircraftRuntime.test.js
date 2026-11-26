import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { aircraftPackFromProfile } from '../src/addons/aircraftPackBinding.js';
import { registerAddonAircraft, resolveAircraftConfig, addonAircraftIds } from '../src/config/aircraftConfigs.js';
import { AddonAircraft } from '../src/aircraft/AddonAircraft.js';
import { buildAddonStarter } from '../src/addons/addonStarter.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';

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
    /positive-capacity tank/,
  );
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
