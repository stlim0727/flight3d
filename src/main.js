import { t, bindText, initLocalization } from './i18n/index.js';
import * as THREE from 'three';
import { cockpitCasterState } from './aircraft/CockpitLighting.js';
import { CockpitOcclusion } from './aircraft/CockpitOcclusion.js';
import { prepareCockpitShadowDepth } from './aircraft/CockpitDepth.js';
import { Atmosphere } from './physics/Atmosphere.js';
import { BOEING_737_800 } from './config/aircraftConfigs.js';
import { Aerodynamics } from './physics/Aerodynamics.js';
import { EngineModel, asymmetricThrustYawMoment } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { AutopilotController } from './physics/Autopilot.js';
import { solveTrim } from './physics/TrimSolver.js';
import { PFDCanvas } from './aircraft/PFDCanvas.js';
import { NDCanvas } from './aircraft/NDCanvas.js';
import { EICASCanvas } from './aircraft/EICASCanvas.js';
import { MCPCanvas } from './aircraft/MCPCanvas.js';
import { ISFDCanvas } from './aircraft/ISFDCanvas.js';
import { CDUCanvas } from './aircraft/CDUCanvas.js';
import { Boeing737 } from './aircraft/Boeing737.js';
import { Terrain } from './environment/Terrain.js';
import { RENDER_QUALITY, RENDER_QUALITY_KEY, resolveRenderQuality } from './config/renderQuality.js';
import { WaterOcean } from './environment/WaterOcean.js';
import { Airport } from './environment/Airport.js';
import { FoliageAndCities } from './environment/FoliageAndCities.js';
import { Ships } from './environment/Ships.js';
import { SkyAtmosphere } from './environment/SkyAtmosphere.js';
import { LuklaTerrain } from './environment/LuklaTerrain.js';
import { LuklaAirport } from './environment/LuklaAirport.js';
import { FlightAudio } from './audio/FlightAudio.js';
import { FlightControls } from './controls/FlightControls.js';
import { CameraSystem } from './cameras/CameraSystem.js';
import { RenderPose } from './core/RenderPose.js';
import { DiagnosticsInspector } from './ui/DiagnosticsInspector.js';
import { DemoFlightDirector } from './director/DemoFlightDirector.js';
import { CollisionDetector } from './physics/CollisionDetector.js';
import { ExplosionSystem } from './effects/ExplosionSystem.js';
import { TireSmokeSystem } from './effects/TireSmokeSystem.js';
import { initFlightPanels, updateControlState, touchLabel } from './ui/FlightPanels.js';
import { GameFlowController, FLOW } from './ui/GameFlowController.js';
import { initLobbyScreen } from './ui/LobbyScreen.js';
import {
  DEFAULT_SCENARIO,
  isScenarioAvailable,
} from './config/scenarioRegistry.js';
import { TouchFlightControls } from './controls/TouchFlightControls.js';
import { CockpitPhotoOverlay } from './aircraft/CockpitPhotoOverlay.js';

// Expose THREE globally for test harness and browser console debugging
if (typeof window !== 'undefined') {
  window.THREE = THREE;
}

initLocalization();

/**
 * Main Simulation Coordinator
 * Integrates 6-DOF rigid body physics, aircraft systems, procedural world, audio, and user interface.
 */
