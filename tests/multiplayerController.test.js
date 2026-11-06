import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { t, bindText } from '../src/i18n/index.js';

// Load the production coordinator without importing its browser-only PeerJS adapter.
const source = readFileSync(new URL('../src/multiplayer/MultiplayerController.js', import.meta.url), 'utf8');
const Controller = new Function('t', 'bindText', `return (${source.slice(source.indexOf('export class ') + 7)});`)(t, bindText);

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
