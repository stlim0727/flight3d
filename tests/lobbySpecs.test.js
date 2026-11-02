import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftSpec, airportSpec } from '../src/ui/lobbySpecs.js';
import { setLanguage } from '../src/i18n/index.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';

test('menu badges come from aircraft and approach configuration', () => {
  setLanguage('en');
  assert.match(aircraftSpec('B738'), /^2× CFM56-7B26 · MTOW 79,010 kg$/);
  assert.match(aircraftSpec('C172'), /Fixed gear$/);
  assert.doesNotMatch(aircraftSpec('F16'), /Fixed gear/);
  assert.equal(airportSpec('coastal'), 'RWY 090° · 39 FT · GS 3°');
  assert.match(airportSpec('lukla'), /^RWY 058° · 9,203 FT · GS 4\.28°$/);
  assert.match(airportSpec('hangang'), /C172/);
  assert.match(airportSpec('valley'), /F-16/);
});

test('unknown ids yield no badge and every lobby aircraft has one', () => {
  assert.equal(aircraftSpec('X'), '');
  assert.equal(airportSpec('nowhere'), '');
  for (const id of Object.keys(AIRCRAFT_REGISTRY)) assert.ok(aircraftSpec(id), id);
});

test('korean badge text localizes the descriptive part only', () => {
  setLanguage('ko');
  assert.match(aircraftSpec('C172'), /고정식 기어/);
  assert.match(airportSpec('hangang'), /C172 전용/);
  setLanguage('en');
});
