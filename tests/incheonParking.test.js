import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import field from '../src/config/incheonAirfield.json' with {type:'json'};
import { planParkedAirliners, parkingSiteIsSafe, PARKED_SPACING, PARKED_AIRLINES } from '../src/geospatial/incheonParking.js';
import { IncheonParkedAirliners, PARKED_QUALITY } from '../src/environment/IncheonParkedAirliners.js';
import { PARKED_LIVERIES } from '../src/environment/ParkedAirlinerAssets.js';
import { pointInRing, segmentDistance } from '../src/geospatial/incheonDressing.js';

const patch=JSON.parse(fs.readFileSync(new URL('../public/scenery/incheon/patch.json',import.meta.url)));
test('48 deterministic 737 stands fit mapped aprons and avoid terminal/taxi/runway/departure clearances',()=>{
  const snapshot=JSON.stringify(field),stands=planParkedAirliners(field,patch);
  assert.equal(stands.length,48);assert.ok(stands.filter(s=>s.area==='terminal').length>=24);
  assert.deepEqual(stands,planParkedAirliners(field,patch));
  assert.deepEqual([...new Set(stands.map(s=>s.airline))].sort(),[...PARKED_AIRLINES].sort());
  for(const [i,stand] of stands.entries()){
    assert.ok(parkingSiteIsSafe(stand.x,stand.z,field,patch));
    for(const x of [-17.9,17.9])for(const z of [-18.95,18.95]){
      const c=Math.cos(stand.yaw),s=Math.sin(stand.yaw),wx=stand.x+c*x+s*z,wz=stand.z-s*x+c*z;
      assert.ok(field.surfaces.some(a=>a.kind==='apron'&&a.area&&pointInRing(wx,wz,a.points)&&!(a.holes??[]).some(h=>pointInRing(wx,wz,h))),'actual bounding-box corners stay on apron');
      assert.ok(!patch.features.some(f=>f.kind==='building'&&f.parts.some(p=>pointInRing(wx,wz,p))),'aircraft corners stay outside mapped buildings');
      for(const runway of field.surfaces.filter(a=>a.kind==='runway'))for(let j=1;j<runway.points.length;j++){
        assert.ok(segmentDistance(wx,wz,runway.points[j-1],runway.points[j])>=runway.width/2+60,'even footprint corners stay outside runway safety strips');
      }
    }
    for(const other of stands.slice(i+1))assert.ok(Math.hypot(stand.x-other.x,stand.z-other.z)>=PARKED_SPACING);
  }
  assert.equal(parkingSiteIsSafe(90.62,-201.86,field,patch),false,'active G1 gate stays empty');
  assert.equal(parkingSiteIsSafe(463,-769,field,patch),false,'runway entry stays empty');
  assert.equal(JSON.stringify(field),snapshot,'never alter mapped pavement to fit occupancy');
  assert.equal(planParkedAirliners(field,patch,8).length,8);
  assert.equal(Object.hasOwn(PARKED_LIVERIES,'emirates'),false,'Emirates does not operate the modeled 737 fleet');
});

function assets() {
  return {geometry:new THREE.BoxGeometry(4,4,30).toNonIndexed(),decals:new THREE.BoxGeometry(1,1,1).toNonIndexed(),
    gear:new THREE.BoxGeometry(.5,.5,.5).toNonIndexed(),textures:new Set(),
    liveries:Object.fromEntries(PARKED_AIRLINES.map(id=>[id,{body:new THREE.MeshStandardMaterial(),decal:new THREE.MeshStandardMaterial()}]))};
}
function stands(){return Array.from({length:48},(_,i)=>({id:`P${i}`,x:i*60,z:0,yaw:0,airline:PARKED_AIRLINES[i%4]}));}

test('quality and camera culling reuse exterior instances while collision remains active',async()=>{
  const parked=new IncheonParkedAirliners(stands(),7),camera=new THREE.Vector3(1000,30,0);
  let loads=0;
  const ready=parked.load('/',async()=>{loads++;return assets();});
  assert.equal(parked.load('/unused',async()=>{throw new Error('must not reload');}),ready);
  assert.equal(await ready,true);assert.equal(loads,1);
  const meshes=[...parked.group.children];
  for(const quality of ['high','balanced','performance','ultraLow']){
    const count=parked.update(camera,quality);assert.equal(count,PARKED_QUALITY[quality].limit);
    assert.equal(parked.gear.count,count);assert.equal(parked.paint.count,count);
    assert.equal([...parked.batches.values()].reduce((n,p)=>n+p.body.count,0),count);
    assert.deepEqual(parked.group.children,meshes,'no per-aircraft objects or buffer reallocations on quality change');
    if (quality === 'performance' || quality === 'ultraLow') {
      assert.equal(parked.gear.castShadow, false);
      for (const pair of parked.batches.values()) assert.equal(pair.body.castShadow, false);
    }
  }
  parked.update(new THREE.Vector3(10000,30,10000),'performance');assert.equal(parked.visibleCount,0);
  const contact=parked.checkCollision([{pos:new THREE.Vector3(2.05,10.5,0),radius:.1,desc:'wing'}]);
  assert.equal(contact?.part,'wing','culled aircraft still collide at their real surfaces');
  assert.equal(parked.checkCollision([{pos:new THREE.Vector3(15,10.5,0),radius:.1,desc:'wing'}]),null);
  assert.equal(parked.checkCollision([{pos:new THREE.Vector3(0,100,0),radius:.1,desc:'wing'}]),null);
  parked.dispose();assert.equal(parked.group.children.length,0);assert.equal(parked.visibleCount,0);
});

test('late exterior load after disposal does not resurrect aircraft or GPU buffers',async()=>{
  const parked=new IncheonParkedAirliners(stands(),7);let finish;
  const ready=parked.load('/',()=>new Promise(resolve=>{finish=resolve;}));
  parked.dispose();finish(assets());assert.equal(await ready,false);
  assert.equal(parked.group.children.length,0);assert.equal(parked.assets,null);
});
