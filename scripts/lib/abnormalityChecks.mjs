/**
 * @file Abnormality checks for the cinematic demo fast-play sweep.
 *
 * Pure functions over sampled flight state: no DOM, no CDP, no browser, so the
 * rules themselves are covered by `tests/demoSweepChecks.test.js` and cannot rot
 * unnoticed. Thresholds come from the simulator's own numbers, not invented
 * constants:
 *   - `src/physics/gearDamage.js`  → touchdown impact limits per leg
 *   - `src/systems/FlightWarnings.js` → Vne / Mach ceilings per aircraft
 *   - each route's own declaration (`maxRollDeg`, `rolloutDevices`, `clearanceIntentM`,
 *     `allowedWarnings`) → what that airframe and that choreography promise
 *   - each scenario's declared intent (`result`, docs/development/aircraft-demos.md)
 *
 * The repo models no structural load limit (`telemetry.gForce` is a bare accelerometer
 * reading, src/main.js:1585), so peak G is a measured baseline peak with only a
 * collapse bound below it; the airframe ceilings that do exist are Vne and Mach.
 *
 * Two tiers, mirroring how the checks are meant to be used:
 *   FAIL   a physical or contractual fact: crashed, non-finite, stalled, gear
 *          damaged, stuck, wrong stage order, bad control handoff, flown below the
 *          route's own clearance intent, beyond Vne/Mach, or rolled past its promise.
 *   REPORT a measured peak that drifted from `scripts/demo-sweep-baseline.json`.
 *          Cinematic routes are allowed to bank hard and call warnings; those are
 *          trends to review, and `STRICT=1` promotes them into failures.
 *
 * A sample is one slice of simulated flight, assembled by scripts/demo-sweep.mjs:
 *   { simTime, active, stage, stageTransitions[], aircraft, finite, crashed, crashType,
 *     crashDescription, iasKnots, mach, altitudeFt, radioAltFt, pitchDeg, rollDeg,
 *     headingDeg, gForce, vsiFpm, angularRates[], onGround, groundSpeedMs, position[], aglM,
 *     onRunway, inSafetyArea, stalled, landingIncident, gearStates[], gearDamageMax,
 *     bodyContacts[], touchdowns[{id,sink}], warningIds[], spoilers, reverser,
 *     brakes, throttle, controlsDisabled, virtualInputs{}, result{} }
 *
 * `stageTransitions` is the slice's `setStage` history; it is required evidence for the
 * closing stage because `stop()` resets the director to IDLE before the next snapshot.
 */
import { GEAR_DAMAGE_LIMITS } from '../../src/physics/gearDamage.js';
import { PROFILES as WARNING_PROFILES } from '../../src/systems/FlightWarnings.js';
import { SCENARIO_STAGES } from './demoSweepSpec.mjs';

/** Nothing flies at 20 g: a sample that large is the solver collapsing, not a manoeuvre. */
export const SOLVER_G_LIMIT = 20;
/** Unless a route declares a roll in its choreography, no demo passes through vertical. */
export const MAX_ROLL_DEG = 90;
/** Ground truth for "actually stopped", matching the rollout stages' own 0.5 m/s test. */
export const STOPPED_SPEED_MS = 0.5;
/** Divergence indicator rather than flying. */
export const MAX_ANGULAR_RATE_RAD_S = 3.0;
/** A bank or heading rate no choreographed route produces. */
export const MAX_SMOOTHED_RATE_DEG_PER_S = 120;

/**
 * `telemetry.vsiFpm` is signed like a real vertical speed indicator: positive is a
 * climb (`src/systems/FlightWarnings.js:66` takes the sink as `-vsi`, and main.js
 * labels `> 300` as CLB). Naming the number by its sign instead of assuming a
 * descent matters, because the two readings imply opposite faults: a route losing
 * clearance while climbing is flying into rising ground, not falling out of the sky.
 */
export function vsiText(vsiFpm) {
  const value = Math.abs(Math.round(vsiFpm));
  return vsiFpm < 0 ? `sink ${value} fpm` : `climb ${value} fpm`;
}

