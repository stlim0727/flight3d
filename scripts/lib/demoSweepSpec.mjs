/**
 * @file Route table for the cinematic demo fast-play sweep.
 *
 * Every legal (aircraft, airport, demo profile) combination in
 * `src/director/demoProfiles.js` must appear here; `tests/demoSweepChecks.test.js`
 * fails if the two drift apart. Stage numbers are never hardcoded — they are read
 * from each scenario's own `STAGES` table so a renamed or renumbered stage cannot
 * silently disable a check.
 *
 * `handoff`, `lands` and `clearanceIntentM` describe what the route is *supposed*
 * to do, taken from the scenario source and the acceptance notes in
 * docs/development/aircraft-demos.md. Anything that is an envelope peak rather
 * than intent (bank, speed, G, warning frequency) is measured into
 * `scripts/demo-sweep-baseline.json` instead of being declared here.
 *
 * The Hangang region is deliberately absent: `DemoFlightDirector.start()` returns
 * false there because it is a manually flown bridge course, not an autonomous
 * demo, so there is no choreography for the sweep to fast-play. It is covered by
 * `tests/hangang.test.js` and `scripts/verify-hangang.mjs`.
 */
import { CoastalDemoScenario } from '../../src/director/scenarios/CoastalDemoScenario.js';
import { LuklaCircuitScenario } from '../../src/director/scenarios/LuklaCircuitScenario.js';
import { IncheonDepartureScenario } from '../../src/director/scenarios/IncheonDepartureScenario.js';
import { IncheonCessnaScenario } from '../../src/director/scenarios/IncheonCessnaScenario.js';
import { CessnaDemoScenario } from '../../src/director/scenarios/CessnaDemoScenario.js';
import { CessnaProximityScenario } from '../../src/director/scenarios/CessnaProximityScenario.js';
import { F16LuklaScenario } from '../../src/director/scenarios/F16LuklaScenario.js';
import { F16CanyonSlalomScenario } from '../../src/director/scenarios/F16CanyonSlalomScenario.js';
import { F16CanyonChaseScenario } from '../../src/director/scenarios/F16CanyonChaseScenario.js';
import { SihwaTourScenario } from '../../src/director/scenarios/SihwaTourScenario.js';
import { demoProfiles } from '../../src/director/demoProfiles.js';
import { AIRCRAFT_REGISTRY } from '../../src/config/aircraftConfigs.js';
import { SPAWN_SCENARIOS } from '../../src/config/scenarioRegistry.js';

export const SCENARIO_STAGES = {
  coastal: CoastalDemoScenario.STAGES,
  lukla: LuklaCircuitScenario.STAGES,
  incheonDeparture: IncheonDepartureScenario.STAGES,
  incheonCessna: IncheonCessnaScenario.STAGES,
  cessna: CessnaDemoScenario.STAGES,
  proximity: CessnaProximityScenario.STAGES,
  f16LowPass: F16LuklaScenario.STAGES,
  f16Slalom: F16CanyonSlalomScenario.STAGES,
  f16Canyon: F16CanyonChaseScenario.STAGES,
  sihwa: SihwaTourScenario.STAGES,
};

/** Derived from the app's own registries so the sweep cannot quietly fall behind. */
export const AIRCRAFT_IDS = Object.keys(AIRCRAFT_REGISTRY);
export const AIRPORT_IDS = SPAWN_SCENARIOS.demo.airports;

/**
 * Sampling ceiling per route. Coastal, Lukla and Proximity scenarios have no
 * timeout of their own, so an unfinished route is indistinguishable from a hung
 * one without a harness ceiling. Routes that do self-fail (Incheon departure at
 * 1500/1800 s, Incheon tour at 420/900 s, Sihwa at 1200 s) are capped well below
 * that so a stuck guidance loop reports instead of running out the job.
 */
