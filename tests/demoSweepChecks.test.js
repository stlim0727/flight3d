/**
 * @file Coverage for the demo sweep's abnormality rules.
 *
 * Every FAIL and REPORT branch in scripts/lib/abnormalityChecks.mjs is driven with
 * synthetic slices here, because the sweep's value is the opposite of a browser
 * harness's: a rule must fire on the fault and stay silent without it, and only a
 * synthetic sample can prove both halves in milliseconds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROUTES, SCENARIO_STAGES, AIRCRAFT_IDS, AIRPORT_IDS, declaredRouteIds, routeKey,
  routeById, resolveStages, routesForTier,
} from '../scripts/lib/demoSweepSpec.mjs';
import {
  createState, classifySample, finalizeRoute, SOLVER_G_LIMIT, MAX_ROLL_DEG, STOPPED_SPEED_MS,
  vsiText,
} from '../scripts/lib/abnormalityChecks.mjs';

const SLICE = 0.25;

/** The ids FlightWarnings.js can produce, so the route table cannot typo its way to silence. */
const KNOWN_WARNINGS = ['takeoff-config', 'stall', 'overspeed', 'bank', 'engine', 'pull-up',
  'sink-rate', 'terrain', 'gear', 'flaps', 'dont-sink'];

function sample(overrides = {}) {
  return {
    simTime: 0, active: true, stage: 0, aircraft: 'B738', finite: true, crashed: false,
    crashType: null, crashDescription: null,
    iasKnots: 150, mach: 0.30, altitudeFt: 2000, radioAltFt: 1600, pitchDeg: 3, rollDeg: 0,
    headingDeg: 90, gForce: 1.0, vsiFpm: 0, angularRates: [0, 0, 0], onGround: false,
    groundSpeedMs: 77, aglM: 400, onRunway: false, inSafetyArea: false,
    stalled: false, landingIncident: false,
    gearStates: ['normal', 'normal', 'normal'], gearDamageMax: 0, bodyContacts: [], touchdowns: [],
    warningIds: [], spoilers: 0, reverser: 0, brakes: 0, throttle: 0.7,
    controlsDisabled: true, virtualInputs: { elevator: 0.1, aileron: 0, rudder: 0, throttle: 0.7 },
    result: { status: 'running' },
    ...overrides,
  };
}

/** Fly a whole route from partial slices; each slice defaults to the route's opening stage.
 *  The driver instruments `setStage`, so the transition history is handed over per slice. */
function fly(route, partials, { baseline = {}, strict = false, viaTransitions = true } = {}) {
  const state = createState(route, { sliceSeconds: SLICE });
  const opening = SCENARIO_STAGES[route.scenario][route.stages[0]];
  let previous = null;
  partials.forEach((partial, index) => {
    const stage = partial.stage ?? opening;
    const row = { aircraft: route.aircraft, stage, simTime: (index + 1) * SLICE, ...partial };
    // Only a slice that *changes* stage carries a transition, as in the real driver.
    if (viaTransitions && !('stageTransitions' in partial)) {
      row.stageTransitions = stage === previous ? [] : [stage];
    }
    previous = stage;
    classifySample(sample(row), state);
  });
  return finalizeRoute(state, { baseline, strict });
}

/**
 * A route flown end to end, one slice per declared stage, ending in the handoff its
 * own declaration promises. Tests then break exactly one thing at a time.
 * `hold` repeats the penultimate stage, which is how a warning needs long enough to sound.
 */
function fullFlight(route, patch = {}, { hold = 0 } = {}) {
  const table = SCENARIO_STAGES[route.scenario];
  const parked = route.handoff === 'parked';
  const slices = route.stages.map((name, index) => {
    const last = index === route.stages.length - 1;
    const onGround = route.groundStages.includes(name) || (last && parked);
    const row = {
      stage: table[name], onGround, aglM: onGround ? 0 : 400,
      brakes: onGround && parked ? 1 : 0,
      groundSpeedMs: onGround ? 0 : 77,
      throttle: onGround && parked ? 0 : 0.7,
    };
    if (route.lands && onGround) {
      // A route that promises a landing must actually touch the pavement down.
      row.touchdowns = [{ id: 'mainLeft', sink: 1.6 }, { id: 'mainRight', sink: 1.6 }, { id: 'nose', sink: 0.9 }];
    }
    if (last) Object.assign(row, {
      active: false, controlsDisabled: false, onRunway: parked,
      virtualInputs: { elevator: null, aileron: null, rudder: null, throttle: null },
      throttle: parked ? 0 : 0.6,
      result: {
        status: 'completed', stagesCompleted: route.expectStagesCompleted,
        landmarks: ['a', 'b', 'c', 'd'],
      },
    });
    return { ...row, ...(typeof patch === 'function' ? patch(name) : patch) };
  });
  // Extra slices of the penultimate stage, so a warning can be active long enough to count.
  if (hold > 0) slices.splice(slices.length - 1, 0, ...Array.from({ length: hold }, () => ({ ...slices.at(-2) })));
  return slices;
}

