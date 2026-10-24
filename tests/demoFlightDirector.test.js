import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';

function createMockSimulator(activeAirport = 'lukla') {
  const virtualInputs = {};
  return {
    activeAirport,
    position: new THREE.Vector3(0, 2800, 0),
    linearVelocity: new THREE.Vector3(0, 0, 0),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    telemetry: {
      altitudeFt: 9300,
      radioAltFt: 0,
      iasKnots: 0,
      pitchDeg: -6.71,
      rollDeg: 0,
      headingDeg: 238,
      onGround: true,
      gearState: 1.0,
      isTransit: false
    },
    controls: {
      brakes: 0.0,
      parkingBrake: false,
      aircraftControlsDisabled: false,
      setAircraftControlsDisabled: function(v) { this.aircraftControlsDisabled = Boolean(v); },
      setParkingBrake: function(v) {
        this.parkingBrake = Boolean(v);
        if (this.parkingBrake) this.brakes = 1.0;
      },
      setVirtualInput: (k, v) => {
        // A control law that divides by an unstarted simulation state would fly
        // the demo with NaN surfaces, so every command has to be a real number.
        assert.ok(Number.isFinite(v), `virtual input ${k} is not finite`);
        virtualInputs[k] = v;
      },
      clearVirtualInputs: () => {
        for (const k of Object.keys(virtualInputs)) delete virtualInputs[k];
      },
      getVirtualInput: (k) => virtualInputs[k]
    },
    engines: new EngineModel(),
    gear: new LandingGear(),
    aero: new Aerodynamics(),
    sky: {
      setTimeOfDay: () => {},
      getSunDirection: () => new THREE.Vector3(0, 1, 0)
    },
    water: {
      setSunDirection: () => {}
    },
    cameraSystem: {
      mode: CameraSystem.MODES.COCKPIT,
      onCycleMode: null,
      setMode: function(m) { this.mode = m; },
      cycleMode: function() {
        this.mode = (this.mode + 1) % 7;
        if (this.onCycleMode) this.onCycleMode(this.mode);
        return 'MODE_' + this.mode;
      },
      resetDroneOrbit: () => {},
      lookPitch: 0,
      lookYaw: 0
    },
    setAirport: function(id) { this.activeAirport = id; },
    setPreset: () => {},
    showToast: () => {}
  };
}

