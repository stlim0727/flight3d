import { decodeTrack, fromBase64 } from '../replay/ReplayCodec.js';

export const ENGAGEMENT_SCHEMA_VERSION = 'flight3d.engagement.v1';

/**
 * Reconstructs, correlates, and analyzes air-to-air missile engagements from
 * a sortie object, track object, or serialized base64 track payload.
 *
 * @param {object|string} sortieOrTrack - Sortie artifact, track object, or base64 track string
 * @param {object} [options]
 * @param {string} [options.appBuild]
 * @returns {object} Structured engagement report conforming to flight3d.engagement.v1
 */
export function analyzeCombatEngagement(sortieOrTrack, options = {}) {
  let sortie = null;
  let track = null;

  if (typeof sortieOrTrack === 'string') {
    try {
      track = decodeTrack(fromBase64(sortieOrTrack));
    } catch {
      track = null;
    }
  } else if (sortieOrTrack && typeof sortieOrTrack === 'object') {
    if (sortieOrTrack.kind === 'flight3d.sortie.v1' || ('report' in sortieOrTrack && 'track' in sortieOrTrack)) {
      sortie = sortieOrTrack;
      if (typeof sortie.track === 'string') {
        try {
          track = decodeTrack(fromBase64(sortie.track));
        } catch {
          track = null;
        }
      } else if (sortie.track && typeof sortie.track === 'object') {
        track = sortie.track;
      }
    } else if (Array.isArray(sortieOrTrack.samples) || sortieOrTrack.combat) {
      track = sortieOrTrack;
    }
  }

  const report = sortie?.report || null;
  const metadata = track?.metadata || report?.metadata || {};
  const combat = track?.combat || null;
  const durationSec = report?.durationSec ?? track?.durationSec ?? 0;
  const trackVersion = combat?.version ?? 0;
  const isLegacyTrack = trackVersion < 7;

  // Build fidelity & limitations
  const limitations = [];
  if (!combat) {
    limitations.push('No combat telemetry recorded in this sortie');
  } else if (isLegacyTrack) {
    limitations.push(
      `Recorded in legacy combat format v${trackVersion}: detailed seeker states, guidance metrics, and sensor loss reasons are unavailable.`
    );
  }

  const downsampled = Boolean(combat?.fidelity?.downsampled || combat?.downsampled);
  if (downsampled) {
    limitations.push('Telemetry was downsampled to preserve storage budget; some high-rate diagnostic steps were omitted.');
  }

  const fidelity = {
    schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
    trackVersion,
    isLegacyTrack,
    downsampled,
    diagnosticIntervalSec: combat?.diagnosticIntervalSec ?? 0.2,
    limitations,
  };

  const meta = {
    schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
    appBuild: options.appBuild || metadata.appBuild || 'flight3d-sim',
    scenario: metadata.scenario || 'unknown',
    aircraft: metadata.aircraft || 'unknown',
    airport: metadata.airport || 'unknown',
    durationSec: Number(durationSec.toFixed(3)),
    sortieReason: report?.reason || 'completed',
  };

  if (!combat) {
    return {
      schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
      meta,
      fidelity,
      summary: createEmptySummary(),
      missiles: [],
      countermeasures: [],
      timeline: [],
    };
  }

  const rawEvents = Array.isArray(combat.events) ? [...combat.events] : [];
  const missileSamples = Array.isArray(combat.missileSamples) ? combat.missileSamples : [];
  const diagnosticSamples = Array.isArray(combat.diagnosticSamples) ? combat.diagnosticSamples : [];
  const banditSamples = Array.isArray(combat.banditSamples) ? combat.banditSamples : [];

  // Group missile kinematic samples by missileId
  const samplesByMissile = new Map();
  for (const s of missileSamples) {
    const mid = s.id ?? s.missileId ?? 1;
    if (!samplesByMissile.has(mid)) {
      samplesByMissile.set(mid, []);
    }
    samplesByMissile.get(mid).push(s);
  }

  // Group diagnostic samples by missileId
  const diagByMissile = new Map();
  for (const d of diagnosticSamples) {
    const mid = d.missileId ?? 1;
    if (!diagByMissile.has(mid)) {
      diagByMissile.set(mid, []);
    }
    diagByMissile.get(mid).push(d);
  }

  // Discover all missile IDs from events, samples, and diagnostics
  const allMissileIds = new Set();
  for (const ev of rawEvents) {
    if (ev.missileId != null) allMissileIds.add(ev.missileId);
  }
  for (const mid of samplesByMissile.keys()) {
    allMissileIds.add(mid);
  }
  for (const mid of diagByMissile.keys()) {
    allMissileIds.add(mid);
  }

  // Process missile lifecycle and diagnostics
  const analyzedMissiles = [];
  const summaryOutcomes = {
    kill: 0,
    survived_fuze_blast: 0,
    expired: 0,
    ground_impact: 0,
    unresolved_sortie_ended: 0,
    other: 0,
  };

  let totalLaunches = 0;
  let lockedLaunches = 0;
  let noLockLaunches = 0;
  let flareCount = 0;
  let chaffCount = 0;
  let decoyTransferCount = 0;

  // Countermeasure inventory tracking
  for (const ev of rawEvents) {
    if (ev.kind === 'flare_dispense' || (ev.kind === 'decoy_dispense' && ev.decoyType === 'flare')) {
      flareCount++;
    } else if (ev.kind === 'chaff_dispense' || (ev.kind === 'decoy_dispense' && ev.decoyType === 'chaff')) {
      chaffCount++;
    } else if (ev.kind === 'decoy_transfer') {
      decoyTransferCount++;
    }
  }

  for (const missileId of Array.from(allMissileIds).sort((a, b) => a - b)) {
    const mSamples = samplesByMissile.get(missileId) || [];
    const mDiags = diagByMissile.get(missileId) || [];
    const mEvents = rawEvents.filter(ev => ev.missileId === missileId);

    const launchEvent = mEvents.find(ev => ev.kind === 'launch');
    const detEvent = mEvents.find(ev => ev.kind === 'detonation');
    const expireEvent = mEvents.find(ev => ev.kind === 'expire');
    const killEvent = mEvents.find(ev => ev.kind === 'kill');
    const damageEvents = mEvents.filter(ev => ev.kind === 'damage');
    const unresolvedEvent = mEvents.find(ev => ev.kind === 'unresolved_end');

    totalLaunches++;
    const isLockedLaunch = launchEvent ? Boolean(launchEvent.locked) : false;
    if (isLockedLaunch) {
      lockedLaunches++;
    } else {
      noLockLaunches++;
    }

    // Launch conditions
    const firstSample = mSamples[0] || null;
    const launchTime = launchEvent?.timeSec ?? firstSample?.timeSec ?? 0;
    const launchPos = launchEvent?.position ?? (firstSample ? [firstSample.x, firstSample.y, firstSample.z] : null);
    const launchVel = launchEvent?.velocity ?? null;
    const launchSpeed = launchVel ? Math.hypot(launchVel[0], launchVel[1], launchVel[2]) : null;

    // Seeker timeline
    const seekerTimeline = [];
    for (const ev of mEvents) {
      if (ev.kind === 'seeker_state') {
        seekerTimeline.push({
          timeSec: ev.timeSec,
          state: ev.state,
          targetId: ev.targetId ?? null,
          lossReason: ev.lossReason ?? 'none',
          signalQuality: ev.signalQuality ?? null,
          angleOffDeg: ev.angleOffDeg ?? null,
          rangeM: ev.rangeM ?? null,
        });
      }
    }

    // Decoy transfers for this missile
    const decoyTransfers = [];
    for (const ev of mEvents) {
      if (ev.kind === 'decoy_transfer') {
        decoyTransfers.push({
          timeSec: ev.timeSec,
          decoyType: ev.decoyType,
          decoyId: ev.decoyId,
          sourceId: ev.sourceId ?? null,
          reason: ev.reason ?? 'signal_dominance',
          angleOffDeg: ev.angleOffDeg ?? null,
          rangeM: ev.rangeM ?? null,
        });
      }
    }

    // Guidance timeline from diagnostics
    const guidanceTimeline = [];
    for (const d of mDiags) {
      guidanceTimeline.push({
        timeSec: d.timeSec,
        guided: d.guided,
        cutoffReason: d.cutoffReason,
        demandedG: d.demandedG,
        availableG: d.availableG,
        actualG: d.actualG,
        dragN: d.dragN,
        qBarPa: d.qBarPa,
        mach: d.mach,
        separationM: d.separationM,
        seekerState: d.seekerState,
        seekerLossReason: d.seekerLossReason,
      });
    }

    // Determine termination outcome and reason
    let outcome = 'unknown';
    let termReason = '';
    let termTime = durationSec;
    let termPos = null;
    let termTargetPos = null;
    let termDist = null;
    let fuzeTriggered = false;
    let damageApplied = 0;

    for (const dmg of damageEvents) {
      damageApplied += dmg.damage ?? 0;
    }

    if (killEvent) {
      outcome = 'kill';
      termReason = 'Direct blast kill against bandit';
      termTime = killEvent.timeSec;
      termPos = detEvent?.position ?? killEvent.position ?? null;
      termTargetPos = killEvent.targetPosition ?? null;
      termDist = detEvent?.distanceM ?? killEvent.distanceM ?? 0;
      fuzeTriggered = Boolean(detEvent?.fuzePolicy);
      summaryOutcomes.kill++;
    } else if (detEvent) {
      fuzeTriggered = Boolean(detEvent.fuzePolicy);
      termTime = detEvent.timeSec;
      termPos = detEvent.position ?? null;
      termDist = detEvent.distanceM ?? null;
      termTargetPos = detEvent.targetPosition ?? null;

      if (detEvent.fuzePolicy) {
        outcome = 'survived_fuze_blast';
        termReason = `Proximity fuze triggered at ${termDist?.toFixed(1) ?? 'N/A'}m but bandit survived`;
        summaryOutcomes.survived_fuze_blast++;
      } else {
        outcome = 'ground_impact';
        termReason = 'Impacted terrain or surface structure';
        summaryOutcomes.ground_impact++;
      }
    } else if (expireEvent) {
      outcome = 'expired';
      termReason = 'Maximum missile flight lifespan reached';
      termTime = expireEvent.timeSec;
      summaryOutcomes.expired++;
    } else if (unresolvedEvent || isLegacyTrack) {
      outcome = 'unresolved_sortie_ended';
      const lastSamp = mSamples[mSamples.length - 1];
      termTime = lastSamp?.timeSec ?? durationSec;
      termPos = lastSamp ? [lastSamp.x, lastSamp.y, lastSamp.z] : null;
      termReason = 'Sortie ended while missile was still in active flight; terminal outcome unresolved';
      summaryOutcomes.unresolved_sortie_ended++;
    } else {
      outcome = 'other';
      termReason = 'Missile lost from simulation without terminal event';
      summaryOutcomes.other++;
    }

    // Closest approach calculation / lookup
    let minSeparationM = null;
    let cpaTimeSec = null;
    let cpaMethod = 'unknown';

    if (detEvent && Number.isFinite(detEvent.distanceM)) {
      minSeparationM = detEvent.distanceM;
      cpaTimeSec = detEvent.timeSec;
      cpaMethod = detEvent.fuzePolicy ? 'continuous_fuze' : 'step_sampling';
    } else if (guidanceTimeline.length > 0) {
      let lowest = Infinity;
      let lowestTime = null;
      for (const g of guidanceTimeline) {
        if (Number.isFinite(g.separationM) && g.separationM < lowest) {
          lowest = g.separationM;
          lowestTime = g.timeSec;
        }
      }
      if (lowest < Infinity) {
        minSeparationM = Number(lowest.toFixed(2));
        cpaTimeSec = lowestTime;
        cpaMethod = 'step_sampling';
      }
    } else if (mSamples.length > 0 && banditSamples.length > 0) {
      // Estimate from kinematic interpolation across samples
      let lowest = Infinity;
      let lowestTime = null;
      for (const ms of mSamples) {
        const bs = findClosestBanditSample(banditSamples, ms.timeSec);
        if (bs) {
          const dist = Math.hypot(ms.x - bs.x, ms.y - bs.y, ms.z - bs.z);
          if (dist < lowest) {
            lowest = dist;
            lowestTime = ms.timeSec;
          }
        }
      }
      if (lowest < Infinity) {
        minSeparationM = Number(lowest.toFixed(2));
        cpaTimeSec = lowestTime;
        cpaMethod = 'sample_interpolation';
      }
    }

    // Generate natural causal summary
    const causalSummary = generateCausalSummary({
      isLegacyTrack,
      outcome,
      launchLocked: isLockedLaunch,
      launchLockProgress: launchEvent?.lockProgress ?? (isLockedLaunch ? 1 : 0),
      seekerTimeline,
      guidanceTimeline,
      decoyTransfers,
      minSeparationM,
      termDist,
      damageApplied,
      fuzeTriggered,
      termReason,
    });

    analyzedMissiles.push({
      missileId,
      typeId: launchEvent?.typeId ?? firstSample?.typeId ?? 'AIM9X',
      launch: {
        timeSec: Number(launchTime.toFixed(3)),
        targetId: launchEvent?.targetId ?? null,
        locked: isLockedLaunch,
        lockProgress: launchEvent?.lockProgress ?? (isLockedLaunch ? 1.0 : 0.0),
        position: launchPos,
        velocity: launchVel,
        airspeedMps: launchSpeed ? Number(launchSpeed.toFixed(1)) : null,
      },
      termination: {
        timeSec: Number(termTime.toFixed(3)),
        outcome,
        reason: termReason,
        position: termPos,
        targetPosition: termTargetPos,
        distanceM: termDist != null ? Number(termDist.toFixed(2)) : null,
        fuzeTriggered,
        damageApplied: Number(damageApplied.toFixed(1)),
      },
      closestApproach: {
        minSeparationM,
        timeSec: cpaTimeSec != null ? Number(cpaTimeSec.toFixed(3)) : null,
        method: cpaMethod,
        targetId: launchEvent?.targetId ?? 'bandit',
      },
      seekerTimeline,
      decoyTransfers,
      guidanceTimeline,
      causalSummary,
    });
  }

  // Gun kills vs missile kills
  const gunKills = rawEvents.filter(ev => ev.kind === 'kill' && ev.source === 'gun').length;
  const missileKills = summaryOutcomes.kill;
  const totalKills = gunKills + missileKills;

  // Build merged chronological timeline of significant combat events
  const timeline = rawEvents
    .map(ev => ({
      timeSec: Number(ev.timeSec.toFixed(3)),
      kind: ev.kind,
      missileId: ev.missileId ?? null,
      targetId: ev.targetId ?? null,
      sourceId: ev.sourceId ?? null,
      details: formatEventDetails(ev),
    }))
    .sort((a, b) => a.timeSec - b.timeSec);

  return {
    schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
    meta,
    fidelity,
    summary: {
      totalLaunches,
      lockedLaunches,
      noLockLaunches,
      missileKills,
      gunKills,
      totalKills,
      outcomes: summaryOutcomes,
      countermeasures: {
        flaresDispensed: flareCount,
        chaffDispensed: chaffCount,
        decoyTransfers: decoyTransferCount,
      },
    },
    missiles: analyzedMissiles,
    timeline,
  };
}

