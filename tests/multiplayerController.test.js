import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { t, bindText } from '../src/i18n/index.js';
import { parseRoom, inviteUrl, inviteCompatibilityFailure } from '../src/multiplayer/protocol.js';
import { RoomDirectoryClient } from '../src/multiplayer/RoomDirectoryClient.js';
import { HEARTBEAT_INTERVAL_MS } from '../src/multiplayer/roomDirectory.js';
import { RoomReplaySession } from '../src/replay/RoomReplaySession.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';

// Load the production coordinator without importing its browser-only PeerJS adapter.
const source = readFileSync(new URL('../src/multiplayer/MultiplayerController.js', import.meta.url), 'utf8');
const Controller = new Function('t', 'bindText', 'parseRoom', 'inviteUrl', 'inviteCompatibilityFailure', 'RoomDirectoryClient', 'HEARTBEAT_INTERVAL_MS', 'Atmosphere', `return (${source.slice(source.indexOf('export class ') + 7)});`)(t, bindText, parseRoom, inviteUrl, inviteCompatibilityFailure, RoomDirectoryClient, HEARTBEAT_INTERVAL_MS, Atmosphere);

test('invite URL joins automatically; missing or invalid invites never connect', () => {
  const joined = [];
  const controller = Object.assign(Object.create(Controller.prototype), {
    roomInput: { value: '' }, chooseSetup(mode) { this.mode = mode; }, openDialog() { this.opened = true; },
    connect(room) { joined.push(room); }, refresh() {},
  });
  controller.joinInvite(null);
  assert.equal(controller.opened, undefined);
  controller.joinInvite('k7m-2qx');
  assert.equal(controller.opened, true);
  assert.equal(controller.mode, 'join');
  assert.deepEqual(joined, ['K7M2QX']);
  for (const invite of ['', 'invalid-room']) {
    controller.joinInvite(invite);
    assert.equal(controller.message, 'invalid-room');
  }
  controller.joinInvite('https://example.org/?r=K7M2QX&mp=3&fr=1');
  assert.equal(controller.message, 'incompatible');
  assert.deepEqual(joined, ['K7M2QX']);
});

test('pending lobby demo restart survives multiplayer modal and active room', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const condition = main.match(/if \(([^\n]+consumeDemoRestart\(\)[^\n]*)\) \{/)[1];
  const shouldRestart = new Function(`return (${condition});`);
  const gameFlow = new GameFlowController();
  gameFlow.update(10);
  const sim = { gameFlow, multiplayer: { active: false, modalOpen: true } };
  assert.equal(shouldRestart.call(sim), false);
  sim.multiplayer.active = true; sim.multiplayer.modalOpen = false;
  assert.equal(shouldRestart.call(sim), false);
  sim.multiplayer.active = false;
  assert.equal(shouldRestart.call(sim), true);
  assert.equal(shouldRestart.call(sim), false);
});

function fixture(run) {
  const previous = globalThis.document;
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { disabled: false, setAttribute() {} });
    return elements.get(id);
  };
  const airport = element('airport'), preset = element('preset'), restricted = element('restricted');
  restricted.disabled = true;
  const controls = [airport, preset, restricted];
  globalThis.document = { getElementById: element, querySelectorAll: () => controls };
  const gameFlow = new GameFlowController(); gameFlow.enterFlight();
  const controller = Object.assign(Object.create(Controller.prototype), {
    soloControls: new Map(), dialog: { open: false }, modal: { close() {}, hold() {} }, preparationHold: false,
    audio: { pause() {} },
    room: { closed: false, host: false, session: { name: 'Pilot', state: 'flying' } },
    sim: { gameFlow, syncFlowUi() {}, showToast() {}, lobbyScreen: { setSelectionBusy() {}, refresh() { restricted.disabled = true; } } },
  });
  try { return run({ controller, gameFlow, airport, preset, restricted }); }
  finally { globalThis.document = previous; }
}

