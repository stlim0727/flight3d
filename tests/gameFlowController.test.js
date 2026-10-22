import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW, GameFlowController } from '../src/ui/GameFlowController.js';

function makeController(overrides = {}) {
  const flags = { active: false, waiting: false };
  const changes = [];
  const c = new GameFlowController({
    isDemoActive: () => flags.active,
    isDemoWaiting: () => flags.waiting,
    onStateChange: (s) => changes.push(s),
    ...overrides,
  });
  return { c, flags, changes };
}

function run(c, seconds, dt = 0.1) {
  for (let t = 0; t < seconds; t += dt) c.update(dt);
}

test('boot state: lobby blocks input, physics keep running', () => {
  const { c } = makeController();
  assert.equal(c.state, FLOW.LOBBY);
  assert.equal(c.blocksFlightInput(), true);
  assert.equal(c.isPhysicsFrozen(), false);
});

test('transition legality full walk', () => {
  const { c, changes } = makeController();
  assert.equal(c.pause(), false);            // LOBBY cannot pause
  assert.equal(c.resume(), false);          // LOBBY cannot resume
  c.enterFlight();
  assert.equal(c.state, FLOW.FLIGHT);
  assert.equal(c.blocksFlightInput(), false);
  assert.equal(c.isPhysicsFrozen(), false);
  assert.equal(c.resume(), false);          // FLIGHT cannot resume
  assert.equal(c.pause(), true);
  assert.equal(c.state, FLOW.PAUSED);
  assert.equal(c.blocksFlightInput(), true);
  assert.equal(c.isPhysicsFrozen(), true);
  assert.equal(c.pause(), false);           // PAUSED cannot pause again
  assert.equal(c.returnToLobby(), true);
  assert.equal(c.state, FLOW.LOBBY);
  assert.equal(c.isPhysicsFrozen(), false);
  assert.equal(c.returnToLobby(), false);   // LOBBY cannot returnToLobby
  assert.deepEqual(changes, ['flight', 'paused', 'lobby']);
});

test('restart countdown: no fire before delay, one-shot after', () => {
  const { c, flags } = makeController();
  flags.active = true;
  run(c, 1);
  flags.active = false;                     // demo ends
  run(c, 1.4);
  assert.equal(c.consumeDemoRestart(), false);
  run(c, 0.2);
  assert.equal(c.consumeDemoRestart(), true);
  assert.equal(c.consumeDemoRestart(), false);
});

test('active or waiting demo never schedules restart', () => {
  const { c, flags } = makeController();
  flags.active = true;
  run(c, 10);
  assert.equal(c.consumeDemoRestart(), false);
  flags.active = false;
  flags.waiting = true;
  run(c, 10);
  assert.equal(c.consumeDemoRestart(), false);
  flags.waiting = false;
  run(c, 2);
  assert.equal(c.consumeDemoRestart(), true);
});

test('enterFlight cancels armed countdown; lobby return re-arms', () => {
  const { c, flags } = makeController();
  flags.active = true;
  run(c, 0.5);
  flags.active = false;
  run(c, 1.0);                              // countdown armed, not elapsed
  c.enterFlight();
  run(c, 5);
  assert.equal(c.consumeDemoRestart(), false);
  c.pause();
  assert.equal(c.returnToLobby(), true);    // re-arms immediately
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
});

test('HUD returnToLobby works directly from flight and re-arms the cinematic', () => {
  const { c, changes } = makeController();
  c.enterFlight();
  assert.equal(c.returnToLobby(), true);
  assert.equal(c.state, FLOW.LOBBY);
  assert.equal(c.blocksFlightInput(), true);
  assert.equal(c.isPhysicsFrozen(), false);
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
  assert.equal(c.consumeDemoRestart(), false);
  assert.deepEqual(changes, ['flight', 'lobby']);
});

