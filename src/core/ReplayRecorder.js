import { Atmosphere } from '../physics/Atmosphere.js';
import { REPLAY_INTERVAL_SEC, REPLAY_INTERVAL_LADDER, REPLAY_BUDGET, REPLAY_MIN_DURATION_SEC,
  HEADER_BYTES, RECORD_BYTES, decodedByteBudget } from '../replay/replayConfig.js';
import { combatByteLength, COMBAT_TRACK_VERSION } from '../replay/ReplayCodec.js';

// Observations only: time is integrated in simulation seconds, never wall time.
const REQUIRED = ['x', 'z', 'altitudeFt', 'iasKnots', 'gForce', 'pitchDeg', 'rollDeg', 'headingDeg'];
const SCALAR_FIELDS = ['elevator', 'aileron', 'rudder', 'pitchTrim', 'throttle', 'flapDegree', 'flapIndex',
  'spoilers', 'gearState', 'iasKnots', 'tasKnots', 'groundSpeedKnots', 'vsiFpm', 'radioAltFt', 'mach',
  'gForce', 'pitchDeg', 'rollDeg', 'headingDeg', 'selectedHeading', 'selectedAltitude', 'selectedSpeed'];
const FLAG_FIELDS = ['onGround', 'isTransit', 'touchdown', 'isStalled', 'isPreStall', 'isStallWarning',
  'reverserActive', 'apEngaged', 'parkBrake'];

export class ReplayRecorder {
  constructor({ maxBase64Bytes = REPLAY_BUDGET.entryBase64Bytes } = {}) {
    this.maxBase64Bytes = maxBase64Bytes;
  }

  start(metadata) {
    // A crash belongs to the sortie that had it, never to one started from its metadata.
    const { crash, ...sortie } = metadata ?? {};
    this.metadata = sortie;
    this.active = true;
    this.overflow = false;
    this.elapsed = 0;
    this.validDuration = 0;
    this.interval = REPLAY_INTERVAL_SEC;
    this.nextSample = 0;
    this.samples = [];
    this.latest = null;
    this.track = null;
    this.gearIds = [];
    this.bodyIds = [];
    this.combat = null;
    this._combatTargets = new Map();
    this._nextBanditSample = 0;
    this._nextMissileSample = 0;
    this._nextDiagnosticSample = 0;
    this._lastCombatSystem = null;
    this._measureMetadata();
  }