const fails = (outcome, fragment) => assert.ok(
  outcome.fails.some(text => text.includes(fragment)),
  `expected a fail containing "${fragment}", got ${JSON.stringify(outcome.fails)}`);

const reports = (outcome, fragment) => assert.ok(
  outcome.reports.some(text => text.includes(fragment)),
  `expected a report containing "${fragment}", got ${JSON.stringify(outcome.reports)}`);

/** The route-level verdict is asserted separately; here only the rule under test matters. */
const silent = (outcome, fragment) => assert.ok(
  !outcome.fails.some(text => text.includes(fragment)),
  `expected no fail containing "${fragment}", got ${JSON.stringify(outcome.fails)}`);

const clean = outcome => assert.deepEqual(outcome.fails, [],
  `expected a clean route, got ${JSON.stringify(outcome.fails)}`);

/** A B737 coastal demo flown as it is meant to be flown: a soft touchdown under the model's
 *  impact limits, rollout devices deployed, parked on the runway. */
function coastalFlight(patch) {
  const stage = name => SCENARIO_STAGES.coastal[name];
  const route = routeById('b738-coastal-classic');
  const pavement = ['PREFLIGHT_ORBIT', 'TAKEOFF_ROLL', 'TOUCHDOWN_ROLLOUT', 'POSTFLIGHT_ORBIT', 'COMPLETED'];
  const partials = [];
  let time = 0;
  const tick = (name, extra = {}) => {
    time += 5;
    partials.push({
      stage: stage(name), simTime: time, onGround: pavement.includes(name),
      aglM: pavement.includes(name) ? 0 : 600, iasKnots: 145, headingDeg: 90,
      groundSpeedMs: pavement.includes(name) ? 0 : 77,
      brakes: pavement.includes(name) ? 1 : 0, throttle: 0.7,
      ...extra,
    });
  };
  for (const name of ['PREFLIGHT_ORBIT', 'TAKEOFF_ROLL', 'ROTATION_CLIMB', 'COASTAL_BANK',
    'OCEAN_CRUISE', 'FINAL_APPROACH']) tick(name);
  tick('TOUCHDOWN_ROLLOUT', {
    touchdowns: [{ id: 'mainLeft', sink: 1.9 }, { id: 'mainRight', sink: 2.0 }],
    spoilers: 1, reverser: 1, throttle: 1, gForce: 1.4, groundSpeedMs: 60, brakes: 1,
  });
  tick('TOUCHDOWN_ROLLOUT', {
    touchdowns: [{ id: 'nose', sink: 1.1 }], spoilers: 1, reverser: 1, groundSpeedMs: 4, brakes: 1,
  });
  tick('POSTFLIGHT_ORBIT', { brakes: 1, throttle: 0, groundSpeedMs: 0, result: { status: 'running' } });
  tick('COMPLETED', {
    active: false, onRunway: true, controlsDisabled: false, brakes: 1, throttle: 0, groundSpeedMs: 0,
    virtualInputs: { elevator: null, aileron: null, rudder: null, throttle: null },
    result: { status: 'completed', elapsedSeconds: 130, touchdown: { iasKnots: 141 } },
  });
  return partials.map(row => ({ ...row, ...patch }));
}

const COASTAL_BASELINE = {
  'b738-coastal-classic': {
    maxRollDeg: 30, maxIasKnots: 160, maxSinkFpm: 700, maxAngularRateRadS: 0.5,
    maxHeadingRateDegPerS: 10, maxBankRateDegPerS: 10, maxAbsG: 2, minAglM: 5,
    elapsedSeconds: 130, warningSeconds: {},
  },
};

const scenic = routeById('c172-coastal-scenic');
const lowpass = routeById('f16-lukla-low-pass');

