import { createSimulatorScenarioStart } from './core/simulatorScenarioStart.js';
import { createSimulatorFlightStart } from './core/simulatorFlightStart.js';
import { MultiplayerController } from './multiplayer/MultiplayerController.js';
import { FlightWarnings } from './systems/FlightWarnings.js';
import { AircraftBreakup } from './effects/AircraftBreakup.js';
import { t, bindText, initLocalization } from './i18n/index.js';
import * as THREE from 'three';
import { cockpitCasterState } from './aircraft/CockpitLighting.js';
import { CockpitShadowDemo } from './director/CockpitShadowDemo.js';
import { ReplayDirector } from './director/ReplayDirector.js';
import { CockpitOcclusion } from './aircraft/CockpitOcclusion.js';
import { Atmosphere } from './physics/Atmosphere.js';
import { AIRCRAFT_REGISTRY, BOEING_737_800 } from './config/aircraftConfigs.js';
import { Aerodynamics, createAeroResult } from './physics/Aerodynamics.js';
import { PilotPhysiology } from './physics/PilotPhysiology.js';
import { SIM_CONFIG } from './config/simConfig.js';
import { advancePhysicsFrame, clampFrameDelta } from './core/physicsTiming.js';
import { EngineModel } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { WaterDitching } from './physics/WaterDitching.js';
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
import { RENDER_QUALITY, RENDER_QUALITY_KEY, initialRenderQuality, renderPixelRatio, applyFlatShading } from './config/renderQuality.js';
import { WaterOcean } from './environment/WaterOcean.js';
import { Airport } from './environment/Airport.js';
import { FoliageAndCities } from './environment/FoliageAndCities.js';
import { Ships } from './environment/Ships.js';
import { SkyAtmosphere } from './environment/SkyAtmosphere.js';
import { GroundContactShadow, contactShadowSurfaceHeight } from './environment/GroundContactShadow.js';
import { NeonCity } from './environment/NeonCity.js';
import { FlightAudio } from './audio/FlightAudio.js';
import { FlightControls } from './controls/FlightControls.js';
import { CameraSystem } from './cameras/CameraSystem.js';
import { HudView } from './ui/HudView.js';
import { RenderPose } from './core/RenderPose.js';
import { DiagnosticsInspector } from './ui/DiagnosticsInspector.js';
import { JoystickCheckDialog } from './ui/JoystickCheckDialog.js';
import { DemoFlightDirector } from './director/DemoFlightDirector.js';
import { VoiceChallengeOverlay } from './ui/VoiceChallengeOverlay.js';
import { CollisionDetector } from './physics/CollisionDetector.js';
import { ExplosionSystem } from './effects/ExplosionSystem.js';
import { TireSmokeSystem } from './effects/TireSmokeSystem.js';
import { PilotPhysiologyFx } from './effects/PilotPhysiologyFx.js';
import { initFlightPanels } from './ui/FlightPanels.js';
import { initUiScale } from './ui/UiScale.js';
import { GameFlowController, FLOW } from './ui/GameFlowController.js';
import { FlightRecorder } from './core/FlightRecorder.js';
import { ReplayRecorder } from './core/ReplayRecorder.js';
import { ReplayStore } from './replay/ReplayStore.js';
import { LOBBY_AIRCRAFT_IDS } from './ui/LobbyScreen.js';
import { DeveloperModeController } from './dev/DeveloperModeController.js';
import { DevScenarioRunner } from './dev/DevScenarioRunner.js';
import { RenderDiagnostics } from './dev/RenderDiagnostics.js';
import { isScenarioAvailable } from './config/scenarioRegistry.js';
import {
  loadSavedFlightSelection,
  saveSavedAircraft,
} from './config/flightSelection.js';
import { resolveFlightUrl } from './config/flightUrls.js';
import { applyDeviceTimeOfDay, forgetSimulatorPreference, loadSimulatorPreferences,
  restoreSimulatorPreferences, saveSimulatorPreferences } from './config/simulatorPreferences.js';
import { TouchFlightControls } from './controls/TouchFlightControls.js';
import { CockpitPhotoOverlay } from './aircraft/CockpitPhotoOverlay.js';
import { initBuildInfo } from './ui/BuildInfo.js';
import { installInputLatencyMonitor } from './ui/InputLatencyMonitor.js';
import { installStartupLoadMonitor } from './ui/StartupLoadMonitor.js';
import { installPresetSpawner } from './core/PresetSpawner.js';
import { installPhysicsIntegrator } from './core/PhysicsIntegrator.js';
import { installSimulatorHudAndBindings } from './ui/SimulatorHudAndBindings.js';
import {
  initAnalytics,
  trackFlightStart,
  trackFlightEnd,
  trackFlightCrash,
  captureException,
  trackMultiplayerRoomCreated,
  trackMultiplayerRoomJoined,
  trackMultiplayerConnected,
  trackMultiplayerRoundStarted,
  trackMultiplayerSessionEnded,
  trackMultiplayerVoiceToggled,
  trackReplaySaved,
  trackReplayWatched,
  trackReplayLibraryAction,
  trackDebriefAction,
} from './analytics/posthog.js';
import { openFeedbackDialog } from './analytics/FeedbackDialog.js';

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
  startupTrace?.noteStage(value);
  document.getElementById('startup-progress').value = value;
  bindText(document.getElementById('startup-status'), () => t(message));
  // Two frames ensure the updated stage paints before synchronous construction.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function showStartupError(error) {
  startupTrace?.noteFailed();
  console.error('Simulator startup failed:', error);
  bindText(document.getElementById('startup-status'), () => t('startup.failed'));
  document.getElementById('startup-progress').hidden = true;
  document.getElementById('startup-retry').hidden = false;
}

