import { FlightWarnings, terrainConflictSeconds } from './systems/FlightWarnings.js';
import { HangangScenario } from './director/HangangScenario.js';
import { HANGANG_COURSE } from './config/hangangCourse.js';
import { AircraftBreakup } from './effects/AircraftBreakup.js';
import { t, bindText, initLocalization } from './i18n/index.js';
import * as THREE from 'three';
import { cockpitCasterState } from './aircraft/CockpitLighting.js';
import { CockpitShadowDemo, SHADOW_VIEWS } from './director/CockpitShadowDemo.js';
import { CockpitOcclusion } from './aircraft/CockpitOcclusion.js';
import { prepareCockpitShadowDepth } from './aircraft/CockpitDepth.js';
import { Atmosphere } from './physics/Atmosphere.js';
import { AIRCRAFT_REGISTRY, BOEING_737_800 } from './config/aircraftConfigs.js';
import { Aerodynamics, createAeroResult } from './physics/Aerodynamics.js';
import { SIM_CONFIG } from './config/simConfig.js';
import { advancePhysicsFrame, clampFrameDelta, stepPhysics } from './core/physicsTiming.js';
import { EngineModel, asymmetricThrustYawMoment } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { BODY_SUPPORT_POINTS, FALLBACK_BODY_SUPPORT_POINTS } from './physics/groundContacts.js';
import { constrainBodyContact } from './physics/bodyContactConstraint.js';
import { AutopilotController } from './physics/Autopilot.js';
import { solveTrim } from './physics/TrimSolver.js';
import { rebaseCgVelocity, translateModelOrigin } from './physics/massKinematics.js';
import { takeoffPerformance } from './physics/TakeoffPerformance.js';
import { stallSpeedEstimate } from './physics/stallSpeedEstimate.js';
import { LoadingPanel } from './ui/LoadingPanel.js';
import { PFDCanvas } from './aircraft/PFDCanvas.js';
import { NDCanvas } from './aircraft/NDCanvas.js';
import { EICASCanvas } from './aircraft/EICASCanvas.js';
import { MCPCanvas } from './aircraft/MCPCanvas.js';
import { ISFDCanvas } from './aircraft/ISFDCanvas.js';
import { CDUCanvas } from './aircraft/CDUCanvas.js';
import { Boeing737 } from './aircraft/Boeing737.js';
import { Cessna172 } from './aircraft/Cessna172.js';
import { F16 } from './aircraft/F16.js';
import { Terrain } from './environment/Terrain.js';
import { RENDER_QUALITY, RENDER_QUALITY_KEY, resolveRenderQuality } from './config/renderQuality.js';
import { WaterOcean } from './environment/WaterOcean.js';
import { loadIncheonAirport } from './environment/IncheonAirport.js';
import { incheonSpawn } from './geospatial/IncheonFlightSurface.js';
import { Airport } from './environment/Airport.js';
import { FoliageAndCities } from './environment/FoliageAndCities.js';
import { Ships } from './environment/Ships.js';
import { SkyAtmosphere } from './environment/SkyAtmosphere.js';
import { LuklaTerrain } from './environment/LuklaTerrain.js';
import { LuklaAirport } from './environment/LuklaAirport.js';
import { NeonCity } from './environment/NeonCity.js';
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
import { initLobbyScreen, LOBBY_AIRCRAFT_IDS } from './ui/LobbyScreen.js';
import { DeveloperModeController } from './dev/DeveloperModeController.js';
import { DevScenarioRunner } from './dev/DevScenarioRunner.js';
import { DeveloperPanel } from './ui/DeveloperPanel.js';
import { RenderDiagnostics } from './dev/RenderDiagnostics.js';
import { RenderDiagnosticsPanel } from './ui/RenderDiagnosticsPanel.js';
import {
  DEFAULT_SCENARIO,
  defaultScenarioForRegion,
  isScenarioAvailable,
} from './config/scenarioRegistry.js';
import {
  loadSavedFlightSelection,
  saveSavedAirport,
  saveSavedAircraft,
  saveSavedScenario,
} from './config/flightSelection.js';
import { resolveFlightUrl } from './config/flightUrls.js';
import { TouchFlightControls } from './controls/TouchFlightControls.js';
import { CockpitPhotoOverlay } from './aircraft/CockpitPhotoOverlay.js';
import { initBuildInfo } from './ui/BuildInfo.js';
import { installInputLatencyMonitor } from './ui/InputLatencyMonitor.js';

// Expose THREE globally for test harness and browser console debugging
if (typeof window !== 'undefined') {
  window.THREE = THREE;
}

initLocalization();
initBuildInfo();

// Window-level flight shortcuts must not run behind the loading screen.
window.addEventListener('keydown', event => {
  if (document.body.classList.contains('booting') && event.target?.id !== 'startup-retry') {
    if (event.key !== 'Tab') event.preventDefault();
    event.stopImmediatePropagation();
  }
}, { capture: true });

async function startupStage(value, message) {
  document.getElementById('startup-progress').value = value;
  bindText(document.getElementById('startup-status'), () => t(message));
  // Two frames ensure the updated stage paints before synchronous construction.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function showStartupError(error) {
  console.error('Simulator startup failed:', error);
  bindText(document.getElementById('startup-status'), () => t('startup.failed'));
  document.getElementById('startup-progress').hidden = true;
  document.getElementById('startup-retry').hidden = false;
}

// Attach latency telemetry before the simulator constructor: its synchronous scene
// build is exactly the window where user input stalls, and event-timing entries are
// buffered retroactively to navigation start.
const inputLatency = installInputLatencyMonitor();

/**
 * Main Simulation Coordinator
 * Integrates 6-DOF rigid body physics, aircraft systems, procedural world, audio, and user interface.
 */
