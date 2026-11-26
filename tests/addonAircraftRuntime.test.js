import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { aircraftPackFromProfile } from '../src/addons/aircraftPackBinding.js';
import { registerAddonAircraft, resolveAircraftConfig, addonAircraftIds } from '../src/config/aircraftConfigs.js';
import { AddonAircraft } from '../src/aircraft/AddonAircraft.js';

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