describe('DemoFlightDirector (Nepal Lukla & Coastal Autonomous Demos)', () => {
  it('should initialize with Idle stage and Lukla as default demo airport', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    assert.strictEqual(director.isActive, false);
    assert.strictEqual(director.currentStage, -1);
    assert.strictEqual(director.activeDemoAirport, 'lukla');
  });

  it('should start Lukla demo flight at CLIFF_TAKEOFF when Lukla is active', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start();
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(sim.controls.aircraftControlsDisabled, true);
    assert.strictEqual(director.activeDemoAirport, 'lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), 1.0);
    assert.strictEqual(sim.controls.getVirtualInput('brakes'), 0.0);
  });

  it('does not infer Lukla takeoff from elapsed time or radio altitude while grounded', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);
    director.start('lukla');
    director.stageTimer = 60;
    sim.telemetry.iasKnots = 130;
    sim.telemetry.radioAltFt = 100;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
  });

  it('should support Coastal demo flight when coastal airport is explicitly targeted', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(director.activeDemoAirport, 'coastal');
    assert.strictEqual(director.currentStage, DemoFlightDirector.COASTAL_STAGES.PREFLIGHT_ORBIT);
  });

  it('should cleanly stop demo and clear virtual control inputs', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), 1.0);

    director.stop('Test Stop');
    assert.strictEqual(director.isActive, false);
    assert.strictEqual(sim.controls.aircraftControlsDisabled, false);
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), undefined);
    assert.strictEqual(sim.controls.brakes, 0.0);
    assert.strictEqual(sim.gear.brakes, 0.0);
  });

  it('should engage and retain parking brake when stop is called with keepParkingBrake=true', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    director.stop('Runway rollout complete', true);

    assert.strictEqual(director.isActive, false);
    assert.strictEqual(sim.controls.parkingBrake, true);
    assert.strictEqual(sim.controls.brakes, 1.0);
    assert.strictEqual(sim.gear.brakes, 1.0);
  });

  it('should trigger demo flight with P keyboard shortcut', () => {
    const windowListeners = {};
    globalThis.window = {
      addEventListener: (type, fn) => { windowListeners[type] = fn; }
    };
    globalThis.document = {
      getElementById: () => null
    };

    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);
    director.initUI();

    assert.strictEqual(typeof windowListeners['keydown'], 'function');

    // Pressing 'p' starts demo
    windowListeners['keydown']({
      key: 'p',
      target: { matches: () => false }
    });
    assert.strictEqual(director.isActive, true);

    // Pressing Escape stops demo
    windowListeners['keydown']({
      key: 'Escape',
      target: { matches: () => false }
    });
    assert.strictEqual(director.isActive, false);

    // Pressing 'P' starts demo
    windowListeners['keydown']({
      key: 'P',
      target: { matches: () => false }
    });
    assert.strictEqual(director.isActive, true);

    delete globalThis.window;
    delete globalThis.document;
  });

  it('should allow user to cycle camera during ROTATION_CLIMB without mid-stage cut reverting user choice', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    director.setStage(DemoFlightDirector.COASTAL_STAGES.ROTATION_CLIMB);
    sim.cameraSystem.mode = CameraSystem.MODES.COCKPIT;

    // Simulate flight progressing past 6.0s (the mid-stage cut time)
    director.stageTimer = 7.0;

    // User cycles camera to WING (2)
    sim.cameraSystem.cycleMode();
    sim.cameraSystem.cycleMode();
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING);
    assert.strictEqual(director.userCameraOverridden, true);

    // Multi-frame update should NOT revert camera mode to CHASE
    for (let i = 0; i < 10; i++) {
      director.update(0.016);
    }
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING, 'Camera mode must remain WING and not be forced to CHASE');
  });

  it('should perform scheduled mid-stage camera cut once when user has not changed camera', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    sim.telemetry.altitudeFt = 150;
    director.setStage(DemoFlightDirector.COASTAL_STAGES.ROTATION_CLIMB);
    sim.cameraSystem.mode = CameraSystem.MODES.COCKPIT;

    // Before 6.0s, mode remains COCKPIT
    director.stageTimer = 5.0;
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.COCKPIT);

    // Reaching 6.0s triggers scheduled one-shot cut to CHASE
    director.stageTimer = 6.1;
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.CHASE);

    // Subsequent updates do not re-run cut
    director.stageTimer = 8.0;
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.CHASE);

    // User can now change camera at 8.0s and it sticks
    sim.cameraSystem.cycleMode(); // to WING
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING);
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING);
  });

  it('should allow user to cycle camera in Lukla demo flight without being overridden in cliff takeoff or climb', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);

    // Advance past 4.5s
    director.stageTimer = 5.0;

    // User cycles camera to FLYBY (4)
    sim.cameraSystem.mode = CameraSystem.MODES.FLYBY;
    director.onUserCameraChange();

    for (let i = 0; i < 5; i++) {
      director.update(0.016);
    }
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.FLYBY, 'Camera mode must stay FLYBY during cliff takeoff');
  });

  it('keeps a manually cycled view when the next demo stage begins', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    director.setStage(DemoFlightDirector.COASTAL_STAGES.ROTATION_CLIMB);

    sim.cameraSystem = new CameraSystem(new THREE.PerspectiveCamera(), null);
    sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
    // User overrides camera in rotation climb
    sim.cameraSystem.cycleMode();
    director.onUserCameraChange();
    assert.strictEqual(director.userCameraOverridden, true);

    // Transition to next stage (COASTAL_BANK)
    director.setStage(DemoFlightDirector.COASTAL_STAGES.COASTAL_BANK);
    assert.strictEqual(director.userCameraOverridden, false, 'userCameraOverridden should be reset on entering new stage');
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.CHASE, 'Should preserve the manually selected view');
  });
});


