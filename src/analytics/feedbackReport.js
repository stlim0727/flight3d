import { createSortie } from '../replay/ReplayStore.js';

const finite = value => Number.isFinite(value) ? value : null;
const vector = value => value ? ['x', 'y', 'z'].map(axis => finite(value[axis])) : null;
const sample = value => value ? Object.fromEntries(['timeSec', 'x', 'z', 'altitudeFt', 'iasKnots',
  'gForce', 'pitchDeg', 'rollDeg', 'headingDeg'].map(key => [key, finite(value[key])])) : null;
const byteLength = text => new TextEncoder().encode(text).length;

/** One ingestion event must stay well below the analytics payload limit. */
export const FLIGHT_LOG_BUDGET_BYTES = 400_000;
export const FULL_REPORT_BUDGET_BYTES = 400_000;
const LOG_UNITS = { time: 's', x: 'm', z: 'm', altitude: 'ft MSL', airspeed: 'kt IAS', attitude: 'deg',
  gForce: 'g (simulator measured load)', sinkRate: 'ft/min positive down',
  impactSpeed: 'kt (world velocity magnitude at collision)' };
const LOG_COORDINATES = 'Three.js world: +Y up; x/z horizontal; altitudeFt = world Y / 0.3048';
const touchdown = value => ({ timeSec: finite(value?.timeSec), sinkRateFpm: finite(value?.sinkRateFpm),
  contactG: finite(value?.contactG) });

/**
 * The sortie's own flight log, attached to a report so the anomaly can be replayed
 * offline. It is bounded by `budgetBytes`; decimation always keeps the peak-G window
 * and the final sample, and describes what it dropped in `sampling`.
 */
export function buildFlightLog(sim, { budgetBytes = FLIGHT_LOG_BUDGET_BYTES } = {}) {
  const recorder = sim?.flightRecorder;
  const held = !recorder?.active ? sim?.debriefReport : null;
  const source = held ?? recorder;
  if (!source) return null;
  const samples = Array.isArray(source.samples) ? source.samples.map(sample) : [];
  const elapsed = finite(held?.durationSec ?? recorder?.elapsed);
  const interval = finite(recorder?.active ? recorder.interval : null)
    ?? (samples.length > 1 ? finite(samples[1].timeSec - samples[0].timeSec) : null);
  const log = {
    version: 1,
    source: held ? 'held-sortie' : 'live-sortie',
    capturedAtSec: elapsed,
    metadata: { ...(held?.metadata ?? recorder?.metadata ?? {}) },
    reason: held?.reason ?? null,
    durationSec: finite(held?.durationSec ?? recorder?.elapsed),
    peaks: Object.fromEntries(Object.entries(source.peaks ?? {}).map(([key, value]) => [key, sample(value)])),
    touchdowns: (source.touchdowns ?? []).map(touchdown),
    glocIncidents: finite(source.glocIncidents) ?? 0,
    crash: held?.crash ?? (sim?.isCrashed && sim.crashResult ? {
      type: sim.crashResult.type ?? null, name: sim.crashResult.name ?? null,
      description: sim.crashResult.description ?? null,
    } : null),
    sufficient: held?.sufficient ?? null,
    units: held?.units ?? LOG_UNITS,
    coordinates: held?.coordinates ?? LOG_COORDINATES,
    samples,
    sampling: { intervalSec: interval, originalCount: samples.length,
      retainedCount: samples.length, stride: 1, decimated: false },
  };
  return boundFlightLog(log, budgetBytes);
}

function boundFlightLog(log, budgetBytes) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0 || byteLength(JSON.stringify(log)) <= budgetBytes) return log;
  const samples = log.samples;
  if (samples.length < 3) return log;
  const overhead = byteLength(JSON.stringify({ ...log, samples: [] }));
  const costPerSample = Math.max(1, (byteLength(JSON.stringify(samples)) - 2) / Math.max(1, samples.length));
  const capacity = Math.max(2, Math.floor((budgetBytes - overhead) / costPerSample));
  const stride = Math.max(1, Math.ceil(samples.length / capacity));
  let peakIndex = -1;
  samples.forEach((entry, index) => {
    if (Number.isFinite(entry.gForce) && (peakIndex < 0 || entry.gForce > samples[peakIndex].gForce)) peakIndex = index;
  });
  // The peak and the final sample are never thinned away, even when the window
  // around the peak has to shrink to make room for the rest of the trace.
  const protectedIndices = new Set(peakIndex >= 0 ? [peakIndex, samples.length - 1] : [samples.length - 1]);
  const select = radius => {
    const keep = new Set();
    for (let index = 0; index < samples.length; index += stride) keep.add(index);
    keep.add(samples.length - 1);
    if (peakIndex >= 0) {
      for (let index = Math.max(0, peakIndex - radius); index <= Math.min(samples.length - 1, peakIndex + radius); index += 1) keep.add(index);
    }
    return [...keep].sort((a, b) => a - b);
  };
  let radius = 10;
  let indices = select(radius);
  const bounded = () => ({ ...log, samples: indices.map(index => samples[index]),
    sampling: { ...log.sampling, retainedCount: indices.length,
      stride: Math.max(1, Math.round(samples.length / Math.max(1, indices.length))), decimated: true } });
  let result = bounded();
  while (byteLength(JSON.stringify(result)) > budgetBytes) {
    if (radius > 0) {
      radius = radius > 2 ? Math.floor(radius / 2) : radius - 1;
      indices = select(radius);
    } else {
      const next = indices.filter((index, position) => protectedIndices.has(index)
        || position % 2 === 0 || position === indices.length - 1);
      if (next.length === indices.length) break;
      indices = next;
    }
    result = bounded();
  }
  return result;
}

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
    diagnosticsVersion: 2,
    flightLog: buildFlightLog(sim),
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

