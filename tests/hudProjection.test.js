import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Object3D, Euler, Vector3 } from 'three';
import { projectHudDirection, hudDirection } from '../src/ui/HudProjection.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { HudView } from '../src/ui/HudView.js';

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

test('HUD look, zoom, reset, aircraft changes, cuts and crash recovery', () => {
  const camera = new PerspectiveCamera();
  const system = new CameraSystem(camera,null), aircraft = new Object3D();
  aircraft.position.set(50,800,30);
  aircraft.quaternion.setFromEuler(new Euler(.3,-1,.5));
  aircraft.updateMatrixWorld();
  system.setMode(CameraSystem.MODES.HUD,true);
  const defaultPitch = system.aircraftLookPitch ?? -0.25;
  for (const offset of [[0,.5,-2],[-.39,.85,-12.35]]) {
    system.loadAircraftConfig({cockpit:{captainEyePos:{x:offset[0],y:offset[1],z:offset[2]}}});
    system.applyMouseDelta(1000,50);
    assert.ok(!!system.isLookingAwayFromCenter(), 'look away hides the conformal HUD');
    system.update(.1,aircraft,{pitchDeg:17,rollDeg:29});
    assert.ok(camera.quaternion.angleTo(aircraft.quaternion) > 0.1, 'HUD view moves with look input');
    system.resetLook();
    system.lookPitch = defaultPitch;
    system.showTemporaryView(CameraSystem.MODES.GEAR,3);
    assert.equal(system.setMode(CameraSystem.MODES.CHASE),false);
    system.update(.1,aircraft,{pitchDeg:17,rollDeg:29});
    assert.equal(system.mode,CameraSystem.MODES.HUD);
    assert.ok(!system.isLookingAwayFromCenter(), 'reset restores the forward HUD view');
    const forward = new Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    close(forward.angleTo(new Vector3(0,0,-1).applyQuaternion(aircraft.quaternion)),0);
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

test('HUD zoom narrows the field of view and head look can turn away from forward', () => {
  const camera = new PerspectiveCamera(54);
  const system = new CameraSystem(camera,null), aircraft = new Object3D();
  system.setMode(CameraSystem.MODES.HUD,true);
  assert.equal(system.usesOpticalZoom(), true);
  const baseFov = 54;
  assert.equal(system.zoomOpticalBy(2), true);
  assert.ok(system.applyBaseFov(54) < 40, 'HUD zoom narrows FOV');
  system.resetLook();
  system.setHeadTrackingEnabled(true);
  system.setHeadLook(1.0, 0);
  system.update(.1, aircraft, {});
  assert.ok(system.headLookActive, 'head tracking reaches HUD view');
  assert.ok(!!system.isLookingAwayFromCenter(), 'head look away hides the HUD');
  const forward = new Vector3(0,0,-1).applyQuaternion(camera.quaternion).applyQuaternion(aircraft.quaternion.clone().invert());
  assert.ok(forward.x < -0.5, 'HUD camera follows head yaw');
});

test('conformal HUD stays visible only while looking forward', () => {
  const originalDocument = globalThis.document;
  const originalPixelRatio = globalThis.devicePixelRatio;
  const overlay = { append() {} };
  const body = { classList: { contains: () => false, toggle() {} }, append() {} };
  const createElement = () => ({
    hidden: true,
    style: {},
    setAttribute() {},
    querySelector: () => ({ getContext: () => null }),
  });
  globalThis.document = { getElementById: () => overlay, body, createElement };
  globalThis.devicePixelRatio = 1;
  try {
    const camera = new PerspectiveCamera();
    const system = new CameraSystem(camera, null);
    const view = new HudView({ cameraSystem: system, camera, telemetry: {} });
    const noop = () => {};
    view.ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : noop), set: (target, key, value) => { target[key] = value; return true; } });
    view.root.clientWidth = 800;
    view.root.clientHeight = 600;
    system.setMode(CameraSystem.MODES.HUD, true);
    view.update();
    assert.equal(view.root.hidden, false, 'forward HUD is drawn');
    system.lookYaw = 1.0;
    view.update();
    assert.equal(view.root.hidden, true, 'looking away hides the conformal HUD');
    system.resetLook();
    view.update();
    assert.equal(view.root.hidden, false, 'returning forward restores the HUD');
  } finally {
    globalThis.document = originalDocument;
    globalThis.devicePixelRatio = originalPixelRatio;
  }
});