/** `FlightControls.setVirtualInput` names, i.e. what `clearVirtualInputs()` releases.
 *  The throttle lever and the wheel brakes a parked handoff must hold are not in this set. */
const VIRTUAL_AXES = ['elevator', 'aileron', 'rudder', 'brakes'];

const push = (list, entry) => { if (!list.includes(entry)) list.push(entry); };

/** A missing instrument reading must not turn an abnormality report into a crash. */
const round = value => (Number.isFinite(value) ? Math.round(value).toString() : 'n/a');

export function createState(route, { sliceSeconds }) {
  const stages = SCENARIO_STAGES[route.scenario];
  // The route's own names are authoritative: a scenario table can alias one number
  // to several names (Lukla's HIMALAYAN_CRUISE, VALLEY_TURNAROUND, CANYON_CIRCUIT)
  // and a generic alias would report a flown stage as never flown.
  const namesByStage = {};
  for (const name of route.stages) namesByStage[stages[name]] = name;
  return {
    route,
    sliceSeconds,
    namesByStage,
    idleStage: stages.IDLE ?? -1,
    visitedStages: [],
    stageTrace: [],
    seenStages: new Set(),
    unexpectedStages: new Set(),
    fails: [],
    reports: [],
    knownIssues: [],
    terminal: null,
    samples: 0,
    touchdowns: [],
    warningSeconds: {},
    measures: {
      maxRollDeg: 0, maxIasKnots: 0, maxMach: 0, maxAbsG: 0, minAglM: Infinity,
      maxSinkFpm: 0, maxAngularRateRadS: 0, maxHeadingRateDegPerS: 0, maxBankRateDegPerS: 0,
      extremeGSamples: 0, stallSamples: 0, bodyContacts: 0, rolloutDevices: {},
      touchdownCount: 0,
    },
    last: null,
    explainedJump: false,
    firstInactiveSample: null,
  };
}

function stageName(state, sample) {
  return state.namesByStage[sample.stage] ?? null;
}

