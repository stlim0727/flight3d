import { FlightWarnings } from './systems/FlightWarnings.js';
import { AircraftBreakup } from './effects/AircraftBreakup.js';
import { t, bindText, initLocalization } from './i18n/index.js';
import * as THREE from 'three';
import { cockpitCasterState } from './aircraft/CockpitLighting.js';
import { CockpitShadowDemo } from './director/CockpitShadowDemo.js';
import { CockpitOcclusion } from './aircraft/CockpitOcclusion.js';
import { Atmosphere } from './physics/Atmosphere.js';
import { AIRCRAFT_REGISTRY, BOEING_737_800 } from './config/aircraftConfigs.js';
import { Aerodynamics, createAeroResult } from './physics/Aerodynamics.js';
import { SIM_CONFIG } from './config/simConfig.js';
import { advancePhysicsFrame, clampFrameDelta } from './core/physicsTiming.js';
import { EngineModel } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { AutopilotController } from './physics/Autopilot.js';
import { solveTrim } from './physics/TrimSolver.js';
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
import { Airport } from './environment/Airport.js';
import { FoliageAndCities } from './environment/FoliageAndCities.js';
import { Ships } from './environment/Ships.js';
import { SkyAtmosphere } from './environment/SkyAtmosphere.js';
import { NeonCity } from './environment/NeonCity.js';
import { FlightAudio } from './audio/FlightAudio.js';
import { FlightControls } from './controls/FlightControls.js';
import { CameraSystem } from './cameras/CameraSystem.js';
import { HudView } from './ui/HudView.js';
import { RenderPose } from './core/RenderPose.js';
import { DiagnosticsInspector } from './ui/DiagnosticsInspector.js';
import { DemoFlightDirector } from './director/DemoFlightDirector.js';
import { CollisionDetector } from './physics/CollisionDetector.js';
import { ExplosionSystem } from './effects/ExplosionSystem.js';
import { TireSmokeSystem } from './effects/TireSmokeSystem.js';
import { initFlightPanels } from './ui/FlightPanels.js';
import { GameFlowController, FLOW } from './ui/GameFlowController.js';
import { LOBBY_AIRCRAFT_IDS } from './ui/LobbyScreen.js';
import { DeveloperModeController } from './dev/DeveloperModeController.js';
import { DevScenarioRunner } from './dev/DevScenarioRunner.js';
import { RenderDiagnostics } from './dev/RenderDiagnostics.js';
import { isScenarioAvailable } from './config/scenarioRegistry.js';
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
import { installPresetSpawner } from './core/PresetSpawner.js';
import { installPhysicsIntegrator } from './core/PhysicsIntegrator.js';
import { installSimulatorHudAndBindings } from './ui/SimulatorHudAndBindings.js';

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
    this.hudView = new HudView(this);
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
    this.hangang?.render();
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
}

installPresetSpawner(FlightSimulator);
installPhysicsIntegrator(FlightSimulator);
installSimulatorHudAndBindings(FlightSimulator);

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