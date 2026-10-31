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

test('crash reports snapshot the collision once and include it in shared text', () => {
  let language = 'ko';
  const crash = { type: 'TERRAIN', speedKnots: 177.6, point: { x: 1 },
    get name() { return language === 'ko' ? '지형 충돌' : 'Terrain collision'; },
    get description() { return language === 'ko' ? '기체가 지면과 충돌했습니다.' : 'The aircraft hit the ground.'; } };
  const r = new FlightRecorder(); r.start(metadata); record(5, r);
  const report = r.finish('crash', crash);
  assert.equal(report.version, 2);
  assert.deepEqual(report.crash, { type: 'TERRAIN', name: '지형 충돌', description: '기체가 지면과 충돌했습니다.',
    speedKnots: 177.6, timeSec: report.durationSec });
  language = 'en'; crash.speedKnots = 0;
  assert.equal(report.crash.name, '지형 충돌', 'exported reports own their collision data');
  assert.equal(report.crash.speedKnots, 177.6);
  const time = flightDuration(report.durationSec);
  setLanguage('ko');
  assert.ok(reportText(report).includes(`충돌: 지형 충돌 · 178 KT · ${time}`));
  setLanguage('en');
  assert.ok(reportText(report).includes(`Impact: 지형 충돌 · 178 KT · ${time}`));

  const manual = new FlightRecorder(); manual.start(metadata); record(5, manual);
  assert.equal(manual.finish('manual').crash, null);
  assert.doesNotMatch(reportText(manual.report), /Impact:/);
  const unknown = new FlightRecorder(); unknown.start(metadata); record(5, unknown);
  assert.equal(unknown.finish('crash', { type: 'WATER', speedKnots: NaN }).crash.speedKnots, null);
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
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT, 'impact must leave the crash scene visible');
  SimulatorClass.prototype.updateCrashDebrief.call(sim, 3);
  assert.equal(sim.gameFlow.state, FLOW.DEBRIEF);
  sim.gameFlow.returnToLobby();
  assert.equal(sim.gameFlow.canResumeFromLobby(), false);
});

function crashSortie() {
  const sim = { gameFlow: new GameFlowController(), flightRecorder: new FlightRecorder(), devRunner: {},
    telemetry: { ...telemetry }, isCrashed: false, shown: 0,
    debriefOverlay: { show() { sim.shown++; } } };
  for (const method of ['endFlight', 'updateFlightRecording', 'updateCrashDebrief', 'beginFlightRecording']) {
    sim[method] = (...args) => SimulatorClass.prototype[method].call(sim, ...args);
  }
  sim.gameFlow.enterFlight(); sim.flightRecorder.start(metadata);
  for (let i = 0; i < 120; i++) sim.updateFlightRecording(1 / 120);
  sim.isCrashed = true; sim.telemetry.gForce = 4;
  sim.crashResult = { type: 'TOWER', name: 'Tower', description: 'Hit the tower.', speedKnots: 140 };
  sim.updateFlightRecording(1 / 120);
  return sim;
}

test('crash scene waits for three rendered seconds with an immutable impact report', () => {
  const sim = crashSortie();
  const report = structuredClone(sim.debriefReport);
  assert.equal(report.peaks.gForce.gForce, 4, 'include impact telemetry');
  assert.equal(report.crash.type, 'TOWER', 'include the collision that ended the sortie');
  assert.equal(report.crash.timeSec, report.durationSec);
  assert.equal(report.sufficient, false);
  sim.telemetry.gForce = 100;
  for (let i = 0; i < 1200; i++) sim.updateFlightRecording(1 / 120);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT, 'physics stepping cannot consume the visible delay');
  assert.equal(sim.shown, 0);
  for (let i = 0; i < 179; i++) sim.updateCrashDebrief(1 / 60);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  sim.updateCrashDebrief(1 / 60);
  assert.equal(sim.gameFlow.state, FLOW.DEBRIEF);
  assert.deepEqual(sim.debriefReport, report, 'wreckage time cannot inflate metrics or enable sharing');
  sim.updateCrashDebrief(10); sim.updateFlightRecording(1);
  assert.equal(sim.shown, 1);
});

test('crash observation excludes pause/background and menu cancels automatic presentation', () => {
  const sim = crashSortie();
  sim.updateCrashDebrief(1);
  sim.gameFlow.pause(); sim.updateCrashDebrief(10);
  sim.gameFlow.resume(); sim.browserBackgrounded = true; sim.updateCrashDebrief(10);
  sim.browserBackgrounded = false;
  for (const dt of [NaN, Infinity, -1, 0]) sim.updateCrashDebrief(dt);
  assert.equal(sim.crashDebriefRemaining, 2);
  sim.gameFlow.returnToLobby(true); sim.updateCrashDebrief(10);
  assert.equal(sim.crashDebriefRemaining, null);
  assert.equal(sim.shown, 0);
  sim.endFlight();
  assert.equal(sim.gameFlow.state, FLOW.DEBRIEF, 'explicit end can show the finalized crash report from menu');
  assert.equal(sim.debriefReport.reason, 'crash');
});

test('reset, fresh recordings and developer crashes cannot open an old accident report', () => {
  const sim = crashSortie();
  sim.isCrashed = false; sim.updateCrashDebrief(10);
  assert.equal(sim.crashDebriefRemaining, null);
  sim.lobby = {}; sim.sky = { timeOfDay: 10 };
  sim.beginFlightRecording();
  assert.equal(sim.debriefReport, null);
  sim.updateCrashDebrief(10); sim.updateFlightRecording(1 / 120);
  assert.equal(sim.shown, 0);
  assert.equal(sim.flightRecorder.elapsed, 1 / 120);
  sim.devRunner.active = true; sim.isCrashed = true; sim.updateFlightRecording(1 / 120);
  assert.equal(sim.crashDebriefRemaining, null);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  sim.devRunner.active = false; sim.updateFlightRecording(1 / 120);
  sim.endFlight(); sim.updateCrashDebrief(10);
  assert.equal(sim.shown, 1, 'manual end of a pending crash must disarm later presentation');
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
