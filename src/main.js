import { t, bindText, initLocalization } from './i18n/index.js';
import * as THREE from 'three';
import { Atmosphere } from './physics/Atmosphere.js';
import { BOEING_737_800 } from './config/aircraftConfigs.js';
import { Aerodynamics } from './physics/Aerodynamics.js';
import { EngineModel } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { PFDCanvas } from './aircraft/PFDCanvas.js';
import { NDCanvas } from './aircraft/NDCanvas.js';
import { EICASCanvas } from './aircraft/EICASCanvas.js';
import { MCPCanvas } from './aircraft/MCPCanvas.js';
import { ISFDCanvas } from './aircraft/ISFDCanvas.js';
import { CDUCanvas } from './aircraft/CDUCanvas.js';
import { Boeing737 } from './aircraft/Boeing737.js';
import { Terrain } from './environment/Terrain.js';
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.terrain = new Terrain(22000, 256);
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

    this.activeAirport = 'coastal'; // 'coastal' | 'lukla'
    this.currentTerrain = this.terrain;
    this.currentAirport = this.airport;

    this.sky = new SkyAtmosphere(this.scene, this.renderer, this.water);
    this.foliage.setTimeOfDay(this.sky.timeOfDay);
    this.water.syncWithAtmosphere(this.sky);

    // 6. Audio & Controls & Camera & Diagnostics
    this.audio = new FlightAudio();
    this.controls = new FlightControls(this.renderer.domElement);
    this.touchControls = new TouchFlightControls(this.controls);
    initFlightPanels({ onSelectCamera: mode => this.controls.onSelectCamera(mode) });
    this.cameraSystem = new CameraSystem(this.camera, this.renderer.domElement);
    this.cameraSystem.setTerrain(this.terrain);
    this.cameraSystem.onResetLook = () => {
      this.showToast(() => t('camera.view.centered'));
    };
    this.diagnostics = new DiagnosticsInspector(this);
    this.demoDirector = new DemoFlightDirector(this);

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

    // Autopilot simple leveler / heading hold
    this.apMaster = false;

    this.initControls();
    this.initUI();
    this.setAirport('lukla');

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
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // Auto-launch showcase demo flight on startup
    this.demoDirector.start();
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

  setPreset(type, isDemoInternal = false) {
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
    this.landingIncident = false;
    this.landingStopped = false;
    this.bodyContactStarted = false;

    if (this.isCrashed) {
      this.isCrashed = false;
      this.crashResult = null;
      this.explosionSystem.clear();
      this.aircraft.resetCrashVisuals();
      const crashEl = document.getElementById('crash-overlay');
      if (crashEl) crashEl.style.display = 'none';
    }

    if (this.activeAirport === 'lukla') {
      const sin58 = 0.848048;
      const cos58 = 0.529919;

      if (type === 'runway') {
        // Aligned on Lukla Runway 06 Threshold (Elevation 2,805m, Heading 058°, 11.7% uphill slope)
        // Spawn above the current wheel geometry, allowing suspension settling.
        this.position.set(-210.0 * sin58, 2814.8, 210.0 * cos58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch 6.71° nose-up aligned with 11.7% gradient, Heading 058° (yaw -58°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(6.71),
          -THREE.MathUtils.degToRad(58.0),
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

        this.showToast(() => t('preset.lukla.runway.06.2.805.m'));
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

    // Update UI preset button labels
    const btnRwy = document.getElementById('btn-preset-rwy');
    const btnApp = document.getElementById('btn-preset-app');
    const btnCru = document.getElementById('btn-preset-cru');
    const btnCliff = document.getElementById('btn-preset-cliff');

    if (isLukla) {
      if (btnRwy) bindText(btnRwy, () => t('lukla.06.ready'));
      if (btnApp) bindText(btnApp, () => t('canyon.landing'));
      if (btnCru) bindText(btnCru, () => t('himalayan.cruise.13.000.ft'));
      if (btnCliff) btnCliff.style.display = 'block';
    } else {
      if (btnRwy) bindText(btnRwy, () => t('runway.takeoff.09l'));
      if (btnApp) bindText(btnApp, () => t('final.approach.3.nm'));
      if (btnCru) bindText(btnCru, () => t('cruise.6.000.ft'));
      if (btnCliff) btnCliff.style.display = 'none';
    }

    document.getElementById('btn-airport-coastal')?.classList.toggle('active', id === 'coastal');
    document.getElementById('btn-airport-lukla')?.classList.toggle('active', isLukla);

    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    this.setPreset('runway');

    const airportKey = isLukla
      ? 'tenzing.hillary.airport.nepal.vnlk.runway.06'
      : 'pacific.coastal.international.airport.runway.09l.elevation';
    this.showToast(() => t('airport.changed.value', { value: t(airportKey) }));
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

    // Autopilot simple leveler
    if (this.apMaster && Math.abs(this.controls.elevator) < 0.05 && Math.abs(this.controls.aileron) < 0.05) {
      const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
      this.aero.aileron = -euler.z * 1.5; // Wings level
      const targetPitchRad = THREE.MathUtils.degToRad(2.0);
      this.aero.elevator = (targetPitchRad - euler.x) * 2.0;
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

    // 6. Thrust Force in World Space
    // Engine thrust acts along forward longitudinal axis (-Z in Three.js aircraft space)
    const thrustWorld = new THREE.Vector3(0, 0, -engineData.totalThrust).applyQuaternion(this.quaternion);

    // 7. Gravity Force
    const gravityWorld = new THREE.Vector3(0, -this.aero.mass * Atmosphere.G0, 0);

    // 8. Total Forces Integration: F = m * a
    const netForceWorld = new THREE.Vector3()
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
    const netMomentBody = new THREE.Vector3()
      .add(aeroResult.momentBody)
      .add(gearResult.moments);

    // Angular acceleration: [p_dot, q_dot, r_dot] = [Mx/Ixx, My/Iyy, Mz/Izz]
    const angAccBody = new THREE.Vector3(
      netMomentBody.x * this.aero.invIyy, // Pitch (around X)
      netMomentBody.y * this.aero.invIzz, // Yaw (around Y)
      netMomentBody.z * this.aero.invIxx  // Roll (around Z)
    );

    this.angularVelocity.addScaledVector(angAccBody, dt);

    // Natural rotational damping (heavy transport inertia dissipation)
    this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 0.35));

    // Update Aircraft Orientation Quaternion
    // Delta rotation from body angular velocity: omega x dt
    const deltaRot = new THREE.Quaternion(
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
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    // Heading: forward vector (-Z in aircraft local space) projected to horizontal XZ plane
    const forwardVec = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(forwardVec.x, -forwardVec.z)) + 360) % 360;

    // Track
    const trackDeg = (THREE.MathUtils.radToDeg(Math.atan2(this.linearVelocity.x, -this.linearVelocity.z)) + 360) % 360;

    // Compute authentic load factor Nz (accelerometer along body cabin vertical axis +Y)
    const nonGravForceWorld = new THREE.Vector3()
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);
    const cabinCeilingWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
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
      stallSeverity: aeroResult.stallSeverity,
      buffetVibration: aeroResult.buffetVibration,
      engine1: engineData.engine1,
      engine2: engineData.engine2,
      reverserActive: engineData.reverserActive,
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
      apEngaged: this.apMaster,
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
    this.engines.setThrottle(0.0);
    this.controls.throttle = 0.0;
    this.linearVelocity.multiplyScalar(0.25);
    if (this.linearVelocity.y < 0) this.linearVelocity.y = 0;

    // 7. Show Crash UI Overlay
    this.showCrashUI(crashResult);
  }

  resetCrash() {
    this.isCrashed = false;
    this.crashResult = null;
    this.explosionSystem.clear();
    this.aircraft.resetCrashVisuals();

    const crashEl = document.getElementById('crash-overlay');
    if (crashEl) crashEl.style.display = 'none';

    this.setPreset('runway');
    this.showToast(() => t('aircraft.repaired.restarted.on.runway.09l'));
  }

  showCrashUI(crashResult) {
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
    this.sky.updateSun(this.position, this.camera.position);
    this.water.update(simSeconds, this.camera ? this.camera.position : this.position);
    this.explosionSystem.update(simSeconds);
    this.tireSmokeSystem.update(simSeconds);
    this.touchControls.updateUI(this.telemetry);
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
    while (this.physicsAccumulator >= this.physicsDt) {
      if (this.demoDirector && this.demoDirector.isActive) {
        this.demoDirector.update(this.physicsDt);
      }
      this.renderPose.reset(this.position, this.quaternion);
      this.integratePhysics(this.physicsDt);
      this.physicsAccumulator -= this.physicsDt;
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
    this.touchControls.updateUI(this.telemetry);
    this.diagnostics.update(frameDelta, this.telemetry);

    // 8. Render 3D Scene
    this.sky.prepareRender(this.camera);
    this.renderer.render(this.scene, this.camera);

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
    updateControlState(this.telemetry, this.cameraSystem, this.sky.timeOfDay);
  }

  updateAudioUI(state) {
    if (!state && this.audio) state = this.audio.getVolumeState();
    if (!state) return;

    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      if (state.muted) {
        btnSound.className = 'btn btn-preset btn-sound-toggle muted';
        bindText(btnSound, () => t('muted'));
      } else if (state.mode === 'bluetooth') {
        btnSound.className = 'btn btn-preset btn-sound-toggle active-bt';
        bindText(btnSound, () => t('bluetooth.200'));
      } else if (state.mode === 'mobile') {
        btnSound.className = 'btn btn-preset btn-sound-toggle active-boost';
        bindText(btnSound, () => t('boost.150'));
      } else {
        btnSound.className = 'btn btn-preset btn-sound-toggle';
        bindText(btnSound, () => t('sound.100'));
      }
    }

    const btnSoundAction = document.getElementById('btn-sound-action');
    if (btnSoundAction) {
      bindText(btnSoundAction, () => state.muted ? t('muted') : (state.mode === 'bluetooth' ? '🎧⚡ 200%' : (state.mode === 'mobile' ? '🔊⚡ 150%' : t('volume.m'))));
    }

    if (this.touchControls && typeof this.touchControls.updateAudioUI === 'function') {
      this.touchControls.updateAudioUI(state);
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

  initUI() {
    // Airport Selector UI buttons
    document.getElementById('btn-airport-coastal')?.addEventListener('click', () => this.setAirport('coastal'));
    document.getElementById('btn-airport-lukla')?.addEventListener('click', () => this.setAirport('lukla'));

    // Quick clickable UI buttons
    document.getElementById('btn-preset-rwy')?.addEventListener('click', () => this.setPreset('runway'));
    document.getElementById('btn-preset-app')?.addEventListener('click', () => this.setPreset('approach'));
    document.getElementById('btn-preset-cru')?.addEventListener('click', () => this.setPreset('cruise'));
    document.getElementById('btn-preset-cliff')?.addEventListener('click', () => this.setPreset('cliff'));

    document.getElementById('btn-flaps-ext')?.addEventListener('click', () => this.controls.onCycleFlaps(1));
    document.getElementById('btn-flaps-ret')?.addEventListener('click', () => this.controls.onCycleFlaps(-1));
    document.getElementById('btn-gear')?.addEventListener('click', () => this.controls.onToggleGear());
    document.getElementById('btn-spoilers')?.addEventListener('click', () => this.controls.onToggleSpoilers());
    document.getElementById('btn-reverser')?.addEventListener('click', () => this.controls.onToggleReverser());
    document.getElementById('btn-cam')?.addEventListener('click', () => this.controls.onCycleCamera());
    document.getElementById('btn-cam-reset')?.addEventListener('click', () => {
      this.cameraSystem.resetLook();
      this.showToast(() => t('camera.view.centered'));
    });
    document.getElementById('btn-time')?.addEventListener('click', () => this.controls.onCycleTimeOfDay(3.0));
    document.getElementById('btn-sound')?.addEventListener('click', () => this.controls.onToggleAudio());
    document.getElementById('btn-sound-action')?.addEventListener('click', () => this.controls.onToggleAudio());
    document.getElementById('btn-diag')?.addEventListener('click', () => this.diagnostics.toggle());
    document.getElementById('btn-touch-toggle')?.addEventListener('click', () => {
      this.touchControls.toggle();
      const state = this.touchControls.enabled ? 'state.on' : 'state.off';
      this.showToast(() => t('touch.controls.value', { value: t(state) }));
    });
    document.getElementById('btn-ap')?.addEventListener('click', () => {
      this.apMaster = !this.apMaster;
      this.showToast(() => t('notice.autopilot', { state: t(this.apMaster ? 'state.on' : 'state.off') }));
    });

    // Initialize Demo Director UI bindings
    this.demoDirector.initUI();

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

    // Crash Restart Button & Keyboard Shortcuts [Space / R / Enter]
    document.getElementById('btn-crash-restart')?.addEventListener('click', () => {
      this.resetCrash();
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
      if (this.isCrashed && (e.code === 'Space' || e.code === 'KeyR' || e.code === 'Enter')) {
        this.resetCrash();
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
