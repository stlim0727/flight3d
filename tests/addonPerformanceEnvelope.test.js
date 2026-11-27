import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { verifyAddonRuntime } from '../src/addons/verifyAddonRuntime.js';

const CONCORDE_MANIFEST = JSON.parse(
  readFileSync(new URL('./fixtures/concorde-addon.json', import.meta.url), 'utf8'),
);

test('validateAddonManifest validates aircraft.physics.specs.performanceEnvelope', () => {
  const valid = validateAddonManifest(CONCORDE_MANIFEST, { coreVersion: '1.8.0' });
  assert.equal(valid.ok, true, valid.errors.join('; '));

  const bad = structuredClone(CONCORDE_MANIFEST);
  bad.aircraft.physics.specs.performanceEnvelope = {
    cruiseAltitudeM: -100,
    startTasKnots: 0,
    useReheat: 'yes',
    durationSec: 9999,
  };
  const invalid = validateAddonManifest(bad, { coreVersion: '1.8.0' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(err => err.includes('cruiseAltitudeM')));
  assert.ok(invalid.errors.some(err => err.includes('startTasKnots')));
  assert.ok(invalid.errors.some(err => err.includes('requires maxMach or vneKnots')));
  assert.ok(invalid.errors.some(err => err.includes('useReheat')));
  assert.ok(invalid.errors.some(err => err.includes('durationSec')));
});

test('verifyAddonRuntime automatically checks declared performanceEnvelope and reports stats', async () => {
  const result = await verifyAddonRuntime(CONCORDE_MANIFEST, {
    coreVersion: '1.8.0',
    strict: true,
    requireLocalAssets: false,
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.stats.performanceEnvelope.metric, 'mach');
  assert.equal(result.stats.performanceEnvelope.spec, 2.0);
  assert.ok(result.stats.performanceEnvelope.ratio >= 0.8);
});

test('verifyAddonRuntime fails when declared performanceEnvelope target is unreachable', async () => {
  const unreachable = structuredClone(CONCORDE_MANIFEST);
  unreachable.aircraft.physics.specs.performanceEnvelope = {
    cruiseAltitudeM: 18300,
    startTasKnots: 520,
    maxMach: 5.0,
    useReheat: true,
    durationSec: 15,
  };
  const result = await verifyAddonRuntime(unreachable, {
    coreVersion: '1.8.0',
    strict: true,
    requireLocalAssets: false,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(err => err.includes('of spec 5')));
});
