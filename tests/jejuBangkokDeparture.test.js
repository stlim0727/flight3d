import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JejuBangkokDepartureScenario } from '../src/director/scenarios/JejuBangkokDepartureScenario.js';
import { BANGKOK_DEPARTURE_ATC, BANGKOK_CLEARANCE } from '../src/config/bangkokDepartureAtc.js';
import { DEPARTURE_GATE, DEPARTURE_LINEUP_ROUTE, DEPARTURE_RUNWAY, departurePushbackPose } from '../src/config/incheonDeparture.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { resolveDemoProfile } from '../src/director/demoProfiles.js';
import { INCHEON_AIRFIELD } from '../src/geospatial/IncheonFlightSurface.js';

const S = JejuBangkokDepartureScenario.STAGES;

function finishAtc(scenario) {
  while (scenario.atc?.busy) scenario.atc.update(100, false);
}

function fixture(withVoiceOverlay = false) {
  const inputs = {};
  let challengeShown = false;
  let challengeOptions = null;
  let onPassCallback = null;

  const sim = {
    position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scene: new THREE.Scene(),
    controls: {
      setVirtualInput: (k, v) => { inputs[k] = v; },
      setParkingBrake() {},
      clearVirtualInputs() {}
    },
    gear: {
      onGround: true,
      cgGroundHeightM: 3.5,
      setGearTarget() {},
      setBrakes() {}
    },
    engines: {
      thrust: [50000, 50000]
    },
    aero: {
      mass: 66000,
      invIzz: 1 / 4850000,
      Iyy: 3000000,
      wingArea: 125,
      meanChord: 3.8,
      CL0_clean: 0.25,
      CLa: 5.2,
      currentFlapAngle: 15,
      qDyn: 5000,
      alpha: 0.05,
      tas: 75,
      Cm0: 0.02,
      Cma: -0.8,
      Cmq: -15,
      Cm_de: -1.2,
      pitchTrim: 0,
      thrustPitchArmM: 0.5,
      setFlapPosition() {}
    },
    aircraft: { group: new THREE.Group() },
    currentAircraftId: 'B738',
    activeAirport: 'incheon',
    telemetry: {
      headingDeg: DEPARTURE_GATE.heading * 180 / Math.PI,
      iasKnots: 0,
      pitchDeg: 0,
      rollDeg: 0
    },
    setPreset() {},
    cameraSystem: {
      resetDroneOrbit() {},
      setMode() {}
    }
  };

  if (withVoiceOverlay) {
    sim.voiceChallengeOverlay = {
      show({ options, onPass }) {
        challengeShown = true;
        challengeOptions = options;
        onPassCallback = onPass;
      },
      hide() {
        challengeShown = false;
      }
    };
  }

  const director = {
    stageTimer: 0,
    totalTimer: 0,
    currentStage: S.GATE,
    stopped: false,
    stopMessage: null,
    setTimeOfDay() {},
    updateBanner() {},
    setStage(stage) {
      this.currentStage = stage;
      this.stageTimer = 0;
      scenario.enterStage(stage);
    },
    stop(messageFn) {
      this.stopped = true;
      this.stopMessage = typeof messageFn === 'function' ? messageFn() : messageFn;
      scenario.stop();
    }
  };

  const scenario = new JejuBangkokDepartureScenario(director, sim);
  director.setStage(S.GATE);

  return {
    sim,
    director,
    scenario,
    inputs,
    getChallengeShown: () => challengeShown,
    getChallengeOptions: () => challengeOptions,
    passChallenge: (matchedOpt) => onPassCallback?.(matchedOpt)
  };
}

test('jeju-bangkok-2503 demo profile is registered for B738 at Incheon', () => {
  const profile = resolveDemoProfile('B738', 'incheon', 'jeju-bangkok-2503');
  assert.equal(profile.id, 'jeju-bangkok-2503');
  assert.equal(profile.labelKey, 'departure.bangkok.name');
  assert.equal(profile.briefingKey, 'departure.bangkok.briefing');

  const d = new DemoFlightDirector({ currentAircraftId: 'B738', activeAirport: 'incheon' });
  d.profile = 'jeju-bangkok-2503';
  assert.equal(d.getActiveScenario(), d.jejuBangkokScenario);
});

