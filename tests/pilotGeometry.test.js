import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  buildF16PilotScene,
  createPilotMesh,
  setPilotCockpitMode,
  updatePilotDynamics,
  F16_PILOT_OFFSET,
  getPilotModelUrl,
} from '../src/aircraft/pilotGeometry.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { validateGlbFile } from '../scripts/validate-glb-mesh.mjs';

test('buildF16PilotScene creates complete pilot hierarchy with seat, body, and articulated head', () => {
  const { root, seat, body, head } = buildF16PilotScene();

  assert.ok(root instanceof THREE.Group, 'root must be a THREE.Group');
  assert.equal(root.name, 'F16_Pilot_Model');
  assert.ok(seat instanceof THREE.Group, 'seat must be a THREE.Group');
  assert.equal(seat.name, 'Pilot_Seat');
  assert.ok(body instanceof THREE.Group, 'body must be a THREE.Group');
  assert.equal(body.name, 'Pilot_Body');
  assert.ok(head instanceof THREE.Group, 'head must be a THREE.Group');
  assert.equal(head.name, 'Pilot_Head');

  // Verify all essential named components exist in the hierarchy
  const expectedNames = [
    'Pilot_Seat_Pan',
    'Pilot_Seat_BackBulkhead',
    'Pilot_Seat_Headrest',
    'Pilot_Seat_EjectionHandle',
    'Pilot_Body_Chest',
    'Pilot_Body_Shoulders',
    'Pilot_Body_HarnessBuckle',
    'Pilot_Body_Thigh_L',
    'Pilot_Body_Thigh_R',
    'Pilot_Body_Boot_L',
    'Pilot_Body_Boot_R',
    'Pilot_Body_ArmUpper_L',
    'Pilot_Body_Forearm_L',
    'Pilot_Body_Glove_L',
    'Pilot_Body_ThrottleGrip',
    'Pilot_Body_ArmUpper_R',
    'Pilot_Body_Forearm_R',
    'Pilot_Body_Glove_R',
    'Pilot_Body_StickGrip',
    'Pilot_Head_HelmetDome',
    'Pilot_Head_Visor',
    'Pilot_Head_OxygenMask',
    'Pilot_Head_OxygenHose',
  ];

  for (const name of expectedNames) {
    const obj = root.getObjectByName(name);
    assert.ok(obj, `Expected object "${name}" to exist in pilot hierarchy`);
    assert.ok(obj.isMesh, `Object "${name}" should be a Mesh`);
    assert.ok(obj.geometry, `Mesh "${name}" must have geometry`);
    assert.ok(obj.geometry.attributes.position.count > 0, `Mesh "${name}" must have vertices`);
  }
});

test('createPilotMesh returns configured group with userData references', () => {
  const pilot = createPilotMesh('f16');
  assert.ok(pilot instanceof THREE.Group);
  assert.equal(pilot.name, 'Pilot_F16');
  assert.ok(pilot.userData.head, 'pilot.userData.head must be set');
  assert.ok(pilot.userData.body, 'pilot.userData.body must be set');
  assert.ok(pilot.userData.seat, 'pilot.userData.seat must be set');
  assert.equal(pilot.userData.head.name, 'Pilot_Head');
  assert.equal(pilot.userData.body.name, 'Pilot_Body');
  assert.equal(pilot.userData.seat.name, 'Pilot_Seat');
});

test('setPilotCockpitMode toggles visibility and respects showInterior', () => {
  const pilot = createPilotMesh('f16');

  // Default exterior view
  setPilotCockpitMode(pilot, false);
  assert.equal(pilot.userData.head.visible, true);
  assert.equal(pilot.userData.body.visible, true);
  assert.equal(pilot.userData.seat.visible, true);

  // Cockpit view with interior
  setPilotCockpitMode(pilot, true, true);
  assert.equal(pilot.userData.body.visible, true);
  assert.equal(pilot.userData.seat.visible, true);

  // Cockpit view without interior
  setPilotCockpitMode(pilot, true, false);
  assert.equal(pilot.userData.body.visible, false);
  assert.equal(pilot.userData.seat.visible, false);

  // Explicit hideHead option
  setPilotCockpitMode(pilot, true, true, { hideHead: true });
  assert.equal(pilot.userData.head.visible, false);
});

