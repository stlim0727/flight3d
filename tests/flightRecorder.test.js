import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightRecorder, flightDuration } from '../src/core/FlightRecorder.js';
import { reportText } from '../src/ui/DebriefOverlay.js';
import { setLanguage } from '../src/i18n/index.js';
import { SimulatorClass } from './helpers/simulatorClass.js';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';

const metadata = { aircraft: 'C172', airport: 'coastal', scenario: 'approach' };
const telemetry = { x: 0, z: 0, altitudeFt: 6000, iasKnots: 120, gForce: 1,
  pitchDeg: 0, rollDeg: 0, headingDeg: 90, onGround: false, touchdownSinkRate: 0, groundSpeedKnots: 120 };
function record(seconds, recorder, data = telemetry) {
  for (let i = 0; i < Math.round(seconds * 120); i++) recorder.update(1 / 120, data);
}

test('fixed-step sampling retains peaks between samples and owns immutable sortie data', () => {
  const recorder = new FlightRecorder(); recorder.start(metadata);
  record(5, recorder);
  recorder.update(1 / 120, { ...telemetry, altitudeFt: 6100, iasKnots: 121, gForce: 2 });
  recorder.update(1 / 120, telemetry);
  const report = recorder.finish();
  assert.ok(Math.abs(report.durationSec - 5 - 2 / 120) < 1e-9);
  assert.ok(report.samples.length >= 25 && report.samples.length <= 27);
  assert.equal(report.peaks.gForce.gForce, 2);
  assert.equal(report.samples.at(-1).timeSec, report.durationSec);
  assert.equal(report.sufficient, true);
  assert.deepEqual(recorder.finish('crash'), report);
  recorder.start({ ...metadata, aircraft: 'F16' }); record(10, recorder);
  assert.equal(report.metadata.aircraft, 'C172');
  assert.equal(report.peaks.altitudeFt.altitudeFt, 6100);
});

test('no-data, malformed and short recordings cannot enable sharing', () => {
  const r = new FlightRecorder(); r.start(metadata);
  r.update(NaN, telemetry); r.update(-1, telemetry);
  record(10, r, { ...telemetry, altitudeFt: NaN });
  assert.equal(r.finish().sufficient, false);
  r.start(metadata); record(3, r);
  assert.equal(r.finish().sufficient, false);
  r.start(metadata); record(10, r, { ...telemetry, iasKnots: Infinity }); record(0.2, r);
  assert.equal(r.finish().sufficient, false);
});

test('ground spawns do not count as landings, sustained flight and bounces do', () => {
  const r = new FlightRecorder(); r.start(metadata);
  const ground = { ...telemetry, onGround: true, groundSpeedKnots: 0, touchdownSinkRate: 2 };
  record(3, r, ground); assert.equal(r.touchdowns.length, 0); assert.equal(r.stopped, 0);
  record(2, r); r.update(1 / 120, ground);
  assert.equal(r.touchdowns.length, 1);
  assert.ok(Math.abs(r.touchdowns[0].sinkRateFpm - 393.7007874) < 1e-6);
  record(0.3, r); r.update(1 / 120, ground);
  assert.equal(r.touchdowns.length, 1, 'short bounce does not create another landing');
  record(3, r, ground); assert.ok(r.stopped >= 3);
  record(2, r); r.update(1 / 120, ground);
  assert.equal(r.touchdowns.length, 2, 'touch and go creates a new landing');
});

test('long flights bound trajectory memory while preserving all-tick maxima and endpoints', () => {
  const r = new FlightRecorder({ maxSamples: 10 }); r.start(metadata);
  record(30, r); r.update(1 / 120, { ...telemetry, gForce: 3 }); record(1, r);
  const report = r.finish();
  assert.ok(report.samples.length <= 10);
  assert.equal(report.samples[0].timeSec, 1 / 120);
  assert.equal(report.samples.at(-1).timeSec, report.durationSec);
  assert.equal(report.peaks.gForce.gForce, 3);
});

