import { flyValley } from '../tests/helpers/valleyFlight.js';
import { createPilot } from '../src/pilot/examples/valley.js';

/** Host-only diagnostic that answers "why does the baseline valley pilot fly
 * high?" before any threshold or gain is touched. It reads the recorded trace of
 * an ordinary baseline run and reports what the aircraft was actually doing when
 * the pilot asked it to go down. Nothing here changes the pilot, the course or
 * the physics: it is a measurement over a production run. */

const seeds = (process.env.PILOT_SEEDS ?? '1,2,3').split(',').map(Number);

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

function bucket(label, rows) {
  if (!rows.length) return console.log(`  ${label.padEnd(20)}      0 ticks`);
  const roc = rows.map(r => r.roc).sort((a, b) => a - b);
  const dIas = rows.map(r => r.dIas).sort((a, b) => a - b);
  const bank = rows.map(r => Math.abs(r.rollDeg)).sort((a, b) => a - b);
  const ias = rows.map(r => r.iasKnots).sort((a, b) => a - b);
  const pct = count => (100 * count / rows.length).toFixed(0).padStart(3);
  console.log(`  ${label.padEnd(20)} ${String(rows.length).padStart(5)} ticks`
    + ` | bank ${quantile(bank, 0.5).toFixed(0).padStart(3)}° | IAS ${quantile(ias, 0.5).toFixed(0).padStart(3)} kt`
    + ` | ROC ${quantile(roc, 0.5).toFixed(1).padStart(6)} m/s | dIAS ${quantile(dIas, 0.5).toFixed(1).padStart(5)} kt/s`
    + ` | up ${pct(rows.filter(r => r.roc > 1).length)}% down ${pct(rows.filter(r => r.roc < -1).length)}%`);
}

for (const seed of seeds) {
  const { trace, commands, result } = await flyValley({ createPilot, seed,
    environmentProfile: 'mild-disturbance-v1', noise: true, sampleEveryTicks: 24 });
  // Rate of climb and airspeed trend between consecutive sampled snapshots.
  const rateByTick = new Map();
  for (let index = 1; index < trace.length; index++) {
    const previous = trace[index - 1], current = trace[index];
    const seconds = (current.tick - previous.tick) / 120;
    rateByTick.set(current.tick, { roc: (current.position.y - previous.position.y) / seconds,
      dIas: (current.iasKnots - previous.iasKnots) / seconds });
  }
  // The last command still in force at each sampled snapshot, so the pilot's
  // intent can be read against the state the plant produced.
  let pointer = 0, active = null;
  const rows = trace.map(snapshot => {
    while (pointer < commands.length && commands[pointer].tick <= snapshot.tick) active = commands[pointer++];
    const rate = rateByTick.get(snapshot.tick) ?? { roc: 0, dIas: 0 };
    return { ...snapshot, roc: rate.roc, dIas: rate.dIas,
      elevatorCmd: active?.elevator ?? null, aileronCmd: active?.aileron ?? null,
      throttleCmd: active?.throttle ?? null };
  });
  const metrics = result.metrics ?? {};
  console.log(`\n=== seed ${seed}: ${result.status}${result.reason ? ` (${result.reason})` : ''},`
    + ` medianAgl ${metrics.medianAglM?.toFixed(1)} m, altitudeCost ${metrics.altitudeCostM?.toFixed(1)} m,`
    + ` gates ${metrics.completedGates}/${metrics.totalGates} ===`);
  const agl = rows.map(r => r.aglM).sort((a, b) => a - b);
  console.log(`  AGL p10 ${quantile(agl, 0.1).toFixed(0)} m  p50 ${quantile(agl, 0.5).toFixed(0)} m`
    + `  p90 ${quantile(agl, 0.9).toFixed(0)} m  p99 ${quantile(agl, 0.99).toFixed(0)} m`);
  const idle = rows.filter(r => (r.throttleCmd ?? 0) < 0.02);
  console.log(`  idle-thrust ticks: ${idle.length} of ${rows.length} (${(100 * idle.length / rows.length).toFixed(0)}%)`);
  bucket('idle, bank < 20 deg', idle.filter(r => Math.abs(r.rollDeg) < 20));
  bucket('idle, bank 20-40 deg', idle.filter(r => Math.abs(r.rollDeg) >= 20 && Math.abs(r.rollDeg) < 40));
  bucket('idle, bank 40-55 deg', idle.filter(r => Math.abs(r.rollDeg) >= 40 && Math.abs(r.rollDeg) < 55));
  bucket('idle, bank >= 55 deg', idle.filter(r => Math.abs(r.rollDeg) >= 55));
  bucket('all ticks', rows);
  // Control intent against produced motion. The elevator sign convention is read
  // from the data instead of assumed: both tails of the command distribution are
  // reported, so the run itself shows which end asks for a lower flight path.
  const commanded = rows.filter(r => r.elevatorCmd !== null);
  const sorted = [...commanded].sort((a, b) => a.elevatorCmd - b.elevatorCmd);
  const tail = Math.max(1, Math.floor(sorted.length * 0.3));
  const nose = sorted.slice(0, tail), tailUp = sorted.slice(-tail);
  console.log(`  elevator tail mean ROC: low30% ${mean(nose).toFixed(1)} m/s over ${nose.length} ticks,`
    + ` high30% ${mean(tailUp).toFixed(1)} m/s over ${tailUp.length} ticks`);
  const stuckUp = (mean(nose) > mean(tailUp) ? nose : tailUp).filter(r => r.roc > 1);
  console.log(`  ticks in the lower-flight-path command tail that still gained altitude: ${stuckUp.length}`);
  const pinnedHigh = rows.filter(r => r.aglM > 150 && (r.throttleCmd ?? 0) < 0.02 && Math.abs(r.rollDeg) < 40);
  console.log(`  above 150 m AGL at idle thrust and under 40 deg bank: ${pinnedHigh.length} of ${rows.length}`
    + ` ticks (${(100 * pinnedHigh.length / rows.length).toFixed(0)}%), mean ROC ${mean(pinnedHigh).toFixed(1)} m/s`);
  const speeds = rows.map(r => r.iasKnots).sort((a, b) => a - b);
  console.log(`  IAS p50 ${quantile(speeds, 0.5).toFixed(0)} kt  p95 ${quantile(speeds, 0.95).toFixed(0)} kt`);
}

function mean(rows) {
  if (!rows.length) return 0;
  return rows.reduce((sum, r) => sum + r.roc, 0) / rows.length;
}