function createEmptySummary() {
  return {
    totalLaunches: 0,
    lockedLaunches: 0,
    noLockLaunches: 0,
    missileKills: 0,
    gunKills: 0,
    totalKills: 0,
    outcomes: {
      kill: 0,
      survived_fuze_blast: 0,
      expired: 0,
      ground_impact: 0,
      unresolved_sortie_ended: 0,
      other: 0,
    },
    countermeasures: {
      flaresDispensed: 0,
      chaffDispensed: 0,
      decoyTransfers: 0,
    },
  };
}

function findClosestBanditSample(banditSamples, timeSec) {
  if (!banditSamples || banditSamples.length === 0) return null;
  let closest = banditSamples[0];
  let minDiff = Math.abs(closest.timeSec - timeSec);
  for (let i = 1; i < banditSamples.length; i++) {
    const diff = Math.abs(banditSamples[i].timeSec - timeSec);
    if (diff < minDiff) {
      minDiff = diff;
      closest = banditSamples[i];
    } else if (diff > minDiff) {
      break;
    }
  }
  return closest;
}

function formatEventDetails(ev) {
  switch (ev.kind) {
    case 'launch':
      return `Launched ${ev.typeId || 'missile'} against ${ev.targetId || 'target'} (locked: ${ev.locked})`;
    case 'seeker_state':
      return `Seeker transition to ${ev.state}${ev.lossReason ? ` (loss: ${ev.lossReason})` : ''}`;
    case 'decoy_dispense':
    case 'flare_dispense':
    case 'chaff_dispense':
      return `${ev.decoyType || (ev.kind.includes('flare') ? 'flare' : 'chaff')} dispensed by ${ev.sourceId || 'bandit'}`;
    case 'decoy_transfer':
      return `Seeker seduced by ${ev.decoyType} #${ev.decoyId}`;
    case 'detonation':
      return `Detonation at ${ev.distanceM != null ? ev.distanceM.toFixed(1) + 'm' : 'surface'} (${ev.fuzePolicy || 'impact'})`;
    case 'damage':
      return `Applied ${ev.damage?.toFixed(1) ?? 'N/A'} damage to ${ev.targetId} (${ev.zone || 'general'})`;
    case 'kill':
      return `Confirmed kill on ${ev.targetId}`;
    case 'expire':
      return 'Missile flight lifespan expired';
    case 'unresolved_end':
      return 'Simulation ended while missile was in flight';
    default:
      return `${ev.kind} event`;
  }
}

