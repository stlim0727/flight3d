import { Atmosphere } from '../../src/physics/Atmosphere.js';
import { analyzeCombatEngagement } from '../../src/weapons/engagementAnalysis.js';

/** Observational adapter for the numerical fixture. No codec or live state mutation. */
export class CombatDiagnosticEvents {
  constructor(missile, target) {
    this.missile = missile;
    this.target = target;
    this.origin = missile.firedAt;
    this.entities = new Map([[target, 1]]);
    this.externalIds = new Map([[`${target.type}:${target.id}`, 1]]);
    this.events = [];
    this.samples = [];
    this.previous = {};
    this.emit('launch', 0, { typeId: missile.typeId, targetId: 1,
      locked: missile.launchLocked, lockProgress: missile.launchLockProgress,
      position: missile.launchPosition.toArray(), velocity: missile.launchVelocity.toArray() });
    this.emit('seeker_state', 0, this.seekerFields());
    this.observe(this.origin, [], true);
  }

  id(entity) {
    if (!entity) return null;
    if (!this.entities.has(entity)) {
      this.entities.set(entity, this.entities.size + 1);
      this.externalIds.set(`${entity.type}:${entity.id}`, this.entities.get(entity));
    }
    return this.entities.get(entity);
  }

  emit(kind, timeSec, fields = {}) {
    this.events.push({ kind, timeSec, missileId: 1, ...fields });
  }

  seekerFields(observation = this.missile.seeker?.lastObservation) {
    const seeker = this.missile.seeker;
    return { state: seeker?.state ?? 'unknown', targetId: this.id(seeker?.target),
      targetType: seeker?.target?.type ?? null, lossReason: observation?.lossReason ?? 'none',
      signalQuality: observation?.signalQuality ?? null, angleOffDeg: observation?.aspectAngleDeg ?? null,
      rangeM: observation?.rangeM ?? null };
  }

  recordEvent(event, now) {
    if (event.type === 'launch') return; // Launch fields are frozen at construction.
    const timeSec = (event.timeSec ?? now) - this.origin;
    const { missile, target } = this;
    const fields = { targetId: this.id(event.target), position: event.position?.toArray() ?? null };
    if (event.type === 'seeker_state') {
      this.emit('seeker_state', timeSec, { ...this.seekerFields(event.lastObservation),
        state: event.state, prevState: event.prevState, targetId: this.id(event.target),
        targetType: event.target?.type ?? null });
      return;
    }
    if (event.type === 'flare_dispense' || event.type === 'chaff_dispense') {
      const decoy = event.flare ?? event.chaff;
      this.emit('decoy_dispense', timeSec, { ...fields, decoyType: decoy.type,
        decoyId: this.id(decoy), sourceId: this.id(event.target), remaining: event.remaining,
        position: decoy.position.toArray(), intervention: Boolean(event.intervention) });
      return;
    }
    if (event.type === 'decoy_transfer') {
      this.emit('decoy_transfer', timeSec, { decoyType: event.decoyType,
        decoyId: this.id(event.decoy), sourceId: event.decoy?.sourceId === target.id ? 1 : null,
        prevTargetId: this.id(event.prevTarget), signalQuality: event.signalQuality,
        angleOffDeg: event.separationAngleDeg });
      return;
    }
    if (event.type === 'flare_expire' || event.type === 'chaff_expire') {
      const decoyType = event.type === 'flare_expire' ? 'flare' : 'chaff';
      this.emit('decoy_expire', timeSec, { decoyType,
        decoyId: this.externalIds.get(`${decoyType}:${event.flareId ?? event.chaffId}`) ?? null });
      return;
    }
    if (['detonation', 'damage', 'kill', 'expire'].includes(event.type)) {
      this.emit(event.type, timeSec, { ...fields, surface: Boolean(event.surface),
        reason: event.reason ?? (event.type === 'detonation'
          ? event.surface ? 'surface_collision' : 'proximity_fuze' : null),
        fuzePolicy: event.type === 'detonation' && !event.surface ? 'continuous_fuze_cpa' : null,
        distanceM: event.type === 'detonation' && !event.surface ? missile.finalOutcome?.distanceM ?? null : null,
        amount: event.type === 'damage' ? event.damage : event.type === 'kill' ? event.target?.damage : undefined,
        hitZone: event.hitZone, source: event.source });
    }
  }

