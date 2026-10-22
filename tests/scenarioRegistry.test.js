import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPAWN_SCENARIOS,
  DEFAULT_SCENARIO,
  isScenarioAvailable,
  scenariosForAirport,
  scenarioLabelKey,
} from '../src/config/scenarioRegistry.js';
import { setLanguage, t } from '../src/i18n/index.js';

test('scenario availability is scoped to the airport', () => {
  assert.deepEqual(scenariosForAirport('coastal'), ['runway', 'approach', 'cruise']);
  assert.deepEqual(scenariosForAirport('lukla'), ['runway', 'approach', 'cruise', 'cliff']);
  assert.equal(isScenarioAvailable('coastal', 'cliff'), false);
  assert.equal(isScenarioAvailable('lukla', 'cliff'), true);
});

test('unknown airports or scenarios degrade to unavailable', () => {
  assert.deepEqual(scenariosForAirport('incheon'), []);
  assert.deepEqual(scenariosForAirport(undefined), []);
  assert.equal(isScenarioAvailable('lukla', 'goaround'), false);
  assert.equal(isScenarioAvailable('lukla', undefined), false);
  assert.equal(scenarioLabelKey('lukla', 'goaround'), undefined);
});

test('every airport has the default scenario', () => {
  for (const airport of ['coastal', 'lukla']) {
    assert.equal(isScenarioAvailable(airport, DEFAULT_SCENARIO), true);
  }
});

test('registry labels and briefing keys resolve in every locale', () => {
  for (const locale of ['en', 'ko']) {
    setLanguage(locale);
    for (const [type, scenario] of Object.entries(SPAWN_SCENARIOS)) {
      assert.notEqual(t(scenario.briefingKey), scenario.briefingKey, `${type} briefing key`);
      assert.ok(scenario.airports.length > 0, `${type} offered nowhere`);
      for (const airport of scenario.airports) {
        const key = scenario.labelKeys[airport];
        assert.ok(key, `${type} missing label for ${airport}`);
        assert.notEqual(t(key), key, `${type} label key at ${airport}`);
      }
    }
  }
  setLanguage('en');
});

test('scenario ids are unique across lobby and bar buttons', () => {
  const lobbyIds = Object.values(SPAWN_SCENARIOS).map((s) => s.lobbyButtonId);
  const barIds = Object.values(SPAWN_SCENARIOS).map((s) => s.barButtonId);
  assert.equal(new Set(lobbyIds).size, lobbyIds.length);
  assert.equal(new Set(barIds).size, barIds.length);
});
