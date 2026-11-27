import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { validateAddonManifest, resolveProfile } from '../src/addons/addonContract.js';
import { aircraftPackFromProfile } from '../src/addons/aircraftPackBinding.js';
import { lintAddonSet } from '../src/addons/lintAddonSet.js';
import { buildAddonProfileUrl, resolveSharedAddonPack } from '../src/addons/addonCatalogBrowser.js';
import { applyAircraftLivery } from '../src/aircraft/applyAircraftLivery.js';
import {
  AIRCRAFT_REGISTRY,
  registerAddonAircraft,
  resolveAircraftConfig,
  resolveAddonBaseAircraftId,
  spawnProfileAircraftId,
} from '../src/config/aircraftConfigs.js';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function makeProfile(manifests, coreVersion = '1.8.0') {
  return {
    schemaVersion: 1,
    coreVersion,
    pins: manifests.map(manifest => ({
      id: manifest.id,
      version: manifest.version,
      url: `https://packs.example/${manifest.id}/${manifest.version}/addon.json`,
      sha256: sha256(JSON.stringify(manifest)),
      manifest,
    })),
  };
}

function c172TurboManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'demo/aircraft/c172-turbo',
    publisher: 'demo',
    version: '1.0.0',
    coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: 'Cessna 172 Turbo by demo',
    aircraft: {
      id: 'c172-turbo',
      extends: 'C172',
      physics: {
        name: 'Cessna 172 Turbo',
        propulsion: {
          engineName: 'Turbocharged IO-360',
          maxStaticThrustPerEngineN: 4800,
        },
      },
      ...overrides,
    },
  };
}

test('aircraft addon extending built-in C172 deep-merges partial overrides without mutating base registry', () => {
  const baseThrustBefore = AIRCRAFT_REGISTRY.C172.propulsion.maxStaticThrustPerEngineN;
  const manifest = c172TurboManifest();
  const validation = validateAddonManifest(manifest, { coreVersion: '1.8.0' });
  assert.equal(validation.ok, true, validation.errors.join('; '));

  const descriptor = aircraftPackFromProfile(makeProfile([manifest]), manifest.id, { coreVersion: '1.8.0' });
  assert.equal(descriptor.id, 'c172-turbo');
  assert.equal(descriptor.extends, 'C172');
  assert.equal(descriptor.baseAircraftId, 'C172');
  assert.equal(descriptor.model, null);
  assert.equal(descriptor.cockpit, null);

  // Overridden fields take effect
  assert.equal(descriptor.config.id, 'C172-TURBO');
  assert.equal(descriptor.config.name, 'Cessna 172 Turbo');
  assert.equal(descriptor.config.propulsion.engineName, 'Turbocharged IO-360');
  assert.equal(descriptor.config.propulsion.maxStaticThrustPerEngineN, 4800);

  // Unspecified nested fields are inherited from C172
  assert.equal(descriptor.config.propulsion.numEngines, AIRCRAFT_REGISTRY.C172.propulsion.numEngines);
  assert.equal(descriptor.config.propulsion.fuelCapacityKg, AIRCRAFT_REGISTRY.C172.propulsion.fuelCapacityKg);
  assert.deepEqual(descriptor.config.aerodynamics.flapAngles, AIRCRAFT_REGISTRY.C172.aerodynamics.flapAngles);
  assert.equal(descriptor.config.aerodynamics.wingspanM, AIRCRAFT_REGISTRY.C172.aerodynamics.wingspanM);
  assert.equal(descriptor.config.landingGear.cgGroundHeightM, AIRCRAFT_REGISTRY.C172.landingGear.cgGroundHeightM);
  assert.equal(descriptor.config.audio?.engineType, AIRCRAFT_REGISTRY.C172.audio?.engineType);
  assert.equal(descriptor.spec.id, 'C172-TURBO');
  assert.equal(descriptor.spec.name, 'Cessna 172 Turbo');
  assert.equal(descriptor.spec.type, AIRCRAFT_REGISTRY.C172.specs.type);

  // Base registry remains untouched
  assert.equal(AIRCRAFT_REGISTRY.C172.propulsion.maxStaticThrustPerEngineN, baseThrustBefore);
  assert.equal(AIRCRAFT_REGISTRY.C172.name, 'Cessna 172 Skyhawk');
});