class FlightSimulator {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // 1. Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    // near: 0.08m and far: 45,000m combined with logarithmicDepthBuffer completely eliminates pillar clipping & Z-fighting
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 45000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    let savedQuality;
    try { savedQuality = localStorage.getItem(RENDER_QUALITY_KEY); } catch { /* Use default. */ }
    this.renderQuality = resolveRenderQuality(savedQuality);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER_QUALITY[this.renderQuality].maxDpr));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 2. Flight Instruments (Glass Cockpit Canvas Displays)
    this.pfdCanvas = new PFDCanvas(512, 512);
    this.ndCanvas = new NDCanvas(512, 512);
    this.eicasCanvas = new EICASCanvas(512, 512);
    this.mcpCanvas = new MCPCanvas(1024, 128);
    this.isfdCanvas = new ISFDCanvas(256, 256);
    this.cduCanvas = new CDUCanvas(512, 512);

    // 3. Boeing 737 Aircraft 3D Model
    this.aircraft = new Boeing737(
      this.pfdCanvas,
      this.ndCanvas,
      this.eicasCanvas,
      this.mcpCanvas,
      this.isfdCanvas,
      this.cduCanvas
    );
    this.scene.add(this.aircraft.group);
    this.cockpitOcclusion = new CockpitOcclusion(this.scene, this.camera, this.aircraft.cockpit);
    this.aircraft.cockpit.onModelReady = () => {
      const cockpit = this.aircraft.cockpit;
      const visible = cockpit.group.visible;
      // Include cabin lights even if the user is currently in an exterior view.
      // compileAsync gathers lights synchronously, then polls program readiness.
      cockpit.group.visible = true;
      try {
        cockpit.shaderWarmup = this.renderer.compileAsync(
          cockpit.gltfCockpitGroup, this.camera, this.scene
        ).catch(error => console.warn('Cockpit shader warmup failed:', error));
      } finally {
        cockpit.group.visible = visible;
      }
    };

    // 3b. Boeing 737 2D Real-Photo Cockpit Overlay
    this.cockpitPhotoOverlay = new CockpitPhotoOverlay(
      this.pfdCanvas,
      this.ndCanvas,
      this.eicasCanvas,
      this.isfdCanvas
    );
    if (typeof window !== 'undefined') {
      this.cockpitPhotoOverlay.onResize(window.innerWidth, window.innerHeight);
    }

    // 4. Physics Engines
    this.aero = new Aerodynamics();
    this.engines = new EngineModel();
    this.gear = new LandingGear();

    // 5. Procedural World & Real-World Environments
    this.terrain = new Terrain(22000, 256, { quality: RENDER_QUALITY[this.renderQuality].terrain });
    this.scene.add(this.terrain.mesh);

    this.water = new WaterOcean(36000);
    this.scene.add(this.water.mesh);

    this.airport = new Airport();
    this.scene.add(this.airport.group);

    this.foliage = new FoliageAndCities(this.terrain);
    this.scene.add(this.foliage.group);

    this.ships = new Ships(this.water);
    this.scene.add(this.ships.group);

    // Nepal Tenzing-Hillary (Lukla VNLK) Real-World 30m DEM Terrain & Airport
    this.luklaTerrain = new LuklaTerrain(22000, 255);
    this.luklaTerrain.mesh.visible = false;
    this.scene.add(this.luklaTerrain.mesh);

    this.luklaAirport = new LuklaAirport();
    this.luklaAirport.group.visible = false;
    this.scene.add(this.luklaAirport.group);

    this.activeAirport = 'lukla'; // 'coastal' | 'lukla'; initControls flips to coastal below
    this.currentTerrain = this.terrain;
    this.currentAirport = this.airport;

    this.sky = new SkyAtmosphere(this.scene, this.renderer, this.water);
    this.foliage.setTimeOfDay(this.sky.timeOfDay);
    this.water.syncWithAtmosphere(this.sky);

    // 6. Audio & Controls & Camera & Diagnostics
    this.audio = new FlightAudio();
    this.controls = new FlightControls(this.renderer.domElement);
    this.touchControls = new TouchFlightControls(this.controls);
    initFlightPanels({ onCycleCamera: () => this.controls.onCycleCamera() });
    this.cameraSystem = new CameraSystem(this.camera, this.renderer.domElement);
    this.cameraSystem.setTerrain(this.terrain);
    this.cameraSystem.onResetLook = () => {
      this.showToast(() => t('camera.view.centered'));
    };
    this.diagnostics = new DiagnosticsInspector(this);
    this.demoDirector = new DemoFlightDirector(this);

    // Game flow: lobby (cinematic menu) / flight / paused
    this.gameFlow = new GameFlowController({
      isDemoActive: () => this.demoDirector.isActive,
      isDemoWaiting: () => this.demoDirector.waitingForTerrain === true,
      onStateChange: () => this.syncFlowUi(),
    });
    this.lobby = { airport: 'coastal', preset: 'runway' };
    this.lastPresetType = 'runway';

    // 7. Collision Detection & Explosion & Tire Smoke Particle Systems
    this.collisionDetector = new CollisionDetector(
      this.currentTerrain,
      this.currentAirport,
      this.foliage,
      this.ships,
      this.water
    );
    this.explosionSystem = new ExplosionSystem(this.scene, this.currentTerrain);
    this.tireSmokeSystem = new TireSmokeSystem(this.scene, this.currentTerrain);
    this.isCrashed = false;
    this.crashResult = null;
    this.lastOnGround = true;
    this.lastGearTarget = true;
    this.airborneTime = 0.0;
    this.hasTouchedDownThisFlight = false;
    this.gear.resetContacts();

    // 8. Rigid Body Physics State
    // Linear state
    this.position = new THREE.Vector3();
    this.linearVelocity = new THREE.Vector3(); // world m/s
    // Angular state
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3(); // body rad/s (p, q, r)
    this.renderPose = new RenderPose(this.position, this.quaternion);

    // Simulation Timing
    this.clock = new THREE.Clock();
    this.physicsHz = 120;
    this.physicsDt = 1.0 / this.physicsHz;
    this.physicsAccumulator = 0;
    this.totalSimTime = 0;

    // Flight Telemetry Cache
    this.telemetry = {
      pitchDeg: 0,
      rollDeg: 0,
      headingDeg: 90,
      trackDeg: 90,
      altitudeFt: 0,
      radioAltFt: 0,
      iasKnots: 0,
      tasKnots: 0,
      groundSpeedKnots: 0,
      vsiFpm: 0,
      mach: 0,
      gForce: 1.0,
      isStalled: false,
      isPreStall: false,
      gearState: 1.0,
      isTransit: false,
      flapDegree: 5,
      flapIndex: 2,
      spoilers: 0,
      touchdown: false,
      onGround: true,
      x: 0,
      z: 0,
      parkBrake: false
    };

    // Autopilot (pure control laws in src/physics/Autopilot.js). The trim
    // solver runs only on mode/target capture, so its allocation is off the
    // 120 Hz path.
    this.autopilot = new AutopilotController({
      trimSolver: (telemetry, flightPathAngleDeg) => solveTrim(this.aero, this.engines, {
        iasKnots: telemetry.iasKnots,
        altitudeMeters: Atmosphere.feetToMeters(telemetry.altitudeFt),
        flightPathAngleDeg,
        flapsIndex: this.aero.flapsIndex,
        gearState: this.telemetry.gearState,
        spoilers: this.aero.spoilers,
      }),
    });
    // Reusable objects so 120 Hz substeps do not allocate for the AP snapshot.
    this._apEuler = new THREE.Euler();
    this._apForward = new THREE.Vector3();
    // Reusable objects for integratePhysics force/moment math and its telemetry
    // extraction; every one is consumed before the next substep.
    this._intThrust = new THREE.Vector3();
    this._intGravity = new THREE.Vector3();
    this._intNetForce = new THREE.Vector3();
    this._intNetMoment = new THREE.Vector3();
    this._intAngAcc = new THREE.Vector3();
    this._intDeltaRot = new THREE.Quaternion();
    this._intEuler = new THREE.Euler();
    this._intForward = new THREE.Vector3();
    this._intNonGrav = new THREE.Vector3();
    this._intCabinUp = new THREE.Vector3();
    this._apState = {
      airportKey: 'coastal',
      headingDeg: 0, rollDeg: 0, pitchDeg: 0,
      altitudeFt: 0, vsiFpm: 0, iasKnots: 0, tasKnots: 0,
      throttle: 0, x: 0, z: 0,
    };

    this.initControls();
    this.initUI();
    this.setAirport('coastal');

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());

    // Keep audio active across Bluetooth device connection & system interruptions
    const ensureAudio = () => {
      if (!this.audio.isInitialized) {
        this.audio.init();
      }
      this.audio.ensureContextRunning();
    };
    ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'].forEach(evt => {
      window.addEventListener(evt, ensureAudio, { passive: true });
    });

    // Begin Animation Loop
    this.hasRenderedFirstFrame = false;
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // Open straight into the flight HUD rather than the main menu. The menu
    // and its cinematic backdrop stay reachable via the persistent top-left
    // toggle (or ESC > pause). #123 hardcoded the markup to
    // boot at the lobby, so that first-paint attribute is flipped to flight too.
    this.fly();
    this.syncFlowUi();
  }

  initControls() {
    this.controls.onUserInteract = () => {
      this.audio.init();
      this.audio.ensureContextRunning();
    };

    this.controls.onToggleGear = () => {
      this.gear.toggleGear();
    };

    this.controls.onToggleSpoilers = () => {
      this.aero.toggleSpoilers();
    };

    this.controls.onCycleFlaps = (inc) => {
      this.aero.cycleFlaps(inc);
      this.telemetry.flapIndex = this.aero.flapsIndex;
      this.telemetry.flapDegree = this.aero.currentFlapAngle;
    };

    this.controls.onToggleReverser = () => {
      this.engines.toggleReverser(this.telemetry.onGround);
    };

    this.controls.onCycleEngineFailure = () => {
      // Cycle: both running → #1 out → both out → #2 out → both running
      const failed = this.engines.failed;
      if (!failed[0] && !failed[1]) {
        this.engines.setEngineFailure(0, true);
        this.showToast(() => t('notice.engineFailure', { which: '1 (L)' }));
      } else if (failed[0] && !failed[1]) {
        this.engines.setEngineFailure(1, true);
        this.showToast(() => t('notice.enginesBothFailed'));
      } else if (failed[0] && failed[1]) {
        this.engines.setEngineFailure(0, false);
        this.showToast(() => t('notice.engineFailure', { which: '2 (R)' }));
      } else {
        this.engines.setEngineFailure(1, false);
        this.showToast(() => t('notice.enginesRecovered'));
      }
    };

    this.controls.onCycleCamera = () => {
      const modeName = this.cameraSystem.cycleMode();
      if (this.demoDirector && this.demoDirector.isActive) {
        this.demoDirector.onUserCameraChange();
      }
      this.showToast(() => t('notice.camera', { name: modeName }));
    };

    this.controls.onSelectCamera = (mode) => {
      this.cameraSystem.setMode(mode, true);
      if (this.demoDirector?.isActive) this.demoDirector.onUserCameraChange();
      this.showToast(() => t('notice.camera', { name: this.cameraSystem.getModeName() }));
    };

    this.controls.onToggleLights = () => {
      this.aircraft.lightsOn = !this.aircraft.lightsOn;
      this.aircraft.lightsGroup.visible = this.aircraft.lightsOn;
      this.showToast(() => t('notice.lights', { state: t(this.aircraft.lightsOn ? 'state.on' : 'state.off') }));
    };

    this.controls.onCycleTimeOfDay = (deltaHours) => {
      this.demoDirector?.onUserTimeOfDayChange();
      this.sky.setTimeOfDay(this.sky.timeOfDay + deltaHours, this.position, this.camera.position);
      this.foliage.setTimeOfDay(this.sky.timeOfDay);
      this.water.syncWithAtmosphere(this.sky);
      const h = Math.floor(this.sky.timeOfDay);
      const m = Math.floor((this.sky.timeOfDay % 1) * 60);
      const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      this.showToast(() => t('notice.time', { time: timeStr }));
    };

    this.controls.onToggleAudio = () => {
      this.audio.init();
      this.audio.ensureContextRunning();
      const state = this.audio.cycleVolume();
      this.updateAudioUI(state);
      this.showToast(() => t('sound.value', { value: this.audio.getVolumeState().text }));
    };
  }

  /** Apply the game-flow state to the DOM: menu visibility, input blocking. */
  syncFlowUi() {
    const state = this.gameFlow.state;
    document.body.dataset.flow = state;
    this.controls.inputBlocked = this.gameFlow.blocksFlightInput();
    if (state !== FLOW.FLIGHT) {
      this.controls.releaseAllKeys();
      this.controls.setTouchStick(0.0, 0.0);
      this.controls.setTouchRudder(0.0);
      this.controls.setTouchBrakes(0.0);
      if (document.pointerLockElement && document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock();
      }
    }
    if (this.lobbyScreen) {
      this.lobbyScreen.setWaitingForTerrain(
        state === FLOW.LOBBY && this.demoDirector?.waitingForTerrain === true);
      if (state === FLOW.LOBBY) this.lobbyScreen.refresh();
    }
    this.updateMenuToggle();
  }

  /** Leave the lobby: stop the cinematic and spawn the player at their choice. */
  fly() {
    const wantsDemo = this.lobby.preset === 'demo';
    if (this.demoDirector?.isActive || this.demoDirector?.waitingForTerrain) {
      this.demoDirector.stop(wantsDemo ? null : () => t('manual.control.engaged'));
    }
    this.gameFlow.enterFlight();
    if (wantsDemo) {
      this.demoDirector.start();
    } else {
      this.setPreset(this.lobby.preset);
    }
  }

  /**
   * Top-left menu toggle: open the main menu over the live flight (holding it),
   * or close it. Closing resumes the held flight; if there is no flight yet
   * (boot / after a scenario change) it launches the current selection.
   */
  toggleMainMenu() {
    const flow = this.gameFlow;
    if (flow.state === FLOW.LOBBY) {
      if (flow.canResumeFromLobby()) flow.enterFlight();
      else this.fly();
      return;
    }
    if (this.isCrashed) this.clearCrashState();
    flow.returnToLobby(true);
  }

  /** Keep the toggle's icon and accessible label in sync with the flow state. */
  updateMenuToggle() {
    const btn = document.getElementById('menu-toggle');
    if (!btn) return;
    const open = this.gameFlow.state === FLOW.LOBBY;
    btn.classList.toggle('is-open', open);
    // Live closure: setLanguage() re-runs it, so the label follows language too.
    bindText(btn, () => t(this.gameFlow.state === FLOW.LOBBY ? 'menu.close' : 'menu.open'), 'aria-label');
    const glyph = btn.querySelector('.menu-toggle-glyph');
    if (glyph) glyph.textContent = open ? '✕' : '🏠';
  }

  setTimeOfDay(hours) {
    this.demoDirector?.onUserTimeOfDayChange();
    this.sky.setTimeOfDay(hours, this.position, this.camera.position);
    this.foliage.setTimeOfDay(this.sky.timeOfDay);
    this.water.syncWithAtmosphere(this.sky);
    const h = Math.floor(this.sky.timeOfDay);
    const m = Math.floor((this.sky.timeOfDay % 1) * 60);
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    this.showToast(() => t('notice.time', { time: timeStr }));
  }

  setPreset(type, isDemoInternal = false) {
    // Scenario availability depends on the active airport; an unavailable
    // pick (e.g. cliff at coastal) falls back instead of leaving a stale pose.
    if (!isScenarioAvailable(this.activeAirport, type)) type = DEFAULT_SCENARIO;
    this.lastPresetType = type;
    if (!isDemoInternal) this.aero.loadConfig(BOEING_737_800);
    if (!isDemoInternal && this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }
    if (!isDemoInternal && this.cameraSystem) {
      this.cameraSystem.userLookOverridden = false;
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.clear();
    }
    this.lastOnGround = (type === 'runway');
    this.lastGearTarget = (type !== 'cruise');
    this.airborneTime = (type === 'runway') ? 0.0 : 15.0;
    this.hasTouchedDownThisFlight = false;
    this.gear.resetContacts();
    this.autopilot.reset();
    // A preset reset redoes the aircraft with clean wings: the separation
    // state must not leak across the reset into the new flight.
    this.aero.separation = 0.0;
    this.landingIncident = false;
    this.landingStopped = false;
    this.bodyContactStarted = false;

    if (this.isCrashed) {
      this.clearCrashState();
    }

    if (this.activeAirport === 'lukla') {
      const sin58 = 0.848048;
      const cos58 = 0.529919;

      if (type === 'runway') {
        // Lukla takeoffs line up at the upper Runway 24 threshold (2,867m) and
        // accelerate downhill toward the cliff on heading 238°; Runway 06 is the
        // landing-only direction. Same spawn as the 'cliff' preset: the 5m lateral
        // offset keeps the wide wing clear of the raised apron.
        // Spawn above the current wheel geometry, allowing suspension settling.
        this.position.set(240.0 * sin58 - 5 * cos58, 2867.72, -240.0 * cos58 - 5 * sin58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch -6.71° nose-down along the 11.7% downhill gradient, Heading 238° (yaw -238°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(-6.71),
          -THREE.MathUtils.degToRad(238.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(2); // Flaps 5
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 5.5;

        this.showToast(() => t('preset.lukla.runway.24.takeoff.roll'));
      } else if (type === 'approach') {
        // Final Approach 2.0 NM out in Dudh Kosi Canyon (Alt 3,070m / 10,070ft)
        // Distance to threshold 06 (s = -263.5m) is 3,536.5m
        // Elevation drop to threshold (2,805m): 265m -> slope = 4.28°
        // At 69.4 m/s (135 kts), required sink rate is -5.20 m/s (-1,025 FPM)
        const distSW = -3800.0;
        this.position.set(distSW * sin58, 3070.0, -distSW * cos58);
        this.linearVelocity.set(69.4 * sin58, -5.20, -69.4 * cos58);
        this.angularVelocity.set(0, 0, 0);

        // Pitch 1.0° nose-up on 4.3° descent path, Heading 058° (yaw -58°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(1.0),
          -THREE.MathUtils.degToRad(58.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.56;
        this.engines.setThrottle(0.56);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(5); // Flaps 30 for short runway landing
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 6.2;

        this.showToast(() => t('preset.lukla.canyon.landing.challenge.10.070'));
      } else if (type === 'cliff') {
        // Lukla Runway 24 Downhill Cliff Dive Takeoff!
        // Start near the upper threshold with wheel clearance; a 5m lateral
        // offset keeps the wide wing clear of the raised apron.
        this.position.set(240.0 * sin58 - 5 * cos58, 2867.72, -240.0 * cos58 - 5 * sin58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        // Pitch nose down -6.71° along 11.7% downhill slope, Heading 238° (yaw -238°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(-6.71),
          -THREE.MathUtils.degToRad(238.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 1.0; // TOGA 100%
        this.engines.setThrottle(1.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(3); // Flaps 15 (mountain short-field takeoff)
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 5.5;
        this.controls.pitchTrim = 5.5;

        this.showToast(() => t('preset.lukla.runway.24.downhill.takeoff.11'));
      } else if (type === 'cruise') {
        // Scenic Himalayan Valley Cruise at 13,000 FT (3,960m)
        this.position.set(-1500, 3960, -800);
        this.linearVelocity.set(80, 0, -60);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.3);

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.gear.setGearTarget(false);
        this.gear.gearState = 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 2.5;

        this.showToast(() => t('preset.himalayan.cruise.13.000.ft'));
      }
    } else {
      // Coastal International Airport Presets
      if (type === 'runway') {
        // Aligned on Runway 09L Threshold (Heading 090° East)
        this.position.set(-1350, 15.5, 0);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5); // Face East (+X)

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(2); // Flaps 5 for takeoff
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 4.5; // Takeoff trim

        this.showToast(() => t('preset.coastal.runway'));
      } else if (type === 'approach') {
        // Final Approach 3 NM out on 3° glideslope (5.5 km west: x = -6500m, alt = 320m / 1050ft)
        this.position.set(-6500, 310, 0);
        // Speed 145 knots (74.5 m/s) heading East (+X), descending at -3.9 m/s (-770 fpm)
        this.linearVelocity.set(74.5, -3.9, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch slightly nose-up (2.5°) with 3° descent path
        const euler = new THREE.Euler(THREE.MathUtils.degToRad(2.5), -Math.PI * 0.5, 0, 'YXZ');
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.52; // Approach thrust
        this.engines.setThrottle(0.52);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(5); // Flaps 30 for landing
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 6.0;

        this.showToast(() => t('preset.coastal.approach'));
      } else if (type === 'cruise') {
        // Scenic Coastal Cruise over Bay & Ships at 2,600 ft (800m), Speed 210 knots (108 m/s)
        this.position.set(-600, 750, 3200);
        this.linearVelocity.set(96, 0, -49); // Aligned with heading 153° (yaw -0.35pi)
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.35);

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.gear.setGearTarget(false);
        this.gear.gearState = 0.0;
        this.aero.setFlapPosition(0); // Clean
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 2.5;

        this.showToast(() => t('preset.coastal.cruise'));
      }
    }

    // A preset marks a fresh segment: full tanks at the configured mass and no
    // engine failures. Restoring from aero.massBaselineKg rather than adding the
    // previous burn back means a demo-internal preset whose scenario just loaded
    // its own mass (Lukla's 43 t) starts at that mass, not at it plus the burn.
    this.engines.refuel(this.aero);
    this.engines.failed[0] = false;
    this.engines.failed[1] = false;

    if (type === 'approach' || type === 'cruise') this.applyComputedTrim();

    this.controls.clearVirtualInputs();
    this.controls.setParkingBrake?.(false);
    this.controls.brakes = 0.0;
    this.gear.setBrakes(0.0);
    this.physicsAccumulator = 0;

    this.renderPose.reset(this.position, this.quaternion);
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.cameraSystem.snapToTarget(this.aircraft.group);
  }

  /**
   * Derive the spawn trim state for airborne presets from the steady-state
   * solver instead of hand-tuned constants: sets the trim wheel, throttle and
   * pitch attitude to the equilibrium solution for the just-assigned velocity,
   * altitude and configuration. Falls back to the preset's literal values
   * when no solution exists (near-stagnant or beyond-envelope spawns).
   */
  applyComputedTrim() {
    const tas = this.linearVelocity.length();
    if (tas < 20) return;
    const altitudeMeters = Math.max(0, this.position.y);
    const atmos = Atmosphere.getConditions(altitudeMeters);
    const gammaRad = Math.asin(THREE.MathUtils.clamp(this.linearVelocity.y / tas, -1, 1));
    const solution = solveTrim(this.aero, this.engines, {
      iasKnots: Atmosphere.msToKnots(Atmosphere.tasToIas(tas, atmos.densityRatio)),
      altitudeMeters,
      flightPathAngleDeg: THREE.MathUtils.radToDeg(gammaRad),
      flapsIndex: this.aero.flapsIndex,
      gearState: this.gear.gearState,
      spoilers: this.aero.spoilers,
    });
    if (!solution.feasible) return;
    this.controls.throttle = solution.throttle;
    this.engines.setThrottle(solution.throttle);
    this.controls.pitchTrim = solution.handsOffTrimDeg;
    this.aero.pitchTrim = solution.handsOffTrimDeg;
    // Pitch attitude = alpha + gamma; keep the preset's heading and roll.
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    euler.x = THREE.MathUtils.degToRad(solution.alphaDeg) + gammaRad;
    this.quaternion.setFromEuler(euler);
  }

  /**
   * Switch Active Airport Environment (Coastal International vs Nepal Lukla)
   */
  setAirport(id) {
    if (this.activeAirport === id) return;
    this.activeAirport = id;
    const isLukla = id === 'lukla';

    // Toggle 3D mesh visibility
    this.terrain.mesh.visible = !isLukla;
    this.airport.group.visible = !isLukla;
    this.water.mesh.visible = !isLukla;
    this.ships.group.visible = !isLukla;
    this.foliage.group.visible = !isLukla;

    this.luklaTerrain.mesh.visible = isLukla;
    this.luklaAirport.group.visible = isLukla;

    this.currentTerrain = isLukla ? this.luklaTerrain : this.terrain;
    this.currentAirport = isLukla ? this.luklaAirport : this.airport;

    if (this.collisionDetector) {
      if (isLukla) {
        this.collisionDetector.setEnvironment(this.luklaTerrain, this.luklaAirport, null, null, null);
      } else {
        this.collisionDetector.setEnvironment(this.terrain, this.currentAirport, this.foliage, this.ships, this.water);
      }
    }

    if (this.explosionSystem) {
      this.explosionSystem.terrain = this.currentTerrain;
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.terrain = this.currentTerrain;
    }

    // Relocate tower camera position and update active terrain for the active airport environment
    if (this.cameraSystem) {
      this.cameraSystem.setTerrain(this.currentTerrain);
      if (isLukla) {
        const t = this.luklaAirport.controlTowerData;
        this.cameraSystem.towerPos.set(t.x, t.y + t.height - 1.5, t.z);
      } else {
        this.cameraSystem.towerPos.set(120, 78, 280);
      }
    }

    // Sync cloud layer altitude with active airport elevation
    if (this.sky && typeof this.sky.setAirport === 'function') {
      this.sky.setAirport(id);
    }

    // Reconfigure cockpit navigation displays for active airport
    if (this.ndCanvas && typeof this.ndCanvas.setAirport === 'function') {
      this.ndCanvas.setAirport(id);
    }
    if (this.cduCanvas && typeof this.cduCanvas.setAirport === 'function') {
      this.cduCanvas.setAirport(id);
    }

    this.lobby.airport = id;
    if (!isScenarioAvailable(id, this.lobby.preset)) this.lobby.preset = DEFAULT_SCENARIO;
    // A new airport re-spawns the aircraft below, so any flight held behind the
    // menu is no longer the one to return to: release it and let the cinematic back.
    this.gameFlow.abandonResumableFlight();
    this.lobbyScreen?.refresh();

    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    this.setPreset('runway');

    const airportKey = isLukla
      ? 'tenzing.hillary.airport.nepal.vnlk.runway.24'
      : 'pacific.coastal.international.airport.runway.09l.elevation';
    this.showToast(() => t('airport.changed.value', { value: t(airportKey) }));
  }

  /**
   * Live autopilot snapshot reusing instance scratch objects (no allocation
   * per 120 Hz substep). Conventions match this.telemetry.
   */
  readAutopilotState() {
    const euler = this._apEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const f = this._apForward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const s = this._apState;
    s.airportKey = this.activeAirport;
    s.pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    s.rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    s.headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
    s.altitudeFt = Atmosphere.metersToFeet(this.position.y);
    s.vsiFpm = Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0;
    s.iasKnots = this.telemetry.iasKnots;
    s.tasKnots = this.telemetry.tasKnots;
    s.throttle = this.controls.throttle;
    s.x = this.position.x;
    s.z = this.position.z;
    return s;
  }

  /**
   * Physics Integration Substep (120 Hz)
   */
  integratePhysics(dt) {
    // Gear/contact queries consume this mesh too. Restore the authoritative
    // transform before physics so a rendered interpolation never feeds back.
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    // If crashed, damp out velocities and rest on terrain
    if (this.isCrashed) {
      this.linearVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 2.8));
      this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 3.5));
      this.position.addScaledVector(this.linearVelocity, dt);
      const groundH = this.currentTerrain ? this.currentTerrain.getHeight(this.position.x, this.position.z) : 0.0;
      if (this.position.y < groundH + 0.8) {
        this.position.y = groundH + 0.8;
      }
      this.aircraft.group.position.copy(this.position);
      return;
    }

    // 1. Controls processing
    this.controls.update(dt, this.telemetry.iasKnots);
    this.aero.elevator = this.controls.elevator;
    this.aero.aileron = this.controls.aileron;
    this.aero.rudder = this.controls.rudder;
    this.aero.pitchTrim = this.controls.pitchTrim;

    // Autopilot control laws. Pilot yoke input above the gate overrides the
    // axes; the AP commands surfaces directly, bypassing yoke rate limiters.
    if (this.autopilot.master) {
      const apCmd = this.autopilot.update(this.readAutopilotState(), dt);
      if (Math.abs(this.controls.elevator) < 0.075 && Math.abs(this.controls.aileron) < 0.075) {
        this.aero.elevator = apCmd.elevator;
        this.aero.aileron = apCmd.aileron;
        if (this.autopilot.speedMode) this.controls.throttle = apCmd.throttle;
      }
    }

    // Ground steering & brakes
    const groundSpeed = Math.sqrt(this.linearVelocity.x * this.linearVelocity.x + this.linearVelocity.z * this.linearVelocity.z);
    this.gear.setSteering(this.controls.rudder, groundSpeed);
    this.gear.setBrakes(this.controls.brakes);

    // 2. Turbofan Engines Update
    this.engines.setThrottle(this.controls.throttle);
    const altitudeMeters = this.position.y;
    const atmos = Atmosphere.getConditions(altitudeMeters);
    const tas = this.linearVelocity.length();
    const engineData = this.engines.update(dt, altitudeMeters, tas, atmos.densityRatio);

    // Live mass: the airframe sheds exactly the fuel burned since the last
    // substep, so a scenario that replaces currentMassKg mid-flight keeps its
    // baseline and still loses the weight it burns.
    this.engines.shedBurnedFuelMass(this.aero);

    // 3. Terrain Height & Ground Clearance
    const groundHeight = this.currentTerrain.getHeight(this.position.x, this.position.z);
    const heightAboveGround = Math.max(0, this.position.y - groundHeight);

    // Physics may run several substeps before rendering. Refresh the root world
    // matrix so gear contacts use this substep's pose rather than the last frame.
    this.aircraft.group.updateWorldMatrix(true, false);

    // 4. Landing Gear Forces & Ground Friction
    const gearResult = this.gear.update(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      (x, z) => this.currentTerrain.getHeight(x, z),
      (x, z) => (this.currentTerrain.getNormal ? this.currentTerrain.getNormal(x, z) : null)
    );

    if (gearResult.damageEvents.length || (gearResult.bodyContacts.length && !this.bodyContactStarted)) {
      this.landingIncident = true;
      if (this.demoDirector?.isActive) this.demoDirector.stop();
      const labels = { nose: 'nose.gear', mainLeft: 'left.main.gear', mainRight: 'right.main.gear' };
      for (const event of gearResult.damageEvents) {
        this.showToast(() => t('notice.gearDamage', { value1: t(labels[event.id]), value2: event.state === 'collapsed' ? t('gear.collapsed') : t('gear.damaged') }));
      }
      if (gearResult.bodyContacts.length) {
        this.bodyContactStarted = true;
        this.showToast(() => t('aircraft.belly.contact.sliding.on.runway'));
      }
    }
    if (this.landingIncident && gearResult.onGround && !this.landingStopped && groundSpeed < 0.5 && Math.abs(this.linearVelocity.y) < 0.2) {
      this.landingStopped = true;
      this.showToast(() => t('emergency.landing.stopped.select.a.preset.to'));
    }

    // 5. Aerodynamic Forces & Moments
    const aeroResult = this.aero.computeAero(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      altitudeMeters,
      heightAboveGround,
      engineData.totalThrust,
      gearResult.gearState
    );

    // Engine-out asymmetric thrust: the surviving engine's moment about the
    // centerline yaws the nose toward the dead engine. Body +Y is positive
    // yaw-left, so the sign follows directly from (T_right - T_left).
    aeroResult.momentBody.y += asymmetricThrustYawMoment(
      engineData.engine1.thrust, engineData.engine2.thrust);

    // 6. Thrust Force in World Space
    // Engine thrust acts along forward longitudinal axis (-Z in Three.js aircraft space)
    const thrustWorld = this._intThrust.set(0, 0, -engineData.totalThrust).applyQuaternion(this.quaternion);

    // 7. Gravity Force
    const gravityWorld = this._intGravity.set(0, -this.aero.mass * Atmosphere.G0, 0);

    // 8. Total Forces Integration: F = m * a
    const netForceWorld = this._intNetForce.set(0, 0, 0)
      .add(gravityWorld)
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);

    const accelerationWorld = netForceWorld.divideScalar(this.aero.mass);
    this.linearVelocity.addScaledVector(accelerationWorld, dt);

    // Clamp near-zero velocity when parked on ground with brakes
    if (gearResult.onGround && this.controls.brakes > 0.5 && this.linearVelocity.length() < 0.4 && this.controls.throttle < 0.1) {
      this.linearVelocity.set(0, 0, 0);
    }

    this.position.addScaledVector(this.linearVelocity, dt);

    // 9. Total Moments Integration: M = I * alpha
    // Moment in body frame: aero moment + landing gear moment
    const netMomentBody = this._intNetMoment.set(0, 0, 0)
      .add(aeroResult.momentBody)
      .add(gearResult.moments);

    // Angular acceleration: [p_dot, q_dot, r_dot] = [Mx/Ixx, My/Iyy, Mz/Izz]
    const angAccBody = this._intAngAcc.set(
      netMomentBody.x * this.aero.invIyy, // Pitch (around X)
      netMomentBody.y * this.aero.invIzz, // Yaw (around Y)
      netMomentBody.z * this.aero.invIxx  // Roll (around Z)
    );

    this.angularVelocity.addScaledVector(angAccBody, dt);

    // Natural rotational damping (heavy transport inertia dissipation)
    this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 0.35));

    // Update Aircraft Orientation Quaternion
    // Delta rotation from body angular velocity: omega x dt
    const deltaRot = this._intDeltaRot.set(
      this.angularVelocity.x * dt * 0.5,
      this.angularVelocity.y * dt * 0.5,
      this.angularVelocity.z * dt * 0.5,
      1.0
    ).normalize();

    this.quaternion.multiply(deltaRot).normalize();

    // Sync Three.js aircraft mesh transform
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);

    // 10. Update Telemetry State
    const euler = this._intEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    // Heading: forward vector (-Z in aircraft local space) projected to horizontal XZ plane
    const forwardVec = this._intForward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(forwardVec.x, -forwardVec.z)) + 360) % 360;

    // Track
    const trackDeg = (THREE.MathUtils.radToDeg(Math.atan2(this.linearVelocity.x, -this.linearVelocity.z)) + 360) % 360;

    // Compute authentic load factor Nz (accelerometer along body cabin vertical axis +Y)
    const nonGravForceWorld = this._intNonGrav.set(0, 0, 0)
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);
    const cabinCeilingWorld = this._intCabinUp.set(0, 1, 0).applyQuaternion(this.quaternion);
    const measuredGForce = nonGravForceWorld.dot(cabinCeilingWorld) / (this.aero.mass * Atmosphere.G0);

    this.telemetry = {
      pitchDeg,
      rollDeg,
      headingDeg,
      trackDeg,
      altitudeFt: Atmosphere.metersToFeet(this.position.y),
      radioAltFt: Atmosphere.metersToFeet(heightAboveGround),
      iasKnots: aeroResult.iasKnots,
      tasKnots: aeroResult.tasKnots,
      groundSpeedKnots: Atmosphere.msToKnots(groundSpeed),
      vsiFpm: Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0,
      mach: aeroResult.mach,
      gForce: Math.max(-2.5, Math.min(5.5, measuredGForce)),
      isStalled: aeroResult.isStalled,
      isPreStall: aeroResult.isPreStall,
      stallSeverity: aeroResult.stallSeverity,
      buffetVibration: aeroResult.buffetVibration,
      engine1: engineData.engine1,
      engine2: engineData.engine2,
      reverserActive: engineData.reverserActive,
      fuelKg: engineData.fuelKg,
      gearState: gearResult.gearState,
      isTransit: gearResult.isTransit,
      compressions: gearResult.compressions,
      gearDamage: gearResult.gearDamage,
      bodyContacts: gearResult.bodyContacts.map(c => c.id),
      structuralDamage: gearResult.structuralDamage,
      flapDegree: this.aero.currentFlapAngle,
      flapIndex: this.aero.flapsIndex,
      spoilers: this.aero.spoilers,
      touchdown: gearResult.touchdown,
      onGround: gearResult.onGround,
      apEngaged: this.autopilot.master,
      airportKey: this.activeAirport,
      apModes: this.autopilot.annunciation(),
      apArmed: this.autopilot.appArmed,
      selectedHeading: this.autopilot.master ? Math.round(this.autopilot.targets.headingDeg) : this.telemetry.selectedHeading,
      selectedAltitude: this.autopilot.master ? Math.round(this.autopilot.targets.altitudeFt) : this.telemetry.selectedAltitude,
      selectedSpeed: this.autopilot.master && this.autopilot.speedMode ? Math.round(this.autopilot.targets.iasKnots) : this.telemetry.selectedSpeed,
      elevator: this.controls.elevator,
      aileron: this.controls.aileron,
      rudder: this.controls.rudder,
      throttle: this.controls.throttle,
      pitchTrim: this.aero.pitchTrim,
      x: this.position.x,
      z: this.position.z,
      parkBrake: Boolean(this.controls.parkingBrake || (gearResult.onGround && this.controls.brakes > 0.8 && Atmosphere.msToKnots(groundSpeed) < 1.0))
    };

    // 11. Touchdown Tire Smoke & Landing Contact Gate
    const gsKnots = Atmosphere.msToKnots(groundSpeed);
    let genuineLandingTouchdown = false;

    if (!gearResult.onGround) {
      this.airborneTime += dt;
      if (this.airborneTime > 2.0) {
        // Once aircraft has climbed out and sustained flight, prime for next landing
        this.hasTouchedDownThisFlight = false;
      }
    } else {
      // Aircraft has gear on ground
      // Genuine touchdown requires coming from sustained flight (> 1.5s), with landing airspeed (> 45 knots),
      // and only triggers on the initial touchdown frame of this landing.
      const isGenuineTouchdown = this.airborneTime >= 1.5 && gsKnots > 45 && !this.hasTouchedDownThisFlight;
      if (isGenuineTouchdown && (gearResult.touchdown || !this.lastOnGround)) {
        genuineLandingTouchdown = true;
        this.hasTouchedDownThisFlight = true;
        const contactsToSmoke = (gearResult.touchdownContacts && gearResult.touchdownContacts.length > 0)
          ? gearResult.touchdownContacts
          : this.gear.contacts.filter(c => c.id !== 'nose');
        this.tireSmokeSystem.spawnTouchdownSmoke(contactsToSmoke, this.linearVelocity);
      }
      this.airborneTime = 0.0;
    }

    // 12. Cinematic Camera Cuts: Automatic temporary gear view for Takeoff, Touchdown, and Gear Retract/Extend
    const allowAutoCut = (!this.cameraSystem.userModeSelected || this.cameraSystem.autoSwitch)
      && !this.cameraSystem.userLookOverridden
      && !(this.demoDirector && this.demoDirector.isActive && this.demoDirector.userCameraOverridden);
    if (allowAutoCut && !this.landingIncident && this.lastOnGround && !gearResult.onGround && gsKnots > 75) {
      // Takeoff liftoff
      this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
      this.showToast(() => t('landing.gear.view.takeoff.climb'));
    } else if (allowAutoCut && !this.landingIncident && genuineLandingTouchdown && this.totalSimTime > 2.0) {
      // Touchdown landing (only on genuine landing touchdown)
      this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 5.0);
      this.showToast(() => t('landing.gear.view.touchdown.suspension.compression'));
    }

    const currentGearTarget = this.gear.targetGearState > 0.5;
    if (this.lastGearTarget !== currentGearTarget && this.totalSimTime > 1.0) {
      if (allowAutoCut) {
        if (!currentGearTarget) {
          // Gear retracting
          this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
          this.showToast(() => t('landing.gear.view.retracting'));
        } else {
          // Gear extending
          this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
          this.showToast(() => t('landing.gear.view.extending'));
        }
      }
      this.lastGearTarget = currentGearTarget;
    }
    this.lastOnGround = gearResult.onGround;

    // 13. Check Multi-Obstacle Collisions (Terrain, Water, Tower, Buildings, Trees, Ships)
    if (!this.isCrashed) {
      const crash = this.collisionDetector.checkCollision(
        this.position,
        this.quaternion,
        this.linearVelocity,
        gearResult.gearState,
        pitchDeg,
        rollDeg,
        gearResult
      );

      if (crash) {
        this.triggerCrash(crash);
      }
    }
  }

  triggerCrash(crashResult) {
    if (this.isCrashed) return;
    this.isCrashed = true;
    this.crashResult = crashResult;

    // 1. Spawn Visual Explosion Particles, Fireball, Smoke & Dynamic Light Flash
    this.explosionSystem.spawnExplosion(crashResult);

    // 2. Procedural Audio Detonation & Metal Crunch Sound
    this.audio.playExplosion(crashResult.type === 'WATER');

    // 3. Aircraft Structural Damage Visuals
    this.aircraft.triggerCrashVisuals(crashResult.type);

    // 4. Catastrophic Camera Trauma Shake
    this.cameraSystem.addTrauma(1.0);

    // Record the outcome before stop() makes scenario.update unreachable.
    this.demoDirector?.stopForCrash(crashResult);

    // 6. Kill Engines and Damp Kinetic Energy
    this.autopilot.disengage();
    this.engines.setThrottle(0.0);
    this.controls.throttle = 0.0;
    this.linearVelocity.multiplyScalar(0.25);
    if (this.linearVelocity.y < 0) this.linearVelocity.y = 0;

    // 7. Show Crash UI Overlay
    this.showCrashUI(crashResult);
  }

  clearCrashState() {
    this.isCrashed = false;
    this.crashResult = null;
    this.explosionSystem.clear();
    this.aircraft.resetCrashVisuals();

    const crashEl = document.getElementById('crash-overlay');
    if (crashEl) crashEl.style.display = 'none';
  }

  resetCrash() {
    this.clearCrashState();
    this.setPreset('runway');
    this.showToast(() => t('aircraft.repaired.restarted.on.runway.09l'));
  }

  exitCrashToLobby() {
    if (!this.isCrashed) return;
    this.clearCrashState();
    this.gameFlow.returnToLobby();
  }

  showCrashUI(crashResult) {
    // Crashes during the lobby cinematic are part of the show: the loop
    // restarts the scenario without a hull-loss UI. Only interrupt the player.
    if (this.gameFlow.state !== FLOW.FLIGHT) return;
    const overlay = document.getElementById('crash-overlay');
    const title = document.getElementById('crash-title');
    const desc = document.getElementById('crash-desc');
    const speed = document.getElementById('crash-speed');
    const type = document.getElementById('crash-type');

    if (title) bindText(title, () => crashResult.name);
    if (desc) bindText(desc, () => crashResult.description);
    if (speed) speed.textContent = `${Math.round(crashResult.speedKnots)} KT`;
    if (type) type.textContent = crashResult.type;

    if (overlay) overlay.style.display = 'flex';
  }

  /**
   * Deterministic Simulation Step (for automated test harness & replay)
   * Runs the exact 120Hz physics substepping for the requested duration in simulation time.
   * @param {number} simSeconds 
   * @returns {object} updated telemetry state
   */
  stepSimulation(simSeconds) {
    const numSubsteps = Math.max(1, Math.round(simSeconds * this.physicsHz));
    for (let i = 0; i < numSubsteps; i++) {
      if (this.demoDirector && this.demoDirector.isActive) {
        this.demoDirector.update(this.physicsDt);
      }
      this.integratePhysics(this.physicsDt);
      this.totalSimTime += this.physicsDt;
    }
    // Deterministic stepping displays the current state without interpolation.
    // Discard render history before the real-time loop resumes.
    this.physicsAccumulator = 0;
    this.renderPose.reset(this.position, this.quaternion);
    this.updateFlightDisplays(true);
    const isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    const isLookingAway = isCockpit && this.cameraSystem.isLookingAwayFromCenter();
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.enabled = isPhotoCockpit;
      if (isPhotoCockpit) {
        this.cockpitPhotoOverlay.update(this.telemetry);
      }
    }
    this.aircraft.update(this.physicsDt, this.telemetry);
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.cameraSystem.update(this.physicsDt, this.aircraft.group, this.telemetry, (x, z) => this.currentTerrain.getHeight(x, z));
    this.foliage.updateCityLod(this.camera.position);
    this.foliage.update(this.camera.position);
    this.sky.updateSun(this.position, this.camera.position);
    const stepDaylight = this.sky.updateCockpitSun({
      position: this.aircraft.group.position,
      quaternion: this.aircraft.group.quaternion,
      cockpitActive: isCockpit && !isPhotoCockpit,
      dt: simSeconds,
      casterState: cockpitCasterState(this.aircraft.cockpit),
    });
    this.aircraft.cockpit.syncDaylight(stepDaylight);
    this.water.update(simSeconds, this.camera ? this.camera.position : this.position);
    this.explosionSystem.update(simSeconds);
    this.tireSmokeSystem.update(simSeconds);
    this.touchControls.updateUI();
    this.diagnostics.update(simSeconds, this.telemetry);
    this.updateHUD();
    return this.telemetry;
  }

  updateFlightDisplays(force = false) {
    const frame = this.displayFrame ?? 0;
    this.displayFrame = frame + 1;
    this.pfdCanvas.updateData(this.telemetry);
    this.pfdCanvas.render();
    this.isfdCanvas.updateData(this.telemetry);
    // Initialize both screens; then spread their uploads over alternate frames.
    for (const display of (force || frame === 0 ? [this.ndCanvas, this.eicasCanvas]
      : [frame % 2 === 0 ? this.ndCanvas : this.eicasCanvas])) {
      display.updateData(this.telemetry);
      display.render();
    }
    this.mcpCanvas.updateData(this.telemetry);
    this.cduCanvas.updateData(this.telemetry);
  }

  /**
   * Main Frame Loop
   */
  animate() {
    requestAnimationFrame(this.animate);

    const frameDelta = Math.min(0.1, this.clock.getDelta());
    this.physicsAccumulator += frameDelta;
    this.totalSimTime += frameDelta;

    // High-rate substepping for rock-solid flight physics
    if (this.gameFlow.isPhysicsFrozen()) {
      this.physicsAccumulator = 0;
    } else {
      while (this.physicsAccumulator >= this.physicsDt) {
        if (this.demoDirector && this.demoDirector.isActive) {
          this.demoDirector.update(this.physicsDt);
        }
        this.renderPose.reset(this.position, this.quaternion);
        this.integratePhysics(this.physicsDt);
        this.physicsAccumulator -= this.physicsDt;
      }
    }

    // Keep the lobby backdrop alive: re-arm the demo after it ends.
    this.gameFlow.update(frameDelta);
    if (this.gameFlow.consumeDemoRestart()) {
      this.demoDirector.start(this.activeAirport);
      if (this.lobbyScreen) {
        this.lobbyScreen.setWaitingForTerrain(this.demoDirector.waitingForTerrain === true);
      }
    } else if (this.gameFlow.isLoopCapTripped() && this.lobbyScreen) {
      this.lobbyScreen.setWaitingForTerrain(true);
    }

    // 1. Update 3D Aircraft Model & Articulations
    this.aircraft.update(frameDelta, this.telemetry);
    this.renderPose.apply(this.aircraft.group, this.position, this.quaternion,
      this.physicsAccumulator / this.physicsDt);

    // 2. Update Flight Instrument Canvas Displays
    this.updateFlightDisplays();

    // 3. Update Environment Animations & Explosion Particles
    if (this.activeAirport !== 'lukla') {
      this.water.update(frameDelta, this.camera ? this.camera.position : this.position);
      this.ships.update(frameDelta, this.totalSimTime);
    }
    if (this.currentAirport) {
      this.currentAirport.update(frameDelta, this.position, this.totalSimTime);
    }
    this.sky.updateSun(this.position, this.camera.position);
    this.explosionSystem.update(frameDelta);
    this.tireSmokeSystem.update(frameDelta);

    // 4. Update Cockpit Visibility & Audio
    let isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    if (isCockpit && !this.cameraSystem.photoCockpit && this.aircraft.cockpit.cockpitModelFailed) {
      // The GLTF interior is the only 3D cockpit geometry, and it never arrived.
      // The exterior groups are hidden in this mode, so pull the view out.
      this.cameraSystem.setMode(CameraSystem.MODES.CHASE, true);
      isCockpit = false;
      if (!this.interiorUnavailableWarned) {
        this.interiorUnavailableWarned = true;
        this.showToast(() => t('notice.cockpit.unavailable'));
      }
    }
    const isLookingAway = isCockpit && this.cameraSystem.isLookingAwayFromCenter();
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit);
    const daylight = this.sky.updateCockpitSun({
      position: this.aircraft.group.position,
      quaternion: this.aircraft.group.quaternion,
      cockpitActive: isCockpit && !isPhotoCockpit,
      dt: frameDelta,
      casterState: cockpitCasterState(this.aircraft.cockpit),
    });
    this.aircraft.cockpit.syncDaylight(daylight);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.enabled = isPhotoCockpit;
      if (isPhotoCockpit) {
        this.cockpitPhotoOverlay.update(this.telemetry);
      }
    }
    this.audio.update(frameDelta, this.telemetry, isCockpit);

    // 6. Update Camera System & Dynamic FOV (60° in cockpit eliminates fisheye speed distortion)
    let targetFov = isCockpit ? 60 : 54;
    const aspect = this.camera.aspect || (window.innerWidth / (window.innerHeight || 1));
    if (aspect < 1.0) {
      // In portrait orientation, standard vertical FOV yields a very narrow horizontal FOV:
      // hFOV = 2 * atan(tan(vFOV / 2) * aspect). At aspect = 0.46, vFOV = 60° => hFOV ≈ 29.8° (tunnel vision).
      // Dynamically expand vFOV to preserve a comfortable horizontal field of view (~76° cockpit, ~64° chase).
      const targetHFov = (isCockpit ? 76 : 64) * (Math.PI / 180);
      const vFovRad = 2 * Math.atan(Math.tan(targetHFov / 2) / aspect);
      targetFov = Math.min(100, Math.max(54, vFovRad * (180 / Math.PI)));
    }
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
    this.cameraSystem.update(frameDelta, this.aircraft.group, this.telemetry, (x, z) => this.currentTerrain.getHeight(x, z));
    this.foliage.updateCityLod(this.camera.position);

    // 7. Update HTML HUD & Diagnostics Inspector & Touch Controls
    this.updateHUD();
    this.touchControls.updateUI();
    this.diagnostics.update(frameDelta, this.telemetry);

    this.foliage.update(this.camera.position);

    // 8. Render 3D Scene
    this.renderScene();
    if (!this.hasRenderedFirstFrame) {
      this.hasRenderedFirstFrame = true;
      document.body.classList.remove('booting');
    }

    // 9. Render 2D Photorealistic Cockpit Overlay (when in photo cockpit mode)
    if (isPhotoCockpit && this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.render(this.renderer);
    }
  }

  updateHUD() {
    const elIas = document.getElementById('hud-ias');
    const elAlt = document.getElementById('hud-alt');
    const elHdg = document.getElementById('hud-hdg');
    const elVsi = document.getElementById('hud-vsi');
    const elN1 = document.getElementById('hud-n1');
    const elFlaps = document.getElementById('hud-flaps');
    const elGear = document.getElementById('hud-gear');
    const elSpoilers = document.getElementById('hud-spoilers');
    const elGForce = document.getElementById('hud-g');
    const elStall = document.getElementById('hud-stall');
    const elCam = document.getElementById('hud-cam');

    if (elIas) elIas.textContent = `${Math.round(this.telemetry.iasKnots)} KT`;
    if (elAlt) elAlt.textContent = `${Math.round(this.telemetry.altitudeFt)} FT`;
    if (elHdg) elHdg.textContent = `${Math.round(this.telemetry.headingDeg).toString().padStart(3, '0')}°`;
    if (elVsi) elVsi.textContent = `${Math.round(this.telemetry.vsiFpm)} FPM`;
    if (elN1) elN1.textContent = `${Math.round(this.telemetry.engine1 ? this.telemetry.engine1.n1 : 22)}%`;
    if (elFlaps) elFlaps.textContent = `${Math.round(this.telemetry.flapDegree)}°`;
    if (elGear) {
      const states = Object.values(this.telemetry.gearDamage || {});
      const failed = states.includes('collapsed');
      const damaged = states.includes('damaged');
      elGear.textContent = failed ? 'FAIL' : damaged ? 'DMG' : this.telemetry.gearState > 0.95 ? 'DOWN' : (this.telemetry.gearState < 0.05 ? 'UP' : 'TRANS');
      elGear.className = failed ? 'status-danger' : damaged ? 'status-amber' : this.telemetry.gearState > 0.95 ? 'status-green' : (this.telemetry.gearState < 0.05 ? 'status-dim' : 'status-amber');
    }
    if (elSpoilers) {
      elSpoilers.textContent = this.telemetry.spoilers > 0.1 ? 'EXT' : 'ARM';
      elSpoilers.className = this.telemetry.spoilers > 0.1 ? 'status-amber' : 'status-green';
    }
    if (elGForce) elGForce.textContent = `${this.telemetry.gForce.toFixed(2)} G`;
    if (elStall) {
      elStall.style.display = this.telemetry.isStalled ? 'block' : 'none';
    }
    if (elCam) elCam.textContent = this.cameraSystem.getModeName();
    this.updateAutopilotUI();
    updateControlState(this.telemetry, this.cameraSystem);
  }

  flightPhase() {
    const t0 = this.telemetry;
    if (t0.onGround) return 'GND';
    if (this.autopilot.lateralMode === 'APP') return 'APP';
    if (t0.vsiFpm > 300) return 'CLB';
    if (t0.vsiFpm < -300) return 'DES';
    return 'CRZ';
  }

  updateAutopilotUI() {
    const elPhase = document.getElementById('hud-phase');
    if (elPhase) {
      const text = t(`phase.${this.flightPhase().toLowerCase()}`);
      if (elPhase.textContent !== text) elPhase.textContent = text;
    }
    const elModes = document.getElementById('hud-ap-modes');
    if (elModes) {
      const modes = this.autopilot.annunciation();
      if (elModes.textContent !== modes) elModes.textContent = modes;
    }
    const pressed = {
      'btn-ap': this.autopilot.master,
      'btn-ap-hdg': this.autopilot.lateralMode === 'HDG',
      'btn-ap-alt': this.autopilot.verticalMode === 'ALT',
      'btn-ap-spd': this.autopilot.speedMode,
      'btn-ap-app': this.autopilot.lateralMode === 'APP' || this.autopilot.appArmed,
    };
    for (const [id, on] of Object.entries(pressed)) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.classList.toggle('ap-active', on);
      btn.classList.toggle('ap-armed', id === 'btn-ap-app' && this.autopilot.appArmed);
      btn.setAttribute('aria-pressed', String(on));
    }
    const btnToggle = document.getElementById('btn-ap-toggle');
    const apBar = document.getElementById('ap-bar');
    if (btnToggle) {
      const collapsed = Boolean(apBar && apBar.classList.contains('ap-collapsed'));
      btnToggle.classList.toggle('ap-active', collapsed && this.autopilot.master);
    }
  }

  updateApToggleUI() {
    const bar = document.getElementById('ap-bar');
    const btn = document.getElementById('btn-ap-toggle');
    if (!bar || !btn) return;
    const collapsed = bar.classList.contains('ap-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = collapsed ? '▸' : '▾';
    bindText(btn, () => t(collapsed ? 'ap.expand' : 'ap.collapse'), 'aria-label');
    bindText(btn, () => t(collapsed ? 'ap.expand.tip' : 'ap.collapse.tip'), 'title');
    btn.classList.toggle('ap-active', collapsed && this.autopilot.master);
  }

  updateAudioUI(state) {
    if (!state && this.audio) state = this.audio.getVolumeState();
    if (!state) return;

    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
      btnMute.textContent = state.muted ? '🔇' : '🔊';
      btnMute.setAttribute('aria-pressed', String(state.muted));
      bindText(btnMute, () => t(state.muted ? 'ui.unmute' : 'ui.mute'), 'aria-label');
      bindText(btnMute, () => t(state.muted ? 'ui.unmute' : 'ui.mute'), 'title');
    }
    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      if (state.muted) {
        btnSound.className = 'btn btn-preset btn-sound-toggle muted';
        bindText(btnSound, () => t('muted'));
      } else {
        btnSound.className = 'btn btn-preset btn-sound-toggle';
        bindText(btnSound, () => t('sound.100'));
      }
    }
  }

  showToast(msg) {
    const toast = document.getElementById('toast-msg');
    if (!toast) return;
    bindText(toast, () => typeof msg === 'function' ? msg() : msg);
    toast.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2500);
  }

  renderScene() {
    prepareCockpitShadowDepth(this.aircraft.group);
    this.sky.prepareRender(this.camera);
    this.renderer.render(this.scene, this.camera);
    if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT &&
        (!this.cameraSystem.photoCockpit || this.cameraSystem.isLookingAwayFromCenter())) {
      this.cockpitOcclusion.render(this.renderer, this.renderQuality);
    }
  }

  setRenderQuality(value) {
    this.renderQuality = resolveRenderQuality(value);
    const preset = RENDER_QUALITY[this.renderQuality];
    if (this.terrain.getQuality() !== preset.terrain) this.terrain.setQuality(preset.terrain);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
    document.getElementById('render-quality').value = this.renderQuality;
    try { localStorage.setItem(RENDER_QUALITY_KEY, this.renderQuality); } catch { /* Session-only setting. */ }
  }

  initUI() {
    const qualitySelect = document.getElementById('render-quality');
    qualitySelect.value = this.renderQuality;
    qualitySelect.addEventListener('change', () => this.setRenderQuality(qualitySelect.value));
    document.getElementById('btn-flaps-ext')?.addEventListener('click', () => this.controls.onCycleFlaps(1));
    document.getElementById('btn-flaps-ret')?.addEventListener('click', () => this.controls.onCycleFlaps(-1));
    document.getElementById('btn-gear')?.addEventListener('click', () => this.controls.onToggleGear());
    document.getElementById('btn-spoilers')?.addEventListener('click', () => this.controls.onToggleSpoilers());
    document.getElementById('btn-reverser')?.addEventListener('click', () => this.controls.onToggleReverser());
    document.getElementById('btn-cam-reset')?.addEventListener('click', () => {
      this.cameraSystem.resetLook();
      this.showToast(() => t('camera.view.centered'));
    });
    document.getElementById('btn-mute')?.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.isMuted);
      if (!this.audio.isMuted) {
        this.audio.init();
        this.audio.ensureContextRunning();
      }
      this.updateAudioUI();
    });
    document.getElementById('btn-sound')?.addEventListener('click', () => this.controls.onToggleAudio());
    document.getElementById('btn-diag')?.addEventListener('click', () => this.diagnostics.toggle());
    document.getElementById('btn-touch-toggle')?.addEventListener('click', () => {
      this.touchControls.toggle();
      const state = this.touchControls.enabled ? 'state.on' : 'state.off';
      this.showToast(() => t('touch.controls.value', { value: t(state) }));
    });
    for (const [id, mode] of [
      ['btn-ap', 'MASTER'], ['btn-ap-hdg', 'HDG'], ['btn-ap-alt', 'ALT'],
      ['btn-ap-spd', 'SPD'], ['btn-ap-app', 'APP'],
    ]) {
      document.getElementById(id)?.addEventListener('click', () => {
        const on = this.autopilot.toggle(mode, this.telemetry);
        if (mode === 'MASTER') {
          this.showToast(() => t('notice.autopilot', { state: t(on ? 'state.on' : 'state.off') }));
        } else {
          this.showToast(() => t('notice.ap.modes', { modes: this.autopilot.annunciation() || t('state.off') }));
        }
        this.updateAutopilotUI();
      });
    }
    document.getElementById('btn-ap-toggle')?.addEventListener('click', () => {
      document.getElementById('ap-bar')?.classList.toggle('ap-collapsed');
      this.updateApToggleUI();
    });
    this.updateApToggleUI();

    // Initialize Demo Director UI bindings
    this.demoDirector.initUI();

    // Lobby + pause menu bindings
    this.lobbyScreen = initLobbyScreen({
      getAirport: () => this.lobby.airport,
      getPreset: () => this.lobby.preset,
      getTime: () => this.sky.timeOfDay,
      onAirport: id => this.setAirport(id),
      onPreset: type => {
        this.lobby.preset = type;
        this.lobbyScreen.refresh();
      },
      onTime: hours => this.setTimeOfDay(hours),
      onFly: () => this.fly(),
    });
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => this.gameFlow.resume());
    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.gameFlow.resume();
      this.setPreset(this.lastPresetType || 'runway');
    });
    document.getElementById('btn-pause-lobby')?.addEventListener('click', () => this.gameFlow.returnToLobby(true));
    document.getElementById('menu-toggle')?.addEventListener('click', () => this.toggleMainMenu());

    // ESC chain: the demo director consumes ESC first (take manual control);
    // otherwise panels/help modal close before the pause menu opens.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (this.isCrashed) return;
      if (document.getElementById('hud-overlay')?.classList.contains('panel-open')) return;
      const helpModal = document.getElementById('help-modal');
      if (helpModal?.classList.contains('visible')) {
        helpModal.classList.remove('visible');
        return;
      }
      if (this.gameFlow.state === FLOW.FLIGHT) this.gameFlow.pause();
      else if (this.gameFlow.state === FLOW.PAUSED) this.gameFlow.resume();
    });

    // Initialize Audio UI state
    this.updateAudioUI();

    // Flight Guide Modal
    const helpModal = document.getElementById('help-modal');
    document.getElementById('btn-help')?.addEventListener('click', () => {
      helpModal?.classList.toggle('visible');
    });
    document.getElementById('btn-help-close')?.addEventListener('click', () => {
      helpModal?.classList.remove('visible');
    });

    // Crash dialog: the only action is back to the main menu [Space / R / Enter]
    document.getElementById('btn-crash-lobby')?.addEventListener('click', () => {
      this.exitCrashToLobby();
    });

    const toggleYokes = () => {
      const visible = this.aircraft.cockpit.toggleYokes();
      const button = document.getElementById('btn-yokes');
      if (button) {
        bindText(button, () => touchLabel(visible ? t('hide.yokes.j') : t('show.yokes.j')));
        button.setAttribute('aria-pressed', String(!visible));
      }
    };
    document.getElementById('btn-yokes')?.addEventListener('click', toggleYokes);
    window.addEventListener('keydown', e => {
      if (this.gameFlow.blocksFlightInput()) return;
      if (e.code === 'KeyJ' && !e.repeat && !e.target?.closest?.('input, textarea, select, [contenteditable]')) {
        toggleYokes();
      }
    });

    // Toggle Cockpit Photo Mode by clicking HUD Camera item
    document.getElementById('hud-cam')?.addEventListener('click', () => {
      if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT) {
        const isPhoto = this.cameraSystem.toggleCockpitPhoto();
        this.showToast(() => isPhoto ? t('photo.cockpit.panel') : t('3d.virtual.cockpit'));
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.target?.closest?.('select')) return;
      if (this.gameFlow.blocksFlightInput()) return;
      if (this.isCrashed && (e.code === 'Space' || e.code === 'KeyR' || e.code === 'Enter')) {
        this.exitCrashToLobby();
      }
      if (e.code === 'F2') {
        if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT) {
          const isPhoto = this.cameraSystem.toggleCockpitPhoto();
          this.showToast(() => isPhoto ? t('photo.cockpit.panel') : t('3d.virtual.cockpit'));
        }
      }
      if (e.code === 'KeyO') {
        this.cameraSystem.resetLook();
        this.showToast(() => t('camera.view.centered'));
      }
    });
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    const isCockpit = this.cameraSystem && this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    let targetFov = isCockpit ? 60 : 54;
    if (this.camera.aspect < 1.0) {
      const targetHFov = (isCockpit ? 76 : 64) * (Math.PI / 180);
      const vFovRad = 2 * Math.atan(Math.tan(targetHFov / 2) / this.camera.aspect);
      targetFov = Math.min(100, Math.max(54, vFovRad * (180 / Math.PI)));
    }
    this.camera.fov = targetFov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.onResize(window.innerWidth, window.innerHeight);
    }
  }
}

// Start Simulator when DOM is ready (guaranteed across all browser lifecycle states)
function initFlightSimulator() {
  if (!window.simulator) {
    window.simulator = new FlightSimulator();
    window.sim = window.simulator;
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initFlightSimulator);
} else {
  initFlightSimulator();
}
