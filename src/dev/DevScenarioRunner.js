import { DEV_SCENARIOS } from '../config/scenarioRegistry.js';
import { landingVerdict } from './scenarios/landingScenarios.js';

/** Owns test lifecycle, never a second physics engine. No DOM or background timers. */
export class DevScenarioRunner {
  constructor(sim, mode, definitions = DEV_SCENARIOS) {
    this.sim = sim;
    this.mode = mode;
    this.definitions = definitions;
    this.active = null;
    this.status = 'idle';
    this.result = null;
    this.changingState = false;
    this.elapsed = 0;
  }

  get context() { return { airport: this.sim.activeAirport, aircraft: this.sim.currentAircraftId }; }
  get blocksPhysics() { return Boolean(this.active && this.status !== 'running'); }

  start(id) {
    const definition = this.definitions[id];
    if (!this.mode.canRun(definition, this.context)) return false;
    this.stop();
    const sim = this.sim;
    sim.demoDirector.stop();
    sim.shadowDemo.stop();
    this.savedCamera = {
      mode: sim.cameraSystem.autoSwitch ? 7 : sim.cameraSystem.mode,
      photo: sim.cameraSystem.photoCockpit,
      zoom: sim.cameraSystem.opticalZoom,
      yaw: sim.cameraSystem.lookYaw, pitch: sim.cameraSystem.lookPitch,
      userModeSelected: sim.cameraSystem.userModeSelected,
      userLookOverridden: sim.cameraSystem.userLookOverridden,
    };
    this.active = { id, definition };
    this.status = 'preparing';
    this.result = null;
    this.elapsed = this.waited = 0;
    this.observation = { samples: 0, damaged: false, collapsed: 0, bodyContact: false,
      bodyDamage: false, crashed: false, stopped: false, speed: 0 };
    sim.gameFlow.enterFlight();
    sim.controls.releaseAllKeys();
    sim.controls.clearVirtualInputs();
    sim.controls.elevator = sim.controls.aileron = sim.controls.rudder = 0;
    sim.physicsAccumulator = 0;
    sim.syncFlowUi();
    return true;
  }

  updatePreparation(dt) {
    if (this.status !== 'preparing') return;
    const sim = this.sim;
    this.waited += dt;
    if (!this.mode.canRun(this.active.definition, this.context)) { this.stop(); return; }
    const visual = this.active.definition.kind === 'visual';
    const cockpit = sim.aircraft.cockpit;
    // Children exist before B738 shader warmup completes; only the published
    // ready flag guarantees the interior is visible. C172 shares its exterior.
    const cockpitReady = sim.currentAircraftId === 'C172'
      ? sim.aircraft.modelLoaded && !cockpit.cockpitModelFailed
      : cockpit.gltfCockpitLoaded === true;
    const ready = sim.aircraft.modelLoaded && sim.currentTerrain.isLoaded !== false
      && (!visual || cockpitReady);
    if (!ready) {
      if (this.waited >= 30) this.finish('failed', 'dev.reason.loading');
      return;
    }
    this.changingState = true;
    const quiet = sim.quietPresetToast;
    try {
      sim.quietPresetToast = true;
      sim.setPreset('runway');
      sim.cameraSystem.trauma = 0;
      this.active.definition.setup(sim);
      sim.physicsAccumulator = 0;
      sim.renderPose.reset(sim.position, sim.quaternion);
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.aircraft.group.updateMatrixWorld(true);
      if (!visual) sim.cameraSystem.setMode(1, true);
      sim.cameraSystem.snapToTarget(sim.aircraft.group);
      this.status = visual ? 'inspecting' : 'running';
      sim.controls.aircraftControlsDisabled = !visual;
      sim.syncFlowUi();
    } catch (error) {
      this.finish('failed', 'dev.reason.setup', error.message);
    } finally {
      sim.quietPresetToast = quiet;
      this.changingState = false;
    }
  }

  beforePhysics() {
    if (this.status !== 'running') return;
    const sim = this.sim;
    sim.controls.throttle = 0;
    sim.controls.virtualElevator = sim.controls.virtualAileron = sim.controls.virtualRudder = 0;
    sim.controls.aircraftControlsDisabled = true;
    sim.autopilot.disengage();
  }

