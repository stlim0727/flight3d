import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIncheonPavement } from '../src/environment/IncheonPavement.js';

const runway={kind:'runway',points:[[0,-10],[0,10]],width:8};
const taxiway={kind:'taxiway',points:[[-12,0],[12,0]],width:6};
function area(mesh) {
  const p=mesh.geometry.attributes.position;let sum=0;
  for(let i=0;i<p.count;i+=3)sum+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i)))/2;
  return sum;
}
function colors(group,x,z) {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x,20,z),new THREE.Vector3(0,-1,0)).intersectObject(group,true).map(hit=>hit.object.material.color.getHex());
}

test('runway/taxi intersection has exactly one surface, preserving paved union and height',()=>{
  const field={elevationM:7,surfaces:[taxiway,runway]},snapshot=JSON.stringify(field);
  const pavement=createIncheonPavement(field);
  const runwayMesh = pavement.getObjectByName('incheon-runway-pavement');
  assert.equal(runwayMesh.material.isMeshStandardMaterial, true);
  const positions = runwayMesh.geometry.attributes.position;
  const uvs = runwayMesh.geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    assert.ok(Math.abs(uvs.getX(i) * 3 - positions.getX(i)) < 1e-5);
    assert.ok(Math.abs(uvs.getY(i) * 3 + positions.getZ(i)) < 1e-5);
  }
  assert.equal(area(pavement.getObjectByName('incheon-runway-pavement')),160);
  assert.equal(area(pavement.getObjectByName('incheon-taxiway-pavement')),96);
  assert.deepEqual(colors(pavement,1.25,1.75),[0x55595a],'runway wins without coplanar grey triangles below it');
  assert.deepEqual(colors(pavement,5,1.75),[0x92968e],'taxiway still reaches the runway edge');
  assert.deepEqual(colors(pavement,1.25,8),[0x55595a]);
  for(const mesh of pavement.children){
    const p=mesh.geometry.attributes.position,target=7+(mesh.name.includes('marking')?.03:.015);
    for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-target)<1e-6);
    assert.equal(mesh.material.depthTest,true,'aircraft and scenery still occlude pavement');
  }
  assert.equal(JSON.stringify(field),snapshot,'source centerlines, widths and elevation are untouched');
});

test('apron clipping preserves holes and a multi-segment runway footprint',()=>{
  const apron={kind:'apron',area:true,points:[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]],holes:[[[8,8],[12,8],[12,12],[8,12],[8,8]]]};
  const splitRunway={...runway,points:[[0,-10],[0,0],[0,10]]};
  const pavement=createIncheonPavement({elevationM:7,surfaces:[apron,splitRunway]});
  assert.ok(Math.abs(area(pavement.getObjectByName('incheon-taxiway-pavement'))-1424)<1e-5);
  assert.deepEqual(colors(pavement,10,10),[],'source apron hole remains empty');
  assert.deepEqual(colors(pavement,2.1,-1.7),[0x55595a]);
  assert.deepEqual(colors(pavement,4.1,-1.7),[0x92968e]);
});

test('pavement without a runway keeps its original area',()=>{
  const pavement=createIncheonPavement({elevationM:7,surfaces:[taxiway]});
  assert.equal(area(pavement.getObjectByName('incheon-taxiway-pavement')),144);
});
