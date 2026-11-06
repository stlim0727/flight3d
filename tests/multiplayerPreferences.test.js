import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMultiplayerPreferences, MULTIPLAYER_PREFERENCES_KEY } from '../src/multiplayer/preferences.js';

function form() {
  const fields = Object.fromEntries(Object.entries({ name: 'Pilot', airport: 'coastal', aircraft: 'C172', scenario: 'cruise' }).map(([key, value]) => {
    const element = new EventTarget(); element.value = value;
    return [key, element];
  }));
  return { fields, getElementById: id => fields[id.slice(3)] };
}

test('name edits and selection changes survive a new form before joining', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const first = form(); bindMultiplayerPreferences(first, storage);
  first.fields.name.value = 'Wing'; first.fields.name.dispatchEvent(new Event('input'));
  for (const [key, value] of Object.entries({ airport: 'neon', aircraft: 'F16', scenario: 'runway' })) {
    first.fields[key].value = value; first.fields[key].dispatchEvent(new Event('change'));
  }
  const next = form(); bindMultiplayerPreferences(next, storage);
  assert.deepEqual(Object.fromEntries(Object.entries(next.fields).map(([key, el]) => [key, el.value])), {
    name: 'Wing', airport: 'neon', aircraft: 'F16', scenario: 'runway',
  });
  assert.deepEqual([...data.keys()], [MULTIPLAYER_PREFERENCES_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(data.get(MULTIPLAYER_PREFERENCES_KEY))).sort(), ['aircraft', 'airport', 'name', 'scenario']);
});

test('malformed, outdated, and blocked storage retain usable defaults', () => {
  for (const raw of ['{', 'null', '[]', JSON.stringify({ name: 42, airport: 'removed', aircraft: 'unknown', scenario: 'demo' })]) {
    const root = form(); bindMultiplayerPreferences(root, { getItem: () => raw });
    assert.equal(root.fields.name.value, 'Pilot'); assert.equal(root.fields.airport.value, 'coastal');
    assert.equal(root.fields.aircraft.value, 'C172'); assert.equal(root.fields.scenario.value, 'cruise');
  }
  const root = form();
  const prefs = bindMultiplayerPreferences(root, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.doesNotThrow(() => prefs.save());
  assert.doesNotThrow(() => root.fields.name.dispatchEvent(new Event('input')));
});
