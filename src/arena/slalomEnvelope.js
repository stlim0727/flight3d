/** The measured response of the production F-16 in the low-level slalom regime,
 * frozen from `docs/development/f16-valley-envelope.json`, which
 * `scripts/measure-valley-envelope.mjs` writes with
 * `scripts/lib/f16EnvelopeProbe.mjs`. Course geometry and judging limits are
 * derived from these numbers, so a course can only ask for what the aircraft in
 * the game actually does. Values are the pessimistic side of both measured
 * altitudes; nothing outside the measured range is extrapolated.
 *
 * The asymmetry that shapes the whole contract: idle thrust exceeds clean drag
 * at every speed in the band, so wings-level flight at idle *gains* energy
 * (+11 to +16 m/s at held airspeed). A sustained sink only exists above ~55
 * degrees of bank and never exceeds about 10 m/s, while climb authority is
 * 27-36 m/s at a third of the throttle. Losing height is therefore either slow
 * and banked, or fast and paid for in airspeed. */

export const SLALOM_ENVELOPE_VERSION = 'f16-slalom-envelope-v1';

/** Airspeeds at which the plant was held, each with its measured banked rows. */
export const MEASURED_ROWS = Object.freeze([
  { iasKnots: 220, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: 11.4 },
    { bankDeg: 20, turnRateDegS: 1.64, turnRadiusM: 4618, sustainedClimbRateMs: 10.0 },
    { bankDeg: 30, turnRateDegS: 2.57, turnRadiusM: 2932, sustainedClimbRateMs: 8.2 },
    { bankDeg: 40, turnRateDegS: 3.68, turnRadiusM: 2031, sustainedClimbRateMs: 5.4 },
    { bankDeg: 50, turnRateDegS: 5.21, turnRadiusM: 1420, sustainedClimbRateMs: 0.6 },
    { bankDeg: 60, turnRateDegS: 7.79, turnRadiusM: 928, sustainedClimbRateMs: -10.4 } ] },
  { iasKnots: 260, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: 13.6 },
    { bankDeg: 20, turnRateDegS: 1.42, turnRadiusM: 6330, sustainedClimbRateMs: 12.2 },
    { bankDeg: 30, turnRateDegS: 2.22, turnRadiusM: 4023, sustainedClimbRateMs: 10.4 },
    { bankDeg: 40, turnRateDegS: 3.17, turnRadiusM: 2806, sustainedClimbRateMs: 7.6 },
    { bankDeg: 50, turnRateDegS: 4.41, turnRadiusM: 1993, sustainedClimbRateMs: 3.6 },
    { bankDeg: 60, turnRateDegS: 6.49, turnRadiusM: 1329, sustainedClimbRateMs: -5.0 } ] },
  { iasKnots: 300, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: 15.4 },
    { bankDeg: 20, turnRateDegS: 1.27, turnRadiusM: 8189, sustainedClimbRateMs: 13.9 },
    { bankDeg: 30, turnRateDegS: 1.99, turnRadiusM: 5204, sustainedClimbRateMs: 11.9 },
    { bankDeg: 40, turnRateDegS: 2.83, turnRadiusM: 3633, sustainedClimbRateMs: 9.0 },
    { bankDeg: 50, turnRateDegS: 3.90, turnRadiusM: 2615, sustainedClimbRateMs: 5.0 },
    { bankDeg: 60, turnRateDegS: 5.59, turnRadiusM: 1792, sustainedClimbRateMs: -2.0 } ] },
  { iasKnots: 320, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: 16.1 },
    { bankDeg: 20, turnRateDegS: 1.21, turnRadiusM: 9158, sustainedClimbRateMs: 14.6 },
    { bankDeg: 30, turnRateDegS: 1.90, turnRadiusM: 5815, sustainedClimbRateMs: 12.5 },
    { bankDeg: 40, turnRateDegS: 2.70, turnRadiusM: 4060, sustainedClimbRateMs: 9.4 },
    { bankDeg: 50, turnRateDegS: 3.72, turnRadiusM: 2927, sustainedClimbRateMs: 5.3 },
    { bankDeg: 60, turnRateDegS: 5.24, turnRadiusM: 2041, sustainedClimbRateMs: -1.3 } ] },
]);

/** Measured and frozen limits of the scored regime. Outside these the table has
 * no data, so the contract never asks for it. */
export const SLALOM_IAS_MIN_KT = 220;
export const SLALOM_IAS_MAX_KT = 320;
/** 60 degrees holds 1.96 g with margin; the measured 70 degree rows sit at
 * 22-29 degrees angle of attack with flow separation, which is a departure. */
export const MAX_BANK_DEG = 60;
/** Wings-level to within 3 degrees of 60 degrees of bank: worst measured settle. */
export const ROLL_ESTABLISH_SECONDS = 1.6;
/** 5 Hz decisions plus the 24-tick command delay. */
export const CONTROL_LAG_SECONDS = 0.4;
/** The measured sustained climb rate is 27-36 m/s; a leg is a transient, so only
 * part of it is spent as a budget. */
export const CLIMB_BUDGET_MS = 27 * 0.8;
/** Fraction of the measured constant-speed sink ceiling a course may demand. */
export const SINK_MARGIN = 0.75;
/** Fraction of the measured sustained turn rate a course may demand. */
export const TURN_MARGIN = 0.85;
/** Height traded for airspeed is not free: the baseline trace loses 14-16 m/s
 * while gaining 3.2-3.7 kt/s, about 0.66 of the ideal conversion, because idle
 * thrust is still feeding the airframe. */
export const ENERGY_SINK_FACTOR = 0.6;

const KT_TO_MS = 0.514444;
const GRAVITY = 9.80665;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const interpolate = (x, points) => {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points.at(-1)[0]) return points.at(-1)[1];
  const index = points.findIndex(point => point[0] >= x);
  const [x1, y1] = points[index - 1], [x2, y2] = points[index];
  return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
};

