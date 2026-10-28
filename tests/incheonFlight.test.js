import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { IncheonFlightSurface, INCHEON_AIRFIELD as field, incheonSpawn } from '../src/geospatial/IncheonFlightSurface.js';
import { IncheonTerrain } from '../src/geospatial/IncheonTerrain.js';
import { projectToLocal } from '../src/geospatial/incheon.js';
import { approachDeviation } from '../src/config/approachData.js';
import { scenariosForAirport } from '../src/config/scenarioRegistry.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { terrainGeometry } from '../src/previews/incheonGeometry.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { solveTrim } from '../src/physics/TrimSolver.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';
const base=new URL('../public/scenery/incheon/',import.meta.url);
const metadata=JSON.parse(readFileSync(new URL('terrain-metadata.json',base)));
const grids=Object.fromEntries(Object.entries(metadata.grids).map(([key,d])=>{
  const b=readFileSync(new URL(d.file,base));return [key,Float32Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4))];
}));
const surface=new IncheonFlightSurface(new IncheonTerrain(metadata,grids,JSON.parse(readFileSync(new URL('coastline.json',base)))));

test('full runways retain frozen source endpoints and fit the loaded terrain',()=>{
  const bytes=gunzipSync(readFileSync(new URL('source.osm.json.gz',base)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),field.sourceSha256);
  const raw=JSON.parse(bytes),nodes=new Map(raw.elements.filter(e=>e.type==='node').map(n=>[n.id,n]));
  for(const runway of field.surfaces.filter(s=>s.kind==='runway')) {
    const way=raw.elements.find(e=>`way/${e.id}`===runway.id);
    assert.deepEqual(runway.points,way.nodes.map(id=>{const n=nodes.get(id);return projectToLocal(n.lat,n.lon);}));
    const a=runway.points[0],b=runway.points.at(-1);
    assert.ok(Math.abs(Math.hypot(b[0]-a[0],b[1]-a[1])-3750)<20);
    for(let i=0;i<=100;i++) {
      const x=a[0]+(b[0]-a[0])*i/100,z=a[1]+(b[1]-a[1])*i/100;
      assert.ok(surface.isOnRunway(x,z));assert.equal(surface.getHeight(x,z),7);
      assert.ok(surface.getNormal(x,z).y>.999);
    }
  }
});

test('pavement mask follows real shapes and only nearby terrain is graded',()=>{
  for(const s of field.surfaces) for(const [x,z] of s.points) {
    assert.ok(surface.isOnRunway(x,z),s.id);
    assert.equal(surface.getHeight(x,z),7,s.id);
  }
  assert.equal(surface.isOnRunway(3000,3000),false);
  assert.equal(surface.getHeight(7000,0),0);
  assert.equal(surface.getHeight(-4800,-4800),0);
  assert.equal(surface.getHeight(3000,-3000),surface.source.getHeight(3000,-3000));
});

test('runway and approach spawns align with navigation for both aircraft',()=>{
  for(const id of ['B738','C172']) {
    const ground=incheonSpawn('runway',3.5,id),air=incheonSpawn('approach',3.5,id);
    assert.ok(surface.isOnRunway(ground.x,ground.z));assert.equal(ground.y,10.5);
    const deviation=approachDeviation('incheon',{...air,altitudeFt:(air.y-3.5)/.3048});
    assert.ok(Math.abs(deviation.crossTrackM)<1e-9);
    assert.ok(Math.abs(deviation.distanceToThresholdM-1500)<1e-9);
    assert.ok(Math.abs(deviation.glideslopeErrorFt)<1e-9);
    assert.ok(Math.abs(air.vy/Math.hypot(air.vx,air.vz)+Math.tan(Math.PI/60))<1e-10);
    assert.ok(air.y>surface.getHeight(air.x,air.z)+50);
  }
  assert.deepEqual(scenariosForAirport('incheon'),['runway','approach','cruise','demo']);
});

test('manual airport lobby freezes and never starts an unrelated demo; switching restores cinematic',()=>{
  const flow=new GameFlowController();
  flow.setCinematicAvailable(false);
  for(let i=0;i<20;i++){flow.update(1);assert.equal(flow.consumeDemoRestart(),false);assert.equal(flow.isPhysicsFrozen(),true);}
  assert.equal(flow.canResumeFromLobby(),false);
  flow.enterFlight();assert.equal(flow.isPhysicsFrozen(),false);
  flow.returnToLobby(true);assert.equal(flow.canResumeFromLobby(),true);
  flow.enterFlight();flow.pause();assert.equal(flow.isPhysicsFrozen(),true);flow.resume();
  flow.returnToLobby();flow.setCinematicAvailable(true);flow.update(2);
  assert.equal(flow.consumeDemoRestart(),true);
});

test('physics height agrees with the rendered triangle plane, including local mesh subdivisions',()=>{
  for(const [size,segments,omit] of [[12000,480,true],[2000,160,false]]) {
    const geometry=terrainGeometry(size,segments,(x,z)=>surface.getHeight(x,z),omit);
    const p=geometry.attributes.position,indices=geometry.index.array;
    for(let i=0;i<indices.length;i+=3*97) {
      const [a,b,c]=Array.from(indices.slice(i,i+3));
      const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
      const y=(p.getY(a)+p.getY(b)+p.getY(c))/3;
      if (!surface.source.isLand(x,z)) { assert.equal(surface.getHeight(x,z),0); continue; }
      assert.ok(Math.abs(surface.getHeight(x,z)-y)<.0001,`${size}: ${x},${z}`);
    }
    geometry.dispose();
  }
});