for (const airport of ['coastal', 'lukla']) {
  it(`preserves user time through camera changes, stages and demo restart (${airport})`, () => {
    const sim = createMockSimulator(airport);
    sim.sky.setTimeOfDay = function(hours) { this.timeOfDay = hours; };
    const director = new DemoFlightDirector(sim);
    director.start();
    assert.strictEqual(sim.sky.timeOfDay, airport === 'coastal' ? 6.5 : 8.5);
    director.onUserTimeOfDayChange();
    sim.sky.setTimeOfDay(22.5);
    sim.cameraSystem.cycleMode();
    const stages = airport === 'coastal'
      ? [DemoFlightDirector.COASTAL_STAGES.TAKEOFF_ROLL,
         DemoFlightDirector.COASTAL_STAGES.COASTAL_BANK,
         DemoFlightDirector.COASTAL_STAGES.FINAL_APPROACH]
      : [DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE,
         DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH];
    for (const stage of stages) {
      director.setStage(stage);
      // Coastal lighting also advances every frame; Lukla sets time on entry.
      if (airport === 'coastal') director.update(0.1);
      assert.strictEqual(sim.sky.timeOfDay, 22.5);
    }
    director.stop();
    director.start();
    assert.strictEqual(sim.sky.timeOfDay, 22.5);
  });
}

describe('Airborne demo handoff', () => {
  it('preserves climb throttle while releasing virtual controls at completion', () => {
    const sim = createMockSimulator('coastal');
    sim.controls.throttle = .92;
    let engineThrottle;
    sim.engines.setThrottle = value => {engineThrottle=value;};
    sim.controls.setVirtualInput('elevator', .2);
    const director = new DemoFlightDirector(sim);
    director.isActive = true;
    director.stop('Completed', false, { preserveThrottle: true });
    assert.equal(director.isActive,false);
    assert.equal(sim.controls.throttle,.92);
    assert.equal(engineThrottle,.92);
    assert.equal(sim.controls.getVirtualInput('elevator'),undefined);
    assert.equal(sim.controls.parkingBrake,false);
    // Ordinary stops retain the existing idle-throttle behavior.
    director.isActive=true;
    director.stop();
    assert.equal(sim.controls.throttle,0);
    assert.equal(engineThrottle,0);
  });

  it('hands a rolling airframe over with its wheel brakes still held', () => {
    const rolling = createMockSimulator('coastal');
    rolling.gear.onGround = true;
    rolling.telemetry.groundSpeedKnots = 95;
    const director = new DemoFlightDirector(rolling);
    director.isActive = true;
    director.stop();
    assert.equal(rolling.controls.parkingBrake, true);
    assert.equal(rolling.controls.brakes, 1);
    assert.equal(rolling.gear.brakes, 1);

    for (const [label, patch] of [
      ['stopped on the runway', { onGround: true, groundSpeedKnots: 0.2 }],
      ['airborne', { onGround: false, groundSpeedKnots: 140 }],
    ]) {
      const sim = createMockSimulator('coastal');
      sim.gear.onGround = patch.onGround;
      sim.telemetry.groundSpeedKnots = patch.groundSpeedKnots;
      const handedOff = new DemoFlightDirector(sim);
      handedOff.isActive = true;
      handedOff.stop();
      assert.equal(sim.controls.parkingBrake, false, `brakes release when handing off ${label}`);
      assert.equal(sim.gear.brakes, 0);
    }
  });
});

