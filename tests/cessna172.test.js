import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Cessna172 } from '../src/aircraft/Cessna172.js';
import { CESSNA_172, BOEING_737_800 } from '../src/config/aircraftConfigs.js';
import { CollisionDetector, C172_COLLISION_PROBES, B738_COLLISION_PROBES } from '../src/physics/CollisionDetector.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { EngineModel, asymmetricThrustYawMoment } from '../src/physics/EngineModel.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';

describe('Cessna 172 Skyhawk Aircraft Model', () => {
  it('should initialize procedural hierarchy with all subassemblies', () => {
    const c172 = new Cessna172();
    assert.ok(c172.group instanceof THREE.Group);
    assert.strictEqual(c172.group.name, 'Aircraft_Cessna172');
    assert.doesNotThrow(() => c172.cockpit.syncLighting({ sunPosition: new THREE.Vector3(0, 1, 0) }, new THREE.Quaternion(), 1 / 60),
      'Main-loop lighting updates must remain compatible with aircraft without an interior');

    assert.ok(c172.fuselageGroup, 'Fuselage group must exist');
    assert.ok(c172.wingGroup, 'High-wing group must exist');
    assert.ok(c172.tailGroup, 'Tail empennage group must exist');
    assert.ok(c172.gearGroup, 'Landing gear group must exist');
    assert.ok(c172.propellerGroup, 'Propeller group must exist');
    assert.ok(c172.lightsGroup, 'Lights group must exist');
    assert.strictEqual(c172.lightsGroup.parent, c172.group, 'Lights group must be child of root group to persist across model changes');
    assert.ok(c172.cockpit, 'Cockpit interface must exist for engine compatibility');
  });

  it('should have all articulated control surfaces and steerable gear', () => {
    const c172 = new Cessna172();
    assert.ok(c172.aileronL, 'Left aileron exists');
    assert.ok(c172.aileronR, 'Right aileron exists');
    assert.ok(c172.flapL, 'Left flap exists');
    assert.ok(c172.flapR, 'Right flap exists');
    assert.ok(c172.elevatorL, 'Left elevator exists');
    assert.ok(c172.elevatorR, 'Right elevator exists');
    assert.ok(c172.rudder, 'Rudder exists');
    assert.ok(c172.noseFork, 'Steerable nose fork exists');
  });

  it('should animate propeller spin and blur disk based on engine state', () => {
    const c172 = new Cessna172();
    const initialAngle = c172.propAngle;

    // Simulate idle running
    c172.update(0.1, { engine1: { n1: 30.0 } });
    assert.ok(c172.propAngle > initialAngle, 'Propeller spins forward during engine idle');
    assert.strictEqual(c172.propBlurDisk.material.opacity, 0.0, 'Blur disk is transparent at low RPM');

    // Simulate full throttle (TOGA 100% N1)
    for (let i = 0; i < 10; i++) {
      c172.update(0.1, { engine1: { n1: 100.0 } });
    }
    assert.ok(c172.propBlurDisk.material.opacity > 0.1, 'Blur disk fades in at high RPM');
  });

  it('should deflect ailerons, elevators, rudder, and flaps according to flight controls', () => {
    const c172 = new Cessna172();

    // Command right bank (aileron = 1.0)
    c172.update(0.016, { aileron: 1.0, elevator: 0.0, rudder: 0.0, flapDegree: 0 });
    assert.ok(c172.aileronL.rotation.x > 0, 'Left aileron deflects down (+X) to increase lift');
    assert.ok(c172.aileronR.rotation.x < 0, 'Right aileron deflects up (-X) to dump lift');

    // Command pitch up (stick back, elevator = 1.0)
    c172.update(0.016, { aileron: 0.0, elevator: 1.0, rudder: 0.0, flapDegree: 0 });
    assert.ok(c172.elevatorL.rotation.x < 0, 'Elevator deflects up for pitch up');
    assert.ok(c172.elevatorR.rotation.x < 0, 'Right elevator tracks left elevator');

    // Command right yaw (rudder = 1.0)
    c172.update(0.016, { aileron: 0.0, elevator: 0.0, rudder: 1.0, flapDegree: 0 });
    assert.ok(c172.rudder.rotation.y < 0, 'Rudder deflects trailing edge left');

    // Command flaps 20 degrees
    c172.update(0.016, { aileron: 0.0, elevator: 0.0, rudder: 0.0, flapDegree: 20 });
    assert.ok(c172.flapL.rotation.x > 0.3, 'Flap L deploys downward');
    assert.ok(c172.flapR.rotation.x > 0.3, 'Flap R deploys downward');

    // Steer nose wheel on ground
    c172.update(0.016, { rudder: 1.0, onGround: true });
    assert.ok(Math.abs(c172.noseFork.rotation.y) > 0.1, 'Nose gear steers with rudder on ground');

    // Nose wheel centers in the air
    c172.update(0.016, { rudder: 1.0, onGround: false });
    assert.strictEqual(c172.noseFork.rotation.y, 0, 'Nose gear centers when airborne');
  });

  it('should toggle cockpit mode cleanly and prevent interior clipping', () => {
    const c172 = new Cessna172();
    assert.strictEqual(c172.fuselageGroup.visible, true);

    c172.setCockpitMode(true, true);
    assert.strictEqual(c172.fuselageGroup.visible, false, 'Fuselage exterior hidden in cockpit view');
    assert.strictEqual(c172.cockpit.group.visible, true, 'Cockpit interior shown in cockpit view');

    c172.setCockpitMode(false, false);
    assert.strictEqual(c172.fuselageGroup.visible, true, 'Fuselage exterior restored in exterior view');
    assert.strictEqual(c172.cockpit.group.visible, false, 'Cockpit interior hidden in exterior view');
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

  it('should exclude transparent windshield and window panes from casting shadows', () => {
    const c172 = new Cessna172();
    let transparentGlassCount = 0;
    c172.proceduralGroup.traverse(child => {
      if (child.isMesh && (child.material.transparent || child.material.opacity < 0.95)) {
        transparentGlassCount++;
        assert.strictEqual(child.castShadow, false, 'Transparent glass must not cast shadow');
        assert.strictEqual(child.receiveShadow, false, 'Transparent glass must not receive shadow');
      }
    });
    assert.ok(transparentGlassCount > 0, 'Found procedural window glass meshes');
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
