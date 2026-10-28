import test from 'node:test';
import assert from 'node:assert/strict';
import { createDepartureJetBridge } from '../src/environment/DepartureJetBridge.js';
import * as THREE from 'three';
import { DEPARTURE_GATE } from '../src/config/incheonDeparture.js';

test('737 bridge docks at the port door and telescopes clear without moving the terminal mount',()=>{
  const b=createDepartureJetBridge(7),anchor=b.group.position.clone();
  b.setExtension(1);b.group.updateMatrixWorld(true);
  const accessForward=new THREE.Vector3(0,0,1).applyQuaternion(b.access.getWorldQuaternion(new THREE.Quaternion()));
  const armForward=new THREE.Vector3(0,0,1).applyQuaternion(b.arm.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(Math.abs(accessForward.dot(armForward))<1e-10,'fixed access and telescopic arm form a right-angle gate');
  const facing=new THREE.Vector3(0,0,1).applyQuaternion(b.cab.getWorldQuaternion(new THREE.Quaternion()));
  const intoDoor=new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),-DEPARTURE_GATE.heading);
  assert.ok(facing.dot(intoDoor)>.999,'door hood faces across the port side');
  const dock=b.cab.localToWorld(new THREE.Vector3(0,0,1.05));
  assert.ok(Math.hypot(dock.x-b.door.x,dock.z-b.door.z)<.001);
  b.setExtension(0);b.group.updateMatrixWorld(true);
  const parked=b.cab.localToWorld(new THREE.Vector3(0,0,1.05));
  assert.ok(dock.distanceTo(parked)>12.9);
  assert.ok(b.group.position.equals(anchor));
  b.setExtension(5);assert.equal(b.extension,1);
  b.setExtension(-1);assert.equal(b.extension,0);
});
