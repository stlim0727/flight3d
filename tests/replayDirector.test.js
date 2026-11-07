import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Object3D } from 'three';
import { ReplayDirector } from '../src/director/ReplayDirector.js';
import { RenderPose } from '../src/core/RenderPose.js';
import { sampleTrack, trackDuration } from '../src/replay/TrackSampler.js';
import { FLOW } from '../src/ui/GameFlowController.js';

function track(sampleCount = 25, intervalSec = 0.2) {
  const samples = [];
  for (let index = 0; index < sampleCount; index++) {
    samples.push({
      timeSec: index * intervalSec,
      x: index * 10, y: 100 + index, z: -index * 5,
      quat: [0, Math.sin(index * 0.02), 0, Math.cos(index * 0.02)],
      iasKnots: 120 + index, altitudeFt: 3000 + index * 10, headingDeg: (index * 2) % 360,
      pitchDeg: 1, rollDeg: 0, gForce: 1, throttle: 0.6, gearState: 1, flapIndex: 1, flapDegree: 10,
      elevator: 0.1, aileron: 0, rudder: 0, pitchTrim: 0.05, spoilers: 0, tasKnots: 130,
      groundSpeedKnots: 125, vsiFpm: 0, radioAltFt: 100, mach: 0.4, selectedHeading: 180,
      selectedAltitude: 3000, selectedSpeed: 120, onGround: false, touchdown: false, isTransit: false,
      isStalled: false, isPreStall: false, isStallWarning: false, reverserActive: false,
      apEngaged: true, parkBrake: false, compressions: { nose: 0, mainLeft: 0, mainRight: 0 },
      gearDamage: { nose: 'normal' }, bodyDamage: { belly: 0 },
      engine1: { n1: 60, n2: 70, egt: 400, ff: 900, failed: false },
      engine2: { n1: 60, n2: 70, egt: 400, ff: 900, failed: false },
    });
  }
  return { intervalSec, durationSec: (sampleCount - 1) * intervalSec, overflow: false,
    metadata: { airport: 'lukla', aircraft: 'B738', scenario: 'approach', demoProfile: 'standard',
      timeOfDay: 17.5 }, samples };
}

function fakeSim(options = {}) {
  const calls = { snap: 0, setTime: [], fly: 0, disabled: [], displays: 0 };
  const sim = {
    calls,
    lobby: { airport: 'coastal', aircraft: 'C172', preset: 'runway' },
    activeAirport: 'coastal',
    currentAircraftId: 'C172',
    lastPresetType: 'runway',
    gameFlow: { state: FLOW.FLIGHT },
    flightRecorder: { active: true, finish() { return null; } },
    replayRecorder: { active: true },
    debriefReport: { reason: 'landed' },
    debriefReplay: { samples: [] },
    analytics: {},
    position: new Vector3(1, 2, 3),
    quaternion: new Quaternion(0, 0, 0, 1),
    renderPose: null,
    physicsAccumulator: 0.0041,
    aircraft: { group: new Object3D() },
    currentTerrain: { isLoaded: options.terrainLoaded !== false },
    telemetry: { iasKnots: 0, altitudeFt: 0, massKg: 66000, cgBody: { x: 0 }, warnings: ['STALL'] },
    controls: { aircraftControlsDisabled: false,
      setAircraftControlsDisabled(value) {
        this.aircraftControlsDisabled = Boolean(value);
        calls.disabled.push(this.aircraftControlsDisabled);
      } },
    cameraSystem: {
      mode: 1, userModeSelected: false, userLookOverridden: true, photoCockpit: true,
      lookYaw: 0.4, lookPitch: -0.1,
      snapToTarget() { calls.snap++; },
      setMode(mode) { this.mode = mode; },
    },
    sky: { timeOfDay: 12, cloudCover: 0.5,
      setTimeOfDay(hours) { this.timeOfDay = hours; },
      setCloudCover(value) { this.cloudCover = value; } },
    foliage: { setTimeOfDay() {} },
    water: { syncWithAtmosphere() {} },
    setTimeOfDay(hours, choices) { calls.setTime.push([hours, choices]); this.sky.setTimeOfDay(hours); },
    async fly() {
      calls.fly++;
      // fly() spawns a fresh sortie, which normally starts recording one.
      this.flightRecorder.active = true;
      this.replayRecorder.active = true;
      this.debriefReport = { reason: 'manual' };
      this.debriefReplay = { samples: [1, 2] };
      if (options.flyStaysInLobby) this.gameFlow.state = FLOW.LOBBY;
    },
    updateFlightDisplays() { calls.displays++; },
  };
  sim.renderPose = new RenderPose(sim.position, sim.quaternion);
  sim.shadowDemo = { active: false };
  sim.poseDrivers = [sim.shadowDemo];
  return sim;
}

