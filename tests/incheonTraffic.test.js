import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildTrafficRoutes,prepareTrafficRoute,sampleTrafficPose,lanePoints } from '../src/geospatial/incheonTraffic.js';
import { IncheonTraffic,TRAFFIC_QUALITY } from '../src/environment/IncheonTraffic.js';
const base=new URL('../public/scenery/incheon/',import.meta.url);
const data=JSON.parse(readFileSync(new URL('traffic.json',base)));
const patch=JSON.parse(readFileSync(new URL('patch.json',base)));
const raw=JSON.parse(gunzipSync(readFileSync(new URL('source.osm.json.gz',base))));

test('frozen road cycles are reproducible and follow original ground-road direction',()=>{
  const regenerated=buildTrafficRoutes(patch,raw);
  assert.deepEqual(regenerated.routes,data.routes);
  const ways=new Map(raw.elements.filter(e=>e.type==='way').map(w=>[`way/${w.id}`,w]));
  assert.ok(data.routes.length>0&&data.routes.length<=32);
  for(const route of data.routes) {
    assert.ok(route.length>=180&&route.length<=1500);
    for(let i=0;i<route.edges.length;i++) {
      const edge=route.edges[i],next=route.edges[(i+1)%route.edges.length];
      assert.deepEqual(edge.b,next.a,'closed continuous cycle');
      const way=ways.get(edge.sourceId),road=patch.features.find(f=>f.id===edge.sourceId);
      assert.ok(!way.tags.bridge&&!way.tags.tunnel&&!Number(way.tags.layer||0));
      assert.ok(!['footway','path','steps','cycleway','corridor'].includes(road.highway));
      assert.ok(road.parts.some(part=>part.slice(1).some((b,j)=>{
        const a=part[j],same=JSON.stringify([a,b])===JSON.stringify([edge.a,edge.b]);
        const reverse=JSON.stringify([b,a])===JSON.stringify([edge.a,edge.b]);
        return way.tags.oneway==='-1'?reverse:way.tags.oneway==='yes'?same:same||reverse;
      })));
    }
  }
});

test('loop seam, distance grouping and right-side lane pose stay continuous',()=>{
  for(const source of data.routes) {
    const route=prepareTrafficRoute(source,()=>7);
    assert.ok(route);
    const a=sampleTrafficPose(route,0),b=sampleTrafficPose(route,route.length),before=sampleTrafficPose(route,route.length-.001);
    assert.deepEqual(a,b);assert.ok(Math.hypot(a.x-before.x,a.z-before.z)<.002);
    const wrapped=sampleTrafficPose(route,route.length+42),direct=sampleTrafficPose(route,42);
    assert.ok(Math.hypot(wrapped.x-direct.x,wrapped.z-direct.z)<1e-8);
    assert.ok(lanePoints(source).every(p=>p.every(Number.isFinite)));
  }
});

test('steep, unsafe, invalid and empty inputs cannot silently create traffic',()=>{
  assert.equal(prepareTrafficRoute(data.routes[0],(x)=>x),null);
  assert.equal(prepareTrafficRoute(data.routes[0],()=>NaN),null);
  assert.equal(prepareTrafficRoute(data.routes[0],()=>7,()=>false),null);
  assert.throws(()=>new IncheonTraffic({schemaVersion:1,routes:[]},()=>7));
  assert.throws(()=>buildTrafficRoutes({features:[]},{elements:[]}));
});

test('pause, reset, culling and quality transitions keep one bounded instance buffer',()=>{
  const traffic=new IncheonTraffic(data,()=>7);
  const route=traffic.routes[0],camera={...route.center,y:30};
  const mesh=traffic.mesh,matrix=mesh.instanceMatrix;
  const high=traffic.update(.1,camera,'high');assert.ok(high>0&&high<=TRAFFIC_QUALITY.high.limit);
  const first=Array.from(mesh.instanceMatrix.array);
  traffic.update(.1,camera,'high',true);assert.deepEqual(Array.from(mesh.instanceMatrix.array),first);
  traffic.update(.1,camera,'high');assert.notDeepEqual(Array.from(mesh.instanceMatrix.array),first);
  traffic.reset();traffic.update(.1,camera,'high');assert.deepEqual(Array.from(mesh.instanceMatrix.array),first);
  assert.ok(traffic.update(0,camera,'performance')<=TRAFFIC_QUALITY.performance.limit);
  assert.ok(traffic.update(0,camera,'ultraLow')<=TRAFFIC_QUALITY.ultraLow.limit);
  assert.equal(traffic.update(0,{x:10000,y:1000,z:10000},'high'),0);
  assert.equal(mesh.visible,false);
  traffic.enabled=false;assert.equal(traffic.update(0,camera,'high'),0);
  traffic.enabled=true;assert.ok(traffic.update(0,camera,'high')>0);
  assert.equal(traffic.mesh,mesh);assert.equal(mesh.instanceMatrix,matrix);
});


test('right-hand lane joins stay inside a clockwise square and time grouping agrees',()=>{
  const ring=[[0,0],[0,-100],[100,-100],[100,0]];
  const route={id:'square',edges:ring.map((a,i)=>({a,b:ring[(i+1)%4],offset:1.5}))};
  assert.deepEqual(lanePoints(route),[[1.5,-1.5],[1.5,-98.5],[98.5,-98.5],[98.5,-1.5]]);
  const a=new IncheonTraffic({schemaVersion:1,routes:[route]},()=>7);
  const b=new IncheonTraffic({schemaVersion:1,routes:[route]},()=>7);
  const camera={x:50,y:10,z:-50};
  for(let i=0;i<20;i++)a.update(.05,camera,'high');
  for(let i=0;i<10;i++)b.update(.1,camera,'high');
  assert.ok(Math.abs(a.elapsed-b.elapsed)<1e-12);
  assert.deepEqual(Array.from(a.mesh.instanceMatrix.array),Array.from(b.mesh.instanceMatrix.array));
});
