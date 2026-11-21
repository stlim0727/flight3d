import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildCivilPilotScene,
  createB737Pilots,
  createC172Pilot,
  poseCivilHands,
  setCivilPilotView,
  countPilotMeshes,
  solveTwoBone,
  B737_CAPTAIN_EYE,
  C172_PILOT_EYE,
} from '../src/aircraft/civilPilotGeometry.js';
import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { Cessna172 } from '../src/aircraft/Cessna172.js';

if (typeof document === 'undefined') {
  // Cockpit display canvases only need a drawable 2D context stub under Node.
  const noop = () => {};
  const context = new Proxy({}, { get: () => () => ({ addColorStop: noop }) });
  globalThis.document = { createElement: () => ({ getContext: () => context, width: 64, height: 64 }) };
}

function materialNames(root) {
  const names = new Set();
  root.traverse(node => { if (node.isMesh) names.add(node.material.name); });
  return names;
}

function handCentre(pilot, side) {
  const hand = pilot.userData.limbs.arms[side < 0 ? 0 : 1].hand;
  pilot.parent?.updateMatrixWorld(true);
  pilot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(hand);
  const centre = box.getCenter(new THREE.Vector3());
  // Express in the pilot's parent frame (identity when unparented).
  return pilot.parent ? pilot.parent.worldToLocal(centre) : centre;
}

function eyeInParent(pilot) {
  return pilot.userData.eye.clone().multiplyScalar(pilot.scale.x).add(pilot.position);
}

test('civil pilot styles share the named seat/body/head hierarchy', () => {
  for (const style of ['airlineCaptain', 'airlineFirstOfficer', 'cessna']) {
    const { root, seat, body, head, limbs } = buildCivilPilotScene(style);
    assert.equal(seat.name, 'Pilot_Seat');
    assert.equal(body.name, 'Pilot_Body');
    assert.equal(head.name, 'Pilot_Head');
    assert.equal(limbs.arms.length, 2);
    assert.equal(limbs.legs.length, 2);
    for (const name of ['Pilot_Arm_L_Hand', 'Pilot_Arm_R_Hand', 'Pilot_Leg_L_Foot', 'Pilot_Leg_R_Foot']) {
      assert.ok(root.getObjectByName(name), `${style} must have ${name}`);
    }
    root.traverse(node => {
      if (node.isMesh) assert.ok(node.geometry.attributes.position.count > 0, `${node.name} has vertices`);
    });
  }
});

test('airline uniform is black with gold braid; captain wears four stripes, first officer three', () => {
  const captain = buildCivilPilotScene('airlineCaptain');
  const officer = buildCivilPilotScene('airlineFirstOfficer');
  const names = materialNames(captain.root);
  for (const name of ['pilot-airline-uniform', 'pilot-airline-gold', 'pilot-airline-shirt',
    'pilot-airline-tie', 'pilot-airline-cap', 'pilot-airline-sunglass-lens']) {
    assert.ok(names.has(name), `airline pilot must use ${name}`);
  }
  const uniform = captain.root.getObjectByName('Pilot_Torso_pilot-airline-uniform').material.color;
  assert.ok(uniform.r < 0.03 && uniform.g < 0.03 && uniform.b < 0.03, 'uniform reads as black');

  const goldTriangles = pilot => {
    const mesh = pilot.root.getObjectByName('Pilot_Arm_L_Fore_pilot-airline-gold');
    return mesh.geometry.index.count / 3;
  };
  assert.equal(goldTriangles(captain) / goldTriangles(officer), 4 / 3);
  // Cap badge and visor sit on the head, so the first-person view hides them with the head.
  assert.ok(captain.head.getObjectByName('Pilot_Head_pilot-airline-cap'));
  assert.ok(captain.head.getObjectByName('Pilot_Head_pilot-airline-cap-visor'));
});

test('cessna pilot wears brown leather jacket, scarf, leather helmet with goggles and khaki trousers', () => {
  const { root, head } = buildCivilPilotScene('cessna');
  const names = materialNames(root);
  for (const name of ['pilot-cessna-leather-jacket', 'pilot-cessna-scarf', 'pilot-cessna-leather-helmet',
    'pilot-cessna-goggle-lens', 'pilot-cessna-gloves', 'pilot-cessna-khaki', 'pilot-cessna-boots']) {
    assert.ok(names.has(name), `cessna pilot must use ${name}`);
  }
  const jacket = root.getObjectByName('Pilot_Torso_pilot-cessna-leather-jacket').material.color;
  assert.ok(jacket.r > jacket.g && jacket.g > jacket.b, 'jacket reads as brown');
  assert.ok(head.getObjectByName('Pilot_Head_pilot-cessna-goggle-lens'));
  assert.ok(head.getObjectByName('Pilot_Head_pilot-cessna-leather-helmet'));
});