test('updatePilotDynamics responds to G-forces and turn roll rate', () => {
  const pilot = createPilotMesh('f16');
  const head = pilot.userData.head;

  // Initial neutral state
  assert.equal(head.rotation.x, 0);
  assert.equal(head.rotation.z, 0);

  // High G pull (9G) -> downward head pitch
  updatePilotDynamics(pilot, { gForce: 9.0, rollRate: 0.0 });
  assert.ok(head.rotation.x < 0, `Head should pitch downward under high G, got ${head.rotation.x}`);

  // Right bank roll -> roll tilt into turn
  updatePilotDynamics(pilot, { gForce: 1.0, rollRate: 2.0 });
  assert.ok(head.rotation.z < 0, `Head should tilt into positive roll rate, got ${head.rotation.z}`);

  // Neutral state convergence
  for (let i = 0; i < 20; i++) {
    updatePilotDynamics(pilot, { gForce: 1.0, rollRate: 0.0 });
  }
  assert.ok(Math.abs(head.rotation.x) < 0.01, 'Head pitch should settle near 0 at 1G');
  assert.ok(Math.abs(head.rotation.z) < 0.01, 'Head roll should settle near 0 at zero roll rate');
});

test('F16_PILOT_OFFSET aligns pilot eye position with F16 captainEyePos', () => {
  const { root } = buildF16PilotScene();
  const visor = root.getObjectByName('Pilot_Head_Visor');
  assert.ok(visor, 'Pilot visor must exist to determine eye location');

  // Compute visor bounding center in model coordinates
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const visorBox = new THREE.Box3().setFromObject(visor);
  const modelEyeCenter = visorBox.getCenter(new THREE.Vector3());

  // Mount at F16_PILOT_OFFSET and verify world eye position matches captainEyePos
  const mountedEyePos = new THREE.Vector3(
    modelEyeCenter.x + F16_PILOT_OFFSET.x,
    modelEyeCenter.y + F16_PILOT_OFFSET.y,
    modelEyeCenter.z + F16_PILOT_OFFSET.z
  );

  const expectedEye = F16_FALCON.cockpit.captainEyePos;
  assert.ok(
    Math.abs(mountedEyePos.x - expectedEye.x) < 0.02,
    `Eye X mismatch: mounted ${mountedEyePos.x} vs expected ${expectedEye.x}`
  );
  assert.ok(
    Math.abs(mountedEyePos.y - expectedEye.y) < 0.05,
    `Eye Y mismatch: mounted ${mountedEyePos.y} vs expected ${expectedEye.y}`
  );
  assert.ok(
    Math.abs(mountedEyePos.z - expectedEye.z) < 0.05,
    `Eye Z mismatch: mounted ${mountedEyePos.z} vs expected ${expectedEye.z}`
  );
});

test('public/models/pilot-f16.glb exists and passes mesh geometry validation', async () => {
  const filePath = 'public/models/pilot-f16.glb';
  assert.ok(fs.existsSync(filePath), `${filePath} must exist on disk`);
  const stat = fs.statSync(filePath);
  assert.ok(stat.size > 50000, `GLB file size (${stat.size} bytes) should be substantial`);

  const result = await validateGlbFile(filePath);
  assert.equal(result.valid, true, `Validation failed: ${result.errors?.join('; ')}`);
  assert.ok(result.stats.triangles > 2000, `Expected >2000 triangles, got ${result.stats.triangles}`);
  assert.ok(result.stats.meshes >= 40, `Expected >=40 meshes, got ${result.stats.meshes}`);
  assert.ok(result.stats.materials.includes('pilot-helmet'), 'Must contain pilot-helmet material');
  assert.ok(result.stats.materials.includes('pilot-visor'), 'Must contain pilot-visor material');
  assert.ok(result.stats.materials.includes('pilot-mask'), 'Must contain pilot-mask material');
  assert.ok(result.stats.materials.includes('pilot-suit'), 'Must contain pilot-suit material');
  assert.ok(result.stats.materials.includes('pilot-seat-frame'), 'Must contain pilot-seat-frame material');
});

test('getPilotModelUrl resolves default and custom variants', () => {
  assert.match(getPilotModelUrl('f16'), /models\/pilot-f16\.glb$/);
});
