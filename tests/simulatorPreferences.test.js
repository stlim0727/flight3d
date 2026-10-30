import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SIMULATOR_PREFERENCES_KEY, loadSimulatorPreferences, saveSimulatorPreferences,
  restoreSimulatorPreferences } from '../src/config/simulatorPreferences.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { resolveDemoProfile } from '../src/director/demoProfiles.js';
import { installSimulatorHudAndBindings } from '../src/ui/SimulatorHudAndBindings.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('independent preference updates survive reload, including midnight and false toggles', () => {
  const storage = memoryStorage();
  saveSimulatorPreferences({ timeOfDay: 0, audioMuted: true }, storage);
  saveSimulatorPreferences({ touchControls: false, demoProfile: 'maneuvers' }, storage);
  saveSimulatorPreferences({ audioMuted: false }, storage);
  assert.deepEqual(loadSimulatorPreferences(storage), {
    timeOfDay: 0, audioMuted: false, touchControls: false, demoProfile: 'maneuvers',
  });
  saveSimulatorPreferences({ timeOfDay: 23.5 }, storage);
  assert.equal(loadSimulatorPreferences(storage).timeOfDay, 23.5);
});

test('missing, corrupt and unavailable storage retain defaults without breaking startup', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadSimulatorPreferences(storage), {});
  for (const raw of ['{broken', 'null', '[]', '"night"']) {
    storage.setItem(SIMULATOR_PREFERENCES_KEY, raw);
    assert.deepEqual(loadSimulatorPreferences(storage), {});
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.deepEqual(loadSimulatorPreferences(blocked), {});
  assert.doesNotThrow(() => saveSimulatorPreferences({ timeOfDay: 21 }, blocked));
  assert.doesNotThrow(() => saveSimulatorPreferences({ timeOfDay: 21 }, null));
});

test('invalid preferences cannot poison rendering or overwrite valid settings', () => {
  const storage = memoryStorage();
  saveSimulatorPreferences({ timeOfDay: 22, audioMuted: true }, storage);
  for (const timeOfDay of [NaN, Infinity, -1, 24, '22', null]) {
    saveSimulatorPreferences({ timeOfDay, audioMuted: 'false', touchControls: 1,
      demoProfile: '<script>', throttle: 1 }, storage);
    assert.deepEqual(loadSimulatorPreferences(storage), { timeOfDay: 22, audioMuted: true });
  }
});

test('reload restores atmosphere, sound, touch visibility and demo choice before automatic demo time changes', () => {
  const storage = memoryStorage();
  saveSimulatorPreferences({ timeOfDay: 0, audioMuted: true, touchControls: false, demoProfile: 'maneuvers' }, storage);
  const sim = {
    sky: new SkyAtmosphere(new THREE.Scene()),
    foliage: { setTimeOfDay(hour) { this.hour = hour; } },
    water: { syncWithAtmosphere(sky) { this.hour = sky.timeOfDay; } },
    audio: { setMuted(value) { this.isMuted = value; } },
    touchControls: { enabled: true, enable() { this.enabled = true; }, disable() { this.enabled = false; } },
    lobby: {},
  };
  sim.demoDirector = Object.create(DemoFlightDirector.prototype);
  sim.demoDirector.sim = sim;
  restoreSimulatorPreferences(sim, loadSimulatorPreferences(storage));
  assert.equal(sim.sky.timeOfDay, 0);
  assert.equal(sim.foliage.hour, 0);
  assert.equal(sim.water.hour, 0);
  assert.equal(sim.audio.isMuted, true);
  assert.equal(sim.touchControls.enabled, false);
  assert.equal(resolveDemoProfile('C172', 'coastal', sim.lobby.demoProfile).id, 'maneuvers');
  sim.demoDirector.setTimeOfDay(6.5);
  assert.equal(sim.sky.timeOfDay, 0, 'A demo must respect the restored user time immediately on startup');
  assert.equal(loadSimulatorPreferences(storage).timeOfDay, 0);
  sim.sky.cloudLayer.dispose();
});

test('first visit keeps automatic time and device detection; explicit preferences can re-enable sound and touch', () => {
  const sim = { lobby: {} };
  assert.doesNotThrow(() => restoreSimulatorPreferences(sim, {}), 'No saved preference must leave defaults alone');
  Object.assign(sim, {
    audio: { setMuted(value) { this.isMuted = value; } },
    touchControls: { enable() { this.enabled = true; } },
  });
  restoreSimulatorPreferences(sim, { audioMuted: false, touchControls: true });
  assert.equal(sim.audio.isMuted, false);
  assert.equal(sim.touchControls.enabled, true);
});

test('keyboard time adjustments use the same persistent path as menu time changes', () => {
  class Sim {}
  installSimulatorHudAndBindings(Sim);
  const sim = new Sim();
  sim.controls = {};
  sim.sky = { timeOfDay: 23.5 };
  sim.setTimeOfDay = hours => { sim.requestedTime = hours; };
  sim.initControls();
  sim.controls.onCycleTimeOfDay(1);
  assert.equal(sim.requestedTime, 24.5);
});
