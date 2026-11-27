import { regionalCruise } from './config/regionalCruises.js';
import { ExternalAirportStreamer } from './world/ExternalAirportStreamer.js';
import { UnifiedWorld } from './world/UnifiedWorld.js';
import { LandmarkPins } from './ui/LandmarkPins.js';
import { StartupProgressView } from './ui/StartupProgressView.js';
import { compileVisibleScene } from './core/sceneShaderWarmup.js';
import { FlightPerformanceMonitor, FlightGpuTimer } from './core/FlightPerformanceMonitor.js';
import { FrameTransitionMonitor } from './core/FrameTransitionMonitor.js';
import { longTaskSummary } from './core/inputLatency.js';
import { createSimulatorScenarioStart } from './core/simulatorScenarioStart.js';
import { createSimulatorFlightStart, recoverSimulatorFlightStart } from './core/simulatorFlightStart.js';
import { MultiplayerController } from './multiplayer/MultiplayerController.js';
import { FlightWarnings } from './systems/FlightWarnings.js';
import { AircraftBreakup } from './effects/AircraftBreakup.js';
import { t, bindText, initLocalization } from './i18n/index.js';
import * as THREE from 'three';
import { cockpitCasterState } from './aircraft/CockpitLighting.js';
import { applyAircraftLivery } from './aircraft/applyAircraftLivery.js';
import { CockpitShadowDemo } from './director/CockpitShadowDemo.js';
import { ReplayDirector } from './director/ReplayDirector.js';
import { CockpitOcclusion } from './aircraft/CockpitOcclusion.js';
import { BOEING_737_800, registerAddonAircraft, resolveAircraftConfig } from './config/aircraftConfigs.js';
import { BODY_SUPPORT_POINTS, resolveBodySupportPoints } from './physics/groundContacts.js';
import { Aerodynamics, createAeroResult } from './physics/Aerodynamics.js';
import { PilotPhysiology } from './physics/PilotPhysiology.js';
import { SIM_CONFIG } from './config/simConfig.js';
import { advancePhysicsFrame, clampFrameDelta } from './core/physicsTiming.js';
import { EngineModel } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { WaterDitching } from './physics/WaterDitching.js';
import { createSimulatorAutopilot } from './physics/Autopilot.js';
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
import { RENDER_QUALITY, RENDER_QUALITY_KEY, initialRenderQuality, renderPixelRatio, applyFlatShading } from './config/renderQuality.js';
import { WaterOcean } from './environment/WaterOcean.js';
import { SkyAtmosphere } from './environment/SkyAtmosphere.js';
import { GroundContactShadow, contactShadowSurfaceHeight } from './environment/GroundContactShadow.js';
import { requestProceduralAsset } from './core/proceduralAssetPool.js';
import { FlightAudio } from './audio/FlightAudio.js';
import { FlightControls } from './controls/FlightControls.js';
import { CameraSystem } from './cameras/CameraSystem.js';
import { MobileHeadTracking } from './cameras/MobileHeadTracking.js';
import { HeadTrackingUi } from './cameras/HeadTrackingUi.js';
import { HudView } from './ui/HudView.js';
import { AirToAirMissileSystem } from './weapons/AirToAirMissileSystem.js';
import { CannonCombatView } from './weapons/CannonCombatView.js';
import { MissileCombatView } from './weapons/MissileCombatView.js';
import { presentCombatEvent } from './weapons/combatPresentation.js';
import { RearmSystem } from './systems/RearmSystem.js';
import { RenderPose } from './core/RenderPose.js';
import { DiagnosticsInspector } from './ui/DiagnosticsInspector.js';
import { JoystickCheckDialog } from './ui/JoystickCheckDialog.js';
import { DemoFlightDirector } from './director/DemoFlightDirector.js';
import { VoiceChallengeOverlay } from './ui/VoiceChallengeOverlay.js';
import { CollisionDetector } from './physics/CollisionDetector.js';
import { ExplosionSystem } from './effects/ExplosionSystem.js';
import { TireSmokeSystem } from './effects/TireSmokeSystem.js';
import { PilotPhysiologyFx } from './effects/PilotPhysiologyFx.js';
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
  loadSavedDestination,
  saveSavedAircraft,
} from './config/flightSelection.js';
import { resolveFlightUrl, parsePoseUrlParams } from './config/flightUrls.js';
import { pinnedAddonAircraftList, resolveSharedAddonPack } from './addons/addonCatalogBrowser.js';
import {
  BASE_ADDON_CATALOG_URL,
  loadDefaultBaseAddonCatalog,
  resolveCatalogAddons,
} from './addons/baseAddonRegistry.js';
import { AddonAircraft } from './aircraft/AddonAircraft.js';
import { hasExplicitAddonParams, resolveAddonSearch, savedAddonSearchParams } from './addons/savedAddonProfile.js';
import { applyRegionPalette } from './addons/regionVisuals.js';
import { applyDeviceTimeOfDay, forgetSimulatorPreference, loadSimulatorPreferences,
  restoreSimulatorPreferences, saveSimulatorPreferences } from './config/simulatorPreferences.js';