const rowAt = iasKnots => MEASURED_ROWS[
  MEASURED_ROWS.reduce((best, row, index) =>
    Math.abs(row.iasKnots - iasKnots) < Math.abs(MEASURED_ROWS[best].iasKnots - iasKnots) ? index : best, 0)
];

/** Bilinear lookup on the measured grid, clamped at the edges: an unmeasured
 * condition returns the nearest measured one instead of an invented one. */
function sample(column, { iasKnots, bankDeg }) {
  const speed = clamp(iasKnots, SLALOM_IAS_MIN_KT, SLALOM_IAS_MAX_KT);
  const bank = clamp(bankDeg, 0, MAX_BANK_DEG);
  const values = MEASURED_ROWS.map(row => [row.iasKnots,
    interpolate(bank, row.rows.map(entry => [entry.bankDeg, entry[column]]))]);
  return interpolate(speed, values);
}

export function turnRateDegS({ iasKnots, bankDeg }) {
  return sample('turnRateDegS', { iasKnots, bankDeg });
}

export function turnRadiusM({ iasKnots, bankDeg = MAX_BANK_DEG }) {
  const omega = turnRateDegS({ iasKnots, bankDeg });
  return omega > 0.05 ? (iasKnots * KT_TO_MS) / (omega * Math.PI / 180) : Infinity;
}

/** Constant-airspeed vertical response: positive is climb, negative is sink. */
export function sustainedClimbRateMs({ iasKnots, bankDeg }) {
  return sample('sustainedClimbRateMs', { iasKnots, bankDeg });
}

/** The hardest sustained sink available at an airspeed, banked to the limit. */
export function maxSustainedSinkMs({ iasKnots }) {
  return Math.min(0, sustainedClimbRateMs({ iasKnots, bankDeg: MAX_BANK_DEG }));
}

/** Height a leg can trade for airspeed without leaving the band. */
export function energyDescentM({ entryIasKnots, exitIasKnots = SLALOM_IAS_MAX_KT }) {
  const entry = Math.min(entryIasKnots, SLALOM_IAS_MAX_KT) * KT_TO_MS;
  const exit = Math.min(exitIasKnots, SLALOM_IAS_MAX_KT) * KT_TO_MS;
  return Math.max(0, ENERGY_SINK_FACTOR * (exit ** 2 - entry ** 2) / (2 * GRAVITY));
}

/** Distance needed to put the wing on the other side: a full establishment, a
 * full unwind and the decision plus command lag. Two consecutive gates must be
 * spaced by at least this or the line they describe does not exist. */
export function bankReversalMeters({ iasKnots, fromBankDeg = 0, toBankDeg = MAX_BANK_DEG }) {
  return iasKnots * KT_TO_MS * (2 * rollSeconds({ fromBankDeg, toBankDeg }) + CONTROL_LAG_SECONDS);
}

/** Time from a bank command to the wing actually sitting there, shortened for a
 * shallower bank because the measured roll rate is roughly constant. */
function rollSeconds({ fromBankDeg = 0, toBankDeg = MAX_BANK_DEG } = {}) {
  const span = Math.max(Math.abs(fromBankDeg), Math.abs(toBankDeg));
  return ROLL_ESTABLISH_SECONDS * Math.sqrt(clamp(span / MAX_BANK_DEG, 0.25, 1));
}

/** Heading a leg can produce. One establishment is charged as dead time, not
 * two: a slalom line rolls through a gate rather than levelling out first, and
 * the ramp-in and ramp-out halves of consecutive legs overlap. */
export function turnBudgetDeg({ lengthM, headingIasKnots = 280 }) {
  const cruiseMs = clamp(headingIasKnots, SLALOM_IAS_MIN_KT, SLALOM_IAS_MAX_KT) * KT_TO_MS;
  const turningSeconds = Math.max(0, lengthM / cruiseMs
    - rollSeconds() - CONTROL_LAG_SECONDS);
  return turningSeconds * turnRateDegS({ iasKnots: headingIasKnots, bankDeg: MAX_BANK_DEG }) * TURN_MARGIN;
}

/** Checks one leg against the measured response. Nothing here knows a specific
 * valley: it answers only whether the aircraft in the game could fly the
 * geometry being asked of it. */
export function assessLeg({ lengthM, headingChangeDeg, altitudeChangeM,
  entryIasKnots = 280, exitIasKnots = entryIasKnots }) {
  const cruiseKt = clamp((entryIasKnots + exitIasKnots) / 2, SLALOM_IAS_MIN_KT, SLALOM_IAS_MAX_KT);
  const cruiseMs = cruiseKt * KT_TO_MS;
  const legSeconds = lengthM / cruiseMs;
  const climbBudgetM = CLIMB_BUDGET_MS * legSeconds;
  const sinkBudgetM = Math.max(
    -maxSustainedSinkMs({ iasKnots: entryIasKnots }) * SINK_MARGIN * legSeconds,
    energyDescentM({ entryIasKnots: entryIasKnots, exitIasKnots }));
  const shortfalls = [];
  if (Math.abs(headingChangeDeg) > turnBudgetDeg({ lengthM, headingIasKnots: cruiseKt })) shortfalls.push('turn');
  if (altitudeChangeM > climbBudgetM) shortfalls.push('climb');
  if (-altitudeChangeM > sinkBudgetM) shortfalls.push('sink');
  return { ok: shortfalls.length === 0, shortfalls,
    turnBudgetDeg: turnBudgetDeg({ lengthM, headingIasKnots: cruiseKt }),
    climbBudgetM, sinkBudgetM, legSeconds, cruiseKnots: cruiseKt };
}
