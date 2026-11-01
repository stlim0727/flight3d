/** The measured response of the production F-16 in the low-level slalom regime,
 * frozen from `docs/development/f16-valley-envelope.json`, which
 * `scripts/measure-valley-envelope.mjs` writes with
 * `scripts/lib/f16EnvelopeProbe.mjs`. Course geometry and judging limits are
 * derived from these numbers, so a course can only ask for what the aircraft in
 * the game actually does. Values are the pessimistic side of both measured
 * altitudes; nothing outside the measured range is extrapolated.
 *
 * With PR #384 eliminating the idle thrust creep artifact, throttle at idle
 * produces a sustained natural sink across all speeds in the band
 * (-10.6 to -16.2 m/s wings-level). Bank steepens the sink through induced drag,
 * reaching -28.5 to -33.3 m/s at 60 degrees. Climb authority is 27-36 m/s
 * at a third of the throttle. Losing height is natural and sustained even
 * wings-level, and deepens in turns. */

export const SLALOM_ENVELOPE_VERSION = 'f16-slalom-envelope-v1';

/** Airspeeds at which the plant was held, each with its measured banked rows. */
export const MEASURED_ROWS = Object.freeze([
  { iasKnots: 220, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: -10.6 },
    { bankDeg: 20, turnRateDegS: 1.47, turnRadiusM: 4807, sustainedClimbRateMs: -11.8 },
    { bankDeg: 30, turnRateDegS: 2.39, turnRadiusM: 2966, sustainedClimbRateMs: -13.2 },
    { bankDeg: 40, turnRateDegS: 3.57, turnRadiusM: 1979, sustainedClimbRateMs: -15.8 },
    { bankDeg: 50, turnRateDegS: 5.29, turnRadiusM: 1330, sustainedClimbRateMs: -21.0 },
    { bankDeg: 60, turnRateDegS: 8.38, turnRadiusM: 827, sustainedClimbRateMs: -33.3 } ] },
  { iasKnots: 260, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: -12.1 },
    { bankDeg: 20, turnRateDegS: 1.23, turnRadiusM: 6842, sustainedClimbRateMs: -13.1 },
    { bankDeg: 30, turnRateDegS: 1.99, turnRadiusM: 4214, sustainedClimbRateMs: -14.2 },
    { bankDeg: 40, turnRateDegS: 2.98, turnRadiusM: 2809, sustainedClimbRateMs: -16.2 },
    { bankDeg: 50, turnRateDegS: 4.40, turnRadiusM: 1895, sustainedClimbRateMs: -20.3 },
    { bankDeg: 60, turnRateDegS: 6.78, turnRadiusM: 1214, sustainedClimbRateMs: -29.6 } ] },
  { iasKnots: 300, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: -14.6 },
    { bankDeg: 20, turnRateDegS: 1.05, turnRadiusM: 9249, sustainedClimbRateMs: -15.6 },
    { bankDeg: 30, turnRateDegS: 1.69, turnRadiusM: 5715, sustainedClimbRateMs: -16.5 },
    { bankDeg: 40, turnRateDegS: 2.54, turnRadiusM: 3800, sustainedClimbRateMs: -18.0 },
    { bankDeg: 50, turnRateDegS: 3.76, turnRadiusM: 2560, sustainedClimbRateMs: -21.2 },
    { bankDeg: 60, turnRateDegS: 5.75, turnRadiusM: 1656, sustainedClimbRateMs: -28.5 } ] },
  { iasKnots: 320, rows: [
    { bankDeg: 0, turnRateDegS: 0, turnRadiusM: null, sustainedClimbRateMs: -16.2 },
    { bankDeg: 20, turnRateDegS: 0.97, turnRadiusM: 10592, sustainedClimbRateMs: -17.1 },
    { bankDeg: 30, turnRateDegS: 1.56, turnRadiusM: 6581, sustainedClimbRateMs: -18.2 },
    { bankDeg: 40, turnRateDegS: 2.35, turnRadiusM: 4369, sustainedClimbRateMs: -19.5 },
    { bankDeg: 50, turnRateDegS: 3.49, turnRadiusM: 2938, sustainedClimbRateMs: -22.2 },
    { bankDeg: 60, turnRateDegS: 5.34, turnRadiusM: 1901, sustainedClimbRateMs: -28.7 } ] },
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
 * while gaining 3.2-3.7 kt/s, about 0.66 of the ideal conversion. */
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
    energyDescentM({ entryIasKnots, exitIasKnots }));
  const shortfalls = [];
  if (Math.abs(headingChangeDeg) > turnBudgetDeg({ lengthM, headingIasKnots: cruiseKt })) shortfalls.push('turn');
  if (altitudeChangeM > climbBudgetM) shortfalls.push('climb');
  if (-altitudeChangeM > sinkBudgetM) shortfalls.push('sink');
  return { ok: shortfalls.length === 0, shortfalls,
    turnBudgetDeg: turnBudgetDeg({ lengthM, headingIasKnots: cruiseKt }),
    climbBudgetM, sinkBudgetM, legSeconds, cruiseKnots: cruiseKt };
}