test('a route flown as intended produces no fail and no report', () => {
  const outcome = fly(routeById('b738-coastal-classic'), coastalFlight(), { baseline: COASTAL_BASELINE });
  clean(outcome);
  assert.deepEqual(outcome.reports, []);
  assert.equal(outcome.finished, true);
  assert.equal(outcome.visitedStages.length, 9);
  assert.equal(outcome.measures.touchdownCount, 3);
  assert.equal(outcome.result.status, 'completed');
  assert.deepEqual(outcome.stageTrace, routeById('b738-coastal-classic').stages);

  const airborne = fly(scenic, fullFlight(scenic), { baseline: { [scenic.id]: { warningSeconds: {} } } });
  clean(airborne);
  assert.equal(airborne.reports.length, 0, JSON.stringify(airborne.reports));
});

test('route table covers exactly the lobby demo menu', () => {
  assert.deepEqual(ROUTES.map(routeKey).sort(), declaredRouteIds().sort());
  assert.equal(new Set(ROUTES.map(route => route.id)).size, ROUTES.length);
  assert.ok(AIRCRAFT_IDS.length > 0 && AIRPORT_IDS.length > 0);
});

test('every route declares stages its own scenario can reach', () => {
  for (const route of ROUTES) {
    assert.ok(SCENARIO_STAGES[route.scenario], `${route.id} names an unknown scenario`);
    const numbers = resolveStages(route);
    assert.equal(new Set(numbers).size, numbers.length, `${route.id} repeats a stage number`);
    for (const name of route.groundStages) assert.ok(route.stages.includes(name), `${route.id} ground stage ${name} is not flown`);
    for (const id of route.allowedWarnings) assert.ok(KNOWN_WARNINGS.includes(id), `${route.id} allows the invented warning ${id}`);
    assert.ok(['core', 'full'].includes(route.tier), `${route.id} has tier ${route.tier}`);
    assert.ok(['airborne', 'parked'].includes(route.handoff), `${route.id} has handoff ${route.handoff}`);
    assert.ok(Number.isFinite(route.budgetSimSeconds) && route.budgetSimSeconds > 0, `${route.id} needs a sampling ceiling`);
    assert.equal(route.stages.at(-1), 'COMPLETED', `${route.id} must end at its COMPLETED stage`);
    assert.ok(route.clearanceIntentM >= 0, `${route.id} declares a negative clearance intent`);
    if (route.lands) assert.equal(route.handoff, 'parked', `${route.id} lands but does not park`);
    // Widening either promise is a choreography decision, so it has to be visible here.
    if (route.maxRollDeg !== undefined) {
      assert.ok(route.maxRollDeg > MAX_ROLL_DEG && route.maxRollDeg <= 180,
        `${route.id} widens the roll to ${route.maxRollDeg}°`);
    }
    for (const device of route.rolloutDevices ?? []) {
      assert.ok(route.lands, `${route.id} promises ${device} without landing`);
      assert.ok(['spoilers', 'reverser'].includes(device), `${route.id} invents the rollout device ${device}`);
    }
    for (const entry of route.knownIssues ?? []) {
      assert.ok(entry.contains?.length && entry.contains.every(token => token.length > 3),
        `${route.id} declares a known issue that could match anything`);
      assert.ok(entry.note?.length > 30, `${route.id} states a known issue without quoting what it measured`);
      assert.ok(entry.intermittent === undefined || typeof entry.intermittent === 'boolean',
        `${route.id} declares a known issue whose intermittency is not a boolean`);
    }
  }
  assert.ok(routesForTier('core').length >= 4, 'the PR-blocking tier must not be emptied by accident');
  assert.equal(routesForTier('all').length, ROUTES.length);
  // A crashed route describes an accident, not a reference flight, so it must never
  // appear in the committed soft baseline. A route whose faults are all intermittent
  // is the exception: most of its flights are healthy, and the driver already refuses
  // to fold a run that hit a known issue into the baseline, so the entry can only ever
  // be built from clean flights.
  const committed = JSON.parse(readFileSync(new URL('../scripts/demo-sweep-baseline.json', import.meta.url), 'utf8'));
  for (const route of ROUTES.filter(entry => entry.knownIssues?.some(issue => !issue.intermittent))) {
    assert.equal(committed[route.id], undefined, `${route.id} has a declared known issue and a baseline`);
  }
});

test('a crash ends the route and quotes the collision', () => {
  const outcome = fly(scenic, [
    {}, { crashed: true, crashType: 'TERRAIN', crashDescription: 'Terrain collision' },
  ]);
  fails(outcome, 'CRASH TERRAIN: Terrain collision');
  assert.equal(outcome.fails.length, 1, 'nothing else is worth reporting after a crash');
  assert.equal(outcome.finished, false);
});

