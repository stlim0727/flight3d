import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AircraftBreakup } from '../src/effects/AircraftBreakup.js';

function fixture() {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const exterior = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  exterior.add(new THREE.Mesh(new THREE.BoxGeometry(20, 2, 30, 4, 1, 8), material));
  group.add(exterior);
  scene.add(group);
  group.position.set(40, 5, 20);
  const aircraft = { group, gltfGroup: exterior, useGltf: true, setCockpitMode() {} };
  return { scene, aircraft, material };
}

test('breakup conserves triangles, separates actual geometry and restores aircraft through repeated reset', () => {
  const { scene, aircraft, material } = fixture();
  const breakup = new AircraftBreakup(scene);
  for (let cycle = 0; cycle < 2; cycle++) {
    breakup.spawn(aircraft, new THREE.Vector3(30, -10, 0), 'TERRAIN');
    assert.equal(aircraft.group.visible, false);
    assert.equal(breakup.pieces.length, 6);
    let vertices = 0;
    for (const { object } of breakup.pieces) object.traverse(m => {
      if (m.isMesh) { vertices += m.geometry.attributes.position.count; assert.equal(m.material, material); }
    });
    assert.equal(vertices, aircraft.gltfGroup.children[0].geometry.index.count);
    const start = breakup.pieces[0].object.position.clone();
    breakup.update(1, { getHeight: () => 0 });
    assert.ok(breakup.pieces[0].object.position.distanceTo(start) > 1);
    for (let i = 0; i < 20; i++) breakup.update(1, { getHeight: () => 0 });
    for (const p of breakup.pieces) {
      assert.ok(p.object.position.y >= p.radius);
      assert.ok(p.velocity.length() < 0.1);
    }
    breakup.clear();
    assert.equal(aircraft.group.visible, true);
    assert.equal(scene.children.length, 1);
  }
});

test('water fragments sink and damp without bouncing off seabed', () => {
  const { scene, aircraft } = fixture();
  const breakup = new AircraftBreakup(scene);
  breakup.spawn(aircraft, new THREE.Vector3(0, -20, 0), 'WATER');
  for (let i = 0; i < 5; i++) breakup.update(1, { getHeight: () => -1000 }, 0);
  assert.ok(breakup.pieces.every(p => p.object.position.y < 0 && p.velocity.y < 0));
  assert.equal(breakup.target.y, 0);
});

test('crash camera frames debris outside in portrait and rejects cockpit changes until reset', async () => {
  const { CameraSystem } = await import('../src/cameras/CameraSystem.js');
  const camera = new THREE.PerspectiveCamera(58, 0.5, 0.08, 45000);
  const system = new CameraSystem(camera, null);
  system.setMode(0, true);
  const wreckage = { target: new THREE.Vector3(10, 4, 20), radius: 25 };
  system.beginCrashView(wreckage);
  assert.equal(system.mode, 1);
  assert.equal(system.setMode(0, true), false);
  assert.ok(camera.position.distanceTo(wreckage.target) > 100);
  system.update(1, new THREE.Group());
  system.endCrashView();
  assert.equal(system.mode, 0);
  assert.equal(system.crashView, null);
});

test('ending a crash clears impact shake before the next flight, including repeated cleanup', async () => {
  const { CameraSystem } = await import('../src/cameras/CameraSystem.js');
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  const aircraft = new THREE.Group();
  const wreckage = { target: new THREE.Vector3(), radius: 15 };
  for (let cycle = 0; cycle < 3; cycle++) {
    system.beginCrashView(wreckage);
    system.addTrauma(1);
    system.update(5, aircraft);
    assert.equal(system.trauma, 1, 'crash view bypasses normal shake decay');
    system.endCrashView();
    assert.equal(system.trauma, 0, 'reset must clear impact shake immediately');
    system.endCrashView();
    system.update(1 / 60, aircraft);
    assert.equal(system.trauma, 0, 'new flight must not inherit impact shake');
  }
  system.addTrauma(0.5);
  system.endCrashView();
  assert.equal(system.trauma, 0, 'cleanup also clears trauma without an active crash rig');
});