class FlightSimulator {
  async initialize() {
    await startupStage(0, 'startup.scene');
    const savedSelection = resolveFlightUrl(window.location.search, loadSavedFlightSelection());
    this.container = document.getElementById('canvas-container');
    this.inputLatency = inputLatency;

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

    await startupStage(1, 'startup.aircraft');

    // 3. Aircraft 3D Model
    this.aircraft = this.buildAircraftInstance(savedSelection.aircraft);
    this.aircraftInstances = new Map([[savedSelection.aircraft, this.aircraft]]);
    this.scene.add(this.aircraft.group);
    this.cockpitOcclusion = new CockpitOcclusion(this.scene, this.camera, this.aircraft.cockpit);
    try {
      this.cockpitOcclusion.enabled = localStorage.getItem('flight3d.cockpitQuality') !== 'performance';
    } catch { /* Use detailed cockpit shading. */ }
    this.warmCockpitShaders(this.aircraft);

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
    this.engines.bindMassProperties(this.aero.massProperties);
    this.gear = new LandingGear();

    await startupStage(2, 'startup.world');

    // 5. Procedural World & Real-World Environments
    this.terrain = new Terrain(22000, 256, { quality: RENDER_QUALITY[this.renderQuality].terrain });
    this.scene.add(this.terrain.mesh);

    this.water = new WaterOcean(36000);
    this.scene.add(this.water.mesh);

    this.airport = new Airport();
    this.scene.add(this.airport.group);
    this.terrain.excludePavement(this.airport.group);

    this.foliage = new FoliageAndCities(this.terrain);
    this.scene.add(this.foliage.group);

    this.ships = new Ships(this.water, { deferAssets: true });
    this.scene.add(this.ships.group);

    // Construct Lukla's terrain/airport only when selected, including its DEM
    // and satellite requests. Hidden scenery must not compete with startup.

    // Neon Metropolis 80s Synthwave City & Flight Canyons
    this.neonCity = new NeonCity();
    this.neonCity.group.visible = false;
    this.scene.add(this.neonCity.group);

    this.activeAirport = null; // initUI and setAirport below configure the active airport
    this.currentTerrain = this.terrain;
    this.currentAirport = this.airport;

    this.sky = new SkyAtmosphere(this.scene, this.renderer, this.water);
    this.sky.setShadowMapSize(RENDER_QUALITY[this.renderQuality].shadowMapSize);
    this.foliage.setTimeOfDay(this.sky.timeOfDay);
    this.water.syncWithAtmosphere(this.sky);

    await startupStage(3, 'startup.controls');

    // 6. Audio & Controls & Camera & Diagnostics
    this.audio = new FlightAudio();
    this.controls = new FlightControls(this.renderer.domElement);
    this.touchControls = new TouchFlightControls(this.controls);
    initFlightPanels({
      onCycleCamera: () => this.controls.onCycleCamera(),
      onSelectCamera: mode => this.controls.onSelectCamera(mode),
      onToggleAutoCamera: () => {
        this.cameraSystem.toggleAutoViewing();
        if (this.demoDirector?.isActive) this.demoDirector.onUserCameraChange();
      },
    });
    this.cameraSystem = new CameraSystem(this.camera, this.renderer.domElement);
    this.cameraSystem.setTerrain(this.terrain);
    this.cameraSystem.onResetLook = () => {
      this.showToast(() => t('camera.view.centered'));
    };
    this.loadAircraftConfig(AIRCRAFT_REGISTRY[savedSelection.aircraft] || BOEING_737_800);
    this.diagnostics = new DiagnosticsInspector(this);
    this.demoDirector = new DemoFlightDirector(this);
    this.shadowDemo = new CockpitShadowDemo(this, () => this.updateShadowDemoUi());
    this.developerMode = new DeveloperModeController(() => {
      this.devRunner?.stop(); this.renderDiagnosticsPanel?.close();
    });
    this.renderDiagnostics = new RenderDiagnostics(this);
    this.devRunner = new DevScenarioRunner(this, this.developerMode);

    // Game flow: lobby (cinematic menu) / flight / paused
    this.gameFlow = new GameFlowController({
      isDemoActive: () => this.demoDirector.isActive,
      isDemoWaiting: () => this.demoDirector.waitingForTerrain === true,
      onStateChange: () => this.syncFlowUi(),
    });
    this.lobby = { airport: savedSelection.airport, preset: savedSelection.scenario, aircraft: savedSelection.aircraft };
    this.currentAircraftId = savedSelection.aircraft;
    this.lastPresetType = savedSelection.scenario;

    // 7. Collision Detection & Explosion & Tire Smoke Particle Systems
    this.collisionDetector = new CollisionDetector(
      this.currentTerrain,
      this.currentAirport,
      this.foliage,
      this.ships,
      this.water
    );
    this.explosionSystem = new ExplosionSystem(this.scene, this.currentTerrain);
    this.aircraftBreakup = new AircraftBreakup(this.scene);
    this.tireSmokeSystem = new TireSmokeSystem(this.scene, this.currentTerrain);
    this.isCrashed = false;
    this.crashResult = null;
    this.isCrashReportMinimized = true;
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
    this.physicsHz = SIM_CONFIG.physics.targetHz;
    this.physicsDt = SIM_CONFIG.physics.fixedDt;
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
      isStallWarning: false,
      gearState: 1.0,
      isTransit: false,
      flapDegree: 5,
      flapIndex: 2,
      spoilers: 0,
      touchdown: false,
      onGround: true,
      demoActive: false,
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
    this._cgBefore = new THREE.Vector3();
    this._rotationBefore = new THREE.Quaternion();
    this._performanceClock = 0;
    this.takeoff = null;
    this.actualTakeoffMassKg = null;
    this.loadingPanel = new LoadingPanel(this);
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
    this._aeroResult = createAeroResult();
    this._apState = {
      airportKey: 'coastal',
      headingDeg: 0, rollDeg: 0, pitchDeg: 0,
      altitudeFt: 0, vsiFpm: 0, iasKnots: 0, tasKnots: 0,
      throttle: 0, x: 0, z: 0,
    };

    this.initControls();
    this.initUI();
    await this.setAirport(savedSelection.airport);

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());

