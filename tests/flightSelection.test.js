import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRPORT_STORAGE_KEY,
  AIRCRAFT_STORAGE_KEY,
  PLANE_STORAGE_KEY,
  SCENARIO_STORAGE_KEY,
  PRESET_STORAGE_KEY,
  VALID_AIRPORTS,
  DEFAULT_AIRPORT,
  DEFAULT_AIRCRAFT,
  resolveAirport,
  resolveAircraft,
  resolveScenario,
  loadSavedFlightSelection,
  saveSavedAirport,
  saveSavedAircraft,
  saveSavedScenario,
  saveFlightSelection,
} from '../src/config/flightSelection.js';
import { DEFAULT_SCENARIO } from '../src/config/scenarioRegistry.js';

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get store() {
      return Object.fromEntries(store.entries());
    },
  };
}

test('storage keys follow repository convention', () => {
  assert.equal(AIRPORT_STORAGE_KEY, 'flight3d.airport');
  assert.equal(AIRCRAFT_STORAGE_KEY, 'flight3d.aircraft');
  assert.equal(PLANE_STORAGE_KEY, 'flight3d.plane');
  assert.equal(SCENARIO_STORAGE_KEY, 'flight3d.scenario');
  assert.equal(PRESET_STORAGE_KEY, 'flight3d.preset');
});

test('default selection constants are valid', () => {
  assert.equal(DEFAULT_AIRPORT, 'coastal');
  assert.equal(DEFAULT_AIRCRAFT, 'B738');
  assert.equal(DEFAULT_SCENARIO, 'runway');
  assert.deepEqual([...VALID_AIRPORTS], ['coastal', 'lukla', 'incheon', 'neon', 'hangang']);
});

test('resolveAirport accepts known airports and degrades unknown ones', () => {
  for (const airport of VALID_AIRPORTS) {
    assert.equal(resolveAirport(airport), airport);
  }
  for (const invalid of [null, undefined, '', 'unknown', 'mars', 123]) {
    assert.equal(resolveAirport(invalid), DEFAULT_AIRPORT);
  }
});

test('resolveAircraft accepts known aircraft and degrades unknown ones', () => {
  for (const aircraft of ['B738', 'C172', 'F16']) {
    assert.equal(resolveAircraft(aircraft), aircraft);
  }
  for (const invalid of [null, undefined, '', 'A320', 'Concorde', 747]) {
    assert.equal(resolveAircraft(invalid), DEFAULT_AIRCRAFT);
  }
});

test('resolveScenario validates scenario availability and demo constraints', () => {
  // Common scenarios
  assert.equal(resolveScenario('runway', 'coastal', 'B738'), 'runway');
  assert.equal(resolveScenario('approach', 'lukla', 'C172'), 'approach');
  assert.equal(resolveScenario('cruise', 'incheon', 'B738'), 'cruise');
  assert.equal(resolveScenario('cliff', 'lukla', 'B738'), 'cliff');

  // Incompatible scenario for airport
  assert.equal(resolveScenario('cliff', 'coastal', 'B738'), DEFAULT_SCENARIO);
  assert.equal(resolveScenario('cliff', 'incheon', 'C172'), DEFAULT_SCENARIO);
  assert.equal(resolveScenario('invalid_preset', 'lukla', 'B738'), DEFAULT_SCENARIO);

  // Demo constraints
  assert.equal(resolveScenario('demo', 'lukla', 'F16'), 'demo');
  assert.equal(resolveScenario('demo', 'coastal', 'F16'), DEFAULT_SCENARIO);
  assert.equal(resolveScenario('demo', 'incheon', 'B738'), 'demo');
  assert.equal(resolveScenario('demo', 'incheon', 'C172'), 'demo');
  assert.equal(resolveScenario('demo', 'incheon', 'F16'), DEFAULT_SCENARIO);

  // Missing or non-string
  assert.equal(resolveScenario(null), DEFAULT_SCENARIO);
  assert.equal(resolveScenario(undefined), DEFAULT_SCENARIO);
  assert.equal(resolveScenario(123), DEFAULT_SCENARIO);
});

test('loadSavedFlightSelection restores defaults when storage is empty', () => {
  const storage = createMockStorage();
  const selection = loadSavedFlightSelection(storage);
  assert.deepEqual(selection, {
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'runway',
  });
});

