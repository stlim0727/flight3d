import { VALLEY_SLALOM_RULES, generateValley } from '../src/arena/generatedValley.js';

/** Fixes the course generation and validity criteria before any controller is
 * evaluated: the same seeds produce the same valleys, a rejected valley is
 * reported as a generation failure, and no course is dropped after seeing what
 * a pilot did on it. Dev seeds may be retuned; the evaluation seeds are frozen
 * separately and are only flown once the rules are. */

const rules = { ...VALLEY_SLALOM_RULES, ...JSON.parse(process.env.SLALOM_RULES ?? '{}') };
const devSeeds = (process.env.DEV_SEEDS ?? '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const evalSeeds = (process.env.EVAL_SEEDS ?? '101,102,103,104,105,106,107,108').split(',').map(Number);

function report(label, seeds) {
  const reasons = new Map();
  let accepted = 0, metres = 0, turns = 0;
  for (const seed of seeds) {
    const { course, assessment } = generateValley({ seed, rules });
    if (assessment.ok) {
      accepted++;
      metres += course.lengthM;
      const angles = course.gates.slice(1).map((gate, index) => Math.abs(((gate.headingDeg
        - course.gates[index].headingDeg + 540) % 360) - 180));
      turns += angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
      if (process.env.VERBOSE) {
        const legLengths = course.gates.slice(1).map((gate, index) => gate.sM - course.gates[index].sM);
        console.log(`  seed ${seed}: ${accepted ? 'ok' : ''} ${course.lengthM.toFixed(0)} m,`
          + ` legs ${Math.min(...legLengths).toFixed(0)}-${Math.max(...legLengths).toFixed(0)} m,`
          + ` bends ${Math.min(...angles).toFixed(0)}-${Math.max(...angles).toFixed(0)} deg,`
          + ` floor ${course.gates[0].floorM.toFixed(0)} -> ${course.gates.at(-1).floorM.toFixed(0)} m`);
      }
    } else {
      for (const failure of assessment.failures) reasons.set(failure.reason, (reasons.get(failure.reason) ?? 0) + 1);
      console.log(`  seed ${seed}: GENERATION FAILURE`
        + ` ${assessment.failures.slice(0, 3).map(f => `gate ${f.gateIndex} ${f.reason}`).join(', ')}`);
    }
  }
  const summary = { label, seeds: seeds.length, accepted,
    reasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])) };
  if (accepted) summary.meanLengthM = +(metres / accepted).toFixed(0);
  if (accepted) summary.meanBendDeg = +(turns / accepted).toFixed(1);
  console.log(`${label}: ${JSON.stringify(summary)}`);
  return summary;
}

console.log(`rules ${rules.version}: gates ${rules.gates}, legs ${rules.legLengthM[0]}-${rules.legLengthM[1]} m,`
  + ` bends ${rules.headingChangeDeg[0]}-${rules.headingChangeDeg[1]} deg,`
  + ` corridor ${rules.corridorHalfWidthM[0]}-${rules.corridorHalfWidthM[1]} m half-width,`
  + ` passage ${rules.passageMinAglM}-${rules.passageMinAglM + rules.passageBandM[1]} m AGL`);
const dev = report('dev', devSeeds);
const evaluation = report('eval', evalSeeds);
if (dev.accepted < dev.seeds || evaluation.accepted < evaluation.seeds) process.exitCode = 1;