/**
 * Optional full sortie report (`flight3d.sortie.v1`) captured on user opt-in.
 * Returns null when no flight report or recorder data is available.
 */
export function gatherFeedbackFullReport(sim, { budgetBytes = FULL_REPORT_BUDGET_BYTES } = {}) {
  if (!sim) return null;
  const recorder = sim.flightRecorder;
  const held = !recorder?.active ? sim.debriefReport : null;
  if (!held && !recorder) return null;
  const rawReport = held ?? {
    version: 1,
    source: 'live-sortie',
    metadata: { ...(recorder.metadata ?? {}) },
    durationSec: finite(recorder.elapsed),
    peaks: recorder.peaks ?? {},
    touchdowns: Array.isArray(recorder.touchdowns) ? [...recorder.touchdowns] : [],
    glocIncidents: finite(recorder.glocIncidents) ?? 0,
    crash: sim.isCrashed && sim.crashResult ? {
      type: sim.crashResult.type ?? null,
      name: sim.crashResult.name ?? null,
      description: sim.crashResult.description ?? null,
    } : null,
    samples: Array.isArray(recorder.samples) ? [...recorder.samples] : [],
  };
  let sortie = JSON.parse(JSON.stringify(createSortie(rawReport, held ? (sim.debriefReplay ?? null) : null)));
  if (Number.isFinite(budgetBytes) && budgetBytes > 0) {
    sortie = boundFullReport(sortie, budgetBytes);
  }
  return sortie;
}

function boundFullReport(sortie, budgetBytes) {
  if (byteLength(JSON.stringify(sortie)) <= budgetBytes) return sortie;
  if (sortie.track) {
    sortie = { ...sortie, track: null, trackOmittedForBudget: true };
    if (byteLength(JSON.stringify(sortie)) <= budgetBytes) return sortie;
  }
  if (Array.isArray(sortie.report?.samples) && sortie.report.samples.length > 0) {
    let samples = sortie.report.samples;
    let peakIndex = -1;
    samples.forEach((entry, index) => {
      if (Number.isFinite(entry?.gForce) && (peakIndex < 0 || entry.gForce > samples[peakIndex].gForce)) peakIndex = index;
    });
    const peakTime = peakIndex >= 0 ? samples[peakIndex].timeSec : null;
    while (samples.length > 0 && byteLength(JSON.stringify(sortie)) > budgetBytes) {
      const next = samples.length <= 2
        ? []
        : samples.filter((entry, index) =>
          index === 0 || index === samples.length - 1 || index % 2 === 0
          || (peakTime !== null && entry?.timeSec === peakTime));
      samples = next.length === samples.length ? samples.slice(0, Math.floor(samples.length / 2)) : next;
      sortie = {
        ...sortie,
        report: {
          ...sortie.report,
          samples,
          samplesDecimatedForBudget: true,
        },
      };
    }
  }
  if (byteLength(JSON.stringify(sortie)) > budgetBytes && sortie.report) {
    sortie = {
      ...sortie,
      report: {
        label: sortie.report.label ?? null,
        reason: sortie.report.reason ?? null,
        durationSec: sortie.report.durationSec ?? null,
        metadata: sortie.report.metadata ?? null,
        truncatedForBudget: true,
      },
    };
  }
  return sortie;
}

export function createFeedbackReport({ message, contact = '', category = 'bug', severity = 'major',
  expected = '', steps = '', context = {}, fullReport = null, screenshot = null }) {
  const reportId = globalThis.crypto.randomUUID();
  const attachments = {};
  if (fullReport && typeof fullReport === 'object') attachments.fullReport = fullReport;
  if (typeof screenshot === 'string' && screenshot.startsWith('data:image/')) attachments.screenshot = screenshot;
  return {
    reportId, createdAt: new Date().toISOString(),
    properties: JSON.parse(JSON.stringify({ ...context, ...attachments, app: 'flight3d',
      buildCommit: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.revision : 'dev',
      buildVersion: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.version : 'dev',
      feedback_message: message.trim(), feedback_contact: contact.trim(), feedback_category: category,
      feedback_severity: severity, feedback_expected: expected.trim(), feedback_steps: steps.trim(),
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
  const unconfirmed = '서버 수신을 확인하지 못했습니다.';
  const saveDraft = '신고 파일 저장으로 작성한 내용과 첨부를 보관할 수 있습니다.';
  let failure = '제보 서버에 연결할 수 없습니다. 네트워크 또는 브라우저의 요청 차단 설정을 확인해 주세요.';
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
      if (response.type === 'opaque') throw new Error('opaque response');
      if (!response.ok) {
        failure = `제보 서버가 요청을 거절했습니다 (HTTP ${response.status}).`;
        throw new Error('rejected');
      }
      failure = '제보 서버가 확인 가능한 수신 응답을 보내지 않았습니다.';
      const body = (await response.text()).trim();
      let acknowledgement;
      try { acknowledgement = JSON.parse(body); } catch { throw new Error('invalid acknowledgement'); }
      if (acknowledgement !== 1 && acknowledgement?.status !== 1 && acknowledgement?.status !== 'Ok') throw new Error('not acknowledged');
      return { reportId: report.reportId, accepted: true };
    })();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        failure = '제보 서버 응답 시간이 초과되었습니다.';
        reject(new Error('timeout'));
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([request, deadline]);
  } catch {
    throw new Error(`${unconfirmed} ${failure} ${saveDraft}`);
  } finally { clearTimeout(timer); }
}