test('non-finite flight state is fatal and silent about everything else', () => {
  const outcome = fly(scenic, [{ finite: false, rollDeg: NaN }]);
  fails(outcome, 'NON-FINITE FLIGHT STATE');
  assert.equal(outcome.fails.length, 1);
});

test('the sweep refuses to fly a substituted aircraft', () => {
  const outcome = fly(scenic, fullFlight(scenic, { aircraft: 'B738' }));
  fails(outcome, 'AIRCRAFT SUBSTITUTED: C172 became B738');
});

test('an airborne stall fails, a touchdown stall and a choreographed stall do not', () => {
  fails(fly(scenic, fullFlight(scenic, { stalled: true, iasKnots: 55 }, { hold: 1 })), 'STALL at 55 kt');
  silent(fly(scenic, fullFlight(scenic, { stalled: true, onGround: true, aglM: 0 })), 'STALL');
  silent(fly({ ...scenic, expectedStall: true }, fullFlight(scenic, { stalled: true })), 'STALL');
});

test('gear damage, accumulated damage and landing incidents all fail', () => {
  fails(fly(scenic, fullFlight(scenic, { gearStates: ['normal', 'degraded', 'normal'] })),
    'GEAR LEG 1 DAMAGE STATE "degraded"');
  fails(fly(scenic, fullFlight(scenic, { gearDamageMax: 0.02 })), 'GEAR DAMAGE ACCUMULATED: 0.020');
  fails(fly(scenic, fullFlight(scenic, { landingIncident: true })), 'LANDING INCIDENT');
});

test('airframe contact is a fault in the air and choreography on the pavement', () => {
  fails(fly(scenic, fullFlight(scenic, { bodyContacts: [{ id: 'wing' }] })),
    'AIRFRAME BODY CONTACT WHILE AIRBORNE');
  silent(fly(routeById('c172-coastal-proximity'),
    fullFlight(routeById('c172-coastal-proximity'), { onGround: true, aglM: 0, bodyContacts: [{ id: 'hull' }] })),
    'AIRFRAME BODY CONTACT');
  silent(fly(scenic, fullFlight(scenic, { onGround: true, aglM: 0 })), 'AIRFRAME BODY CONTACT');
});

test('touchdown sink is judged against the model\'s own per-leg impact limits', () => {
  const route = routeById('b738-coastal-classic');
  clean(fly(route, coastalFlight(), { baseline: COASTAL_BASELINE }));

  const hardMain = coastalFlight().map(row => ({ ...row }));
  hardMain[6].touchdowns = [{ id: 'mainLeft', sink: 4.6 }];
  fails(fly(route, hardMain, { baseline: COASTAL_BASELINE }),
    'HARD TOUCHDOWN mainLeft sink 4.6 m/s > 3.8 m/s model limit');

  const hardNose = coastalFlight().map(row => ({ ...row }));
  hardNose[7].touchdowns = [{ id: 'nose', sink: 3.4 }];
  fails(fly(route, hardNose, { baseline: COASTAL_BASELINE }),
    'HARD TOUCHDOWN nose sink 3.4 m/s > 2.8 m/s model limit');
});

test('clearance below the route intent fails; pavement contact and a declared skim do not', () => {
  fails(fly(scenic, fullFlight(scenic, { aglM: 12 })), "CLEARANCE 12.0 m below the route's declared 25 m intent");
  fails(fly(scenic, fullFlight(scenic, { aglM: -3 })), 'FLIGHT BELOW THE GROUND PLANE');
  silent(fly(scenic, fullFlight(scenic, { aglM: 0, onGround: true })), 'BELOW THE GROUND PLANE');
  silent(fly(routeById('c172-coastal-proximity'), fullFlight(routeById('c172-coastal-proximity'), { aglM: 2 })), 'CLEARANCE');
  silent(fly(lowpass, fullFlight(lowpass, { aglM: 62 })), 'CLEARANCE');
  fails(fly(lowpass, fullFlight(lowpass, { aglM: 41 })), "CLEARANCE 41.0 m below the route's declared 50 m intent");
});

