#!/usr/bin/env node
import {
  simulateCombatSituation,
  sweepCombatSituationMatrix,
  detectMissileAnomalies,
} from './lib/combatSituationMatrix.mjs';

console.log('=== FLIGHT3D F-16 AIR-TO-AIR COMBAT SITUATION MATRIX & ANOMALY EXPLORATION ===\n');

const start = performance.now();
const results = sweepCombatSituationMatrix({
  types: ['AIM9X', 'AIM120C'],
  ranges: [400, 800, 1500, 3000, 5000, 7000, 9000, 10000],
  aspects: [0, 45, 90, 135, 180],
  altitudes: [1500, 8000],
  behaviors: ['straight', 'orbit', 'break_turn', 'evasive_ai'],
  cms: [false, true],
});
const duration = ((performance.now() - start) / 1000).toFixed(2);

console.log(`Simulated ${results.length} combat situations across physical parameters in ${duration}s.`);

const totalLaunched = results.filter(r => r.launched).length;
const totalHits = results.filter(r => r.terminal === 'hit').length;
const totalNoLock = results.filter(r => r.terminal === 'no-lock').length;
const totalMisses = results.filter(r => r.terminal && r.terminal.startsWith('miss')).length;
const nonLethalFuzes = results.filter(r => r.terminal === 'detonation-non-lethal').length;

console.log(`- Total Situations: ${results.length}`);
console.log(`- Rail Locked & Launched: ${totalLaunched}`);
console.log(`- Lock Refused / Out of Seeker FOV: ${totalNoLock}`);
console.log(`- Splashes (Hits): ${totalHits} (${((totalHits / totalLaunched) * 100).toFixed(1)}% of launches)`);
console.log(`- Clean Misses: ${totalMisses}`);
console.log(`- Proximity Fuze Non-Lethal Bursts: ${nonLethalFuzes}`);

console.log('\n--- DETECTED MISSILE ANOMALIES ---');
const anomalies = detectMissileAnomalies(results);
for (const a of anomalies) {
  console.log(`\n[${a.severity.toUpperCase()}] ${a.title} (${a.id})`);
  console.log(`  Count: ${a.count}`);
  console.log(`  Description: ${a.description}`);
  if (a.sample) {
    console.log(`  Sample case: Type=${a.sample.type}, Range=${a.sample.rangeM}m, Aspect=${a.sample.aspectDeg}°, Behavior=${a.sample.targetBehavior}, CM=${a.sample.countermeasures}, Terminal=${a.sample.terminal}`);
  }
}

console.log('\n==============================================================================');