function poseOf(sim) {
  return { x: sim.position.x, y: sim.position.y, z: sim.position.z,
    qx: sim.quaternion.x, qw: sim.quaternion.w,
    group: [sim.aircraft.group.position.x, sim.aircraft.group.position.y, sim.aircraft.group.position.z] };
}

test('load rebuilds the recorded scenario and arms the first sample without flying a new sortie', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  const source = track();
  assert.equal(await director.load(source, { entryId: 'entry-1' }), true);

  assert.equal(sim.calls.fly, 1);
  assert.deepEqual(sim.lobby, { airport: 'lukla', aircraft: 'B738', preset: 'approach',
    demoProfile: 'standard' });
  assert.deepEqual(sim.calls.setTime, [[17.5, { persist: false, userChoice: false }]],
    'the recorded sky is replayed, not chosen or saved');
  assert.equal(sim.flightRecorder.active, false, 'the synthetic sortie must never reach the debrief');
  assert.equal(sim.replayRecorder.active, false);
  assert.equal(sim.debriefReport, null);
  assert.equal(sim.debriefReplay, null);
  assert.equal(sim.controls.aircraftControlsDisabled, true, 'only the yoke goes dead; camera keys stay live');

  assert.equal(director.active, true);
  assert.equal(director.paused, true, 'a load never starts rolling on its own');
  assert.equal(director.entryId, 'entry-1');
  assert.equal(director.durationSec, trackDuration(source));
  assert.equal(director.progressSec, 0);
  assert.equal(sim.calls.snap, 1);
  assert.equal(sim.physicsAccumulator, 0, 'stale render interpolation must not smear a seek');

  const first = source.samples[0];
  assert.equal(sim.position.x, first.x);
  assert.equal(sim.position.y, first.y);
  assert.equal(sim.aircraft.group.position.x, first.x);
  assert.equal(sim.telemetry.iasKnots, first.iasKnots);
  assert.equal(sim.telemetry.massKg, 66000, 'unrecorded instrument fields keep their spawned values');
  assert.deepEqual(sim.telemetry.warnings, []);
  assert.equal(sim.cameraSystem.userModeSelected, true, 'shot logic cannot argue with a scrubbed pose');
});

test('a load that never reaches flight leaves the viewer alone', async () => {
  const sim = fakeSim({ flyStaysInLobby: true });
  const director = new ReplayDirector(sim);
  assert.equal(await director.load(track()), false);
  assert.equal(director.active, false);
  assert.equal(sim.controls.aircraftControlsDisabled, false);
  assert.equal(sim.calls.snap, 0);
});

test('unplayable tracks are refused before the scene is touched', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  assert.equal(await director.load(null), false);
  assert.equal(await director.load({ samples: [{ timeSec: 0 }] }), false);
  assert.equal(await director.load({ samples: [] }), false);
  assert.equal(sim.calls.fly, 0);
  assert.equal(director.active, false);
});

test('mandated sequence: play, seek backwards, 3x, pause, step back, resume, run out, stop', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  const source = track();
  const seen = [];
  director.onChange = () => seen.push(director.paused);
  assert.equal(await director.load(source), true);

  assert.equal(director.play(), true);
  director.update(0.4);
  assert.ok(Math.abs(director.progressSec - 0.4) < 1e-9, 'playback is in simulation seconds at 1x');

  const snapsAtStart = sim.calls.snap;
  director.seek(0.2);
  assert.equal(sim.calls.snap, snapsAtStart + 1, 'every seek re-seeds the camera');
  const expected = sampleTrack(source, 0.2, {}, {});
  assert.ok(Math.abs(sim.position.x - expected.x) < 1e-3);
  assert.ok(Math.abs(sim.quaternion.y - expected.quat[1]) < 1e-6);

  director.seek(1.6);
  director.setSpeed(3);
  director.update(0.1);
  assert.ok(Math.abs(director.progressSec - 1.9) < 1e-9, '3x costs nothing but a clock multiplier');
  assert.equal(director.setSpeed(1.5), false, 'only the published presets exist');

  director.pause();
  const pausedAt = director.progressSec;
  director.update(1);
  assert.equal(director.progressSec, pausedAt, 'a paused track cannot drift');

  director.stepFrame(-1);
  assert.equal(director.paused, true, 'frame stepping is a scrub, not a resume');
  const stepped = source.samples.findIndex(sample => Math.abs(sample.timeSec - director.progressSec) < 1e-9);
  assert.ok(stepped >= 0, 'a step lands on a recorded sample, not between them');
  assert.equal(sim.calls.snap, snapsAtStart + 3, 'step, seek and seek each re-seed');

  director.play();
  director.update(60);
  assert.equal(director.progressSec, director.durationSec, 'playback stops at the last sample');
  assert.equal(director.paused, true, 'running out parks the track');
  assert.equal(director.active, true, 'the viewer stays open after the end');

  director.stop();
  assert.equal(director.active, false);
  assert.equal(sim.controls.aircraftControlsDisabled, false);
  assert.equal(director.track, null);
  assert.equal(director.progressSec, 0);
  assert.equal(sim.cameraSystem.userModeSelected, false, 'the pre-replay camera choices come back');
  assert.equal(sim.cameraSystem.userLookOverridden, true);
  assert.equal(sim.cameraSystem.photoCockpit, true);
  assert.equal(sim.cameraSystem.lookYaw, 0.4);
  assert.equal(sim.cameraSystem.lookPitch, -0.1);
  assert.equal(sim.sky.timeOfDay, 12, 'the pre-replay sky comes back');
  assert.equal(sim.sky.cloudCover, 0.5);
  assert.ok(seen.length >= 6);
});

