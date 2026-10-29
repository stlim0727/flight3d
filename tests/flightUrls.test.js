import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFlightUrl, flightCombinations, flightUrl } from '../src/config/flightUrls.js';
const saved = { airport: 'lukla', aircraft: 'F16', scenario: 'cruise' };
test('URL overrides saved selection, preserving omitted fields', () => {
  assert.deepEqual(resolveFlightUrl('', saved), saved);
  assert.deepEqual(resolveFlightUrl('?aircraft=C172&terrain=coastal&scenario=approach', saved), { airport: 'coastal', aircraft: 'C172', scenario: 'approach' });
  assert.deepEqual(resolveFlightUrl('?scenario=runway', saved), { ...saved, scenario: 'runway' });
});
test('invalid values and unsupported combinations resolve safely', () => {
  assert.deepEqual(resolveFlightUrl('?aircraft=no&terrain=no&scenario=no', saved), { airport: 'coastal', aircraft: 'B738', scenario: 'runway' });
  assert.deepEqual(resolveFlightUrl('?terrain=hangang&aircraft=F16&scenario=demo', saved), { airport: 'hangang', aircraft: 'C172', scenario: 'hangang' });
  assert.equal(resolveFlightUrl('?terrain=coastal&aircraft=F16&scenario=demo', saved).scenario, 'runway');
});
test('every listed combination round trips without substitution', () => {
  const rows = flightCombinations();
  assert.equal(rows.length, 48);
  assert.equal(new Set(rows.map(row => flightUrl(row))).size, rows.length);
  for (const row of rows) {
    const url = new URL(flightUrl(row));
    assert.equal(url.origin + url.pathname, 'https://stlim0727.github.io/flight3d/');
    assert.deepEqual(resolveFlightUrl(url.search, saved), row);
  }
});

test('inherited property names in URL scenarios fall back without throwing', () => {
  for (const scenario of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    for (const airport of ['coastal', 'lukla', 'incheon', 'neon', 'hangang']) {
      const result = resolveFlightUrl(`?terrain=${airport}&scenario=${scenario}`, saved);
      assert.equal(result.airport, airport);
      assert.equal(result.scenario, airport === 'hangang' ? 'hangang' : 'runway');
    }
  }
});