// Exercise each production stop path, keeping the notification alive across
// both locale changes instead of rendering it only at stop time.
describe('localized demo stop notifications', () => {
  const cases = [
    ['manual button', 'manual.control.engaged', (director, sim, handlers) => handlers.click()],
    ['Escape key', 'manual.control.engaged', (director, sim, handlers) => handlers.keydown({ key: 'Escape' })],
    ['terrain loading failure', 'could.not.load.lukla.terrain.refresh.and', (director, sim) => {
      director.waitingForTerrain = true;
      sim.currentTerrain = { loadError: 'failed' };
      director.update(0.1);
    }],
    ['terrain not ready', 'load.lukla.terrain.data.before.restarting.the', (director, sim) => {
      sim.currentTerrain = { isLoaded: false };
      director.luklaScenario.enterStage(DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
    }],
    ['aircraft damage', 'lukla.demo.failed.aircraft.damage', (director, sim) => {
      sim.isCrashed = true;
      director.luklaScenario.update(0.1);
    }],
    ['Lukla completion', 'lukla.demo.complete.enjoy.your.flight', director => {
      director.setStage(DemoFlightDirector.LUKLA_STAGES.COMPLETED);
    }],
    ['coastal completion', 'demo.flight.complete.enjoy.your.flight', director => {
      director.start('coastal');
      director.setStage(DemoFlightDirector.COASTAL_STAGES.COMPLETED);
    }],
  ];

  for (const [name, key, stopDemo] of cases) {
    it(`${name} toast updates in place when language changes after stopping`, async () => {
      const { setLanguage, t, bindText } = await import('../src/i18n/index.js');
      const storage = { setItem() {} };
      const toast = { isConnected: true, textContent: '' };
      const sim = createMockSimulator();
      sim.showToast = render => {
        assert.strictEqual(typeof render, 'function', 'localized toast must retain its renderer');
        bindText(toast, render);
      };
      const director = new DemoFlightDirector(sim);
      const handlers = {};
      const originalWindow = globalThis.window;
      const originalDocument = globalThis.document;
      setLanguage('ko', storage);
      try {
        globalThis.window = { addEventListener: (type, listener) => { handlers[type] = listener; } };
        globalThis.document = {
          getElementById: id => id === 'btn-skip-demo'
            ? { addEventListener: (type, listener) => { handlers[type] = listener; } }
            : null,
        };
        director.initUI();
      } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
      }
      try {
        director.start('lukla');
        stopDemo(director, sim, handlers);
        assert.strictEqual(director.isActive, false);
        assert.strictEqual(toast.textContent, t(key));
        const korean = toast.textContent;
        setLanguage('en', storage);
        assert.strictEqual(toast.textContent, t(key));
        assert.notStrictEqual(toast.textContent, korean);
        setLanguage('ko', storage);
        assert.strictEqual(toast.textContent, korean);
        assert.strictEqual(director.isActive, false);
      } finally {
        toast.isConnected = false;
        setLanguage('ko', storage);
      }
    });
  }
});

for (const airport of ['coastal', 'lukla']) {
  it(`preserves explicit camera choices across demo stages and restart (${airport})`, () => {
    const sim = createMockSimulator(airport);
    sim.cameraSystem = new CameraSystem(new THREE.PerspectiveCamera(), null);
    const director = new DemoFlightDirector(sim);
    director.start(airport);
    sim.cameraSystem.setMode(CameraSystem.MODES.TOWER, true);
    director.onUserCameraChange();
    const stages = airport === 'coastal' ? DemoFlightDirector.COASTAL_STAGES : DemoFlightDirector.LUKLA_STAGES;
    for (const stage of Object.values(stages).filter(value => value >= 0 && value < stages.COMPLETED)) {
      director.setStage(stage);
      assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.TOWER);
      sim.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 5);
      assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.TOWER);
    }
    director.stop();
    director.start(airport);
    assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.TOWER);
    sim.cameraSystem.setMode(CameraSystem.MODES.AUTO, true);
    director.onUserCameraChange();
    assert.equal(director.userCameraOverridden, false);
    director.setStage(stages.FINAL_APPROACH);
    assert.equal(sim.cameraSystem.autoSwitch, true);
    director.stop();
  });
}
