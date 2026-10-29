import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Object3D, Euler, Vector3 } from 'three';
import { projectHudDirection, hudDirection } from '../src/ui/HudProjection.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-6, `${a} ≠ ${b}`);
test('HUD horizon projection follows pitch, roll, heading wrap and field of view', () => {
  const camera = new PerspectiveCamera(60, 16/9, .25, 100000);
  const project = (h,e) => projectHudDirection(hudDirection(h,e),camera,1600,900);
  close(project(0,0).x,800); close(project(0,0).y,450);
  camera.position.set(10000,3000,-50000);
  close(project(0,0).y,450); // Direction projection is translation independent.
  camera.quaternion.setFromEuler(new Euler(10*Math.PI/180,0,0));
  close(project(0,10).y,450);
  assert.ok(project(0,0).y > 450, 'nose up moves real horizon below boresight');
  const narrow = project(0,0).y;
  camera.fov = 90;
  assert.ok(project(0,0).y < narrow, 'wide FOV compresses angular displacement');
  camera.quaternion.setFromEuler(new Euler(0,0,30*Math.PI/180));
  assert.ok(project(10,0).y > project(-10,0).y, 'bank rotates the world horizon');
  camera.quaternion.identity();
  close(project(360,0).x,project(0,0).x);
  assert.equal(project(180,0),null,'behind-eye directions never wrap onto display');
});

test('HUD keeps aircraft boresight through look/reset, aircraft changes, cuts and crash recovery', () => {
  const camera = new PerspectiveCamera();
  const system = new CameraSystem(camera,null), aircraft = new Object3D();
  aircraft.position.set(50,800,30);
  aircraft.quaternion.setFromEuler(new Euler(.3,-1,.5));
  aircraft.updateMatrixWorld();
  system.setMode(CameraSystem.MODES.HUD,true);
  for (const offset of [[0,.5,-2],[-.39,.85,-12.35]]) {
    system.loadAircraftConfig({cockpit:{captainEyePos:{x:offset[0],y:offset[1],z:offset[2]}}});
    system.applyMouseDelta(100,50);
    system.resetLook();
    system.showTemporaryView(CameraSystem.MODES.GEAR,3);
    assert.equal(system.setMode(CameraSystem.MODES.CHASE),false);
    system.update(.1,aircraft,{pitchDeg:17,rollDeg:29});
    assert.equal(system.mode,CameraSystem.MODES.HUD);
    close(camera.quaternion.angleTo(aircraft.quaternion),0);
    const expected = system.cockpitHeadOffset.clone().applyMatrix4(aircraft.matrixWorld);
    close(camera.position.distanceTo(expected),0);
    system.snapToTarget(aircraft);
    close(camera.position.distanceTo(expected),0);
  }
  system.cycleMode(); assert.equal(system.mode,CameraSystem.MODES.CHASE);
  system.setMode(CameraSystem.MODES.HUD,true);
  const wreckage = {target:new Vector3(),radius:10};
  system.beginCrashView(wreckage);
  assert.equal(system.mode,CameraSystem.MODES.CHASE);
  system.endCrashView();
  assert.equal(system.mode,CameraSystem.MODES.HUD);
});
