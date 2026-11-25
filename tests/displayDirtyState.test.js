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

test('updateFlightDisplays throttles redraws outside cockpit to preserve bandwidth', async () => {
  const { PhysicsIntegratorMethods } = await import('../src/core/PhysicsIntegrator.js');
  let pfdRenders = 0;
  const mockSim = Object.create(PhysicsIntegratorMethods.prototype);
  mockSim.pfdCanvas = { updateData() {}, render() { pfdRenders++; } };
  mockSim.isfdCanvas = { updateData() {}, render() {} };
  mockSim.ndCanvas = { updateData() {}, render() {} };
  mockSim.eicasCanvas = { updateData() {}, render() {} };
  mockSim.mcpCanvas = { updateData() {}, render() {} };
  mockSim.cduCanvas = { updateData() {}, render() {} };
  mockSim.telemetry = {};
  mockSim.cameraSystem = {
    mode: 1, // CHASE (non-cockpit)
    constructor: { MODES: { COCKPIT: 0, CHASE: 1 } },
  };

  // Run 16 frames in CHASE mode:
  // frame 0 (frame%8===0: renders), frame 1..7 (skipped), frame 8 (renders), frame 9..15 (skipped)
  for (let i = 0; i < 16; i++) {
    mockSim.updateFlightDisplays();
  }
  assert.equal(pfdRenders, 2, 'CHASE mode must throttle PFD renders to every 8 frames');

  // Switching to COCKPIT mode immediately renders:
  mockSim.cameraSystem.mode = 0; // COCKPIT
  mockSim.updateFlightDisplays();
  assert.equal(pfdRenders, 3, 'switching to COCKPIT must immediately trigger flight displays update');
});