export function classifySample(sample, state) {
  const { route, sliceSeconds } = state;
  const name = stageName(state, sample);
  const stamp = `t=${(sample.simTime ?? 0).toFixed(1)}s ${name ?? `stage ${sample.stage}`}`;
  const fail = text => push(state.fails, `${stamp} ${text}`);
  state.samples++;

  if (sample.aircraft !== route.aircraft) fail(`AIRCRAFT SUBSTITUTED: ${route.aircraft} became ${sample.aircraft}`);
  if (sample.finite === false) {
    fail('NON-FINITE FLIGHT STATE (position, attitude, velocity or body damage)');
    state.terminal ??= 'non-finite';
    return;
  }
  if (sample.crashed) {
    fail(`CRASH ${sample.crashType ?? 'UNKNOWN'}: ${sample.crashDescription ?? 'no description'}`);
    state.terminal ??= 'crash';
    return;
  }
  if (!sample.active && !state.firstInactiveSample) state.firstInactiveSample = sample;

  // `stop()` resets the director to IDLE, so the final stage of a route is invisible in a
  // sampled snapshot. A driver that instruments `setStage` hands the transitions over
  // instead; without them the current stage is the best available evidence.
  const visited = sample.stageTransitions ?? (sample.active ? [sample.stage] : []);
  for (const stage of visited) {
    if (stage === state.idleStage) continue;
    const visitedName = state.namesByStage[stage];
    if (!visitedName) state.unexpectedStages.add(String(stage));
    else if (!state.seenStages.has(stage)) {
      state.seenStages.add(stage);
      state.visitedStages.push(visitedName);
    }
    // The trace keeps revisits that the deduplicated visit list cannot see: a route that
    // falls back a stage is abnormal even though every stage was still "flown".
    if (state.stageTrace.at(-1)?.stage !== stage) {
      state.stageTrace.push({ stage, name: visitedName ?? null, simTime: sample.simTime ?? 0 });
    }
  }

  // Pavement phases are contact by design: clearance, stall and warning rules
  // apply in the air, and the handoff rules below judge the pavement separately.
  const onPavement = sample.onGround || (name && route.groundStages.includes(name));

  if (sample.stalled) {
    state.measures.stallSamples++;
    if (!route.expectedStall && !onPavement) {
      fail(`STALL at ${round(sample.iasKnots)} kt (pitch ${round(sample.pitchDeg)}°, `
        + `agl ${round(sample.aglM)} m, ${vsiText(sample.vsiFpm)})`);
    }
  }

  for (const [index, legState] of (sample.gearStates ?? []).entries()) {
    if (legState !== 'normal') fail(`GEAR LEG ${index} DAMAGE STATE "${legState}"`);
  }
  if ((sample.gearDamageMax ?? 0) > 0) fail(`GEAR DAMAGE ACCUMULATED: ${sample.gearDamageMax.toFixed(3)}`);
  if (sample.landingIncident) fail('LANDING INCIDENT (airframe contact or damage event)');
  const bodyContacts = (sample.bodyContacts ?? []).length;
  state.measures.bodyContacts = Math.max(state.measures.bodyContacts, bodyContacts);
  if (bodyContacts > 0 && !onPavement) fail(`AIRFRAME BODY CONTACT WHILE AIRBORNE (${bodyContacts} part(s))`);

  for (const contact of sample.touchdowns ?? []) {
    state.measures.touchdownCount++;
    state.touchdowns.push(contact);
    const limit = (LEG_IMPACT(contact.id)).impact;
    if (contact.sink > limit) {
      fail(`HARD TOUCHDOWN ${contact.id} sink ${contact.sink} m/s > ${limit} m/s model limit`);
    }
  }

  if (!onPavement && Number.isFinite(sample.aglM)) {
    state.measures.minAglM = Math.min(state.measures.minAglM, sample.aglM);
    if (sample.aglM < 0) fail('FLIGHT BELOW THE GROUND PLANE');
    else if (sample.aglM < (route.clearanceIntentM ?? 0)) {
      fail(`CLEARANCE ${sample.aglM.toFixed(1)} m below the route's declared ${route.clearanceIntentM} m intent `
        + `(${vsiText(sample.vsiFpm)}, ${round(sample.iasKnots)} kt)`);
    }
  }

  const profile = WARNING_PROFILES[route.aircraft] ?? WARNING_PROFILES.B738;
  if (profile.vne && sample.iasKnots > profile.vne) fail(`OVERSPEED ${Math.round(sample.iasKnots)} kt > Vne ${profile.vne} kt`);
  if (profile.mach && (sample.mach ?? 0) > profile.mach) fail(`MACH ${sample.mach.toFixed(3)} > limit ${profile.mach}`);
  if (Math.abs(sample.rollDeg) > (route.maxRollDeg ?? MAX_ROLL_DEG)) {
    fail(`ROLL PAST ${route.maxRollDeg ?? MAX_ROLL_DEG}°: ${sample.rollDeg.toFixed(1)}°`);
  }
  if (Math.abs(sample.gForce) > SOLVER_G_LIMIT) {
    state.measures.extremeGSamples++;
    fail(`LOAD FACTOR ${sample.gForce.toFixed(1)} g — beyond any manoeuvre, so a physics collapse`);
  }
  const angularRate = Math.max(0, ...(sample.angularRates ?? []).map(rate => Math.abs(rate ?? 0)));
  if (angularRate > MAX_ANGULAR_RATE_RAD_S) fail(`ANGULAR RATE ${angularRate.toFixed(2)} rad/s (roll ${sample.rollDeg.toFixed(0)}°)`);

  const m = state.measures;
  m.maxRollDeg = Math.max(m.maxRollDeg, Math.abs(sample.rollDeg));
  m.maxIasKnots = Math.max(m.maxIasKnots, sample.iasKnots);
  m.maxMach = Math.max(m.maxMach, sample.mach ?? 0);
  m.maxAbsG = Math.max(m.maxAbsG, Math.abs(sample.gForce));
  m.maxSinkFpm = Math.max(m.maxSinkFpm, sample.vsiFpm < 0 ? -sample.vsiFpm : 0);
  m.maxAngularRateRadS = Math.max(m.maxAngularRateRadS, angularRate);
  for (const device of route.rolloutDevices ?? []) {
    // A rollout device only counts when the airframe is actually on the pavement.
    if (sample.onGround && (sample[device] ?? 0) > 0.5) m.rolloutDevices[device] = true;
  }

  // Choreography teleports: a stage entry may reposition the aircraft with `setPreset`,
  // and the jump shows up as an impossible displacement one slice later. Rate-of-change
  // is only meaningful between two samples of continuous flight.
  const travelled = state.last?.position && sample.position
    ? Math.hypot(sample.position[0] - state.last.position[0], sample.position[1] - state.last.position[1],
      sample.position[2] - state.last.position[2])
    : 0;
  const reachable = Math.max(50, (sample.groundSpeedMs ?? 0) * sliceSeconds * 4);
  const jumped = travelled > reachable;
  const repositioned = Boolean(sample.stageTransitions?.length);
  // The displacement and the refreshed attitude from a preset land on different slices:
  // a stage entry teleports the aircraft while heading still reads the pre-jump value,
  // so the gap shows up as a impossible rate one slice later. Neither slice is
  // continuous flight, and only a jump no stage entry explains is worth reporting.
  const teleport = repositioned || jumped || state.explainedJump;
  if (jumped && !repositioned && !state.explainedJump) {
    push(state.reports, `${stamp} POSITION JUMPED ${travelled.toFixed(0)} m in ${sliceSeconds} s with no stage entry to explain it`);
  }
  state.explainedJump = repositioned || jumped;
  const continuous = state.last && sample.active && !teleport && sample.stage === state.last.stage;
  if (continuous) {
    const headingRate = Math.abs(((sample.headingDeg - state.last.headingDeg + 540) % 360) - 180) / sliceSeconds;
    // Bank is signed and wraps too: a full roll crosses 180° into -180°, which is 10°/slice
    // of choreography, not the 350° discontinuity an unwrapped difference would report.
    const bankRate = Math.abs(((sample.rollDeg - state.last.rollDeg + 540) % 360) - 180) / sliceSeconds;
    m.maxHeadingRateDegPerS = Math.max(m.maxHeadingRateDegPerS, headingRate);
    m.maxBankRateDegPerS = Math.max(m.maxBankRateDegPerS, bankRate);
    if (headingRate > MAX_SMOOTHED_RATE_DEG_PER_S) push(state.reports, `${stamp} HEADING RATE SPIKE ${headingRate.toFixed(0)} °/s inside one stage`);
    if (bankRate > MAX_SMOOTHED_RATE_DEG_PER_S) push(state.reports, `${stamp} BANK RATE SPIKE ${bankRate.toFixed(0)} °/s inside one stage`);
  }

  for (const id of sample.warningIds ?? []) {
    state.warningSeconds[id] = (state.warningSeconds[id] ?? 0) + sliceSeconds;
  }
  state.last = sample;
}

