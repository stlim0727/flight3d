import * as THREE from 'three';

/**
 * Realistic Flight Control System
 * Supports keyboard, mouse yoke, and on-screen UI with aerodynamic control stiffness,
 * progressive throttle, trim adjustments, and input damping.
 */
export class FlightControls {
  constructor(domElement) {
    this.domElement = domElement || document.body;

    // Control Inputs (-1.0 to 1.0 or 0.0 to 1.0)
    this.elevator = 0.0;    // Pitch: stick back = positive (climb)
    this.aileron = 0.0;     // Roll: stick right = positive
    this.rudder = 0.0;      // Yaw: right pedal = positive
    this.throttle = 0.0;    // 0.0 to 1.0
    this.pitchTrim = 2.0;   // Degrees
    this.pitchTrimRate = 0.0;
    this.brakes = 0.0;      // 0.0 to 1.0
    this.parkingBrake = false;
    this.mouseControl = false;

    // Virtual inputs for AI agent / Autopilot / Test harness
    this.virtualElevator = null;
    this.virtualAileron = null;
    this.virtualRudder = null;
    this.virtualBrakes = null;

    // Mobile / Touchscreen on-screen inputs
    this.touchElevator = 0.0;
    this.touchAileron = 0.0;
    this.touchRudder = 0.0;
    this.touchBrakes = 0.0;

    // Keys pressed state
    this.keys = {};

    // Set by the game-flow layer while lobby/pause menus are up.
    this.inputBlocked = false;

    // Mouse yoke tracking
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseSensitivity = 0.0018;

    // Event callbacks
    this.onToggleGear = null;
    this.onToggleSpoilers = null;
    this.onCycleFlaps = null;
    this.onToggleReverser = null;
    this.onCycleEngineFailure = null;
    this.onCycleCamera = null;
    this.onSelectCamera = null;
    this.onToggleLights = null;
    this.onCycleTimeOfDay = null;
    this.onToggleAudio = null;
    this.onResetPosition = null;

    this.initListeners();
  }

  initListeners() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('keyup', (e) => this.handleKeyUp(e));

    // Mouse yoke
    this.domElement.addEventListener('mousemove', (e) => {
      if (this.mouseControl) {
        const cx = window.innerWidth * 0.5;
        const cy = window.innerHeight * 0.5;
        this.mouseX = (e.clientX - cx) / cx;
        this.mouseY = (e.clientY - cy) / cy;
      }
    });