  observe(now, events, forceSample = false) {
    const seconds = now - this.origin;
    for (const event of events) this.recordEvent(event, now);
    const { missile, target } = this;
    const seeker = missile.seeker;
    const response = target.threatResponse;
    const flight = missile.flight;
    const current = {
      seekerTarget: seeker?.target ?? null,
      lossReason: seeker?.lastObservation?.lossReason ?? 'none',
      // Compare only discrete guidance state; losAngleDeg/rangeM vary every guided tick.
      guidance: JSON.stringify([missile.lastGuidance?.active ?? false, missile.lastGuidance?.reason ?? null]),
      controlLimited: flight.requestedLateralMps2 > flight.availableLateralMps2 + 1e-4,
      powered: missile.propellant > 0,
      warning: JSON.stringify([response.phase, response.observedId !== null,
        response.confirmedId !== null, response.weight > 0.01]),
    };
    if (current.seekerTarget !== this.previous.seekerTarget) {
      this.emit('seeker_target', seconds, { ...this.seekerFields(),
        prevTargetId: this.id(this.previous.seekerTarget) });
    }
    if (current.lossReason !== this.previous.lossReason) {
      this.emit('seeker_observation', seconds, this.seekerFields());
    }
    if (current.guidance !== this.previous.guidance) {
      this.emit('guidance_state', seconds, { active: missile.lastGuidance.active,
        reason: missile.lastGuidance.reason });
    }
    if (current.controlLimited !== this.previous.controlLimited) {
      this.emit('control_limit', seconds, { limited: current.controlLimited,
        demandedG: flight.requestedLateralMps2 / 9.80665, availableG: flight.availableLateralMps2 / 9.80665 });
    }
    if (current.powered !== this.previous.powered) this.emit('propulsion_state', seconds, { powered: current.powered });
    if (current.warning !== this.previous.warning) {
      this.emit('warning_state', seconds, { targetId: 1, phase: response.phase,
        observed: response.observedId !== null, confirmed: response.confirmedId !== null,
        reacting: response.weight > 0.01, responseWeight: response.weight });
    }
    this.previous = current;
    const tick = Math.round(seconds * 120);
    if (forceSample || tick % 24 === 0 || !missile.alive || !target.alive) {
      const speed = missile.velocity.length();
      this.samples.push({ timeSec: seconds, missileId: 1,
        guided: missile.lastGuidance.active, cutoffReason: missile.lastGuidance.reason ?? 'none',
        demandedG: flight.requestedLateralMps2 / 9.80665, availableG: flight.availableLateralMps2 / 9.80665,
        actualG: flight.deliveredLateralMps2 / 9.80665,
        dragN: flight.baseDragN + flight.maneuverDragN, qBarPa: flight.dynamicPressurePa,
        speedMps: speed, mach: speed / Atmosphere.getConditions(missile.position.y).speedOfSound,
        propellant: missile.propellant, separationM: missile.position.distanceTo(target.position),
        seekerState: seeker?.state, seekerLossReason: current.lossReason });
    }
  }

  finish(now) {
    const durationSec = now - this.origin;
    if (this.samples.at(-1)?.timeSec !== durationSec) this.observe(now, [], true);
    const cpa = this.missile.closestApproaches?.[this.target.id];
    if (cpa) this.emit('closest_approach', cpa.timeSec - this.origin,
      { targetId: 1, distanceM: cpa.distanceM, method: cpa.method });
    if (this.missile.alive) this.emit('unresolved_end', durationSec, { reason: 'unresolved_sortie_ended' });
    this.events.sort((a, b) => a.timeSec - b.timeSec);
    const track = { metadata: { scenario: 'numerical-combat-fixture', aircraft: 'F16' },
      durationSec, samples: [], combat: { version: 7, diagnosticIntervalSec: 0.2,
        events: this.events, diagnosticSamples: this.samples, missileSamples: [], banditSamples: [] } };
    return { schemaVersion: 'flight3d.fixture-diagnostics.v1',
      timeOrigin: 'launch', transitionIntervalSec: 1 / 120, track,
      analysis: analyzeCombatEngagement(track),
      limitations: ['Simulation-step timestamps, not continuous event times.',
        'Warning source is not distinguished. In-memory analysis input; no replay wire format change.',
        'Guidance/control/propulsion observations do not prove a unique cause of failure.'] };
  }
}
