import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW, GameFlowController } from '../src/ui/GameFlowController.js';
import { SimulatorClass } from './helpers/simulatorClass.js';

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

test('holdForPendingStart parks a rebuilding scene: frozen, no cinematic, still startable', () => {
  const { c, flags } = makeController();
  flags.active = true;                          // cinematic demo is flying behind the menu
  assert.equal(c.holdForPendingStart(), true);
  assert.equal(c.state, FLOW.LOBBY);
  assert.equal(c.isPhysicsFrozen(), true);
  run(c, 5);
  assert.equal(c.consumeDemoRestart(), false);
  c.enterFlight();
  assert.equal(c.canResumeFromLobby(), false);  // the new scenario owns the aircraft now
  assert.equal(c.isPhysicsFrozen(), false);
});

test('holdForPendingStart is a no-op outside the lobby', () => {
  const { c } = makeController();
  assert.equal(c.state, FLOW.LOBBY);
  c.enterFlight();
  assert.equal(c.holdForPendingStart(), false);
  assert.equal(c.resumableFlight, false);
  c.pause();
  assert.equal(c.holdForPendingStart(), false);
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

test('a held sortie is visible to the observer at the moment the state changes', () => {
  // The menu's camera rig and audio duck are decided inside onStateChange, so the hold must
  // be published with the state: an observer that still sees the previous hold frames the
  // wreck of a paused sortie as an ordinary cinematic.
  const held = [];
  const { c } = makeController({
    onStateChange: () => held.push(c.state === FLOW.PAUSED || c.canResumeFromLobby()),
  });
  c.enterFlight();
  c.pause();
  assert.deepEqual(held.at(-1), true, 'pausing frames the aircraft');
  c.resume();
  assert.deepEqual(held.at(-1), false, 'flying releases the rig');
  c.pause();
  assert.equal(c.returnToLobby(true), true);
  assert.deepEqual(held.at(-1), true, 'the menu inherits the hold from the pause');
  c.enterFlight();
  c.returnToLobby();
  assert.deepEqual(held.at(-1), false, 'a fresh menu holds nothing');
});

test('menu holds a crashed flight until an explicit new start, without repeating the crash', async () => {
  const THREE = await import('three');
  const { installPhysicsIntegrator } = await import('../src/core/PhysicsIntegrator.js');

  class SimHarness {
    constructor() {
      this.gameFlow = new GameFlowController();
      this.gameFlow.enterFlight();
      this.devRunner = { active: null };
      this.position = new THREE.Vector3(0, 0, 0);
      this.linearVelocity = new THREE.Vector3(40, -10, 0);
      this.angularVelocity = new THREE.Vector3(0, 0, 0);
      this.quaternion = new THREE.Quaternion();
      this.aero = { mass: 60000, invIxx: 1e-6, invIyy: 1e-6, invIzz: 1e-6, cg: new THREE.Vector3() };
      this.gear = { bodySupportPoints: [] };
      this.currentTerrain = { getHeight: () => 0 };
      this.flightWarnings = { reset() {} };
      this.telemetry = { warnings: [] };
      this.explosions = 0;
      this.explosionSystem = { spawnExplosion: () => { this.explosions++; }, clear() {} };
      this.audio = { playExplosion: () => {} };
      this.aircraft = {
        group: new THREE.Group(),
        triggerCrashVisuals() { this.crashed = true; },
        resetCrashVisuals() { this.crashed = false; },
      };
      this.aircraftBreakup = {
        aircraft: null,
        spawn: (ac) => { this.aircraftBreakup.aircraft = ac; ac.group.visible = false; },
        clear: () => { if (this.aircraftBreakup.aircraft) this.aircraftBreakup.aircraft.group.visible = true; this.aircraftBreakup.aircraft = null; },
      };
      this.cameraSystem = { beginCrashView() {}, endCrashView() {}, addTrauma() {} };
      this.autopilot = { disengage() {} };
      this.engines = { setThrottle() {} };
      this.controls = { throttle: 0.8 };
      this.collisionChecks = 0;
      this.collisionDetector = {
        checkCollision: () => {
          this.collisionChecks++;
          return { type: 'TERRAIN', name: 'TERRAIN', description: 'Impact', speedKnots: 80 };
        },
      };
      this.isCrashed = false;
      this.crashResult = null;
      this.lobby = { airport: 'coastal', aircraft: 'B738', preset: 'runway' };
      this.activeAirport = 'coastal';
      this.currentAircraftId = 'B738';
    }
    toggleMainMenu() {
      SimulatorClass.prototype.toggleMainMenu.call(this);
    }
    startFlight() {
      this.gameFlow.enterFlight();
      this.clearCrashState(); // Stand-in for the respawn setPreset() performs.
    }
  }
  installPhysicsIntegrator(SimHarness);

  const sim = new SimHarness();
  sim.triggerCrash({ type: 'TERRAIN', name: 'TERRAIN', description: 'Impact', speedKnots: 80 });
  assert.equal(sim.isCrashed, true);
  assert.equal(sim.explosions, 1);
  assert.equal(sim.aircraft.group.visible, false);

  // Menu presses cannot silently resume or respawn a wreck.
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.isCrashed, true);

  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.isCrashed, true);
  for (let i = 0; i < 10; i++) sim.integratePhysics(1 / 120);
  assert.equal(sim.collisionChecks, 0);
  assert.equal(sim.explosions, 1);

  // Keyboard exitCrashToLobby also holds the crashed scene without re-triggering.
  sim.exitCrashToLobby();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.gameFlow.canResumeFromLobby(), true);
  assert.equal(sim.isCrashed, true);
  // Only an explicit new-flight action respawns the crashed airframe.
  await SimulatorClass.prototype.fly.call(sim);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  assert.equal(sim.isCrashed, false);
  assert.equal(sim.aircraft.group.visible, true);
  assert.equal(sim.aircraft.crashed, false);
  assert.equal(sim.explosions, 1, 'releasing a wreck must not replay the crash rig');
});