function LEG_IMPACT(legId) {
  return legId === 'nose' ? GEAR_DAMAGE_LIMITS.nose : GEAR_DAMAGE_LIMITS.main;
}

/** Everything that can only be judged once the route has ended. */
export function finalizeRoute(state, { baseline = {}, strict = false } = {}) {
  const { route } = state;
  const last = state.firstInactiveSample ?? state.last;
  const finished = Boolean(last && !last.active);

  if (state.terminal) {
    absorbKnownIssues(state);
    return result(state, { finished: false });
  }

  if (!finished) {
    push(state.fails, `STUCK: still active after ${(last?.simTime ?? 0).toFixed(1)} s of simulated time `
      + `(ceiling ${route.budgetSimSeconds} s, last stage ${last?.stage})`);
  } else {
    judgeHandoff(state, last);
  }

  if (state.unexpectedStages.size) {
    push(state.fails, `UNRECOGNISED STAGES VISITED: ${[...state.unexpectedStages].join(', ')}`);
  }
  const missing = route.stages.filter(name => !state.visitedStages.includes(name));
  if (missing.length) push(state.fails, `STAGES NOT FLOWN: ${missing.join(', ')}`);
  const trace = state.stageTrace.filter(entry => entry.name);
  const indices = trace.map(entry => route.stages.indexOf(entry.name));
  const backward = indices.findIndex((index, i) => i > 0 && index < indices[i - 1]);
  if (backward > 0) {
    push(state.fails, `STAGE ORDER REVERSED: ${trace.map(entry => entry.name).join(' → ')} `
      + `(re-entered ${trace[backward].name} at t=${trace[backward].simTime.toFixed(1)}s after ${trace[backward - 1].name})`);
  }

  absorbKnownIssues(state);
  applyBaseline(state, baseline, strict);
  return result(state, { finished });
}