function generateCausalSummary({
  isLegacyTrack,
  outcome,
  launchLocked,
  seekerTimeline,
  guidanceTimeline,
  decoyTransfers,
  minSeparationM,
  termDist,
  damageApplied,
  fuzeTriggered,
  termReason,
}) {
  if (isLegacyTrack) {
    if (outcome === 'unresolved_sortie_ended') {
      return (
        'Legacy track (v6 or earlier): Telemetry ended while missile was still traveling. ' +
        'Seeker state transitions, guidance cuts, and countermeasure reactions were not recorded in this format, ' +
        'so the terminal outcome is officially unresolved.'
      );
    }
    return `Legacy track: missile concluded with ${outcome}. Detailed sensor telemetry not available in format.`;
  }

  const parts = [];

  // Launch assessment
  if (!launchLocked) {
    parts.push('Fired without radar/IR lock (boresight/blind launch), requiring autonomous search in flight.');
  }

  // Decoy transfer check
  if (decoyTransfers.length > 0) {
    const t = decoyTransfers[0];
    parts.push(`Seeker lock transferred to a countermeasures ${t.decoyType} (decoy #${t.decoyId}) at t=${t.timeSec.toFixed(1)}s.`);
  }

  // Seeker loss check
  const lostEvents = seekerTimeline.filter(s => s.state === 'lost');
  if (lostEvents.length > 0) {
    const reasons = Array.from(new Set(lostEvents.map(s => s.lossReason))).join(', ');
    parts.push(`Seeker lost tracking due to: ${reasons}.`);
  }

  // Guidance cutoff check
  const cutoffSamples = guidanceTimeline.filter(g => !g.guided && g.cutoffReason !== 'none');
  if (cutoffSamples.length > 0) {
    const distinctReasons = Array.from(new Set(cutoffSamples.map(g => g.cutoffReason)));
    parts.push(`Guidance commands were inhibited by kinematics/limits (${distinctReasons.join(', ')}).`);
  }

  // Terminal & Fuze assessment
  if (outcome === 'kill') {
    parts.push(`Successful interception: proximity fuze detonated at ${termDist?.toFixed(1) ?? 'N/A'}m causing fatal structural damage.`);
  } else if (outcome === 'survived_fuze_blast') {
    parts.push(
      `Fuze detonated at ${termDist?.toFixed(1) ?? 'N/A'}m (min separation ${minSeparationM?.toFixed(1) ?? 'N/A'}m), applying ${damageApplied.toFixed(1)} damage, but the target survived the fragment blast.`
    );
  } else if (outcome === 'unresolved_sortie_ended') {
    parts.push('Sortie was aborted or concluded while the missile was in mid-trajectory; engagement outcome is unresolved.');
  } else if (outcome === 'ground_impact') {
    parts.push('Missile impacted terrain or surface before reaching proximity threshold.');
  } else if (outcome === 'expired') {
    parts.push('Missile kinematic energy and rocket motor duration were exhausted before reaching intercept.');
  } else {
    parts.push(termReason);
  }

  return parts.join(' ');
}