import { TouchFlightControls } from './controls/TouchFlightControls.js';
import { CockpitPhotoOverlay } from './aircraft/CockpitPhotoOverlay.js';
import { initBuildInfo } from './ui/BuildInfo.js';
import { installInputLatencyMonitor } from './ui/InputLatencyMonitor.js';
import { installStartupLoadMonitor, readDevice, readGpuClass } from './ui/StartupLoadMonitor.js';
import { installPresetSpawner } from './core/PresetSpawner.js';
import { installPhysicsIntegrator } from './core/PhysicsIntegrator.js';
import { installSimulatorHudAndBindings } from './ui/SimulatorHudAndBindings.js';
import { collapseMapAttribution } from './ui/mapAttribution.js';
import { SimulatorAudioCoordinator } from './core/SimulatorAudioCoordinator.js';
import { SimulatorInputCoordinator } from './core/SimulatorInputCoordinator.js';
import {
  initAnalytics,
  getPostHogConfig,
  trackEvent,
  trackFlightPerformance,
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
const startupProgress = new StartupProgressView();
// Loading disclosure and scrolling keep native keys without reaching flight shortcuts.
SimulatorInputCoordinator.installStartupInputShield();

async function startupStage(value, message) {
  startupTrace?.noteStage(value);
  startupProgress.stage(value, message);
  await new Promise(resolve => requestAnimationFrame(resolve));
}

async function resolveAddonPinnedPack(search) {
  if (hasExplicitAddonParams(search)) return resolveSharedAddonPack(search);
  if (savedAddonSearchParams()) {
    try {
      const savedPack = await resolveSharedAddonPack(resolveAddonSearch(search));
      if (savedPack) return savedPack;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.addonStartupError = message;
      console.warn('Saved addons could not be loaded:', error);
    }
  }
  try {
    const baseCatalog = await loadDefaultBaseAddonCatalog();
    if (baseCatalog?.addons?.length) {
      return await resolveCatalogAddons(baseCatalog);
    }
  } catch (error) {
    console.warn('Default base addon catalog could not be loaded:', error);
  }
  return null;
}

async function startupDetail(key) {
  startupProgress.detail(key);
  if (!document.hidden) await new Promise(resolve => requestAnimationFrame(resolve));
}

function showStartupError(error) {
  startupTrace?.noteFailed();
  startupProgress.fail();
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
    startupProgress.reset();
    this.deviceTimeOfDay = false;
    this.startupProgress = startupProgress;
    initUiScale();
    await startupStage(0, 'startup.scene');
    this.addonAircraftDescriptors = new Map();
    try {
      this.pinnedAddonPack = await resolveAddonPinnedPack(window.location.search);
      for (const descriptor of pinnedAddonAircraftList(this.pinnedAddonPack)) {
        if (descriptor?.id) this.addonAircraftDescriptors.set(descriptor.id, descriptor);
      }
      if (!hasExplicitAddonParams(window.location.search) && savedAddonSearchParams()) {
        try {
          const baseCatalog = await loadDefaultBaseAddonCatalog();
          const aircraftEntries = (baseCatalog?.addons ?? [])
            .filter(entry => entry.id?.includes('/aircraft/') && entry.compatible !== false);
          if (aircraftEntries.length > 0) {
            const basePack = await resolveCatalogAddons({ schemaVersion: 1, addons: aircraftEntries });
            for (const descriptor of pinnedAddonAircraftList(basePack)) {
              if (descriptor?.id && !this.addonAircraftDescriptors.has(descriptor.id)) {
                this.addonAircraftDescriptors.set(descriptor.id, descriptor);
              }
            }
          }
        } catch (error) {
          console.warn('Default base aircraft addons skipped:', error);
        }
      }
      if (this.addonAircraftDescriptors.size > 0) {
        registerAddonAircraft([...this.addonAircraftDescriptors.values()]);
      }
    } catch (error) {
      startupProgress.failure?.(error.message);
      throw error;
    }
    const savedSelection = resolveFlightUrl(window.location.search, loadSavedFlightSelection());
    // Pinned now: by emit time the lobby context may already describe a flight the user started.
    startupTrace?.noteSelection(savedSelection);
    this.performanceTelemetryEnabled = getPostHogConfig().enabled;
    this.flightPerformance = new FlightPerformanceMonitor({ emit: report => trackFlightPerformance({
      ...report, device: readDevice(globalThis), gpu: this.performanceGpuClass,
      gpuTimerSupported: Boolean(this.flightGpuTimer?.extension),
      longTasks: inputLatency ? longTaskSummary(inputLatency.state, report.windowStartMs, report.windowEndMs) : null,
    }) });
    this.container = document.getElementById('canvas-container');
    this.inputLatency = inputLatency;
    this.frameTransitions = new FrameTransitionMonitor({
      clock: () => performance.now(),
      afterPaint: callback => requestAnimationFrame(() => requestAnimationFrame(callback)),
      isHidden: () => document.hidden || this.browserBackgrounded === true,
      emit: report => trackEvent('frame_transition', { ...report, device: readDevice(globalThis), gpu: readGpuClass(globalThis) }),
      longTasks: (start, end) => inputLatency ? longTaskSummary(inputLatency.state, start, end) : null,
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.frameTransitions.cancel();
    });

    // 1. Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    // near: 0.08m and far: 45,000m combined with logarithmicDepthBuffer completely eliminates pillar clipping & Z-fighting
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 45000);

    let savedQuality;
    try {
      const urlQuality = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('quality');
      savedQuality = urlQuality || localStorage.getItem(RENDER_QUALITY_KEY);
    } catch { /* Use default. */ }
    this.renderQuality = initialRenderQuality(savedQuality, {
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      deviceMemory: navigator.deviceMemory,
    });
    const initialPreset = RENDER_QUALITY[this.renderQuality];

    this.renderer = new THREE.WebGLRenderer({
      antialias: initialPreset.antialias ?? true,
      logarithmicDepthBuffer: initialPreset.logarithmicDepthBuffer ?? true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(renderPixelRatio(this.renderQuality, window.innerWidth, window.innerHeight,
      window.devicePixelRatio, savedSelection.aircraft));
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

    // 5. Procedural World & Real-World Environments (region geometry & scenery load on demand)
    this.terrain = null;
    this.airport = null;
    this.foliage = null;
    this.ships = null;
    this.neonCity = null;
    this.persistentValley = null;
    this.activeAirport = null; // setAirport below builds and selects only the active region
    this.currentTerrain = null;
    this.currentAirport = null;
    this._geoLayers = null;
    this._geoLayersPromise = null;
    this.freezePhysics = false;

    // Height-over-ground cue for the ultraLow tier, which ships without shadow maps.
    this.contactShadow = new GroundContactShadow(this.scene);
    this.contactShadow.setEnabled(this.renderQuality === 'ultraLow');

    this.water = new WaterOcean(36000, initialPreset.waterSegments ?? 180, { quality: this.renderQuality });
    this.scene.add(this.water.mesh);

    // Phase 1 unified world: regions register as they are selected or approached.
    this.world = new UnifiedWorld(savedSelection.airport);

    await startupDetail('startup.detail.sky');
    this.sky = new SkyAtmosphere(this.scene, this.renderer, this.water, {
      deferCloudDensity: true,
      deferHdr: true,
    });
    this.sky.setShadowMapSize(initialPreset.shadowMapSize);
    this.sky.setFarShadowQuality(initialPreset.farShadowMapSize, initialPreset.farShadowRange);
    if (this.sky?.setCloudsVisible) {
      this.sky.setCloudsVisible(initialPreset.clouds ?? true);
    }
    this.water.syncWithAtmosphere(this.sky);
    applyRegionPalette(this.pinnedAddonPack, { water: this.water, sky: this.sky });

    await startupStage(3, 'startup.controls');

    await startupDetail('startup.detail.systems');
    // 6. Audio & Controls & Camera & Diagnostics
    this.audio = new FlightAudio();
    this.audioCoordinator = new SimulatorAudioCoordinator(this.audio, this);
    this.controls = new FlightControls(this.renderer.domElement);
    this.touchControls = new TouchFlightControls(this.controls);
    this.touchControls.onOptionsChange = () => this.lobby?.refresh?.();
    this.inputCoordinator = new SimulatorInputCoordinator(this);
    this.inputCoordinator.bindFlightPanels({
      controls: this.controls,
      aero: this.aero,
      audio: this.audio,
      isCrashedGetter: () => this.isCrashed,
    });
    this.cameraSystem = new CameraSystem(this.camera, this.renderer.domElement, {
      logarithmicDepthBuffer: Boolean(this.renderer.capabilities?.logarithmicDepthBuffer ?? initialPreset.logarithmicDepthBuffer ?? true),
    });
    this.mobileHeadTracking = new MobileHeadTracking(this.cameraSystem, {
      onStatusChange: (status) => this.headTrackingUi?.update(status),
    });
    this.headTrackingUi = new HeadTrackingUi(this.mobileHeadTracking);
    this.cameraSystem.setTerrain(null);
    // The interior is fetched by the first cockpit view rather than by boot, and the cut is
    // held until it arrives so an entry never shows the bare airframe interior.
    this.cameraSystem.setCockpitInteriorGate(() => this.cockpitInteriorStatus());
    this.hudView = new HudView(this);
    this.cameraSystem.onResetLook = () => {
      this.showToast(() => t('camera.view.centered'));
    };
    this.cameraSystem.onGazeClick = (clientX, clientY) => this.handleGazeCanvasClick(clientX, clientY);
    this.loadAircraftConfig(resolveAircraftConfig(savedSelection.aircraft) || BOEING_737_800);
    this.diagnostics = new DiagnosticsInspector(this);
    if (typeof window !== 'undefined' && (new URLSearchParams(window.location.search).has('fps') || new URLSearchParams(window.location.search).has('diagnostics'))) {
      this.diagnostics.show();
    }
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
    this.lobby = { airport: savedSelection.airport, preset: savedSelection.scenario, aircraft: savedSelection.aircraft, pilotMode: 'human', destination: loadSavedDestination(), mapPlan: null };
    this.destinationAirport = this.lobby.destination;
    this.currentAircraftId = savedSelection.aircraft;
    this.lastPresetType = savedSelection.scenario;
    this.startingFlight = false;
    this.applyingPendingStart = false;

    // 7. Collision Detection & Explosion & Tire Smoke Particle Systems
    this.collisionDetector = new CollisionDetector(
      null,
      null,
      null,
      null,
      this.water
    );
    this.collisionDetector.setTerrainOverrideProvider(() => this.terrainProviderOverride);
    this.explosionSystem = new ExplosionSystem(this.scene, this.currentTerrain, { deferTextures: true });
    this.aircraftBreakup = new AircraftBreakup(this.scene);
    this.missileCombat = new AirToAirMissileSystem();
    this.missileCombatView = new MissileCombatView(this.scene, this.missileCombat, {
      terrainHeight: (x, z) => this.currentTerrain?.getHeight(x, z) ?? 0,
      explosionSystem: this.explosionSystem,
      audio: this.audio,
      camera: this.camera,
      waterLevel: () => (this.water?.mesh?.visible ? this.water.waterLevel : null),
    });
    this.cannonCombatView = new CannonCombatView(this.scene, this.missileCombat);
    this.rearmSystem = new RearmSystem();
    // A replay owns the combat feed: its recorded missile poses and bandit
    // states drive the director instead of the inactive live system.
    this.cameraSystem.setCombatStateProvider(() => {
      const replayCombat = this.replayDirector?.combatState();
      if (replayCombat) {
        return {
          ...replayCombat,
          targetViews: this.replayDirector?.combatView?.()?.targetViews ?? null,
        };
      }
      return {
        missiles: this.missileCombat.missiles,
        targets: this.missileCombat.targets,
        flares: this.missileCombat.flares,
        chaffClouds: this.missileCombat.chaffClouds,
        targetViews: this.missileCombatView?.targetViews ?? null,
      };
    });
    this._combatTerrainHeight = (x, z) => this.currentTerrain?.getHeight(x, z) ?? 0;
    this.tireSmokeSystem = new TireSmokeSystem(this.scene, this.currentTerrain, { deferTextures: true });

    // Step 2 streams one index-backed destination into the persistent world.
    // Terrain outside its pavement comes from the anchor's open-world sample;
    // the runway surface itself owns its contact height.
    this.airportStreamer = new ExternalAirportStreamer({
      world: this.world,
      scene: this.scene,
      onStatus: status => {
        this.world.setDynamicStatus(status.code, status);
        if (status.state === 'failed' && this.gameFlow?.state === 'flight') {
          this.showToast(() => t('airport.stream.failed', { code: status.code }));
        }
      },
      outsideHeight: (x, z, { unblended = false } = {}) => {
        // ExternalSurface passes Incheon-frame coordinates; openWorld samples
        // are keyed in the current anchor's local frame.
        // Use unblended raw DEM when available so ExternalAirportSurface.getHeight()
        // blends with natural terrain without double-blending against the mesh.
        const [ax, az] = this.world.incheonFrameToAnchor(x, z);
        const openWorld = this.world.anchorTerrain?.openWorld;
        if (unblended) {
          const raw = openWorld?.sampleRaw?.(ax, az);
          if (Number.isFinite(raw)) return raw;
        }
        const sampled = openWorld?.sample?.(ax, az)?.height;
        return Number.isFinite(sampled) ? sampled : null;
      },
    });
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

    // Autopilot owns its trim snapshot and Flight3d's airport/corridor guidance.
    // The trim solver runs only on mode/target capture, off the 120 Hz path.
    this.autopilot = createSimulatorAutopilot(this);
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
      trackEvent,
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

    await startupDetail('startup.detail.ui');
    inputLatency?.mark('startup-ui-start');
    restoreSimulatorPreferences(this, loadSimulatorPreferences());
    this.initControls();
    this.initUI();
    inputLatency?.mark('startup-ui-end');
    await startupDetail('startup.detail.selectedAirport');
    inputLatency?.mark('startup-airport-start');
    await this.setAirport(savedSelection.airport);
    if (savedSelection.airport === 'patagonia' && !this.patagoniaTerrain?.isLoaded) {
      await this.patagoniaTerrain?.demReady;
    }
    inputLatency?.mark('startup-airport-end');

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());

    this.initBrowserActivity();

    // Start with the flight when autoplay is permitted. Otherwise the browser
    // keeps the context suspended until the first flight/menu interaction.
    this.ensureAudio = () => this.audioCoordinator.ensureAudio();
    this.syncAudioHint = () => this.audioCoordinator.syncAudioHint();
    this.audioCoordinator.initInteractionListeners();

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

    // Link visible scene programs before the first draw. compileAsync polls
    // KHR_parallel_shader_compile instead of blocking getUniforms in render().
    await startupDetail('startup.detail.shaders');
    inputLatency?.mark('startup-shaders-start');
    let shaderTimeout;
    try {
      await Promise.race([
        compileVisibleScene(this.renderer, this.scene, this.camera),
        new Promise((_, reject) => {
          shaderTimeout = setTimeout(() => reject(new Error('Scene shaders timed out')), 60000);
        }),
      ]);
    } finally {
      clearTimeout(shaderTimeout);
      inputLatency?.mark('startup-shaders-end');
    }
    await startupDetail('startup.detail.firstFrame');
    // Do not draw while scene programs are still linking.
    this.clock.getDelta();
    this.hasRenderedFirstFrame = false;
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }
  /** Browser activity is a separate hold, so returning cannot undo menu/pause state. */
  initBrowserActivity() {
    if (this.inputCoordinator) {
      this.inputCoordinator.bindBrowserActivity(this);
    } else {
      const sync = () => this.setBrowserActive(!document.hidden && document.hasFocus());
      window.addEventListener('blur', () => this.setBrowserActive(false));
      window.addEventListener('focus', sync);
      document.addEventListener('visibilitychange', sync);
      window.addEventListener('pagehide', () => this.setBrowserActive(false));
      window.addEventListener('pageshow', sync);
      sync();
    }
  }

  setBrowserActive(active) {
    if (this.inputCoordinator) {
      this.inputCoordinator.syncBrowserActive(this, active);
    } else {
      const backgrounded = !active;
      if (this.browserBackgrounded === backgrounded) return;
      this.browserBackgrounded = backgrounded;
      this.flightPerformance?.flush('browser-activity');
      this.flightGpuTimer?.clear();
      this.lastFrameDelta = null;
      this.clock?.getDelta();
      this.physicsAccumulator = 0;
      if (backgrounded) {
        this.frameTransitions?.cancel();
        this.multiplayer?.roomReplay?.gap();
        this.controls?.releaseAllKeys();
        this.controls?.setTouchStick(0, 0);
        this.controls?.setTouchRudder(0);
        this.controls?.setTouchBrakes(0);
      }
      this.syncAudioPause();
      if (active) this.audio?.ensureContextRunning();
    }
  }

  syncAudioPause() {
    if (this.audioCoordinator) {
      this.audioCoordinator.syncAudioPause();
    } else {
      if (this.gameFlow && this.gameFlow.state !== FLOW.FLIGHT) {
        this.flightPerformance?.flush('flight-held');
        this.flightGpuTimer?.clear();
        this.lastFrameDelta = null;
      }
      const backgrounded = this.browserBackgrounded === true;
      const held = this.gameFlow?.state === FLOW.DEBRIEF || this.gameFlow?.state === FLOW.PAUSED || this.gameFlow?.canResumeFromLobby?.() || Boolean(this.demoDirector?.isRestartConfirmOpen);
      const radioPaused = backgrounded || this.gameFlow?.state !== FLOW.FLIGHT || Boolean(this.demoDirector?.isRestartConfirmOpen);
      if (this.audio?.setRadioPaused) this.audio.setRadioPaused(radioPaused);
      else if (this.audio?.departureRadio?.setPaused) this.audio.departureRadio.setPaused(radioPaused);
      this.audio?.setPaused?.(backgrounded || held);
    }
  }

  /** Apply the game-flow state to the DOM: menu visibility, input blocking. */
  syncFlowUi() {
    const state = this.gameFlow.state;
    this.frameTransitions?.flowChanged(state, this.gameFlow.canResumeFromLobby(), {
      renderQuality: this.renderQuality, camera: this.cameraSystem.mode,
    });
    if (state === FLOW.LOBBY) this.crashDebriefRemaining = null;
    // Pause retains the judged attempt; leaving flight for a menu ends it.
    // The arena runner gates every physics step on flow/background state.
    if (state !== FLOW.FLIGHT && state !== FLOW.PAUSED && this.pilotArena?.active) this.pilotArena.stop('flight-held');
    // A flight parked off the sim is silent and watched from the drone rig; the lobby
    // cinematic keeps its own sound and camera, so it is deliberately not held here.
    const held = state === FLOW.DEBRIEF || state === FLOW.PAUSED || this.gameFlow.canResumeFromLobby();
    this.syncAudioPause();
    document.body.dataset.flow = state;
    if (state !== FLOW.FLIGHT && this.cameraSystem) this.cameraSystem.chartPitchOffset = 0;
    if (state === FLOW.FLIGHT) {
      collapseMapAttribution();
      if (this.touchControls?.gyroRequested && !this.touchControls.gyroActive && !this.demoDirector?.isActive) {
        this.touchControls.restoreGyroSettings({ userGesture: true });
      }
    }
    document.body.dataset.devScenario = String(Boolean(this.devRunner?.active));
    document.body.dataset.devManualFlight = String(Boolean(this.devRunner?.active?.definition.pilotControlled));
    if (this.inputCoordinator) {
      this.inputCoordinator.updateInputBlocked(this);
    } else {
      this.controls.inputBlocked = this.multiplayer?.modalOpen || this.multiplayer?.room?.session.state === 'starting' || this.gameFlow?.blocksFlightInput?.() || this.shadowDemo?.active || Boolean(this.devRunner?.blocksInput) || Boolean(this.pilotArena?.active && this.pilotArena?.record?.pilotKind !== 'human') || Boolean(this.demoDirector?.isRestartConfirmOpen);
    }
    if (state !== FLOW.FLIGHT) {
      if (this.inputCoordinator) {
        this.inputCoordinator.releaseAllControls(this.controls);
      } else if (this.controls) {
        this.controls.releaseAllKeys();
        this.controls.setTouchStick(0.0, 0.0);
        this.controls.setTouchRudder(0.0);
        this.controls.setTouchBrakes(0.0);
      }
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
    this.lobbyCameraModal?.close();
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

  ensureGeographicLayers() {
    if (this._geoLayers) return Promise.resolve(this._geoLayers);
    this._geoLayersPromise ??= import('./environment/geographicLayers.js')
      .then(mod => {
        this._geoLayers = mod;
        return mod;
      })
      .catch(error => {
        this._geoLayersPromise = null;
        throw error;
      });
    return this._geoLayersPromise;
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
    if (this.replayDirector.active || this.replayDirector.loading) { this.replayPanel.exit(); return; }
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
    const customOrigin = this.world?.customOrigin;
    const sortie = { airport: this.activeAirport, aircraft: this.currentAircraftId,
      scenario: this.demoDirector?.isActive ? 'demo' : this.lastPresetType,
      demoProfile: this.lobby.demoProfile, timeOfDay: this.sky.timeOfDay,
      deviceTime: this.deviceTimeOfDay === true,
      ...(this.activeMapPlace?.label ? { placeLabel: this.activeMapPlace.label } : {}),
      ...(this.activeMapPlace?.code ? { airportCode: this.activeMapPlace.code } : {}),
      ...(this.activeMapPlace?.tileId ? { airportTileId: this.activeMapPlace.tileId } : {}),
      ...(customOrigin ? { customOrigin: { latitude: customOrigin.latitude, longitude: customOrigin.longitude } } : {}) };
    this.flightRecorder?.start(sortie);
    this.replayRecorder?.start(sortie);
  }

  updateFlightRecording(dt, { missionOwned = false } = {}) {
    if (this.gameFlow.state !== FLOW.FLIGHT || !this.flightRecorder.active || this.devRunner?.active) return;
    this.flightRecorder.update(dt, this.telemetry);
    this.replayRecorder.update(dt, this.telemetry, this.quaternion, this.missileCombat);
    // Playback stages the impact from this marker; the pose track itself ends there (#648).
    if (this.isCrashed) this.replayRecorder.markCrash(this.crashResult);
    // The mission runner owns scoring and its completion UI. Only observe its ticks.
    if (missionOwned) return;
    if (this.isCrashed) {
      // Freeze the sortie at impact, while the exterior crash scene keeps running.
      this.debriefReport = this.flightRecorder.finish('crash', this.crashResult);
      // The pose track ends at impact; playback stages the crash from the marker (#648).
      this.debriefReplay = this.replayRecorder.finish();
      if (this.crashDebriefRemaining == null) this.crashDebriefRemaining = 3;
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
    if (this.debriefReplay && !this.multiplayer?.roomReplay?.active) this.replayStore.saveAuto(this.debriefReplay, { report: this.debriefReport });
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
  async saveDebriefReplay() {
    const replay = this.debriefReplay;
    const report = this.debriefReport;
    if (!replay) return { ok: false, error: 'tooShort' };
    const { entry, error } = await this.replayStore.save(replay, { report });
    this.analytics?.trackReplaySaved?.({ result: entry ? 'ok' : error, durationSeconds: replay.durationSec });
    return { ok: Boolean(entry), error: error ?? null };
  }

  /** An in-flight report freezes physics behind the dialog and resumes on close. */
  openFeedbackDialog(options = {}) {
    const holdFlight = this.gameFlow.state === FLOW.FLIGHT;
    if (holdFlight) this.gameFlow.pause('feedback');
    const opened = this._openFeedbackDialog?.(this, {
      ...options,
      onClose: () => {
        if (holdFlight) this.gameFlow.resume('feedback');
        options.onClose?.();
      },
    });
    if (opened === false && holdFlight) this.gameFlow.resume('feedback');
    return opened;
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
    if (this.gameFlow.canResumeFromLobby()) {
      this.lobbyCameraModal?.close();
      this.gameFlow.enterFlight();
    }
  }

  /**
   * Snapshot the flight held behind the lobby menu. Pending lobby choices must
   * not leak into this card: the chosen region can change while a flight is held.
   */
  heldFlightForMenu() {
    const metadata = this.flightRecorder?.active ? this.flightRecorder.metadata : null;
    if (metadata) {
      return {
        airport: metadata.airport, aircraft: metadata.aircraft, scenario: metadata.scenario,
        demoProfile: metadata.demoProfile, timeOfDay: metadata.timeOfDay,
        deviceTime: Boolean(metadata.deviceTime),
        airportLabel: this.customLocationLabel || undefined,
        scenarioLabel: undefined,
      };
    }
    return {
      airport: this.activeAirport, aircraft: this.currentAircraftId,
      scenario: this.demoDirector?.isActive ? 'demo' : this.lastPresetType,
      demoProfile: this.lobby.demoProfile, timeOfDay: this.sky.timeOfDay,
      deviceTime: this.deviceTimeOfDay === true,
      airportLabel: this.customLocationLabel || undefined,
    };
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
    this.deviceTimeOfDay = false;
    this.sky.setTimeOfDay(hours, this.position, this.camera.position);
    if (persist) saveSimulatorPreferences({ timeOfDay: this.sky.timeOfDay });
    this.foliage?.setTimeOfDay(this.sky.timeOfDay);
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
    if (this.gear) {
      this.gear.bodySupportPoints = resolveBodySupportPoints(
        config?.landingGear?.bodySupportPoints,
        BODY_SUPPORT_POINTS,
      );
    }
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
    if (cockpit.ensureCockpitModel?.(this.renderQuality)) {
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
   * Link the particle and shockwave programs while the startup overlay is still
   * up. The explosion group has no renderable children before the first impact,
   * so scene-only shader warmup cannot cover these materials.
   */
  warmExplosionShaders() {
    if (this.explosionShaderWarmup || !this.explosionSystem?.createShaderWarmupRoot) return this.explosionShaderWarmup;
    const root = this.explosionSystem.createShaderWarmupRoot();
    this.explosionShaderWarmup = this.renderer.compileAsync(root, this.camera, this.scene)
      .catch(error => console.warn('Explosion shader warmup failed:', error));
    return this.explosionShaderWarmup;
  }

  /**
   * Construct an aircraft model for the per-session cache. The instrument canvases are
   * shared: a model only draws into them while it is the active aircraft, so building a
   * second one ahead of the user's pick costs memory but cannot disturb the current view.
   */
  buildAircraftInstance(aircraftId) {
    const addon = this.addonAircraftDescriptors?.get(aircraftId)
      ?? pinnedAddonAircraftList(this.pinnedAddonPack).find(item => item.id === aircraftId)
      ?? null;
    const useAddonVisuals = Boolean(addon && (addon.model || addon.cockpit || !addon.baseAircraftId));
    const visualId = addon && !useAddonVisuals ? addon.baseAircraftId : aircraftId;
    const instance = useAddonVisuals
      ? new AddonAircraft(addon, { pfdCanvas: this.pfdCanvas, ndCanvas: this.ndCanvas })
      : visualId === 'F16'
      ? new F16()
      : visualId === 'C172'
        ? new Cessna172(this.pfdCanvas, this.ndCanvas)
        : new Boeing737(
          this.pfdCanvas,
          this.ndCanvas,
          this.eicasCanvas,
          this.mcpCanvas,
          this.isfdCanvas,
          this.cduCanvas,
          addon?.livery ? { customLivery: addon.livery } : {}
        );
    if (!useAddonVisuals && addon?.livery && visualId !== 'B738' && instance.ready) {
      instance.ready.then(() => {
        const model = instance.gltfModel ?? instance.gltfGroup;
        if (model) applyAircraftLivery(model, instance.group, instance.gltfGroup ?? instance.group, addon.livery);
      });
    }
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
    if (!resolveAircraftConfig(aircraftId)) return false;
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
    await startupDetail('startup.detail.airframe');
    const deadline = performance.now() + 60000;
    // Boot waits for the airframe only. The streamed interior belongs to the cockpit view, not
    // to the lobby, and aircraft whose cabin ships inside the airframe model still land here.
    if (this.aircraft.loadingGltf) {
      if (this.aircraft.ready && typeof this.aircraft.ready.then === 'function') {
        let airframeTimeout;
        try {
          await Promise.race([
            this.aircraft.ready,
            new Promise((_, reject) => {
              airframeTimeout = setTimeout(
                () => reject(new Error('Startup assets timed out')),
                Math.max(0, deadline - performance.now()),
              );
            }),
          ]);
        } finally {
          clearTimeout(airframeTimeout);
        }
      }
      while (this.aircraft.loadingGltf) {
        if (performance.now() > deadline) throw new Error('Startup assets timed out');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (this.aircraft.cockpit?.shaderWarmup) {
      let timeout;
      try {
        await Promise.race([
          this.aircraft.cockpit.shaderWarmup,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Startup shaders timed out')), Math.max(0, deadline - performance.now()));
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
    await startupStage(6, 'startup.ready');
    this.startupReady = true;
    document.body.classList.remove('booting');
    document.getElementById('startup-overlay').hidden = true;
    document.getElementById('canvas-container').inert = false;
    document.getElementById('hud-overlay').inert = false;
    if (window.addonStartupError) {
      this.showToast(() => t('notice.addon.loadFailed', { error: window.addonStartupError }));
    }
    // Loading time must not turn into accumulated simulation time.
    this.clock.getDelta();
    inputLatency?.mark('startup-complete');
    startupProgress.finish();

    // Hydrate non-blocking environmental/effect/catalog assets after the lobby is interactive.
    this.sky?.loadEnvironmentHdr?.();
    this.loadLobbyMapCatalog?.();
    this.lobbyScreen?.enableMapTiles?.();
    setTimeout(() => {
      if (this.activeAirport === 'coastal' && this.ships) this.ships.loadAssets();
    }, 0);
    setTimeout(() => {
      Promise.all(['fire', 'smoke', 'water', 'tire'].map(
        kind => requestProceduralAsset('effect-atlas', { kind }),
      ))
        .then(([fire, smoke, water, tire]) => {
          const buffers = { fire, smoke, water, tire };
          this.explosionSystem?.applyAtlasBuffers?.(buffers);
          this.tireSmokeSystem?.applyAtlasBuffers?.(buffers);
        })
        .catch(() => {})
        .finally(() => {
          this.prepareCrashVisuals();
          this.warmExplosionShaders();
        });
    }, 0);

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
      if (this.activeAirport === 'incheon' || this.activeAirport === 'jeju') {
        this.ensureUnifiedRegions?.();
      }
    }, 500);

    const initialPose = parsePoseUrlParams(window.location.search);
    if (initialPose) {
      this.applyFixedPose(initialPose);
    }
  }

  /**
   * Immediately position and orient the aircraft at arbitrary geo/local coordinates
   * in a stationary (frozen) inspection state directly from URL arguments or scripts.
   */
  applyFixedPose(pose) {
    if (!pose) return;
    this.demoDirector?.stop();
    this.freezePhysics = Boolean(pose.freeze);
    if (this.gameFlow.state === FLOW.LOBBY) {
      this.gameFlow.enterFlight();
      this.syncFlowUi();
    }
    const hasGeo = Number.isFinite(pose.lat) && Number.isFinite(pose.lon);
    if (hasGeo) {
      this.setCustomWorldOrigin({ latitude: pose.lat, longitude: pose.lon });
    }
    const targetX = hasGeo ? 0 : (pose.x ?? 0);
    const targetZ = hasGeo ? 0 : (pose.z ?? 0);
    const ground = this.currentTerrain?.getHeight?.(targetX, targetZ) ?? 0;
    const targetY = pose.alt !== null ? pose.alt : (ground + (this.gear?.cgGroundHeightM ?? 3.5));

    this.position.set(targetX, targetY, targetZ);
    this.linearVelocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    const headingDeg = (pose.heading % 360 + 360) % 360;
    if (this.telemetry) {
      this.telemetry.iasKnots = 0;
      this.telemetry.tasKnots = 0;
      this.telemetry.altitudeM = targetY;
      this.telemetry.altitudeFt = targetY * 3.28084;
      this.telemetry.headingDeg = headingDeg;
      this.telemetry.compassDegrees = headingDeg;
      this.telemetry.onGround = Boolean(ground !== 0 && Math.abs(targetY - ground) < 5);
    }
    const yaw = -(headingDeg * Math.PI / 180);
    this.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));

    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.renderPose.reset(this.position, this.quaternion);

    if (this.cameraSystem) {
      const modeKey = (pose.camera || 'chase').toUpperCase();
      const modeId = CameraSystem.MODES[modeKey] ?? CameraSystem.MODES.CHASE;
      this.cameraSystem.setMode(modeId);
      this.cameraSystem.snapToTarget(this.aircraft.group);
    }

    this.updateFlightDisplays?.(true);

    this.ensureGeographicLayers?.().then(mod => {
      mod.updateOpenWorldTerrain?.(this);
      if (pose.alt === null) {
        const resolvedGround = this.currentTerrain?.getHeight?.(targetX, targetZ);
        if (Number.isFinite(resolvedGround) && resolvedGround !== 0) {
          const newY = resolvedGround + (this.gear?.cgGroundHeightM ?? 3.5);
          this.position.y = newY;
          this.aircraft.group.position.y = newY;
          this.aircraft.group.updateMatrixWorld(true);
          this.renderPose.reset(this.position, this.quaternion);
          if (this.telemetry) {
            this.telemetry.altitudeM = newY;
            this.telemetry.altitudeFt = newY * 3.28084;
          }
          this.updateFlightDisplays?.(true);
        }
      }
    });
  }

  setAircraft(aircraftId = 'B738', pilotPreparation = false) {
    if (this.multiplayer?.locked) return;
    if (this.pilotArena?.active && !pilotPreparation) this.pilotArena.stop('aircraft-changed');
    const config = resolveAircraftConfig(aircraftId) || BOEING_737_800;
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
    const ratio = renderPixelRatio(this.renderQuality, window.innerWidth, window.innerHeight,
      window.devicePixelRatio, aircraftId);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    if (this.missileCombat) instance.setMissileLoadout?.(this.missileCombat.loaded);
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
      const preferredMode = typeof this.cameraSystem.getPreferredStartMode === 'function'
        ? this.cameraSystem.getPreferredStartMode()
        : null;
      if (this.cameraSystem.mode === CameraSystem.MODES.COCKPIT || preferredMode === CameraSystem.MODES.COCKPIT) {
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

  /** Combat exists only in a live, human-flown F-16 sortie; pausing freezes it. */
  combatActive() {
    const inSortie = this.gameFlow?.state === FLOW.FLIGHT || this.gameFlow?.state === FLOW.PAUSED;
    return this.currentAircraftId === 'F16'
      && inSortie
      && !regionalCruise(this.lastPresetType)
      && !this.demoDirector?.isActive
      && !this.pilotArena?.active
      && !this.replayDirector?.active
      && !this.shadowDemo?.active
      && !this.devRunner?.active
      && !this.multiplayer?.active
      && !this.isCrashed
      && !this.startingFlight
      && !this.telemetry?.onGround;
  }

  combatWorld() {
    return {
      active: this.combatActive(),
      position: this.position,
      velocity: this.linearVelocity,
      quaternion: this.quaternion,
      onGround: Boolean(this.telemetry?.onGround),
      terrainHeight: this._combatTerrainHeight,
    };
  }

  syncMissileLoadout() {
    if (this.missileCombat) this.aircraft?.setMissileLoadout?.(this.missileCombat.loaded);
  }

  fireMissile() {
    if (!this.missileCombat || !this.combatActive()) return false;
    if (this.controls.aircraftControlsDisabled || this.controls.inputBlocked) return false;
    const missile = this.missileCombat.fire(this.combatWorld());
    if (!missile) {
      if (this.missileCombat.lastFireError === 'empty') this.showToast(() => t('weapons.empty'));
      else if (this.missileCombat.lastFireError === 'ground') this.showToast(() => t('weapons.ground'));
      return false;
    }
    this.syncMissileLoadout();
    this.showToast(() => t('weapons.launch.toast', {
      type: t(missile.spec.labelKey),
      fox: missile.spec.fox,
    }));
    return true;
  }

  /** Turnaround runs only in a live F-16 sortie; pause freezes its timer. */
  rearmActive() {
    return this.currentAircraftId === 'F16'
      && this.gameFlow?.state === FLOW.FLIGHT
      && !this.demoDirector?.isActive
      && !this.pilotArena?.active
      && !this.replayDirector?.active
      && !this.shadowDemo?.active
      && !this.devRunner?.active
      && !this.multiplayer?.active
      && !this.isCrashed
      && !this.startingFlight;
  }

  updateRearm(dt) {
    if (!this.rearmSystem || !this.missileCombat || !this.rearmActive()) return;
    const gearDamage = this.telemetry.gearDamage || {};
    const bodyDamage = this.telemetry.bodyDamage || {};
    const onPavement = this.currentAirport?.isOnRunway
      ? this.currentAirport.isOnRunway(this.position.x, this.position.z)
      : true;
    const events = this.rearmSystem.update(dt, {
      active: true,
      onGround: Boolean(this.telemetry.onGround),
      groundSpeedKnots: this.telemetry.groundSpeedKnots || 0,
      onPavement,
      gearDown: (this.telemetry.gearState ?? 1) > 0.9,
      gearCollapsed: Object.values(gearDamage).some(state => state === 'collapsed'),
      bodyFailed: Object.values(bodyDamage).some(damage => damage >= 1),
      missilesRemaining: this.missileCombat.remaining,
      missileCapacity: this.missileCombat.totalStations,
      gunRounds: this.missileCombat.cannon.rounds,
      gunCapacity: this.missileCombat.cannon.capacity,
    });
    for (const event of events) this.handleRearmEvent(event);
  }

  handleRearmEvent(event) {
    if (!event) return;
    if (event.type === 'rearm') {
      this.missileCombat.rearm();
      this.syncMissileLoadout();
      this.audio.playGpwsCallout('Rearm complete');
      this.showToast(() => t('weapons.rearm.complete'));
    } else if (event.type === 'rearmStart') {
      this.showToast(() => t('weapons.rearm.start'));
    } else if (event.type === 'rearmBlocked') {
      const key = event.reason === 'gear'
        ? 'weapons.rearm.blocked.gear'
        : event.reason === 'damage'
          ? 'weapons.rearm.blocked.damage'
          : 'weapons.rearm.blocked.pavement';
      this.showToast(() => t(key));
    }
  }

  syncGunAudio() {
    const camera = this.camera?.position;
    const muzzleDistance = camera?.distanceTo?.(this.position) ?? 0;
    this.audioCoordinator.syncGunAudio(this.missileCombat?.cannon?.firing, muzzleDistance);
  }

  cycleCombatTarget() {
    if (!this.missileCombat || !this.combatActive()) return false;
    const target = this.missileCombat.selectNextTarget();
    if (!target) {
      this.showToast(() => t('weapons.noTarget'));
      return false;
    }
    this.showToast(() => t('weapons.target.toast', { callsign: target.callsign }));
    return true;
  }

  handleCombatEvent(event) {
    if (!event) return;
    this.replayRecorder?.recordCombatEvent?.(event);
    presentCombatEvent(event, {
      view: this.missileCombatView,
      explosionSystem: this.explosionSystem,
      audio: this.audio,
      camera: this.camera,
      onKill: ev => this.showToast(() => t('weapons.splash.toast', { callsign: ev.target.callsign })),
      onGunEmpty: () => this.showToast(() => t('weapons.gun.empty')),
    });
  }

  /**
   * Main Frame Loop
   */
  animate() {
    requestAnimationFrame(this.animate);

    const frameStart = performance.now();
    const elapsed = this.clock.getDelta();
    if (this.browserBackgrounded) return;
    this.lastFrameDelta = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : null;
    const measureFlight = this.flightPerformance.begin(frameStart,
      this.performanceTelemetryEnabled && this.startupReady && this.gameFlow.state === FLOW.FLIGHT && !this.startingFlight
        && !this.multiplayer?.modalOpen && !this.devRunner?.active && !this.renderDiagnostics?.active && !this.demoDirector?.isRestartConfirmOpen
        ? { aircraft: this.currentAircraftId, airport: this.activeAirport, scenario: this.lastPresetType,
          camera: this.cameraSystem.mode, renderQuality: this.renderQuality,
          pixelRatio: this.renderer.getPixelRatio(), width: this.renderer.domElement.width,
          height: this.renderer.domElement.height, isMultiplayer: Boolean(this.multiplayer?.active) } : null);
    const frameDelta = this.startupReady ? clampFrameDelta(elapsed) : 0;
    // Also covers model swaps. Deferred past first frame so boot never blocks on breakup prep.
    if (this.startupReady) this.prepareCrashVisuals();
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
    } else if (this.freezePhysics || this.startingFlight || this.replayDirector?.loading || this.multiplayer?.modalOpen || this.multiplayer?.room?.session.state === 'starting' || this.gameFlow.isPhysicsFrozen() || this.devRunner.blocksPhysics || this.pilotArena?.active || this.demoDirector?.isRestartConfirmOpen) {
      this.physicsAccumulator = 0;
    } else {
      try {
        advancePhysicsFrame(this, frameDelta);
      } catch (error) {
        this.lastRuntimeError = {
          message: error?.message ?? String(error),
          stack: typeof error?.stack === 'string' ? error.stack.slice(0, 1500) : null,
          aircraft: this.currentAircraftId ?? null,
          airport: this.activeAirport ?? null,
          scenario: this.lastPresetType ?? null,
          atIso: new Date().toISOString(),
        };
        captureException?.(error, {
          subsystem: 'physics-loop',
          aircraft: this.currentAircraftId,
          airport: this.activeAirport,
        });
        recoverSimulatorFlightStart(this, error);
        return;
      }
    }

    this.airportStreamer?.update({
      x: this.position.x,
      z: this.position.z,
      speedMps: this.linearVelocity?.length?.() ?? 0,
      onGround: Boolean(this.telemetry?.onGround),
      onRunway: Boolean(this.currentAirport?.isOnRunway?.(this.position.x, this.position.z)),
      destinationCode: this.destinationAirport,
    });
    if (this.startupReady && this.gameFlow.state === FLOW.FLIGHT && !this.startingFlight) {
      this.updateUnifiedRegionStreaming();
    }

    this.updateRegionMounting?.();

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
    // A parked replay still draws its frozen pose; spinning fans, propellers and
    // strobes over that pose would be motion the recorded clock no longer has.
    this.aircraft.update(this.replayDirector?.playbackHeld ? 0 : frameDelta, this.telemetry);
    this.renderPose.apply(this.aircraft.group, this.position, this.quaternion,
      this.physicsAccumulator / this.physicsDt);

    // 1b. Air-to-air combat advances on its own fixed 120 Hz clock so a slow
    // render frame cannot tunnel a missile through the proximity fuse.
    this.updateRearm(frameDelta);
    const combatDt = this.gameFlow.isPhysicsFrozen() ? 0 : frameDelta;
    this.missileCombat.setGunTrigger(
      this.combatActive() && !this.gameFlow.isPhysicsFrozen() && this.controls.gunTrigger,
    );
    const combatEvents = this.missileCombat.update(combatDt, this.combatWorld());
    this.telemetry.rwrLevel = this.missileCombat.rwr.level;
    this.missileCombatView.sync(combatDt);
    this.cannonCombatView.sync(combatDt);
    this.syncGunAudio();
    if (!this.replayDirector?.active) {
      this.audioCoordinator.syncCombatAudio(this.missileCombat, this.camera, combatDt <= 0);
    }
    for (const event of combatEvents) this.handleCombatEvent(event);

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
    if (!['lukla', 'patagonia'].includes(this.activeAirport)) {
      this.water.update(frameDelta, this.camera ? this.camera.position : this.position);
      if (this.activeAirport === 'coastal') this.ships?.update(frameDelta, this.totalSimTime);
    }
    if (this.currentAirport) {
      this.currentAirport.update(frameDelta, this.position, this.totalSimTime, {
        cameraPosition: this.camera.position,
        quality: this.renderQuality,
        paused: this.gameFlow.isPhysicsFrozen(),
        headingDeg: this.telemetry?.headingDeg,
        trackDeg: this.telemetry?.trackDeg,
      });
    }
    this.sky.updateSun(this.position, this.camera.position);
    if (this._geoLayers) {
      this._geoLayers.updateOpenWorldTerrain(this);
      this._geoLayers.updateParisShowcase(this);
      this._geoLayers.updateGeographicBuildings(this, frameDelta);
      this._geoLayers.updateGeographicRoads(this, frameDelta);
      this._geoLayers.updateGeographicGreenSpace(this);
      this._geoLayers.updateGeographicLandmarks(this);
    }
    this.currentAirport?.nightLighting?.update(this.sky.sunPosition.y);
    if (!this.gameFlow.isPhysicsFrozen()) {
      if (!this.replayDirector.roomEffects) this.explosionSystem.update(frameDelta);
      this.tireSmokeSystem.update(frameDelta);
    }

    const isLookingAway = isCockpit && this.cameraSystem.isLookingAwayFromCenter();
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && this.cameraSystem.supportsPhotoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit, this.renderQuality);
    if (!isCockpit && this.renderQuality === 'ultraLow') {
      if (this.aircraft.cockpit?.group) {
        this.aircraft.cockpit.group.visible = false;
      }
    }
    this.contactShadow.setEnabled(!isCockpit && this.renderQuality === 'ultraLow'
      && (!this.replayDirector.active || this.aircraft.group.visible));
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
    this.mobileHeadTracking?.update(performance.now());
    this.cameraSystem.update(frameDelta, this.aircraft.group, this.telemetry, (x, z) => this.currentTerrain.getHeight(x, z));
    // Audio samples the camera after its motion for this frame, so the
    // listener displacement and frameDelta share one time base.
    const cameraToAircraftMeters = this.camera.position.distanceTo(this.aircraft.group.position);
    this.audioCoordinator.update(frameDelta, this.telemetry,
      this.cameraSystem.mode === CameraSystem.MODES.COCKPIT, cameraToAircraftMeters, {
        position: this.position,
        velocity: this.replayDirector?.active ? this.replayDirector.hostVelocity : this.linearVelocity,
        camera: this.camera,
        timeScale: this.replayDirector?.active ? this.replayDirector.speed : 1,
      });
    this.foliage?.updateCityLod(this.world?.coastalLocalCamera(this.camera.position) ?? this.camera.position);

    // 7. Update HTML HUD & Diagnostics Inspector & Touch Controls
    this.updateHUD();
    this.landmarkPins ??= new LandmarkPins(document.getElementById('landmark-pins'));
    this.landmarkPins.update(this, this.gameFlow.state === FLOW.FLIGHT && !this.startingFlight && !this.isCrashed && !this.pilotageFlight);
    this.touchControls.updateUI();
    this.diagnostics.update(frameDelta, this.telemetry);
    this.pilotPhysiologyFx?.update(this.cameraSystem?.mode, this.telemetry?.pilot);
    this.loadingPanel.update();

    this.foliage?.update(this.world?.coastalLocalCamera(this.camera.position) ?? this.camera.position);

    this.multiplayer?.update();

    // 8. Render 3D Scene
    const measuredRender = measureFlight || !this.hasRenderedFirstFrame || Boolean(this.frameTransitions?.pending);
    const renderStart = measuredRender ? performance.now() : 0;
    if (!this.hasRenderedFirstFrame) inputLatency?.mark('startup-render-start');
    if (measureFlight && !this.flightGpuTimer) {
      this.performanceGpuClass = readGpuClass(globalThis);
      this.flightGpuTimer = new FlightGpuTimer(this.renderer.getContext(), (ms, context) => this.flightPerformance.addGpu(ms, context));
    }
    const previousAutoReset = this.renderer.info.autoReset;
    if (measureFlight) { this.renderer.info.reset(); this.renderer.info.autoReset = false; }
    const gpuQuery = measureFlight && !this.renderDiagnostics?.active
      ? this.flightGpuTimer.begin(this.flightPerformance.context) : null;
    try {
      this.renderScene();
      if (measuredRender) {
        this.frameTransitions?.rendered(performance.now() - renderStart, { camera: this.cameraSystem.mode });
      }
      if (!this.hasRenderedFirstFrame) inputLatency?.mark('startup-render-end');
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

      if (this.lobbyCameraModal?.isOpen) {
        this.lobbyCameraModal.renderPreview(this.renderer.domElement);
      }
    } finally {
      this.flightGpuTimer?.end(gpuQuery);
      this.renderer.info.autoReset = previousAutoReset;
    }
    if (measureFlight) this.flightPerformance.end({ updateMs: renderStart - frameStart,
      renderMs: performance.now() - renderStart, calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles });
    this.updateCrashDebrief(frameDelta);
  }

  handleGazeCanvasClick(clientX, clientY) {
    this.inputCoordinator.handleGazeCanvasClick(this, clientX, clientY);
  }
}

installPresetSpawner(FlightSimulator);
installPhysicsIntegrator(FlightSimulator);
installSimulatorHudAndBindings(FlightSimulator);

// Start Simulator when DOM is ready (guaranteed across all browser lifecycle states)
async function initFlightSimulator() {
  if (typeof document !== 'undefined') {
    const { installAddonPicker } = await import('./ui/installAddonPicker.js').catch(() => ({}));
    installAddonPicker?.(document.getElementById('lobby-addon-picker'), {
      defaultCatalogUrl: BASE_ADDON_CATALOG_URL,
      onApplied: async () => {
        try {
          const pack = await resolveAddonPinnedPack(window.location.search);
          this.pinnedAddonPack = pack ?? null;
          this.addonAircraftDescriptors = new Map();
          for (const descriptor of pinnedAddonAircraftList(this.pinnedAddonPack)) {
            if (descriptor?.id) this.addonAircraftDescriptors.set(descriptor.id, descriptor);
          }
          if (this.addonAircraftDescriptors.size > 0) {
            registerAddonAircraft([...this.addonAircraftDescriptors.values()]);
          }
          if (this.water && this.sky) applyRegionPalette(this.pinnedAddonPack, { water: this.water, sky: this.sky });
          this.lobbyScreen?.refresh();
        } catch (error) {
          console.warn('Addons could not be applied to the active session:', error);
        }
      },
    });
  }
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
    } catch (error) {
      const message = error?.message ?? String(error);
      if (/addon|checksum|manifest/i.test(message)) window.addonStartupError = message;
      showStartupError(error);
    }
    inputLatency?.mark('ready');
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initFlightSimulator);
} else {
  initFlightSimulator();
}
