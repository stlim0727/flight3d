import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitFlightCamera } from '../src/ui/FlightPanels.js';
import { FlightControls } from '../src/controls/FlightControls.js';

test('committing a CAM choice releases select capture so flight shortcuts work immediately', () => {
  const body = { closest: () => null };
  let active;
  const select = { value: '7', closest: () => select, blur() { active = body; } };
  active = select;
  const controls = Object.create(FlightControls.prototype);
  controls.keys = {};
  let gearToggles = 0;
  controls.onToggleGear = () => gearToggles++;
  const modes = [];
  controls.onSelectCamera = mode => modes.push(mode);
  controls.handleKeyDown({ code: 'Digit1', target: active });
  assert.deepEqual(modes, [], 'editing the select must retain its normal key handling');
  commitFlightCamera(select, mode => modes.push(mode));
  assert.deepEqual(modes, [7]);
  assert.equal(active, body);
  controls.handleKeyDown({ code: 'Digit1', target: active });
  assert.deepEqual(modes, [7, 0], 'the next shortcut reaches flight controls without another click');
  for (const code of ['ArrowUp', 'Equal', 'KeyG']) controls.handleKeyDown({ code, target: active });
  assert.equal(controls.keys.ArrowUp, true);
  assert.equal(controls.keys.Equal, true);
  assert.equal(gearToggles, 1);
});