test('extended addon aerodynamics aliases override built-in canonical keys', () => {
  const baseCla = AIRCRAFT_REGISTRY.C172.aerodynamics.claPerRad;
  const manifest = c172TurboManifest({
    physics: {
      aerodynamics: { clAlpha: 3.1, cd0: 0.015 },
    },
  });
  assert.equal(validateAddonManifest(manifest, { coreVersion: '1.8.0' }).ok, true);
  const descriptor = aircraftPackFromProfile(makeProfile([manifest]), manifest.id, { coreVersion: '1.8.0' });
  assert.equal(descriptor.config.aerodynamics.claPerRad, 3.1);
  assert.equal(descriptor.config.aerodynamics.cd0Clean, 0.015);
  assert.equal(AIRCRAFT_REGISTRY.C172.aerodynamics.claPerRad, baseCla);
  assert.notEqual(baseCla, 3.1);
});

test('extended aircraft supports shorthand massKg/wingspanM/wingAreaM2/fuelCapacityKg and custom GLB override', () => {
  const manifest = c172TurboManifest({
    id: 'bush-cub',
    physics: {
      massKg: 980,
      wingspanM: 12.4,
      wingAreaM2: 18.0,
      fuelCapacityKg: 130,
    },
    model: { url: 'https://packs.example/bush-cub/1.0.0/model.glb', sha256: 'a'.repeat(64) },
    controlBindings: { elevator: 'custom_elev' },
  });
  manifest.id = 'demo/aircraft/bush-cub';
  manifest.assets = [{ url: 'https://packs.example/bush-cub/1.0.0/model.glb', sha256: 'a'.repeat(64) }];

  const descriptor = aircraftPackFromProfile(makeProfile([manifest]), manifest.id, { coreVersion: '1.8.0' });
  assert.equal(descriptor.baseAircraftId, 'C172');
  assert.equal(descriptor.model.url, 'https://packs.example/bush-cub/1.0.0/model.glb');
  assert.equal(descriptor.controls.elevator.node, 'custom_elev');
  assert.equal(descriptor.config.massProperties.currentMassKg, 980);
  assert.equal(descriptor.config.aerodynamics.wingspanM, 12.4);
  assert.equal(descriptor.config.aerodynamics.wingAreaM2, 18.0);
  assert.equal(descriptor.config.propulsion.fuelCapacityKg, 130);
});