    this.domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // Left click to toggle mouse control or enable audio context
      }
    });
  }

  handleKeyDown(e) {
    if (e.target?.closest?.('select')) return;
    if (this.inputBlocked) return;
    const cameraDigit = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (cameraDigit || e.code === 'KeyC') {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey ||
          e.target?.isContentEditable || e.target?.closest?.('input, textarea, select')) return;
      if (cameraDigit) {
        if (this.onSelectCamera) this.onSelectCamera(Number(cameraDigit[1]) - 1);
      } else if (this.onCycleCamera) this.onCycleCamera();
      return;
    }
    this.keys[e.code] = true;

    // One-shot actions
    switch (e.code) {
      case 'KeyG':
        if (this.onToggleGear) this.onToggleGear();
        break;
      case 'KeyB':
        if (this.onToggleSpoilers) this.onToggleSpoilers();
        break;
      case 'KeyF':
        if (this.onCycleFlaps) this.onCycleFlaps(1); // Extend
        break;
      case 'KeyV':
        if (this.onCycleFlaps) this.onCycleFlaps(-1); // Retract
        break;
      case 'KeyR':
        if (this.onToggleReverser) this.onToggleReverser();
        break;
      case 'KeyP':
        // Cycle simulated engine failure; repeat-guarded so holding the key
        // does not spin through the cycle.
        if (!e.repeat && this.onCycleEngineFailure) this.onCycleEngineFailure();
        break;
      case 'KeyL':
        if (this.onToggleLights) this.onToggleLights();
        break;
      case 'BracketLeft':
        if (this.onCycleTimeOfDay) this.onCycleTimeOfDay(-1.5);
        break;
      case 'BracketRight':
        if (this.onCycleTimeOfDay) this.onCycleTimeOfDay(1.5);
        break;
      case 'KeyM':
        if (this.onToggleAudio) this.onToggleAudio();
        break;
      case 'KeyZ':
        this.throttle = 0.0; // Idle
        break;
      case 'KeyX':
        this.throttle = 1.0; // Full TOGA
        break;
    }
  }

  handleKeyUp(e) {
    this.keys[e.code] = false;
  }

  /** Drop all held-key state, e.g. when a menu takes over mid-input. */
  releaseAllKeys() {
    this.keys = {};
    this.pitchTrimRate = 0.0;
  }

  update(dt, iasKnots = 140) {
    // 1. Throttle input (Equal increases, Minus decreases)
    if (this.keys['Equal']) {
      this.throttle = Math.min(1.0, this.throttle + dt * 0.35);
    }
    if (this.keys['Minus']) {
      this.throttle = Math.max(0.0, this.throttle - dt * 0.35);
    }

    // 2. Pitch Control (W/S or Down/Up Arrow or Touch)
    // Positive elevator = pitch UP (pulling stick back / KeyS / ArrowDown / Touch Drag Down)
    let targetElevator = this.virtualElevator !== null ? this.virtualElevator : this.touchElevator;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      targetElevator += 1.0; // Pitch UP
    }
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      targetElevator -= 1.0; // Pitch DOWN
    }

    // 3. Roll Control (A/D or Left/Right Arrow or Touch)
    let targetAileron = this.virtualAileron !== null ? this.virtualAileron : this.touchAileron;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      targetAileron += 1.0; // Bank RIGHT
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      targetAileron -= 1.0; // Bank LEFT
    }

    // Mouse flight override
    if (this.mouseControl) {
      targetElevator = Math.max(-1.0, Math.min(1.0, this.mouseY * 1.5));
      targetAileron = Math.max(-1.0, Math.min(1.0, this.mouseX * 1.5));
    }

    // 4. Yaw Rudder Control (Q/E or Touch)
    let targetRudder = this.virtualRudder !== null ? this.virtualRudder : this.touchRudder;
    if (this.keys['KeyE']) {
      targetRudder += 1.0; // Yaw RIGHT
    }
    if (this.keys['KeyQ']) {
      targetRudder -= 1.0; // Yaw LEFT
    }

    // Dynamic pressure stiffness: At high airspeed, aerodynamic air resistance stiffens control columns
    const stiffness = Math.max(0.40, 1.0 - Math.max(0, (iasKnots - 140) / 220.0) * 0.55);
    targetElevator *= stiffness;
    targetAileron *= stiffness;
    targetRudder *= stiffness;

    // Heavy airliner actuator response & hydraulic control feel:
    // A 66-ton aircraft's control surfaces cannot snap instantaneously.
    // Realistic slew rate limits: Elevator ~0.55/s (2.0s for full travel), Aileron ~0.85/s, Rudder ~0.60/s
    const maxElevatorRate = 0.55; // units per second
    const maxAileronRate = 0.85;
    const maxRudderRate = 0.60;

    const elevDelta = targetElevator - this.elevator;
    const aileronDelta = targetAileron - this.aileron;
    const rudderDelta = targetRudder - this.rudder;

    this.elevator += Math.sign(elevDelta) * Math.min(Math.abs(elevDelta), maxElevatorRate * dt);
    this.aileron += Math.sign(aileronDelta) * Math.min(Math.abs(aileronDelta), maxAileronRate * dt);
    this.rudder += Math.sign(rudderDelta) * Math.min(Math.abs(rudderDelta), maxRudderRate * dt);

    // 5. Pitch Trim (T = Trim nose down, Y = Trim nose up)
    this.pitchTrimRate = 0.0;
    if (this.keys['KeyY']) {
      this.pitchTrim += dt * 1.5;
      this.pitchTrimRate = 1.0;
    }
    if (this.keys['KeyT']) {
      this.pitchTrim -= dt * 1.5;
      this.pitchTrimRate = -1.0;
    }
    // Auto-release parking brake when pilot applies substantial forward throttle (> 25%)
    if (this.parkingBrake && this.throttle > 0.25) {
      this.parkingBrake = false;
    }

    // 6. Wheel Brakes (Spacebar, Virtual/Touch Brakes, or Parking Brake)
    if (this.keys['Space']) {
      this.brakes = 1.0;
    } else if (this.virtualBrakes !== null && this.virtualBrakes !== undefined) {
      this.brakes = this.virtualBrakes;
    } else if (this.touchBrakes > 0) {
      this.brakes = this.touchBrakes;
    } else if (this.parkingBrake) {
      this.brakes = 1.0;
    } else {
      this.brakes = 0.0;
    }
  }

  setParkingBrake(enabled) {
    this.parkingBrake = Boolean(enabled);
    if (this.parkingBrake) {
      this.brakes = 1.0;
    }
  }

  setTouchStick(pitch, roll) {
    this.touchElevator = Math.max(-1.0, Math.min(1.0, pitch));
    this.touchAileron = Math.max(-1.0, Math.min(1.0, roll));
  }

  setTouchThrottle(val) {
    this.throttle = Math.max(0.0, Math.min(1.0, val));
  }

  setTouchRudder(rudder) {
    this.touchRudder = Math.max(-1.0, Math.min(1.0, rudder));
  }

  setTouchBrakes(brakes) {
    this.touchBrakes = Math.max(0.0, Math.min(1.0, brakes));
  }

  setVirtualInput(axis, val) {
    if (axis === 'elevator') this.virtualElevator = val;
    else if (axis === 'aileron') this.virtualAileron = val;
    else if (axis === 'rudder') this.virtualRudder = val;
    else if (axis === 'throttle') this.throttle = Math.max(0.0, Math.min(1.0, val));
    else if (axis === 'brakes') {
      this.virtualBrakes = val;
      this.brakes = Math.max(0.0, Math.min(1.0, val));
    }
  }

  clearVirtualInputs() {
    this.virtualElevator = null;
    this.virtualAileron = null;
    this.virtualRudder = null;
    this.virtualBrakes = null;
  }
}