/**
 * A route can declare the faults it is already known to produce, so a documented
 * app regression does not turn every PR on an unrelated file red while still
 * refusing anything new. A declaration absorbs *every* fault carrying its tokens
 * (one crash writes several lines), and an entry that matched nothing is a REPORT
 * — a failure under `--strict` — asking to be deleted, unless it is declared
 * `intermittent`: a fault that only appears on some page loads cannot be proven
 * absent by a single clean flight, so demanding it reproduce would just be noise.
 */
function absorbKnownIssues(state) {
  const declared = state.route.knownIssues ?? [];
  if (!declared.length) return;
  const hits = declared.map(() => 0);
  for (const text of [...state.fails]) {
    const index = declared.findIndex(entry => entry.contains.every(token => text.includes(token)));
    if (index < 0) continue;
    hits[index] += 1;
    state.fails.splice(state.fails.indexOf(text), 1);
    push(state.knownIssues, `${text} (known: ${declared[index].note})`);
  }
  declared.forEach((entry, i) => {
    if (hits[i] || entry.intermittent) return;
    push(state.reports, `KNOWN ISSUE "${entry.contains.join(' + ')}" did not reproduce — remove it from the route table`);
  });
}

function judgeHandoff(state, last) {
  const { route, measures } = state;
  const fail = text => push(state.fails, `HANDOFF ${text}`);

  if (!last.result || typeof last.result !== 'object' || !last.result.status) {
    fail('has no scenario result, so completion intent cannot be asserted');
  } else if (last.result.status !== 'completed') {
    fail(`reported "${last.result.status}"${last.result.reason ? `: ${last.result.reason}` : ''}`);
  }
  if (last.controlsDisabled) fail('left the flight controls disabled');
  const left = VIRTUAL_AXES.filter(axis => last.virtualInputs?.[axis] !== undefined
    && last.virtualInputs?.[axis] !== null);
  if (left.length) fail(`left virtual pilot inputs set: ${left.join(', ')}`);

  if (route.handoff === 'airborne') {
    if (!(last.throttle > 0)) fail(`handed back with ${last.throttle} thrust at ${Math.round(last.aglM ?? 0)} m agl (dead stick)`);
    if (last.onGround) fail('on an airborne route that ended on the ground');
    if (measures.bodyContacts > 0) fail('after an airborne route touched the airframe on something');
  }
  if (route.handoff === 'parked') {
    if (!last.onGround) fail(`airborne at ${Math.round(last.aglM ?? 0)} m agl, ${Math.round(last.iasKnots)} kt`);
    if (last.groundSpeedMs > STOPPED_SPEED_MS) fail(`still rolling at ${last.groundSpeedMs.toFixed(2)} m/s`);
    if (!(last.brakes >= 1)) fail(`wheel brakes not held (${last.brakes})`);
    if (last.onRunway === false && last.inSafetyArea === false) fail('came to rest off the runway and its safety area');
  }
  if (route.lands) {
    if (measures.touchdownCount === 0) fail('a landing route recorded no wheel touchdown');
    for (const device of route.rolloutDevices ?? []) {
      if (!measures.rolloutDevices[device]) fail(`a rollout with ${device} never deployed it`);
    }
  }
  if (route.expectStagesCompleted !== undefined && last.result?.stagesCompleted !== route.expectStagesCompleted) {
    fail(`flew ${last.result?.stagesCompleted ?? 0} of ${route.expectStagesCompleted} scenes`);
  }
  if (route.expectLandmarks !== undefined && (last.result?.landmarks?.length ?? 0) < route.expectLandmarks) {
    fail(`tour passed ${last.result?.landmarks?.length ?? 0} of ${route.expectLandmarks} landmarks`);
  }
}