test('a clearance fault names the vertical direction rather than assuming a descent', () => {
  // src/systems/FlightWarnings.js:66 derives the sink as -vsi, so a positive vsiFpm is a
  // climb. Printing every value as "sink" told the opposite story for both Lukla and the
  // coastal Cessna: losing clearance while climbing means flying into rising ground.
  // c172-lukla-scenic declares the same 25 m intent and carries no known issues, so the
  // fault stays a fault instead of being absorbed.
  const clean = routeById('c172-lukla-scenic');
  assert.equal(vsiText(-872), 'sink 872 fpm');
  assert.equal(vsiText(872), 'climb 872 fpm');
  fails(fly(clean, fullFlight(clean, { aglM: 12, vsiFpm: -872 })), 'sink 872 fpm');
  silent(fly(clean, fullFlight(clean, { aglM: 12, vsiFpm: -872 })), 'climb');
  fails(fly(clean, fullFlight(clean, { aglM: 12, vsiFpm: 10052 })), 'climb 10052 fpm');
  silent(fly(clean, fullFlight(clean, { aglM: 12, vsiFpm: 10052 })), 'sink');
  // A real sink is never printed with a negative magnitude.
  silent(fly(clean, fullFlight(clean, { aglM: 12, vsiFpm: -872 })), 'sink -');
});

test('speed beyond the simulator\'s own Vne and Mach ceilings fails', () => {
  fails(fly(scenic, fullFlight(scenic, { iasKnots: 171 })), 'OVERSPEED 171 kt > Vne 163 kt');
  fails(fly(routeById('b738-incheon-sihwa-tour'), fullFlight(routeById('b738-incheon-sihwa-tour'), { iasKnots: 300, mach: 0.91 })),
    'MACH 0.910 > limit 0.82');
  silent(fly(scenic, fullFlight(scenic, { iasKnots: 160, mach: 0.4 })), 'OVERSPEED');
});

test('rolling past vertical is a fault unless the route choreographed the roll', () => {
  assert.equal(MAX_ROLL_DEG, 90);
  fails(fly(scenic, fullFlight(scenic, { rollDeg: -104 })), 'ROLL PAST 90°: -104.0°');
  fails(fly(scenic, fullFlight(scenic, { angularRates: [0.2, 4.4, 0.1] })), 'ANGULAR RATE 4.40 rad/s');
  // The canyon chase's own header: a climbing barrel into a half roll over the shoulder.
  const canyon = routeById('f16-lukla-canyon-chase');
  assert.equal(canyon.maxRollDeg, 180);
  silent(fly(canyon, fullFlight(canyon, { rollDeg: -164 })), 'ROLL PAST');
});

test('a stage the route never declared is an abnormality, not a rename', () => {
  const outcome = fly(scenic, fullFlight(scenic, name => (name === 'LOW_PASS' ? { stage: 99 } : {})));
  fails(outcome, 'UNRECOGNISED STAGES VISITED: 99');
});

test('a skipped stage and a reversed stage order both fail', () => {
  const skipped = fly(scenic, fullFlight(scenic).filter(row => row.stage !== SCENARIO_STAGES.cessna.LOW_PASS));
  fails(skipped, 'STAGES NOT FLOWN: LOW_PASS');

  const table = SCENARIO_STAGES.cessna;
  const reversed = fly(scenic, [
    { stage: table.ESTABLISH }, { stage: table.LOW_PASS }, { stage: table.CLIMB },
    { stage: table.LOW_PASS }, { stage: table.RECOVER },
    { stage: table.COMPLETED, active: false, controlsDisabled: false, virtualInputs: {},
      throttle: 0.6, aglM: 400, result: { status: 'completed' } },
  ]);
  fails(reversed, 'STAGE ORDER REVERSED: ESTABLISH → LOW_PASS → CLIMB → LOW_PASS');
});

test('a route still flying at its ceiling is STUCK', () => {
  const outcome = fly(scenic, [{ simTime: scenic.budgetSimSeconds }]);
  fails(outcome, `STUCK: still active after ${scenic.budgetSimSeconds.toFixed(1)} s of simulated time`);
  assert.equal(outcome.finished, false);
});

test('a completed run with no result contract cannot claim it flew as intended', () => {
  const route = routeById('b738-coastal-classic');
  const partials = coastalFlight({ result: null });
  fails(fly(route, partials, { baseline: COASTAL_BASELINE }),
    'HANDOFF has no scenario result, so completion intent cannot be asserted');
  fails(fly(route, coastalFlight({ result: { status: 'failed', reason: 'Fighter trim unavailable' } }),
    { baseline: COASTAL_BASELINE }), 'HANDOFF reported "failed": Fighter trim unavailable');
});

test('a handoff that leaves the cockpit wired to the demo fails', () => {
  fails(fly(scenic, fullFlight(scenic, { controlsDisabled: true })), 'HANDOFF left the flight controls disabled');
  fails(fly(scenic, fullFlight(scenic, { virtualInputs: { elevator: 0.4 } })),
    'HANDOFF left virtual pilot inputs set: elevator');
  fails(fly(scenic, fullFlight(scenic, { throttle: 0 })),
    'HANDOFF handed back with 0 thrust at 400 m agl (dead stick)');
  fails(fly(scenic, fullFlight(scenic, { onGround: true, aglM: 0, throttle: 0 })),
    'HANDOFF on an airborne route that ended on the ground');
});

