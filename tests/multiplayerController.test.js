import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { t, bindText } from '../src/i18n/index.js';
import { parseRoom, inviteUrl, inviteCompatibilityFailure } from '../src/multiplayer/protocol.js';

// Load the production coordinator without importing its browser-only PeerJS adapter.
const source = readFileSync(new URL('../src/multiplayer/MultiplayerController.js', import.meta.url), 'utf8');
const Controller = new Function('t', 'bindText', 'parseRoom', 'inviteUrl', 'inviteCompatibilityFailure', `return (${source.slice(source.indexOf('export class ') + 7)});`)(t, bindText, parseRoom, inviteUrl, inviteCompatibilityFailure);

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

test('playAudio only plays when srcObject is present; manages playbackBlocked and voice context resume', () => fixture(async ({ controller }) => {
  let resumed = 0;
  controller.voice = { context: { resume: async () => { resumed++; } } };
  controller.audio = { srcObject: null, play: async () => {} };
  let refreshed = 0;
  controller.refresh = () => { refreshed++; };

  // 1. Without srcObject, playAudio resumes voice context but does not attempt audio.play()
  await controller.playAudio();
  assert.equal(resumed, 1);
  assert.equal(controller.playbackBlocked, undefined);
  assert.equal(refreshed, 0);

  // 2. With srcObject, if audio.play() rejects (e.g. autoplay blocked), playbackBlocked becomes true
  const stream = {};
  controller.audio.srcObject = stream;
  controller.audio.play = async () => { throw new Error('NotAllowedError'); };
  await controller.playAudio();
  assert.equal(resumed, 2);
  assert.equal(controller.playbackBlocked, true);
  assert.equal(refreshed, 1);

  // 3. When called again with a successful play (user gesture), playbackBlocked becomes false
  controller.audio.play = async () => {};
  await controller.playAudio();
  assert.equal(resumed, 3);
  assert.equal(controller.playbackBlocked, false);
  assert.equal(refreshed, 2);
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