  afterPhysics(dt) {
    if (this.status !== 'running') return;
    this.elapsed += dt;
    const sim = this.sim, definition = this.active.definition, o = this.observation;
    const states = sim.gear.contacts.map(c => c.damageState);
    if (states.length !== 3 || ![...sim.position.toArray(), ...sim.quaternion.toArray(),
      ...sim.linearVelocity.toArray(), ...sim.angularVelocity.toArray(),
      ...Object.values(sim.gear.bodyDamage)].every(Number.isFinite)) {
      this.finish('failed', 'dev.reason.invalid'); return;
    }
    o.samples++;
    o.speed = sim.linearVelocity.length();
    o.damaged ||= states.some(s => s !== 'normal');
    o.collapsed = Math.max(o.collapsed, states.filter(s => s === 'collapsed').length);
    o.bodyContact ||= (sim.telemetry.bodyContacts?.length ?? 0) > 0;
    o.bodyDamage ||= Object.values(sim.gear.bodyDamage).some(d => d > .01);
    o.crashed ||= sim.isCrashed;
    o.stopped = Boolean(sim.landingStopped);
    if (sim.isCrashed) {
      const expectedType = definition.expectedCrash ?? (definition.check === 'crash' ? 'TERRAIN' : null);
      const expected = Boolean(expectedType && expectedType === sim.crashResult?.type);
      this.finish(expected ? 'passed' : 'failed', expected ? 'dev.reason.expectedCrash' : 'dev.reason.unexpectedCrash');
      return;
    }
    const duration = definition.duration;
    if (this.elapsed + 1e-8 < duration) return;
    if (definition.expectedCrash || definition.check === 'crash') {
      this.finish('timeout', 'dev.reason.noCrash'); return;
    }
    if (!landingVerdict(definition.check, o)) { this.finish('failed', 'dev.reason.expectation'); return; }
    if (definition.check === 'stop') {
      // Ten further seconds prove the aircraft stays parked and does not abrade at rest.
      if (!this.restDamage) this.restDamage = { ...sim.gear.bodyDamage };
      if (Object.entries(this.restDamage).some(([id, d]) => Math.abs(sim.gear.bodyDamage[id] - d) > .0001)) {
        this.finish('failed', 'dev.reason.rest'); return;
      }
      if (this.elapsed + 1e-8 < duration + 10) return;
    }
    this.finish('passed', 'dev.reason.expectation');
  }

  finish(status, reason, detail = '') {
    this.status = status;
    this.result = { id: this.active.id, status, reason, detail, elapsed: this.elapsed,
      observation: { ...this.observation }, crashType: this.sim.crashResult?.type ?? null,
      gearDamage: Object.fromEntries(this.sim.gear.contacts.map(c => [c.id, c.damageState])),
      bodyDamage: { ...this.sim.gear.bodyDamage } };
  }

  restart() { return this.active ? this.start(this.active.id) : false; }

  stop({ pilotPreparation = false } = {}) {
    if (!this.active || this.changingState) return;
    this.active = null; // Detach first: reset methods may also request cancellation.
    this.status = 'idle';
    this.restDamage = null;
    const sim = this.sim;
    this.changingState = true;
    try {
      sim.shadowDemo.stop();
      sim.controls.aircraftControlsDisabled = false;
      sim.controls.releaseAllKeys();
      sim.controls.clearVirtualInputs();
      sim.controls.setTouchStick(0, 0);
      sim.controls.setTouchRudder(0);
      sim.controls.setTouchBrakes(0);
      sim.setPreset('runway', false, pilotPreparation);
      sim.cameraSystem.trauma = 0;
      const saved = this.savedCamera;
      if (saved) {
        sim.cameraSystem.setMode(saved.mode, true);
        Object.assign(sim.cameraSystem, { photoCockpit: saved.photo, lookYaw: saved.yaw,
          lookPitch: saved.pitch, userModeSelected: saved.userModeSelected,
          userLookOverridden: saved.userLookOverridden });
        if (Number.isFinite(saved.zoom)) sim.cameraSystem.opticalZoom = saved.zoom;
      }
      sim.syncFlowUi();
    } finally { this.changingState = false; }
  }
}