for (const reason of ['left', 'peer-left', 'timeout', 'pagehide']) {
  test(`room recorder survives local debrief/restart and saves once on ${reason}`, () => fixture(({ controller, gameFlow }) => {
    let now = 0;
    const saved = [];
    controller.roomReplay = new RoomReplaySession({ saveRoomAuto(track) { saved.push(track); return { entry: { id: 'saved' } }; } }, { now: () => now });
    Object.assign(controller.sim, { sky: { timeOfDay: 12 }, position: { x: 10, y: 900, z: 20 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }, telemetry: { iasKnots: 100, gForce: 1, pitchDeg: 0, rollDeg: 0, headingDeg: 0 } });
    controller.slot = 0;
    Object.assign(controller.room.session, { config: { airport: 'coastal', aircraft: 'C172', scenario: 'cruise' },
      round: 1, epoch: 0, remoteName: 'Wing', track: { sample: () => ({ p: [now / 100, 900, 20],
        q: [0, 0, 0, 1], round: 1, epoch: 0, gear: 1, flaps: 0 }) } });
    controller.startTogether();
    for (let i = 0; i < 30; i++) { now += 200; controller.recordReplay(); }
    gameFlow.endFlight();
    for (let i = 0; i < 10; i++) { now += 200; controller.recordReplay(); }
    controller.room.session.round = 2; controller.startTogether();
    now += 200; controller.recordReplay();
    assert.equal(controller.roomReplay.recorder.metadata.room.rounds, 2);
    // Transport disposal clears the remote buffer before ended.
    controller.room.session.track.sample = () => null;
    controller.room.closed = true;
    if (reason === 'pagehide') controller.roomReplay.finish(reason);
    controller.ended(reason); controller.ended(reason);
    assert.equal(saved.length, 1);
    assert.ok(saved[0].durationSec > 8);
    assert.ok(saved[0].remotes[0].samples.at(-1).x > 70);
  }));
}

test('personal reset keeps continuous voice and microphone mute unchanged', () => fixture(({ controller }) => {
  controller.room.session.config = { scenario: 'cruise' };
  controller.sim.setPreset = () => {};
  controller.sim.beginFlightRecording = () => {};
  for (const muted of [false, true]) {
    controller.voice = { muted, talking: !muted };
    controller.respawnLocal();
    assert.equal(controller.voice.muted, muted);
    assert.equal(controller.voice.talking, !muted);
  }
}));

test('leave restores airport/preset controls and keeps normal solo restrictions', () => fixture(({ controller, airport, preset, restricted }) => {
  controller.refresh();
  assert.ok(airport.disabled && preset.disabled && restricted.disabled);
  controller.room.closed = true;
  controller.ended('left');
  assert.equal(airport.disabled, false);
  assert.equal(preset.disabled, false);
  assert.equal(restricted.disabled, true);
  controller.refresh();
  assert.equal(restricted.disabled, true, 'later inactive refresh must not undo availability');
}));

for (const reason of ['left', 'peer-left', 'timeout']) {
  test(`${reason} preserves an intentional pause during a live flight`, () => fixture(({ controller, gameFlow }) => {
    gameFlow.pause(); controller.room.closed = true;
    controller.ended(reason);
    assert.equal(gameFlow.state, 'paused');
    assert.equal(gameFlow.isPhysicsFrozen(), true);
  }));
}

test('teardown releases a preparation pause even after local prepare has finished', () => fixture(({ controller, gameFlow }) => {
  controller.preparationHold = true; controller.preparing = false;
  gameFlow.pause(); controller.room.closed = true;
  controller.ended('peer-left');
  assert.equal(gameFlow.state, 'flight');
  assert.equal(controller.preparationHold, false);
}));

test('shared start releases preparation ownership before a later user pause', () => fixture(({ controller, gameFlow }) => {
  controller.preparationHold = true; gameFlow.pause();
  controller.startTogether();
  assert.equal(controller.preparationHold, false);
  gameFlow.pause(); controller.room.closed = true;
  controller.ended('peer-left');
  assert.equal(gameFlow.state, 'paused');
}));

for (const reason of ['left', 'peer-left', 'timeout']) {
  test(`${reason} resynchronizes input after an early preparation resume`, () => fixture(({ controller, gameFlow }) => {
    controller.preparationHold = true; controller.preparing = false;
    controller.room.session.state = 'starting';
    gameFlow.pause(); gameFlow.resume();
    controller.sim.controls = { inputBlocked: true };
    let syncs = 0;
    controller.sim.syncFlowUi = () => {
      syncs++;
      controller.sim.controls.inputBlocked = gameFlow.blocksFlightInput();
    };
    controller.room.closed = true; controller.room.session.state = 'ended';
    controller.ended(reason);
    assert.equal(gameFlow.state, 'flight');
    assert.equal(syncs, 1, 'teardown must sync even without a game-flow transition');
    assert.equal(controller.sim.controls.inputBlocked, false);
  }));
}

