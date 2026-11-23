import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import {
  F16GimpoScenario, gimpoApproach, gimpoApproachPhase, gimpoDecelerationThrottle,
  nextRolloutPitch,
} from '../src/director/scenarios/F16GimpoScenario.js';

const D = Math.PI / 180;
const OFFSET = [1000, 2000];
const HEADING = 135.5;
const THRESHOLD = { x: 100, z: 200, elevationM: 10.36 };
const runwayRegion = () => {
  const end = { x: THRESHOLD.x + Math.sin(HEADING * D) * 3200,
    z: THRESHOLD.z - Math.cos(HEADING * D) * 3200, elevationM: 12.5 };
  return { terrain: { runways: [{ ends: [{ threshold: THRESHOLD }, { threshold: end }] }] } };
};

function createSim(region = runwayRegion()) {
  const inputs = {};
  const sim = {
    activeAirport: 'incheon', currentAircraftId: 'F16',
    lobby: { destination: 'none', demoProfile: 'gimpo-sortie' },
    destinationAirport: 'none',
    position: new THREE.Vector3(OFFSET[0] + THRESHOLD.x, 10, OFFSET[1] + THRESHOLD.z),
    linearVelocity: new THREE.Vector3(60, 0, 60), angularVelocity: new THREE.Vector3(),
    telemetry: { altitudeFt: 34, radioAltFt: 1000, iasKnots: 200, tasKnots: 200,
      headingDeg: HEADING, rollDeg: 0, pitchDeg: 0, onGround: true, groundSpeedKnots: 200,
      gearState: 1, touchdown: false },
    totalSimTime: 0, isCrashed: false, crashResult: null,
    currentTerrain: { getHeight: () => 10 },
    currentAirport: { isOnRunway: () => true },
    cameraSystem: { mode: 0, setMode(mode) { this.mode = mode; } },
    controls: {
      setVirtualInput(k, v) { assert.ok(Number.isFinite(v), `${k} is finite`); inputs[k] = v; },
      clearVirtualInputs() { for (const k of Object.keys(inputs)) delete inputs[k]; },
      getVirtualInput(k) { return inputs[k]; },
    },
    gear: new LandingGear(), aero: new Aerodynamics(), engines: new EngineModel(),
    autopilot: {
      master: false, lateralMode: null, targets: {},
      engage(mode) { this.master = true; if (mode === 'HDG' || mode === 'LNAV') this.lateralMode = mode; },
      disengage() { this.master = false; }, reset() {}, refreshTrim() {},
      annunciation() { return ''; },
    },
    airportStreamer: { regionFor: () => region, ensure() {} },
    world: { offsets: new Map([['RKSS', OFFSET]]) },
    readAutopilotState: () => ({}),
    setPreset() {}, updateHUD() {}, showToast() {}, setAirport(id) { this.activeAirport = id; },
  };
  sim.autopilot.readAutopilotState = () => ({});
  return sim;
}

function createHarness(stage = F16GimpoScenario.STAGES.PREPARE, sim = createSim()) {
  let stopCalls = 0;
  const director = {
    currentStage: stage, totalTimer: 0,
    updateBanner() {},
    setStage(next) { this.currentStage = next; scenario.enterStage(next); },
    stop() { stopCalls++; },
  };
  const scenario = new F16GimpoScenario(director, sim);
  scenario.syncRoute();
  scenario.enterStage(stage);
  return { sim, director, scenario, stopCalls: () => stopCalls };
}

/** Place the aircraft relative to the RW14R local frame, in metres. */
function pose(sim, { along = 0, cross = 0, y = 40, headingDeg = HEADING } = {}) {
  const x = THRESHOLD.x - Math.sin(HEADING * D) * along + Math.cos(HEADING * D) * cross;
  const z = THRESHOLD.z + Math.cos(HEADING * D) * along + Math.sin(HEADING * D) * cross;
  sim.position.set(OFFSET[0] + x, y, OFFSET[1] + z);
  sim.telemetry.headingDeg = headingDeg;
}

