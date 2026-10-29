import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { TRIM_WHEEL_AUTHORITY } from '../../physics/trimWheel.js';
import { flyBank, alphaGuarded } from '../PilotControlLaws.js';
import { cityRoute } from './cessnaRoutes.js';

const clamp = THREE.MathUtils.clamp;

const STAGES = {
  IDLE: -1,
  SHIP_BUZZ: 1,
  BUILDING_WEAVE: 2,
  TREE_CANOPY: 3,
  LAKE_SKIM: 4,
  TOWER_BUZZ: 5,
  COMPLETED: 6
};

const SCENE_DURATION = 7.5;
const SHOT_SPLIT = 3.7;

const SCENE_CONFIGS = {
  [STAGES.SHIP_BUZZ]: {
    name: 'ship',
    stageIndex: 1,
    timeOfDay: 7.5,
    start: { x: 673.8, y: 55.0, z: 4380.2 },
    heading: 35.0,
    direction: { x: 0.57357, z: -0.81915 },
    speedKnots: 100,
    altitude: 55.0,
    bankTarget: 0,
    getShot: (t, planePos, planeQuat, forward, right, up) => {
      if (t < SHOT_SPLIT) {
        // Shot 1: Bridge wing vantage on cargo ship looking towards oncoming Cessna
        const pos = new THREE.Vector3(828.0, 42.0, 4174.0);
        const look = planePos.clone().add(new THREE.Vector3(0, 0.4, 0));
        return { pos, look, fov: 52, up: new THREE.Vector3(0, 1, 0) };
      }
      // Shot 2: High-energy action chase trailing over the container ship and wake
      const pos = planePos.clone()
        .addScaledVector(forward, -16)
        .addScaledVector(right, -8)
        .addScaledVector(up, 3.5);
      const look = planePos.clone().addScaledVector(forward, 12);
      const camUp = new THREE.Vector3(0, 1, 0).addScaledVector(right, -0.08).normalize();
      return { pos, look, fov: 68, up: camUp };
    }
  },
  [STAGES.BUILDING_WEAVE]: {
    name: 'building',
    stageIndex: 2,
    timeOfDay: 11.0,
    start: { x: 2340.0, y: 95.0, z: 1230.0 },
    heading: 16.5,
    direction: { x: 0.2837, z: -0.9589 },
    speedKnots: 100,
    altitude: 95.0,
    bankTarget: (t) => 15 * Math.sin((t / SCENE_DURATION) * Math.PI * 2),
    getShot: (t, planePos, planeQuat, forward, right, up) => {
      if (t < SHOT_SPLIT) {
        // Shot 1: Skyscraper ledge camera looking South at oncoming plane
        const pos = new THREE.Vector3(2440.0, 102.0, 1010.0);
        const look = planePos.clone().add(new THREE.Vector3(0, 0.2, 0));
        return { pos, look, fov: 46, up: new THREE.Vector3(0, 1, 0) };
      }
      // Shot 2: Low urban canyon chase looking up at skyscrapers flanking both sides
      const pos = planePos.clone()
        .addScaledVector(forward, -14)
        .addScaledVector(right, 6)
        .addScaledVector(up, -1.5);
      const look = planePos.clone().addScaledVector(forward, 8).add(new THREE.Vector3(0, 2.5, 0));
      const rollTilt = 0.10 * Math.sin((t / SCENE_DURATION) * Math.PI * 2);
      const camUp = new THREE.Vector3(0, 1, 0).addScaledVector(right, rollTilt).normalize();
      return { pos, look, fov: 72, up: camUp };
    }
  },
  [STAGES.TREE_CANOPY]: {
    name: 'tree',
    stageIndex: 3,
    timeOfDay: 15.5,
    start: { x: -2750.0, y: 84.0, z: 460.0 },
    heading: 90.0,
    direction: { x: 1.0, z: 0.0 },
    speedKnots: 95,
    altitude: 84.0,
    bankTarget: 8.0,
    getShot: (t, planePos, planeQuat, forward, right, up) => {
      if (t < SHOT_SPLIT) {
        // Shot 1: Perched among pine tree tops looking down ridgeline
        const pos = new THREE.Vector3(-2540.0, 79.0, 472.0);
        const look = planePos.clone().add(new THREE.Vector3(0, 0.5, 0));
        return { pos, look, fov: 50, up: new THREE.Vector3(0, 1, 0) };
      }
      // Shot 2: Under-wing canopy rush showing green needles rushing past wheels
      const pos = planePos.clone()
        .addScaledVector(forward, -4.0)
        .addScaledVector(right, -4.5)
        .addScaledVector(up, -0.8);
      const look = planePos.clone().addScaledVector(forward, 25).add(new THREE.Vector3(0, -2.5, 0));
      return { pos, look, fov: 70, up: new THREE.Vector3(0, 1, 0) };
    }
  },
  [STAGES.LAKE_SKIM]: {
    name: 'lake',
    stageIndex: 4,
    timeOfDay: 17.5,
    start: { x: 100.0, y: 3.2, z: 2800.0 },
    heading: 70.0,
    direction: { x: 0.9397, z: -0.3420 },
    speedKnots: 105,
    altitude: 3.2,
    bankTarget: 0,
    getShot: (t, planePos, planeQuat, forward, right, up) => {
      if (t < SHOT_SPLIT) {
        // Shot 1: Water-level low camera right above mirror water surface
        const pos = new THREE.Vector3(320.0, 0.9, 2720.0);
        const look = planePos.clone().add(new THREE.Vector3(0, 0.3, 0));
        return { pos, look, fov: 48, up: new THREE.Vector3(0, 1, 0) };
      }
      // Shot 2: Low side tracking shot capturing sunset water reflections
      const pos = planePos.clone()
        .addScaledVector(forward, -5.0)
        .addScaledVector(right, 12.0)
        .addScaledVector(up, 0.8);
      const look = planePos.clone();
      const camUp = new THREE.Vector3(0, 1, 0).addScaledVector(right, 0.05).normalize();
      return { pos, look, fov: 62, up: camUp };
    }
  },
  [STAGES.TOWER_BUZZ]: {
    name: 'tower',
    stageIndex: 5,
    timeOfDay: 18.2,
    start: { x: 142.0, y: 82.0, z: 480.0 },
    heading: 0.0,
    direction: { x: 0.0, z: -1.0 },
    speedKnots: 105,
    altitude: (t) => (t < 4.2 ? 82.0 : 82.0 + (t - 4.2) * 14.0),
    bankTarget: (t) => (t < 4.0 ? 25.0 : 25.0 * Math.max(0, 1 - (t - 4.0) * 0.8)),
    getShot: (t, planePos, planeQuat, forward, right, up) => {
      if (t < SHOT_SPLIT) {
        // Shot 1: Inside/on catwalk of Control Tower cab looking South
        const pos = new THREE.Vector3(123.0, 81.5, 282.0);
        const look = planePos.clone().add(new THREE.Vector3(0, 0.2, 0));
        return { pos, look, fov: 50, up: new THREE.Vector3(0, 1, 0) };
      }
      // Shot 2: Spotter camera tracking tower flyby and steep victory climb
      const pos = new THREE.Vector3(155.0, 88.0, 235.0);
      const look = planePos.clone().add(new THREE.Vector3(0, 0.5, 0));
      return { pos, look, fov: 58, up: new THREE.Vector3(0, 1, 0) };
    }
  }
};

