import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { F16CanyonChaseScenario, DUDH_KOSI_CANYON_SPLINE_POINTS } from '../src/director/scenarios/F16CanyonChaseScenario.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';

function fakeSimulator() {
  const inputs = {};
  const scene = new THREE.Scene();
  return {
    activeAirport: 'lukla',
    currentAircraftId: 'F16',
    scene,
    lobby: { demoProfile: 'canyon-chase' },
    position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    currentTerrain: {
      getHeight(x, z) {
        // Return realistic gorge floor around 1800m
        return 1800;
      },
      isLoaded: true
    },
    foliage: { buildingData: [] },
    aircraft: { group: new THREE.Group(), modelLoaded: true },
    aero: new Aerodynamics(F16_FALCON),
    engines: new EngineModel(F16_FALCON),
    gear: new LandingGear(F16_FALCON),
    telemetry: { pitchDeg: 0, rollDeg: 0, headingDeg: 238, iasKnots: 300, onGround: false },
    controls: {
      throttle: 1.0,
      setVirtualInput(key, value) {
        assert.ok(Number.isFinite(value), `${key} finite`);
        inputs[key] = value;
      },
      clearVirtualInputs() {
        for (const key of Object.keys(inputs)) delete inputs[key];
      },
      setParkingBrake() {}
    },
    setPreset() {},
    applyComputedTrim() {},
    cameraSystem: {
      modes: [],
      setMode(mode) { this.modes.push(mode); },
      resetDroneOrbit() {}
    },
    inputs
  };
}

describe('F16 Canyon Chase Scenario', () => {
  it('has valid, continuous 3D CatmullRom spline waypoints through Dudh Kosi gorge', () => {
    assert.ok(DUDH_KOSI_CANYON_SPLINE_POINTS.length >= 10);
    const curve = new THREE.CatmullRomCurve3(DUDH_KOSI_CANYON_SPLINE_POINTS);
    const length = curve.getLength();
    assert.ok(length > 10000 && length < 15000, `Spline length ${length}m should be 10-15km`);

    // Verify all sampled points have valid coordinates
    for (let i = 0; i <= 20; i++) {
      const p = curve.getPoint(i / 20);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      assert.ok(p.y >= 1500 && p.y <= 4000, `Altitude ${p.y} within Himalayan canyon envelope`);
    }
  });

  it('initializes in INGRESS stage, spawns adversary bandit and sets military throttle', () => {
    const sim = fakeSimulator();
    const director = new DemoFlightDirector(sim);
    director.start('lukla', 'canyon-chase');

    assert.equal(director.getActiveScenario(), director.f16CanyonScenario);
    assert.equal(director.f16CanyonScenario.result.status, 'running');
    assert.ok(director.f16CanyonScenario.target !== null);
    assert.equal(sim.controls.throttle, 1.0);
    assert.equal(sim.gear.gearState, 0);

    // Initial heading roughly southwest
    const heading = (Math.atan2(sim.linearVelocity.x, -sim.linearVelocity.z) * 180 / Math.PI + 360) % 360;
    assert.ok(heading > 220 && heading < 260, `Heading ${heading}° should face southwest into canyon`);

    director.stop();
    assert.equal(director.f16CanyonScenario.result.status, 'cancelled');
    assert.equal(director.f16CanyonScenario.target, null);
  });

  it('uses spatial progress and requires recovery before powered handoff', () => {
    const sim = fakeSimulator();
    const director = new DemoFlightDirector(sim);
    director.start('lukla', 'canyon-chase');
    const scenario = director.f16CanyonScenario;
    const stages = F16CanyonChaseScenario.STAGES;
    for (let i = 0; i < 15; i++) director.update(1);
    assert.equal(director.currentStage, stages.INGRESS, 'time alone cannot advance a stationary aircraft');
    for (let p = 0.01; p < 0.51; p += 0.01) {
      sim.position.copy(scenario.pathPoint(p));
      director.update(0.1);
    }
    assert.equal(director.currentStage, stages.SPRINT);
    sim.telemetry.rollDeg = 90;
    for (let i = 0; i < 12; i++) director.update(1);
    assert.equal(director.currentStage, stages.SPRINT, 'must recover from the roll');
    sim.telemetry.rollDeg = 0;
    director.update(0.1);
    assert.equal(director.currentStage, stages.BREAKOUT);
    sim.telemetry.pitchDeg = 40;
    for (let i = 0; i < 12; i++) director.update(1);
    assert.equal(director.currentStage, stages.BREAKOUT, 'must recover pitch before handoff');
    sim.telemetry.pitchDeg = 0;
    const velocity = sim.linearVelocity.clone(), attitude = sim.quaternion.clone();
    director.update(0.1);
    assert.equal(scenario.result.status, 'completed');
    assert.equal(scenario.target, null);
    assert.deepEqual(sim.linearVelocity, velocity);
    assert.deepEqual(sim.quaternion, attitude);
  });

  it('fails and disposes the bandit on unsafe terrain clearance', () => {
    const sim = fakeSimulator();
    const director = new DemoFlightDirector(sim);
    director.start('lukla', 'canyon-chase');
    sim.position.y = 1805;
    director.update(0.1);
    assert.equal(director.f16CanyonScenario.result.status, 'failed');
    assert.equal(director.f16CanyonScenario.target, null);
  });
});