test('JejuBangkokDepartureScenario initializes gate with authentic 5-stage Bangkok ATC plan', () => {
  const { scenario } = fixture();
  assert.ok(scenario.atc);
  // Verify gate lines contain Bangkok, SEL1N, FL190, 5102, Gate 32
  const gateText = scenario.result.radio.join(' ');
  assert.ok(gateText.includes('SEL1N'));
  assert.ok(gateText.includes('5102'));
  assert.ok(gateText.includes('Bangkok'));
  assert.ok(gateText.includes('Two-Five-Zero-Three'));
  assert.ok(gateText.includes('121.4'));
});

test('disconnect stage advances automatically to taxi in spectator mode when tug clears and radio completes', () => {
  const f = fixture(false);
  const { director, scenario, sim } = f;

  finishAtc(scenario);
  director.stageTimer = 7;
  scenario.update(0.1);
  assert.equal(director.currentStage, S.PUSHBACK);

  finishAtc(scenario);
  const end = departurePushbackPose(1);
  sim.position.x = end.x;
  sim.position.z = end.z;
  sim.quaternion.setFromEuler(new THREE.Euler(0, -end.heading, 0, 'YXZ'));
  scenario.update(0.6);
  scenario.update(0.6);
  assert.equal(director.currentStage, S.DISCONNECT);

  // Clear tug
  scenario.tug.userData.animation.clear = true;
  scenario.tug.userData.animation.distance = 26;
  finishAtc(scenario);

  scenario.update(0.1);
  assert.equal(director.currentStage, S.TAXI, 'automatically proceeds to taxi in spectator mode');
});

test('requesting manual control for Jeju Air 2503 triggers voice challenge overlay with 2503 callsign options', () => {
  const f = fixture(true);
  const { sim } = f;

  const realDirector = new DemoFlightDirector(sim);
  realDirector.start('incheon', 'jeju-bangkok-2503');

  let stopped = false;
  realDirector.stop = () => {
    stopped = true;
    realDirector.isActive = false;
  };

  realDirector.requestManualControl();
  assert.equal(f.getChallengeShown(), true);

  const options = f.getChallengeOptions();
  assert.equal(options.length, 2);
  assert.ok(options[0].phrases.some(p => p.includes('2503')));
  assert.ok(options[1].phrases.some(p => p.includes('autopilot') || p.includes('오토파일럿')));

  f.passChallenge(options[0]);
  assert.equal(stopped, true, 'hands over manual control upon passing voice challenge');
});

test('takeoff and climb stages execute tower handoff and heading 210 turn towards Bangkok', () => {
  const { sim, director, scenario, inputs } = fixture();

  director.setStage(S.TAKEOFF);
  assert.equal(director.currentStage, S.TAKEOFF);

  // Simulate rolling on ground
  sim.telemetry.iasKnots = 150;
  sim.gear.onGround = false;
  sim.position.y = INCHEON_AIRFIELD.elevationM + 150; // ~492 ft (> contactHeight 400ft)
  finishAtc(scenario);
  scenario.update(0.1);
  assert.equal(director.currentStage, S.DEPARTURE);

  // In departure, passing 2500 ft (762m agl) initiates heading 210 turn
  sim.position.y = INCHEON_AIRFIELD.elevationM + 800; // ~2624 ft
  scenario.update(0.1);
  // Aero controls active for climbing turn
  assert.equal(inputs.throttle, 1);
  assert.equal(inputs.brakes, 0);

  // Finish ATC and achieve altitude and heading
  finishAtc(scenario);
  sim.position.y = INCHEON_AIRFIELD.elevationM + 1000; // ~3280 ft (> handoffHeight 3000ft)
  sim.telemetry.headingDeg = 210; // Stabilized on heading 210
  scenario.update(0.1);
  assert.equal(director.currentStage, S.COMPLETED);
  assert.equal(director.stopped, true);
});