test('a parked handoff must actually be parked on the runway', () => {
  const route = routeById('b738-coastal-classic');
  const patch = partial => fly(route, coastalFlight(partial), { baseline: COASTAL_BASELINE });
  // Only the closing slice may change, so take the last row of the flown route.
  const lastOnly = partial => coastalFlight().map((row, i, all) => (i === all.length - 1 ? { ...row, ...partial } : row));
  fails(patch({ onGround: false }), 'HANDOFF airborne at');
  fails(patch({ onRunway: false }), 'HANDOFF came to rest off the runway and its safety area');
  clean(fly(route, lastOnly({ inSafetyArea: true })));
  const rolling = lastOnly({ groundSpeedMs: 6.2 });
  fails(fly(route, rolling), `HANDOFF still rolling at 6.20 m/s`);
  assert.ok(STOPPED_SPEED_MS < 6.2);
});

test('a landing route that never used its rollout devices is abnormal', () => {
  const route = routeById('b738-coastal-classic');
  assert.deepEqual(route.rolloutDevices, ['spoilers', 'reverser']);
  const run = coastalFlight().map(row => ({ ...row, spoilers: 0, reverser: 0 }));
  const outcome = fly(route, run, { baseline: COASTAL_BASELINE });
  fails(outcome, 'HANDOFF a rollout with spoilers never deployed it');
  fails(outcome, 'HANDOFF a rollout with reverser never deployed it');
  assert.deepEqual(outcome.measures.rolloutDevices, {});
  // A Cessna has neither system, so demanding them would be the sweep's own bug.
  const tour = routeById('c172-incheon-tour');
  assert.equal(tour.rolloutDevices, undefined);
  clean(fly(tour, fullFlight(tour)));
});

test('montage and tour routes are checked against their own scene counts', () => {
  const proximity = routeById('c172-coastal-proximity');
  const partials = fullFlight(proximity);
  partials.at(-1).result = { status: 'completed', stagesCompleted: 3 };
  fails(fly(proximity, partials), 'HANDOFF flew 3 of 5 scenes');
  partials.at(-1).result = { status: 'completed', stagesCompleted: 5 };
  clean(fly(proximity, partials));

  const tour = routeById('b738-incheon-sihwa-tour');
  const short = fullFlight(tour);
  short.at(-1).result = { status: 'completed', landmarks: ['plant', 'beach'] };
  fails(fly(tour, short), 'HANDOFF tour passed 2 of 4 landmarks');
  clean(fly(tour, fullFlight(tour)));
});

test('envelope peaks above the measured baseline are reported, not failed', () => {
  const baseline = { [scenic.id]: { maxRollDeg: 40, maxIasKnots: 120, maxAbsG: 1.6, minAglM: 40,
    maxSinkFpm: 500, maxAngularRateRadS: 0.4, maxHeadingRateDegPerS: 8, maxBankRateDegPerS: 8,
    warningSeconds: {} } };
  const partials = fullFlight(scenic, { rollDeg: 52, iasKnots: 133, gForce: 2.1, aglM: 31, vsiFpm: -900 });
  const outcome = fly(scenic, partials, { baseline });
  clean(outcome);
  reports(outcome, 'peak bank 52.0° exceeds baseline 40°');
  reports(outcome, 'peak IAS 133.0 kt exceeds baseline 120 kt');
  reports(outcome, 'peak |g| 2.1 g exceeds baseline 1.6 g');
  reports(outcome, 'minimum clearance 31.0 m below baseline 40 m');
  reports(outcome, 'peak sink 900.0 fpm exceeds baseline 500 fpm');

  const strict = fly(scenic, partials, { baseline, strict: true });
  assert.ok(strict.fails.length >= strict.reports.length, 'STRICT must promote every report');
  fails(strict, 'STRICT: peak bank 52.0° exceeds baseline 40°');
});