test('multi-level addon-to-addon inheritance resolves dependencies, visuals, controls, and transitive baseAircraftId', async () => {
  const parentManifest = {
    schemaVersion: 1,
    id: 'demo/aircraft/f16-block70',
    publisher: 'demo',
    version: '1.0.0',
    coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: 'F-16 Block 70 by demo',
    aircraft: {
      id: 'f16-blk70',
      extends: 'F16',
      physics: {
        name: 'F-16 Block 70',
        propulsion: { maxStaticThrustPerEngineN: 145000 },
      },
      model: { url: 'https://packs.example/f16-blk70/1.0.0/model.glb', sha256: 'b'.repeat(64) },
      controlBindings: { rudder: 'blk70_rudder' },
    },
    assets: [{ url: 'https://packs.example/f16-blk70/1.0.0/model.glb', sha256: 'b'.repeat(64) }],
  };

  const childManifest = {
    schemaVersion: 1,
    id: 'demo/aircraft/f16-aggressor',
    publisher: 'demo',
    version: '1.0.0',
    coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
    dependencies: [{ id: parentManifest.id, version: parentManifest.version }],
    license: 'CC-BY-4.0',
    attribution: 'F-16 Aggressor by demo',
    aircraft: {
      id: 'f16-aggr',
      extends: parentManifest.id,
      physics: {
        name: 'F-16 Aggressor',
        aerodynamics: { oswaldEfficiency: 0.85 },
      },
      controlBindings: { elevator: 'aggr_elev' },
    },
  };

  // Lint as a set
  const lint = lintAddonSet([parentManifest, childManifest], { coreVersion: '1.8.0' });
  assert.equal(lint.ok, true, lint.errors.join('; '));

  // Resolve through catalog + shared profile URL
  const parentBody = JSON.stringify(parentManifest);
  const childBody = JSON.stringify(childManifest);
  const parentUrl = 'https://packs.example/f16-blk70/1.0.0/addon.json';
  const childUrl = 'https://packs.example/f16-aggr/1.0.0/addon.json';
  const catalog = {
    schemaVersion: 1,
    addons: [
      { id: parentManifest.id, version: parentManifest.version, url: parentUrl, sha256: sha256(parentBody) },
      { id: childManifest.id, version: childManifest.version, url: childUrl, sha256: sha256(childBody) },
    ],
  };
  const fetchImpl = async url => {
    const body = url === parentUrl ? parentBody : url === childUrl ? childBody : null;
    if (!body) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200 });
  };

  const profile = await resolveProfile(catalog, [childManifest.id], { coreVersion: '1.8.0', fetchImpl });
  assert.equal(profile.pins.length, 2);

  const search = buildAddonProfileUrl(catalog, [childManifest.id, parentManifest.id], {
    baseUrl: '?',
    coreVersion: '1.8.0',
  });
  const pack = await resolveSharedAddonPack(search, { coreVersion: '1.8.0', fetchImpl });
  assert.equal(pack.aircraft.id, 'f16-aggr');
  assert.equal(pack.aircraft.extends, parentManifest.id);
  assert.equal(pack.aircraft.baseAircraftId, 'F16');
  assert.equal(pack.aircraft.model.url, parentManifest.aircraft.model.url);
  assert.equal(pack.aircraft.controls.rudder.node, 'blk70_rudder');
  assert.equal(pack.aircraft.controls.elevator.node, 'aggr_elev');
  assert.equal(pack.aircraft.config.propulsion.maxStaticThrustPerEngineN, 145000);
  assert.equal(pack.aircraft.config.aerodynamics.oswaldEfficiency, 0.85);
  assert.ok(pack.aircraft.config.flightControls, 'inherits F16 flightControls transitively');

  registerAddonAircraft([pack.aircraft]);
  assert.equal(resolveAircraftConfig('f16-aggr'), pack.aircraft.config);
  assert.equal(resolveAddonBaseAircraftId('f16-aggr'), 'F16');
  assert.equal(spawnProfileAircraftId('f16-aggr'), 'F16');
});

test('headless simulation flies an extended C172 addon with higher thrust than stock C172', () => {
  const manifest = c172TurboManifest();
  const descriptor = aircraftPackFromProfile(makeProfile([manifest]), manifest.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);

  const stockSim = createHeadlessSimulation({ aircraftId: 'C172', airportId: 'jeju' });
  const turboSim = createHeadlessSimulation({ aircraftId: descriptor.id, airportId: 'jeju' });
  stockSim.setPreset('approach');
  turboSim.setPreset('approach');
  stockSim.controls.throttle = 1;
  turboSim.controls.throttle = 1;

  for (let tick = 0; tick < 120; tick++) {
    stockSim.totalSimTime += stockSim.physicsDt;
    stockSim.integratePhysics(stockSim.physicsDt);
    turboSim.totalSimTime += turboSim.physicsDt;
    turboSim.integratePhysics(turboSim.physicsDt);
  }

  assert.equal(Number.isFinite(turboSim.telemetry.iasKnots), true);
  assert.ok(
    turboSim.telemetry.iasKnots > stockSim.telemetry.iasKnots,
    `turbo IAS (${turboSim.telemetry.iasKnots}) should exceed stock C172 IAS (${stockSim.telemetry.iasKnots})`,
  );
});