// Attach latency telemetry before the simulator constructor: its synchronous scene
// build is exactly the window where user input stalls, and event-timing entries are
// buffered retroactively to navigation start.
const inputLatency = installInputLatencyMonitor();
// Per-asset load timing for the same boot window, reported to analytics once the overlay lifts.
const startupTrace = installStartupLoadMonitor(inputLatency);

/**
 * Main Simulation Coordinator
 * Integrates 6-DOF rigid body physics, aircraft systems, procedural world, audio, and user interface.
 */
class FlightSimulator {
  async initialize() {
    initUiScale();
    await startupStage(0, 'startup.scene');
    const savedSelection = resolveFlightUrl(window.location.search, loadSavedFlightSelection());
    // Pinned now: by emit time the lobby context may already describe a flight the user started.
    startupTrace?.noteSelection(savedSelection);
    this.container = document.getElementById('canvas-container');
    this.inputLatency = inputLatency;

    // 1. Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    // near: 0.08m and far: 45,000m combined with logarithmicDepthBuffer completely eliminates pillar clipping & Z-fighting
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 45000);

    let savedQuality;
    try { savedQuality = localStorage.getItem(RENDER_QUALITY_KEY); } catch { /* Use default. */ }
    this.renderQuality = initialRenderQuality(savedQuality, {
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      deviceMemory: navigator.deviceMemory,
    });
    const initialPreset = RENDER_QUALITY[this.renderQuality];

