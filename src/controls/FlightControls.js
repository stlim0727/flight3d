import * as THREE from 'three';
import { HotasController } from './HotasController.js';

/**
 * Realistic Flight Control System
 * Supports keyboard, mouse yoke, HOTAS / joystick (T.Flight Hotas One), and on-screen UI with aerodynamic control stiffness,
 * progressive throttle, trim adjustments, and input damping.
 */
export class FlightControls {
  constructor(domElement, options = {}) {
    this.domElement = domElement || (typeof document !== 'undefined' ? document.body : null);

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
    this.touchPitchReturning = false;
    this.touchRollReturning = false;
    this.touchRudder = 0.0;
    this.touchBrakes = 0.0;

    // HOTAS / Gamepad inputs
    this.hotasElevator = 0.0;
    this.hotasAileron = 0.0;
    this.hotasRudder = 0.0;
    this.hotasBrakes = 0.0;
    this.hotas = new HotasController(this, options);

    // Keys pressed state
    this.keys = {};

    // Set by the game-flow layer while lobby/pause menus are up.
    this.inputBlocked = false;

    // Set during autonomous demo flight: airplane flight controls are disabled,
    // while non-flight interactions (camera views, lights, time, audio) remain enabled.
    this.aircraftControlsDisabled = false;

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
    this.onResetLook = null;
    this.onToggleLights = null;
    this.onCycleTimeOfDay = null;
    this.onToggleAudio = null;
    this.onResetPosition = null;
    this.onUserInteract = null;
    this.onDeviceConnected = null;
    this.onDeviceDisconnected = null;

    this.hotas.onDeviceConnected = (info) => this.onDeviceConnected?.(info);
    this.hotas.onDeviceDisconnected = (info) => this.onDeviceDisconnected?.(info);

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
    const cameraDigit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (cameraDigit || e.code === 'KeyC') {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey ||
          e.target?.isContentEditable || e.target?.closest?.('input, textarea, select')) return;
      if (cameraDigit) {
        if (this.onSelectCamera) this.onSelectCamera(Number(cameraDigit[1]) - 1);
      } else if (this.onCycleCamera) this.onCycleCamera();
      return;
    }

    if (this.aircraftControlsDisabled) {
      switch (e.code) {
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
      }
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
      case 'KeyK':
        // Cycle simulated engine failure. Deliberately not P: the demo director
        // restarts the demo on P, which would reload the preset and clear the
        // failure just injected. Repeat-guarded so holding the key cannot spin
        // through the cycle.
        if (!e.repeat && this.onCycleEngineFailure) this.onCycleEngineFailure();
        break;
      case 'Period':
        // Parking brake toggle (P is taken by the demo restart). Repeat-guarded
        // so holding the key cannot flicker the brake.
        if (!e.repeat) this.setParkingBrake(!this.parkingBrake);
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
    if (this.hotas) {
      this.hotas.resetOutputs();
      this.hotasElevator = 0.0;
      this.hotasAileron = 0.0;
      this.hotasRudder = 0.0;
      this.hotasBrakes = 0.0;
    }
  }

  setAircraftControlsDisabled(disabled) {
    this.aircraftControlsDisabled = Boolean(disabled);
    if (this.aircraftControlsDisabled) {
      this.releaseAllKeys();
      this.setTouchStick(0.0, 0.0);
      this.setTouchRudder(0.0);
      this.setTouchBrakes(0.0);
    }
  }