test('loadSavedFlightSelection restores saved airport, aircraft, and scenario', () => {
  const storage = createMockStorage({
    'flight3d.airport': 'lukla',
    'flight3d.aircraft': 'C172',
    'flight3d.scenario': 'approach',
  });
  const selection = loadSavedFlightSelection(storage);
  assert.deepEqual(selection, {
    airport: 'lukla',
    aircraft: 'C172',
    scenario: 'approach',
  });
});

test('loadSavedFlightSelection supports alternate plane and preset storage keys', () => {
  const storage = createMockStorage({
    'flight3d.airport': 'neon',
    'flight3d.plane': 'F16',
    'flight3d.preset': 'cruise',
  });
  const selection = loadSavedFlightSelection(storage);
  assert.deepEqual(selection, {
    airport: 'neon',
    aircraft: 'F16',
    scenario: 'cruise',
  });
});

test('loadSavedFlightSelection degrades invalid or incompatible stored values', () => {
  const storage = createMockStorage({
    'flight3d.airport': 'coastal',
    'flight3d.aircraft': 'SpaceShuttle',
    'flight3d.scenario': 'cliff', // Cliff is only at Lukla
  });
  const selection = loadSavedFlightSelection(storage);
  assert.deepEqual(selection, {
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'runway',
  });
});

test('loadSavedFlightSelection safely handles unavailable or throwing storage', () => {
  const throwingStorage = {
    getItem() {
      throw new Error('Access denied (e.g. private browsing)');
    },
  };
  const selection = loadSavedFlightSelection(throwingStorage);
  assert.deepEqual(selection, {
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'runway',
  });
  assert.deepEqual(loadSavedFlightSelection(null), {
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'runway',
  });
});

test('saveSavedAirport, saveSavedAircraft, saveSavedScenario write to storage', () => {
  const storage = createMockStorage();

  saveSavedAirport('lukla', storage);
  assert.equal(storage.getItem('flight3d.airport'), 'lukla');

  saveSavedAircraft('C172', storage);
  assert.equal(storage.getItem('flight3d.aircraft'), 'C172');
  assert.equal(storage.getItem('flight3d.plane'), 'C172');

  saveSavedScenario('approach', storage);
  assert.equal(storage.getItem('flight3d.scenario'), 'approach');
  assert.equal(storage.getItem('flight3d.preset'), 'approach');
});

test('saveFlightSelection writes all properties', () => {
  const storage = createMockStorage();
  saveFlightSelection({ airport: 'neon', aircraft: 'F16', scenario: 'cruise' }, storage);

  assert.equal(storage.getItem('flight3d.airport'), 'neon');
  assert.equal(storage.getItem('flight3d.aircraft'), 'F16');
  assert.equal(storage.getItem('flight3d.plane'), 'F16');
  assert.equal(storage.getItem('flight3d.scenario'), 'cruise');
  assert.equal(storage.getItem('flight3d.preset'), 'cruise');
});

test('saving safely ignores throwing or missing storage', () => {
  const throwingStorage = {
    setItem() {
      throw new Error('Storage full');
    },
  };
  assert.doesNotThrow(() => saveSavedAirport('lukla', throwingStorage));
  assert.doesNotThrow(() => saveSavedAircraft('C172', throwingStorage));
  assert.doesNotThrow(() => saveSavedScenario('approach', throwingStorage));
  assert.doesNotThrow(() => saveFlightSelection({ airport: 'lukla' }, null));
  assert.doesNotThrow(() => saveSavedAirport(null, createMockStorage()));
  assert.doesNotThrow(() => saveSavedAircraft('', createMockStorage()));
  assert.doesNotThrow(() => saveSavedScenario(undefined, createMockStorage()));
});

test('roundtrip saving and restoring matches selection across page reloads', () => {
  const storage = createMockStorage();

  saveFlightSelection({
    airport: 'lukla',
    aircraft: 'F16',
    scenario: 'cliff',
  }, storage);

  const restored = loadSavedFlightSelection(storage);
  assert.deepEqual(restored, {
    airport: 'lukla',
    aircraft: 'F16',
    scenario: 'cliff',
  });
});


test('Hangang persists as an independent region with a valid default and C172', () => {
  const storage = createMockStorage();
  saveFlightSelection({airport:'hangang', aircraft:'B738', scenario:'runway'}, storage);
  assert.deepEqual(loadSavedFlightSelection(storage), {airport:'hangang', aircraft:'C172', scenario:'hangang'});
  assert.equal(resolveScenario(null, 'hangang'), 'hangang');
  for (const airport of ['coastal','incheon','lukla','neon']) assert.equal(resolveScenario('hangang', airport), 'runway');
});