test('camera reset preserves automatic and manual selection across repeated crashes', async () => {
  const { CameraSystem } = await import('../src/cameras/CameraSystem.js');
  const wreckage = { target: new THREE.Vector3(), radius: 15 };
  for (const manual of [false, true]) {
    const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
    system.setMode(CameraSystem.MODES.COCKPIT, manual);
    for (let cycle = 0; cycle < 2; cycle++) {
      system.beginCrashView(wreckage);
      system.showTemporaryView(CameraSystem.MODES.GEAR);
      assert.equal(system.mode, CameraSystem.MODES.CHASE);
      system.endCrashView();
      assert.equal(system.userModeSelected, manual);
      assert.equal(system.setMode(CameraSystem.MODES.COCKPIT), !manual);
      system.showTemporaryView(CameraSystem.MODES.GEAR);
      assert.equal(system.mode, manual ? CameraSystem.MODES.COCKPIT : CameraSystem.MODES.GEAR);
      system.cancelTemporaryView();
    }
  }
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  const updater = () => true;
  system.setMode(CameraSystem.MODES.AUTO, true);
  system.setCustomViewUpdater(updater);
  system.autoPaused = true;
  system.autoSwitchTimer = 3;
  system.beginCrashView(wreckage);
  system.endCrashView();
  assert.equal(system.autoSwitch, true);
  assert.equal(system.autoPaused, true);
  assert.equal(system.autoSwitchTimer, 3);
  assert.equal(system.customViewUpdater, updater);
});

test('loaded exterior includes independent landing gear without duplicating nested gear', () => {
  for (const nested of [false, true]) {
    const { scene, aircraft } = fixture();
    const gear = new THREE.Group();
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4, 8), new THREE.MeshStandardMaterial());
    wheel.position.set(0, -2, 5);
    gear.add(wheel);
    (nested ? aircraft.gltfGroup : aircraft.group).add(gear);
    aircraft.gearGroup = gear;
    const expected = aircraft.gltfGroup.children[0].geometry.index.count + wheel.geometry.index.count;
    const breakup = new AircraftBreakup(scene);
    breakup.spawn(aircraft, new THREE.Vector3());
    let vertices = 0, wheelVertices = 0;
    for (const { object } of breakup.pieces) object.traverse(m => {
      if (!m.isMesh) return;
      vertices += m.geometry.attributes.position.count;
      if (m.material === wheel.material) wheelVertices += m.geometry.attributes.position.count;
    });
    assert.equal(vertices, expected);
    assert.equal(wheelVertices, wheel.geometry.index.count);
    breakup.clear();
    assert.equal(wheel.parent, gear);
  }
});

test('crashing during a temporary gear view restores its underlying view without a stale timer', async () => {
  const { CameraSystem } = await import('../src/cameras/CameraSystem.js');
  const wreckage = { target: new THREE.Vector3(), radius: 15 };
  for (const mode of [CameraSystem.MODES.COCKPIT, CameraSystem.MODES.CHASE, CameraSystem.MODES.AUTO]) {
    const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
    system.setMode(mode);
    for (let cycle = 0; cycle < 2; cycle++) {
      system.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
      assert.equal(system.mode, CameraSystem.MODES.GEAR);
      system.beginCrashView(wreckage);
      system.endCrashView();
      assert.equal(system.mode, mode === CameraSystem.MODES.AUTO ? CameraSystem.MODES.CHASE : mode);
      assert.equal(system.autoSwitch, mode === CameraSystem.MODES.AUTO);
      assert.equal(system.savedMode, null);
      assert.equal(system.temporaryViewTimer, 0);
      assert.equal(system.userModeSelected, false);
    }
  }
});