    this.renderer = new THREE.WebGLRenderer({
      antialias: initialPreset.antialias ?? true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(renderPixelRatio(this.renderQuality, window.innerWidth, window.innerHeight, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = initialPreset.shadows ?? (initialPreset.shadowMapSize > 0);
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
      this.cockpitOcclusion.enabled = initialPreset.ao !== false && localStorage.getItem('flight3d.cockpitQuality') !== 'performance';
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
    this.waterDitching = new WaterDitching();
    this.pilotPhysiology = new PilotPhysiology();

    await startupStage(2, 'startup.world');

    // 5. Procedural World & Real-World Environments
    this.terrain = new Terrain(22000, initialPreset.terrainSegments ?? 256, { quality: initialPreset.terrain });
    this.scene.add(this.terrain.mesh);

    // Height-over-ground cue for the ultraLow tier, which ships without shadow maps.
    this.contactShadow = new GroundContactShadow(this.scene);
    this.contactShadow.setEnabled(this.renderQuality === 'ultraLow');

    this.water = new WaterOcean(36000, initialPreset.waterSegments ?? 180, { quality: this.renderQuality });
    this.scene.add(this.water.mesh);

    this.airport = new Airport();
    this.scene.add(this.airport.group);
    this.terrain.excludePavement(this.airport.group);

    this.foliage = new FoliageAndCities(this.terrain);
    this.foliage.setQuality?.(this.renderQuality);
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
    this.sky.setShadowMapSize(initialPreset.shadowMapSize);
    if (this.sky?.setCloudsVisible) {
      this.sky.setCloudsVisible(initialPreset.clouds ?? true);
    }
    this.foliage.setTimeOfDay(this.sky.timeOfDay);
    this.water.syncWithAtmosphere(this.sky);

    await startupStage(3, 'startup.controls');

    // 6. Audio & Controls & Camera & Diagnostics
    this.audio = new FlightAudio();
    this.controls = new FlightControls(this.renderer.domElement);
    this.touchControls = new TouchFlightControls(this.controls);
    this.touchControls.onOptionsChange = () => this.lobby?.refresh?.();
    initFlightPanels({
      onSelectCamera: mode => this.controls.onSelectCamera(mode),
      onCameraOpen: () => {
        if (!this.multiplayer?.active && this.gameFlow.state === FLOW.FLIGHT) {
          this.gameFlow.holdCameraSelection();
        }
      },
      onCameraClose: () => {
        if (!this.multiplayer?.active) {
          this.gameFlow.releaseCameraSelection();
        }
      },
      onAdjustTrim: delta => {
        if (this.controls.aircraftControlsDisabled || this.controls.inputBlocked || this.isCrashed) return;
        this.aero.setTrim(delta);
        this.controls.pitchTrim = this.aero.pitchTrim;
      },
      onToggleParkingBrake: () => {
        if (this.controls.onToggleParkingBrake) this.controls.onToggleParkingBrake();
        else if (!this.controls.aircraftControlsDisabled && !this.controls.inputBlocked && !this.isCrashed) {
          this.controls.setParkingBrake(!this.controls.parkingBrake);
        }
      },
    });
    this.cameraSystem = new CameraSystem(this.camera, this.renderer.domElement);
    this.cameraSystem.setTerrain(this.terrain);
    // The interior is fetched by the first cockpit view rather than by boot, and the cut is
    // held until it arrives so an entry never shows the bare airframe interior.
    this.cameraSystem.setCockpitInteriorGate(() => this.cockpitInteriorStatus());
    this.hudView = new HudView(this);
    this.cameraSystem.onResetLook = () => {
      this.showToast(() => t('camera.view.centered'));
    };
    this.loadAircraftConfig(AIRCRAFT_REGISTRY[savedSelection.aircraft] || BOEING_737_800);
    this.diagnostics = new DiagnosticsInspector(this);
    this.joystickDialog = new JoystickCheckDialog(this);
    this.demoDirector = new DemoFlightDirector(this);
    this.voiceChallengeOverlay = new VoiceChallengeOverlay({ sim: this });
    this.shadowDemo = new CockpitShadowDemo(this, () => this.updateShadowDemoUi());
    this.replayDirector = new ReplayDirector(this);
    // First claim wins the frame, so the developer shadow rig keeps priority over a replay.
    this.poseDrivers = [this.shadowDemo, this.replayDirector];
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
    this.flightRecorder = new FlightRecorder();
    // Pose track for replay; the telemetry recorder above only feeds the debrief chart.
    this.replayRecorder = new ReplayRecorder();
    this.replayStore = new ReplayStore();
    this.debriefReplay = null;
    this.lobby = { airport: savedSelection.airport, preset: savedSelection.scenario, aircraft: savedSelection.aircraft, pilotMode: 'human' };
    this.currentAircraftId = savedSelection.aircraft;
    this.lastPresetType = savedSelection.scenario;
    this.startingFlight = false;
    this.applyingPendingStart = false;

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
    this.pilotPhysiologyFx = new PilotPhysiologyFx(this.container);
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
      parkBrake: false,
      pilot: {
        gZ: 1.0, consciousness: 1.0, responsiveness: 1.0, isGLOC: false,
        blackout: 0, redout: 0, tunnelVision: 0, grayout: 0, blur: 0, glocIncidents: 0, gFatigueSeconds: 0
      }
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

    // Telemetry & Feedback
    this.analytics = {
      initAnalytics,
      trackFlightStart,
      trackFlightEnd,
      trackFlightCrash,
      captureException,
      trackMultiplayerRoomCreated,
      trackMultiplayerRoomJoined,
      trackMultiplayerConnected,
      trackMultiplayerRoundStarted,
      trackMultiplayerSessionEnded,
      trackMultiplayerVoiceToggled,
      trackReplaySaved,
      trackReplayWatched,
      trackReplayLibraryAction,
      trackDebriefAction,
    };
    this._openFeedbackDialog = openFeedbackDialog;

    restoreSimulatorPreferences(this, loadSimulatorPreferences());
    this.initControls();
    this.initUI();
    await this.setAirport(savedSelection.airport);

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());

    this.initBrowserActivity();

    // Start with the flight when autoplay is permitted. Otherwise the browser
    // keeps the context suspended until the first flight/menu interaction.
    const audioHint = document.getElementById('audio-start-hint');
    const interactionEvents = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'];
    let listenersAttached = false;

    const attachInteractionListeners = () => {
      if (listenersAttached) return;
      interactionEvents.forEach(evt => {
        window.addEventListener(evt, ensureAudio, { passive: true, capture: true });
      });
      listenersAttached = true;
    };

    const detachInteractionListeners = () => {
      if (!listenersAttached) return;
      interactionEvents.forEach(evt => {
        window.removeEventListener(evt, ensureAudio, { capture: true });
      });
      listenersAttached = false;
    };

    const isMultiplayerVoiceBlocked = () => Boolean(
      this.multiplayer?.playbackBlocked ||
      (this.multiplayer?.active && this.multiplayer?.audio?.srcObject && this.multiplayer?.audio?.paused) ||
      (this.multiplayer?.active && this.multiplayer?.voice?.context && this.multiplayer?.voice?.context?.state !== 'running')
    );

    const syncAudioHint = () => {
      const state = this.audio.ctx?.state;
      const isRunning = state === 'running';
      const isVoiceBlocked = isMultiplayerVoiceBlocked();
      if (audioHint) {
        if ((isRunning && !isVoiceBlocked) || this.audio.isMuted) {
          audioHint.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
          audioHint.style.opacity = '0';
          audioHint.style.transform = 'translate(-50%, 8px)';
          setTimeout(() => {
            const stillRunning = this.audio.ctx?.state === 'running';
            const stillBlocked = isMultiplayerVoiceBlocked();
            if ((stillRunning && !stillBlocked) || this.audio.isMuted) {
              audioHint.hidden = true;
            }
          }, 250);
        } else {
          audioHint.hidden = false;
          audioHint.style.opacity = '1';
          audioHint.style.transform = 'translate(-50%, 0)';
        }
      }
      if (isRunning && !isVoiceBlocked) {
        detachInteractionListeners();
      } else if (!this.audio.isMuted && (!isRunning || isVoiceBlocked)) {
        attachInteractionListeners();
      }
    };

    let hintContext;
    const ensureAudio = () => {
      if (this.browserBackgrounded && !document.hidden && document.hasFocus?.()) {
        this.setBrowserActive(true);
      }
      if (!this.audio.isInitialized) {
        this.audio.init();
      }
      this.audio.ensureContextRunning();
      this.multiplayer?.playAudio();
      if (this.audio.ctx && hintContext !== this.audio.ctx) {
        hintContext?.removeEventListener('statechange', syncAudioHint);
        hintContext = this.audio.ctx;
        hintContext.addEventListener('statechange', syncAudioHint);
      }
      syncAudioHint();
    };

    this.ensureAudio = ensureAudio;
    this.syncAudioHint = syncAudioHint;

    attachInteractionListeners();
    audioHint?.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAudio();
    });
    ensureAudio();

    // Begin Animation Loop
    this.hasRenderedFirstFrame = false;
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // Initialize analytics/error reporting asynchronously without delaying startup
    if (typeof window !== 'undefined') {
      const initTelemetry = () => initAnalytics(this);
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(initTelemetry, { timeout: 2000 });
      } else {
        setTimeout(initTelemetry, 1000);
      }
      this.renderer?.domElement?.addEventListener('webglcontextlost', () => {
        captureException(new Error('WebGL context lost'), {
          source: 'canvas.webglcontextlost',
          gpu: this.renderer?.capabilities?.renderVersion,
        });
      });
    }