    // Start with the flight when autoplay is permitted. Otherwise the browser
    // keeps the context suspended until the first flight/menu interaction.
    const ensureAudio = () => {
      if (!this.audio.isInitialized) {
        this.audio.init();
      }
      this.audio.ensureContextRunning();
    };
    ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'].forEach(evt => {
      // Controls may consume the event before it bubbles to window.
      window.addEventListener(evt, ensureAudio, { passive: true, capture: true });
    });
    ensureAudio();

    // Begin Animation Loop
    this.hasRenderedFirstFrame = false;
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // Open straight into the flight HUD rather than the main menu. The menu
    // and its cinematic backdrop stay reachable via the persistent top-left
    // toggle (or ESC > pause). #123 hardcoded the markup to
    // boot at the lobby, so that first-paint attribute is flipped to flight too.
    this.fly();
    inputLatency?.mark('fly');
    this.syncFlowUi();
  }

  initControls() {
    this.controls.onUserInteract = () => {
      this.audio.init();
      this.audio.ensureContextRunning();
    };

    this.controls.onToggleGear = () => {
      if (this.devRunner?.active) return;
      this.gear.toggleGear();
    };

    this.controls.onToggleSpoilers = () => {
      if (this.devRunner?.active) return;
      this.aero.toggleSpoilers();
    };

    this.controls.onCycleFlaps = (inc) => {
      if (this.devRunner?.active) return;
      this.aero.cycleFlaps(inc);
      this.telemetry.flapIndex = this.aero.flapsIndex;
      this.telemetry.flapDegree = this.aero.currentFlapAngle;
    };

    this.controls.onToggleReverser = () => {
      if (this.devRunner?.active) return;
      this.engines.toggleReverser(this.telemetry.onGround);
    };

    this.controls.onCycleEngineFailure = () => {
      if (this.devRunner?.active) return;
      if (this.engines.numEngines === 1) {
        const isFailed = !this.engines.failed[0];
        this.engines.setEngineFailure(0, isFailed);
        this.showToast(() => isFailed ? t('notice.engineFailure', { which: '1' }) : t('notice.enginesRecovered'));
        return;
      }
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

    this.controls.onResetLook = () => {
      this.cameraSystem.resetLook();
      this.showToast(() => t('camera.view.centered'));
    };

    this.controls.onDeviceConnected = (device) => {
      this.showToast(() => t('notice.hotasConnected', { name: device.name }));
    };

    this.controls.onDeviceDisconnected = (device) => {
      this.showToast(() => t('notice.hotasDisconnected', { name: device.name }));
    };
  }

  /** Apply the game-flow state to the DOM: menu visibility, input blocking. */
  syncFlowUi() {
    const state = this.gameFlow.state;
    this.audio?.departureRadio.setPaused(state !== FLOW.FLIGHT);
    document.body.dataset.flow = state;
    if (state === FLOW.FLIGHT) {
      const attribution = document.getElementById('incheon-attribution');
      attribution?.classList.remove('expanded');
      attribution?.querySelector('#incheon-attribution-chip')?.setAttribute('aria-expanded', 'false');
    }
    document.body.dataset.devScenario = String(Boolean(this.devRunner?.active));
    this.controls.inputBlocked = this.gameFlow.blocksFlightInput() || this.shadowDemo.active || Boolean(this.devRunner?.active);
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
    if (this.airportLoading || this.lobbySelectionPending) return;
    saveSavedAirport(this.activeAirport || this.lobby.airport);
    saveSavedAircraft(this.currentAircraftId || this.lobby.aircraft);
    saveSavedScenario(this.lobby.preset);
    this.devRunner.stop();
    this.shadowDemo.stop();
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
    if (glyph) glyph.textContent = open ? '✕' : '';
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

  loadAircraftConfig(config = BOEING_737_800) {
    this.currentAircraftConfig = config;
    this.flightWarnings ??= new FlightWarnings();
    this.flightWarnings.configure(config);
    if (this.telemetry) this.telemetry.warnings = [];
    this.audio?.loadAircraftConfig(config);
    if (this.aero?.loadConfig) this.aero.loadConfig(config);
    if (this.engines?.loadConfig) {
      this.engines.loadConfig(config);
      this.engines.bindMassProperties(this.aero.massProperties);
    }
    if (this.gear?.loadConfig) this.gear.loadConfig(config);
    if (this.cameraSystem?.loadAircraftConfig) this.cameraSystem.loadAircraftConfig(config);
    if (this.collisionDetector?.loadAircraftConfig) this.collisionDetector.loadAircraftConfig(config);
  }

  /**
   * Compile the flight-deck programs while the interior is off-screen so the first
   * cockpit view of that model does not pay for them. Bound to the instance because
   * models persist across selections.
   */
  warmCockpitShaders(aircraft) {
    const cockpit = aircraft.cockpit;
    if (!cockpit || !cockpit.gltfCockpitGroup) return;
    cockpit.onModelReady = () => {
      this.renderDiagnostics?.refreshScene();
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
  }

  /**
   * A lobby selection rebuilds scene state and uploads new GPU programs, so the work
   * runs after the menu has painted the new choice: the click task stays short and the
   * progress line is visible instead of the menu appearing frozen. The lobby holds the
   * wanted airport and aircraft, so a choice made while work is running is applied by the
   * next pass instead of cancelling the earlier one — a newer click replaces the pending
   * work rather than dropping it, and the drain stops once the scene matches the menu.
   */
  queueLobbySelection() {
    this.lobbySelectionPending = true;
    this.lobbyScreen?.setSelectionBusy(true);
    inputLatency?.noteSelectionStart();
    if (this.lobbySelectionDraining) return;
    this.lobbySelectionDraining = true;
    const nextPaint = () => new Promise(resolve => document.hidden
      ? setTimeout(resolve, 0)
      : requestAnimationFrame(() => requestAnimationFrame(resolve)));
    nextPaint().then(async () => {
      try {
        while (this.lobby.airport !== this.activeAirport || this.lobby.aircraft !== this.currentAircraftId) {
          const applied = `${this.activeAirport}|${this.currentAircraftId}`;
          if (this.lobby.airport !== this.activeAirport) await this.setAirport(this.lobby.airport);
          else this.setAircraft(this.lobby.aircraft);
          // A refused choice (unknown id, failed scenery load) must not spin the drain.
          if (`${this.activeAirport}|${this.currentAircraftId}` === applied) break;
        }
      } catch (error) {
        console.warn('Lobby selection failed:', error);
      } finally {
        this.lobbySelectionDraining = false;
        this.lobbySelectionPending = false;
        this.lobbyScreen?.setSelectionBusy(false);
        inputLatency?.noteSelectionApplied();
      }
    });
  }

  /**
   * Construct an aircraft model for the per-session cache. The instrument canvases are
   * shared: a model only draws into them while it is the active aircraft, so building a
   * second one ahead of the user's pick costs memory but cannot disturb the current view.
   */
  buildAircraftInstance(aircraftId) {
    if (aircraftId === 'F16') return new F16();
    return aircraftId === 'C172'
      ? new Cessna172(this.pfdCanvas, this.ndCanvas)
      : new Boeing737(
        this.pfdCanvas,
        this.ndCanvas,
        this.eicasCanvas,
        this.mcpCanvas,
        this.isfdCanvas,
        this.cduCanvas
      );
  }

  /**
   * Build and warm a model the lobby offers but the scene does not have yet, without
   * touching the active aircraft. Selecting it later then costs the cache hit plus the
   * first-draw uploads, instead of those uploads and the whole geometry build.
   */
  prebuildAircraftInstance(aircraftId) {
    if (!AIRCRAFT_REGISTRY[aircraftId]) return false;
    if (this.aircraftInstances.has(aircraftId)) return false;
    let instance;
    try {
      instance = this.buildAircraftInstance(aircraftId);
    } catch (error) {
      console.warn(`Aircraft preload failed for ${aircraftId}:`, error);
      return false;
    }
    this.aircraftInstances.set(aircraftId, instance);
    this.warmCockpitShaders(instance);
    // Lets a report answer the question this raised: did warmup land before the pick?
    inputLatency?.mark(`aircraft-preload:${aircraftId}`);
    return true;
  }

  /**
   * Prepare the selected model behind the startup overlay.
   */
  scheduleAircraftPreload() {
    if (this.aircraftPreloadScheduled) return;
    this.aircraftPreloadScheduled = true;
    this.finishStartup().catch(showStartupError);
  }

  async finishStartup() {
    await startupStage(4, 'startup.preload');
    await startupStage(5, 'startup.cockpit');
    const deadline = performance.now() + 60000;
    while (this.aircraft.cockpit?.cockpitModelLoading || this.aircraft.loadingGltf) {
      if (performance.now() > deadline) throw new Error('Startup assets timed out');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    let timeout;
    try {
      await Promise.race([
        Promise.resolve(this.aircraft.cockpit?.shaderWarmup),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Startup shaders timed out')), Math.max(0, deadline - performance.now()));
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    await startupStage(6, 'startup.ready');
    this.startupReady = true;
    document.body.classList.remove('booting');
    document.getElementById('startup-overlay').hidden = true;
    document.getElementById('canvas-container').inert = false;
    document.getElementById('hud-overlay').inert = false;
    // Loading time must not turn into accumulated simulation time.
    this.clock.getDelta();
    inputLatency?.mark('startup-complete');
    // Paint the usable lobby before preparing optional aircraft. Each subsequent
    // model gets its own task so background work cannot delay overlay removal.
    const remaining = LOBBY_AIRCRAFT_IDS.filter(id => id !== this.currentAircraftId);
    const preloadNext = () => {
      const id = remaining.shift();
      if (!id) return;
      this.prebuildAircraftInstance(id);
      if (remaining.length) setTimeout(preloadNext, 1000);
    };
    setTimeout(preloadNext, 1000);
    setTimeout(() => {
      if (this.activeAirport === 'coastal') this.ships.loadAssets();
    }, 0);
  }

  setAircraft(aircraftId = 'B738') {
    const config = AIRCRAFT_REGISTRY[aircraftId];
    if (!config) return;
    this.hangang?.stop();
    this.renderDiagnosticsPanel?.close();
    this.devRunner?.stop();

    if (this.demoDirector && this.demoDirector.isActive && aircraftId !== this.currentAircraftId) {
      this.demoDirector.stop(() => t('manual.control.engaged'));
    }

    this.currentAircraftId = aircraftId;
    if (this.lobby) {
      this.lobby.aircraft = aircraftId;
    }
    saveSavedAircraft(aircraftId);

    // Each model is built once per session: re-constructing the 737 (geometry, cockpit
    // boolean cuts, per-vertex light-transfer binding, instrument canvases) on every
    // toggle was the bulk of the stall behind a menu click. An interior that failed to
    // load is dropped, so re-selecting the aircraft still retries the asset.
    let instance = this.aircraftInstances.get(aircraftId);
    if (instance?.cockpit?.cockpitModelFailed) {
      this.scene.remove(instance.group);
      this.aircraftInstances.delete(aircraftId);
      instance = null;
    }
    if (!instance) {
      instance = this.buildAircraftInstance(aircraftId);
      this.aircraftInstances.set(aircraftId, instance);
      this.warmCockpitShaders(instance);
    }
    if (this.aircraft && this.aircraft !== instance) {
      this.scene.remove(this.aircraft.group);
    }
    this.aircraft = instance;
    if (instance.group.parent !== this.scene) {
      this.scene.add(instance.group);
    }
    this.loadAircraftConfig(config);

    if (this.cockpitOcclusion && this.aircraft.cockpit) {
      this.cockpitOcclusion.cockpit = this.aircraft.cockpit;
    }

    if (this.cameraSystem) {
      if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT && this.aircraft.cockpit?.cockpitModelFailed) {
        this.cameraSystem.setMode(CameraSystem.MODES.CHASE, true);
        this.showToast(() => t('notice.cockpit.unavailable'));
      }
      this.cameraSystem.snapToTarget(this.aircraft.group);
    }

    this.showToast(() => t('notice.aircraft', { name: config.name }));
  }

  setPreset(type, isDemoInternal = false) {
    this.hangang?.stop();
    if (type === 'shadow' && !this.devRunner?.changingState) {
      return this.devRunner?.start('shadow') ?? false;
    }
    this.devRunner?.stop();
    // Scenario availability depends on the active airport; an unavailable
    // pick (e.g. cliff at coastal) falls back instead of leaving a stale pose.
    if (!isScenarioAvailable(this.activeAirport, type)) type = defaultScenarioForRegion(this.activeAirport);
    this.shadowDemo?.stop();
    this.lastPresetType = type;
    if (type === 'hangang' && this.currentAircraftId !== 'C172') this.setAircraft('C172');
    this.audio?.reset();
    this.flightWarnings?.reset();
    this.telemetry.warnings = [];
    if (!isDemoInternal) this.loadAircraftConfig(this.currentAircraftConfig || BOEING_737_800);
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
    this.lastGearTarget = this.gear.isFixed ? true : (type !== 'cruise');
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
    this.bodyContactNotices = new Set();
    this.landingRestTime = 0;

    if (this.isCrashed) {
      this.clearCrashState();
    }

    const groundClearance = this.gear?.cgGroundHeightM ?? 3.5;

    if (type === 'hangang') {
      this.hangang ??= new HangangScenario(this);
      this.hangang.start();
      this.position.set(...HANGANG_COURSE.spawn);
      this.linearVelocity.set(0, 0, -HANGANG_COURSE.speedMs);
      this.angularVelocity.set(0, 0, 0);
      this.quaternion.identity();
      this.controls.throttle = 0.5;
      this.engines.setThrottle(0.5);
      this.engines.setReverser(false, false);
      this.gear.setGearTarget(true);
      this.gear.gearState = 1;
      this.aero.setFlapPosition(0);
      this.aero.spoilers = 0;
    } else if (this.activeAirport === 'neon') {
      const isC172 = this.currentAircraftId === 'C172';
      const c172Clearance = this.gear?.cgGroundHeightM ?? 1.4;
      const clearance = isC172 ? c172Clearance : groundClearance;

      if (type === 'runway') {
        // Lined up on the glowing Neon Highway / Runway (heading 090° East towards skyline & setting retro sun)
        this.position.set(-1800, clearance, 0);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI * 0.5, 0, 'YXZ'));

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(isC172 ? 1 : 2);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = isC172 ? 1.2 : 1.8;
        this.controls.pitchTrim = this.aero.pitchTrim;

        this.showToast(() => t('preset.neon.runway'));
      } else if (type === 'approach') {
        // Urban Canyon Slalom: 110m altitude, right between the 350m glowing skyscrapers!
        const speedMs = isC172 ? 46.0 : 70.0;
        this.position.set(200, 110, 0);
        this.linearVelocity.set(speedMs, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI * 0.5, 0, 'YXZ'));

        this.controls.throttle = 0.62;
        this.engines.setThrottle(0.62);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = isC172 ? 0.8 : 1.4;
        this.controls.pitchTrim = this.aero.pitchTrim;

        this.showToast(() => t('preset.neon.canyon'));
      } else if (type === 'cruise') {
        // Skyline Cruise: 2,500 FT (760m), 110 kts, heading 110° overlooking the glowing metropolis
        const speedMs = isC172 ? 52.0 : 120.0;
        this.position.set(-600, 760, -800);
        const headingRad = THREE.MathUtils.degToRad(110);
        this.linearVelocity.set(speedMs * Math.sin(headingRad), 0, -speedMs * Math.cos(headingRad));
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromEuler(new THREE.Euler(0, -headingRad, 0, 'YXZ'));

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(false);
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = isC172 ? 0.9 : 1.2;
        this.controls.pitchTrim = this.aero.pitchTrim;

        this.showToast(() => t('preset.neon.cruise'));
      }
    } else if (this.activeAirport === 'incheon') {
      this.currentAirport.resetTraffic();
      const spawn = incheonSpawn(type, groundClearance, this.currentAircraftId);
      this.position.set(spawn.x, spawn.y, spawn.z);
      this.linearVelocity.set(spawn.vx, spawn.vy, spawn.vz);
      this.angularVelocity.set(0, 0, 0);
      this.quaternion.setFromEuler(new THREE.Euler(type === 'approach' ? .04 : 0, spawn.yaw, 0, 'YXZ'));
      const airborne = type !== 'runway';
      this.controls.throttle = airborne ? .5 : 0;
      this.engines.setThrottle(this.controls.throttle);
      this.engines.setReverser(false, true);
      this.gear.setGearTarget(type !== 'cruise');
      this.gear.gearState = this.gear.isFixed || type !== 'cruise' ? 1 : 0;
      this.aero.setFlapPosition(type === 'approach' ? 5 : type === 'runway' ? 2 : 0);
      this.aero.spoilers = 0;
      this.controls.pitchTrim = this.aero.pitchTrim = 1.6;
      const label = { runway: 'incheon.runway', approach: 'incheon.approach', cruise: 'incheon.cruise' }[type];
      this.showToast(() => t(label));
    } else if (this.activeAirport === 'lukla') {
      const sin58 = 0.848048;
      const cos58 = 0.529919;
      const isF16 = this.currentAircraftId === 'F16';
      const isC172 = this.currentAircraftId === 'C172';
      const spawnS = isF16 ? 200.0 : 195.0;
      const spawnY = 2836.0 + spawnS * (62 / 527) + groundClearance;
      const luklaTrim = isF16 ? 0.3 : isC172 ? 0.8 : 1.9;

      if (type === 'runway') {
        // Lukla takeoffs line up at the upper Runway 24 threshold and
        // accelerate downhill toward the cliff on heading 238°; Runway 06 is the
        // landing-only direction. Same spawn as the 'cliff' preset: the 5m lateral
        // offset keeps the wide wing clear of the raised apron.
        // Spawned with clearance in front of the retaining wall so chase cameras
        // remain completely clear of the upper stone barrier.
        this.position.set(spawnS * sin58 - 5 * cos58, spawnY, -spawnS * cos58 - 5 * sin58);
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
        this.aero.setFlapPosition(isC172 ? 1 : 2); // Flaps 5 (or 10 for C172)
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = luklaTrim;
        this.controls.pitchTrim = luklaTrim;

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
        this.aero.pitchTrim = 2.2;

        this.showToast(() => t('preset.lukla.canyon.landing.challenge.10.070'));
      } else if (type === 'cliff') {
        // Lukla Runway 24 Downhill Cliff Dive Takeoff!
        // Start near the upper threshold with wheel clearance; a 5m lateral
        // offset keeps the wide wing clear of the raised apron.
        this.position.set(spawnS * sin58 - 5 * cos58, spawnY, -spawnS * cos58 - 5 * sin58);
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
        this.aero.setFlapPosition(isC172 ? 1 : isF16 ? 1 : 3); // Flaps 15 for B738, Flaps 1 for F16/C172
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = luklaTrim;
        this.controls.pitchTrim = luklaTrim;

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
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 0.9;

        this.showToast(() => t('preset.himalayan.cruise.13.000.ft'));
      }
    } else {
      // Coastal International Airport Presets
      if (type === 'runway') {
        // Aligned on Runway 09L Threshold (Heading 090° East)
        this.position.set(-1350, 12.0 + groundClearance, 0);
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
        this.aero.pitchTrim = 1.6; // Takeoff trim

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
        this.aero.pitchTrim = 2.1;

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
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0); // Clean
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 0.9;

        this.showToast(() => t('preset.coastal.cruise'));
      }
    }

    // A fresh segment restores its configured tanks/payload and clears failures.
    // Lukla's 43 t loading contains 1587 kg of fuel, not a full 14200 kg tank set.
    this.engines.refuel(this.aero);
    this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
    this.aero.syncMassProperties();
    this.actualTakeoffMassKg = null;
    this.takeoff = null;
    this.stallSpeedKnots = undefined;
    this._hasGroundContact = false;
    this.engines.failed.fill(false);
    this.engines.contactDamage.fill(0);

    if (type === 'approach' || type === 'cruise' || type === 'hangang') {
      // A preset declares a settled state, not a set of control inputs, so the
      // state variables have to be where the declared configuration puts them:
      // the wing at the commanded flap angle, the fans at the commanded N1, the
      // stick centered. Each ramps otherwise (τ = 2.5 s flaps, ~3 s spool,
      // rate-limited surfaces), and whatever the previous segment left behind is
      // not part of the declared state: 1.4° of carried-over elevator costs the
      // B738 approach spawn 0.11 qSc of pitch moment, which flies it off the
      // equilibrium installed below.
      this.aero.currentFlapAngle = this.aero.flapAngles[this.aero.flapsIndex];
      this.controls.elevator = this.controls.aileron = this.controls.rudder = 0;
      this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
      this.aero.syncMassProperties();
      this.applyComputedTrim();
      this.engines.settleSpool();
    }

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

  // One shared educational performance snapshot for CDU, PFD and loading UI.
  refreshTakeoffPerformance() {
    this.stallSpeedKnots = stallSpeedEstimate(this.aero, this.gear.gearState);
    this.takeoff = takeoffPerformance(this.aero, this.engines, {
      altitudeMeters: this.position.y, flapsIndex: this.aero.flapsIndex,
      flapAngle: this.aero.currentFlapAngle,
    });
    if (this.telemetry) this.telemetry.takeoff = this.takeoff;
    return this.takeoff;
  }

  applyLoading(loading) {
    if (this.isCrashed || !this.telemetry.onGround || this.linearVelocity.length() > 0.5) {
      throw new Error('Loading changes require a stopped aircraft on the ground.');
    }
    this._cgBefore.copy(this.aero.cg);
    this.aero.massProperties.setLoading(loading); // validates before any mutation
    this.aero.syncMassProperties();
    rebaseCgVelocity(this.linearVelocity, this.angularVelocity, this.quaternion, this._cgBefore, this.aero.cg);
    this.refreshTakeoffPerformance();
    Object.assign(this.telemetry, { massKg: this.aero.mass,
      massRevision: this.aero.massProperties.revision,
      zeroFuelMassKg: this.aero.massProperties.zeroFuelMassKg,
      fuelKg: this.engines.fuelKg, cgBody: { ...this.aero.cg } });
    this.telemetry.stallSpeedKnots = this.stallSpeedKnots;
    this.updateFlightDisplays(true);
    if (this.autopilot.master) this.autopilot.refreshTrim(this.readAutopilotState());
    return this.takeoff;
  }

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
    if (!solution.feasible || (!solution.handsOffFeasible && solution.reason !== 'idle')) return;
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
   * Switch the active airport; Incheon assets are loaded before committing the selection.
   */
  async setAirport(id) {
    this.renderDiagnosticsPanel?.close();
    if (!['coastal', 'lukla', 'incheon', 'neon', 'hangang'].includes(id)) return;
    if (this.activeAirport === id) return;
    this.hangang?.stop();
    const request = this.airportRequest = (this.airportRequest || 0) + 1;
    this.airportLoading = false;
    document.getElementById('btn-fly').disabled = false;
    if (id === 'incheon' && !this.incheonAirport) {
      this.airportLoading = true;
      document.getElementById('btn-fly').disabled = true;
      this.showToast(() => t('incheon.loading'));
      try {
        this.incheonLoad ??= loadIncheonAirport(`${import.meta.env.BASE_URL}scenery/incheon/`).then(airport => {
          this.incheonAirport = airport;
          airport.group.visible = airport.terrain.mesh.visible = false;
          this.scene.add(airport.group, airport.terrain.mesh);
          return airport;
        });
        await this.incheonLoad;
      } catch (error) {
        this.incheonLoad = null;
        console.warn('Incheon loading failed:', error);
        if (request === this.airportRequest) {
          this.showToast(() => t('incheon.load.failed'));
          // The menu already shows this airport as chosen; put the selection back.
          this.lobby.airport = this.activeAirport || 'coastal';
          this.lobbyScreen?.refresh();
          if (!this.activeAirport) await this.setAirport('coastal');
        }
        return;
      } finally {
        if (request === this.airportRequest) {
          this.airportLoading = false;
          document.getElementById('btn-fly').disabled = false;
        }
      }
      if (request !== this.airportRequest) return;
    }
    this.devRunner?.stop();
    if (this.activeAirport === id) return;
    this.activeAirport = id;
    const isLukla = id === 'lukla';
    const isIncheon = id === 'incheon';
    const isCoastal = id === 'coastal';
    const isNeon = id === 'neon';
    const isHangang = id === 'hangang';
    if (isLukla && !this.luklaTerrain) {
      this.luklaTerrain = new LuklaTerrain();
      this.luklaAirport = new LuklaAirport();
      this.scene.add(this.luklaTerrain.mesh, this.luklaAirport.group);
    }
    if (isCoastal && this.startupReady) this.ships.loadAssets();
    document.getElementById('incheon-attribution').hidden = !isIncheon;

    // Toggle 3D mesh visibility
    this.terrain.mesh.visible = isCoastal;
    this.airport.group.visible = isCoastal;
    this.water.mesh.visible = !isLukla && !isNeon;
    this.ships.group.visible = isCoastal;
    this.foliage.group.visible = isCoastal;

    if (this.luklaTerrain) this.luklaTerrain.mesh.visible = isLukla;
    if (this.luklaAirport) this.luklaAirport.group.visible = isLukla;

    if (this.incheonAirport) this.incheonAirport.group.visible = this.incheonAirport.terrain.mesh.visible = isIncheon;
    if (this.neonCity) this.neonCity.group.visible = isNeon;
    this.currentTerrain = isNeon ? this.neonCity.terrain : isIncheon ? this.incheonAirport.terrain : isLukla ? this.luklaTerrain : this.terrain;
    this.currentAirport = isNeon ? this.neonCity.airport : isIncheon ? this.incheonAirport : isLukla ? this.luklaAirport : this.airport;

    if (this.collisionDetector) {
      if (isNeon) {
        this.collisionDetector.setEnvironment(this.currentTerrain, this.currentAirport, this.neonCity);
      } else if (isIncheon) {
        this.collisionDetector.setEnvironment(this.currentTerrain, this.currentAirport);
      } else if (isLukla) {
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
      if (isNeon) {
        const t = this.neonCity.airport.controlTowerData;
        this.cameraSystem.towerPos.set(t.x, t.y + t.height - 1.5, t.z);
      } else if (isIncheon) {
        const cab = this.incheonAirport.towerCab;
        this.cameraSystem.towerPos.set(cab.x, cab.y, cab.z);
      } else if (isLukla) {
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
    if (!isScenarioAvailable(id, this.lobby.preset)) this.lobby.preset = defaultScenarioForRegion(id);
    saveSavedAirport(id);
    saveSavedScenario(this.lobby.preset);
    // A new airport re-spawns the aircraft below, so any flight held behind the
    // menu is no longer the one to return to: release it and let the cinematic back.
    this.gameFlow.abandonResumableFlight();
    this.gameFlow.setCinematicAvailable(!isIncheon && !isHangang);
    this.lobbyScreen?.refresh();

    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    this.setPreset(defaultScenarioForRegion(id));
    this.lobbyScreen?.refresh();

    const airportKey = isHangang ? 'hangang.region' : isIncheon ? 'incheon.airport' : isLukla
      ? 'tenzing.hillary.airport.nepal.vnlk.runway.24'
      : 'pacific.coastal.international.airport.runway.09l.elevation';
    this.showToast(() => t('airport.changed.value', { value: t(airportKey) }));
    this.renderDiagnostics?.refreshScene();
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
    if (this.shadowDemo?.active) return;
    // Gear/contact queries consume this mesh too. Restore the authoritative
    // transform before physics so a rendered interpolation never feeds back.
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.gear.bodySupportPoints = this.currentAircraftConfig?.landingGear?.bodySupportPoints
      ?? (this.aircraft.useGltf ? BODY_SUPPORT_POINTS : FALLBACK_BODY_SUPPORT_POINTS);
    // If crashed, damp out velocities and rest on terrain
    if (this.isCrashed) {
      this.linearVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 2.8));
      this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 3.5));
      this.position.addScaledVector(this.linearVelocity, dt);
      this.resolveBodyPenetration();
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
    if (this.hangang?.active && this.autopilot.master) {
      this.autopilot.disengage();
      this.showToast(() => t('hangang.manual'));
    }
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
    // Damage remains until repair, even if an engine restart is commanded.
    if (this.gear.bodyDamage?.engineL !== undefined) {
      this.engines.contactDamage[0] = this.gear.bodyDamage.engineL;
    }
    if (this.engines.numEngines > 1 && this.gear.bodyDamage?.engineR !== undefined) {
      this.engines.contactDamage[1] = this.gear.bodyDamage.engineR;
    }
    this._cgBefore.copy(this.aero.cg);
    this.engines.bindMassProperties(this.aero.massProperties);
    this.gear.advanceConfiguration(dt);
    this.aero.advanceFlaps(dt);
    const engineData = this.engines.update(dt, altitudeMeters, tas, atmos.densityRatio);

    this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
    this.aero.syncMassProperties();
    rebaseCgVelocity(this.linearVelocity, this.angularVelocity, this.quaternion, this._cgBefore, this.aero.cg);

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
      (x, z) => (this.currentTerrain.getNormal ? this.currentTerrain.getNormal(x, z) : null),
      (x, z) => (this.currentAirport?.isOnRunway ? this.currentAirport.isOnRunway(x, z) : true),
      this.aero.cg, true
    );

    if (gearResult.damageEvents.length || (gearResult.bodyContacts.length && !this.bodyContactStarted)) {
      this.landingIncident = true;
      if (this.demoDirector?.isActive) this.demoDirector.stop();
      const labels = { nose: 'nose.gear', mainLeft: 'left.main.gear', mainRight: 'right.main.gear' };
      for (const event of gearResult.damageEvents) {
        this.showToast(() => t('notice.gearDamage', { value1: t(labels[event.id]), value2: event.state === 'collapsed' ? t('gear.collapsed') : t('gear.damaged') }));
      }
    }
    const newContacts = [...new Map(gearResult.bodyContacts.map(c => [c.id, c])).values()]
      .filter(c => !this.bodyContactNotices.has(c.id));
    for (const contact of newContacts) this.bodyContactNotices.add(contact.id);
    if (newContacts.length) {
      this.bodyContactStarted = true;
      this.showToast(() => t('notice.bodyContact', {
        parts: newContacts.map(c => t(`body.part.${c.id}`)).join(', '),
      }));
    }
    for (const event of gearResult.bodyDamageEvents) {
      this.showToast(() => t('notice.bodyDamage', {
        part: t(`body.part.${event.id}`), state: t(`body.state.${event.state}`),
      }));
    }
    const resting = gearResult.onGround && this.linearVelocity.length() < 0.5 && this.angularVelocity.length() < 0.02;
    this.landingRestTime = resting ? this.landingRestTime + dt : 0;
    if (!resting) this.landingStopped = false;
    if (this.landingIncident && !this.landingStopped && this.landingRestTime >= 1) {
      this.landingStopped = true;
      this.showToast(() => t('emergency.landing.stopped.select.a.preset.to'));
    }

    this.aero.gearHandleDown = this.gear.targetGearState > 0.5;

    // 5. Aerodynamic Forces & Moments
    const aeroResult = this.aero.computeAero(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      altitudeMeters,
      heightAboveGround,
      engineData.totalThrust,
      gearResult.gearState,
      this._aeroResult, true
    );

    // Engine-out asymmetric thrust: the surviving engine's moment about the
    // centerline yaws the nose toward the dead engine. Body +Y is positive
    // yaw-left, so the sign follows directly from (T_right - T_left).
    aeroResult.momentBody.y += asymmetricThrustYawMoment(
      engineData.engine1.thrust, engineData.engine2.thrust, this.engines.momentArmMeters);

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

    // A connected ground tug contributes forces through the normal integrator.
    const towing = this.demoDirector?.isActive
      ? this.demoDirector.getActiveScenario().towingForces?.() : null;
    if (towing) netForceWorld.add(towing.force);
    const accelerationWorld = netForceWorld.divideScalar(this.aero.mass);
    this.linearVelocity.addScaledVector(accelerationWorld, dt);

    // Clamp near-zero velocity when parked on ground with brakes
    if (gearResult.onGround && this.controls.brakes > 0.5 && this.linearVelocity.length() < 0.4 && this.controls.throttle < 0.1) {
      this.linearVelocity.set(0, 0, 0);
    }

    this._rotationBefore.copy(this.quaternion);

    // 9. Total Moments Integration: M = I * alpha
    // Moment in body frame: aero moment + landing gear moment
    const netMomentBody = this._intNetMoment.set(0, 0, 0)
      .add(aeroResult.momentBody)
      .add(gearResult.moments);

    if (towing) netMomentBody.add(towing.moment);

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
    translateModelOrigin(this.position, this.linearVelocity, this._rotationBefore, this.quaternion, this.aero.cg, dt);

    // Preserve the incoming pose for obstacle/off-runway collision policy; the
    // terrain constraint must not lift an aircraft out of a fatal collision.
    const collisionPosition = this.position.clone();
    const collisionVelocity = this.linearVelocity.clone();
    this.resolveBodyPenetration();

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

    if (this._hasGroundContact && this.lastOnGround && !gearResult.onGround && this.actualTakeoffMassKg === null) {
      this.actualTakeoffMassKg = this.aero.mass;
      this.refreshTakeoffPerformance();
    }
    this._hasGroundContact ||= gearResult.onGround;
    this._performanceClock += dt;
    if (this._performanceClock >= 1 || this.stallSpeedKnots === undefined) {
      if (gearResult.onGround) this.refreshTakeoffPerformance();
      else this.stallSpeedKnots = stallSpeedEstimate(this.aero, gearResult.gearState);
      this._performanceClock = 0;
    }
    this.telemetry = {
      massRevision: this.aero.massProperties.revision,
      massKg: this.aero.mass,
      zeroFuelMassKg: this.aero.massProperties.zeroFuelMassKg,
      cgBody: { ...this.aero.cg },
      inertiaBody: { ...this.aero.massProperties.inertia },
      takeoff: this.takeoff,
      actualTakeoffMassKg: this.actualTakeoffMassKg,
      stallSpeedKnots: this.stallSpeedKnots,
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
      gForce: measuredGForce,
      isStalled: aeroResult.isStalled,
      isPreStall: aeroResult.isPreStall,
      isStallWarning: aeroResult.isStallWarning,
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
      bodyContacts: [...new Set(gearResult.bodyContacts.map(c => c.id))],
      structuralDamage: gearResult.structuralDamage,
      bodyDamage: gearResult.bodyDamage,
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
      demoActive: Boolean(this.demoDirector?.isActive),
      parkBrake: Boolean(this.controls.parkingBrake || (gearResult.onGround && this.controls.brakes > 0.8 && Atmosphere.msToKnots(groundSpeed) < 1.0))
    };

    this.telemetry.warnings = this.isCrashed ? [] : this.flightWarnings.update(dt, this.telemetry,
      terrainConflictSeconds(this.position, this.linearVelocity, this.currentTerrain,
        this.telemetry.gearState > 0.95 && this.telemetry.flapDegree >= (this.currentAircraftConfig.id === 'B738' ? 15 : 0)));

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
    const allowAutoCut = !this.cameraSystem.autoPaused
      && (!this.cameraSystem.userModeSelected || this.cameraSystem.autoSwitch)
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
    this.hangang?.update(dt);
    if (!this.isCrashed) {
      const crash = this.collisionDetector.checkCollision(
        collisionPosition,
        this.quaternion,
        collisionVelocity,
        gearResult.gearState,
        pitchDeg,
        rollDeg,
        gearResult
      );

      if (crash) {
        this.triggerCrash(crash, collisionVelocity);
      }
    }
  }

  resolveBodyPenetration() {
    constrainBodyContact(this.position, this.quaternion, this.linearVelocity, this.angularVelocity,
      this.aero.mass, { x: this.aero.invIyy, y: this.aero.invIzz, z: this.aero.invIxx },
      (x, z) => this.currentTerrain.getHeight(x, z),
      (x, z) => this.currentTerrain.getNormal?.(x, z), this.gear.bodySupportPoints, this.aero.cg);
  }

  triggerCrash(crashResult, impactVelocity = this.linearVelocity) {
    if (this.isCrashed) return;
    this.isCrashed = true;
    if (this.hangang?.active) this.hangang.run.fail('contact');
    this.flightWarnings.reset();
    this.telemetry.warnings = [];
    this.crashResult = crashResult;

    // 1. Spawn Visual Explosion Particles, Fireball, Smoke & Dynamic Light Flash
    this.explosionSystem.spawnExplosion(crashResult, impactVelocity);

    // 2. Procedural Audio Detonation & Metal Crunch Sound
    this.audio.playExplosion(crashResult.type === 'WATER');

    // 3. Aircraft Structural Damage Visuals
    this.aircraft.triggerCrashVisuals(crashResult.type);
    this.aircraftBreakup.spawn(this.aircraft, impactVelocity);
    this.cameraSystem.beginCrashView(this.aircraftBreakup);

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
    this.aircraftBreakup.clear();
    this.cameraSystem.endCrashView();
    this.aircraft.resetCrashVisuals();

    const crashEl = document.getElementById('crash-overlay');
    if (crashEl) crashEl.style.display = 'none';
  }

  resetCrash() {
    if (this.devRunner.active) { this.devRunner.restart(); return; }
    if (this.hangang?.active) { this.setPreset('hangang'); return; }
    this.clearCrashState();
    this.setPreset('runway');
    this.showToast(() => t(this.activeAirport === 'incheon'
      ? 'incheon.repaired' : 'aircraft.repaired.restarted.on.runway.09l'));
  }

  exitCrashToLobby() {
    if (this.devRunner.active) {
      this.devRunner.stop();
      this.gameFlow.returnToLobby(true);
      return;
    }
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

    // Start collapsed so the report never hides the wreckage.
    this.setCrashReportMinimized(true);
    if (overlay) overlay.style.display = 'flex';
  }

  setCrashReportMinimized(minimized) {
    this.isCrashReportMinimized = minimized;
    const overlay = document.getElementById('crash-overlay');
    if (overlay) overlay.classList.toggle('is-minimized', minimized);

    const button = document.getElementById('btn-crash-toggle');
    if (!button) return;
    button.setAttribute('aria-expanded', String(!minimized));
    const label = () => t(this.isCrashReportMinimized ? 'crash.expand' : 'crash.collapse');
    bindText(button, label);
    bindText(button, label, 'title');
    bindText(button, label, 'aria-label');
  }

  /**
   * Deterministic Simulation Step (for automated test harness & replay)
   * Runs the exact 120Hz physics substepping for the requested duration in simulation time.
   * @param {number} simSeconds 
   * @returns {object} updated telemetry state
   */
  stepSimulation(simSeconds) {
    if (this.devRunner.active && this.gameFlow.isPhysicsFrozen()) return this.telemetry;
    this.devRunner.updatePreparation(0);
    if (this.shadowDemo.active) this.shadowDemo.update(simSeconds);
    const numSubsteps = Math.max(1, Math.round(simSeconds * this.physicsHz));
    for (let i = 0; i < numSubsteps; i++) {
      if (this.devRunner.blocksPhysics) break;
      stepPhysics(this);
      this.totalSimTime += this.physicsDt;
    }
    // Deterministic stepping displays the current state without interpolation.
    // Discard render history before the real-time loop resumes.
    this.physicsAccumulator = 0;
    this.renderPose.reset(this.position, this.quaternion);
    this.updateFlightDisplays(true);
    const isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    const isLookingAway = isCockpit && this.cameraSystem.isLookingAwayFromCenter();
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && this.cameraSystem.supportsPhotoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.enabled = isPhotoCockpit && this.cameraSystem.supportsPhotoCockpit;
      if (this.cockpitPhotoOverlay.enabled) {
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
    this.sky.updateCockpitSun({
      position: this.aircraft.group.position,
      quaternion: this.aircraft.group.quaternion,
      cockpitActive: isCockpit && !isPhotoCockpit,
      dt: simSeconds,
      casterState: cockpitCasterState(this.aircraft.cockpit),
    });
    this.aircraft.cockpit.syncLighting(this.sky, this.quaternion, simSeconds);
    this.water.update(simSeconds, this.camera ? this.camera.position : this.position);
    this.explosionSystem.update(simSeconds);
    if (this.isCrashed) this.cameraSystem.updateCrashView(0, true);
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

    const elapsed = this.clock.getDelta();
    const frameDelta = this.startupReady ? clampFrameDelta(elapsed) : 0;
    this.totalSimTime += frameDelta;
    if (!this.gameFlow.isPhysicsFrozen()) this.devRunner.updatePreparation(frameDelta);
    this.devPanelTimer = (this.devPanelTimer || 0) + frameDelta;
    if (this.devPanelTimer >= .2) { this.developerPanel?.refresh(); this.devPanelTimer = 0; }

    // High-rate substepping for rock-solid flight physics
    if (this.shadowDemo.active) {
      this.physicsAccumulator = 0;
      if (!this.gameFlow.isPhysicsFrozen()) this.shadowDemo.update(frameDelta);
    } else if (this.gameFlow.isPhysicsFrozen() || this.devRunner.blocksPhysics) {
      this.physicsAccumulator = 0;
    } else {
      advancePhysicsFrame(this, frameDelta);
    }

    // Keep the lobby backdrop alive: re-arm the demo after it ends.
    this.gameFlow.update(frameDelta);
    if (this.gameFlow.consumeDemoRestart()) {
      if (isScenarioAvailable(this.activeAirport, 'demo')) this.demoDirector.start(this.activeAirport);
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
      if (this.activeAirport === 'coastal') this.ships.update(frameDelta, this.totalSimTime);
    }
    if (this.currentAirport) {
      this.currentAirport.update(frameDelta, this.position, this.totalSimTime, {
        cameraPosition: this.camera.position, quality: this.renderQuality, paused: this.gameFlow.isPhysicsFrozen(),
      });
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
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && this.cameraSystem.supportsPhotoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit);
    // Looking forward in photo mode skips the occlusion pass entirely, so build
    // and compile it now instead of on the user's first head turn. The forced
    // cockpit sun state makes warm compile the shadow-receiving deck variants
    // and caster depth programs that a photo frame would never present; the
    // regular updateCockpitSun call below restores the real state this frame.
    if (isCockpit && this.cameraSystem.photoCockpit && this.cockpitOcclusion.canWarm(this.renderQuality)) {
      this.sky.updateCockpitSun({
        position: this.aircraft.group.position,
        quaternion: this.aircraft.group.quaternion,
        cockpitActive: true, dt: 0,
        casterState: cockpitCasterState(this.aircraft.cockpit),
      });
      this.cockpitOcclusion.warm(this.renderer, this.renderQuality);
    }
    this.sky.updateCockpitSun({
      position: this.aircraft.group.position,
      quaternion: this.aircraft.group.quaternion,
      cockpitActive: isCockpit && !isPhotoCockpit,
      dt: frameDelta,
      casterState: cockpitCasterState(this.aircraft.cockpit),
    });
    this.aircraft.cockpit.syncLighting(this.sky, this.quaternion, frameDelta);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.enabled = isPhotoCockpit && this.cameraSystem.supportsPhotoCockpit;
      if (this.cockpitPhotoOverlay.enabled) {
        this.cockpitPhotoOverlay.update(this.telemetry);
      }
    }
    const cameraToAircraftMeters = this.camera.position.distanceTo(this.aircraft.group.position);
    this.audio.update(frameDelta, this.telemetry, isCockpit, cameraToAircraftMeters);

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
    this.cameraSystem.applyBaseFov(targetFov);
    this.cameraSystem.update(frameDelta, this.aircraft.group, this.telemetry, (x, z) => this.currentTerrain.getHeight(x, z));
    this.foliage.updateCityLod(this.camera.position);

    // 7. Update HTML HUD & Diagnostics Inspector & Touch Controls
    this.updateHUD();
    this.touchControls.updateUI();
    this.diagnostics.update(frameDelta, this.telemetry);
    this.loadingPanel.update();

    this.foliage.update(this.camera.position);

    // 8. Render 3D Scene
    this.renderScene();
    if (!this.hasRenderedFirstFrame) {
      this.hasRenderedFirstFrame = true;
      document.getElementById('startup-overlay').classList.add('scene-ready');
      inputLatency?.mark('first-frame');
      this.scheduleAircraftPreload();
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
    const warning = document.getElementById('hud-warning');
    if (warning) {
      const alert = this.isCrashed ? null : this.telemetry.warnings?.[0];
      warning.textContent = alert?.text || '';
      warning.hidden = !alert;
      warning.style.color = alert?.priority >= 85 ? '#ff5555' : '#ffbe55';
    }
    if (elCam) elCam.textContent = this.cameraSystem.getModeName();
    this.updateAutopilotUI();
    updateControlState(this.telemetry, this.cameraSystem, { demoActive: Boolean(this.demoDirector?.isActive) });
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
    const isDemo = Boolean(this.demoDirector?.isActive);
    const btnToggle = document.getElementById('btn-ap-toggle');
    if (btnToggle) {
      btnToggle.disabled = isDemo;
      btnToggle.classList.toggle('ap-active', this.autopilot.master);
    }
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
      btn.disabled = isDemo;
      btn.classList.toggle('ap-active', on);
      btn.classList.toggle('ap-armed', id === 'btn-ap-app' && this.autopilot.appArmed);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  updateApToggleUI() {
    const bar = document.getElementById('ap-bar');
    const btn = document.getElementById('btn-ap-toggle');
    if (!bar || !btn) return;
    const collapsed = bar.classList.contains('ap-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = 'AP';
    document.getElementById('ap-panel').hidden = collapsed;
    bindText(btn, () => t(collapsed ? 'ap.expand' : 'ap.collapse'), 'aria-label');
    bindText(btn, () => t(collapsed ? 'ap.expand.tip' : 'ap.collapse.tip'), 'title');
    btn.classList.toggle('ap-active', this.autopilot.master);
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
    // The shadow demo resets through setPreset('runway'); its own status panel
    // describes the held aircraft, so a "ready for takeoff" toast would lie.
    if (this.quietPresetToast) return;
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
    if (this.renderDiagnostics?.active) { this.renderDiagnostics.render(); return; }
    this.renderStandardScene();
  }

  renderStandardScene(aoQuality = this.renderQuality) {
    prepareCockpitShadowDepth(this.aircraft.group);
    this.sky.prepareRender(this.camera, this.aircraft.group.position);
    this.renderer.render(this.scene, this.camera);
    if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT &&
        (!this.cameraSystem.photoCockpit || this.cameraSystem.isLookingAwayFromCenter())) {
      // Photo mode only reaches the 3D interior mid head-turn; the cabin then
      // fills the viewport and the AO early-out cannot fire, so run that
      // transitional view at a reduced AO scale.
      const transitional = this.cameraSystem.photoCockpit && this.cameraSystem.isLookingAwayFromCenter();
      this.cockpitOcclusion.render(this.renderer, aoQuality, transitional);
    }
  }

  updateShadowDemoUi() {
    const demo = this.shadowDemo;
    if (!demo) return;
    const panel = document.getElementById('shadow-demo');
    if (panel) panel.hidden = !demo.active;
    const status = document.getElementById('shadow-status');
    if (status) bindText(status, () => t('shadow.status', {
      step: demo.index + 1, total: SHADOW_VIEWS.length,
      direction: t(SHADOW_VIEWS[demo.index ?? 0].key),
    }));
    const pause = document.getElementById('shadow-pause');
    if (pause) {
      bindText(pause, () => t(demo.paused ? 'shadow.resume' : 'shadow.pause'));
      pause.setAttribute('aria-pressed', String(demo.paused));
    }
    if (this.gameFlow) this.syncFlowUi();
  }

  setRenderQuality(value) {
    this.renderDiagnosticsPanel?.close();
    this.renderQuality = resolveRenderQuality(value);
    const preset = RENDER_QUALITY[this.renderQuality];
    this.sky.setShadowMapSize(preset.shadowMapSize);
    if (this.terrain.getQuality() !== preset.terrain) this.terrain.setQuality(preset.terrain);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
    document.getElementById('render-quality').value = this.renderQuality;
    try { localStorage.setItem(RENDER_QUALITY_KEY, this.renderQuality); } catch { /* Session-only setting. */ }
  }

  initUI() {
    const cockpitQuality = document.getElementById('cockpit-quality');
    cockpitQuality.value = this.cockpitOcclusion.enabled ? 'detailed' : 'performance';
    cockpitQuality.addEventListener('change', () => {
      this.cockpitOcclusion.enabled = cockpitQuality.value !== 'performance';
      try { localStorage.setItem('flight3d.cockpitQuality', cockpitQuality.value); } catch { /* Session-only setting. */ }
    });
    const qualitySelect = document.getElementById('render-quality');
    qualitySelect.value = this.renderQuality;
    qualitySelect.addEventListener('change', () => this.setRenderQuality(qualitySelect.value));
    document.getElementById('btn-flaps-ext')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onCycleFlaps(1);
    });
    document.getElementById('btn-flaps-ret')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onCycleFlaps(-1);
    });
    document.getElementById('btn-gear')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onToggleGear();
    });
    document.getElementById('btn-spoilers')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onToggleSpoilers();
    });
    document.getElementById('btn-reverser')?.addEventListener('click', () => {
      if (this.demoDirector?.isActive) return;
      this.controls.onToggleReverser();
    });
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
    document.getElementById('incheon-attribution-chip')?.addEventListener('click', (event) => {
      const aside = event.currentTarget.closest('#incheon-attribution');
      const expanded = aside.classList.toggle('expanded');
      event.currentTarget.setAttribute('aria-expanded', String(expanded));
    });
    const fullscreenButton = document.getElementById('btn-fullscreen');
    const syncFullscreenUI = () => {
      if (!fullscreenButton) return;
      const active = Boolean(document.fullscreenElement);
      bindText(fullscreenButton, () => t(active ? 'fullscreen.exit' : 'fullscreen.enter'));
      fullscreenButton.setAttribute('aria-pressed', String(active));
    };
    fullscreenButton?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (err) {
        this.showToast(() => t('fullscreen.unavailable'));
      }
    });
    // Esc exits fullscreen natively without a usable keydown, so resize and
    // the pressed state are reconciled from the fullscreenchange event.
    document.addEventListener('fullscreenchange', () => {
      syncFullscreenUI();
      this.handleResize();
    });
    syncFullscreenUI();
    for (const [id, mode] of [
      ['btn-ap', 'MASTER'], ['btn-ap-hdg', 'HDG'], ['btn-ap-alt', 'ALT'],
      ['btn-ap-spd', 'SPD'], ['btn-ap-app', 'APP'],
    ]) {
      document.getElementById(id)?.addEventListener('click', () => {
        if (this.demoDirector?.isActive) return;
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
      if (this.demoDirector?.isActive) return;
      document.getElementById('ap-bar')?.classList.toggle('ap-collapsed');
      this.updateApToggleUI();
    });
    const closeApPanel = () => {
      const bar = document.getElementById('ap-bar');
      if (bar.classList.contains('ap-collapsed')) return;
      bar.classList.add('ap-collapsed');
      this.updateApToggleUI();
    };
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#ap-bar')) closeApPanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || document.getElementById('ap-panel').hidden) return;
      event.preventDefault();
      event.stopPropagation();
      closeApPanel();
      document.getElementById('btn-ap-toggle').focus({ preventScroll: true });
    });
    this.updateApToggleUI();

    // Initialize Demo Director UI bindings
    this.demoDirector.initUI();

    // Lobby + pause menu bindings
    this.lobbyScreen = initLobbyScreen({
      getAirport: () => this.lobby.airport,
      getPreset: () => this.lobby.preset,
      getTime: () => this.sky.timeOfDay,
      getAircraft: () => this.lobby.aircraft || this.currentAircraftId || 'B738',
      getDemoProfile: () => this.lobby.demoProfile,
      onDemoProfile: id => { this.lobby.demoProfile = id; },
      onAirport: id => {
        this.lobby.airport = id;
        this.lobby.preset = defaultScenarioForRegion(id);
        if (id === 'hangang') this.lobby.aircraft = 'C172';
        saveSavedScenario(this.lobby.preset);
        saveSavedAirport(id);
        this.lobbyScreen?.refresh();
        this.queueLobbySelection();
      },
      onPreset: type => {
        this.lobby.preset = type;
        saveSavedScenario(type);
        this.lobbyScreen.refresh();
      },
      onTime: hours => this.setTimeOfDay(hours),
      onAircraft: id => {
        this.lobby.aircraft = id;
        saveSavedAircraft(id);
        this.lobbyScreen?.refresh();
        this.queueLobbySelection();
      },
      onFly: () => this.fly(),
    });
    this.renderDiagnosticsPanel = new RenderDiagnosticsPanel(this);
    this.developerPanel = new DeveloperPanel(this);
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => this.gameFlow.resume());
    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.gameFlow.resume();
      if (this.devRunner.active) { this.devRunner.restart(); return; }
      this.setPreset(this.lastPresetType || 'runway');
    });
    document.getElementById('btn-pause-lobby')?.addEventListener('click', () => this.gameFlow.returnToLobby(true));
    document.getElementById('menu-toggle')?.addEventListener('click', () => this.toggleMainMenu());

    document.getElementById('shadow-prev')?.addEventListener('click', () => this.shadowDemo.next(-1));
    document.getElementById('shadow-next')?.addEventListener('click', () => this.shadowDemo.next());
    document.getElementById('shadow-pause')?.addEventListener('click', () => this.shadowDemo.togglePause());
    document.getElementById('shadow-exit')?.addEventListener('click', () => {
      this.devRunner.stop();
      this.shadowDemo.stop();
      this.lastPresetType = 'runway';
      this.gameFlow.returnToLobby(true);
    });

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

    // Crash report: header toggles the full report; the main menu button is the
    // persistent top-left one. Back to the lobby is also [Space / R / Enter].
    document.getElementById('btn-crash-toggle')?.addEventListener('click', () => {
      this.setCrashReportMinimized(!this.isCrashReportMinimized);
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
        if (!this.cameraSystem.supportsPhotoCockpit) {
          this.showToast(() => t('3d.virtual.cockpit'));
          return;
        }
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
          if (!this.cameraSystem.supportsPhotoCockpit) {
            this.showToast(() => t('3d.virtual.cockpit'));
            return;
          }
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
    this.cameraSystem.applyBaseFov(targetFov);
    // The projection must be rebuilt for the new aspect even when the zoomed
    // vertical FOV happens to be unchanged.
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.onResize(window.innerWidth, window.innerHeight);
    }
  }
}

// Start Simulator when DOM is ready (guaranteed across all browser lifecycle states)
async function initFlightSimulator() {
  if (!window.simulator) {
    document.getElementById('startup-retry').addEventListener('click', () => location.reload());
    document.getElementById('canvas-container').inert = true;
    document.getElementById('hud-overlay').inert = true;
    const simulator = new FlightSimulator();
    // The latency monitor is exposed as window.sim.inputLatency (constructor-assigned);
    // `sim.telemetry` stays the physics snapshot namespace, rewritten by fly().
    try {
      await simulator.initialize();
      window.simulator = simulator;
      window.sim = simulator;
    } catch (error) { showStartupError(error); }
    inputLatency?.mark('ready');
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initFlightSimulator);
} else {
  initFlightSimulator();
}
