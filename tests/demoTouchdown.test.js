import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { EngineModel } from '../src/physics/EngineModel.js';

test('demo waits for wheel contact before deploying rollout controls', () => {
  const inputs = {};
  const reversers = [];
  const sim = {
    position: new THREE.Vector3(-1300, 15.8, 0),
    linearVelocity: new THREE.Vector3(73, -3.4, 0),
    angularVelocity: new THREE.Vector3(),
    telemetry: { altitudeFt: 52, radioAltFt: 12.4, iasKnots: 142, groundSpeedKnots: 142,
      pitchDeg: 2, rollDeg: 0, headingDeg: 90, onGround: false },
    aero: new Aerodynamics(),
    gear: new LandingGear(),
    engines: new EngineModel(),
    currentTerrain: { getHeight: () => 0 },
    controls: {
      throttle: 0.85,
      setVirtualInput: (name, value) => {
        assert.ok(Number.isFinite(value), `${name} command is not finite`);
        inputs[name] = value;
      }
    },
    cameraSystem: { setMode(mode) { this.mode = mode; } }
  };
  sim.engines.setReverser = (on, onGround) => { reversers.push([on, onGround]); };
  const director = new DemoFlightDirector(sim);  director.isActive = true;
  director.currentStage = DemoFlightDirector.STAGES.FINAL_APPROACH;
  for (const radioAltFt of [12.4, 12, 11.8]) {
    sim.telemetry.radioAltFt = radioAltFt;
    director.update(1 / 120);
    assert.equal(director.currentStage, DemoFlightDirector.STAGES.FINAL_APPROACH,
      'Radio altitude alone cannot prove wheel contact');
    assert.equal(sim.cameraSystem.mode, undefined);
  }
  // Approach thrust is retarded through the roundout instead of being carried to
  // the pavement, but the throttles are not shut from a single-frame command.
  assert.ok(inputs.throttle < sim.controls.throttle, 'throttle is retarded near the runway');
  assert.ok(inputs.throttle > 0, 'the retard is rate-limited by the engine spool, not cut');

  for (const contact of sim.gear.contacts.slice(1)) contact.isGrounded = true;
  director.update(1 / 120);
  assert.equal(director.currentStage, DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT);
  assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.GEAR);

  director.update(1 / 120);
  assert.equal(inputs.brakes, 0, 'wheel brakes wait for the nose gear to reach the pavement');
  assert.equal(sim.aero.spoilers, 0, 'spoilers wait for the nose gear to reach the pavement');
  assert.deepEqual(reversers.at(-1), [false, false], 'reversers wait for the nose gear');

  sim.gear.contacts[0].isGrounded = true;
  sim.telemetry.onGround = true;
  director.update(1 / 120);
  assert.equal(inputs.brakes, 1, 'the rollout brakes once every wheel is on the runway');
  assert.equal(sim.aero.spoilers, 1);
  assert.deepEqual(reversers.at(-1), [true, true]);
});
