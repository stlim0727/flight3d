import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IncheonDepartureScenario, DEPARTURE_GATE } from '../src/director/scenarios/IncheonDepartureScenario.js';
import { DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE, DEPARTURE_RUNWAY, departurePushbackPose } from '../src/config/incheonDeparture.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { resolveDemoProfile } from '../src/director/demoProfiles.js';

const S = IncheonDepartureScenario.STAGES;
function fixture() {
  const inputs = {};
  const sim = {
    position: new THREE.Vector3(), linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(), scene: new THREE.Scene(),
    controls: { setVirtualInput: (k,v) => { inputs[k]=v; }, setParkingBrake() {} },
    gear: { onGround: true, cgGroundHeightM: 3.5, setGearTarget() {} },
    aero: { mass: 66000, invIzz: 1/4850000, setFlapPosition() {} },
    aircraft: { group: new THREE.Group() }, telemetry: { headingDeg: DEPARTURE_GATE.heading*180/Math.PI, iasKnots: 0 },
    setPreset() {},
  };
  const director = { stageTimer: 0, totalTimer: 0, currentStage: S.GATE,
    setTimeOfDay() {}, updateBanner() {},
    setStage(stage) { this.currentStage = stage; this.stageTimer = 0; scenario.enterStage(stage); },
    stop() { scenario.stop(); },
  };
  const scenario = new IncheonDepartureScenario(director, sim);
  director.setStage(S.GATE);
  return {sim, director, scenario, inputs};
}

test('departure is an 737 departure profile is separate from the C172 tour', () => {
  assert.equal(resolveDemoProfile('B738','incheon','incheon-departure').id,'incheon-departure');
  assert.equal(resolveDemoProfile('C172','incheon','invalid').id,'incheon-tour');
  const d = new DemoFlightDirector({currentAircraftId:'B738', activeAirport:'incheon'});
  d.profile='incheon-departure';
  assert.equal(d.getActiveScenario(),d.incheonDepartureScenario);
  d.activeDemoAircraft='C172';
  d.profile='incheon-tour';
  assert.equal(d.getActiveScenario(),d.incheonCessnaScenario);
});

test('tug applies bounded forces only while connected on the ground', () => {
  const {sim,director,scenario}=fixture();
  assert.equal(scenario.towingForces(),null);
  director.setStage(S.PUSHBACK);
  const force=scenario.towingForces().force;
  const toward=new THREE.Vector3(DEPARTURE_TAXI_ROUTE[0].x-sim.position.x,0,DEPARTURE_TAXI_ROUTE[0].z-sim.position.z);
  assert.ok(force.dot(toward)>0);
  assert.ok(force.length()<=sim.aero.mass*1.5+.001);
  sim.gear.onGround=false;
  assert.equal(scenario.towingForces(),null);
  sim.gear.onGround=true;
  director.setStage(S.DISCONNECT);
  assert.equal(scenario.towingForces(),null);
  scenario.stop();
  assert.equal(sim.scene.getObjectByName('departure-tug'),undefined);
  assert.equal(scenario.result.status,'cancelled');
});

test('pushback waits for a settled position; taxi waits for tractor clearance and leaves it parked', () => {
  const {sim,director,scenario,inputs}=fixture();
  director.stageTimer=7; scenario.update(.1);
  assert.equal(director.currentStage,S.PUSHBACK);
  scenario.update(2);
  assert.equal(director.currentStage,S.PUSHBACK,'timer alone cannot complete pushback');
  const end=departurePushbackPose(1);
  sim.position.x=end.x;sim.position.z=end.z;
  sim.quaternion.setFromEuler(new THREE.Euler(0,-end.heading,0,'YXZ'));
  scenario.update(.6);
  assert.equal(director.currentStage,S.PUSHBACK);
  scenario.update(.6);
  assert.equal(director.currentStage,S.DISCONNECT);
  director.stageTimer=9;scenario.update(.1);
  assert.equal(director.currentStage,S.DISCONNECT,'timer alone does not clear the tug');
  assert.equal(inputs.brakes,1);
  for(let elapsed=0;elapsed<30 && director.currentStage===S.DISCONNECT;elapsed+=.1)scenario.update(.1);
  assert.equal(director.currentStage,S.TAXI);
  assert.equal(scenario.tug.userData.animation.clear,true);
  assert.ok(sim.scene.getObjectByName('departure-tug'),'tractor remains parked instead of vanishing');
  director.setStage(S.HOLD);scenario.update(.1);
  assert.equal(inputs.brakes,1);assert.equal(inputs.throttle,0);
});