function applyBaseline(state, baseline, strict) {
  const entry = baseline[state.route.id];
  if (!entry) {
    push(state.reports, 'NO BASELINE for this route (run `node scripts/demo-sweep.mjs --update-baseline`)');
  } else {
    const m = state.measures;
    const above = (label, actual, limit, unit) => {
      if (limit !== undefined && Number.isFinite(actual) && actual > limit) {
        push(state.reports, `${label} ${actual.toFixed(1)}${unit} exceeds baseline ${limit}${unit}`);
      }
    };
    above('peak bank', m.maxRollDeg, entry.maxRollDeg, '°');
    above('peak IAS', m.maxIasKnots, entry.maxIasKnots, ' kt');
    above('peak sink', m.maxSinkFpm, entry.maxSinkFpm, ' fpm');
    above('peak angular rate', m.maxAngularRateRadS, entry.maxAngularRateRadS, ' rad/s');
    above('heading rate', m.maxHeadingRateDegPerS, entry.maxHeadingRateDegPerS, ' °/s');
    above('bank rate', m.maxBankRateDegPerS, entry.maxBankRateDegPerS, ' °/s');
    above('peak |g|', m.maxAbsG, entry.maxAbsG, ' g');
    if (entry.minAglM !== undefined && Number.isFinite(m.minAglM) && m.minAglM < entry.minAglM) {
      push(state.reports, `minimum clearance ${m.minAglM.toFixed(1)} m below baseline ${entry.minAglM} m`);
    }
    const elapsed = state.last?.result?.elapsedSeconds;
    if (entry.elapsedSeconds && Number.isFinite(elapsed)) {
      const drift = Math.abs(elapsed - entry.elapsedSeconds) / entry.elapsedSeconds;
      if (drift > 0.15) push(state.reports, `elapsed ${elapsed.toFixed(0)} s drifted ${(drift * 100).toFixed(0)}% from baseline ${entry.elapsedSeconds} s`);
    }
    for (const [id, seconds] of Object.entries(entry.warningSeconds ?? {})) {
      if (!(state.warningSeconds[id] > 0)) push(state.reports, `baseline warning "${id}" did not appear this run`);
    }
  }

  for (const [id, seconds] of Object.entries(state.warningSeconds)) {
    if (!state.route.allowedWarnings.includes(id)) {
      push(state.reports, `WARNING "${id}" is not part of this route's intent (${seconds.toFixed(1)} s active)`);
    } else {
      const limit = state.firstInactiveSample ? baseline[state.route.id]?.warningSeconds?.[id] : undefined;
      if (limit !== undefined && seconds > limit * 1.5 + 1) {
        push(state.reports, `WARNING "${id}" ran ${seconds.toFixed(1)} s against a baseline of ${limit} s`);
      }
    }
  }

  if (strict && state.reports.length) {
    for (const text of state.reports) push(state.fails, `STRICT: ${text}`);
  }
}

function result(state, { finished }) {
  const measures = { ...state.measures };
  if (!Number.isFinite(measures.minAglM)) measures.minAglM = null;
  return {
    id: state.route.id,
    tier: state.route.tier,
    finished,
    fails: state.fails,
    reports: state.reports,
    knownIssues: state.knownIssues,
    visitedStages: [...new Set(state.visitedStages)],
    stageTrace: state.stageTrace.map(entry => entry.name ?? `stage ${entry.stage}`),
    warningSeconds: state.warningSeconds,
    touchdowns: state.touchdowns,
    measures,
    simSeconds: state.last?.simTime ?? 0,
    result: state.firstInactiveSample?.result ?? state.last?.result ?? null,
  };
}