test('backwards and forwards seeks are reproducible, so scrubbing never loses a pose', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  const source = track(40);
  await director.load(source);
  const times = source.samples.map(sample => sample.timeSec);
  const forward = times.map(time => { director.seek(time); return poseOf(sim); });
  const backward = [...times].reverse()
    .map(time => { director.seek(time); return poseOf(sim); }).reverse();
  assert.deepEqual(forward, backward, 'a scrubbed pose must not depend on the direction it came from');
});

test('the track waits for terrain instead of rendering into a hole', async () => {
  const sim = fakeSim({ terrainLoaded: false });
  const director = new ReplayDirector(sim);
  await director.load(track());
  director.play();
  director.update(1);
  assert.equal(director.waitingTerrain, true);
  assert.equal(director.progressSec, 0, 'no clock advances while the region is missing');
  sim.currentTerrain.isLoaded = true;
  director.update(0.5);
  assert.equal(director.waitingTerrain, false);
  assert.ok(Math.abs(director.progressSec - 0.5) < 1e-9, 'the next frame after terrain is playable');
});

test('a replay takes the frame from nothing and physics stays out while it holds it', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  sim.poseDrivers = [sim.shadowDemo, director];
  const active = () => sim.poseDrivers.find(driver => driver.active) ?? null;
  assert.equal(active(), null);
  await director.load(track());
  assert.equal(active(), director);
  sim.shadowDemo.active = true;
  assert.equal(active(), sim.shadowDemo, 'the developer rig wins when both claim the frame');
  sim.shadowDemo.active = false;
  director.stop();
  assert.equal(active(), null);
});

test('stop is idempotent and a second load replaces the first track', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  director.stop();
  assert.equal(director.active, false);
  await director.load(track(20));
  assert.ok(Math.abs(director.durationSec - 3.8) < 1e-9, director.durationSec);
  await director.load(track(60));
  assert.ok(Math.abs(director.durationSec - 11.8) < 1e-9, director.durationSec);
  assert.equal(sim.calls.fly, 2);
  assert.equal(director.active, true);
  director.stop();
  director.stop();
  assert.equal(sim.controls.aircraftControlsDisabled, false);
});

test('moving playback renders the current pose even with a zero physics accumulator', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  await director.load(track());
  director.play();
  for (let i = 0; i < 10; i++) {
    director.update(0.1);
    sim.renderPose.apply(sim.aircraft.group, sim.position, sim.quaternion, 0);
    assert.deepEqual(sim.aircraft.group.position.toArray(), sim.position.toArray());
  }
  assert.ok(sim.position.x > 0);
});

test('stepping backwards at the last sample visits its immediate predecessor', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  const source = track();
  await director.load(source);
  director.seek(director.durationSec);
  assert.equal(director.stepFrame(-1), source.samples.at(-2).timeSec);
  assert.equal(director.stepFrame(1), source.samples.at(-1).timeSec);
  director.play(); director.update(NaN);
  assert.ok(Number.isFinite(director.progressSec));
});

test('replay cannot interrupt an active multiplayer room or a scene swap', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  sim.multiplayer = { active: true };
  assert.equal(await director.load(track()), false);
  sim.multiplayer.active = false;
  sim.startingFlight = true;
  assert.equal(await director.load(track()), false);
  assert.equal(sim.calls.fly, 0);
});

test('all speed presets advance simulation time and invalid metadata never changes the scene', async () => {
  const sim = fakeSim();
  const director = new ReplayDirector(sim);
  const source = track(100);
  for (const metadata of [{}, { airport: 'elsewhere', aircraft: 'B738', scenario: 'cruise' },
    { airport: 'valley', aircraft: 'F16', scenario: 'valley', seed: NaN }]) {
    assert.equal(await director.load({ ...source, metadata }), false);
  }
  assert.equal(sim.calls.fly, 0);
  await director.load(source);
  for (const speed of [.3, .5, 1, 2, 3]) {
    director.seek(0); director.setSpeed(speed); director.play(); director.update(1);
    assert.equal(director.progressSec, speed);
  }
});
