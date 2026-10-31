import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { SimulatorMissionAdapter } from '../src/arena/SimulatorMissionAdapter.js';

function simulation() {
  const controls = {
    elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakes: 0, pitchTrim: 1.6,
    aircraftControlsDisabled: false, inputBlocked: false,
    clearVirtualInputs() { this.virtualElevator = this.virtualAileron = this.virtualRudder = this.virtualBrakes = null; },
    releaseAllKeys() {}, setTouchStick() {}, setTouchRudder() {}, setTouchBrakes() {},
    setParkingBrake(v) { this.parkingBrake = v; },
    setAircraftControlsDisabled(v) { this.aircraftControlsDisabled = v; },
    setVirtualInput(axis, value) { this[`virtual${axis[0].toUpperCase()}${axis.slice(1)}`] = value; if (axis === 'throttle') this.throttle = value; },
  };
  const sim = {
    controls, aero: new Aerodynamics(), engines: new EngineModel(), gear: new LandingGear(),
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    physicsDt: 1 / 120, currentTerrain: { getHeight: () => 12 },
    aircraft: { group: new THREE.Object3D() }, renderPose: { reset() {} },
    autopilot: { master: false, disengage() { this.master = false; } },
    demoDirector: { isActive: false, stop() { this.isActive = false; } },
    setAirport(id) { this.activeAirport = id; },
    setAircraft(id) { this.currentAircraftId = id; },
    setPreset(type) { this.preset = type; this.gear.resetContacts(); },
    integratePhysics() {
      this.preparationTicks = (this.preparationTicks ?? 0) + 1;
      for (const c of this.gear.contacts) {
        c.isGrounded = this.preset === 'runway';
        c.sinkRateMs = 0;
        c.worldPos.copy(c.localPos).applyQuaternion(this.quaternion).add(this.position);
      }
      this.missionPhysicsFrame = { gearResult: { bodyContacts: [] } };
    },
  };
  return sim;
}

test('takeoff preparation uses a stable new scenario and does not trust stale telemetry', async () => {
  const sim = simulation();
  sim.telemetry = { iasKnots: 999, headingDeg: 0, radioAltFt: 999 };
  const adapter = new SimulatorMissionAdapter(sim);
  const { manifest, initialSnapshot } = await adapter.prepare({ missionId: 'takeoff-basic-v1', environmentProfile: 'calm-debug-v1' });
  assert.equal(sim.preparationTicks, 120);
  assert.equal(initialSnapshot.tick, 0);
  assert.equal(initialSnapshot.iasKnots, 0);
  assert.equal(initialSnapshot.headingDeg, 90);
  assert.equal(initialSnapshot.weightOnWheels, true);
  assert.equal(manifest.calibration, 'limited-training-suite-v1');
  assert.ok(manifest.configuredState.massKg > 0);
  assert.equal(sim.controls.aircraftControlsDisabled, false);
  adapter.acquire();
  assert.equal(sim.controls.aircraftControlsDisabled, true);
  adapter.apply({ elevator: .2, aileron: -.1, rudder: .3, throttle: .8, brakes: 0 });
  assert.equal(sim.controls.virtualElevator, .2);
  assert.equal(sim.controls.throttle, .8);
  assert.throws(() => adapter.apply({ elevator: .4, aileron: NaN, rudder: 0, throttle: 1, brakes: 0 }), /invalid-command/);
  assert.equal(sim.controls.virtualElevator, .2, 'rejection is atomic');
  sim.controls.throttle = .01; // A stale pointer drag cannot steal the target.
  adapter.step();
  assert.equal(sim.controls.throttle, .8);
  const contact = sim.gear.contacts.find(c => c.id === 'mainLeft');
  contact.sinkRateMs = .17;
  assert.equal(adapter.snapshot(1).gearContacts.find(c => c.id === 'mainLeft').sinkRateMs, .17);
  delete contact.sinkRateMs;
  assert.throws(() => adapter.snapshot(1), /missing contact sink rate/);
  adapter.release();
  assert.equal(sim.controls.aircraftControlsDisabled, false);
  assert.equal(sim.controls.inputBlocked, false);
  assert.equal(sim.controls.virtualElevator, null);
  assert.equal(sim.controls.throttle, .8, 'release retains the last throttle rather than inventing an idle action');
  assert.equal(sim.windField, null);
  assert.throws(() => adapter.step(), /does-not-own/);
});

test('landing uses a live trim solution, airborne geometry and crosswind crab', async () => {
  const sim = simulation();
  const adapter = new SimulatorMissionAdapter(sim);
  const { manifest, initialSnapshot: s } = await adapter.prepare({ missionId: 'landing-basic-v1', seed: 6 });
  assert.equal(sim.preparationTicks, undefined, 'approach preparation does not advance an unstable stale preset');
  assert.equal(s.weightOnWheels, false);
  assert.ok(s.radioAltFt > 500);
  assert.ok(Math.abs(s.runwayS + 3000) < 1e-10);
  assert.ok(s.vsiFpm < 0);
  assert.ok(s.headingDeg < 90, 'nose crabs into a right-blowing crosswind');
  assert.ok(Math.abs(sim.linearVelocity.z) < 1e-10, 'initial mean-wind ground track follows centerline');
  assert.equal(manifest.fixedConfiguration.flapIndex, 5);
  assert.ok(Number.isFinite(manifest.fixedConfiguration.pitchTrimDeg));
  assert.ok(manifest.configuredState.controls.throttle > 0);
  const record = structuredClone(s);
  sim.position.x += 100;
  assert.deepEqual(s, record, 'snapshot retains no mutable simulator references');
});

test('invalid scenario and control conflicts fail instead of creating a successful run', async () => {
  const sim = simulation();
  const adapter = new SimulatorMissionAdapter(sim);
  await assert.rejects(adapter.prepare({ missionId: 'unknown' }), /invalid-scenario/);
  sim.currentTerrain.isLoaded = false;
  await assert.rejects(adapter.prepare({ missionId: 'landing-basic-v1' }), /not ready/);
  sim.currentTerrain.isLoaded = true;
  await adapter.prepare({ missionId: 'takeoff-basic-v1' });
  adapter.acquire();
  sim.autopilot.master = true;
  assert.throws(() => adapter.step(), /control-conflict/);
  sim.autopilot.master = false;
  sim.aero.flapsIndex = 0;
  assert.throws(() => adapter.step(), /fixed-configuration-changed/);
  adapter.release();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.prepare({ missionId: 'landing-basic-v1', signal: controller.signal }), /preparation-aborted/);
  await adapter.prepare({ missionId: 'landing-basic-v1' });
  assert.ok(sim.windField);
  adapter.release();
  assert.equal(sim.windField, null, 'startup abort cleanup also clears prepared wind without requiring acquire');
});