/**
 * Cessna 172 Cinematic Proximity Buzz Montage
 * Highlights 5 extreme close passes (Ship, Skyscraper, Trees, Lake, Control Tower)
 * edited like a movie reel with dynamic, cinematic camera cuts.
 */
export class CessnaProximityScenario {
  static STAGES = STAGES;

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.result = { status: 'idle' };
    this.activeConfig = null;
  }

  enterStage(stage) {
    const sim = this.sim;
    let config = SCENE_CONFIGS[stage];

    if (config) {
      if (stage === STAGES.BUILDING_WEAVE) config = this.cityWeaveConfig(config);
      this.activeConfig = config;
      if (stage === STAGES.SHIP_BUZZ) {
        this.result = { status: 'running', minClearanceM: Infinity, stagesCompleted: 0 };
      }

      // Reset damage, fuel, and controls cleanly
      sim.setPreset('cruise', true);

      const { start, direction, heading, altitude, speedKnots, timeOfDay } = config;
      const initialAlt = typeof altitude === 'function' ? altitude(0) : altitude;

      sim.position.set(start.x, initialAlt, start.z);
      const density = Atmosphere.getConditions(sim.position.y).densityRatio;
      const speedMs = speedKnots * 0.514444 / Math.sqrt(density);

      sim.linearVelocity.set(direction.x * speedMs, 0, direction.z * speedMs);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -heading * Math.PI / 180, 0, 'YXZ'));

      sim.aero.setFlapPosition(0);
      sim.aero.currentFlapAngle = 0;
      sim.aero.spoilers = 0;
      sim.gear.setGearTarget(true);
      sim.gear.gearState = 1;
      sim.applyComputedTrim();

      const n1 = sim.engines.idleN1 + sim.controls.throttle * (sim.engines.togaN1 - sim.engines.idleN1);
      sim.engines.n1.fill(n1);

      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position, sim.quaternion);

      this.director.setTimeOfDay(timeOfDay);

      const progress = `[${config.stageIndex}/5]`;
      this.director.updateBanner(
        () => t(`demo.c172.proximity.stage.${config.name}`, { progress }),
        () => t(`demo.c172.proximity.desc.${config.name}`)
      );
      if (sim.showToast) {
        sim.showToast(() => t(`demo.c172.proximity.stage.${config.name}`, { progress }));
      }

      // Hook up cinematic camera updater
      this.setupCameraUpdater(config);
    }

    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.result.stagesCompleted = 5;
      sim.cameraSystem?.setCustomViewUpdater?.(null);
      this.director.stop(() => t('demo.c172.proximity.complete'), false, { preserveThrottle: true });
    }
  }

  /** Place the weave inside a corridor through the actual generated city; never move buildings. */
  cityWeaveConfig(config) {
    const buildings = this.sim.foliage?.buildingData ?? [];
    const route = cityRoute(this.sim.currentTerrain, buildings);
    const direction = route.direction;
    const pointAlong = (distance) => ({
      x: route.start.x + direction.x * distance,
      z: route.start.z + direction.z * distance
    });
    const pathSpeed = config.speedKnots * 0.514444;
    const along = Math.max(0, (route.length - pathSpeed * SCENE_DURATION) / 2);

    // Shot 1 perches on the tallest skyscraper flanking the first half of the pass.
    let ledge = null;
    for (const b of buildings) {
      const top = b.y + b.height;
      if (top < route.altitude + 6 || top > route.altitude + 120) continue;
      const dx = b.x - route.start.x, dz = b.z - route.start.z;
      const bAlong = dx * direction.x + dz * direction.z;
      const bCross = dx * direction.z - dz * direction.x;
      if (bAlong < along + 40 || bAlong > along + pathSpeed * SHOT_SPLIT || Math.abs(bCross) > 160) continue;
      if (!ledge || top > ledge.top) ledge = { b, top, bAlong };
    }
    const chaseShot = config.getShot;

    return {
      ...config,
      start: { ...pointAlong(along), y: route.altitude },
      direction,
      heading: Math.atan2(direction.x, -direction.z) * 180 / Math.PI,
      altitude: route.altitude,
      getShot: (time, planePos, planeQuat, forward, right, up) => {
        if (ledge && time < SHOT_SPLIT) {
          const b = ledge.b;
          const pathPoint = pointAlong(ledge.bAlong);
          const toPath = { x: pathPoint.x - b.x, z: pathPoint.z - b.z };
          const distance = Math.hypot(toPath.x, toPath.z) || 1;
          const edge = Math.hypot(b.width, b.depth) / 2 + 3;
          const pos = new THREE.Vector3(b.x + toPath.x / distance * edge, ledge.top - 6, b.z + toPath.z / distance * edge);
          return { pos, look: planePos.clone().add(new THREE.Vector3(0, 0.2, 0)), fov: 46, up: new THREE.Vector3(0, 1, 0) };
        }
        // Without a flanking skyscraper the whole scene plays on the chase shot;
        // the stock shot 1 references the old fixed-address ledge.
        return chaseShot(Math.max(time, SHOT_SPLIT + 0.01), planePos, planeQuat, forward, right, up);
      }
    };
  }

  setupCameraUpdater(config) {
    if (!this.sim.cameraSystem) return;
    this.sim.cameraSystem.setCustomViewUpdater(({ camera, planePos, planeQuat, queryGroundHeight }) => {
      const tSec = this.director.stageTimer;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);

      const shot = config.getShot(tSec, planePos, planeQuat, forward, right, up);
      if (!shot) return false;

      // Ensure camera never clips through terrain or water surface
      const groundH = queryGroundHeight(shot.pos.x, shot.pos.z);
      const minY = Math.max(groundH + 0.8, 0.8);
      if (shot.pos.y < minY) shot.pos.y = minY;

      camera.position.copy(shot.pos);
      camera.up.copy(shot.up || new THREE.Vector3(0, 1, 0));
      camera.lookAt(shot.look);

      if (shot.fov && Math.abs(camera.fov - shot.fov) > 0.05) {
        camera.fov = shot.fov;
        camera.updateProjectionMatrix();
      }

      return true;
    });
  }

  holdHeading(heading, maxBank = 25) {
    const tel = this.sim.telemetry;
    const difference = ((heading - tel.headingDeg + 540) % 360) - 180;
    flyBank(this.sim, clamp(difference * 1.2, -maxBank, maxBank), tel);
  }

  flyVertical(targetVz, targetIas) {
    const sim = this.sim, aero = sim.aero;
    const bank = THREE.MathUtils.degToRad(sim.telemetry.rollDeg);
    const cosBank = Math.max(0.4, Math.cos(bank));
    const acceleration = clamp((targetVz - sim.linearVelocity.y) * 0.8, -3, 4);
    const requiredCl = aero.mass * (9.80665 + acceleration) / Math.max(1, aero.qDyn * aero.wingArea * cosBank);
    const alpha = clamp((requiredCl - aero.CL0_clean) / aero.CLa, 0.005, THREE.MathUtils.degToRad(11));
    const turnPitchRate = 9.80665 * Math.sin(bank) ** 2 / (Math.max(25, aero.tas) * cosBank);
    const q = sim.angularVelocity.x;
    const desiredRate = (alpha - aero.alpha) * 2.5 + turnPitchRate;
    const desiredAcceleration = (desiredRate - q) * 3;
    const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
    const thrustMoment = sim.engines.thrust.reduce((sum, thrust) => sum + thrust, 0) * aero.thrustPitchArmM;
    const requiredCm = (aero.Iyy * desiredAcceleration - thrustMoment) / qSc;
    const qHat = q * aero.meanChord / (2 * Math.max(10, aero.tas));
    const effectiveElevator = (requiredCm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de;
    const elevator = (effectiveElevator - THREE.MathUtils.degToRad(aero.pitchTrim) * TRIM_WHEEL_AUTHORITY) / THREE.MathUtils.degToRad(20);

    sim.controls.setVirtualInput('elevator', alphaGuarded(clamp(elevator, -0.8, 0.8), THREE.MathUtils.radToDeg(aero.alpha)));
    sim.controls.setVirtualInput('throttle', clamp(0.55 + (targetIas - sim.telemetry.iasKnots) * 0.04 + targetVz * 0.035, 0.05, 1));
  }

  update(dt) {
    const sim = this.sim, tel = sim.telemetry;
    const stage = this.director.currentStage, time = this.director.stageTimer;
    const config = this.activeConfig;

    if (!config) return;

    // Track minimum terrain/water clearance
    const terrainH = sim.currentTerrain ? sim.currentTerrain.getHeight(sim.position.x, sim.position.z) : 0;
    const clearance = sim.position.y - Math.max(terrainH, 0);
    this.result.minClearanceM = Math.min(this.result.minClearanceM, clearance);

    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -0.2, 0.2));

    // Target altitude & bank
    const targetAlt = typeof config.altitude === 'function' ? config.altitude(time) : config.altitude;
    const targetBank = typeof config.bankTarget === 'function' ? config.bankTarget(time) : config.bankTarget;

    if (Math.abs(targetBank) > 0.1) {
      flyBank(sim, targetBank, tel);
    } else {
      this.holdHeading(config.heading, 15);
    }

    const vz = clamp((targetAlt - sim.position.y) * 0.35, -3.5, 6.0);
    this.flyVertical(vz, config.speedKnots);

    // Transition to next scene at SCENE_DURATION (movie cut transition)
    if (time >= SCENE_DURATION) {
      this.result.stagesCompleted = config.stageIndex;
      const nextStage = stage + 1;
      this.director.setStage(nextStage);
    }
  }

  recordFailure(crash) {
    this.result.status = 'failed';
    this.result.reason = crash.description || crash.type;
    this.sim.cameraSystem?.setCustomViewUpdater?.(null);
  }

  stop() {
    this.sim.cameraSystem?.setCustomViewUpdater?.(null);
    if (['pending', 'running'].includes(this.result.status)) {
      this.result.status = 'cancelled';
    }
  }
}