test('lineup cannot authorize takeoff until aligned, stopped, and clearance has been read', () => {
  const {sim,director,scenario,inputs}=fixture();
  director.setStage(S.LINEUP);
  scenario.index=DEPARTURE_LINEUP_ROUTE.length-1;
  Object.assign(sim.position,DEPARTURE_LINEUP_ROUTE.at(-1));
  sim.telemetry.headingDeg=DEPARTURE_RUNWAY.headingDeg;
  sim.linearVelocity.set(2,0,0);scenario.update(.1);
  assert.equal(director.currentStage,S.LINEUP);
  sim.linearVelocity.set(0,0,0);scenario.update(.1);
  assert.equal(director.currentStage,S.CLEARANCE);
  director.stageTimer=5;scenario.update(.1);
  assert.equal(inputs.throttle,0);assert.equal(inputs.brakes,1);
  director.stageTimer=7;scenario.update(.1);
  assert.equal(director.currentStage,S.TAKEOFF);
});

test('restart cleans up tug resources and resets route progress; completion requires flight', () => {
  const {sim,director,scenario}=fixture();
  const old=scenario.tug;
  scenario.index=50;
  director.setStage(S.GATE);
  assert.equal(old.parent,null);
  assert.equal(sim.scene.children.filter(n=>n.name==='departure-tug').length,1);
  assert.equal(scenario.index,0);
  director.setStage(S.TAKEOFF);
  sim.position.y=100;scenario.update(.1);
  assert.equal(scenario.result.airborne,false,'height alone with grounded gear cannot complete');
  sim.gear.onGround=false;scenario.update(.1);
  assert.equal(scenario.result.status,'completed');
});

test('waiting stages honor an active radio call, and missing audio does not trap the pilot',()=>{
  const {sim,director,scenario}=fixture();
  let stopped=0;
  sim.audio={departureRadio:{busy:true,stop(){stopped++;},preload(){}},playDepartureRadio(){}};
  director.stageTimer=10;scenario.update(.1);
  assert.equal(director.currentStage,S.GATE,'pushback waits for apron approval audio');
  sim.audio.departureRadio.busy=false;scenario.update(.1);
  assert.equal(director.currentStage,S.PUSHBACK);
  director.setStage(S.CLEARANCE);director.stageTimer=20;
  sim.audio.departureRadio.busy=true;scenario.update(.1);
  assert.equal(director.currentStage,S.CLEARANCE,'takeoff waits for the full clearance/readback');
  sim.audio.departureRadio.busy=false;scenario.update(.1);
  assert.equal(director.currentStage,S.TAKEOFF);
  scenario.stop();assert.equal(stopped,1,'cancel stops playback');
});

test('a 737 advances past an overrun waypoint instead of orbiting an unreachable point',()=>{
  const {sim,scenario}=fixture();
  const a=DEPARTURE_TAXI_ROUTE[0],b=DEPARTURE_TAXI_ROUTE[1];
  const length=Math.hypot(b.x-a.x,b.z-a.z),fx=(b.x-a.x)/length,fz=(b.z-a.z)/length;
  sim.position.set(b.x+fx*20-fz*20,10.5,b.z+fz*20+fx*20);
  scenario.index=1;
  scenario.taxi(DEPARTURE_TAXI_ROUTE,true);
  assert.ok(scenario.index>1,'projection beyond the segment advances the route despite cross-track error');
});

test('the passenger bridge clears before pushback and cancellation retracts it',()=>{
  const {sim,director,scenario}=fixture();
  let extension=0;
  sim.currentAirport={departureBridge:{setExtension(value){extension=value;}}};
  director.setStage(S.GATE);assert.equal(extension,1);
  director.stageTimer=4;scenario.update(.1);assert.equal(extension,.5);
  director.stageTimer=7;scenario.update(.1);
  assert.equal(extension,0);assert.equal(director.currentStage,S.PUSHBACK);
  director.setStage(S.GATE);scenario.stop();assert.equal(extension,0);
});
