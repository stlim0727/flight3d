import { CombatReplayPlayback } from '../replay/CombatReplayPlayback.js';
import { sampleTrack, sampleRemote, trackDuration, findSpan, STATE_FIELDS, OBJECT_FIELDS } from '../replay/TrackSampler.js';
import { RemoteAircraft } from '../multiplayer/RemoteAircraft.js';
import { ReplayCrashEffects, crashEvents } from '../replay/ReplayCrashEffects.js';
import { REPLAY_SPEEDS } from '../replay/replayConfig.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { isScenarioAvailable } from '../config/scenarioRegistry.js';
import { FLOW } from '../ui/GameFlowController.js';

/**
 * Plays a recorded pose track. Physics stands down while this is the active pose driver:
 * every displayed state comes from the track, interpolated in simulation seconds, so a seek
 * is instant and a speed change costs nothing.
 */
export class ReplayDirector {
  constructor(sim, onChange = () => {}, { createRemote = (scene, aircraft) => new RemoteAircraft(scene, aircraft, { createBreakup: null }),
    createEffects = options => new ReplayCrashEffects(options) } = {}) {
    this.sim = sim;
    this.onChange = onChange;
    this.active = false;
    this.paused = true;
    this.speed = 1;
    this.progressSec = 0;
    this.durationSec = 0;
    this.track = null;
    this.entryId = null;
    this.waitingTerrain = false;
    this._sample = {};
    this._seek = { hint: 0 };
    this._telemetry = null;
    this._view = null;
    this._combat = null;
    this.createRemote = createRemote;
    this.createEffects = createEffects;
    this.remotes = [];
    this.roomEffects = null;
  }

  /**
   * Rebuild the scenario the sortie flew in, then arm playback at the first sample.
   * @param {object} track decoded replay track
   * @param {{entryId?: string|null}} [options] library id, kept for the panel's status line
   * @returns {Promise<boolean>} false when the scene could not be prepared
   */
  async load(track, { entryId = null } = {}) {
    if (!track || !Array.isArray(track.samples) || track.samples.length < 2) return false;
    if (track.remotes?.some(pilot => !Object.hasOwn(AIRCRAFT_REGISTRY, pilot.aircraft)
      || !Array.isArray(pilot.samples) || pilot.samples.length !== track.samples.length)) return false;
    const { airport, aircraft, scenario, demoProfile, timeOfDay, seed } = track.metadata || {};
    const valley = scenario === 'valley';
    if (!Object.hasOwn(AIRCRAFT_REGISTRY, aircraft) || !isScenarioAvailable(airport, scenario)
      || (valley && (!Number.isSafeInteger(seed) || seed < 0))) return false;
    const sim = this.sim;
    if (sim.multiplayer?.active || sim.startingFlight || sim.airportLoading || this.loading) return false;
    this.stop();
    const view = this._captureView();
    Object.assign(sim.lobby, { airport, aircraft, preset: scenario, demoProfile });
    // The swap holds `startingFlight`, so no frame can render the new aircraft inside old terrain.
    this.loading = true;
    try {
      if (valley) {
        // Rebuild the recorded course without starting another judged arena attempt.
        sim.pilotArena?.stop('replay');
        const { SlalomMissionAdapter } = await import('../arena/SlalomMissionAdapter.js');
        this._scenarioAdapter = new SlalomMissionAdapter(sim);
        await this._scenarioAdapter.prepare({ seed, pilotKind: 'human' });
        sim.gameFlow.enterFlight();
      } else await sim.fly();
      if (track.remotes?.length && sim.gameFlow.state === FLOW.FLIGHT) {
        // Live respawns preserve wreckage. A replay starts a different timeline.
        sim.explosionSystem?.clear();
        sim.aircraftBreakup?.disposePrepared();
        for (const pilot of track.remotes) {
          const visual = this.createRemote(sim.scene, pilot.aircraft);
          this.remotes.push({ visual, sample: {}, seek: {} });
        }
        await Promise.all(this.remotes.map(remote => remote.visual.ready));
        this.remotes.forEach((remote, index) => {
          remote.events = crashEvents(track, index + 1);
          remote.effects = this.createEffects({ scene: sim.scene, aircraft: remote.visual.model,
            poseRoot: remote.visual.group, terrain: sim.currentTerrain });
        });
        this.roomEvents = crashEvents(track, 0);
        this.roomEffects = this.createEffects({ scene: sim.scene, aircraft: sim.aircraft,
          terrain: sim.currentTerrain, breakup: sim.aircraftBreakup, explosions: sim.explosionSystem });
      }
    } catch (error) {
      this._disposeRoom();
      this._scenarioAdapter?.release(); this._scenarioAdapter = null;
      throw error;
    } finally { this.loading = false; }
    sim.demoDirector?.stop();
    sim.pilotArena?.stop('replay');
    if (Number.isFinite(timeOfDay)) sim.setTimeOfDay(timeOfDay, { persist: false, userChoice: false });
    if (sim.gameFlow.state !== FLOW.FLIGHT) {
      this._view = null;
      this._combat?.stop();
      return false;
    }
    // This sortie exists to host the replay; it is not a flight the pilot flew.
    sim.flightRecorder.active = false;
    sim.replayRecorder.active = false;
    sim.debriefReport = null;
    sim.debriefReplay = null;

    this.track = track;
    this.entryId = entryId;
    this.durationSec = trackDuration(track);
    this.progressSec = 0;
    this.paused = true;
    this.speed = 1;
    this.waitingTerrain = false;
    this._seek.hint = 0;
    this._sample = {};
    // Instrument panels read fields a track never recorded, so replay fills a real telemetry
    // object instead of inventing one. It is replaced wholesale every physics step anyway.
    this._telemetry = { ...sim.telemetry };
    this._telemetry.pilot = {
      gZ: 1.0, consciousness: 1.0, responsiveness: 1.0, isGLOC: false,
      blackout: 0, redout: 0, tunnelVision: 0, grayout: 0, blur: 0, glocIncidents: 0, gFatigueSeconds: 0
    };
    this._view = view;
    sim.controls.setAircraftControlsDisabled(true);
    this.active = true;
    // Combat is a separate visual track: it never re-simulates guidance, so a
    // seek is instant and speed changes cannot alter the recorded outcome.
    this._combat ??= new CombatReplayPlayback(sim);
    this._combat.load(track.combat);
    this._combat.seek(0);
    this._applyCombatLoadout();
    this._applyPose(true);
    this.reseed();
    this.onChange();
    return true;
  }

