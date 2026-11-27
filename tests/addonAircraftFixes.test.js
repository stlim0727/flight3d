import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AddonAircraft } from '../src/aircraft/AddonAircraft.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { ReplayDirector } from '../src/director/ReplayDirector.js';
import { RenderPose } from '../src/core/RenderPose.js';
import { FLOW } from '../src/ui/GameFlowController.js';
import { reportText } from '../src/ui/DebriefOverlay.js';
import { registerAddonAircraft } from '../src/config/aircraftConfigs.js';
import { t } from '../src/i18n/index.js';

function makeAddonDescriptor(overrides = {}) {
  return {
    id: overrides.id ?? 'ga-addon',
    packId: 'demo/aircraft/ga-addon',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    config: {
      id: 'GA_ADDON',
      name: 'Piper Cub Addon',
      lengthM: 7.2,
      massProperties: { currentMassKg: 1200 },
      aerodynamics: { wingspanM: 11, wingAreaM2: 16, flapAngles: [0, 15, 30] },
      landingGear: { cgGroundHeightM: 1.3 },
      specs: { id: 'GA_ADDON', name: 'Piper Cub Addon', type: 'generalAviation', ultimateLoad: { min: -2.25, max: 5.7 } },
      ...(overrides.config ?? {}),
    },
    spec: { id: 'GA_ADDON', name: 'Piper Cub Addon', type: 'generalAviation', ultimateLoad: { min: -2.25, max: 5.7 } },
    model: 'model' in overrides ? overrides.model : { url: 'https://example.com/exterior.glb', sha256: 'a'.repeat(64) },
    cockpit: 'cockpit' in overrides ? overrides.cockpit : { url: 'https://example.com/cockpit.glb', sha256: 'b'.repeat(64) },
    controls: overrides.controls ?? {
      flaps: { node: 'flaps_node', axis: 'x', input: 'flapsIndex', rangeDeg: [0, 40] },
      azimuth: { node: 'azimuth_node', axis: 'x', input: 'rpm', continuous: true, rpmRange: [25, 100] },
    },
  };
}

test('AddonAircraft with separate cockpit URL preserves cockpit loading and toggles cockpit visibility cleanly', async () => {
  const originalLoad = GLTFLoader.prototype.load;
  const loadCalls = [];
  const exteriorScene = new THREE.Group();
  exteriorScene.name = 'exterior-scene';
  const cockpitScene = new THREE.Group();
  cockpitScene.name = 'cockpit-scene';

  GLTFLoader.prototype.load = function mockLoad(url, onLoad, _onProgress, onError) {
    loadCalls.push({ url, onLoad, onError });
  };

  try {
    const aircraft = new AddonAircraft(makeAddonDescriptor());
    assert.equal(aircraft.cockpit.cockpitModelFailed, false, 'configured cockpit must not start marked failed');
    assert.equal(loadCalls.length, 1);
    assert.equal(loadCalls[0].url, 'https://example.com/exterior.glb');

    loadCalls[0].onLoad({ scene: exteriorScene });
    await aircraft.ready;

    assert.equal(aircraft.modelLoaded, true);
    assert.equal(aircraft.gltfGroup.visible, true);
    assert.equal(aircraft.proceduralGroup.visible, false);
    assert.equal(aircraft.cockpit.gltfCockpitLoaded, false, 'exterior load must not hijack gltfCockpitLoaded when separate cockpit exists');
    assert.equal(aircraft.cockpit.gltfCockpitGroup, null);
    assert.equal(aircraft.cockpit.cockpitModelFailed, false);

    assert.equal(aircraft.ensureCockpitModel(), true, 'ensureCockpitModel must load declared cockpit GLB');
    assert.equal(loadCalls.length, 2);
    assert.equal(loadCalls[1].url, 'https://example.com/cockpit.glb');

    loadCalls[1].onLoad({ scene: cockpitScene });
    assert.equal(aircraft.cockpit.gltfCockpitLoaded, true);
    assert.equal(aircraft.cockpit.gltfCockpitGroup, cockpitScene);
    assert.equal(aircraft.cockpit.cockpitModelFailed, false);

    aircraft.setCockpitMode(true);
    assert.equal(aircraft.cockpit.group.visible, true);
    assert.equal(aircraft.gltfGroup.visible, false);
    assert.equal(aircraft.proceduralGroup.visible, false);

    aircraft.setCockpitMode(false);
    assert.equal(aircraft.cockpit.group.visible, false);
    assert.equal(aircraft.gltfGroup.visible, true);
    assert.equal(aircraft.proceduralGroup.visible, false);

    // Exterior load failure must not mark separate cockpit as failed.
    const failedExt = new AddonAircraft(makeAddonDescriptor());
    const extFailCall = loadCalls.at(-1);
    const originalError = console.error;
    console.error = () => {};
    try {
      extFailCall.onError(new Error('network error'));
      await failedExt.ready;
    } finally {
      console.error = originalError;
    }
    assert.equal(failedExt.modelLoaded, false);
    assert.equal(failedExt.cockpit.cockpitModelFailed, false);
    failedExt.setCockpitMode(true);
    assert.equal(failedExt.proceduralGroup.visible, false);
    assert.equal(failedExt.gltfGroup.visible, false);
    failedExt.setCockpitMode(false);
    assert.equal(failedExt.proceduralGroup.visible, true);
  } finally {
    GLTFLoader.prototype.load = originalLoad;
  }
});

