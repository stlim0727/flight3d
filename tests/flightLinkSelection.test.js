import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightCombinations, flightUrl, resolveFlightUrl } from '../src/config/flightUrls.js';
import { pilotCases, pilotCaseUrl, resolvePilotCase } from '../src/config/pilotCases.js';
import { selectFlightLink } from '../src/config/flightLinkSelection.js';

const flightKeys = ['airport', 'aircraft', 'scenario'];
const pilotKeys = ['type', 'environmentProfile', 'seed'];

test('every ordinary flight remains individually selectable without a fallback URL', () => {
  const rows = flightCombinations();
  for (const row of rows) {
    const selected = selectFlightLink(rows, row, flightKeys);
    assert.deepEqual(selected.row, row);
    assert.deepEqual(resolveFlightUrl(new URL(flightUrl(selected.row)).search, {}), row);
  }
});

test('changing terrain or aircraft replaces only now-unsupported dependent choices', () => {
  const rows = flightCombinations();
  const hangang = selectFlightLink(rows, { airport: 'hangang', aircraft: 'F16', scenario: 'cruise' }, flightKeys);
  assert.deepEqual(hangang.row, { airport: 'hangang', aircraft: 'C172', scenario: 'hangang' });
  assert.deepEqual(hangang.options.aircraft, ['C172']);
  const coastal = selectFlightLink(rows, { airport: 'coastal', aircraft: 'F16', scenario: 'demo' }, flightKeys);
  assert.equal(coastal.row.aircraft, 'F16');
  assert.ok(!coastal.options.scenario.includes('demo'));
  assert.notEqual(coastal.row.scenario, 'demo');
});

test('pilot selectors preserve exact case identity and reset a seed unavailable in the selected environment', () => {
  const rows = pilotCases();
  for (const row of rows) {
    const selected = selectFlightLink(rows, row, pilotKeys);
    assert.equal(selected.row.id, row.id);
    assert.deepEqual(resolvePilotCase(new URL(pilotCaseUrl(selected.row)).search), row);
  }
  const calm = selectFlightLink(rows, { type: 'landing', environmentProfile: 'calm-debug-v1', seed: 5 }, pilotKeys);
  assert.equal(calm.row.id, 'landing-calm');
  assert.deepEqual(calm.options.seed, [1]);
});

test('new mission kinds and aircraft work without reintroducing full-list rendering', () => {
  const valley = { id: 'valley-calm', type: 'valley', environmentProfile: 'calm-debug-v1', seed: 1,
    aircraft: 'F16', airport: 'lukla' };
  const selected = selectFlightLink([...pilotCases(), valley], { type: 'valley' }, pilotKeys);
  assert.equal(selected.row, valley);
  assert.equal(selected.row.aircraft, 'F16');
  assert.deepEqual(selectFlightLink([], {}, pilotKeys).row, null);
});