test('P-key demo entry cannot run the coastal route at Incheon',()=>{
  const director={sim:{activeAirport:'incheon'}};
  assert.equal(DemoFlightDirector.prototype.start.call(director),false);
});

test('the approach spawn is an unattended equilibrium of the live force model',()=>{
  // The scenario is flown hands-off between the lobby and the pilot's first input,
  // so the spawn state has to be a trim the aircraft actually holds: a wheel clamped
  // at its travel leaves a sustained pitch moment and flies the preset off its path.
  for(const id of ['B738','C172']) {
    const aero=new Aerodynamics(AIRCRAFT_REGISTRY[id]),engines=new EngineModel(AIRCRAFT_REGISTRY[id]);
    const spawn=incheonSpawn('approach',3.5,id);
    const tas=Math.hypot(spawn.vx,spawn.vy,spawn.vz);
    const gammaRad=Math.asin(spawn.vy/tas);
    const flapsIndex=Math.min(5,aero.flapAngles.length-1);
    const atmos=Atmosphere.getConditions(spawn.y);
    const trim=solveTrim(aero,engines,{
      iasKnots:Atmosphere.msToKnots(Atmosphere.tasToIas(tas,atmos.densityRatio)),
      altitudeMeters:spawn.y,flightPathAngleDeg:THREE.MathUtils.radToDeg(gammaRad),
      flapsIndex,gearState:1,spoilers:0});
    assert.equal(trim.feasible,true,`${id}: ${trim.reason}`);
    assert.equal(trim.handsOffFeasible,true,
      `${id}: ${trim.handsOffTrimDegRaw}° of wheel needed, travel is -5..12`);
    assert.ok(Math.abs(trim.handsOffTrimDeg-12)>1e-9&&Math.abs(trim.handsOffTrimDeg+5)>1e-9,
      `${id}: spawn trim sits on the wheel limit`);

    // Same state through the real force model, configuration settled as the preset
    // installs it: neutral stick, solved attitude, solved wheel.
    const mesh=new THREE.Object3D();
    mesh.quaternion.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(trim.alphaDeg)+gammaRad,0,0));
    aero.setFlapPosition(flapsIndex);
    aero.currentFlapAngle=aero.flapAngles[flapsIndex];
    aero.pitchTrim=trim.handsOffTrimDeg;
    const res=aero.computeAero(1/120,mesh,
      new THREE.Vector3(0,tas*Math.sin(gammaRad),-tas*Math.cos(gammaRad)),
      new THREE.Vector3(0,0,0),spawn.y,spawn.y-surface.getHeight(spawn.x,spawn.z),
      trim.thrustN,1);
    const qSc=res.qDyn*aero.wingArea*aero.meanChord,weight=aero.mass*Atmosphere.G0;
    assert.ok(Math.abs(res.momentBody.x)<.005*qSc,
      `${id}: ${res.momentBody.x} N·m of pitch moment left in the spawn (qSc ${qSc})`);
    const net=res.forceWorld.clone()
      .add(new THREE.Vector3(0,0,-trim.thrustN).applyQuaternion(mesh.quaternion))
      .add(new THREE.Vector3(0,-weight,0));
    assert.ok(Math.abs(net.y)<.03*weight,`${id}: ${net.y/weight} of weight unbalanced`);
    assert.ok(Math.abs(res.cl-trim.cl)<.005,`${id}: cl ${res.cl} vs solved ${trim.cl}`);
  }
});

test('cached interior land lookup preserves exact coast and hole classification',()=>{
  const original=surface.source.isLand.bind(surface.source);
  let calls=0;surface.source.isLand=(x,z)=>{calls++;return original(x,z);};
  for(let i=0;i<1000;i++)surface.getHeight(-1588,-3665);
  assert.equal(calls,0,'runway contacts never traverse the coast polygon');
  let coastalQueries=0;
  for(let row=0;row<480;row+=3)for(let col=0;col<480;col+=3) {
    const x=col*25-5993.25,z=row*25-5988.75;
    const expected=original(x,z);
    const before=calls,height=surface.getHeight(x,z);
    if(surface.coastCells[row*480+col]){assert.equal(calls,before+1);coastalQueries++;}
    else assert.equal(Boolean(surface.landNodes[row*481+col]),expected);
    if(!expected)assert.equal(height,0);
  }
  assert.ok(coastalQueries>0);
  surface.source.isLand=original;
});

test('a sub-cell water hole uses the exact coast predicate even when all grid nodes are land',()=>{
  const outer=[[-6000,-6000],[6000,-6000],[6000,6000],[-6000,6000],[-6000,-6000]];
  const hole=[[10,10],[14,10],[14,14],[10,14],[10,10]];
  let calls=0;
  const source={coastline:{land:{type:'Polygon',coordinates:[outer,hole]}},
    isLand:(x,z)=>{calls++;return !(x>10&&x<14&&z>10&&z<14);},getHeight:()=>12};
  const terrain=new IncheonFlightSurface(source);calls=0;
  assert.equal(terrain.getHeight(12,12),0);assert.equal(calls,1);
  calls=0;assert.ok(terrain.getHeight(-100,-100)>0);assert.equal(calls,0);
});
