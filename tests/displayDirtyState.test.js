import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCPCanvas } from '../src/aircraft/MCPCanvas.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';

test('MCP redraws for selections and caution transitions, including release', () => {
  const display = Object.create(MCPCanvas.prototype);
  let renders = 0;
  display.render = () => renders++;
  const state = { selectedSpeed: 160, selectedHeading: 90, selectedAltitude: 5000, apEngaged: false };
  display.updateData(state);
  display.updateData(state);
  assert.equal(renders, 1);
  display.updateData({ ...state, selectedSpeed: 170 });
  display.updateData({ ...state, selectedSpeed: 170, isStalled: true });
  display.updateData({ ...state, selectedSpeed: 170, isStalled: true });
  display.updateData({ ...state, selectedSpeed: 170 });
  assert.equal(renders, 4);
  assert.equal(display.masterCaution, false);
  display.fdLeft = false;
  display.updateData({ ...state, selectedSpeed: 170 });
  assert.equal(renders, 5);
});

test('CDU ignores flight telemetry but redraws for displayed route state', () => {
  const display = Object.create(CDUCanvas.prototype);
  let renders = 0;
  display.render = () => renders++;
  display.updateData({ iasKnots: 0 });
  display.updateData({ iasKnots: 200 });
  assert.equal(renders, 1);
  display.setAirport('lukla');
  assert.equal(display.activeWpt, 'RW06');
  display.updateData({});
  const afterAirport = renders;
  display.updateData({});
  assert.equal(renders, afterAirport);
});
