import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ValleyWaypointsVisualizer,
  calculateEdgeArrowState,
  createSignboardCanvas,
} from '../src/arena/ValleyWaypointsVisualizer.js';
import { createValleyManifest } from '../src/arena/valleyCourse.js';
import { createValleySimulation } from './helpers/valleyFlight.js';
import { ValleyMissionAdapter } from '../src/arena/ValleyMissionAdapter.js';

test('calculateEdgeArrowState correctly detects on-screen vs off-screen directions', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10000);
  camera.position.set(0, 100, 0);
  camera.quaternion.set(0, 0, 0, 1); // Looking along -Z, +X is right, +Y is up
  camera.updateMatrixWorld(true);

  // 1. Point straight ahead (at 500m along -Z) -> visible horizontally, no arrow
  const straightAhead = new THREE.Vector3(0, 100, -500);
  const stateAhead = calculateEdgeArrowState(straightAhead, camera, 0.88);
  assert.equal(stateAhead.visible, false);
  assert.equal(stateAhead.direction, null);

  // 2. Point far to the left (x = -1500, z = -500) -> off-screen left arrow
  const offLeft = new THREE.Vector3(-1500, 100, -500);
  const stateLeft = calculateEdgeArrowState(offLeft, camera, 0.88);
  assert.equal(stateLeft.visible, true);
  assert.equal(stateLeft.direction, 'left');

  // 3. Point far to the right (x = 1500, z = -500) -> off-screen right arrow
  const offRight = new THREE.Vector3(1500, 100, -500);
  const stateRight = calculateEdgeArrowState(offRight, camera, 0.88);
  assert.equal(stateRight.visible, true);
  assert.equal(stateRight.direction, 'right');

  // 4. Point behind camera on left (x = -300, z = 500) -> turn left arrow
  const behindLeft = new THREE.Vector3(-300, 100, 500);
  const stateBehindLeft = calculateEdgeArrowState(behindLeft, camera, 0.88);
  assert.equal(stateBehindLeft.visible, true);
  assert.equal(stateBehindLeft.direction, 'left');
  assert.equal(stateBehindLeft.isBehind, true);

  // 5. Point behind camera on right (x = 300, z = 500) -> turn right arrow
  const behindRight = new THREE.Vector3(300, 100, 500);
  const stateBehindRight = calculateEdgeArrowState(behindRight, camera, 0.88);
  assert.equal(stateBehindRight.visible, true);
  assert.equal(stateBehindRight.direction, 'right');
  assert.equal(stateBehindRight.isBehind, true);
});

test('createSignboardCanvas handles missing document gracefully', () => {
  // In Node environment without global document, should return null safely
  const canvas = createSignboardCanvas(1, false);
  assert.equal(canvas, null);
});

test('ValleyWaypointsVisualizer handles headless simulation safely', () => {
  const sim = { currentTerrain: { getHeight: () => 2000 } };
  const manifest = createValleyManifest();
  const visualizer = new ValleyWaypointsVisualizer(sim, manifest.course);
  assert.equal(visualizer.headless, true);

  // Methods should execute without error in headless mode
  visualizer.setNextGateIndex(2);
  visualizer.update();
  visualizer.dispose();
  assert.equal(visualizer.active, false);
});

test('ValleyWaypointsVisualizer populates 3D meshes when scene is available', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10000);
  const sim = {
    scene,
    camera,
    position: new THREE.Vector3(-1700, 2300, 500),
    currentTerrain: { getHeight: () => 2100 },
  };

  // Mock document.createElement to test mesh creation in Node
  const originalDoc = globalThis.document;
  try {
    globalThis.document = {
      createElement: (tag) => {
        if (tag === 'div') {
          return {
            id: '',
            setAttribute() {},
            hidden: true,
            classList: new Set(),
            className: '',
            innerHTML: '',
            remove() {},
          };
        }
        return {};
      },
      body: { append() {} },
      getElementById: () => null,
    };

    const manifest = createValleyManifest();
    const visualizer = new ValleyWaypointsVisualizer(sim, manifest.course);
    assert.equal(visualizer.headless, undefined);
    assert.ok(scene.children.includes(visualizer.group));

    // Verify 6 waypoints (gates 1 through 5, and finish 6)
    assert.equal(visualizer.waypoints.length, 7); // indices 1..6 populated
    assert.ok(visualizer.waypoints[1].group);
    assert.ok(visualizer.waypoints[6].isFinish);

    // Test update loop
    visualizer.setNextGateIndex(2);
    visualizer.update();
    assert.equal(visualizer.waypoints[1].group.visible, false); // passed gate is hidden
    assert.equal(visualizer.waypoints[2].group.visible, true);  // current gate is visible
    assert.equal(visualizer.waypoints[3].group.visible, true);  // upcoming gate is visible

    // Test dispose
    visualizer.dispose();
    assert.equal(scene.children.includes(visualizer.group), false);
  } finally {
    globalThis.document = originalDoc;
  }
});

test('ValleyMissionAdapter lifecycle manages visualizer and cleans up on release', async () => {
  const sim = createValleySimulation();
  const adapter = new ValleyMissionAdapter(sim);

  const { manifest } = await adapter.prepare({ environmentProfile: 'calm-debug-v1', noise: false });
  assert.ok(adapter.visualizer);
  assert.equal(sim.valleyVisualizer, adapter.visualizer);

  adapter.acquire();
  adapter.step();

  adapter.release();
  assert.equal(adapter.visualizer, null);
  assert.equal(sim.valleyVisualizer, null);
});
