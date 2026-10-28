import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {SihwaRegion} from '../src/geospatial/SihwaRegion.js';
import {IncheonTerrain} from '../src/geospatial/IncheonTerrain.js';
import {IncheonFlightSurface} from '../src/geospatial/IncheonFlightSurface.js';
import {projectToLocal} from '../src/geospatial/incheon.js';
const base=new URL('../public/scenery/incheon/',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,base));
const json=file=>JSON.parse(read(file));
const meta=json('sihwa/metadata.json'),features=json('sihwa/features.json');
function floats(file){const b=read(file);return Float32Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));}
const positions=floats('sihwa/positions.bin'),ib=read('sihwa/indices.bin');
const indices=Uint32Array.from({length:ib.length/4},(_,i)=>ib.readUInt32LE(i*4));
const region=new SihwaRegion(meta,positions,indices,json('sihwa/core-coastline.json'),features);
const oldMeta=json('terrain-metadata.json'),grids=Object.fromEntries(Object.entries(oldMeta.grids).map(([name,d])=>[name,floats(d.file)]));
const source=new IncheonTerrain(oldMeta,grids,json('coastline.json'));
const terrain=new IncheonFlightSurface(source,region);

test('regional assets and frozen OSM snapshots match declared checksums',()=>{
  for(const d of [meta.geometry.positions,meta.geometry.indices,...Object.values(meta.geometry.overlays)])assert.equal(createHash('sha256').update(read('sihwa/'+d.file)).digest('hex'),d.sha256);
  for(const s of meta.sources)assert.equal(createHash('sha256').update(gunzipSync(read('sihwa/'+s.file))).digest('hex'),s.sha256);
  assert.equal(meta.coreCoastDifferenceM2,0);
  assert.equal(meta.architecture.towerHeightM,75);assert.equal(meta.architecture.generatorUnits,10);
});

test('landmarks use the actual projected OSM footprints',()=>{
  const elements=meta.sources.flatMap(s=>JSON.parse(gunzipSync(read('sihwa/'+s.file))).elements);
  const nodes=new Map(elements.filter(e=>e.type==='node').map(n=>[n.id,n]));
  const ways=new Map(elements.filter(e=>e.type==='way').map(n=>[n.id,n]));
  for(const f of features.features){const way=ways.get(Number(f.id.split('/')[1]));assert.ok(way);
    assert.deepEqual(f.points,way.nodes.map(id=>{const n=nodes.get(id);return projectToLocal(n.lat,n.lon);}));}
});

test('regional contact heights follow the actual rendered triangles',()=>{
  let checked=0;
  for(let i=0;i<indices.length;i+=Math.max(3,Math.floor(indices.length/1500/3)*3)){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const x=positions[a]*.2+positions[b]*.3+positions[c]*.5,z=positions[a+2]*.2+positions[b+2]*.3+positions[c+2]*.5;
    const y=positions[a+1]*.2+positions[b+1]*.3+positions[c+1]*.5;
    assert.ok(Math.abs(region.getHeight(x,z)-y)<.003,`${x},${z}: ${region.getHeight(x,z)} vs ${y}`);checked++;
  }
  assert.ok(checked>1000);
});

test('outer mesh stitches to the core grid without a height step',()=>{
  let checked=0;
  for(let i=0;i<positions.length;i+=3){const x=positions[i],y=positions[i+1],z=positions[i+2];
    if((Math.abs(Math.abs(x)-6000)<.001 && Math.abs(z)<=6000)||(Math.abs(Math.abs(z)-6000)<.001 && Math.abs(x)<=6000)){
      // Exact coastline boundary itself can classify water; the mesh edge uses
      // the core's triangular node interpolation immediately inside the land.
      if(!region.isCoreLand(x,z))continue;
      assert.ok(Math.abs(terrain.getHeight(x,z)-y)<.01,`${x},${z}: ${terrain.getHeight(x,z)} vs ${y}`);checked++;
    }}
  assert.ok(checked>100);
});

test('airport grading stays unchanged and Sihwa lake remains open water',()=>{
  const original=new IncheonFlightSurface(source);
  for(let z=-5000;z<=5000;z+=200)for(let x=-5000;x<=5000;x+=200)assert.equal(terrain.getHeight(x,z),original.getHeight(x,z));
  for(const [lat,lon] of [[37.31,126.65],[37.30,126.62],[37.40,126.4]]){
    const [x,z]=projectToLocal(lat,lon);assert.equal(terrain.getHeight(x,z),0);
  }
  for(const f of features.features.filter(f=>['plant','park','plaza'].includes(f.kind)))assert.ok(region.getHeight(...f.center)>1);
  assert.equal(region.getHeight(30000,30000),0);
  assert.throws(()=>region.getHeight(NaN,0));
});
