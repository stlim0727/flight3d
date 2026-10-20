import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LandingGear } from '../src/physics/LandingGear.js';
import { IncheonAirport } from '../src/environment/IncheonAirport.js';
import { IncheonDepartureScenario } from '../src/director/scenarios/IncheonDepartureScenario.js';

class TestAirport extends IncheonAirport { initAirport() { this.buildTerminal(); } }

test('boarding passengers and bridge reset after a complete service sequence', () => {
  const airport = new TestAirport();
  airport.setBoardingProgress(1);
  assert.ok(airport.passengers.children.every(p => !p.visible));
  airport.setBridgeRetraction(1);
  assert.ok(Math.abs(airport.jetBridges[1].scale.z - .3) < 1e-9);
  airport.setBridgeRetraction(0);
  airport.setBoardingProgress(0);
  assert.equal(airport.jetBridges[1].scale.z, 1);
  assert.ok(airport.passengers.children.every(p => p.visible));
});

function fixture() {
  const values = {};
  const sim = {
    incheonAirport: new TestAirport(), currentTerrain: {getHeight: () => 12},
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(), telemetry: {},
    controls: {setVirtualInput: (k,v) => values[k]=v, setParkingBrake() {}},
    engines: {setThrottle() {}}, gear: {setBrakes() {}, setGearTarget() {}},
    cameraSystem: {setMode() {}, resetDroneOrbit() {}}, setPreset() {},
  };
  const director = { isActive:true, currentStage:0, stageTimer:0, updateBanner() {}, stop() {this.isActive=false;}, setStage(stage) {this.currentStage=stage;this.stageTimer=0;scenario.enterStage(stage);} };
  const scenario = new IncheonDepartureScenario(director,sim);
  return {sim,director,scenario,values};
}

test('ground sequence waits for clearance, reaches runway continuously, then uses flight physics', () => {
  const {sim,director,scenario,values} = fixture();
  director.setStage(0);
  let last = sim.position.clone();
  const lastOrientation = sim.quaternion.clone();
  const visited = new Set();
  for(let i=0;i<20000 && director.currentStage<6;i++) {
    visited.add(director.currentStage);
    director.stageTimer += .01;
    scenario.update(.01);
    assert.ok(last.distanceTo(sim.position) < 1, 'ground path must not teleport');
    assert.ok(lastOrientation.angleTo(sim.quaternion) < .03, 'heading must remain continuous across taxi, hold and lineup');
    lastOrientation.copy(sim.quaternion);
    assert.equal(values.throttle, director.currentStage===6 ? 1 : 0);
    last.copy(sim.position);
  }
  assert.deepEqual([...visited], [0,1,2,3,4,5]);
  assert.equal(director.currentStage,6);
  assert.equal(scenario.controlsGround,false);
  assert.ok(sim.position.distanceTo(new THREE.Vector3(-1280,15.5,0))<1e-6);
  assert.equal(values.brakes,0);
  sim.telemetry.iasKnots=131;scenario.update(.1);
  assert.equal(director.currentStage,6);
  sim.telemetry.iasKnots=132;scenario.update(.1);
  assert.equal(director.currentStage,7);
  sim.telemetry.radioAltFt=501;sim.telemetry.onGround=false;scenario.update(.1);
  assert.equal(director.isActive,false);
});

test('cancellation releases ground control and hides the tug; restart restores boarding', () => {
  const {sim,director,scenario} = fixture();
  director.setStage(2);director.stageTimer=8;scenario.update(.1);
  assert.equal(sim.incheonAirport.tug.visible,true);
  scenario.stop();director.isActive=false;
  assert.equal(scenario.controlsGround,false);
  assert.equal(sim.incheonAirport.tug.visible,false);
  director.isActive=true;director.setStage(0);
  assert.equal(scenario.controlsGround,true);
  assert.equal(sim.position.x,-90);
  assert.equal(sim.incheonAirport.jetBridges[1].scale.z,1);
});


test('ground pose hands off without exceeding landing gear strut travel', () => {
  const {sim, scenario} = fixture();
  const gear = new LandingGear();
  scenario.pose(-1280, 0, -Math.PI/2);
  const aircraft = new THREE.Group();
  aircraft.position.copy(sim.position);
  aircraft.quaternion.copy(sim.quaternion);
  aircraft.updateMatrixWorld(true);
  const result = gear.update(1/120, aircraft, sim.linearVelocity, sim.angularVelocity, () => 12);
  assert.equal(result.failure, null);
  assert.equal(result.onGround, true);
  assert.ok(gear.contacts.every(c => c.compression < c.restLength));
});


test('restarting directly from pushback hides the tug without requiring stop', () => {
  const {sim,director,scenario} = fixture();
  director.setStage(2);director.stageTimer=8;scenario.update(.1);
  assert.equal(sim.incheonAirport.tug.visible,true);
  director.setStage(0);
  assert.equal(sim.incheonAirport.tug.visible,false);
  director.stageTimer=10;scenario.update(.1);
  assert.equal(director.currentStage,1);
  assert.equal(sim.incheonAirport.tug.visible,false);
});

test('bridge stays outside the fuselage throughout detachment and reset', () => {
  const airport = new TestAirport();
  for (const progress of [0, .25, .5, .75, 1, 0]) {
    airport.setBridgeRetraction(progress);
    const bounds = new THREE.Box3().setFromObject(airport.jetBridges[1]);
    assert.ok(bounds.min.z >= 242.09, 'rigid bridge must stop outside the port skin');
    assert.ok(bounds.max.x < -99, 'bridge must remain ahead of the wing');
    airport.setBoardingProgress(progress);
    for (const person of airport.passengers.children) {
      assert.ok(person.position.z >= 244 && person.position.z <= 274);
    }
  }
});
