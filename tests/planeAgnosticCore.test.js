import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  AIRCRAFT_REGISTRY,
  BOEING_737_800,
  F16_FALCON,
  CESSNA_172,
  DEFAULT_AIRCRAFT_ID
} from '../src/config/aircraftConfigs.js';
import { EngineModel, asymmetricThrustYawMoment } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

describe('Plane-Agnostic Core Infrastructure', () => {
  describe('AIRCRAFT_REGISTRY & Configurations', () => {
    it('should export valid registered aircraft configurations', () => {
      assert.ok(AIRCRAFT_REGISTRY[DEFAULT_AIRCRAFT_ID], 'Default aircraft (B738) must be registered');
      assert.ok(AIRCRAFT_REGISTRY.F16, 'F-16 must be registered');
      assert.ok(AIRCRAFT_REGISTRY.C172, 'Cessna 172 must be registered');
    });

    it('each aircraft configuration should satisfy the full AircraftConfig schema', () => {
      for (const [id, config] of Object.entries(AIRCRAFT_REGISTRY)) {
        assert.strictEqual(config.id, id);
        assert.ok(config.name, `${id} must have a name`);
        assert.ok(config.description, `${id} must have a description`);

        // Mass properties
        assert.ok(config.massProperties.currentMassKg > 0);
        assert.ok(config.massProperties.Ixx > 0);
        assert.ok(config.massProperties.Iyy > 0);
        assert.ok(config.massProperties.Izz > 0);

        // Aerodynamics
        assert.ok(config.aerodynamics.wingspanM > 0);
        assert.ok(config.aerodynamics.wingAreaM2 > 0);
        assert.ok(config.aerodynamics.claPerRad > 0);
        assert.ok(Array.isArray(config.aerodynamics.flapAngles));

        // Propulsion
        assert.ok(config.propulsion.numEngines >= 1);
        assert.ok(config.propulsion.maxStaticThrustPerEngineN > 0);
        assert.ok(config.propulsion.fuelCapacityKg > 0);

        // Landing Gear
        assert.ok(Array.isArray(config.landingGear.contacts));
        assert.strictEqual(config.landingGear.contacts.length, 3, `${id} should have tricycle contacts`);

        // Cockpit
        assert.ok(typeof config.cockpit.captainEyePos.x === 'number');
        assert.ok(typeof config.cockpit.captainEyePos.y === 'number');
        assert.ok(typeof config.cockpit.captainEyePos.z === 'number');
        assert.ok(config.cockpit.chaseDistance > 0);
      }
    });
  });

  describe('EngineModel Dynamic Configuration', () => {
    it('should configure single-engine jet (F-16) correctly', () => {
      const engines = new EngineModel(F16_FALCON);
      assert.strictEqual(engines.numEngines, 1);
      assert.strictEqual(engines.maxStaticThrustPerEngine, 131000.0);
      assert.strictEqual(engines.n1.length, 1);
      assert.strictEqual(engines.thrust.length, 1);
      assert.strictEqual(engines.failed.length, 1);

      engines.setThrottle(1.0);
      // Spool for 2 seconds
      for (let t = 0; t < 20; t++) {
        engines.update(0.1, 0, 0, 1.0);
      }
      assert.ok(engines.thrust[0] > 100000, 'F-16 engine generates >100 kN thrust');
      assert.ok(!Number.isNaN(engines.fuelKg), 'Fuel level remains a valid number');
      assert.ok(engines.fuelKg < engines.fuelCapacityKg, 'Fuel burns during operation');
    });

    it('should configure single-engine piston (Cessna 172) correctly', () => {
      const engines = new EngineModel(CESSNA_172);
      assert.strictEqual(engines.numEngines, 1);
      assert.strictEqual(engines.maxStaticThrustPerEngine, 3200.0);
      assert.strictEqual(engines.n1.length, 1);

      engines.setThrottle(1.0);
      for (let t = 0; t < 15; t++) {
        engines.update(0.1, 0, 0, 1.0);
      }
      assert.ok(engines.thrust[0] > 2800, 'C172 engine generates near max thrust (~3.2 kN)');
      assert.strictEqual(asymmetricThrustYawMoment(engines.thrust[0], undefined), 0, 'No asymmetric yaw for single engine');
    });

    it('should support dynamic reconfiguration via loadConfig', () => {
      const engines = new EngineModel(); // Default B738 (2 engines)
      assert.strictEqual(engines.numEngines, 2);

      engines.loadConfig(F16_FALCON);
      assert.strictEqual(engines.numEngines, 1);
      assert.strictEqual(engines.maxStaticThrustPerEngine, 131000.0);

      engines.loadConfig(BOEING_737_800);
      assert.strictEqual(engines.numEngines, 2);
      assert.strictEqual(engines.maxStaticThrustPerEngine, 121000.0);
    });
  });

  describe('LandingGear Dynamic Configuration', () => {
    it('should load custom gear contacts and dimensions from aircraft config', () => {
      const gear = new LandingGear(F16_FALCON);
      assert.strictEqual(gear.contacts.length, 3);

      const nose = gear.contacts.find(c => c.id === 'nose');
      assert.ok(nose, 'Nose gear exists');
      assert.strictEqual(nose.localPos.z, -2.35, 'F-16 nose contact matches the mounted GLB wheel');
      assert.strictEqual(nose.isSteerable, true);

      const mainLeft = gear.contacts.find(c => c.id === 'mainLeft');
      assert.strictEqual(mainLeft.localPos.x, -1.1, 'F-16 wheel track is narrower than airliner');
    });

    it('should support fast or fixed gear transit times', () => {
      const gear = new LandingGear(CESSNA_172);
      assert.strictEqual(gear.isFixed, true);
      assert.strictEqual(gear.gearState, 1.0);

      gear.toggleGear();
      const mockMesh = new THREE.Object3D();
      mockMesh.position.set(0, 50, 0);
      mockMesh.updateMatrixWorld();
      gear.update(0.15, mockMesh, new THREE.Vector3(), new THREE.Vector3(), () => 0);
      assert.strictEqual(gear.gearState, 1.0, 'Fixed gear stays down and locked');

      // Retractable fast transit gear cycles
      const fastGear = new LandingGear({ landingGear: { isFixed: false, gearTransitTimeSec: 0.1 } });
      assert.ok(fastGear.gearTransitSpeed >= 10.0, 'Fast gear transit speed is near-instantaneous');
      fastGear.toggleGear();
      fastGear.update(0.15, mockMesh, new THREE.Vector3(), new THREE.Vector3(), () => 0);
      assert.strictEqual(fastGear.gearState, 0.0, 'Retractable fast gear cycles instantly');
    });

    it('should load custom friction parameters from config', () => {
      const gear = new LandingGear(F16_FALCON);
      assert.strictEqual(gear.maxBrakingFriction, 0.55);
      assert.strictEqual(gear.tireLateralFriction, 0.80);
    });
  });

  describe('CameraSystem Dynamic Configuration', () => {
    it('should dynamically adapt camera chase and cockpit offsets to aircraft size', () => {
      const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 10000);
      const domElement = { addEventListener() {}, removeEventListener() {} };
      const cameraSystem = new CameraSystem(camera, domElement);

      // Verify B738 default
      cameraSystem.loadAircraftConfig(BOEING_737_800);
      assert.strictEqual(cameraSystem.chaseDistance, 55.0);
      assert.strictEqual(cameraSystem.chaseHeight, 10.5);
      assert.strictEqual(cameraSystem.cockpitHeadOffset.z, -12.35);

      // Switch to F-16 (compact fighter)
      cameraSystem.loadAircraftConfig(F16_FALCON);
      assert.strictEqual(cameraSystem.chaseDistance, 18.0);
      assert.strictEqual(cameraSystem.chaseHeight, 4.5);
      assert.strictEqual(cameraSystem.cockpitHeadOffset.z, -3.35);

      // Switch to Cessna 172 (light trainer with 3D cockpit)
      cameraSystem.loadAircraftConfig(CESSNA_172);
      assert.strictEqual(cameraSystem.chaseDistance, 14.0);
      assert.strictEqual(cameraSystem.chaseHeight, 3.2);
      assert.strictEqual(cameraSystem.cockpitHeadOffset.z, -1.18);
    });
  });

  describe('Aerodynamics Parameter Ingestion', () => {
    it('should configure F-16 high-AoA vortex stall and control sensitivities', () => {
      const aero = new Aerodynamics(F16_FALCON);
      assert.strictEqual(aero.wingspan, 9.96);
      assert.strictEqual(aero.alphaStallClean, THREE.MathUtils.degToRad(28.0));
      assert.strictEqual(aero.gearDrag, 0.030);
      assert.strictEqual(aero.spoilerDrag, 0.080);
      assert.strictEqual(aero.transonicMachBuffet, 0.95);
    });

    it('should configure Cessna 172 low-speed flight characteristics', () => {
      const aero = new Aerodynamics(CESSNA_172);
      assert.strictEqual(aero.wingspan, 11.0);
      assert.strictEqual(aero.alphaStallClean, THREE.MathUtils.degToRad(14.0));
      assert.strictEqual(aero.CL0_clean, 0.35);
      assert.strictEqual(aero.CD0, 0.027);
    });
  });
});