test('localized share report contains actual metrics, end reason and touchdown', () => {
  const r = new FlightRecorder(); r.start(metadata); record(5, r);
  const report = r.finish('crash');
  setLanguage('en');
  assert.match(reportText(report), /6,000 FT/); assert.match(reportText(report), /Aircraft accident/);
  setLanguage('ko');
  assert.match(reportText(report), /기체 사고/);
  assert.equal(flightDuration(522), '08:42'); assert.equal(flightDuration(3600), '60:00');
});

test('flow sequence excludes pause/menu time, freezes completed reports, retry starts fresh', () => {
  const sim = { gameFlow: new GameFlowController(), flightRecorder: new FlightRecorder(), devRunner: {},
    telemetry, isCrashed: false, debriefOverlay: { show(report) { this.report = report; } } };
  sim.endFlight = reason => SimulatorClass.prototype.endFlight.call(sim, reason);
  const tick = () => SimulatorClass.prototype.updateFlightRecording.call(sim, 1 / 120);
  sim.gameFlow.enterFlight(); sim.flightRecorder.start(metadata);
  for (let i = 0; i < 240; i++) tick();
  sim.gameFlow.pause(); for (let i = 0; i < 1200; i++) tick();
  sim.gameFlow.resume(); for (let i = 0; i < 360; i++) tick();
  sim.gameFlow.returnToLobby(true); for (let i = 0; i < 1200; i++) tick();
  sim.endFlight();
  assert.equal(sim.gameFlow.state, FLOW.DEBRIEF);
  assert.ok(Math.abs(sim.debriefReport.durationSec - 5) < 1e-9);
  assert.equal(sim.gameFlow.isPhysicsFrozen(), true);
  assert.equal(sim.gameFlow.resume(), false);
  tick(); assert.equal(sim.debriefReport.samples.length, sim.debriefOverlay.report.samples.length);
  sim.gameFlow.enterFlight(); sim.flightRecorder.start(metadata); tick();
  assert.equal(sim.flightRecorder.elapsed, 1 / 120);
  sim.isCrashed = true; tick();
  assert.equal(sim.debriefReport.reason, 'crash');
  sim.gameFlow.returnToLobby();
  assert.equal(sim.gameFlow.canResumeFromLobby(), false);
});

test('landing completion needs a recorded airborne touchdown and a sustained stop', () => {
  const sim = { gameFlow: new GameFlowController(), flightRecorder: new FlightRecorder(), devRunner: {},
    telemetry: { ...telemetry }, debriefOverlay: { show() {} } };
  sim.endFlight = reason => SimulatorClass.prototype.endFlight.call(sim, reason);
  sim.gameFlow.enterFlight(); sim.flightRecorder.start(metadata);
  for (let i = 0; i < 240; i++) SimulatorClass.prototype.updateFlightRecording.call(sim, 1 / 120);
  Object.assign(sim.telemetry, { onGround: true, groundSpeedKnots: 0, touchdownSinkRate: 1 });
  for (let i = 0; i < 240; i++) SimulatorClass.prototype.updateFlightRecording.call(sim, 1 / 120);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  for (let i = 0; i < 121; i++) SimulatorClass.prototype.updateFlightRecording.call(sim, 1 / 120);
  assert.equal(sim.gameFlow.state, FLOW.DEBRIEF);
  assert.equal(sim.debriefReport.reason, 'landed');
});

test('retry restores the completed sortie instead of applying staged menu choices', () => {
  const sim = { gameFlow: new GameFlowController(),
    debriefReport: { metadata: { ...metadata, timeOfDay: 10, demoProfile: 'standard' } },
    lobby: { aircraft: 'F16', airport: 'lukla', preset: 'runway' },
    setTimeOfDay(hours) { this.hours = hours; },
    startFlight() { this.started = { ...this.lobby }; this.gameFlow.enterFlight(); } };
  sim.gameFlow.enterFlight(); sim.gameFlow.endFlight();
  SimulatorClass.prototype.retryDebrief.call(sim);
  assert.deepEqual(sim.started, { aircraft: 'C172', airport: 'coastal', preset: 'approach', demoProfile: 'standard' });
  assert.equal(sim.hours, 10);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
});