  update(dt, iasKnots = 140) {
    if (this.hotas) {
      this.hotas.update(dt);
      this.hotasElevator = this.hotas.elevator;
      this.hotasAileron = this.hotas.aileron;
      this.hotasRudder = this.hotas.rudder;
      this.hotasBrakes = this.hotas.brakes;
    }

    if (this.aircraftControlsDisabled) {
      // In autonomous demo mode, user inputs are disabled.
      // Slew control surfaces purely towards virtual commands.
      let targetElevator = this.virtualElevator !== null ? this.virtualElevator : 0.0;
      let targetAileron = this.virtualAileron !== null ? this.virtualAileron : 0.0;
      let targetRudder = this.virtualRudder !== null ? this.virtualRudder : 0.0;

      const stiffness = Math.max(0.40, 1.0 - Math.max(0, (iasKnots - 140) / 220.0) * 0.55);
      targetElevator *= stiffness;
      targetAileron *= stiffness;
      targetRudder *= stiffness;

      const maxElevatorRate = 0.55;
      const maxAileronRate = 0.85;
      const maxRudderRate = 0.60;

      const elevDelta = targetElevator - this.elevator;
      const aileronDelta = targetAileron - this.aileron;
      const rudderDelta = targetRudder - this.rudder;

      this.elevator += Math.sign(elevDelta) * Math.min(Math.abs(elevDelta), maxElevatorRate * dt);
      this.aileron += Math.sign(aileronDelta) * Math.min(Math.abs(aileronDelta), maxAileronRate * dt);
      this.rudder += Math.sign(rudderDelta) * Math.min(Math.abs(rudderDelta), maxRudderRate * dt);

      this.pitchTrimRate = 0.0;
      if (this.virtualBrakes !== null && this.virtualBrakes !== undefined) {
        this.brakes = this.virtualBrakes;
      } else if (this.parkingBrake) {
        this.brakes = 1.0;
      } else {
        this.brakes = 0.0;
      }
      return;
    }

    // 1. Throttle input (Equal increases, Minus decreases)
    if (this.keys['Equal']) {
      this.throttle = Math.min(1.0, this.throttle + dt * 0.35);
    }
    if (this.keys['Minus']) {
      this.throttle = Math.max(0.0, this.throttle - dt * 0.35);
    }

    // 2. Pitch Control (W/S or Down/Up Arrow or Touch or HOTAS)
    // Positive elevator = pitch UP (pulling stick back / KeyS / ArrowDown / Touch Drag Down / HOTAS Stick Back)
    let targetElevator = this.virtualElevator !== null
      ? this.virtualElevator
      : (this.touchElevator + this.hotasElevator);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      targetElevator += 1.0; // Pitch UP
    }
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      targetElevator -= 1.0; // Pitch DOWN
    }
    targetElevator = Math.max(-1.0, Math.min(1.0, targetElevator));

    // 3. Roll Control (A/D or Left/Right Arrow or Touch or HOTAS)
    let targetAileron = this.virtualAileron !== null
      ? this.virtualAileron
      : (this.touchAileron + this.hotasAileron);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      targetAileron += 1.0; // Bank RIGHT
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      targetAileron -= 1.0; // Bank LEFT
    }
    targetAileron = Math.max(-1.0, Math.min(1.0, targetAileron));

    // Mouse flight override
    if (this.mouseControl) {
      targetElevator = Math.max(-1.0, Math.min(1.0, this.mouseY * 1.5));
      targetAileron = Math.max(-1.0, Math.min(1.0, this.mouseX * 1.5));
    }

    // 4. Yaw Rudder Control (Q/E or Touch or HOTAS)
    let targetRudder = this.virtualRudder !== null
      ? this.virtualRudder
      : (this.touchRudder + this.hotasRudder);
    if (this.keys['KeyE']) {
      targetRudder += 1.0; // Yaw RIGHT
    }
    if (this.keys['KeyQ']) {
      targetRudder -= 1.0; // Yaw LEFT
    }
    targetRudder = Math.max(-1.0, Math.min(1.0, targetRudder));

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

    // A released thumb stick must not keep commanding a turn for over a second.
    // Only speed up its return to neutral; keyboard/mouse/AI keep their own slew.
    if (targetElevator !== 0 || this.virtualElevator !== null || this.mouseControl ||
        this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.touchPitchReturning = false;
    }
    if (targetAileron !== 0 || this.virtualAileron !== null || this.mouseControl ||
        this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.touchRollReturning = false;
    }
    const elevatorRate = this.touchPitchReturning ? 4.0 : maxElevatorRate;
    const aileronRate = this.touchRollReturning ? 4.0 : maxAileronRate;
    this.elevator += Math.sign(elevDelta) * Math.min(Math.abs(elevDelta), elevatorRate * dt);
    this.aileron += Math.sign(aileronDelta) * Math.min(Math.abs(aileronDelta), aileronRate * dt);
    if (this.elevator === 0) this.touchPitchReturning = false;
    if (this.aileron === 0) this.touchRollReturning = false;
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

    // 6. Wheel Brakes (Spacebar, Virtual/Touch Brakes, HOTAS Trigger, or Parking Brake)
    if (this.keys['Space']) {
      this.brakes = 1.0;
    } else if (this.virtualBrakes !== null && this.virtualBrakes !== undefined) {
      this.brakes = this.virtualBrakes;
    } else if (this.touchBrakes > 0) {
      this.brakes = this.touchBrakes;
    } else if (this.hotasBrakes > 0) {
      this.brakes = this.hotasBrakes;
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
    if (this.touchElevator !== 0 && pitch === 0) this.touchPitchReturning = true;
    if (this.touchAileron !== 0 && roll === 0) this.touchRollReturning = true;
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