test('AddonAircraft.buildProceduralFallback aligns to -Z nose, +/-X span, +Z tail and honors config.lengthM', () => {
  const aircraft = new AddonAircraft(makeAddonDescriptor({
    model: null,
    cockpit: null,
    config: { lengthM: 9.5, massProperties: { currentMassKg: 1200 }, aerodynamics: { wingspanM: 12, wingAreaM2: 18 } },
  }));

  const fuselage = aircraft.proceduralGroup.getObjectByName('fuselage_node');
  const wing = aircraft.proceduralGroup.getObjectByName('wing_node');
  const prop = aircraft.proceduralGroup.getObjectByName('azimuth_node');
  const tailplane = aircraft.proceduralGroup.getObjectByName('tailplane_node');
  const elevator = aircraft.proceduralGroup.getObjectByName('elevator_node');
  const rudder = aircraft.proceduralGroup.getObjectByName('rudder_node');

  assert.equal(fuselage.geometry.parameters.depth, 9.5);
  assert.equal(wing.geometry.parameters.width, 12);
  assert.ok(prop.position.z < 0, 'nose propeller must sit at -Z');
  assert.ok(tailplane.position.z > 0, 'tailplane must sit at +Z');
  assert.ok(elevator.position.z > 0, 'elevator must sit at +Z');
  assert.ok(rudder.position.z > 0, 'rudder must sit at +Z');
});

test('AddonAircraft.applyControl scales flapsIndex by flapAngles length and wraps continuous angles modulo 360', () => {
  const aircraft = new AddonAircraft(makeAddonDescriptor({
    model: null,
    cockpit: null,
    config: {
      lengthM: 8,
      aerodynamics: { wingspanM: 11, wingAreaM2: 16, flapAngles: [0, 10, 20] },
    },
  }));

  aircraft.update(0.1, { flapsIndex: 2, engine1N1: 100 });
  const flaps = aircraft.proceduralGroup.getObjectByName('flaps_node');
  assert.ok(Math.abs(flaps.rotation.x - (40 * Math.PI / 180)) < 1e-9, 'full flap index reaches max rangeDeg');

  for (let i = 0; i < 10; i++) {
    aircraft.update(0.2, { flapsIndex: 2, engine1N1: 100 });
  }
  const angle = aircraft.surfaceState.get('azimuth');
  assert.ok(angle >= 0 && angle < 360, `continuous surface angle must stay wrapped in [0, 360), got ${angle}`);
});

test('CollisionDetector scales probes for a 1,200 kg GA addon without false 30 m runway strikes', () => {
  const runwayTerrain = { getHeight: () => 0 };
  const narrowRunwayAirport = {
    isOnRunway: (x, z) => Math.abs(x) <= 1000 && Math.abs(z) <= 15,
    isRunwaySafetyArea: (x, z) => Math.abs(x) <= 1100 && Math.abs(z) <= 30,
  };
  const detector = new CollisionDetector(runwayTerrain, narrowRunwayAirport, null, null, null);
  const gaConfig = {
    id: 'GA_1200',
    lengthM: 8,
    massProperties: { currentMassKg: 1200 },
    aerodynamics: { wingspanM: 11, wingAreaM2: 16 },
    landingGear: { cgGroundHeightM: 1.3 },
    specs: { type: 'generalAviation' },
  };
  detector.loadAircraftConfig(gaConfig);

  assert.equal(detector.aircraftId, 'C172');
  const wingL = detector.probePoints.find(p => p.id === 'wingL');
  const wingR = detector.probePoints.find(p => p.id === 'wingR');
  const belly = detector.probePoints.find(p => p.id === 'belly');
  const engineL = detector.probePoints.find(p => p.id === 'engineL');
  assert.equal(wingL.pos.x, -5.5);
  assert.equal(wingR.pos.x, 5.5);
  assert.ok(belly.pos.y > -1.3, `belly probe ${belly.pos.y} must stay above -1.3`);
  assert.ok(engineL.pos.y > -1.3, `engineL probe ${engineL.pos.y} must stay above -1.3`);

  const pos = new THREE.Vector3(0, 1.3, 0);
  const quat = new THREE.Quaternion();
  const vel = new THREE.Vector3(25, 0, 0);
  assert.equal(detector.checkCollision(pos, quat, vel, 1, 0, 0), null, 'no false detection-only strike on 30 m runway');
  assert.equal(detector.checkCollision(pos, quat, vel, 1, 0, 0, {
    onGround: true,
    contacts: [{ id: 'mainLeft', isGrounded: true, worldPos: new THREE.Vector3(0, 0, -1) }],
    bodyContacts: [],
  }), null, 'no false solver-backed strike on 30 m runway');
});