    // Boot cleanly into the lobby with its live 3D cinematic backdrop, unless a
    // direct launch URL parameter (?fly=1, ?instant=1, ?pilotArena=1) is present.
    const urlParams = new URLSearchParams(window.location.search);
    const launchDirectly = urlParams.has('fly') || urlParams.has('instant') || urlParams.get('pilotArena') === '1';

    if (launchDirectly) {
      this.fly();
      inputLatency?.mark('fly');
    } else {
      if (isScenarioAvailable(this.activeAirport, 'demo')) {
        this.demoDirector.start(this.activeAirport);
      }
      inputLatency?.mark('lobby-ready');
    }
    this.multiplayer = new MultiplayerController(this);
    this.collisionDetector?.setRemoteAircraftProvider(() => this.multiplayer?.getCollisionTargets());
    this.syncFlowUi();
    if (urlParams.get('pilotArena') === '1') {
      const { installPilotArena } = await import('./ui/PilotArenaPanel.js');
      installPilotArena(this);
    }
  }
  /** Browser activity is a separate hold, so returning cannot undo menu/pause state. */
  initBrowserActivity() {
    const sync = () => this.setBrowserActive(!document.hidden && document.hasFocus());
    window.addEventListener('blur', () => this.setBrowserActive(false));
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', () => this.setBrowserActive(false));
    window.addEventListener('pageshow', sync);
    sync();
  }

  setBrowserActive(active) {
    const backgrounded = !active;
    if (this.browserBackgrounded === backgrounded) return;
    this.browserBackgrounded = backgrounded;
    // Discard wall time and any fractional physics debt on both edges.
    this.clock.getDelta();
    this.physicsAccumulator = 0;
    if (backgrounded) {
      this.controls.releaseAllKeys();
      this.controls.setTouchStick(0, 0);
      this.controls.setTouchRudder(0);
      this.controls.setTouchBrakes(0);
    }
    this.syncAudioPause();
    if (active) this.audio?.ensureContextRunning();
  }

  syncAudioPause() {
    const backgrounded = this.browserBackgrounded === true;
    const held = this.gameFlow.state === FLOW.DEBRIEF || this.gameFlow.state === FLOW.PAUSED || this.gameFlow.canResumeFromLobby() || Boolean(this.demoDirector?.isRestartConfirmOpen);
    const radioPaused = backgrounded || this.gameFlow.state !== FLOW.FLIGHT || Boolean(this.demoDirector?.isRestartConfirmOpen);
    if (this.audio?.setRadioPaused) this.audio.setRadioPaused(radioPaused);
    else this.audio?.departureRadio.setPaused(radioPaused);
    this.audio?.setPaused(backgrounded || held);
  }

  /** Apply the game-flow state to the DOM: menu visibility, input blocking. */
  syncFlowUi() {
    const state = this.gameFlow.state;
    if (state === FLOW.LOBBY) this.crashDebriefRemaining = null;
    // Pause retains the judged attempt; leaving flight for a menu ends it.
    // The arena runner gates every physics step on flow/background state.
    if (state !== FLOW.FLIGHT && state !== FLOW.PAUSED && this.pilotArena?.active) this.pilotArena.stop('flight-held');
    // A flight parked off the sim is silent and watched from the drone rig; the lobby
    // cinematic keeps its own sound and camera, so it is deliberately not held here.
    const held = state === FLOW.DEBRIEF || state === FLOW.PAUSED || this.gameFlow.canResumeFromLobby();
    this.syncAudioPause();
    document.body.dataset.flow = state;
    if (state === FLOW.FLIGHT) {
      const attribution = document.getElementById('incheon-attribution');
      attribution?.classList.remove('expanded');
      attribution?.querySelector('#incheon-attribution-chip')?.setAttribute('aria-expanded', 'false');
      if (this.touchControls?.gyroRequested && !this.touchControls.gyroActive && !this.demoDirector?.isActive) {
        this.touchControls.restoreGyroSettings({ userGesture: true });
      }
    }
    document.body.dataset.devScenario = String(Boolean(this.devRunner?.active));
    document.body.dataset.devManualFlight = String(Boolean(this.devRunner?.active?.definition.pilotControlled));
    this.controls.inputBlocked = this.multiplayer?.modalOpen || this.multiplayer?.room?.session.state === 'starting' || this.gameFlow.blocksFlightInput() || this.shadowDemo.active || Boolean(this.devRunner?.blocksInput) || Boolean(this.pilotArena?.active && this.pilotArena?.record?.pilotKind !== 'human') || Boolean(this.demoDirector?.isRestartConfirmOpen);
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
    if (held) this.cameraSystem?.beginPauseView();
    else this.cameraSystem?.endPauseView();
    this.updateMenuToggle();
    const pauseEnd = document.getElementById('btn-pause-end');
    if (pauseEnd) pauseEnd.hidden = state !== FLOW.PAUSED;
    this.multiplayer?.refresh?.();
  }

  /** Start a fresh flight using the menu choices, rebuilding the scene if needed. */
  async fly() {
    if (this.multiplayer?.locked) return;
    if (this.airportLoading || this.startingFlight) return;
    this.replayDirector.stop();
    const pending = {
      airport: this.lobby.airport,
      aircraft: this.lobby.aircraft ?? this.currentAircraftId,
    };
    const live = {
      airport: this.activeAirport,
      aircraft: this.currentAircraftId,
    };
    const needsScene = pending.airport !== live.airport || pending.aircraft !== live.aircraft;
    // Only a region or model swap is slow enough to need the loading card. Everything else
    // starts inside the click task, so callers can keep sequencing steps after fly().
    if (needsScene) await this.applyPendingScene();
    else await this.startFlight();
  }

  get flightStartCoordinator() {
    return this._flightStartCoordinator ??= createSimulatorFlightStart(this, startupStage);
  }

  /** Prepare the pending scene and install its scenario under the same hold. */
  applyPendingScene() {
    return this.flightStartCoordinator.rebuild();
  }

  /** Install a scenario without rebuilding the current scene. */
  startFlight(options = {}) {
    return this.flightStartCoordinator.start(options);
  }

  get scenarioStartCoordinator() {
    return this._scenarioStartCoordinator ??= createSimulatorScenarioStart(this);
  }

  /** Install the selected scenario before publishing its successful start. */
  spawnFlight(options = {}) {
    return this.scenarioStartCoordinator.start(options);
  }

  async startValleyMission({ pilotKind = 'human' } = {}) {
    this.lastPresetType = 'valley';
    if (!this.pilotMissionStarter) {
      const { installPilotArena } = await import('./ui/PilotArenaPanel.js');
      installPilotArena(this);
    }
    return this.pilotMissionStarter.start({ missionId: 'valley-slalom-v1', pilotKind });
  }

  /**
   * One-click toggle between in-play and menu.
   * - In FLIGHT: enters the lobby while holding the active sortie.
   * - In LOBBY: if a held sortie exists, resumes it; otherwise starts fresh flight.
   * - In PAUSED: resumes flight.
   */
  toggleMainMenu() {
    if (this.replayDirector.active) { this.replayPanel.exit(); return; }
    if (this.gameFlow.state === FLOW.DEBRIEF) return;
    if (this.gameFlow.state === FLOW.FLIGHT) {
      this.gameFlow.returnToLobby(true);
    } else if (this.gameFlow.state === FLOW.PAUSED) {
      this.gameFlow.resume();
    } else if (this.gameFlow.state === FLOW.LOBBY) {
      if (this.gameFlow.canResumeFromLobby()) {
        if (this.isCrashed) return;
        this.resumeFlight();
      } else {
        this.fly();
      }
    }
  }

  beginFlightRecording() {
    this.crashDebriefRemaining = null;
    this.debriefReport = null;
    this.debriefReplay = null;
    const sortie = { airport: this.activeAirport, aircraft: this.currentAircraftId,
      scenario: this.demoDirector?.isActive ? 'demo' : this.lastPresetType,
      demoProfile: this.lobby.demoProfile, timeOfDay: this.sky.timeOfDay };
    this.flightRecorder?.start(sortie);
    this.replayRecorder?.start(sortie);
  }

  updateFlightRecording(dt, { missionOwned = false } = {}) {
    if (this.gameFlow.state !== FLOW.FLIGHT || !this.flightRecorder.active || this.devRunner?.active) return;
    this.flightRecorder.update(dt, this.telemetry);
    this.replayRecorder.update(dt, this.telemetry, this.quaternion);
    // Playback stages the impact from this marker; the pose track itself ends there (#648).
    if (this.isCrashed) this.replayRecorder.markCrash(this.crashResult);
    // The mission runner owns scoring and its completion UI. Only observe its ticks.
    if (missionOwned) return;
    if (this.isCrashed) {
      // Freeze the sortie at impact, while the exterior crash scene keeps running.
      this.debriefReport = this.flightRecorder.finish('crash', this.crashResult);
      this.debriefReplay = this.replayRecorder.finish();
      this.crashDebriefRemaining = 3;
    }
    else if (this.waterDitching?.submerged && this.waterDitching?.timeSinceSubmerged >= 4) {
      this.endFlight('ditching');
    }
    else if (this.flightRecorder.stopped >= 3) this.endFlight('landed');
  }

  /** Count only visible crash frames, never deterministic physics or menu time. */
  updateCrashDebrief(dt) {
    if (this.crashDebriefRemaining == null) return;
    if (!this.isCrashed || this.gameFlow.state === FLOW.LOBBY || this.devRunner?.active || this.pilotArena?.active) {
      this.crashDebriefRemaining = null;
      return;
    }
    if (this.gameFlow.state !== FLOW.FLIGHT || this.browserBackgrounded || !Number.isFinite(dt) || dt <= 0) return;
    this.crashDebriefRemaining = Math.max(0, this.crashDebriefRemaining - dt);
    if (this.crashDebriefRemaining <= 1e-9) this.endFlight('crash');
  }

  endFlight(reason = 'manual') {
    if (!this.flightRecorder.active && !(this.isCrashed && this.debriefReport?.reason === 'crash')) {
      if (this.gameFlow.canResumeFromLobby() || this.gameFlow.state === FLOW.PAUSED) {
        this.gameFlow.returnToLobby(false);
        this.syncFlowUi();
      }
      return;
    }
    if (![FLOW.FLIGHT, FLOW.PAUSED].includes(this.gameFlow.state) && !this.gameFlow.canResumeFromLobby()) return;
    this.crashDebriefRemaining = null;
    this.debriefReport = this.isCrashed ? this.flightRecorder.finish('crash', this.crashResult)
      : this.flightRecorder.finish(reason);
    this.debriefReplay = this.replayRecorder.finish();
    // Keep the latest sortie in the library even when the debrief's manual save is skipped;
    // the fixed auto_save slot is overwritten on the next flight (#645).
    if (this.debriefReplay) this.replayStore.saveAuto(this.debriefReplay);
    // An arena run reports its own end when leaving flight stops the runner.
    if (!this.pilotArena?.active) this.analytics?.trackFlightEnd?.({
      airport: this.activeAirport,
      aircraft: this.currentAircraftId,
      scenario: this.lastPresetType,
      reason: this.isCrashed ? 'crash' : reason,
      durationSeconds: this.debriefReport?.durationSec,
      glocIncidents: this.debriefReport?.glocIncidents,
      maxG: this.debriefReport?.peaks?.gForce?.gForce,
    });
    this.gameFlow.endFlight();
    this.debriefOverlay.show(this.debriefReport, this.debriefReplay);
  }

  /** Leave a replay the debrief opened for that same debrief instead of the lobby (#648). */
  returnToDebrief(report, replay) {
    // Freeze the playback host flight before releasing pose ownership, as the lobby exit does.
    if (!report || !this.gameFlow.endFlight()) return false;
    this.replayDirector.stop();
    this.debriefReport = report;
    this.debriefReplay = replay;
    this.debriefOverlay.show(report, replay);
    return true;
  }

  /** Persists the finished sortie's pose track. Returns the store's error token for the debrief to show. */
  saveDebriefReplay() {
    if (!this.debriefReplay) return { ok: false, error: 'tooShort' };
    const { entry, error } = this.replayStore.save(this.debriefReplay);
    this.analytics?.trackReplaySaved?.({ result: entry ? 'ok' : error, durationSeconds: this.debriefReplay.durationSec });
    return { ok: Boolean(entry), error: error ?? null };
  }

  openFeedbackDialog() {
    this._openFeedbackDialog?.(this);
  }

  openJoystickCheckDialog() {
    this.joystickDialog?.open();
  }

  retryDebrief() {
    if (this.multiplayer?.active) { this.multiplayer.respawnLocal(); return; }
    if (this.gameFlow.state !== FLOW.DEBRIEF) return;
    const metadata = this.debriefReport.metadata;
    Object.assign(this.lobby, { airport: metadata.airport, aircraft: metadata.aircraft,
      preset: metadata.scenario, demoProfile: metadata.demoProfile });
    // Replay the recorded sky without saving it or treating it as the user's time choice.
    this.setTimeOfDay(metadata.timeOfDay, { persist: false, userChoice: false });
    this.startFlight({ keepTimeOfDay: true });
  }

  /** Resume the held flight without applying pending menu choices or respawning. */
  resumeFlight() {
    if (this.airportLoading || this.startingFlight || this.isCrashed) return;
    if (this.gameFlow.canResumeFromLobby()) this.gameFlow.enterFlight();
  }

  /** Keep the toggle's icon and accessible label in sync with the flow state. */
  updateMenuToggle() {
    const btn = document.getElementById('menu-toggle');
    if (!btn) return;
    const isMenu = this.gameFlow.state === FLOW.LOBBY || this.gameFlow.state === FLOW.PAUSED;
    const canResume = this.gameFlow.canResumeFromLobby() || this.gameFlow.state === FLOW.PAUSED;

    // In flight / paused: keep toggle in the HUD top bar.
    // In lobby: hide toggle because lobby card has its own back/resume controls.
    if (this.gameFlow.state === FLOW.LOBBY) {
      btn.hidden = true;
    } else {
      btn.hidden = false;
      const topBar = document.querySelector('.hud-top-bar');
      if (topBar && btn.parentElement !== topBar) {
        topBar.prepend(btn);
      }
    }

    // Only show the "close (✕)" state when there is an active flight to resume to.
    // In a clean boot lobby without a held sortie, the lobby is the home base.
    const showCloseAffordance = isMenu && canResume;
    btn.classList.toggle('is-open', showCloseAffordance);
    btn.classList.toggle('can-resume', canResume);
    if (isMenu) {
      bindText(btn, () => t(canResume ? 'lobby.resume' : 'lobby.startNew'), 'aria-label');
      bindText(btn, () => t(canResume ? 'lobby.resume' : 'lobby.startNew'), 'title');
    } else {
      bindText(btn, () => t('menu.open'), 'aria-label');
      bindText(btn, () => t('menu.open'), 'title');
    }
    btn.setAttribute('aria-expanded', String(isMenu));
    btn.setAttribute('aria-controls', isMenu ? (this.gameFlow.state === FLOW.PAUSED ? 'pause-menu' : 'lobby-screen') : 'lobby-screen');
    const title = btn.querySelector('.menu-toggle-title');
    if (title) {
      bindText(title, () => isMenu ? (canResume ? t('lobby.resume') : t('lobby.startNew')) : t('debrief.lobby'));
    }
  }

  setTimeOfDay(hours, { persist = true, userChoice = true } = {}) {
    if (this.multiplayer?.locked) return;
    if (userChoice) this.demoDirector?.onUserTimeOfDayChange();
    this.sky.setTimeOfDay(hours, this.position, this.camera.position);
    if (persist) saveSimulatorPreferences({ timeOfDay: this.sky.timeOfDay });
    this.foliage.setTimeOfDay(this.sky.timeOfDay);
    this.water.syncWithAtmosphere(this.sky);
    this.showTimeOfDayNotice();
  }

  /** Follow the device's local clock again: forget the saved time and let demos script theirs. */
  useDeviceTimeOfDay() {
    this.demoDirector?.clearUserTimeOfDayChange();
    forgetSimulatorPreference('timeOfDay');
    applyDeviceTimeOfDay(this);
    this.showTimeOfDayNotice();
  }

  showTimeOfDayNotice() {
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
   * Interior state for the camera's cockpit-entry gate. 'loading' is what starts the download,
   * so a visitor who never enters a cockpit never pays for the interior asset. Aircraft whose
   * cabin arrives inside the airframe model have no lazy loader and report their own state.
   */
  cockpitInteriorStatus() {
    const cockpit = this.aircraft?.cockpit;
    if (!cockpit) return 'ready';
    if (cockpit.gltfCockpitLoaded) return 'ready';
    if (cockpit.cockpitModelFailed) return 'unavailable';
    if (cockpit.ensureCockpitModel?.()) {
      // The only place the interior asset is requested, so this is also the only moment the
      // visitor waits on it: say so rather than appearing to ignore the view change.
      this.showToast(() => t('notice.cockpit.loading'));
      return 'loading';
    }
    return cockpit.cockpitModelLoading ? 'loading' : 'ready';
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
      // A cockpit entry the gate held lands once the programs are compiled, so the cut never
      // arrives a frame ahead of the shaders it needs.
      cockpit.shaderWarmup?.then(() => this.cameraSystem?.completeCockpitEntry());
    };
  }

  prepareCrashVisuals() {
    if (this.isCrashed || this.aircraft.loadingGltf) return;
    if (!this.aircraftBreakup.prepare(this.aircraft)) return;
    // The debris uses mesh programs (not the intact model's batched programs).
    // Gather them off-scene while retaining the real scene lighting/environment.
    this.crashShaderWarmup = this.renderer.compileAsync(
      this.aircraftBreakup.preparedRoot, this.camera, this.scene
    ).catch(error => console.warn('Crash shader warmup failed:', error));
  }

  /**
   * Construct an aircraft model for the per-session cache. The instrument canvases are
   * shared: a model only draws into them while it is the active aircraft, so building a
   * second one ahead of the user's pick costs memory but cannot disturb the current view.
   */
  buildAircraftInstance(aircraftId) {
    const instance = aircraftId === 'F16'
      ? new F16()
      : aircraftId === 'C172'
        ? new Cessna172(this.pfdCanvas, this.ndCanvas)
        : new Boeing737(
          this.pfdCanvas,
          this.ndCanvas,
          this.eicasCanvas,
          this.mcpCanvas,
          this.isfdCanvas,
          this.cduCanvas
        );
    const preset = RENDER_QUALITY[this.renderQuality];
    if (preset?.flatShading) {
      instance.setFlatShading?.(true);
      applyFlatShading(instance.group, true);
    }
    return instance;
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
    // Boot waits for the airframe only. The streamed interior belongs to the cockpit view, not
    // to the lobby, and aircraft whose cabin ships inside the airframe model still land here.
    while (this.aircraft.loadingGltf) {
      if (performance.now() > deadline) throw new Error('Startup assets timed out');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.prepareCrashVisuals();
    let timeout;
    try {
      await Promise.race([
        Promise.all([this.aircraft.cockpit?.shaderWarmup, this.crashShaderWarmup]),
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

  setAircraft(aircraftId = 'B738', pilotPreparation = false) {
    if (this.multiplayer?.locked) return;
    if (this.pilotArena?.active && !pilotPreparation) this.pilotArena.stop('aircraft-changed');
    const config = AIRCRAFT_REGISTRY[aircraftId];
    if (!config) return;
    this.bridgeFlight?.stop();
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
    const currentPreset = RENDER_QUALITY[this.renderQuality];
    if (currentPreset?.flatShading !== undefined) {
      instance.setFlatShading?.(currentPreset.flatShading);
      applyFlatShading(instance.group, currentPreset.flatShading);
    }
    instance.group.visible = !this.isCrashed;
    if (instance.group.parent !== this.scene) {
      this.scene.add(instance.group);
    }
    this.loadAircraftConfig(config);

    if (this.cockpitOcclusion && this.aircraft.cockpit) {
      this.cockpitOcclusion.cockpit = this.aircraft.cockpit;
    }

    if (this.cameraSystem) {
      if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT) {
        const interior = this.cockpitInteriorStatus();
        if (interior !== 'ready') {
          // This model's cabin has not arrived: hold the exterior and land back inside once it
          // has, instead of rendering a cockpit shell with no interior geometry.
          this.cameraSystem.setMode(CameraSystem.MODES.CHASE, true);
          if (interior === 'loading') this.cameraSystem.holdCockpitEntry();
          else this.showToast(() => t('notice.cockpit.unavailable'));
        }
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
    if (this.browserBackgrounded) return;
    const frameDelta = this.startupReady ? clampFrameDelta(elapsed) : 0;
    // Also covers model swaps and failed-load procedural fallbacks. Preparation
    // precedes physics so the first impact after loading can reuse the fragments.
    this.prepareCrashVisuals();
    this.replayPanel?.refresh();
    this.totalSimTime += frameDelta;
    if (!this.gameFlow.isPhysicsFrozen()) this.devRunner.updatePreparation(frameDelta);
    this.devPanelTimer = (this.devPanelTimer || 0) + frameDelta;
    if (this.devPanelTimer >= .2) { this.developerPanel?.refresh(); this.devPanelTimer = 0; }

    // High-rate substepping for rock-solid flight physics
    const poseDriver = this.activePoseDriver();
    if (poseDriver) {
      this.physicsAccumulator = 0;
      if (!this.gameFlow.isPhysicsFrozen()) poseDriver.update(frameDelta);
    } else if (this.startingFlight || this.multiplayer?.modalOpen || this.multiplayer?.room?.session.state === 'starting' || this.gameFlow.isPhysicsFrozen() || this.devRunner.blocksPhysics || this.pilotArena?.active || this.demoDirector?.isRestartConfirmOpen) {
      this.physicsAccumulator = 0;
    } else {
      advancePhysicsFrame(this, frameDelta);
    }

    // Keep the lobby backdrop alive: re-arm the demo after it ends.
    this.gameFlow.update(frameDelta);
    if (!this.multiplayer?.active && !this.multiplayer?.modalOpen && this.gameFlow.consumeDemoRestart()) {
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

    // 4. Update Cockpit Visibility & Audio
    let isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    if (!this.cameraSystem.photoCockpit && this.aircraft.cockpit.cockpitModelFailed) {
      // The GLTF interior is the only 3D cockpit geometry, and it never arrived.
      // The exterior groups are hidden in this mode, so pull the view out. A held
      // entry has no view to pull: it only stops waiting, and must still say why.
      const wasHeld = this.cameraSystem.releaseCockpitEntry();
      const wasCockpit = isCockpit;
      if (wasCockpit) {
        this.cameraSystem.setMode(CameraSystem.MODES.CHASE, true);
        isCockpit = false;
      }
      if ((wasCockpit || wasHeld) && !this.interiorUnavailableWarned) {
        this.interiorUnavailableWarned = true;
        this.showToast(() => t('notice.cockpit.unavailable'));
      }
    }

    // 2. Update Flight Instrument Canvas Displays
    // In ultraLow mode while outside cockpit, skip 2D canvas redraws to save CPU and texture uploads.
    if (isCockpit || this.renderQuality !== 'ultraLow') {
      this.updateFlightDisplays();
    }

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
    this.currentAirport?.nightLighting?.update(this.sky.sunPosition.y);
    if (!this.gameFlow.isPhysicsFrozen()) {
      this.explosionSystem.update(frameDelta);
      this.tireSmokeSystem.update(frameDelta);
    }

    const isLookingAway = isCockpit && this.cameraSystem.isLookingAwayFromCenter();
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && this.cameraSystem.supportsPhotoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit);
    if (!isCockpit && this.renderQuality === 'ultraLow') {
      if (this.aircraft.cockpit?.group) {
        this.aircraft.cockpit.group.visible = false;
      }
    }
    this.contactShadow.setEnabled(!isCockpit && this.renderQuality === 'ultraLow');
    const { x: shadowX, z: shadowZ } = this.aircraft.group.position;
    this.contactShadow.update(this.aircraft.group.position, this.aircraft.group.quaternion,
      contactShadowSurfaceHeight(this.currentTerrain, this.water, shadowX, shadowZ),
      this.currentAircraftId, this.aero.wingspan);
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
      cockpitActive: isCockpit && !isPhotoCockpit && this.renderQuality !== 'ultraLow',
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
    this.pilotPhysiologyFx?.update(this.cameraSystem?.mode, this.telemetry?.pilot);
    this.loadingPanel.update();

    this.foliage.update(this.camera.position);

    this.multiplayer?.update();

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
    this.updateCrashDebrief(frameDelta);
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