  play() {
    if (!this.active) return false;
    if (this.progressSec >= this.durationSec - 1e-9) this.seek(0);
    this.paused = false;
    this.onChange();
    return true;
  }

  pause() {
    if (!this.active || this.paused) return this.paused;
    this.paused = true;
    this.onChange();
    return true;
  }

  togglePause() {
    return this.paused ? this.play() : this.pause();
  }

  /** Jump to a time; the camera is re-seeded because its modes carry damping accumulators. */
  seek(timeSec) {
    if (!this.track) return this.progressSec;
    const time = Number(timeSec);
    this.progressSec = Number.isFinite(time) ? Math.max(0, Math.min(this.durationSec, time)) : 0;
    this._applyPose(true);
    this._combat?.seek(this.progressSec);
    this._applyCombatLoadout();
    this.reseed();
    this.onChange();
    return this.progressSec;
  }

  /** One recorded sample at a time, so a step lands where the simulator actually was. */
  stepFrame(direction = 1) {
    if (!this.active) return this.progressSec;
    const samples = this.track.samples;
    if (direction < 0 && this.progressSec >= samples.at(-1).timeSec) {
      this.paused = true;
      return this.seek(samples.at(-2).timeSec);
    }
    const index = findSpan(samples, this.progressSec, this._seek.hint);
    const onSample = Math.abs(samples[index].timeSec - this.progressSec) < 1e-9;
    const target = direction < 0
      ? Math.max(0, onSample ? index - 1 : index)
      : Math.min(samples.length - 1, index + 1);
    this.paused = true;
    this.seek(samples[target].timeSec);
    return this.progressSec;
  }

  setSpeed(speed) {
    const value = Number(speed);
    if (!REPLAY_SPEEDS.includes(value)) return false;
    this.speed = value;
    this.onChange();
    return true;
  }

