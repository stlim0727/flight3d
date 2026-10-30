import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { HangangScenario } from '../director/HangangScenario.js';
import { HANGANG_COURSE } from '../config/hangangCourse.js';
import { BOEING_737_800 } from '../config/aircraftConfigs.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { solveTrim } from '../physics/TrimSolver.js';
import { rebaseCgVelocity } from '../physics/massKinematics.js';
import { takeoffPerformance } from '../physics/TakeoffPerformance.js';
import { stallSpeedEstimate } from '../physics/stallSpeedEstimate.js';
import { loadIncheonAirport } from '../environment/IncheonAirport.js';
import { incheonSpawn } from '../geospatial/IncheonFlightSurface.js';
import { LuklaTerrain } from '../environment/LuklaTerrain.js';
import { LuklaAirport } from '../environment/LuklaAirport.js';
import {
  defaultScenarioForRegion,
  isScenarioAvailable,
} from '../config/scenarioRegistry.js';
import {
  saveSavedAirport,
  saveSavedScenario,
} from '../config/flightSelection.js';

class PresetSpawnerMethods {
  setPreset(type, isDemoInternal = false) {
    this.hangang?.stop();
    if (this.activeAirport === 'incheon' && this.incheonAirport) {
      this.incheonAirport.group.visible = this.incheonAirport.terrain.mesh.visible = true;
      this.currentTerrain = this.incheonAirport.terrain;
      this.currentAirport = this.incheonAirport;
    }
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
    if (this.activeAirport === id) {
      if (id === 'incheon' && this.incheonAirport) {
        this.incheonAirport.group.visible = this.incheonAirport.terrain.mesh.visible = true;
        this.currentTerrain = this.incheonAirport.terrain;
        this.currentAirport = this.incheonAirport;
      }
      return;
    }
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
    // A pending start is the exception — it parks the scene and spawns once, itself.
    if (!this.applyingPendingStart) {
      this.gameFlow.abandonResumableFlight();
    }
    this.gameFlow.setCinematicAvailable(!isIncheon && !isHangang);
    this.lobbyScreen?.refresh();

    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    if (!this.applyingPendingStart) this.setPreset(defaultScenarioForRegion(id));
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

}

export function installPresetSpawner(TargetClass) {
  for (const key of Object.getOwnPropertyNames(PresetSpawnerMethods.prototype)) {
    if (key !== "constructor") {
      Object.defineProperty(
        TargetClass.prototype,
        key,
        Object.getOwnPropertyDescriptor(PresetSpawnerMethods.prototype, key),
      );
    }
  }
}