  /** @param quaternion the authoritative body attitude; a pose track cannot be rebuilt from attitude angles. */
  update(dt, telemetry, quaternion, combat = null) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    this._lastCombatSystem = combat;
    this._observeCombat(combat);
    if (!telemetry || !REQUIRED.every(key => Number.isFinite(telemetry[key]))) return;
    if (!isQuaternion(quaternion)) return;
    this.validDuration += dt;
    const sample = this._observe(telemetry, quaternion);
    this.latest = sample;
    if (this.elapsed + 1e-9 >= this.nextSample) {
      this._append(sample);
      this.nextSample = this.elapsed + this.interval;
    }
  }

  _observe(telemetry, quaternion) {
    const sample = {
      timeSec: this.elapsed,
      x: telemetry.x,
      y: Atmosphere.feetToMeters(telemetry.altitudeFt),
      z: telemetry.z,
      quat: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      compressions: {
        nose: telemetry.compressions?.nose ?? 0,
        mainLeft: telemetry.compressions?.mainLeft ?? 0,
        mainRight: telemetry.compressions?.mainRight ?? 0,
      },
      gearDamage: { ...telemetry.gearDamage },
      bodyDamage: { ...telemetry.bodyDamage },
      engine1: observeEngine(telemetry.engine1),
      engine2: observeEngine(telemetry.engine2),
    };
    for (const key of SCALAR_FIELDS) sample[key] = telemetry[key];
    for (const key of FLAG_FIELDS) sample[key] = Boolean(telemetry[key]);
    // The damage id lists live in metadata, so they are charged against the byte budget as soon
    // as they are known instead of being guessed at start.
    if (!this.gearIds.length && telemetry.gearDamage) {
      this.gearIds = Object.keys(telemetry.gearDamage);
      this._measureMetadata();
    }
    if (!this.bodyIds.length && telemetry.bodyDamage) {
      this.bodyIds = Object.keys(telemetry.bodyDamage);
      this._measureMetadata();
    }
    return sample;
  }

  /** The metadata blob is part of every stored entry, so it is charged against the same budget. */
  _measureMetadata() {
    this.metadataBytes = new TextEncoder().encode(JSON.stringify({
      ...this.metadata, gearIds: this.gearIds, bodyIds: this.bodyIds,
    })).length;
  }

  /** Frames that still fit the per-entry budget once metadata and combat are paid for. */
  capacity() {
    const room = decodedByteBudget(this.maxBase64Bytes) - HEADER_BYTES - this.metadataBytes
      - (this.combat ? combatByteLength(this.combat) : 0);
    return Math.max(0, Math.floor(room / RECORD_BYTES));
  }

  /**
   * Sample the air-to-air scene independently of the thinned pose track. Bandits
   * are slow enough for 2 Hz; missiles need 20 Hz to keep linear interpolation
   * visually smooth and to preserve the launch-to-fuse span.
   */
  _observeCombat(combat) {
    if (!combat) return;
    const targets = Array.isArray(combat.targets) ? combat.targets : [];
    const missiles = Array.isArray(combat.missiles) ? combat.missiles.filter(missile => missile.alive) : [];
    if (!targets.length && !missiles.length) return;

    if (this.elapsed + 1e-9 >= this._nextBanditSample) {
      const document = this._ensureCombat();
      const rails = Array.isArray(combat.loaded)
        ? combat.loaded.reduce((mask, loaded, index) => (loaded ? mask | (1 << index) : mask), 0)
        : 0b111111;
      const sample = { timeSec: this.elapsed, rails, targets: [] };
      for (const target of targets) {
        const slot = this._combatSlot(target);
        const vx = target.velocity?.x ?? 0;
        const vz = target.velocity?.z ?? 0;
        sample.targets[slot] = {
          x: target.position.x, y: target.position.y, z: target.position.z,
          headingRad: Math.atan2(vx, -vz),
          quaternion: target.quaternion?.toArray(),
          alive: target.alive !== false,
        };
      }
      for (let slot = 0; slot < document.targets.length; slot++) {
        sample.targets[slot] ??= { x: 0, y: 0, z: 0, headingRad: 0, alive: false };
      }
      document.banditSamples.push(sample);
      this._nextBanditSample = this.elapsed + document.banditIntervalSec;
    }

    if (!missiles.length) {
      this._nextMissileSample = this.elapsed;
      this._nextDiagnosticSample = this.elapsed;
      return;
    }
    const document = this._ensureCombat();

    if (this.elapsed + 1e-9 >= this._nextMissileSample) {
      for (const missile of missiles) {
        document.missileSamples.push({
          timeSec: this.elapsed,
          id: missile.id & 255,
          typeId: missile.typeId,
          x: missile.position.x, y: missile.position.y, z: missile.position.z,
          quat: [missile.quaternion.x, missile.quaternion.y, missile.quaternion.z, missile.quaternion.w],
          powered: missile.propellant > 0,
        });
      }
      this._nextMissileSample = this.elapsed + document.missileIntervalSec;
    }

    if (this.elapsed + 1e-9 >= this._nextDiagnosticSample) {
      for (const missile of missiles) {
        const obs = missile.seeker?.lastObservation;
        const flight = missile.flight;
        document.diagnosticSamples.push({
          timeSec: this.elapsed,
          missileId: (missile.id ?? 0) & 255,
          guidanceActive: Boolean(missile.lastGuidance?.active),
          powered: missile.propellant > 0,
          tracking: Boolean(missile.seeker?.hasEstimate),
          guidanceCutoffReason: missile.lastGuidance?.reason ?? 'none',
          seekerState: missile.seeker?.state ?? 'unknown',
          seekerLossReason: obs?.lossReason ?? 'none',
          speedMps: missile.velocity?.length() ?? 0,
          altitudeM: missile.position?.y ?? 0,
          dynamicPressurePa: flight?.dynamicPressurePa ?? 0,
          requestedLateralG: (flight?.requestedLateralMps2 ?? 0) / 9.80665,
          availableLateralG: (flight?.availableLateralMps2 ?? 0) / 9.80665,
          deliveredLateralG: (flight?.deliveredLateralMps2 ?? 0) / 9.80665,
          maneuverDragN: flight?.maneuverDragN ?? 0,
          baseDragN: flight?.baseDragN ?? 0,
          propellant: missile.propellant ?? 0,
          signalQuality: obs?.signalQuality ?? 0,
          targetRangeM: obs?.rangeM ?? 0,
        });
      }
      this._nextDiagnosticSample = this.elapsed + document.diagnosticIntervalSec;
    }
  }

  _ensureCombat() {
    if (this.combat) return this.combat;
    this.combat = {
      version: COMBAT_TRACK_VERSION,
      banditIntervalSec: 0.5,
      missileIntervalSec: 0.05,
      diagnosticIntervalSec: 0.2,
      targets: [],
      banditSamples: [],
      missileSamples: [],
      diagnosticSamples: [],
      events: [],
      killEventsRecorded: true,
      diagnosticRecorded: true,
      fidelity: {
        downsampled: false,
        eventsPreserved: true,
        missileIntervalSec: 0.05,
        banditIntervalSec: 0.5,
        diagnosticIntervalSec: 0.2,
      },
    };
    return this.combat;
  }

  /** Callsigns live once per target; older samples are padded when a slot is added late. */
  _combatSlot(target) {
    const known = this._combatTargets.get(target.id);
    if (known !== undefined) return known;
    const document = this._ensureCombat();
    const slot = document.targets.length;
    document.targets.push({ id: target.id, callsign: target.callsign || `TARGET ${slot + 1}` });
    this._combatTargets.set(target.id, slot);
    for (const sample of document.banditSamples) {
      while (sample.targets.length < document.targets.length) {
        sample.targets.push({ x: 0, y: 0, z: 0, headingRad: 0, alive: false });
      }
    }
    return slot;
  }

  /**
   * Record a live combat event at the current sortie time.
   */
  recordCombatEvent(event) {
    if (!this.active || !event) return;
    const allowed = [
      'detonation', 'expire', 'kill', 'launch', 'seeker_state',
      'decoy_dispense', 'decoy_transfer', 'damage', 'unresolved_end',
      'flare_dispense', 'chaff_dispense', 'flare_expire', 'chaff_expire', 'decoy_expire',
    ];
    if (!allowed.includes(event.type)) return;
    const document = this._ensureCombat();
    const position = event.position || event.missile?.position || event.flare?.position || event.chaff?.position;
    const velocity = event.velocity || event.missile?.velocity || event.flare?.velocity || event.chaff?.velocity;

    let normalizedKind = event.type;
    let decoyType = event.decoyType;
    if (event.type === 'flare_dispense') {
      normalizedKind = 'decoy_dispense';
      decoyType = 'flare';
    } else if (event.type === 'chaff_dispense') {
      normalizedKind = 'decoy_dispense';
      decoyType = 'chaff';
    } else if (event.type === 'flare_expire') {
      normalizedKind = 'decoy_expire';
      decoyType = 'flare';
    } else if (event.type === 'chaff_expire') {
      normalizedKind = 'decoy_expire';
      decoyType = 'chaff';
    }

    const eventRecord = {
      timeSec: event.timeSec ?? this.elapsed,
      kind: normalizedKind,
      missileId: (event.missile?.id ?? event.missileId ?? 0) & 255,
      surface: Boolean(event.surface),
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      z: position?.z ?? 0,
      vx: velocity?.x ?? 0,
      vy: velocity?.y ?? 0,
      vz: velocity?.z ?? 0,
    };

    if (normalizedKind === 'launch') {
      eventRecord.locked = Boolean(event.locked);
      eventRecord.lockProgress = event.lockProgress ?? 0;
      eventRecord.targetId = (event.missile?.launchTargetId ?? event.target?.id ?? 0) & 255;
      eventRecord.vx = eventRecord.lockProgress;
    } else if (normalizedKind === 'seeker_state') {
      eventRecord.state = event.state ?? 'unknown';
      eventRecord.lossReason = event.lastObservation?.lossReason ?? 'none';
      eventRecord.signalQuality = event.lastObservation?.signalQuality ?? 0;
      eventRecord.aspectAngleDeg = event.lastObservation?.aspectAngleDeg ?? 0;
      eventRecord.observationAgeSec = event.observationAge ?? 0;
      eventRecord.vx = eventRecord.signalQuality;
      eventRecord.vy = eventRecord.aspectAngleDeg;
      eventRecord.vz = eventRecord.observationAgeSec;
    } else if (normalizedKind === 'decoy_dispense') {
      eventRecord.decoyType = decoyType;
      eventRecord.remaining = event.remaining ?? 0;
    } else if (normalizedKind === 'decoy_transfer') {
      eventRecord.decoyType = event.decoyType ?? 'flare';
      eventRecord.decoyId = (event.decoy?.id ?? event.decoyId ?? 0) & 255;
      eventRecord.signalQuality = event.signalQuality ?? 0;
      eventRecord.separationAngleDeg = event.separationAngleDeg ?? 0;
      eventRecord.vx = eventRecord.signalQuality;
      eventRecord.vy = eventRecord.separationAngleDeg;
    } else if (normalizedKind === 'decoy_expire') {
      eventRecord.decoyType = decoyType;
      eventRecord.decoyId = (event.decoy?.id ?? event.decoyId ?? event.flareId ?? event.chaffId ?? 0) & 255;
    } else if (normalizedKind === 'damage' || normalizedKind === 'kill') {
      eventRecord.hitZone = event.hitZone ?? event.zone ?? 'fuselage';
      eventRecord.amount = event.amount ?? event.damage ?? 0;
      if (normalizedKind === 'damage') eventRecord.vx = eventRecord.amount;
    } else if (normalizedKind === 'unresolved_end') {
      eventRecord.reason = 'unresolved_sortie_ended';
    } else if (normalizedKind === 'detonation') {
      eventRecord.reason = event.surface ? 'surface_collision' : 'proximity_fuze';
      eventRecord.distanceM = event.distanceM ?? event.dist ?? 0;
      eventRecord.vy = eventRecord.distanceM;
    } else if (normalizedKind === 'expire') {
      eventRecord.reason = event.reason ?? 'life_expiry';
    }

    document.events.push(eventRecord);
  }

  /** Keep the saved/auto entry inside the per-entry budget by thinning combat before pose. */
  _trimCombat(poseSamples = this.samples.length) {
    if (!this.combat) return;
    const poseBytes = HEADER_BYTES + this.metadataBytes + poseSamples * RECORD_BYTES;
    const available = decodedByteBudget(this.maxBase64Bytes) - poseBytes;
    while (combatByteLength(this.combat, this.combat.version ?? COMBAT_TRACK_VERSION) > available) {
      const document = this.combat;
      if (document.diagnosticSamples?.length > 1) {
        document.diagnosticSamples = document.diagnosticSamples.filter((_, index) => index % 2 === 0);
        document.diagnosticIntervalSec *= 2;
        document.fidelity.downsampled = true;
        document.fidelity.diagnosticIntervalSec = document.diagnosticIntervalSec;
      } else if (document.missileSamples.length > 1) {
        document.missileSamples = document.missileSamples.filter((_, index) => index % 2 === 0);
        document.missileIntervalSec *= 2;
        document.fidelity.downsampled = true;
        document.fidelity.missileIntervalSec = document.missileIntervalSec;
      } else if (document.banditSamples.length > 1) {
        document.banditSamples = document.banditSamples.filter((_, index) => index % 2 === 0);
        document.banditIntervalSec *= 2;
        document.fidelity.downsampled = true;
        document.fidelity.banditIntervalSec = document.banditIntervalSec;
      } else if (document.events.length) {
        document.events.length = 0;
        document.fidelity.eventsPreserved = false;
      } else {
        this.combat = null;
        return;
      }
    }
  }

  /** The byte budget, not a sample count, decides when a track is thinned or refused. */
  _append(sample) {
    if (this.samples.length < this.capacity()) {
      this.samples.push(sample);
      return;
    }
    if (this.interval >= REPLAY_INTERVAL_LADDER.at(-1)) {
      this.overflow = true;
      return;
    }
    this.samples = this.samples.filter((_, index) => index % 2 === 0);
    this.interval *= 2;
    this.samples.push(sample);
  }

  /**
   * The pose track stops being meaningful at impact, so playback stages the crash from this
   * marker instead (#648). Only the first impact of a sortie is kept.
   */
  markCrash(crashResult) {
    if (!this.active || !crashResult || this.metadata.crash) return;
    const speedKnots = Number(crashResult.speedKnots);
    // Milliseconds rounding can land past the recorded elapsed time, and playback caps at
    // the recorded duration, so an over-rounded marker would never become due (#724).
    const timeSec = Math.min(this.elapsed, Math.round(this.elapsed * 1000) / 1000);
    this.metadata.crash = { type: crashResult.type ?? null, timeSec,
      speedKnots: Number.isFinite(speedKnots) ? Math.round(speedKnots) : null };
    this._measureMetadata();
  }

  finish() {
    if (this.track) return this.track;
    if (this.samples.length < 2 || this.validDuration + 1e-9 < REPLAY_MIN_DURATION_SEC) {
      this.active = false;
      return null;
    }
    if (this.latest && this.samples.at(-1) !== this.latest) {
      this._append(this.latest);
      // At the final rung retain the endpoint even when the flight is too long to save.
      if (this.samples.at(-1) !== this.latest) this.samples[this.samples.length - 1] = this.latest;
    }

    // Mark alive missiles as unresolved because the sortie ended while they were in flight
    if (this.combat && this._lastCombatSystem?.missiles) {
      const resolvedMissileIds = new Set(
        this.combat.events
          .filter(e => e.kind === 'detonation' || e.kind === 'expire')
          .map(e => e.missileId)
      );
      for (const missile of this._lastCombatSystem.missiles) {
        if (missile.alive && !resolvedMissileIds.has((missile.id ?? 0) & 255)) {
          missile.finalOutcome = { reason: 'unresolved_sortie_ended', timeSec: this.elapsed };
          this.recordCombatEvent({
            type: 'unresolved_end',
            missile,
            position: missile.position,
            velocity: missile.velocity,
            timeSec: this.elapsed,
            reason: 'unresolved_sortie_ended',
          });
        }
      }
    }

    this.active = false;
    this._trimCombat(this.samples.length);
    this.track = {
      intervalSec: this.interval,
      durationSec: this.elapsed,
      overflow: this.overflow,
      metadata: { ...this.metadata, gearIds: this.gearIds, bodyIds: this.bodyIds },
      samples: this.samples,
      gearIds: this.gearIds,
      bodyIds: this.bodyIds,
    };
    if (this.combat) this.track.combat = this.combat;
    return this.track;
  }
}

function isQuaternion(value) {
  return value && [value.x, value.y, value.z, value.w].every(Number.isFinite);
}

function observeEngine(engine) {
  return { n1: engine?.n1 ?? 0, n2: engine?.n2 ?? 0, egt: engine?.egt ?? 0, ff: engine?.fuelFlow ?? engine?.ff ?? 0,
    failed: Boolean(engine?.failed) };
}