test('warnings outside the route intent are reported and a missing baseline is announced', () => {
  const outcome = fly(scenic, fullFlight(scenic, { warningIds: ['terrain'] }));
  reports(outcome, `WARNING "terrain" is not part of this route's intent`);
  reports(outcome, 'NO BASELINE');

  const allowed = fly(lowpass, fullFlight(lowpass, { warningIds: ['terrain'] }),
    { baseline: { [lowpass.id]: { warningSeconds: {} } } });
  assert.ok(!allowed.reports.some(text => text.includes('"terrain" is not part')),
    'the low pass is meant to scare the terrain computer');

  const heavy = fly(lowpass, fullFlight(lowpass, { warningIds: ['pull-up'] }, { hold: 10 }),
    { baseline: { [lowpass.id]: { warningSeconds: { 'pull-up': 0.5, 'terrain': 3 } } } });
  reports(heavy, 'WARNING "pull-up" ran');
  reports(heavy, 'against a baseline of 0.5 s');
  reports(heavy, 'baseline warning "terrain" did not appear this run');
});

test('a load factor past any manoeuvre is a collapse; a hard pull is only a measured peak', () => {
  // The repo clamps nothing: telemetry.gForce is a bare accelerometer reading, so a
  // fighter pulling 8 g in a canyon is choreography and a 21 g sample is arithmetic.
  const hard = fly(scenic, fullFlight(scenic, { gForce: 8 }));
  clean(hard);
  assert.equal(hard.measures.maxAbsG, 8);
  const collapse = fly(scenic, fullFlight(scenic, name => (
    name === 'LOW_PASS' || name === 'CLIMB'
      ? { gForce: name === 'LOW_PASS' ? SOLVER_G_LIMIT + 1 : -SOLVER_G_LIMIT - 1 } : {})));
  fails(collapse, `LOAD FACTOR ${SOLVER_G_LIMIT + 1}.0 g`);
  fails(collapse, `LOAD FACTOR -${SOLVER_G_LIMIT + 1}.0 g`);
  assert.equal(collapse.measures.extremeGSamples, 2);
});

test('a heading or bank spike inside one stage is an oscillation warning', () => {
  const table = SCENARIO_STAGES.cessna;
  const partials = fullFlight(scenic);
  const low = partials.findIndex(row => row.stage === table.LOW_PASS);
  partials.splice(low, 0, { ...partials[low], headingDeg: 90, rollDeg: 0 },
    { ...partials[low], headingDeg: 200, rollDeg: 70 });
  const outcome = fly(scenic, partials);
  reports(outcome, 'HEADING RATE SPIKE 440 °/s inside one stage');
  reports(outcome, 'BANK RATE SPIKE 280 °/s inside one stage');
});

test('a choreographed reposition is not a heading spike and not an unexplained jump', () => {
  const table = SCENARIO_STAGES.cessna;
  const partials = fullFlight(scenic);
  const low = partials.findIndex(row => row.stage === table.LOW_PASS);
  // The stage entry itself carries the transition, the displacement lands one slice later.
  partials[low] = { ...partials[low], stageTransitions: [table.LOW_PASS], position: [0, 300, 0] };
  partials.splice(low + 1, 0, { ...partials[low], headingDeg: 200, rollDeg: 70,
    groundSpeedMs: 60, position: [1200, 300, -800] });
  const choreographed = fly(scenic, partials);
  assert.ok(!choreographed.reports.some(text => text.includes('RATE SPIKE')), JSON.stringify(choreographed.reports));
  assert.ok(!choreographed.reports.some(text => text.includes('POSITION JUMPED')), JSON.stringify(choreographed.reports));

  const unexplained = fly(scenic, partials.map((row, index) =>
    (index === low || index === low + 1 ? { ...row, stageTransitions: [] } : row)));
  reports(unexplained, 'POSITION JUMPED');
});

test('a jump whose refreshed heading arrives one slice later is neither a spike nor a fault', () => {
  const table = SCENARIO_STAGES.cessna;
  const partials = fullFlight(scenic);
  const low = partials.findIndex(row => row.stage === table.LOW_PASS);
  // Measured in the coastal sweep: the stage entry repositions the aircraft while heading
  // still reads the pre-jump value, so the displacement and the new attitude land apart.
  partials[low] = { ...partials[low], stageTransitions: [table.LOW_PASS],
    position: [2670.7, 318.5, 656.4], headingDeg: 122.3 };
  partials.splice(low + 1, 0, { ...partials[low], stageTransitions: [],
    position: [-6472.4, 309.5, 8.0], headingDeg: 90 });
  const outcome = fly(scenic, partials);
  assert.ok(!outcome.reports.some(text => text.includes('RATE SPIKE')), JSON.stringify(outcome.reports));
  assert.ok(!outcome.reports.some(text => text.includes('POSITION JUMPED')), JSON.stringify(outcome.reports));
});