test('repeated end/restart cycles re-arm each time', () => {
  const { c, flags } = makeController({ loopCapCount: 10 });
  for (let i = 0; i < 3; i++) {
    run(c, 1.6);
    assert.equal(c.consumeDemoRestart(), true);
    flags.active = true;
    run(c, 0.5);
    flags.active = false;                   // ends 0.5s after restart
  }
});

test('loop cap trips after 3 fast restart cycles and clears on user entry', () => {
  const { c, flags } = makeController();
  for (let i = 0; i < 3; i++) {
    run(c, 1.6);
    assert.equal(c.consumeDemoRestart(), true);
    flags.active = true;
    run(c, 0.5);
    flags.active = false;                   // ends 0.5s (<10s window) after restart
  }
  run(c, 5);                                // processes the third fast end
  assert.equal(c.isLoopCapTripped(), true);
  assert.equal(c.consumeDemoRestart(), false);

  // Normal-length run resets the counter.
  c.enterLobby();
  assert.equal(c.isLoopCapTripped(), false);
  flags.active = true;
  run(c, 0.5);
  flags.active = false;
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
  flags.active = true;
  run(c, 12);
  flags.active = false;
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
  flags.active = true;
  run(c, 0.5);
  flags.active = false;
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
  assert.equal(c.isLoopCapTripped(), false);
});

test('enterLobby with inactive demo arms countdown immediately', () => {
  const { c } = makeController();
  c.enterFlight();
  c.pause();
  c.returnToLobby();
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
});

test('returnToLobby(true) holds the flight: frozen, resumable, no cinematic', () => {
  const { c } = makeController();
  c.enterFlight();
  assert.equal(c.returnToLobby(true), true);
  assert.equal(c.state, FLOW.LOBBY);
  assert.equal(c.canResumeFromLobby(), true);
  assert.equal(c.isPhysicsFrozen(), true);
  assert.equal(c.blocksFlightInput(), true);
  run(c, 5);
  assert.equal(c.consumeDemoRestart(), false);   // cinematic never re-armed
});

test('enterFlight from a held lobby resumes without respawn or re-arm', () => {
  const { c } = makeController();
  c.enterFlight();
  c.returnToLobby(true);
  c.enterFlight();
  assert.equal(c.state, FLOW.FLIGHT);
  assert.equal(c.canResumeFromLobby(), false);
  assert.equal(c.isPhysicsFrozen(), false);
  run(c, 5);
  assert.equal(c.consumeDemoRestart(), false);
});

test('held lobby survives a pause/return round-trip', () => {
  const { c } = makeController();
  c.enterFlight();
  c.pause();
  assert.equal(c.returnToLobby(true), true);     // PAUSED -> held menu
  assert.equal(c.canResumeFromLobby(), true);
  assert.equal(c.isPhysicsFrozen(), true);
  c.enterFlight();
  assert.equal(c.isPhysicsFrozen(), false);
  c.pause();
  assert.equal(c.resume(), true);
});

test('abandonResumableFlight reverts the menu to the cinematic loop', () => {
  const { c } = makeController();
  c.enterFlight();
  c.returnToLobby(true);
  assert.equal(c.isPhysicsFrozen(), true);
  assert.equal(c.abandonResumableFlight(), true);
  assert.equal(c.canResumeFromLobby(), false);
  assert.equal(c.isPhysicsFrozen(), false);
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);    // countdown re-armed
});

test('abandonResumableFlight is a no-op outside a held lobby', () => {
  const { c } = makeController();
  assert.equal(c.abandonResumableFlight(), false); // boot lobby: not resumable
  c.enterFlight();
  assert.equal(c.abandonResumableFlight(), false); // flight: not resumable
});

test('returnToLobby default keeps the cinematic re-arm (no resume offered)', () => {
  const { c } = makeController();
  c.enterFlight();
  assert.equal(c.returnToLobby(), true);
  assert.equal(c.canResumeFromLobby(), false);
  assert.equal(c.isPhysicsFrozen(), false);
  run(c, 1.6);
  assert.equal(c.consumeDemoRestart(), true);
});
