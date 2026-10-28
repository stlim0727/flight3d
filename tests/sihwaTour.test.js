import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sihwaTourRoute,SIHWA_TOUR_PROFILES,SihwaTourScenario} from '../src/director/scenarios/SihwaTourScenario.js';
import {demoProfiles,resolveDemoProfile} from '../src/director/demoProfiles.js';
import {AIRCRAFT_REGISTRY} from '../src/config/aircraftConfigs.js';
import {DemoFlightDirector} from '../src/director/DemoFlightDirector.js';
const features=JSON.parse(fs.readFileSync(new URL('../public/scenery/incheon/sihwa/features.json',import.meta.url))).features;

test('all registered aircraft offer the Sihwa tour without replacing their existing Incheon default',()=>{
  for(const id of Object.keys(AIRCRAFT_REGISTRY)) {
    assert.ok(demoProfiles(id,'incheon').some(p=>p.id==='sihwa-tour'));
    const d=new DemoFlightDirector({currentAircraftId:id,activeAirport:'incheon'});d.profile='sihwa-tour';
    assert.equal(d.getActiveScenario(),d.sihwaTourScenario);
    assert.ok(SIHWA_TOUR_PROFILES[id]);
  }
  assert.equal(resolveDemoProfile('B738','incheon').id,'incheon-departure');
  assert.equal(resolveDemoProfile('C172','incheon').id,'incheon-tour');
  assert.equal(resolveDemoProfile('F16','incheon').id,'sihwa-tour');
  assert.deepEqual(demoProfiles('F16','coastal'),[]);
});

test('each closed route stays inside the sourced region and reaches all landmark corridors',()=>{
  for(const id of Object.keys(AIRCRAFT_REGISTRY)) {
    const r=sihwaTourRoute(features,id),a=r.point(0),b=r.point(r.total);
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-7);
    for(let s=0;s<r.total;s+=25){const p=r.point(s),q=r.point(s+.01);assert.ok(Math.max(Math.abs(p.x),Math.abs(p.z))<24500);assert.ok(Math.hypot(q.x-p.x,q.z-p.z)<.011);}
    for(const landmark of r.landmarks) {
      let closest=Infinity;
      for(let s=0;s<r.leg;s+=25){const p=r.point(s);closest=Math.min(closest,Math.hypot(p.x-landmark.point[0],p.z-landmark.point[1]));}
      assert.ok(closest<1500,`${id}: ${landmark.id}`);
    }
  }
});

test('cancelling preserves the selected aircraft and records cancellation',()=>{
  const s=new SihwaTourScenario({},{});s.result={status:'running'};s.stop();assert.equal(s.result.status,'cancelled');
});

test('Sihwa phase transitions retain a pilot-selected camera',()=>{
  const sim={activeAirport:'incheon',currentAircraftId:'B738',cameraSystem:{setMode(){assert.fail('manual camera was overridden');}}};
  const d=new DemoFlightDirector(sim);d.profile='sihwa-tour';d.userCameraOverridden=true;
  d.setStage(SihwaTourScenario.STAGES.STATION,{preserveCamera:true});
  assert.equal(d.userCameraOverridden,true);
  d.setStage(SihwaTourScenario.STAGES.BEACH,{preserveCamera:true});
  assert.equal(d.userCameraOverridden,true);
});

test('the fighter has a feasible low-speed trim with its modeled speed brake',async()=>{
  const {Aerodynamics}=await import('../src/physics/Aerodynamics.js');
  const {EngineModel}=await import('../src/physics/EngineModel.js');
  const {solveTrim}=await import('../src/physics/TrimSolver.js');
  const cfg=AIRCRAFT_REGISTRY.F16,profile=SIHWA_TOUR_PROFILES.F16,aero=new Aerodynamics(cfg),engines=new EngineModel(cfg);
  const state={iasKnots:profile.ias,altitudeMeters:profile.altitude,gearState:0,flapsIndex:0};
  assert.equal(solveTrim(aero,engines,{...state,spoilers:0}).reason,'idle');
  const trim=solveTrim(aero,engines,{...state,spoilers:profile.speedBrake});
  assert.ok(trim.feasible && trim.handsOffFeasible);
  assert.ok(trim.throttle>0 && trim.throttle<1);
});