test('elapsed time that drifts from the baseline is reported', () => {
  const route = routeById('b738-coastal-classic');
  const run = coastalFlight().map(row => ({ ...row }));
  run.at(-1).result = { status: 'completed', elapsedSeconds: 300 };
  reports(fly(route, run, { baseline: COASTAL_BASELINE }), 'drifted 131% from baseline 130 s');
});

test('without an instrumented stage trace the live stage is still followed', () => {
  const route = routeById('b738-coastal-classic');
  const outcome = fly(route, coastalFlight(), { baseline: COASTAL_BASELINE, viaTransitions: false });
  // stop() resets the director to IDLE, so the closing stage is invisible in a snapshot.
  fails(outcome, 'STAGES NOT FLOWN: COMPLETED');
  assert.equal(outcome.visitedStages.length, 8);
});

test('a declared known issue absorbs its own fault and nothing else', () => {
  const lukla = routeById('b738-lukla-classic');
  assert.ok(lukla.knownIssues?.length, 'the Lukla circuit must declare the crash it is known to make');
  const table = SCENARIO_STAGES.lukla;
  const crashed = fly(lukla, [...fullFlight(lukla), {
    stage: table.COMPLETED, active: false, crashed: true, crashType: 'TERRAIN',
    crashDescription: 'Excessive belly impact or accumulated structural damage destroyed the aircraft.',
  }]);
  assert.deepEqual(crashed.fails, [], JSON.stringify(crashed.fails));
  assert.equal(crashed.finished, false, 'an absorbed crash is still a route that never finished');
  assert.ok(crashed.knownIssues.some(text => text.includes('CRASH TERRAIN') && text.includes('belly impact')),
    JSON.stringify(crashed.knownIssues));

  // The declaration buys tolerance for that fault only: anything else still fails.
  const also = fullFlight(lukla);
  also[2] = { ...also[2], iasKnots: 400 };
  const mixed = fly(lukla, [...also, {
    stage: table.COMPLETED, active: false, crashed: true, crashType: 'TERRAIN', crashDescription: 'belly impact',
  }]);
  fails(mixed, 'OVERSPEED');
  assert.equal(mixed.knownIssues.length, 1, JSON.stringify(mixed.knownIssues));
});

test('a known issue that no longer happens asks to be removed', () => {
  const f16 = { ...routeById('f16-lukla-low-pass'), knownIssues: [{ contains: ['CRASH TERRAIN'], note: 'documented for the test' }] };
  const baseline = { [f16.id]: { warningSeconds: {} } };
  const flown = fly(f16, fullFlight(f16), { baseline });
  clean(flown);
  reports(flown, 'KNOWN ISSUE "CRASH TERRAIN" did not reproduce');
  fails(fly(f16, fullFlight(f16), { baseline, strict: true }), 'STRICT: KNOWN ISSUE');
});

test('an intermittent known issue absorbs every line of one fault and stays quiet when it misses', () => {
  const scenic = routeById('c172-coastal-scenic');
  const declared = scenic.knownIssues ?? [];
  assert.ok(declared.length && declared.every(entry => entry.intermittent),
    'the coastal scenic route must declare its water arrival as intermittent');
  const table = SCENARIO_STAGES.cessna;
  const recover = { stage: table.RECOVER, aglM: 20, vsiFpm: -870, iasKnots: 86 };
  const outcome = fly(scenic, [...fullFlight(scenic), recover, {
    ...recover, aglM: 3.9,
  }, {
    stage: -1, active: false, crashed: true, crashType: 'WATER',
    crashDescription: 'The aircraft hit the ocean surface at high speed.',
  }]);
  assert.deepEqual(outcome.fails, [], JSON.stringify(outcome.fails));
  assert.equal(outcome.knownIssues.length, 3, 'the dive writes three faults and one declaration cannot absorb them all');
  assert.ok(outcome.knownIssues.every(text => text.includes('known:')), JSON.stringify(outcome.knownIssues));

  // A clean flight of a flaky route is not evidence the declaration is stale.
  clean(fly(scenic, fullFlight(scenic), { baseline: { [scenic.id]: { warningSeconds: {} } } }));
  const healthy = fly(scenic, fullFlight(scenic), { baseline: { [scenic.id]: { warningSeconds: {} } }, strict: true });
  assert.equal(healthy.knownIssues.length, 0);
  assert.deepEqual(healthy.reports, [], JSON.stringify(healthy.reports));

  // The token still refuses to tolerate an unrelated fault on the same route.
  const stalled = fly(scenic, [...fullFlight(scenic), { ...recover, stalled: true }],
    { baseline: { [scenic.id]: { warningSeconds: {} } } });
  fails(stalled, 'STALL');
});