export const ROUTES = [
  {
    id: 'f16-lukla-canyon-slalom', aircraft: 'F16', airport: 'lukla', profile: 'canyon-slalom',
    tier: 'full', scenario: 'f16Slalom', stages: ['INGRESS', 'SLALOM', 'BREAKOUT', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 185,
    clearanceIntentM: 15, allowedWarnings: ['terrain', 'pull-up', 'gear', 'bank', 'sink-rate'], shotStage: 'SLALOM',
  },
  {
    id: 'b738-coastal-classic', aircraft: 'B738', airport: 'coastal', profile: 'classic',
    tier: 'core', scenario: 'coastal',
    stages: ['PREFLIGHT_ORBIT', 'TAKEOFF_ROLL', 'ROTATION_CLIMB', 'COASTAL_BANK', 'OCEAN_CRUISE',
      'FINAL_APPROACH', 'TOUCHDOWN_ROLLOUT', 'POSTFLIGHT_ORBIT', 'COMPLETED'],
    groundStages: ['PREFLIGHT_ORBIT', 'TAKEOFF_ROLL', 'TOUCHDOWN_ROLLOUT', 'POSTFLIGHT_ORBIT'],
    lands: true, handoff: 'parked', budgetSimSeconds: 260, clearanceIntentM: 0,
    // Only the 737 has these systems; a rollout that never uses them is abnormal.
    rolloutDevices: ['spoilers', 'reverser'],
    // Flap/speed-brake handling on a heavy approach is choreography, not a fault, and
    // the measured flare briefly sounds both terrain warnings; the baseline caps how long.
    allowedWarnings: ['gear', 'flaps', 'takeoff-config', 'pull-up', 'sink-rate'],
    shotStage: 'OCEAN_CRUISE',
  },
  {
    id: 'b738-lukla-classic', aircraft: 'B738', airport: 'lukla', profile: 'classic',
    tier: 'core', scenario: 'lukla',
    stages: ['CLIFF_TAKEOFF', 'CANYON_CLIMB', 'HIMALAYAN_CRUISE', 'CANYON_APPROACH',
      'UPHILL_TOUCHDOWN', 'COMPLETED'],
    groundStages: ['CLIFF_TAKEOFF', 'UPHILL_TOUCHDOWN'],
    lands: true, handoff: 'parked', budgetSimSeconds: 320, clearanceIntentM: 0,
    rolloutDevices: ['spoilers', 'reverser'],
    knownIssues: [{
      contains: ['CRASH TERRAIN'],
      note: 'CANYON_APPROACH flies into the rising valley wall at ~126 s — 13 m agl, 111 kt, +15° pitch, '
        + 'still climbing when the terrain climbs faster. Reproduced identically through the app-internal '
        + 'arming path used by scripts/test-lukla-demo-benchmark.mjs, so it is the demo, not the sweep. '
        + 'Tracked in https://github.com/stlim0727/flight3d/issues/292.',
    }],
    allowedWarnings: ['gear', 'flaps', 'takeoff-config'],
    shotStage: 'CANYON_APPROACH',
  },
  {
    id: 'b738-incheon-departure', aircraft: 'B738', airport: 'incheon', profile: 'incheon-departure',
    tier: 'full', scenario: 'incheonDeparture',
    stages: ['GATE', 'PUSHBACK', 'DISCONNECT', 'TAXI', 'HOLD', 'LINEUP', 'CLEARANCE', 'TAKEOFF',
      'DEPARTURE', 'COMPLETED'],
    groundStages: ['GATE', 'PUSHBACK', 'DISCONNECT', 'TAXI', 'HOLD', 'LINEUP', 'CLEARANCE'],
    lands: false, handoff: 'airborne', budgetSimSeconds: 600, clearanceIntentM: 0,
    allowedWarnings: ['gear', 'flaps', 'takeoff-config'],
    shotStage: 'TAKEOFF',
  },
  {
    id: 'c172-coastal-scenic', aircraft: 'C172', airport: 'coastal', profile: 'scenic',
    tier: 'core', scenario: 'cessna',
    stages: ['ESTABLISH', 'LOW_PASS', 'CLIMB', 'RECOVER', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 200,
    // Documented intent: docs/development/aircraft-demos.md and verify-cessna-demos.mjs.
    clearanceIntentM: 25, allowedWarnings: [], shotStage: 'LOW_PASS',
    knownIssues: [
      {
        contains: ['RECOVER CLEARANCE'], intermittent: true,
        note: 'RECOVER occasionally ends in the sea: 3 of 37 cold-page flights, on the '
          + 'pre-Hangang build and on main alike, so it is not a merge regression. Clearance falls '
          + 'through the 25 m intent at 73.3-74.3 s (23.7 m to 3.9 m) and then `CRASH WATER` at 86 kt. '
          + 'The reported vertical speed during that fall is a CLIMB of 865-872 fpm, which is the '
          + 'finding: an earlier version of this note called those numbers a sink and built a '
          + 'mechanism on it, but the checker printed `vsiFpm` as "sink" whatever its sign '
          + '(see vsiText in scripts/lib/abnormalityChecks.mjs), and a positive vsiFpm is a climb '
          + '(src/systems/FlightWarnings.js:66). Gaining height and still arriving on the water '
          + 'surface is what has to be explained, not a command that descends too fast.',
      },
      {
        contains: ['CRASH WATER'], intermittent: true,
        note: 'the terminal event of the same fault — "The aircraft hit the ocean surface at '
          + 'high speed" at 86 kt, a second or two after the clearance violations above.',
      },
      {
        contains: ['CRASH TERRAIN'], intermittent: true,
        note: 'the terminal event of the same fault — touching the coastal shoreline '
          + 'or terrain at 86 kt when RECOVER falls below the clearance intent.',
      },
    ],
  },
  {
    id: 'c172-coastal-maneuvers', aircraft: 'C172', airport: 'coastal', profile: 'maneuvers',
    tier: 'full', scenario: 'cessna',
    stages: ['ESTABLISH', 'LEFT_TURN', 'RIGHT_TURN', 'WINGOVER', 'RECOVER', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 200,
    clearanceIntentM: 25, allowedWarnings: ['bank'], shotStage: 'LEFT_TURN',
  },
  {
    id: 'c172-coastal-proximity', aircraft: 'C172', airport: 'coastal', profile: 'proximity',
    tier: 'full', scenario: 'proximity',
    stages: ['SHIP_BUZZ', 'BUILDING_WEAVE', 'TREE_CANOPY', 'LAKE_SKIM', 'TOWER_BUZZ', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 140,
    // The montage skims metres above the lake on purpose; collision is the real bound.
    clearanceIntentM: 0, allowedWarnings: ['bank', 'terrain', 'pull-up', 'sink-rate', 'gear', 'flaps'],
    shotStage: 'LAKE_SKIM', expectStagesCompleted: 5,
  },
  {
    id: 'c172-lukla-scenic', aircraft: 'C172', airport: 'lukla', profile: 'scenic',
    tier: 'full', scenario: 'cessna',
    stages: ['ESTABLISH', 'LOW_PASS', 'CLIMB', 'RECOVER', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 200,
    clearanceIntentM: 25, allowedWarnings: [], shotStage: 'LOW_PASS',
  },
  {
    id: 'c172-lukla-maneuvers', aircraft: 'C172', airport: 'lukla', profile: 'maneuvers',
    tier: 'full', scenario: 'cessna',
    stages: ['ESTABLISH', 'LEFT_TURN', 'RIGHT_TURN', 'WINGOVER', 'RECOVER', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 200,
    clearanceIntentM: 25, allowedWarnings: ['bank'], shotStage: 'WINGOVER',
  },
  {
    id: 'c172-incheon-tour', aircraft: 'C172', airport: 'incheon', profile: 'incheon-tour',
    tier: 'full', scenario: 'incheonCessna',
    stages: ['TAKEOFF', 'TOUR', 'CIRCUIT', 'FINAL', 'ROLLOUT', 'COMPLETED'],
    groundStages: ['ROLLOUT'], lands: true, handoff: 'parked', budgetSimSeconds: 640,
    clearanceIntentM: 0,
    // The stall *cue* sounds for ~5 s of a slow final; the aerodynamic stall FAIL
    // watches telemetry.isStalled instead, so this allowance does not weaken it.
    allowedWarnings: ['gear', 'flaps', 'stall'], shotStage: 'TOUR',
  },
  {
    id: 'f16-lukla-low-pass', aircraft: 'F16', airport: 'lukla', profile: 'low-pass',
    tier: 'core', scenario: 'f16LowPass',
    stages: ['ESTABLISH', 'LOW_PASS', 'CLIMB', 'RETURN', 'FINAL', 'ROLLOUT', 'COMPLETED'],
    groundStages: ['ROLLOUT'], lands: true, handoff: 'parked', budgetSimSeconds: 1000,
    rolloutDevices: ['spoilers'],
    // Landing clearance reaches wheel height; the route records low-pass clearance separately.
    clearanceIntentM: 0,
    clearanceIntentByStage: { ESTABLISH: 40, LOW_PASS: 40, CLIMB: 50, RETURN: 150 },
    allowedWarnings: ['terrain', 'pull-up', 'gear', 'flaps', 'sink-rate', 'stall'], shotStage: 'LOW_PASS',
  },
  {
    id: 'f16-lukla-canyon-chase', aircraft: 'F16', airport: 'lukla', profile: 'canyon-chase',
    tier: 'full', scenario: 'f16Canyon',
    stages: ['INGRESS', 'SLALOM', 'SPRINT', 'BREAKOUT', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 180,
    // A chase low enough to sound the terrain warnings, slow enough to hang the gear
    // warning, and hard enough banked that the 85° profile warning runs for seconds.
    clearanceIntentM: 0, allowedWarnings: ['terrain', 'pull-up', 'gear', 'bank'], shotStage: 'SLALOM',
    // Its own choreography: "a climbing barrel, followed by a half roll over the
    // shoulder" (F16CanyonChaseScenario.js:242), tracked as rollTravelDeg/invertedSeconds.
    maxRollDeg: 180,
  },
  {
    id: 'b738-incheon-sihwa-tour', aircraft: 'B738', airport: 'incheon', profile: 'sihwa-tour',
    tier: 'full', scenario: 'sihwa',
    stages: ['COAST', 'STATION', 'BEACH', 'RETURN', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 700,
    // The scenario itself aborts under 100 m of terrain clearance.
    clearanceIntentM: 100, allowedWarnings: ['gear', 'flaps'], shotStage: 'BEACH',
    expectLandmarks: 4,
  },
  {
    id: 'c172-incheon-sihwa-tour', aircraft: 'C172', airport: 'incheon', profile: 'sihwa-tour',
    tier: 'full', scenario: 'sihwa',
    stages: ['COAST', 'STATION', 'BEACH', 'RETURN', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 1000,
    clearanceIntentM: 100, allowedWarnings: ['gear', 'flaps'], shotStage: 'BEACH',
    expectLandmarks: 4,
  },
  {
    id: 'f16-incheon-sihwa-tour', aircraft: 'F16', airport: 'incheon', profile: 'sihwa-tour',
    tier: 'full', scenario: 'sihwa',
    stages: ['COAST', 'STATION', 'BEACH', 'RETURN', 'COMPLETED'],
    groundStages: [], lands: false, handoff: 'airborne', budgetSimSeconds: 700,
    clearanceIntentM: 100, allowedWarnings: ['gear', 'flaps'], shotStage: 'BEACH',
    expectLandmarks: 4,
  },
];

export function resolveStages(route) {
  const table = SCENARIO_STAGES[route.scenario];
  return route.stages.map(name => {
    if (!(name in table)) throw new Error(`route ${route.id} expects stage ${name}, absent from ${route.scenario}`);
    return table[name];
  });
}

export function routeById(id) {
  return ROUTES.find(route => route.id === id);
}

export function routesForTier(tier) {
  return ROUTES.filter(route => tier === 'all' || route.tier === tier);
}

/** The ids the sweep must cover, straight from the lobby's own availability table. */
export function declaredRouteIds() {
  const ids = [];
  for (const aircraft of AIRCRAFT_IDS) {
    for (const airport of AIRPORT_IDS) {
      for (const profile of demoProfiles(aircraft, airport)) ids.push(`${aircraft}@${airport}/${profile.id}`);
    }
  }
  return ids;
}

export function routeKey(route) {
  return `${route.aircraft}@${route.airport}/${route.profile}`;
}
