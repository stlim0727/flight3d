import { t, bindText } from '../i18n/index.js';
import { CameraSystem } from '../cameras/CameraSystem.js';
import { LuklaCircuitScenario } from './scenarios/LuklaCircuitScenario.js';
import { CoastalDemoScenario } from './scenarios/CoastalDemoScenario.js';

/**
 * Autonomous Cinematic Demo Flight Director
 * 
 * Modular, scenario-driven demo flight architecture supporting:
 * 1. Nepal Tenzing-Hillary Airport (Lukla VNLK):
 *    - Continuous, non-teleporting circuit flight:
 *    - Runway 24 Downhill 11.7% Cliff Dive Takeoff Roll (Cockpit View, TOGA 100%)
 *    - Dudh Kosi Canyon Gorge Plunge & Liftoff (Gear Cam, Retraction over gorge)
 *    - 180° Canyon Turnaround & Himalayan Summit Panorama (Flyby / Chase View at 3,000m)
 *    - Canyon Final Approach to RW06 on 4.28° Steep Glideslope (Cockpit Captain View)
 *    - 11.7% Uphill Touchdown, Tire Smoke, Reverser & Full Brake Rollout onto Apron
 *    - Seamless Handover to User Manual Flight
 * 
 * 2. Coastal International Airport (Runway 09L):
 *    - Pre-Flight Drone Orbit Inspection (Elevated 360° Drone View, Flaps 5, Golden Morning)
 *    - Runway 09L Takeoff Roll (Cockpit View, TOGA 100%, Vr rotation)
 *    - Liftoff & Climb (Chase Exterior View, Gear Retraction, Mountains & City)
 *    - Scenic Coastal Banking Turn (Wing View, 20° Bank over Bay & Hills)
 *    - Ocean Waves & Shipping Fleet Cruise (Cinematic Flyby View, Gerstner Waves & Ships)
 *    - 3NM Final Approach on 3° Glideslope (Cockpit View, PAPI Guidance)
 *    - Flare, Touchdown, Spoilers & Reverse Thrust Rollout (Gear/Chase View, Safe Stop)
 *    - Post-Landing Drone Orbit Showcase (Elevated 360° Drone View, Safe Stop Inspection)
 *    - Seamless Handover to User Manual Flight
 */
export class DemoFlightDirector {
  static LUKLA_STAGES = LuklaCircuitScenario.STAGES;
  static COASTAL_STAGES = CoastalDemoScenario.STAGES;
  static STAGES = CoastalDemoScenario.STAGES;

  constructor(simulator) {
    this.sim = simulator;
    this.isActive = false;
    this.waitingForTerrain = false;
    this.activeDemoAirport = this.sim?.activeAirport || 'coastal';
    this.currentStage = DemoFlightDirector.STAGES.IDLE;
    this.stageTimer = 0;
    this.totalTimer = 0;

    // Scenarios
    this.luklaScenario = new LuklaCircuitScenario(this, simulator);
    this.coastalScenario = new CoastalDemoScenario(this, simulator);

    // UI element references
    this.bannerEl = null;
    this.titleEl = null;
    this.descEl = null;
    this.skipBtn = null;
    this.closeBtn = null;
    this.openBtn = null;
    this.badgeEl = null;
    this.pillTextEl = null;
    this.isBannerMinimized = false;

    // Approach tracking state
    this.approachFlarInitiated = false;
    this.touchdownConfirmed = false;

    // Audio initial click flag
    this.audioInitiated = false;

    // Track whether user has manually changed camera view in current stage
    this.userCameraOverridden = false;
    this.userTimeOfDayOverridden = false;
    this._boundOnCycleMode = () => this.onUserCameraChange();
  }

  getActiveScenario() {
    return this.activeDemoAirport === 'lukla' ? this.luklaScenario : this.coastalScenario;
  }

