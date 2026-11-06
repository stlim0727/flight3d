import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerDialog } from '../src/multiplayer/MultiplayerDialog.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';

function fixture(state = 'flight') {
  const dialog = new EventTarget(); dialog.open = false;
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const gameFlow = new GameFlowController(); gameFlow.enterFlight(); if (state === 'paused') gameFlow.pause();
  let syncs = 0;
  const modal = new MultiplayerDialog({ gameFlow, syncFlowUi: () => syncs++ }, dialog, () => modal.close());
  return { modal, dialog, gameFlow, syncs: () => syncs };
}

test('modal holds a live flight and restores only its own pause', () => {
  const { modal, dialog, gameFlow, syncs } = fixture();
  modal.open(); modal.open(); assert.equal(dialog.open, true); assert.equal(gameFlow.state, 'paused');
  modal.close(); assert.equal(dialog.open, false); assert.equal(gameFlow.state, 'flight'); assert.equal(syncs(), 2);
  const paused = fixture('paused'); paused.modal.open(); paused.modal.close(); assert.equal(paused.gameFlow.state, 'paused');
});

test('shared start closes the modal without an intermediate resume', () => {
  const { modal, dialog, gameFlow } = fixture(); modal.open(); modal.close({ resume: false });
  assert.equal(dialog.open, false); assert.equal(gameFlow.state, 'paused');
});

test('room cancellation keeps its dialog held until the user closes it', () => {
  const { modal, gameFlow } = fixture(); modal.open(); gameFlow.resume(); modal.hold();
  assert.equal(gameFlow.state, 'paused'); modal.close(); assert.equal(gameFlow.state, 'flight');
});

test('native cancel is handled explicitly and modal keyboard events are consumed', () => {
  const { modal, dialog, gameFlow } = fixture(); modal.open();
  const key = new Event('keydown', { bubbles: true }); dialog.dispatchEvent(key);
  const cancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true); assert.equal(dialog.open, false); assert.equal(gameFlow.state, 'flight');
});