  update(dt) {
    if (!this.active) return;
    // A freshly swapped region has no heights yet; wait instead of rendering into a hole.
    const waiting = this.sim.currentTerrain?.isLoaded === false;
    if (waiting !== this.waitingTerrain) {
      this.waitingTerrain = waiting;
      this.onChange();
    }
    if (waiting) return;
    if (!this.paused) {
      this.progressSec = Math.min(this.durationSec, this.progressSec + (Number.isFinite(dt) ? Math.max(0, dt) : 0) * this.speed);
      // Running out of track parks the playback; the panel stays open for a scrub or a replay.
      if (this.progressSec >= this.durationSec) this.pause();
    }
    this._applyPose();
    this._combat?.update(this.paused ? 0 : dt * this.speed, this.progressSec);
    this._applyCombatLoadout();
    // Replay owns the rendered pose too: physics interpolation has no steps to blend.
    this.sim.renderPose.reset(this.sim.position, this.sim.quaternion);
    // Physics is not stepping, so the staged wreckage advances on the frame clock instead.
    if (!this.roomEffects && this._crashStaged && Number.isFinite(dt) && dt > 0) {
      const sim = this.sim;
      sim.aircraftBreakup?.update(dt, sim.currentTerrain, sim.water?.mesh?.visible ? sim.water.waterLevel : null);
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const sim = this.sim;
    this._scenarioAdapter?.release();
    this._scenarioAdapter = null;
    sim.controls.setAircraftControlsDisabled(false);
    sim.pilotPhysiology?.reset?.();
    sim.pilotPhysiologyFx?.reset?.();
    if (sim.telemetry) {
      sim.telemetry.pilot = sim.pilotPhysiology ? sim.pilotPhysiology.getSnapshot() : {
        gZ: 1.0, consciousness: 1.0, responsiveness: 1.0, isGLOC: false,
        blackout: 0, redout: 0, tunnelVision: 0, grayout: 0, blur: 0, glocIncidents: 0, gFatigueSeconds: 0
      };
    }
    this._clearCrash();
    this._disposeRoom();
    sim.aircraft.group.visible = true;
    if (this._view) this._restoreView(this._view);
    this._view = null;
    this._telemetry = null;
    this._combat?.stop();
    this.sim.aircraft?.setMissileLoadout?.([true, true, true, true, true, true]);
    this.track = null;
    this.entryId = null;
    this.progressSec = 0;
    this.durationSec = 0;
    this.paused = true;
    this.speed = 1;
    this.waitingTerrain = false;
    this.onChange();
  }

  /** Freeze the pose, drop the render interpolation, and put the camera back on the target. */
  reseed() {
    const sim = this.sim;
    sim.physicsAccumulator = 0;
    sim.renderPose.reset(sim.position, sim.quaternion);
    sim.aircraft.group.position.copy(sim.position);
    sim.aircraft.group.quaternion.copy(sim.quaternion);
    sim.aircraft.group.updateMatrixWorld(true);
    sim.cameraSystem.snapToTarget(sim.aircraft.group);
    // AUTO and DIRECTOR pick their own shots; a scrubbed pose must not be argued with.
    sim.cameraSystem.userModeSelected = true;
    sim.updateFlightDisplays(true);
  }

  combatHudState() {
    return this._combat?.getHudState?.(this.sim.position) ?? null;
  }

  /**
   * Recorded combat feed for the cinematic director. Shot timing follows the
   * replay's own clock so pause and speed changes keep the beats in sync.
   */
  combatState() {
    if (!this.active || !this._combat) return null;
    return {
      missiles: this._combat.state.missiles,
      targets: this._combat.state.targets,
      timeScale: this.paused ? 0 : this.speed,
    };
  }

  /** Keep the replay host's rail count in step with the recorded loadout mask. */
  _applyCombatLoadout() {
    const mask = this._combat?.state?.rails;
    if (mask === undefined) return;
    const loadout = Array.from({ length: 6 }, (_, index) => Boolean(mask & (1 << index)));
    this.sim.aircraft?.setMissileLoadout?.(loadout);
  }

  _applyPose(seek = false) {
    const sim = this.sim;
    const sample = sampleTrack(this.track, this.progressSec, this._sample, this._seek);
    if (!sample) return false;
    sim.position.set(sample.x, sample.y, sample.z);
    sim.quaternion.set(sample.quat[0], sample.quat[1], sample.quat[2], sample.quat[3]);
    const telemetry = this._telemetry;
    for (const name of STATE_FIELDS) telemetry[name] = sample[name];
    for (const name of OBJECT_FIELDS) telemetry[name] = sample[name];
    telemetry.warnings = [];
    sim.telemetry = telemetry;
    if (this.roomEffects) {
      this._applyRoom(sample, seek);
    } else this._syncCrash();
    return true;
  }

  _applyRoom(local, seek) {
    const time = this.progressSec, sim = this.sim;
    const impact = (events, sample) => sample.crashed
      ? events.findLast(event => event.timeSec <= time + 1e-6 && event.segment === sample.segment) : null;
    this.roomEffects.apply(impact(this.roomEvents, local), time, { visible: local.visible !== false, seek });
    sim.aircraft.group.visible = local.visible !== false && !local.crashed;
    this.remotes.forEach((remote, index) => {
      const sample = sampleRemote(this.track, index, time, remote.sample, remote.seek);
      const visual = remote.visual;
      const visible = Boolean(sample?.visible);
      // The live network clock and crash inference never run for replay actors.
      if (sample) {
        visual.group.position.set(sample.x, sample.y, sample.z);
        visual.group.quaternion.fromArray(sample.quat);
        visual.group.updateMatrixWorld(true);
        visual.animate({ gear: sample.gearState, flaps: sample.flapDegree }, 0);
      }
      remote.effects.apply(sample ? impact(remote.events, sample) : null, time, { visible, seek });
      visual.group.visible = visible && !sample.crashed;
      visual.model.group.visible = true;
      visual.indicator.hide();
    });
  }

  _disposeRoom() {
    this.roomEffects?.dispose(); this.roomEffects = null;
    this.roomEvents = [];
    for (const remote of this.remotes) {
      remote.effects?.dispose();
      remote.visual.dispose();
    }
    this.remotes = [];
  }

  /**
   * The pose track ends at impact; the explosion and breakup are staged from the recorded
   * marker so a crashed sortie replays its crash, and a seek back restores the airframe (#648).
   */
  _syncCrash() {
    const crash = this.track?.metadata?.crash;
    const due = Number.isFinite(crash?.timeSec) && this.progressSec + 1e-6 >= crash.timeSec;
    if (due === Boolean(this._crashStaged)) return;
    if (!due) {
      this._clearCrash();
      return;
    }
    const sim = this.sim;
    this._crashStaged = true;
    const velocity = this._impactVelocity(crash);
    // The breakup slices the airframe where it is drawn, so draw it at the impact pose first.
    sim.aircraft.group.position.copy(sim.position);
    sim.aircraft.group.quaternion.copy(sim.quaternion);
    sim.aircraft.group.updateMatrixWorld(true);
    sim.explosionSystem?.spawnExplosion({ type: crash.type, point: sim.position.clone(),
      speedKnots: crash.speedKnots ?? 0 }, velocity);
    sim.aircraft.triggerCrashVisuals?.(crash.type);
    sim.aircraftBreakup?.spawn(sim.aircraft, velocity);
  }

  _clearCrash() {
    if (!this._crashStaged) return;
    this._crashStaged = false;
    const sim = this.sim;
    sim.explosionSystem?.clear?.();
    sim.aircraft.resetCrashVisuals?.();
    sim.aircraftBreakup?.clear?.();
  }

  /** Direction from the last recorded motion before impact, magnitude from the impact speed. */
  _impactVelocity(crash) {
    const samples = this.track.samples;
    let index = samples.length - 1;
    while (index > 1 && samples[index].timeSec > crash.timeSec) index--;
    const a = samples[index - 1];
    const b = samples[index];
    const span = Math.max(1e-6, b.timeSec - a.timeSec);
    const velocity = this.sim.position.clone().set((b.x - a.x) / span, (b.y - a.y) / span, (b.z - a.z) / span);
    const speedMs = Number(crash.speedKnots) / 1.94384;
    if (Number.isFinite(speedMs) && speedMs > 0 && velocity.lengthSq() > 0) velocity.setLength(speedMs);
    return velocity;
  }

  _captureView() {
    const sim = this.sim;
    const camera = sim.cameraSystem;
    return { mode: camera.autoSwitch ? 7 : camera.mode, userModeSelected: camera.userModeSelected,
      userLookOverridden: camera.userLookOverridden, photoCockpit: camera.photoCockpit,
      lookYaw: camera.lookYaw, lookPitch: camera.lookPitch,
      skyTime: sim.sky.timeOfDay, cloud: sim.sky.cloudCover };
  }

  _restoreView(view) {
    const sim = this.sim;
    const camera = sim.cameraSystem;
    camera.setMode(view.mode, true);
    camera.userModeSelected = view.userModeSelected;
    camera.userLookOverridden = view.userLookOverridden;
    camera.photoCockpit = view.photoCockpit;
    camera.lookYaw = view.lookYaw;
    camera.lookPitch = view.lookPitch;
    sim.cameraSystem.snapToTarget(sim.aircraft.group);
    sim.setTimeOfDay(view.skyTime, { persist: false, userChoice: false });
    sim.sky.setCloudCover(view.cloud);
    sim.foliage.setTimeOfDay(sim.sky.timeOfDay);
    sim.water.syncWithAtmosphere(sim.sky);
  }
}