describe('F-16 Incheon → Gimpo demo', () => {
  it('derives the streamed RW14R course and guards final laterally', () => {
    const data = gimpoApproach(runwayRegion());
    assert.ok(Math.abs(data.headingDeg - HEADING) < 0.01, `course ${data.headingDeg}`);
    assert.deepEqual(data.threshold, { x: THRESHOLD.x, z: THRESHOLD.z });
    assert.ok(Math.abs(data.elevationFt - 10.36 / 0.3048) < 0.01);
    assert.equal(gimpoApproachPhase(-13451, 320), 'intercept');
    assert.equal(gimpoApproachPhase(200, 4000), 'final');
    assert.equal(gimpoApproachPhase(0, 60000), 'enroute');
    assert.equal(gimpoApproach(null), null);
    assert.ok(gimpoDecelerationThrottle(250, 145, true) >= 0.15);
    assert.equal(nextRolloutPitch(6.8, 0.05), 6.7);
  });

  it('starts from the lobby profile and forces RKSS through the director', () => {
    const sim = createSim();
    const director = new DemoFlightDirector(sim);
    assert.equal(director.start('incheon', 'gimpo-sortie'), undefined);
    assert.equal(director.isActive, true);
    assert.equal(director.profile, 'gimpo-sortie');
    assert.equal(director.getActiveScenario(), director.f16GimpoScenario);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.PREPARE);
    assert.equal(sim.lobby.destination, 'RKSS');
    assert.equal(sim.destinationAirport, 'RKSS');
  });

  it('holds takeoff until the streamed runway is mounted', () => {
    const { sim, director, scenario } = createHarness();
    sim.airportStreamer.regionFor = () => null;
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.PREPARE);
    assert.equal(scenario.routeReady, false);
    sim.airportStreamer.regionFor = () => runwayRegion();
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.TAKEOFF);
    assert.equal(scenario.routeReady, true);
  });

  it('does not start final while kilometres off the course', () => {
    const { sim, director, scenario } = createHarness(F16GimpoScenario.STAGES.INTERCEPT);
    pose(sim, { along: 320, cross: -13451, y: 200 });
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.INTERCEPT);
    pose(sim, { along: 4000, cross: 200, y: 200 });
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.FINAL);
  });

  it('completes parked after a full-stop rollout', () => {
    const { sim, director, scenario, stopCalls } = createHarness(F16GimpoScenario.STAGES.ROLLOUT);
    pose(sim, { y: 10 });
    sim.telemetry.onGround = true;
    sim.telemetry.groundSpeedKnots = 7;
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.COMPLETED);
    assert.equal(scenario.result.status, 'completed');
    assert.equal(stopCalls(), 1);
  });
});

describe('F-16 Gimpo demo review fixes', () => {
  it('samples terrain along the Gimpo bearing, not the Jeju corridor', () => {
    const { sim, scenario } = createHarness(F16GimpoScenario.STAGES.ENROUTE);
    sim.position.set(OFFSET[0], 10, OFFSET[1] + THRESHOLD.z);
    sim.currentTerrain.getHeight = x => (x >= OFFSET[0] + 50 ? 500 : 0);
    assert.equal(scenario.terrainAltitude(), 560);
  });

  it('uses the supplied dt for rollout pitch decay', () => {
    const { sim, scenario } = createHarness(F16GimpoScenario.STAGES.ROLLOUT);
    sim.telemetry.groundSpeedKnots = 100;
    sim.totalSimTime = 5;
    scenario.rolloutPitchDeg = 10;
    scenario.update(0.1);
    assert.ok(Math.abs(scenario.rolloutPitchDeg - 9.7) < 1e-9, `pitch ${scenario.rolloutPitchDeg}`);
  });

  it('reports a rollout timeout instead of a completed landing', () => {
    const { sim, director, scenario, stopCalls } = createHarness(F16GimpoScenario.STAGES.ROLLOUT);
    sim.telemetry.onGround = true;
    sim.telemetry.groundSpeedKnots = 30;
    sim.totalSimTime = 50;
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.ROLLOUT);
    assert.equal(scenario.result.status, 'failed');
    assert.equal(scenario.result.reason, 'rollout-timeout');
    assert.equal(stopCalls(), 1);
  });

  it('only completes when stopped on the runway', () => {
    const { sim, director, scenario } = createHarness(F16GimpoScenario.STAGES.ROLLOUT);
    sim.telemetry.groundSpeedKnots = 7;
    sim.telemetry.onGround = false;
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.ROLLOUT);
    sim.telemetry.onGround = true;
    sim.currentAirport.isOnRunway = () => false;
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.ROLLOUT);
    sim.currentAirport.isOnRunway = () => true;
    scenario.update(0.05);
    assert.equal(director.currentStage, F16GimpoScenario.STAGES.COMPLETED);
  });

  it('disengages the autopilot when the demo stops', () => {
    const sim = createSim();
    const director = new DemoFlightDirector(sim);
    director.start('incheon', 'gimpo-sortie');
    sim.autopilot.master = true;
    director.stop();
    assert.equal(sim.autopilot.master, false);
    assert.equal(director.f16GimpoScenario.result.status, 'cancelled');
  });
});
