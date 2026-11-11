import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayPanel } from '../src/ui/ReplayPanel.js';

function makePanel({ loads = true } = {}) {
  const calls = [];
  globalThis.document = { activeElement: null, getElementById: () => ({ focus: () => calls.push('focus-replays') }) };
  const panel = Object.create(ReplayPanel.prototype);
  Object.assign(panel, {
    setFolded: () => {},
    load: async () => loads,
    sim: {
      analytics: {},
      gameFlow: { returnToLobby: () => calls.push('lobby') },
      replayDirector: { stop: () => calls.push('stop') },
    },
  });
  return { panel, calls };
}

test('leaving a replay the debrief opened goes back to that debrief (#648)', async () => {
  const { panel, calls } = makePanel();
  assert.equal(await panel.watch({}, null, { returnTo: () => { calls.push('debrief'); return true; } }), true);
  panel.exit();
  assert.deepEqual(calls, ['debrief'], 'the debrief keeps its save and share actions reachable');

  calls.length = 0;
  panel.exit();
  assert.deepEqual(calls, ['lobby', 'stop', 'focus-replays'], 'the return is spent once used');
});

test('library playback, a refused return and a failed load all leave for the lobby', async () => {
  const { panel, calls } = makePanel();
  await panel.watch({}, 'entry-1');
  panel.exit();
  assert.deepEqual(calls, ['lobby', 'stop', 'focus-replays']);

  calls.length = 0;
  await panel.watch({}, null, { returnTo: () => false });
  panel.exit();
  assert.deepEqual(calls, ['lobby', 'stop', 'focus-replays']);

  const failed = makePanel({ loads: false });
  await failed.panel.watch({}, null, { returnTo: () => assert.fail('a replay that never started has nothing to return from') });
  failed.panel.exit();
  assert.deepEqual(failed.calls, ['lobby', 'stop', 'focus-replays']);
});
