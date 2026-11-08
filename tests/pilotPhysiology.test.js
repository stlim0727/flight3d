import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotPhysiology } from '../src/physics/PilotPhysiology.js';

test('pilot physiology stays nominal at 1.0 G level flight', () => {
  const pilot = new PilotPhysiology();
  pilot.update(1 / 120, 1.0, { elevator: 0.5, aileron: 0.3, rudder: -0.2 });

  assert.equal(pilot.consciousness, 1.0);
  assert.equal(pilot.isGLOC, false);
  assert.equal(pilot.blackout, 0.0);
  assert.equal(pilot.redout, 0.0);
  assert.equal(pilot.grayout, 0.0);
  assert.equal(pilot.tunnelVision, 0.0);
  assert.ok(pilot.responsiveness > 0.95);
});

test('high positive G depletes consciousness and triggers G-LOC with mandatory duration', () => {
  const pilot = new PilotPhysiology();
  const dt = 1 / 120;

  // Pull +7.0 G sustained
  let ticks = 0;
  while (!pilot.isGLOC && ticks < 1200) {
    pilot.update(dt, 7.0, { elevator: 1.0, aileron: 0, rudder: 0 }, ticks * dt);
    ticks++;
  }

  assert.ok(pilot.isGLOC, 'Pilot must enter G-LOC under sustained +7G');
  assert.equal(pilot.consciousness, 0.0);
  assert.equal(pilot.blackout, 1.0);
  assert.equal(pilot.responsiveness, 0.0);
  assert.equal(pilot.glocIncidents, 1);

  // Even if G returns to 1.0 G immediately, mandatory G-LOC lockout must persist for >= 2.0s
  for (let i = 0; i < 120; i++) { // 1.0s at 120Hz
    pilot.update(dt, 1.0, { elevator: 1.0, aileron: 0, rudder: 0 }, ticks * dt);
    ticks++;
  }
  assert.ok(pilot.isGLOC, 'G-LOC must remain locked during mandatory duration');
  assert.equal(pilot.effectiveElevator, 0.0, 'Input must be blocked and returned to neutral during G-LOC');

  // Fast forward past mandatory duration (another 2.0s at 1.0 G)
  for (let i = 0; i < 240; i++) {
    pilot.update(dt, 1.0, { elevator: 1.0, aileron: 0, rudder: 0 }, ticks * dt);
    ticks++;
  }

  assert.equal(pilot.isGLOC, false, 'Pilot should recover from G-LOC when timer elapses at 1G');
  // Enters stupor phase: responsiveness starts around 50%
  assert.ok(pilot.stuporTimer > 0, 'Stupor phase must be active after waking from G-LOC');
  assert.ok(pilot.effectiveElevator > 0 && pilot.effectiveElevator <= 0.6, 'Control authority should be attenuated during stupor');
});

test('negative G causes redout, peripheral blur and consciousness drain', () => {
  const pilot = new PilotPhysiology();
  const dt = 1 / 120;

  pilot.update(dt, -2.5, { elevator: -0.5, aileron: 0, rudder: 0 });
  assert.ok(pilot.redout > 0, 'Redout should develop at -2.5G');
  assert.ok(pilot.blur > 0, 'Blur should develop with redout');
  assert.ok(pilot.consciousness < 1.0, 'Consciousness should drain under negative G');
});

test('control sluggishness increases with pitch axis 1.5x larger than roll', () => {
  const pilotNormal = new PilotPhysiology();
  const pilotFatigued = new PilotPhysiology();
  pilotFatigued.consciousness = 0.2; // Severely fatigued

  const dt = 1 / 120;
  pilotNormal.update(dt, 1.0, { elevator: 1.0, aileron: 1.0, rudder: 0 });
  pilotFatigued.update(dt, 1.0, { elevator: 1.0, aileron: 1.0, rudder: 0 });

  // Normal responds much faster than fatigued
  assert.ok(pilotNormal.effectiveElevator > pilotFatigued.effectiveElevator, 'Fatigued pilot elevator must lag behind normal');

  // Pitch (elevator) must lag more than roll (aileron) under fatigue
  assert.ok(pilotFatigued.effectiveElevator < pilotFatigued.effectiveAileron, 'Pitch delay must be 1.5x larger than roll');
});

test('high G introduces muscle strain jitter when conscious', () => {
  const pilot = new PilotPhysiology();
  const dt = 1 / 120;

  pilot.update(dt, 6.0, { elevator: 0.5, aileron: 0.0, rudder: 0.0 }, 1.0);
  const sample1 = pilot.effectiveElevator;
  pilot.update(dt, 6.0, { elevator: 0.5, aileron: 0.0, rudder: 0.0 }, 1.05);
  const sample2 = pilot.effectiveElevator;

  // High G jitter introduces oscillation around the target
  assert.notEqual(sample1, sample2);

  // Dedicated internal dt accumulation also advances jitter when simTime argument is omitted
  const pilotAuto = new PilotPhysiology();
  pilotAuto.update(dt, 6.0, { elevator: 0.5, aileron: 0.0, rudder: 0.0 });
  const auto1 = pilotAuto.effectiveElevator;
  pilotAuto.update(dt, 6.0, { elevator: 0.5, aileron: 0.0, rudder: 0.0 });
  const auto2 = pilotAuto.effectiveElevator;
  assert.notEqual(auto1, auto2, 'Internal dt accumulation must produce oscillating jitter across physics steps');
});

test('maximum authority is attenuated when consciousness drops', () => {
  const pilot = new PilotPhysiology();
  pilot.consciousness = 0.3; // maxAuthority = clamp(0.3 + 0.3, 0.2, 1.0) = 0.6
  const dt = 1 / 120;

  for (let i = 0; i < 100; i++) {
    // Keep consciousness fixed at 0.3 for authority test
    pilot.consciousness = 0.3;
    pilot.update(dt, 3.5, { elevator: 1.0, aileron: 1.0, rudder: 1.0 });
  }

  const expectedAuthority = pilot.consciousness + 0.3;
  assert.ok(Math.abs(pilot.effectiveElevator - expectedAuthority) < 0.01,
    `Elevator must match maxAuthority (${expectedAuthority}), got ${pilot.effectiveElevator}`);
});

test('relaxed thresholds: sustained +5.0 G does not deplete consciousness and blackout triggers below C = 0.25', () => {
  const pilot = new PilotPhysiology();
  const dt = 1 / 120;

  // Sustained +5.0 G for 5 seconds (600 ticks)
  for (let i = 0; i < 600; i++) {
    pilot.update(dt, 5.0, { elevator: 0.5, aileron: 0, rudder: 0 }, i * dt);
  }

  assert.equal(pilot.consciousness, 1.0, '5.0 G must remain within safe buffer (+5.5 G threshold)');
  assert.equal(pilot.blackout, 0.0, 'No blackout at 5.0 G');
  assert.equal(pilot.isGLOC, false);

  // Blackout onset: at C = 0.3, blackout is still 0
  pilot.consciousness = 0.3;
  assert.equal(pilot.blackout, 0.0, 'No blackout yet at C = 0.3');

  // At C = 0.125, blackout is 50%
  pilot.consciousness = 0.125;
  assert.ok(Math.abs(pilot.blackout - 0.5) < 1e-4, 'Blackout should be 0.5 at C = 0.125');

  // Recovery is fast (1.5s time constant)
  pilot.update(0.75, 1.0); // 0.75s recovery at 1G
  assert.ok(pilot.consciousness >= 0.5, 'Consciousness should recover quickly (>= 0.5 after 0.75s)');
});