  initUI() {
    this.bannerEl = document.getElementById('demo-banner');
    this.titleEl = document.getElementById('demo-stage-title');
    this.descEl = document.getElementById('demo-stage-desc');
    this.skipBtn = document.getElementById('btn-skip-demo');
    this.closeBtn = document.getElementById('btn-demo-close');
    this.openBtn = document.getElementById('btn-demo-open');
    this.badgeEl = this.bannerEl?.querySelector('.demo-badge');
    this.pillTextEl = document.getElementById('demo-pill-text');

    if (this.skipBtn) {
      this.skipBtn.addEventListener('click', () => {
        this.stop(() => t('manual.control.engaged'));
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeBanner();
      });
    }

    if (this.openBtn) {
      this.openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openBanner();
      });
    }

    // Toggle demo on banner click (excluding buttons)
    if (this.bannerEl) {
      this.bannerEl.addEventListener('click', (e) => {
        if (e.target !== this.skipBtn && e.target !== this.closeBtn && !this.skipBtn?.contains(e.target) && !this.closeBtn?.contains(e.target)) {
          this.toggleBanner();
        }
      });
    }

    // Keyboard shortcut for cancelling demo (ESC) or starting/restarting demo (P)
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.target?.closest?.('select')) return;
        if (this.sim.gameFlow?.blocksFlightInput?.()) return;
        if (e.key === 'Escape' && this.isActive) {
          this.stop(() => t('manual.control.engaged'));
          e.preventDefault?.();
        } else if ((e.key === 'p' || e.key === 'P') && !e.target?.matches?.('input, textarea')) {
          this.start();
        }
      });
    }
  }

  closeBanner() {
    this.isBannerMinimized = true;
    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
    if (this.isActive && this.openBtn) {
      this.openBtn.style.display = 'inline-flex';
    }
  }

  openBanner() {
    this.isBannerMinimized = false;
    if (this.openBtn) {
      this.openBtn.style.display = 'none';
    }
    if (this.isActive && this.bannerEl) {
      this.bannerEl.style.display = 'flex';
    }
  }

  toggleBanner() {
    if (this.isBannerMinimized) {
      this.openBanner();
    } else {
      this.closeBanner();
    }
  }

  start(targetAirport = null) {
    const airport = targetAirport || this.sim.activeAirport || (this.sim.luklaAirport ? 'lukla' : 'coastal');
    if (this.sim.setAirport && this.sim.activeAirport !== airport) {
      this.sim.setAirport(airport);
    }

    this.activeDemoAirport = airport;
    this.isActive = true;
    // The demo flies via virtual inputs; an engaged AP would fight them.
    this.sim.autopilot?.disengage();
    this.totalTimer = 0;
    this.approachFlarInitiated = false;
    this.touchdownConfirmed = false;
    this.isBannerMinimized = false;
    this.userCameraOverridden = false;
    if (this.sim?.cameraSystem) {
      this.sim.cameraSystem.onCycleMode = this._boundOnCycleMode;
    }

    if (this.bannerEl) {
      this.bannerEl.style.display = 'flex';
    }
    if (this.openBtn) {
      this.openBtn.style.display = 'none';
    }

    // Keep the constructor's auto-start request alive while the asynchronous
    // DEM loads. isActive lets Esc, presets and airport changes cancel it.
    this.waitingForTerrain = airport === 'lukla' && this.sim.currentTerrain?.isLoaded === false;
    if (this.waitingForTerrain) {
      this.currentStage = DemoFlightDirector.STAGES.IDLE;
      this.luklaScenario.result = { status: 'pending', airborne: false };
      this.updateBanner(() => t('loading.lukla.terrain'), () => t('the.demo.will.start.when.terrain.data'));
      this.sim.controls?.setParkingBrake?.(true);
      this.sim.gear?.setBrakes(1);
      return;
    }
    this.sim.controls?.setParkingBrake?.(false);

    // Ensure audio starts on first user interaction or when allowed
    if (!this.audioInitiated && this.sim.audio) {
      this.sim.audio.init();
      this.sim.audio.ensureContextRunning();
      this.audioInitiated = true;
    }

    if (this.activeDemoAirport === 'lukla') {
      this.setStage(DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
    } else {
      this.setStage(DemoFlightDirector.COASTAL_STAGES.PREFLIGHT_ORBIT);
    }

    if (this.sim.showToast) {
      const airportKey = this.activeDemoAirport === 'lukla' ? 'airport.lukla.name' : 'coastal.airport.09l';
      this.sim.showToast(() => t('starting.value.cinematic.demo.flight', { value: t(airportKey) }));
    }
  }

  stopForCrash(crashResult) {
    if (!this.isActive) return;
    this.getActiveScenario().recordFailure?.(crashResult);
    this.stop();
  }

  stop(message = null, keepParkingBrake = false, { preserveThrottle = false } = {}) {
    if (!this.isActive) return;
    this.getActiveScenario().stop?.();
    if (this.activeDemoAirport === 'lukla' &&
        ['pending', 'running'].includes(this.luklaScenario.result.status)) {
      this.luklaScenario.result.status = 'cancelled';
    }
    this.waitingForTerrain = false;
    this.isActive = false;
    this.currentStage = DemoFlightDirector.STAGES.IDLE;
    this.isBannerMinimized = false;

    // Clear programmatic virtual inputs
    if (this.sim.controls?.clearVirtualInputs) {
      this.sim.controls.clearVirtualInputs();
    }

    const handoffThrottle = preserveThrottle ? (this.sim.controls?.throttle ?? 0) : 0;

    // Wheel brakes are pilot equipment, not demo scaffolding: an airframe still
    // rolling on the ground is handed over braked, and the parking brake releases
    // itself once the new pilot advances the thrust levers.
    const holdBrakes = keepParkingBrake || (this.sim.gear?.onGround === true &&
      (this.sim.telemetry?.groundSpeedKnots ?? 0) > 1.0);

    // Release automation while retaining climb thrust for an airborne handoff.
    if (this.sim.engines) {
      this.sim.engines.setReverser(false, true);
      this.sim.engines.setThrottle(handoffThrottle);
    }
    if (this.sim.controls) {
      this.sim.controls.throttle = handoffThrottle;
      if (holdBrakes) {
        if (typeof this.sim.controls.setParkingBrake === 'function') {
          this.sim.controls.setParkingBrake(true);
        }
        this.sim.controls.brakes = 1.0;
      } else {
        if (typeof this.sim.controls.setParkingBrake === 'function') {
          this.sim.controls.setParkingBrake(false);
        }
        this.sim.controls.brakes = 0.0;
      }
    }
    if (this.sim.gear) {
      this.sim.gear.setBrakes(holdBrakes ? 1.0 : 0.0);
    }
    if (this.sim.aero) {
      this.sim.aero.spoilers = 0.0;
    }

    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
    if (this.openBtn) {
      this.openBtn.style.display = 'none';
    }

    this.userCameraOverridden = false;
    if (this.sim?.cameraSystem?.onCycleMode === this._boundOnCycleMode) {
      this.sim.cameraSystem.onCycleMode = null;
    }

    if (message && this.sim.showToast) {
      this.sim.showToast(message);
    }
  }

  onUserTimeOfDayChange() {
    this.userTimeOfDayOverridden = true;
  }

  setTimeOfDay(hours) {
    if (!this.userTimeOfDayOverridden) {
      this.sim.sky.setTimeOfDay(hours);
      this.sim.foliage?.setTimeOfDay(hours);
    }
  }

  onUserCameraChange() {
    this.userCameraOverridden = !this.sim.cameraSystem.autoSwitch;
  }

  setStage(newStage) {
    this.currentStage = newStage;
    this.stageTimer = 0;
    this.userCameraOverridden = false;

    const scenario = this.getActiveScenario();
    scenario.enterStage(newStage);
  }

  update(dt) {
    if (!this.isActive) return;
    if (this.waitingForTerrain) {
      if (this.sim.currentTerrain?.loadError) {
        this.luklaScenario.recordFailure({ description: this.sim.currentTerrain.loadError });
        this.stop(() => t('could.not.load.lukla.terrain.refresh.and'));
        return;
      }
      if (this.sim.currentTerrain?.isLoaded === true) this.start(this.activeDemoAirport);
      return;
    }

    this.stageTimer += dt;
    this.totalTimer += dt;

    const scenario = this.getActiveScenario();
    scenario.update(dt);
  }

  updateBanner(title, desc) {
    if (this.titleEl) bindText(this.titleEl, () => typeof title === 'function' ? title() : title);
    if (this.descEl) bindText(this.descEl, () => typeof desc === 'function' ? desc() : desc);
    if (this.pillTextEl) {
      const match = (typeof title === 'function' ? title() : title).match(/\[(\d+\/\d+)\]/);
      bindText(this.pillTextEl, () => match
        ? t('auto.demo.value.open.guide', { value: match[1] })
        : t('auto.demo.open.guide'));
    }
  }
}