test('clipboard completion cannot overwrite cancellation after the waiting deadline', async () => {
  const previousDocument = globalThis.document;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    globalThis.document = { getElementById: () => ({ value: 'https://example.org/?r=K7M2QX', select() {} }) };
    for (const kind of ['code', 'link']) {
      let complete;
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: () => new Promise(resolve => { complete = resolve; }) } } });
      const controller = Object.assign(Object.create(Controller.prototype), { room: { closed: false, room: 'K7M2QX' }, message: null });
      const pending = controller.copyInvite(kind);
      controller.room.closed = true; controller.message = 'cancelled';
      complete(); await pending;
      assert.equal(controller.message, 'cancelled');
    }
  } finally {
    globalThis.document = previousDocument;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});

test('waiting and preparing rooms do not read or send flight snapshots', () => fixture(({ controller }) => {
  for (const state of ['connecting', 'connected', 'starting', 'ended']) {
    controller.room.session.state = state;
    assert.doesNotThrow(() => controller.sendSnapshot(), state);
  }
}));

test('host start button is highlighted and focused once when a friend joins', () => fixture(({ controller }) => {
  const start = document.getElementById('mp-start');
  const attributes = {};
  let focused = 0;
  Object.assign(start, { setAttribute(name, value) { attributes[name] = value; }, focus() { focused++; } });
  const previousLocation = globalThis.location;
  globalThis.location = { href: 'https://example.org/' };
  try {
    Object.assign(controller, { dialog: { open: true }, voice: null, playbackBlocked: false, audio: { muted: false } });
    Object.assign(controller.room, { host: true, registered: true, room: 'K7M2QX', waiting: false, session: { name: 'Pilot', state: 'connecting' } });
    controller.refresh();
    assert.equal(attributes['data-ready'], 'false');
    assert.equal(focused, 0);
    controller.room.session.state = 'connected';
    controller.refresh(); controller.refresh();
    assert.equal(attributes['data-ready'], 'true');
    assert.equal(focused, 1, 'focus moves only on the transition, not on every refresh');
    controller.room.session.state = 'flying';
    controller.refresh();
    assert.equal(attributes['data-ready'], 'false', 'restart during flight is not pulsed');
  } finally { globalThis.location = previousLocation; }
}));

