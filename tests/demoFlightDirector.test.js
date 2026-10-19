import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

function createMockSimulator(activeAirport = 'lukla') {
  const virtualInputs = {};
  return {
    activeAirport,
    position: new THREE.Vector3(0, 2800, 0),
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
      setVirtualInput: (k, v) => { virtualInputs[k] = v; },
      clearVirtualInputs: () => {
        for (const k of Object.keys(virtualInputs)) delete virtualInputs[k];
      },
      getVirtualInput: (k) => virtualInputs[k]
    },
    engines: {
      setThrottle: () => {},
      setReverser: () => {}
    },
    gear: {
      setBrakes: () => {},
      setGearTarget: () => {}
    },
    aero: {
      spoilers: 0,
      setFlapPosition: () => {}
    },
    sky: {
      setTimeOfDay: () => {},
      getSunDirection: () => new THREE.Vector3(0, 1, 0)
    },
    water: {
      setSunDirection: () => {}
    },
    cameraSystem: {
      mode: CameraSystem.MODES.COCKPIT,
      setMode: function(m) { this.mode = m; },
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
    assert.strictEqual(director.activeDemoAirport, 'lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), 1.0);
    assert.strictEqual(sim.controls.getVirtualInput('brakes'), 0.0);
  });

  it('should transition through Lukla demo stages in sequence', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);

    // 1. Advance to Canyon Climb when reaching cliff / timer
    director.stageTimer = 9.0;
    sim.telemetry.iasKnots = 130;
    sim.telemetry.radioAltFt = 100;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CANYON_CLIMB);

    // 2. Advance to Himalayan Cruise
    director.stageTimer = 10.0;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE);

    // 3. Advance to Canyon Approach
    director.stageTimer = 9.5;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH);

    // 4. Advance to Uphill Touchdown
    // Position aircraft over Threshold 06: s >= -263.5m, onGround = true
    sim.position.set(-200 * 0.848048, 2810, 200 * 0.529919); // s ≈ -200m
    sim.telemetry.onGround = true;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.UPHILL_TOUCHDOWN);
    assert.strictEqual(sim.aero.spoilers, 1.0);
    assert.strictEqual(sim.controls.getVirtualInput('brakes'), 1.0);

    // 5. Complete rollout when stopped
    sim.telemetry.iasKnots = 2;
    director.stageTimer = 8.5;
    director.update(0.1);
    assert.strictEqual(director.isActive, false);
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
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), undefined);
  });

  it('should bind #btn-demo click and toggle active class', () => {
    const listeners = {};
    const classList = new Set();
    const mockBtn = {
      classList: {
        add: (cls) => classList.add(cls),
        remove: (cls) => classList.delete(cls),
        contains: (cls) => classList.has(cls)
      },
      addEventListener: (type, fn) => { listeners[type] = fn; }
    };

    globalThis.document = {
      getElementById: (id) => (id === 'btn-demo' ? mockBtn : null)
    };

    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);
    director.initUI();

    assert.strictEqual(director.demoBtn, mockBtn);
    assert.strictEqual(typeof listeners['click'], 'function');

    // Clicking btn-demo should start demo flight
    listeners['click']();
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(classList.has('active'), true);

    // Stopping demo flight should remove active class
    director.stop('Stopped');
    assert.strictEqual(director.isActive, false);
    assert.strictEqual(classList.has('active'), false);

    delete globalThis.document;
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
});