test('DebriefOverlay.reportText displays registered addon aircraft name and Patagonia label', () => {
  const addonId = 'addon_debrief_test';
  registerAddonAircraft([{
    id: addonId,
    config: { id: addonId, name: 'Patagonia Bush Plane' },
    spec: { id: addonId, name: 'Patagonia Bush Plane', ultimateLoad: { min: -2, max: 5 } },
  }]);

  const text = reportText({
    metadata: { airport: 'patagonia', aircraft: addonId, scenario: 'cruise' },
    reason: 'manual',
    durationSec: 65,
    peaks: { altitudeFt: { altitudeFt: 8500 }, iasKnots: { iasKnots: 115 }, gForce: { gForce: 1.4 } },
    touchdowns: [],
  });

  assert.match(text, /Patagonia Bush Plane/);
  assert.doesNotMatch(text, new RegExp(addonId));
  assert.ok(text.includes(t('patagonia.fitz.roy')), 'reportText must use patagonia.fitz.roy label');
  assert.doesNotMatch(text, new RegExp(t('coastal.airport')));
});

test('ReplayDirector accepts registered addon aircraft IDs for host and remote pilots', async () => {
  const addonId = 'addon_replay_test';
  registerAddonAircraft([{
    id: addonId,
    config: { id: addonId, name: 'Replay Addon Jet' },
    spec: { id: addonId, name: 'Replay Addon Jet' },
  }]);

  const samples = [0, 1, 2].map(i => ({
    timeSec: i,
    x: i * 10,
    y: 500,
    z: -i * 20,
    quat: [0, 0, 0, 1],
    iasKnots: 150,
    altitudeFt: 1640,
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    gForce: 1,
    throttle: 0.5,
    gearState: 0,
    flapIndex: 0,
    flapDegree: 0,
    elevator: 0,
    aileron: 0,
    rudder: 0,
    pitchTrim: 0,
    spoilers: 0,
    tasKnots: 155,
    groundSpeedKnots: 155,
    vsiFpm: 0,
    radioAltFt: 500,
    mach: 0.25,
    selectedHeading: 0,
    selectedAltitude: 1640,
    selectedSpeed: 150,
    onGround: false,
    touchdown: false,
    isTransit: false,
    isStalled: false,
    isPreStall: false,
    isStallWarning: false,
    reverserActive: false,
    apEngaged: false,
    parkBrake: false,
    compressions: { nose: 0, mainLeft: 0, mainRight: 0 },
    gearDamage: { nose: 'normal' },
    bodyDamage: { belly: 0 },
    engine1: { n1: 70, n2: 80, egt: 500, ff: 300, failed: false },
    engine2: { n1: 70, n2: 80, egt: 500, ff: 300, failed: false },
    visible: true,
    crashed: false,
    segment: 0,
  }));

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const sim = {
    lobby: { airport: 'coastal', aircraft: 'B738', preset: 'runway' },
    activeAirport: 'coastal',
    currentAircraftId: 'B738',
    gameFlow: { state: FLOW.FLIGHT },
    scene: new THREE.Scene(),
    flightRecorder: { active: true },
    replayRecorder: { active: true },
    position: pos,
    quaternion: quat,
    renderPose: new RenderPose(pos, quat),
    physicsAccumulator: 0,
    aircraft: { group: new THREE.Object3D() },
    currentTerrain: { isLoaded: true },
    telemetry: {},
    controls: { setAircraftControlsDisabled() {} },
    cameraSystem: { mode: 1, userModeSelected: false, userLookOverridden: false, photoCockpit: false, lookYaw: 0, lookPitch: 0, snapToTarget() {}, setMode() {} },
    sky: { timeOfDay: 12, cloudCover: 0, setTimeOfDay() {}, setCloudCover() {} },
    water: { syncWithAtmosphere() {} },
    setTimeOfDay() {},
    async fly() {},
    updateFlightDisplays() {},
  };

  const director = new ReplayDirector(sim, () => {}, {
    createRemote: () => ({ group: new THREE.Object3D(), model: { group: new THREE.Object3D() }, ready: Promise.resolve(), animate() {}, indicator: { hide() {} }, dispose() {} }),
    createEffects: () => ({ apply() {}, dispose() {} }),
  });

  const loaded = await director.load({
    intervalSec: 1,
    durationSec: 2,
    overflow: false,
    metadata: { airport: 'patagonia', aircraft: addonId, scenario: 'cruise', timeOfDay: 12 },
    remotes: [{ aircraft: addonId, name: 'Wingman', samples }],
    samples,
  });
  assert.equal(loaded, true, 'ReplayDirector.load must accept registered addon aircraft');
  director.stop();

  const rejected = await director.load({
    intervalSec: 1,
    durationSec: 2,
    overflow: false,
    metadata: { airport: 'patagonia', aircraft: 'unregistered_addon', scenario: 'cruise', timeOfDay: 12 },
    samples,
  });
  assert.equal(rejected, false, 'ReplayDirector.load must still reject unregistered aircraft');
});
