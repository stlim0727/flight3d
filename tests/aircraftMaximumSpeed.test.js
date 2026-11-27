import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerAddonAircraft } from '../src/config/aircraftConfigs.js';
import { aircraftPackFromProfile } from '../src/addons/aircraftPackBinding.js';
import {
  DEFAULT_MIN_SPEC_FRACTION,
  verifyAircraftPerformanceEnvelope,
} from '../src/addons/verifyAircraftEnvelope.js';

const CONCORDE_MANIFEST = new URL(
  './fixtures/concorde-addon.json',
  import.meta.url,
);

// A spec maximum-speed target must be measurably approached in headless
// physics, not only declared in configuration. The 80% floor leaves room for
// atmospheric and configuration differences while still catching aircraft
// whose thrust/drag model makes their published limit unreachable.
const CASES = [
  { id: 'B738', envelope: { cruiseAltitudeM: 11000, startTasKnots: 260, maxMach: 0.82 } },
  { id: 'C172', envelope: { cruiseAltitudeM: 3000, startTasKnots: 120, vneKnots: 163 } },
  { id: 'F16', envelope: { cruiseAltitudeM: 15000, startTasKnots: 450, maxMach: 2.05 } },
  { id: 'concorde', envelope: null },
];

function registerConcordeAddon() {
  const manifest = JSON.parse(readFileSync(CONCORDE_MANIFEST, 'utf8'));
  const sha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const descriptor = aircraftPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, sha256, manifest }],
  }, manifest.id, { coreVersion: '1.8.0' });
  registerAddonAircraft([descriptor]);
  return descriptor;
}

for (const entry of CASES) {
  test(`${entry.id} reaches at least ${DEFAULT_MIN_SPEC_FRACTION * 100}% of its spec maximum speed`, t => {
    let envelope = entry.envelope;
    if (entry.id === 'concorde') {
      const descriptor = registerConcordeAddon();
      envelope = descriptor.config.specs.performanceEnvelope;
    }
    const result = verifyAircraftPerformanceEnvelope(entry.id, envelope);
    assert.equal(result.crashed, false, `${entry.id} crashed during acceleration`);
    assert.equal(result.ok, true, result.errors.join('; '));
    t.diagnostic(
      `${entry.id}: spec ${result.spec} ${result.metric}, peak ${result.peak.toFixed(2)}, ${(result.ratio * 100).toFixed(0)}% of spec`,
    );
  });
}
