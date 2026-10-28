import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { IncheonCessnaScenario } from '../src/director/scenarios/IncheonCessnaScenario.js';
import { demoProfiles, resolveDemoProfile } from '../src/director/demoProfiles.js';

const stages = IncheonCessnaScenario.STAGES;
test('Incheon C172 selects the circuit and rejects stale coastal route choices', () => {
  assert.deepEqual(demoProfiles('C172', 'incheon').map(p => p.id), ['incheon-tour', 'sihwa-tour']);
  assert.equal(resolveDemoProfile('C172', 'incheon', 'proximity').id, 'incheon-tour');
  const d = new DemoFlightDirector({ currentAircraftId: 'C172', activeAirport: 'incheon' });
  assert.equal(d.getActiveScenario(), d.incheonCessnaScenario);
});

test('landing requires real contact and completion requires a runway stop', () => {
  const inputs = {};
  const sim = { position: new THREE.Vector3(-1645.93, 10, -3747.17),
    linearVelocity: new THREE.Vector3(15, 0, 0), aero: { beta: 0 }, telemetry: { groundSpeedKnots: 30 },
    controls: { setVirtualInput: (k,v) => { inputs[k] = v; } },
    gear: { cgGroundHeightM: 1.4, onGround: false, contacts: [{}, {}, {}] },
    currentAirport: { isOnRunway: () => true } };
  const d = { currentStage: stages.FINAL, stageTimer: 0, totalTimer: 300, setStage(s) { this.currentStage = s; } };
  const scenario = new IncheonCessnaScenario(d, sim);
  scenario.holdHeading = scenario.flyVertical = () => {};
  scenario.result = { status: 'running', airborne: true };
  scenario.update();
  assert.equal(d.currentStage, stages.FINAL);
  sim.gear.contacts[1].isGrounded = true;
  scenario.update();
  assert.equal(d.currentStage, stages.ROLLOUT);
  scenario.update();
  assert.equal(inputs.brakes, 0);
  sim.gear.contacts[0].isGrounded = true;
  sim.gear.onGround = true;
  scenario.update();
  assert.equal(inputs.brakes, 1);
  assert.equal(d.currentStage, stages.ROLLOUT);
  sim.linearVelocity.set(0, 0, 0);
  sim.telemetry.groundSpeedKnots = .2;
  sim.gear.contacts[2].isGrounded = true;
  sim.currentAirport.isOnRunway = () => false;
  scenario.update();
  assert.equal(d.currentStage, stages.ROLLOUT);
  sim.currentAirport.isOnRunway = () => true;
  const runwayPosition = sim.position.clone();
  sim.position.x += 100;
  scenario.update(3);
  assert.equal(d.currentStage, stages.ROLLOUT, 'other pavement cannot count as a runway stop');
  sim.position.copy(runwayPosition);
  scenario.update(1);
  assert.equal(d.currentStage, stages.ROLLOUT);
  scenario.update(1);
  assert.equal(d.currentStage, stages.COMPLETED);
});
