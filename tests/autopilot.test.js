import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AutopilotController,
  wrapHeading,
} from '../src/physics/Autopilot.js';
import { approachDeviation } from '../src/config/approachData.js';

function cruiseState() {
  return {
    airportKey: 'coastal',
    headingDeg: 90,
    rollDeg: 0,
    pitchDeg: 2,
    altitudeFt: 5000,
    vsiFpm: 0,
    iasKnots: 250,
    tasKnots: 260,
    throttle: 0.6,
    x: -5000,
    z: 0,
  };
}

// First-order aircraft proxy used only to close the loop in tests:
// elevator -> pitch (deg per command unit), pitch -> steady vsi, aileron ->
// bank -> heading rate, throttle -> steady IAS change.
function stepPlant(state, cmd, dt) {
  state.pitchDeg += ((cmd.elevator * 8) - 0) * dt; // pitch target ∝ elevator
  const vsiAsym = state.pitchDeg * 500;
  state.vsiFpm += (vsiAsym - state.vsiFpm) * dt / 2;
  state.altitudeFt += (state.vsiFpm / 60) * dt;

  state.rollDeg += (cmd.aileron * 30 - state.rollDeg) * dt;
  state.headingDeg = (state.headingDeg + 3 * Math.tan(state.rollDeg * Math.PI / 180) /
    Math.tan(30 * Math.PI / 180) * dt + 360) % 360;

  const iasAsym = 60 + cmd.throttle * 220;
  state.iasKnots += (iasAsym - state.iasKnots) * dt / 5;

  const speedMs = state.tasKnots * 0.5144;
  const hr = state.headingDeg * Math.PI / 180;
  state.x += speedMs * Math.sin(hr) * dt;
  state.z -= speedMs * Math.cos(hr) * dt;
}

function fly(ap, state, seconds, dt = 1 / 30) {
  for (let i = 0; i < seconds / dt; i++) {
    const cmd = ap.update(state, dt);
    stepPlant(state, cmd, dt);
    state.throttle = cmd.throttle;
  }
  return state;
}

describe('wrapHeading', () => {
  it('takes the short way around the compass', () => {
    assert.strictEqual(wrapHeading(1 - 359), 2);
    assert.strictEqual(wrapHeading(359 - 1), -2);
    assert.strictEqual(wrapHeading(180), 180);
    assert.strictEqual(wrapHeading(0), 0);
  });
});