test('mirrored fallback triangles retain front faces, tangent handedness and matching UVs', () => {
  for (const indexed of [false, true]) {
    const { scene, aircraft } = fixture();
    aircraft.useGltf = false;
    aircraft.proceduralGroup = aircraft.gltfGroup;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geometry.setAttribute('tangent', new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
    if (indexed) geometry.setIndex([0, 1, 2]);
    const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
    const wing = new THREE.Group();
    wing.scale.x = -1;
    wing.add(new THREE.Mesh(geometry, material));
    aircraft.proceduralGroup.add(wing);
    const breakup = new AircraftBreakup(scene);
    breakup.spawn(aircraft, new THREE.Vector3());
    let triangles = 0;
    for (const { object } of breakup.pieces) object.traverse(mesh => {
      if (!mesh.isMesh || mesh.material !== material) return;
      const p = mesh.geometry.attributes.position;
      const normal = mesh.geometry.attributes.normal;
      const tangent = mesh.geometry.attributes.tangent;
      const uv = mesh.geometry.attributes.uv;
      const [a, b, c] = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(p, i));
      assert.ok(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3().fromBufferAttribute(normal, 0)) > 0);
      for (let i = 0; i < 3; i++) {
        assert.equal(tangent.getW(i), -1);
        assert.equal(tangent.getX(i), -1);
      }
      assert.deepEqual(Array.from(uv.array), [0, 1, 1, 0, 0, 0]);
      triangles++;
    });
    assert.equal(triangles, 1);
    assert.equal(geometry.attributes.tangent.getW(0), 1, 'source attributes stay untouched');
  }
});

test('long elapsed updates preserve all time and match grouped updates', () => {
  const make = () => {
    const { scene, aircraft } = fixture();
    const breakup = new AircraftBreakup(scene);
    breakup.spawn(aircraft, new THREE.Vector3(25, -5, 0));
    return breakup;
  };
  const whole = make(), grouped = make();
  const terrain = { getHeight: () => -1000 };
  whole.update(10, terrain, 0);
  for (let i = 0; i < 10; i++) grouped.update(1, terrain, 0);
  whole.pieces.forEach((p, i) => {
    const q = grouped.pieces[i];
    assert.ok(p.object.position.distanceTo(q.object.position) < 1e-8);
    assert.ok(p.velocity.distanceTo(q.velocity) < 1e-8);
    assert.ok(p.object.quaternion.angleTo(q.object.quaternion) < 1e-7);
  });
});

test('water drag follows immersion for ship impacts and ends after reaching dry land', () => {
  const make = type => {
    const { scene, aircraft } = fixture();
    const breakup = new AircraftBreakup(scene);
    breakup.spawn(aircraft, new THREE.Vector3(20, -5, 0), type);
    for (const p of breakup.pieces) p.object.position.set(-20, -5, 0);
    return breakup;
  };
  const ship = make('SHIP'), water = make('WATER'), dry = make('SHIP');
  const seabed = { getHeight: () => -1000 };
  ship.update(1, seabed, 0);
  water.update(1, seabed, 0);
  dry.update(1, seabed); // Same coordinates in a scene without an ocean.
  ship.pieces.forEach((p, i) => {
    assert.deepEqual(p.object.position.toArray(), water.pieces[i].object.position.toArray());
    assert.ok(p.velocity.length() < dry.pieces[i].velocity.length());
  });
  assert.equal(ship.target.y, 0);
  assert.ok(dry.target.y < 0);

  // A water-origin fragment reaching a raised beach still contacts solid terrain.
  const shore = { getHeight: x => x < 0 ? -1000 : 5 };
  for (const p of water.pieces) { p.object.position.set(-1, 12, 0); p.velocity.set(20, -5, 0); }
  water.update(10, shore, 0);
  for (const p of water.pieces) {
    assert.ok(p.object.position.x > 0);
    assert.equal(p.object.position.y, 5 + p.radius);
    assert.ok(p.velocity.length() < 0.1);
  }
  assert.ok(water.target.y > 0);
});

test('submerged fragments settle on the seabed without a dry-ground bounce', () => {
  const { scene, aircraft } = fixture();
  const breakup = new AircraftBreakup(scene);
  breakup.spawn(aircraft, new THREE.Vector3(0, -20, 0), 'SHIP');
  const seabed = { getHeight: () => -30 };
  for (const p of breakup.pieces) p.object.position.y = -30 + p.radius;
  breakup.update(1 / 120, seabed, 0);
  for (const p of breakup.pieces) {
    assert.equal(p.object.position.y, -30 + p.radius);
    assert.ok(Math.abs(p.velocity.y) < 1e-12);
  }
});