test('validation rejects invalid extends targets, self-extends, undeclared dependencies, and cycles', () => {
  const badTarget = c172TurboManifest({ extends: 'A380' });
  assert.equal(validateAddonManifest(badTarget, { coreVersion: '1.8.0' }).ok, false);

  const selfExtends = c172TurboManifest({ extends: 'demo/aircraft/c172-turbo' });
  const selfResult = validateAddonManifest(selfExtends, { coreVersion: '1.8.0' });
  assert.equal(selfResult.ok, false);
  assert.ok(selfResult.errors.some(err => err.includes('cannot reference itself')));

  const missingDep = c172TurboManifest({ extends: 'demo/aircraft/other-plane' });
  const depResult = validateAddonManifest(missingDep, { coreVersion: '1.8.0' });
  assert.equal(depResult.ok, false);
  assert.ok(depResult.errors.some(err => err.includes('must be declared in dependencies')));

  const badMass = c172TurboManifest({ physics: { massKg: -10 } });
  assert.equal(validateAddonManifest(badMass, { coreVersion: '1.8.0' }).ok, false);

  const cyclicA = {
    schemaVersion: 1,
    id: 'demo/aircraft/cycle-a',
    publisher: 'demo',
    version: '1.0.0',
    coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
    dependencies: [{ id: 'demo/aircraft/cycle-b', version: '1.0.0' }],
    license: 'CC-BY-4.0',
    attribution: 'Cycle A',
    aircraft: { id: 'cycle-a', extends: 'demo/aircraft/cycle-b' },
  };
  const cyclicB = {
    schemaVersion: 1,
    id: 'demo/aircraft/cycle-b',
    publisher: 'demo',
    version: '1.0.0',
    coreRange: { min: '1.8.0', maxExclusive: '2.0.0' },
    dependencies: [{ id: 'demo/aircraft/cycle-a', version: '1.0.0' }],
    license: 'CC-BY-4.0',
    attribution: 'Cycle B',
    aircraft: { id: 'cycle-b', extends: 'demo/aircraft/cycle-a' },
  };
  assert.throws(
    () => aircraftPackFromProfile(makeProfile([cyclicA, cyclicB]), cyclicA.id, { coreVersion: '1.8.0' }),
    /cyclic aircraft inheritance/,
  );
  const cyclicLint = lintAddonSet([cyclicA, cyclicB], { coreVersion: '1.8.0' });
  assert.equal(cyclicLint.ok, false);
  assert.ok(cyclicLint.errors.some(err => err.includes('cyclic dependency')));
});