test('two-bone IK reaches targets inside the nominal reach exactly', () => {
  const joint = new THREE.Vector3();
  const end = new THREE.Vector3();
  const root = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.2, -0.1, -0.35);
  const stretch = solveTwoBone(root, target, 0.3, 0.26, new THREE.Vector3(1, -1, 0), joint, end);
  assert.equal(stretch, 1);
  assert.ok(end.distanceTo(target) < 1e-6);
  assert.ok(Math.abs(joint.distanceTo(root) - 0.3) < 1e-6);
  assert.ok(Math.abs(joint.distanceTo(end) - 0.26) < 1e-6);
});

test('737 pilots: captain eye matches the cockpit camera and both pilots grip their yokes', () => {
  const { captain, firstOfficer } = createB737Pilots();
  setCivilPilotView(captain, true, true);
  const eye = eyeInParent(captain);
  assert.ok(eye.distanceTo(new THREE.Vector3(...B737_CAPTAIN_EYE)) < 1e-6);

  for (const pilot of [captain, firstOfficer]) {
    const stretch = poseCivilHands(pilot);
    assert.ok(stretch < 1.15, `${pilot.name} arms stretch ${stretch}`);
    pilot.userData.targets.grips.forEach((grip, i) => {
      const distance = handCentre(pilot, i === 0 ? -1 : 1).distanceTo(grip);
      assert.ok(distance < 0.035, `${pilot.name} hand ${i} is ${distance.toFixed(3)} m from its yoke horn`);
    });
    assert.ok(countPilotMeshes(pilot) <= 32, `${pilot.name} draws ${countPilotMeshes(pilot)} meshes`);
  }
  // First officer sits to the captain's right.
  assert.ok(firstOfficer.position.x - captain.position.x > 0.5);
});

test('own first-person view hides only the head; the first officer keeps the head', () => {
  const { captain, firstOfficer } = createB737Pilots();
  setCivilPilotView(captain, true, true);
  setCivilPilotView(firstOfficer, true, true, { ownView: false });
  assert.equal(captain.userData.head.visible, false);
  assert.equal(captain.userData.body.visible, true);
  assert.equal(firstOfficer.userData.head.visible, true);
  setCivilPilotView(captain, true, false);
  assert.equal(captain.userData.body.visible, false);
  setCivilPilotView(captain, false, true);
  assert.equal(captain.userData.head.visible, true);
});

test('hands rest on the thighs when the yokes are hidden', () => {
  const { captain } = createB737Pilots();
  poseCivilHands(captain, 'rest');
  const hand = handCentre(captain, -1);
  const local = hand.clone().sub(captain.position).divideScalar(captain.scale.x);
  assert.ok(local.y < 0.25 && local.z > -0.45, `rest hand at ${local.toArray()}`);
});

test('cessna pilot sits under the cockpit camera on the left seat and reaches the yoke', () => {
  const pilot = createC172Pilot();
  setCivilPilotView(pilot, true, true);
  assert.ok(eyeInParent(pilot).distanceTo(new THREE.Vector3(...C172_PILOT_EYE)) < 1e-6);
  assert.ok(pilot.position.x < -0.15, 'left seat');
  // Hip on the cushion (top y≈0.02, back face z≈-0.85) without passing through the seat back.
  assert.ok(pilot.position.y > 0.0 && pilot.position.y < 0.12);
  assert.ok(pilot.position.z < -0.95 && pilot.position.z > -1.33);
  const stretch = poseCivilHands(pilot);
  assert.ok(stretch < 1.15, `arms stretch ${stretch}`);
  assert.equal(pilot.userData.head.visible, false);
  setCivilPilotView(pilot, false, true);
  assert.equal(pilot.userData.head.visible, true);
});

test('aircraft models mount their pilots', () => {
  const boeing = new Boeing737(null, null, null);
  assert.ok(boeing.pilots.captain.parent === boeing.cockpit.group);
  assert.ok(boeing.pilots.firstOfficer.parent === boeing.cockpit.group);
  boeing.setCockpitMode(true, true);
  assert.equal(boeing.pilots.captain.userData.head.visible, false);
  assert.equal(boeing.pilots.firstOfficer.userData.head.visible, true);
  assert.doesNotThrow(() => boeing.update(0.016, { aileron: 0.5, elevator: -0.3 }));

  const remote = new Boeing737(null, null, null, null, null, null, { exteriorOnly: true });
  assert.equal(remote.pilots, undefined);

  const cessna = new Cessna172();
  assert.ok(cessna.pilot.parent === cessna.group);
  cessna.setCockpitMode(false);
  assert.equal(cessna.pilot.userData.head.visible, true);
});