test('refreshOpenRooms renders rooms and allows joining', async () => {
  const children = [];
  const container = {
    replaceChildren() { children.length = 0; },
    appendChild(child) { children.push(child); },
  };
  const prevDoc = globalThis.document;
  const elements = [];
  globalThis.document = {
    createElement(tag) {
      const el = {
        tag,
        className: '',
        textContent: '',
        disabled: false,
        append(...items) { this.children = items; },
        children: [],
      };
      elements.push(el);
      return el;
    },
  };
  try {
    const joined = [];
    const controller = Object.assign(Object.create(Controller.prototype), {
      roomListContainer: container,
      refreshingRooms: false,
      roomInput: { value: '' },
      room: null,
      directoryClient: {
        async fetchRooms() {
          return {
            ok: true,
            rooms: [
              { roomCode: 'K7M2QX', name: 'Maverick', airport: 'coastal', aircraft: 'B738', scenario: 'cruise', currentPlayers: 1, maxPlayers: 2, status: 'waiting' },
              { roomCode: '8W3N9Z', name: 'FullRoom', airport: 'incheon', aircraft: 'F16', scenario: 'runway', currentPlayers: 2, maxPlayers: 2, status: 'full' },
            ],
          };
        },
      },
      connectInvite(code) { joined.push(code); },
      openDialog(mode) { this.openedMode = mode; },
    });

    await controller.refreshOpenRooms();
    assert.equal(children.length, 2);
    // Find join button for Maverick
    const maverickItem = children[0];
    const actions = maverickItem.children[1];
    const joinBtn = actions.children[1];
    assert.equal(joinBtn.disabled, false);
    joinBtn.onclick();
    assert.deepEqual(joined, ['K7M2QX']);
    assert.equal(controller.openedMode, 'join', 'joining a listed room opens its status dialog');
    assert.equal(controller.roomInput.value, 'K7M2QX');

    // Full room button is disabled
    const fullItem = children[1];
    const fullActions = fullItem.children[1];
    const fullJoinBtn = fullActions.children[1];
    assert.equal(fullJoinBtn.disabled, true);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('syncDirectoryHost serializes in-flight registration and cleans up if closed before response', async () => {
  let registerCalls = 0;
  const unregisterLeaseCalls = [];
  let resolveRegister;
  const mockDirectoryClient = {
    isRegistered: false,
    register() {
      registerCalls++;
      return new Promise(resolve => { resolveRegister = resolve; });
    },
    async unregisterLease(reg) {
      unregisterLeaseCalls.push(reg);
    },
    startHeartbeat() {
      this.heartbeatStarted = true;
    },
  };

  const mockRoom = { host: true, registered: true, room: 'K7M2QX', closed: false, session: { name: 'Host' } };
  const controller = Object.assign(Object.create(Controller.prototype), {
    isPublicHost: true,
    registeringHost: false,
    registrationGeneration: 0,
    room: mockRoom,
    hostDirectoryClient: null,
    directoryClient: { directoryUrl: 'https://directory.flight3d' },
    createHostDirectoryClient() {
      return mockDirectoryClient;
    },
  });

  // First sync triggers register()
  controller.syncDirectoryHost();
  assert.equal(registerCalls, 1);

  // Second sync while first is in-flight must NOT trigger another register()
  controller.syncDirectoryHost();
  assert.equal(registerCalls, 1);

  // Now simulate host leaving or room closing before register resolves
  mockRoom.closed = true;
  controller.registrationGeneration++;
  controller.isPublicHost = false;

  // Now registration completes with ok
  resolveRegister({ ok: true, registration: { id: 'room-late', token: 'tok-late', leaseGeneration: 1 } });
  await new Promise(r => setTimeout(r, 10));

  // Late resolution must call unregisterLease and NOT start heartbeats
  assert.equal(unregisterLeaseCalls.length, 1);
  assert.equal(unregisterLeaseCalls[0].id, 'room-late');
  assert.equal(mockDirectoryClient.heartbeatStarted, undefined);
});

test('late registration for superseded room does not cancel newer room heartbeat or lease', async () => {
  let resolveRegisterA;
  let resolveRegisterB;
  const unregisterLeaseCallsA = [];
  const unregisterLeaseCallsB = [];

  const clientA = {
    isRegistered: false,
    register() {
      return new Promise(resolve => { resolveRegisterA = resolve; });
    },
    async unregisterLease(reg) {
      unregisterLeaseCallsA.push(reg);
    },
    startHeartbeat() {
      this.heartbeatStarted = true;
    },
    stopHeartbeat() {
      this.heartbeatStarted = false;
    },
  };

  const clientB = {
    isRegistered: false,
    register() {
      this.isRegistered = true;
      return new Promise(resolve => { resolveRegisterB = resolve; });
    },
    async unregisterLease(reg) {
      unregisterLeaseCallsB.push(reg);
    },
    startHeartbeat() {
      this.heartbeatStarted = true;
    },
    stopHeartbeat() {
      this.heartbeatStarted = false;
    },
  };

  let clientIndex = 0;
  const clients = [clientA, clientB];

  const roomA = { host: true, registered: true, room: 'ROOM0A', closed: false, session: { name: 'Host' } };
  const roomB = { host: true, registered: true, room: 'ROOM0B', closed: false, session: { name: 'Host' } };

  const controller = Object.assign(Object.create(Controller.prototype), {
    isPublicHost: true,
    registeringHost: false,
    registrationGeneration: 0,
    room: roomA,
    hostDirectoryClient: null,
    directoryClient: { directoryUrl: 'https://directory.flight3d' },
    createHostDirectoryClient() {
      return clients[clientIndex++];
    },
  });

  // Start Room A registration (in-flight)
  controller.syncDirectoryHost();
  assert.equal(controller.hostDirectoryClient, clientA);

  // Switch to Room B
  controller.registrationGeneration++;
  controller.registeringHost = false;
  controller.room = roomB;
  controller.syncDirectoryHost();
  assert.equal(controller.hostDirectoryClient, clientB);

  // Room B's register resolves first
  resolveRegisterB({ ok: true, registration: { id: 'room-b', token: 'tok-b', leaseGeneration: 1 } });
  await new Promise(r => setTimeout(r, 10));

  assert.equal(clientB.heartbeatStarted, true);
  assert.equal(clientB.isRegistered, true);
  assert.equal(unregisterLeaseCallsB.length, 0);

  // Now Room A's register resolves late
  resolveRegisterA({ ok: true, registration: { id: 'room-a', token: 'tok-a', leaseGeneration: 1 } });
  await new Promise(r => setTimeout(r, 10));

  // Room A is cleaned up with unregisterLease
  assert.equal(unregisterLeaseCallsA.length, 1);
  assert.equal(unregisterLeaseCallsA[0].id, 'room-a');

  // Room B is completely untouched and still running its heartbeat!
  assert.equal(clientB.heartbeatStarted, true);
  assert.equal(clientB.isRegistered, true);
  assert.equal(unregisterLeaseCallsB.length, 0);
  assert.equal(controller.hostDirectoryClient, clientB);
});

test('playAudio only plays when srcObject is present; manages playbackBlocked and voice context resume', () => fixture(async ({ controller }) => {
  let resumed = 0;
  let remoteOutput = null;
  controller.voice = {
    context: { resume: async () => { resumed++; } },
    setRemoteOutput: enabled => { remoteOutput = enabled; },
  };
  controller.audio = { srcObject: null, paused: true, muted: false, play: async () => { controller.audio.paused = false; } };
  let refreshed = 0;
  controller.refresh = () => { refreshed++; };

  // 1. Without srcObject, playAudio resumes voice context and primes audio element without setting playbackBlocked
  controller.audio.play = async () => { throw new Error('NotSupportedError'); };
  await controller.playAudio();
  assert.equal(resumed, 1);
  assert.equal(controller.playbackBlocked, undefined);
  assert.equal(refreshed, 0);

  // 2. With srcObject, if audio.play() rejects (e.g. autoplay blocked), playbackBlocked becomes true and WebAudio fallback activates
  const stream = {};
  controller.audio.srcObject = stream;
  controller.audio.paused = true;
  controller.audio.play = async () => { throw new Error('NotAllowedError'); };
  await controller.playAudio();
  assert.equal(resumed, 2);
  assert.equal(controller.playbackBlocked, true);
  assert.equal(remoteOutput, true);
  assert.equal(refreshed, 1);

  // 3. When called again with a successful play (user gesture), playbackBlocked becomes false and WebAudio fallback deactivates to prevent double audio
  controller.audio.play = async () => { controller.audio.paused = false; };
  await controller.playAudio();
  assert.equal(resumed, 3);
  assert.equal(controller.playbackBlocked, false);
  assert.equal(remoteOutput, false);
  assert.equal(refreshed, 2);
}));

test('enableVoiceMicrophone unlocks local engine audio and remote voice playback once microphone permission resolves', () => fixture(async ({ controller }) => {
  let resolveMic;
  let audioEnsured = 0;
  let played = 0;
  controller.voice = {
    enableMicrophone: () => new Promise(resolve => { resolveMic = resolve; }),
  };
  controller.sim.ensureAudio = () => { audioEnsured++; };
  controller.playAudio = () => { played++; };

  const pending = controller.enableVoiceMicrophone();
  assert.equal(audioEnsured, 0);
  assert.equal(played, 0);

  resolveMic();
  await pending;
  await new Promise(r => setImmediate(r));
  assert.equal(audioEnsured, 1);
  assert.equal(played, 1);
}));

test('refresh resumes FlightAudio when VoiceLink context is running', () => fixture(({ controller }) => {
  let inited = 0;
  let ensured = 0;
  controller.voice = {
    context: { state: 'running' },
    setRemoteOutput() {},
  };
  controller.audio = { muted: false, srcObject: null, paused: false };
  controller.sim.audio = {
    isInitialized: false,
    ctx: { state: 'suspended' },
    init() { inited++; this.isInitialized = true; },
    ensureContextRunning() { ensured++; this.ctx.state = 'running'; },
  };
  controller.refresh();
  assert.equal(inited, 1);
  assert.equal(ensured, 1);
}));

test('startTogether triggers ensureAudio and playAudio so guests unlock sound upon flight entry', () => fixture(({ controller }) => {
  let audioEnsured = 0;
  let played = 0;
  controller.sim.ensureAudio = () => { audioEnsured++; };
  controller.playAudio = () => { played++; };
  controller.startTogether();
  assert.equal(audioEnsured, 1);
  assert.equal(played, 1);
}));

test('ended clears playbackBlocked and synchronizes audio hint', () => fixture(({ controller }) => {
  let hintSynced = 0;
  controller.sim.syncAudioHint = () => { hintSynced++; };
  controller.playbackBlocked = true;
  controller.room.closed = true;
  controller.ended('peer-left');
  assert.equal(controller.playbackBlocked, false);
  assert.equal(hintSynced, 1);
}));
