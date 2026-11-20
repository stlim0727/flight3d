import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Cessna172 } from '../src/aircraft/Cessna172.js';
import { CESSNA_172, BOEING_737_800 } from '../src/config/aircraftConfigs.js';
import { CollisionDetector, C172_COLLISION_PROBES, B738_COLLISION_PROBES } from '../src/physics/CollisionDetector.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { EngineModel, asymmetricThrustYawMoment } from '../src/physics/EngineModel.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';

describe('Cessna 172 Skyhawk Aircraft Model', () => {
  it('should initialize the GLB container, lights and cockpit interface', () => {
    const c172 = new Cessna172();
    assert.ok(c172.group instanceof THREE.Group);
    assert.strictEqual(c172.group.name, 'Aircraft_Cessna172');
    assert.ok(c172.gltfGroup instanceof THREE.Group, 'GLB container must exist');
    assert.strictEqual(c172.gltfGroup.name, 'GLTF_Cessna172');
    assert.strictEqual(c172.modelLoaded, false, 'GLB has not loaded yet');
    assert.ok(c172.lightsGroup, 'Lights group must exist');
    assert.strictEqual(c172.lightsGroup.parent, c172.group, 'Lights group must be child of root group');
    assert.ok(c172.cockpit, 'Cockpit interface must exist for camera integration');
    assert.strictEqual(c172.proceduralGroup, undefined, 'No procedural airframe may exist');
    assert.doesNotThrow(() => c172.cockpit.syncLighting({ sunPosition: new THREE.Vector3(0, 1, 0) }, new THREE.Quaternion(), 1 / 60),
      'Main-loop lighting updates must remain compatible with aircraft without an interior');
  });

  it('should spin the GLB propeller without a procedural blur disk', () => {
    const c172 = new Cessna172();
    const prop = new THREE.Group();
    c172.gltfPropellers = [prop];
    c172.update(0.1, { engine1: { n1: 30.0 } });
    assert.ok(prop.rotation.z > 0, 'GLB propeller must rotate from engine RPM');
    assert.strictEqual(c172.propBlurDisk, undefined, 'No procedural blur disk may exist');
  });

  it('should toggle cockpit mode while keeping the unified GLB visible', () => {
    const c172 = new Cessna172();
    c172.setCockpitMode(true, true);
    assert.strictEqual(c172.gltfGroup.visible, true, 'GLB holds both exterior and 3D cockpit');
    assert.strictEqual(c172.cockpit.group.visible, true, 'Cockpit instruments shown in cockpit view');

    c172.setCockpitMode(false, false);
    assert.strictEqual(c172.gltfGroup.visible, true, 'GLB exterior stays visible in chase view');
    assert.strictEqual(c172.cockpit.group.visible, false, 'Cockpit instruments hidden in exterior view');
  });

  it('should manage crash visuals and light state', () => {
    const c172 = new Cessna172();
    assert.strictEqual(c172.isCrashed, false);
    assert.strictEqual(c172.lightsGroup.visible, true);

    c172.triggerCrashVisuals('terrain');
    assert.strictEqual(c172.isCrashed, true);
    assert.strictEqual(c172.lightsGroup.visible, false, 'Lights extinguish on impact');

    c172.resetCrashVisuals();
    assert.strictEqual(c172.isCrashed, false);
    assert.strictEqual(c172.lightsGroup.visible, true, 'Lights and airframe restored on reset');
  });

  it('should prevent fixed landing gear from retracting', () => {
    const gear = new LandingGear(CESSNA_172);
    assert.strictEqual(gear.isFixed, true);
    assert.strictEqual(gear.gearState, 1.0);
    assert.strictEqual(gear.targetGearState, 1.0);

    // Try toggling gear
    gear.toggleGear();
    assert.strictEqual(gear.targetGearState, 1.0, 'Fixed gear ignores toggleGear');

    // Try setting target to retracted
    gear.setGearTarget(false);
    assert.strictEqual(gear.targetGearState, 1.0, 'Fixed gear ignores setGearTarget(false)');
    assert.strictEqual(gear.gearState, 1.0);

    // Update step maintains deployed state
    const mesh = new THREE.Object3D();
    gear.update(0.1, mesh, new THREE.Vector3(), new THREE.Vector3(), () => 0);
    assert.strictEqual(gear.gearState, 1.0);
    assert.strictEqual(gear.isTransit, false);
  });

  it('should configure collision probe points for C172 airframe dimensions', () => {
    const cd = new CollisionDetector();
    assert.strictEqual(cd.probePoints.length, B738_COLLISION_PROBES.length);

    cd.loadAircraftConfig(CESSNA_172);
    assert.strictEqual(cd.probePoints.length, C172_COLLISION_PROBES.length);
    const wingL = cd.probePoints.find(p => p.id === 'wingL');
    assert.ok(wingL, 'Left wingtip probe exists');
    assert.strictEqual(wingL.pos.x, -5.5, 'C172 wing probe uses ~11m wingspan, not 34m 737 span');
    assert.strictEqual(wingL.radius, 0.5);
  });

  it('should yield zero asymmetric thrust yaw moment for single-engine aircraft', () => {
    // Single engine centerline thrust arm = 0.0
    const yawMoment = asymmetricThrustYawMoment(3200, 0, CESSNA_172.propulsion.momentArmMeters);
    assert.strictEqual(yawMoment, 0.0, 'Centerline engine produces no asymmetric yaw moment');
  });

  it('should retain C172 and choose its scenario when DemoFlightDirector starts', () => {
    let switchedAircraft = null;
    const fakeSim = {
      currentAircraftId: 'C172',
      activeAirport: 'lukla',
      luklaAirport: true,
      setAircraft: (id) => { switchedAircraft = id; fakeSim.currentAircraftId = id; },
      controls: { setAircraftControlsDisabled: () => {}, setVirtualInput: () => {} },
      autopilot: { disengage: () => {} },
      cameraSystem: { setMode: () => {} },
      sky: { getSunDirection: () => new THREE.Vector3(), setTimeOfDay: () => {} },
      engines: { setThrottle: () => {} },
      gear: { setBrakes: () => {} }
    };
    const director = new DemoFlightDirector(fakeSim);
    let entered = false;
    director.cessnaScenario.enterStage = () => { entered = true; };
    director.start('lukla');
    assert.strictEqual(switchedAircraft, null, 'Selected aircraft is preserved');
    assert.strictEqual(director.getActiveScenario(), director.cessnaScenario);
    assert.strictEqual(entered, true);
  });

  it('should scale fuel flow and capacity correctly for Cessna 172 propulsion', () => {
    const engines = new EngineModel(CESSNA_172);
    assert.strictEqual(engines.numEngines, 1);
    assert.strictEqual(engines.fuelCapacityKg, 144.0);

    // At idle (throttle = 0)
    engines.setThrottle(0.0);
    for (let i = 0; i < 20; i++) engines.update(0.1, 0, 0, 1.0);
    assert.ok(engines.fuelFlow[0] <= 32.0, `Idle fuel flow should be near 28 kg/h, got ${engines.fuelFlow[0]}`);

    // At full throttle TOGA (throttle = 1.0)
    engines.setThrottle(1.0);
    for (let i = 0; i < 30; i++) engines.update(0.1, 0, 45, 1.0);
    assert.ok(engines.fuelFlow[0] <= 55.0, `TOGA fuel flow should be near 48 kg/h, not 2500 kg/h, got ${engines.fuelFlow[0]}`);
    assert.ok(engines.fuelFlow[0] >= 40.0);
  });

  it('should dynamically update flap detent angles when loading C172 config in Aerodynamics', () => {
    const aero = new Aerodynamics(BOEING_737_800);
    assert.strictEqual(aero.flapAngles.length, 7);
    aero.setFlapPosition(5); // Flaps 30

    aero.loadConfig(CESSNA_172);
    assert.deepStrictEqual(aero.flapAngles, [0, 10, 20, 30]);
    assert.ok(aero.flapsIndex <= 3, 'Flap index clamped within C172 detent count');
    assert.strictEqual(aero.currentFlapAngle, aero.flapAngles[aero.flapsIndex]);
  });

  it('should report cockpitModelFailed = true to allow camera fallback to chase view', () => {
    const c172 = new Cessna172();
    assert.strictEqual(c172.cockpit.cockpitModelFailed, true, 'Flags missing 3D cockpit model for auto-fallback');
  });

  it('should provide calibrated resting CG height for gentle runway contact', () => {
    const gear = new LandingGear(CESSNA_172);
    assert.strictEqual(gear.cgGroundHeightM, 1.35, 'C172 resting CG ground height is 1.35m');
  });

  it('should have optimized c172.glb model with valid license attribution', () => {
    const glbPath = 'public/models/c172.glb';
    assert.ok(fs.existsSync(glbPath), 'public/models/c172.glb must exist');
    const stat = fs.statSync(glbPath);
    assert.ok(stat.size > 5 * 1024 * 1024 && stat.size < 15 * 1024 * 1024, `c172.glb size ${stat.size} should be ~8.3MB Draco compressed`);

    const licPath = 'public/models/c172.LICENSE.txt';
    assert.ok(fs.existsSync(licPath), 'public/models/c172.LICENSE.txt must exist');
    const licContent = fs.readFileSync(licPath, 'utf8');
    assert.ok(licContent.includes('NLM'), 'License must cite author NLM');
    assert.ok(licContent.includes('CC BY 4.0'), 'License must cite CC BY 4.0');
  });

  it('should toggle pilot yokes visibility via cockpit interface', () => {
    const c172 = new Cessna172();
    assert.strictEqual(c172.cockpit.yokesVisible, true);

    const yoke1 = new THREE.Object3D();
    const yoke2 = new THREE.Object3D();
    c172.cockpit.gltfYokes = [yoke1, yoke2];

    const state1 = c172.cockpit.toggleYokes();
    assert.strictEqual(state1, false);
    assert.strictEqual(c172.cockpit.yokesVisible, false);
    assert.strictEqual(yoke1.visible, false);
    assert.strictEqual(yoke2.visible, false);

    const state2 = c172.cockpit.toggleYokes();
    assert.strictEqual(state2, true);
    assert.strictEqual(c172.cockpit.yokesVisible, true);
    assert.strictEqual(yoke1.visible, true);
    assert.strictEqual(yoke2.visible, true);
  });

  it('should configure authentic cockpit eye view behind left pilot yoke', () => {
    assert.strictEqual(CESSNA_172.cockpit.captainEyePos.x, -0.22, 'Captain eye inline with left seat center');
    assert.strictEqual(CESSNA_172.cockpit.captainEyePos.y, 0.72, 'Captain eye above the panel for a forward view');
    assert.strictEqual(CESSNA_172.cockpit.captainEyePos.z, -1.18, 'Captain eye seated in chair');
    assert.ok(CESSNA_172.cockpit.defaultLookPitchRad <= 0, 'Slight downward pitch to frame flight instruments');
  });

  it('should accept PFD and ND canvases and store them for live glass-cockpit display', () => {
    const fakePfd = { texture: new THREE.Texture() };
    const fakeNd = { texture: new THREE.Texture() };
    const c172 = new Cessna172(fakePfd, fakeNd);
    assert.strictEqual(c172.pfdCanvas, fakePfd);
    assert.strictEqual(c172.ndCanvas, fakeNd);
  });

  it('should exclude transparent GLB window panes from casting shadows', (t) => {
    const c172 = new Cessna172();
    const scene = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ name: 'Window', transparent: true, opacity: 0.2 }));
    const skin = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    scene.add(glass, skin);
    let completeLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, onLoad) => { completeLoad = onLoad; });
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      c172.loadGltfModel('/test.glb');
      completeLoad({ scene });
      assert.strictEqual(glass.castShadow, false, 'Transparent glass must not cast shadow');
      assert.strictEqual(glass.receiveShadow, false, 'Transparent glass must not receive shadow');
      assert.strictEqual(skin.castShadow, true, 'Opaque GLB skin must cast shadow');
      assert.strictEqual(c172.modelLoaded, true);
      assert.strictEqual(c172.cockpit.cockpitModelFailed, false);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('reports a failed GLB load without revealing a procedural airframe', async (t) => {
    const c172 = new Cessna172();
    let failLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, _onLoad, _onProgress, onError) => { failLoad = onError; });
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      c172.loadGltfModel('/missing.glb');
      assert.strictEqual(c172.loadingGltf, true);
      failLoad(new Error('Network error'));
      await c172.ready;
      assert.strictEqual(c172.loadingGltf, false);
      assert.strictEqual(c172.modelLoaded, false);
      assert.strictEqual(c172.gltfGroup.children.length, 0, 'No procedural airframe may appear');
      assert.strictEqual(c172.cockpit.cockpitModelFailed, true, 'Camera must still learn that no 3D cockpit arrived');
      assert.ok(errors.some(args => String(args[0]).includes('GLB model failed')), 'The load error must be reported');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('should keep cockpit group visible in cockpit mode even if showInterior is false', () => {
    const c172 = new Cessna172();
    c172.setCockpitMode(true, false);
    assert.strictEqual(c172.cockpit.group.visible, true, '3D instruments must stay visible');

    c172.setCockpitMode(false, false);
    assert.strictEqual(c172.cockpit.group.visible, false, 'Cockpit group hidden in exterior view');
  });

  it('should specify hasPhotoCockpit: false in CESSNA_172 configuration', () => {
    assert.strictEqual(CESSNA_172.cockpit.hasPhotoCockpit, false);
    assert.strictEqual(BOEING_737_800.cockpit.hasPhotoCockpit, true);
  });
});
