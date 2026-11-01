import { writeFile } from 'node:fs/promises';
import { probe, probeRollResponse } from './lib/f16EnvelopeProbe.mjs';

/** Rendererless measurement of the shared F-16 game model, used to size the
 * valley slalom course. No terrain, no navigation and no pilot logic is
 * involved: the fixture holds an attitude or an airspeed and the report states
 * where the plant actually settled. Rules are derived from these numbers, never
 * from a previous controller's score. */

const altitudes = (process.env.ENVELOPE_ALTITUDES ?? '2100,2500').split(',').map(Number);
const throttles = [0, 0.05, 0.1, 0.15, 0.25];
const banks = [0, 20, 30, 40, 50, 60, 70];
const bandBanks = [0, 20, 30, 40, 50, 60];
const bandSpeeds = [220, 260, 300, 320];
const speeds = [220, 240, 260, 280, 300, 320];
const output = process.env.ENVELOPE_REPORT ?? 'docs/development/f16-valley-envelope.json';

function run(label, parameters) {
  const a = probe(parameters).achieved;
  console.log(`${label.padEnd(26)} ias ${a.iasKnots.toFixed(0).padStart(3)}±${a.iasSpreadKt.toFixed(0).padStart(2)}`
    + ` dIAS ${a.iasDriftKtPerS.toFixed(2).padStart(5)}kt/s bank ${a.bankDeg.toFixed(0).padStart(3)}°`
    + ` ω ${a.turnRateDegS.toFixed(2).padStart(5)}°/s R ${(a.turnRadiusM === null ? Infinity : a.turnRadiusM).toFixed(0).padStart(5)}m`
    + ` γ ${a.flightPathAngleDeg.toFixed(1).padStart(5)}° ROC ${a.climbRateMs.toFixed(1).padStart(6)}m/s`
    + ` thr ${a.throttleMean.toFixed(2)} satT ${a.saturatedPct.throttle.toFixed(0).padStart(3)}%`
    + ` spread ${a.altitudeSpreadM.toFixed(1).padStart(5)}m α ${a.alphaDeg.toFixed(1).padStart(4)}°`
    + ` G ${a.gForce.toFixed(2)} sep ${a.separation.toFixed(2)}`
    + (a.crashed ? ' CRASHED' : ''));
  return { ...parameters, ...a };
}

const report = { measuredWith: { aircraftId: 'F16', massKg: 12000, gearUp: true, flapIndex: 0,
  spoilers: 0, wind: 'none', fixture: 'cascaded attitude hold, scripts/lib/f16EnvelopeProbe.mjs' },
altitudes: {} };

for (const altitudeMeters of altitudes) {
  console.log(`\n=== ${altitudeMeters} m MSL ===`);
  console.log('-- sustained turn: altitude held, throttle pinned; airspeed is the plant equilibrium');
  const turns = [];
  for (const throttle of throttles) for (const bankDeg of banks) {
    turns.push(run(`turn thr ${throttle} bank ${bankDeg}`,
      { altitudeMeters, bankDeg, throttle, hold: 'altitude' }));
  }
  // Airspeed on pitch, path on throttle, with the vertical path demanded far
  // beyond what the airframe can hold. The loop then sits against whichever
  // authority runs out first, so the achieved rate is the sustainable limit at
  // that airspeed and bank instead of a commanded aspiration.
  console.log('-- descent authority: airspeed held, sink demanded past the limit; achieved ROC is the ceiling');
  const sinks = [];
  for (const iasKnots of bandSpeeds) for (const bankDeg of bandBanks) {
    sinks.push(run(`sink ias ${iasKnots} bank ${bankDeg}`,
      { altitudeMeters, iasKnots, bankDeg, hold: 'energy', sinkRateMs: 40,
        seconds: 48, settleSeconds: 30 }));
  }
  console.log('-- climb authority: airspeed held, climb demanded past the limit');
  const climbs = [];
  for (const iasKnots of bandSpeeds) for (const bankDeg of [0, 30]) {
    climbs.push(run(`climb ias ${iasKnots} bank ${bankDeg}`,
      { altitudeMeters, iasKnots, bankDeg, hold: 'energy', sinkRateMs: -25,
        seconds: 48, settleSeconds: 30 }));
  }
  console.log('-- roll response from wings level (production surface rate limits)');
  const rolls = speeds.map(speed => {
    const entry = probeRollResponse({ altitudeMeters, iasKnots: speed, bankDeg: 60 });
    console.log(`roll ${String(speed).padStart(3)} kt: 15° ${entry.roll.to15Deg?.toFixed(2)}s`
      + ` 30° ${entry.roll.to30Deg?.toFixed(2)}s 45° ${entry.roll.to45Deg?.toFixed(2)}s`
      + ` 60° ${entry.roll.to60Deg?.toFixed(2)}s peak ${entry.roll.peakRateDegS.toFixed(0)}°/s`
      + ` settled ${entry.roll.settled?.toFixed(2)}s`);
    return { iasKnots: speed, ...entry.roll };
  });
  report.altitudes[altitudeMeters] = { turns, sinks, climbs, rolls };
}

await writeFile(new URL(`../${output}`, import.meta.url), JSON.stringify(report, null, 2));
console.log(`\nWrote ${output}`);
