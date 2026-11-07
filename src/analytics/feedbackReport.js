const finite = value => Number.isFinite(value) ? value : null;
const vector = value => value ? ['x', 'y', 'z'].map(axis => finite(value[axis])) : null;
const sample = value => value ? Object.fromEntries(['timeSec', 'x', 'z', 'altitudeFt', 'iasKnots',
  'gForce', 'pitchDeg', 'rollDeg', 'headingDeg'].map(key => [key, finite(value[key])])) : null;

/** A bounded snapshot of the sortie being reported, including the exact recorded peak. */
export function gatherFeedbackDiagnostics(sim) {
  if (!sim) return {};
  const recorder = sim.flightRecorder;
  const held = !recorder?.active ? sim.debriefReport : null;
  const source = held ?? recorder;
  const telemetry = sim.telemetry ?? {};
  const samples = source?.samples ?? [];
  const peak = source?.peaks?.gForce;
  const peakIndex = samples.findIndex(value => value.timeSec >= peak?.timeSec);
  const pick = keys => Object.fromEntries(keys.map(key => [key, finite(telemetry[key])]));
  const diagnostics = {
    diagnosticsVersion: 1,
    aircraft: held?.metadata?.aircraft ?? sim.currentAircraftId ?? null,
    airport: held?.metadata?.airport ?? sim.activeAirport ?? null,
    scenario: held?.metadata?.scenario ?? sim.lastPresetType ?? null,
    flightDurationSec: finite(held?.durationSec ?? recorder?.elapsed),
    gForce: finite(telemetry.gForce),
    peakG: finite(peak?.gForce),
    peakGTimeSec: finite(peak?.timeSec),
    gMeasurement: 'CG body-normal specific force; unfiltered physics-step average; g',
    peakSample: sample(peak),
    recentSamples: samples.slice(-30).map(sample),
    peakSamples: peakIndex >= 0 ? samples.slice(Math.max(0, peakIndex - 10), peakIndex + 11).map(sample) : [],
    touchdowns: (source?.touchdowns ?? []).slice(-10).map(value => ({
      timeSec: finite(value.timeSec), sinkRateFpm: finite(value.sinkRateFpm), contactG: finite(value.contactG),
    })),
    isCrashed: Boolean(sim.isCrashed || held?.reason === 'crash'),
    crash: held?.crash ?? (sim.crashResult ? {
      type: sim.crashResult.type, name: sim.crashResult.name, description: sim.crashResult.description,
    } : null),
    telemetry: { ...pick(['iasKnots', 'tasKnots', 'groundSpeedKnots', 'vsiFpm', 'radioAltFt',
      'altitudeFt', 'pitchDeg', 'rollDeg', 'headingDeg', 'gForce', 'touchdownSinkRate', 'gearState',
      'flapDegree', 'spoilers', 'throttle', 'massKg', 'groundRoughness']),
    onGround: Boolean(telemetry.onGround), gearDamage: telemetry.gearDamage ?? null,
    bodyDamage: telemetry.bodyDamage ?? null, bodyContacts: telemetry.bodyContacts ?? [] },
    positionM: vector(sim.position), velocityMps: vector(sim.linearVelocity),
    angularVelocityRadps: vector(sim.angularVelocity),
    gearFailure: sim.gear?.failure ?? null,
    gearContacts: (sim.gear?.contacts ?? []).map(contact => ({ id: contact.id,
      state: contact.damageState, damage: finite(contact.damage),
      sinkRateMps: finite(contact.sinkRateMs), compressionM: finite(contact.compression) })),
  };
  return JSON.parse(JSON.stringify(diagnostics));
}

export function createFeedbackReport({ message, contact = '', category = 'bug', context = {} }) {
  const reportId = globalThis.crypto.randomUUID();
  return {
    reportId, createdAt: new Date().toISOString(),
    properties: JSON.parse(JSON.stringify({ ...context, app: 'flight3d',
      buildCommit: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.revision : 'dev',
      buildVersion: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.version : 'dev',
      feedback_message: message.trim(), feedback_contact: contact.trim(), feedback_category: category,
      reportId, clientTimeMs: Date.now() })),
  };
}

/** Explicit reports do not depend on the analytics SDK, its queue, or its opt-out state.
 * Only a readable ingestion acknowledgement counts as acceptance (not a beacon,
 * opaque response, capture() return value, or a queued SDK event).
 */
export async function deliverFeedbackReport(report, { apiKey, host, distinctId, fetchImpl = globalThis.fetch,
  timeoutMs = 12000 }) {
  if (!apiKey || !host) throw new Error('신고 전송 설정이 없습니다. 신고 파일을 저장해 주세요.');
  const controller = new AbortController();
  let timer;
  try {
    const request = (async () => {
      const response = await fetchImpl(`${host.replace(/\/$/, '')}/i/v0/e/`, {
        method: 'POST', mode: 'cors', credentials: 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ api_key: apiKey, uuid: report.reportId,
          distinct_id: distinctId, event: 'user_feedback_submitted', timestamp: report.createdAt,
          properties: report.properties }),
      });
      if (!response.ok || response.type === 'opaque') throw new Error('rejected');
      const body = (await response.text()).trim();
      let acknowledgement;
      try { acknowledgement = JSON.parse(body); } catch { throw new Error('invalid acknowledgement'); }
      if (acknowledgement !== 1 && acknowledgement?.status !== 1 && acknowledgement?.status !== 'Ok') throw new Error('not acknowledged');
      return { reportId: report.reportId, accepted: true };
    })();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    return await Promise.race([request, deadline]);
  } catch {
    throw new Error('서버 수신을 확인하지 못했습니다. Brave Shields·네트워크 설정을 확인한 뒤 다시 시도하거나 신고 파일을 저장해 주세요.');
  } finally { clearTimeout(timer); }
}