test('Korean Airliners Skin example pack validates, lints, inherits full B738 physics, and applies livery', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../examples/packs/korean-airliners-skin/addon.json', import.meta.url), 'utf8'),
  );
  const validation = validateAddonManifest(manifest, { coreVersion: '1.8.0' });
  assert.equal(validation.ok, true, validation.errors.join('; '));

  const lint = lintAddonSet([manifest], { coreVersion: '1.8.0' });
  assert.equal(lint.ok, true, lint.errors.join('; '));

  const descriptor = aircraftPackFromProfile(makeProfile([manifest]), manifest.id, { coreVersion: '1.8.0' });
  assert.equal(descriptor.id, 'korean-airliners-b738');
  assert.equal(descriptor.title, 'Korean Airliners Skin');
  assert.equal(descriptor.extends, 'B738');
  assert.equal(descriptor.baseAircraftId, 'B738');
  assert.equal(descriptor.model, null);
  assert.equal(descriptor.cockpit, null);
  assert.equal(descriptor.livery.airline, 'Korean Airliners');
  assert.equal(descriptor.livery.scheme.topColor, '#4a91b3');
  assert.equal(descriptor.livery.title.text, 'KOREAN AIRLINERS');
  assert.equal(descriptor.livery.tailEmblem.kind, 'taegeuk');
  assert.equal(
    descriptor.config.propulsion.maxStaticThrustPerEngineN,
    AIRCRAFT_REGISTRY.B738.propulsion.maxStaticThrustPerEngineN,
  );
  assert.equal(
    descriptor.config.massProperties.currentMassKg,
    AIRCRAFT_REGISTRY.B738.massProperties.currentMassKg,
  );

  // Verify scheme shader and airline metadata apply cleanly without touching turbine fan meshes
  const root = new THREE.Group();
  const container = new THREE.Group();
  const model = new THREE.Group();
  const fuselageMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const fanMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10), fuselageMat);
  fuselage.name = 'B737';
  const fan = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fanMat);
  fan.name = 'turbs';
  model.add(fuselage, fan);
  container.add(model);
  root.add(container);

  applyAircraftLivery(model, root, container, descriptor.livery);
  assert.equal(root.userData.airline, 'Korean Airliners');
  assert.notEqual(fuselage.material, fuselageMat, 'fuselage material is cloned before shader patch');
  assert.equal(fuselage.material.customProgramCacheKey(), 'addon-livery-scheme-v1');
  assert.equal(fan.material, fanMat, 'turbine fan mesh is skipped by fuselage scheme shader');
});

test('livery material overrides clone materials, apply color/roughness/map, and reject invalid livery schemas', () => {
  const root = new THREE.Group();
  const container = new THREE.Group();
  const model = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ name: 'Fuselage', color: 0xffffff, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), baseMat);
  mesh.name = 'BodyMesh';
  model.add(mesh);
  container.add(model);
  root.add(container);

  const loadedUrls = [];
  const fakeTexture = new THREE.Texture();
  const fakeLoader = {
    load(url, onLoad) {
      loadedUrls.push(url);
      onLoad(fakeTexture);
    },
  };

  applyAircraftLivery(model, root, container, {
    materials: {
      Fuselage: {
        color: '#ff4500',
        roughness: 0.3,
        metalness: 0.2,
        map: { url: 'https://packs.example/skin/1.0.0/fuselage.png', sha256: 'c'.repeat(64) },
      },
    },
  }, { textureLoader: fakeLoader });

  assert.notEqual(mesh.material, baseMat);
  assert.equal(mesh.material.color.getHexString(), 'ff4500');
  assert.equal(mesh.material.roughness, 0.3);
  assert.equal(mesh.material.metalness, 0.2);
  assert.equal(mesh.material.map, fakeTexture);
  assert.equal(fakeTexture.flipY, false);
  assert.deepEqual(loadedUrls, ['https://packs.example/skin/1.0.0/fuselage.png']);

  const badColor = c172TurboManifest({ livery: { scheme: { topColor: 'sky-blue', bellyColor: '#ffffff' } } });
  assert.equal(validateAddonManifest(badColor, { coreVersion: '1.8.0' }).ok, false);

  const scriptLivery = c172TurboManifest({ livery: { script: 'alert(1)' } });
  const scriptRes = validateAddonManifest(scriptLivery, { coreVersion: '1.8.0' });
  assert.equal(scriptRes.ok, false);
  assert.ok(scriptRes.errors.some(err => err.includes('livery.script is forbidden')));

  const badHost = c172TurboManifest({
    livery: {
      materials: {
        Fuselage: { map: { url: 'http://evil.example/skin.png', sha256: 'd'.repeat(64) } },
      },
    },
  });
  const hostLint = lintAddonSet([badHost], { coreVersion: '1.8.0' });
  assert.equal(hostLint.ok, false);
  assert.ok(hostLint.errors.some(err => err.includes('protocol not allowed')));
});
