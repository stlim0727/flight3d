import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomSession } from '../src/multiplayer/RoomSession.js';
import { DEFAULT_CONFIG, inviteUrl, inviteCompatibilityFailure } from '../src/multiplayer/protocol.js';
import { compatibilityFailure } from '../src/multiplayer/compatibility.js';

// Frozen v2 handshake examples: do not derive legacy packets from current constants.
const legacyHello = { type: 'hello', version: 2, name: 'Older guest' };
const legacyWelcome = { type: 'welcome', version: 2, name: 'Older host', config: { airport: 'coastal', aircraft: 'C172', scenario: 'cruise' } };
function session(host, contract) {
  const messages = [], ends = [];
  const peer = new RoomSession({ host, contract, config: DEFAULT_CONFIG,
    send: message => messages.push(message), ended: reason => ends.push(reason) });
  return { peer, messages, ends };
}
test('new peers accept frozen legacy v2 peers only for the original flight revision', () => {
  for (const host of [true, false]) {
    const old = host ? legacyHello : legacyWelcome;
    const compatible = session(host); compatible.peer.receive(old);
    assert.equal(compatible.peer.state, 'connected');
    const changedWorld = session(host, { flight: 2 }); changedWorld.peer.receive(old);
    assert.deepEqual(changedWorld.messages[0], { type: 'reject', reason: 'incompatible' });
    assert.deepEqual(changedWorld.ends, ['incompatible']);
  }
});
test('both roles reject protocol/flight mismatches before preparation', () => {
  for (const host of [true, false]) for (const packet of [
    { version: 3, contract: { flight: 1 } }, { version: 2, contract: { flight: 2 } },
    { version: 2, contract: null }, { version: 2, contract: { flight: '1' } },
  ]) {
    const f = session(host); let prepared = false; f.peer.prepare = () => { prepared = true; };
    f.peer.receive({ ...(host ? legacyHello : legacyWelcome), ...packet });
    assert.equal(f.peer.state, 'ended'); assert.equal(prepared, false);
    assert.equal(f.messages[0].reason, 'incompatible');
  }
});
test('additive metadata and different package releases do not require matching builds', () => {
  assert.equal(compatibilityFailure({ version: 2, contract: { flight: 1, optionalFutureField: true }, software: 'any-9.8.7' }), null);
  const f = session(false); f.peer.opened();
  assert.deepEqual(f.messages[0].contract, { flight: 1 });
  f.peer.receive({ ...legacyWelcome, contract: { flight: 1 }, software: 'older-package-0.1.0' });
  assert.equal(f.peer.state, 'connected');
});

test('invite metadata catches incompatible routing without breaking old links or manual codes', () => {
  const invite = inviteUrl('K7M2QX', 'https://example.org/flight3d/');
  assert.equal(inviteCompatibilityFailure(invite), null);
  assert.equal(inviteCompatibilityFailure('https://example.org/?r=K7M2QX'), null);
  assert.equal(inviteCompatibilityFailure('K7M2QX'), null);
  assert.equal(inviteCompatibilityFailure(invite.replace('mp=2', 'mp=3')), 'protocol');
  assert.equal(inviteCompatibilityFailure(invite.replace('fr=1', 'fr=2')), 'flight');
  assert.equal(inviteCompatibilityFailure(invite.replace('fr=1', 'fr=x')), 'malformed-invite');
});
