import { FlightControlLaws } from './FlightControlLaws.js';
import { HotasController } from './HotasController.js';

/**
 * Realistic Flight Control System
 * Supports keyboard, mouse yoke, HOTAS / joystick (T.Flight Hotas One), and on-screen UI with aerodynamic control stiffness,
 * progressive throttle, trim adjustments, and input damping.
 */
export class FlightControls extends FlightControlLaws {
  constructor(domElement, options = {}) {
    super();
    this.domElement = domElement || (typeof document !== 'undefined' ? document.body : null);

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
    this.onHatLook = null;
    this.onToggleLights = null;
    this.onCycleTimeOfDay = null;
    this.onToggleAudio = null;
    this.onToggleParkingBrake = null;
    this.onResetPosition = null;
    this.onUserInteract = null;
    this.onDeviceConnected = null;
    this.onDeviceDisconnected = null;
    this.onFireMissile = null;
    // Reserved callbacks: player countermeasures are not implemented yet.
    this.onDispenseChaff = null;
    this.onDispenseFlare = null;
    this.onCycleTarget = null;
    this.touchGunTrigger = false;

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
        this.onUserInteract?.();
      }
    });
    this.domElement.addEventListener('pointerup', () => {
      this.onUserInteract?.();
    });
  }

  handleKeyDown(e) {
    this.onUserInteract?.();
    if (e.target?.closest?.('select, .cockpit-pov-panel')) return;
    if (this.inputBlocked) return;
    const cameraDigit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    if (cameraDigit || e.code === 'KeyC') {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey ||
          e.target?.isContentEditable || e.target?.closest?.('input, textarea, select')) return;
      if (cameraDigit) {
        const val = Number(cameraDigit[1]);
        // Zero is the tenth mode: BANDIT_POV, the bandit's own cockpit view (#722).
        if (this.onSelectCamera) this.onSelectCamera(val === 0 ? 10 : val - 1);
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
      case 'Enter':
        // Fire remains separate from Space so the brake key keeps one meaning.
        if (!e.repeat && !e.target?.closest?.('button, a, input, textarea, select') && this.onFireMissile) {
          this.onFireMissile();
        }
        break;
      case 'KeyN':
        if (!e.repeat && this.onCycleTarget) this.onCycleTarget();
        break;
      case 'KeyK':
        // Cycle simulated engine failure. Deliberately not P: the demo director
        // restarts the demo on P, which would reload the preset and clear the
        // failure just injected. Repeat-guarded so holding the key cannot spin
        // through the cycle.
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
      case 'Period':
        if (this.onToggleParkingBrake) this.onToggleParkingBrake();
        else this.setParkingBrake(!this.parkingBrake);
        break;
    }
  }

  handleKeyUp(e) {
    this.keys[e.code] = false;
  }

  /** Drop all held-key state, e.g. when a menu takes over mid-input. */
  releaseAllKeys() {
    this.keys = {};
    this.touchGunTrigger = false;
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

  /** Hold-to-fire gun trigger; touch buttons set it directly. */
  setGunTrigger(pressed) {
    this.touchGunTrigger = Boolean(pressed);
  }

  /** Space is the airborne gun trigger and the ground wheel-brake key. The
   * combat system only consumes it while the aircraft is airborne. */
  get gunTrigger() {
    return !this.inputBlocked && !this.aircraftControlsDisabled
      && (Boolean(this.keys['Space']) || this.touchGunTrigger || this.hotas?.gunTrigger);
  }

  update(dt, iasKnots = 140, aircraftId = 'B738') {
    if (this.hotas) {
      this.hotas.update(dt);
      // Diagnostic mode reports live axes for the joystick check dialog; the
      // aircraft must not consume them while flight input is blocked or disabled.
      const hotasLive = !this.inputBlocked && !this.aircraftControlsDisabled;
      this.hotasElevator = hotasLive ? this.hotas.elevator : 0.0;
      this.hotasAileron = hotasLive ? this.hotas.aileron : 0.0;
      this.hotasRudder = hotasLive ? this.hotas.rudder : 0.0;
      this.hotasBrakes = hotasLive ? this.hotas.brakes : 0.0;
    }

    return this.updateSources(dt, iasKnots, aircraftId);
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
