import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightControls } from '../src/controls/FlightControls.js';
import { bindPilotPanelInput } from '../src/ui/pilotPanelInput.js';

class ControlsWithoutDom extends FlightControls { initListeners() {} }

test('focusing a pilot field releases held flight keys and keyup remains unblocked', () => {
  const controls = new ControlsWithoutDom(null, { getGamepads: () => [] });
  const shell = new EventTarget();
  shell.closest = () => true;
  bindPilotPanelInput(shell, controls);
  controls.keys.KeyS = true;
  shell.dispatchEvent(new Event('focusin'));
  assert.deepEqual(controls.keys, {});
  const down = new Event('keydown');
  let downBlocked = false;
  down.stopPropagation = () => { downBlocked = true; };
  shell.dispatchEvent(down);
  assert.equal(downBlocked, true, 'typing must not reach flight keydown listeners');
  const up = new Event('keyup');
  let upBlocked = false;
  up.stopPropagation = () => { upBlocked = true; };
  shell.dispatchEvent(up);
  assert.equal(upBlocked, false);
  controls.keys.KeyS = true;
  controls.handleKeyUp({ code: 'KeyS' });
  assert.equal(controls.keys.KeyS, false);
});
