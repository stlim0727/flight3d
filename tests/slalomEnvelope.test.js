import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEASURED_ROWS, MAX_BANK_DEG, SLALOM_IAS_MAX_KT, SLALOM_IAS_MIN_KT,
  assessLeg, bankReversalMeters, energyDescentM, maxSustainedSinkMs,
  sustainedClimbRateMs, turnBudgetDeg, turnRadiusM, turnRateDegS } from '../src/arena/slalomEnvelope.js';

/** The frozen table is a measurement, so it is checked against the file the
 * measurement script wrote: a hand-edit that changes a number without changing
 * the physics that produced it fails here. */
const envelope = JSON.parse(readFileSync(new URL('../docs/development/f16-valley-envelope.json',
  import.meta.url), 'utf8'));
const measured = (iasKnots, bankDeg, column) => Object.values(envelope.altitudes).map(altitude => {
  const row = altitude.sinks.find(entry => Math.abs(entry.bankDeg - bankDeg) <= 1.5
    && entry.iasKnots > iasKnots - 10 && entry.iasKnots <= iasKnots + 10);
  assert.ok(row, `missing measured row for ${iasKnots} kt at ${bankDeg} degrees`);
  return row[column];
});

test('frozen envelope table is the pessimistic side of the measurement', () => {
  for (const row of MEASURED_ROWS) {
    for (const entry of row.rows) {
      assert.equal(entry.turnRateDegS, +Math.min(...measured(row.iasKnots, entry.bankDeg, 'turnRateDegS')).toFixed(2),
        `turn rate at ${row.iasKnots} kt ${entry.bankDeg} deg`);
      const rates = measured(row.iasKnots, entry.bankDeg, 'climbRateMs').map(value => +value.toFixed(1));
      assert.equal(entry.sustainedClimbRateMs, Math.min(...rates),
        `climb rate at ${row.iasKnots} kt ${entry.bankDeg} deg`);
    }
  }
});

test('turn authority falls as airspeed rises and clamps at the measured edges', () => {
  assert.ok(turnRateDegS({ iasKnots: 220, bankDeg: 60 }) > turnRateDegS({ iasKnots: 320, bankDeg: 60 }));
  assert.equal(turnRateDegS({ iasKnots: 260, bankDeg: 60 }), 6.78);
  assert.equal(turnRateDegS({ iasKnots: 260, bankDeg: 80 }), turnRateDegS({ iasKnots: 260, bankDeg: MAX_BANK_DEG }));
  assert.equal(turnRateDegS({ iasKnots: 120, bankDeg: 60 }), turnRateDegS({ iasKnots: SLALOM_IAS_MIN_KT, bankDeg: 60 }));
  assert.equal(turnRateDegS({ iasKnots: 400, bankDeg: 60 }), turnRateDegS({ iasKnots: SLALOM_IAS_MAX_KT, bankDeg: 60 }));
  assert.ok(turnRadiusM({ iasKnots: 300, bankDeg: 60 }) > turnRadiusM({ iasKnots: 220, bankDeg: 60 }));
  assert.equal(turnRadiusM({ iasKnots: 300, bankDeg: 0 }), Infinity);
});

test('idle throttle produces sustained sink across all airspeeds and steep bank steepens it', () => {
  for (const iasKnots of [220, 260, 300, 320]) {
    assert.ok(sustainedClimbRateMs({ iasKnots, bankDeg: 0 }) < 0,
      `${iasKnots} kt wings level at idle naturally sinks`);
    assert.ok(maxSustainedSinkMs({ iasKnots }) < sustainedClimbRateMs({ iasKnots, bankDeg: 0 }),
      `${iasKnots} kt max bank produces deeper sink than wings level`);
  }
  assert.equal(maxSustainedSinkMs({ iasKnots: 220 }), -33.3);
  assert.ok(maxSustainedSinkMs({ iasKnots: 220 }) < maxSustainedSinkMs({ iasKnots: 320 }));
});

test('trading height for airspeed is worth far less than the ideal conversion', () => {
  assert.equal(energyDescentM({ entryIasKnots: 320 }), 0);
  const ideal = ((SLALOM_IAS_MAX_KT ** 2 - 260 ** 2) * 0.514444 ** 2) / (2 * 9.80665);
  assert.ok(energyDescentM({ entryIasKnots: 260 }) < 0.7 * ideal);
});

test('a bank reversal costs a leg length worth of distance', () => {
  const reversal = bankReversalMeters({ iasKnots: 280 });
  assert.ok(reversal > 500 && reversal < 1000, `reversal at 280 kt is ${reversal.toFixed(0)} m`);
  assert.ok(bankReversalMeters({ iasKnots: 280, toBankDeg: 30 }) < reversal);
});

test('leg assessment accepts what the airframe can fly and rejects what it cannot', () => {
  const carved = assessLeg({ lengthM: 900, headingChangeDeg: 20, altitudeChangeM: -40,
    entryIasKnots: 260, exitIasKnots: 300 });
  assert.equal(carved.ok, true, JSON.stringify(carved));
  const impossibleTurn = assessLeg({ lengthM: 250, headingChangeDeg: 40, altitudeChangeM: 0,
    entryIasKnots: 300 });
  assert.equal(impossibleTurn.ok, false);
  assert.ok(impossibleTurn.shortfalls.includes('turn'));
  const impossibleDive = assessLeg({ lengthM: 700, headingChangeDeg: 0, altitudeChangeM: -400,
    entryIasKnots: 320 });
  assert.equal(impossibleDive.ok, false);
  assert.ok(impossibleDive.shortfalls.includes('sink'));
  const impossibleClimb = assessLeg({ lengthM: 400, headingChangeDeg: 0, altitudeChangeM: 300,
    entryIasKnots: 300 });
  assert.equal(impossibleClimb.ok, false);
  assert.ok(impossibleClimb.shortfalls.includes('climb'));
});

test('a steep step-down beyond the sink budget is refused unless paid for in airspeed', () => {
  // 150 m of height over a 900 m leg: allowed if it is paid for in
  // airspeed, refused if the leg has to end at the speed it started.
  assert.equal(assessLeg({ lengthM: 900, headingChangeDeg: 0, altitudeChangeM: -150,
    entryIasKnots: 280, exitIasKnots: 280 }).ok, false);
  assert.ok(assessLeg({ lengthM: 900, headingChangeDeg: 0, altitudeChangeM: -150,
    entryIasKnots: 280, exitIasKnots: 280 }).sinkBudgetM < 150);
  assert.equal(assessLeg({ lengthM: 900, headingChangeDeg: 0, altitudeChangeM: -150,
    entryIasKnots: 280, exitIasKnots: 320 }).ok, true);
  assert.equal(assessLeg({ lengthM: 900, headingChangeDeg: 0, altitudeChangeM: 100,
    entryIasKnots: 280 }).ok, true);
});

test('a longer or slower leg turns further', () => {
  const fast = turnBudgetDeg({ lengthM: 900, headingIasKnots: 320 });
  const slow = turnBudgetDeg({ lengthM: 900, headingIasKnots: 220 });
  const longer = turnBudgetDeg({ lengthM: 1400, headingIasKnots: 320 });
  assert.ok(slow > fast, `${slow} should beat ${fast}`);
  assert.ok(longer > fast, `${longer} should beat ${fast}`);
  assert.ok(turnBudgetDeg({ lengthM: 100, headingIasKnots: 300 }) < 1);
});