describe('AutopilotController modes', () => {
  it('outputs neutral axes when master is off and passes throttle through', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    const cmd = ap.update(t, 1 / 120);
    assert.strictEqual(cmd.aileron, 0);
    assert.strictEqual(cmd.elevator, 0);
    assert.strictEqual(cmd.throttle, 0.6);
  });

  it('re-engaging MASTER disengages and reset() clears modes and master', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    ap.engage('MASTER', t);
    ap.engage('HDG', t);
    assert.strictEqual(ap.master, true);
    ap.engage('MASTER', t);
    assert.strictEqual(ap.master, false);
    ap.engage('ALT', t);
    ap.reset();
    assert.strictEqual(ap.master, false);
    assert.strictEqual(ap.lateralMode, null);
    assert.strictEqual(ap.verticalMode, null);
    assert.strictEqual(ap.speedMode, false);
  });

  it('HDG holds the captured heading including across 359°→001°', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    t.headingDeg = 359;
    ap.engage('HDG', t);
    assert.strictEqual(ap.targets.headingDeg, 359);
    t.headingDeg = 1; // drifted 2° the short way; must correct left, not spin 358°
    fly(ap, t, 40);
    assert.ok(Math.abs(wrapHeading(359 - t.headingDeg)) < 1,
      `heading error ${wrapHeading(359 - t.headingDeg)} not within 1°`);
  });

  it('HDG returns to the target after a 30° disturbance', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    ap.engage('HDG', t);
    t.headingDeg = 120;
    fly(ap, t, 60);
    assert.ok(Math.abs(wrapHeading(90 - t.headingDeg)) < 1);
  });

  it('ALT commands nose-up while below target and sinking, and converges without windup', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    ap.engage('ALT', t); // target 5000
    t.altitudeFt = 4500;
    t.vsiFpm = -800;
    const cmd = ap.update(t, 1 / 120);
    assert.ok(cmd.elevator > 0, 'elevator must command nose-up');
    t.vsiFpm = 0; // no windup: level at 500 ft below target still demands climb
    assert.ok(ap.update(t, 1 / 120).elevator > 0);

    t.altitudeFt = 4500;
    t.vsiFpm = -500;
    t.pitchDeg = 0;
    fly(ap, t, 60);
    assert.ok(Math.abs(t.altitudeFt - 5000) < 20, `altitude ${t.altitudeFt}`);
    assert.ok(Math.abs(t.vsiFpm) < 150, `residual vsi ${t.vsiFpm}`);
  });

  it('SPD mode integrates throttle toward the captured IAS and clamps at 1.0', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    ap.engage('MASTER', t);
    ap.engage('SPD', t); // captures 250
    t.iasKnots = 220;
    t.throttle = 0.5;
    let max = 0;
    for (let i = 0; i < 60; i++) {
      const cmd = ap.update({ ...t, throttle: t.throttle }, 1 / 60);
      t.throttle = cmd.throttle;
      max = Math.max(max, cmd.throttle);
      assert.ok(cmd.throttle <= 1.0);
    }
    assert.ok(t.throttle > 0.5, 'throttle must rise toward target');
    fly(ap, t, 30);
    assert.ok(Math.abs(t.iasKnots - 250) < 5, `ias ${t.iasKnots}`);
    assert.ok(max <= 1.0);
  });

  it('APP arms far from the glideslope and captures when within 300 ft', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    t.x = -1350 - 8000;
    t.altitudeFt = 3000;
    ap.engage('APP', t);
    assert.strictEqual(ap.appArmed, true);
    assert.strictEqual(ap.lateralMode, null);

    t.altitudeFt = 500; // gs at 8000 m ≈ 1445 ft? no: re-engage near gs below band
    const dev = approachDeviation('coastal', { x: -4350, z: 0, altitudeFt: 354.7, tasKnots: 145 });
    assert.ok(Math.abs(dev.glideslopeErrorFt + 200) < 1, `gs error ${dev.glideslopeErrorFt}`);
    t.x = -4350;
    t.z = 0;
    t.tasKnots = 145;
    t.iasKnots = 145;
    t.altitudeFt = 354.7;
    t.vsiFpm = -768;
    t.headingDeg = 90;
    ap.engage('APP', t);
    assert.strictEqual(ap.lateralMode, 'APP');
    assert.strictEqual(ap.verticalMode, 'APP');
    // 200 ft below the gs must command nose-up.
    const cmd = ap.update(t, 1 / 120);
    assert.ok(cmd.elevator > 0, 'below glideslope demands nose-up');
  });

  it('APP tracks glideslope and localizer to within 10 ft in the closed loop', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    t.x = -6350;
    t.z = 250; // 250 m right of course
    t.altitudeFt = 664; // ~235 ft below the gs at 5000 m out
    t.tasKnots = 145;
    t.iasKnots = 145;
    t.vsiFpm = -768;
    t.pitchDeg = 0;
    const engaged = ap.evaluateAppCapture(t);
    assert.strictEqual(engaged, true);
    fly(ap, t, 45);
    const dev = approachDeviation('coastal', t);
    assert.ok(dev.distanceToThresholdM > 500, 'still in front of the threshold');
    assert.ok(Math.abs(dev.glideslopeErrorFt) < 10, `gs error ${dev.glideslopeErrorFt}`);
    assert.ok(Math.abs(dev.crossTrackM) < 60, `cross track ${dev.crossTrackM}`);
  });

  it('toggle() turns the active mode off and re-arms nothing', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    assert.strictEqual(ap.toggle('HDG', t), true);
    assert.strictEqual(ap.lateralMode, 'HDG');
    assert.strictEqual(ap.toggle('HDG', t), false);
    assert.strictEqual(ap.lateralMode, null);
    assert.strictEqual(ap.master, true); // other modes keep the AP alive
    assert.strictEqual(ap.toggle('SPD', t), true);
    assert.strictEqual(ap.toggle('SPD', t), false);
    assert.strictEqual(ap.toggle('ALT', t), true);
    assert.strictEqual(ap.toggle('ALT', t), false);
    assert.strictEqual(ap.verticalMode, 'PITCH');
  });

  it('annunciation reflects the active mode stack', () => {
    const ap = new AutopilotController();
    const t = cruiseState();
    ap.engage('HDG', t);
    ap.engage('ALT', t);
    ap.engage('SPD', t);
    assert.strictEqual(ap.annunciation(), 'HDG ALT SPD');
    ap.disengage();
    assert.strictEqual(ap.annunciation(), '');
  });
});

describe('approachDeviation', () => {
  it('returns signed deviations against the stored course', () => {
    // Coastal 09L: threshold (-1350, 0), heading 90, 3° gs, elevation 39 ft.
    const dev = approachDeviation('coastal', { x: -4350, z: 300, altitudeFt: 555, tasKnots: 145 });
    assert.strictEqual(dev.courseDeg, 90);
    assert.ok(Math.abs(dev.distanceToThresholdM - 3000) < 1);
    assert.ok(dev.crossTrackM > 0, 'south (+z) is right of an eastbound course');
    assert.ok(Math.abs(dev.glideslopeErrorFt) < 2, `gs error ${dev.glideslopeErrorFt}`);
    assert.ok(Math.abs(dev.referenceSinkFpm + 768) < 20, `ref sink ${dev.referenceSinkFpm}`);
  });

  it('returns null for airports without approach data', () => {
    assert.strictEqual(approachDeviation('nowhere', { x: 0, z: 0, altitudeFt: 0 }), null);
  });
});
