import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyBriefing } from '../src/ui/lobbyBriefing.js';
import { setLanguage } from '../src/i18n/index.js';

test('briefing lines carry approach data numbers for both airports', () => {
  setLanguage('en');
  const lukla = lobbyBriefing('lukla', 'runway');
  assert.equal(lukla.length, 3);
  assert.match(lukla[0], /Lukla/);
  assert.match(lukla[1], /Rwy 058 .*9203 .*4\.28/);
  assert.match(lukla[2], /takeoff/);

  const coastal = lobbyBriefing('coastal', 'approach');
  assert.equal(coastal.length, 3);
  assert.match(coastal[0], /Coastal/);
  assert.match(coastal[1], /Rwy 090 .*39 .*3(\.0)?/);
  assert.match(coastal[2], /final approach/);
});

test('cliff scenario only briefed for lukla', () => {
  setLanguage('en');
  const cliff = lobbyBriefing('lukla', 'cliff');
  assert.equal(cliff.length, 3);
  assert.match(cliff[2], /Rwy 24/);
  const coastalCliff = lobbyBriefing('coastal', 'cliff');
  assert.equal(coastalCliff.length, 2);
});

test('demo scenario is briefed for both airports', () => {
  setLanguage('en');
  for (const airport of ['lukla', 'coastal']) {
    const demo = lobbyBriefing(airport, 'demo');
    assert.equal(demo.length, 3);
    assert.match(demo[2], /demo flight/);
  }
});

test('unknown airport or preset degrades without leaking raw keys', () => {
  setLanguage('en');
  assert.deepEqual(lobbyBriefing('unknown', 'runway'), []);
  const unknownPreset = lobbyBriefing('coastal', 'goaround');
  assert.equal(unknownPreset.length, 2);
  for (const line of [...lobbyBriefing('lukla', 'cruise'), ...unknownPreset]) {
    assert.ok(!line.startsWith('lobby.'), `raw key leaked: ${line}`);
  }
});

test('korean locale renders briefing', () => {
  setLanguage('ko');
  const lines = lobbyBriefing('lukla', 'cruise');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /활주로 058/);
  assert.match(lines[2], /순항/);
  setLanguage('en');
});

test('valley scenario is briefed for valley flight site', () => {
  setLanguage('en');
  const valley = lobbyBriefing('valley', 'valley');
  assert.equal(valley.length, 2);
  assert.match(valley[0], /Valley/);
  assert.match(valley[1], /F-16/);
  const coastalValley = lobbyBriefing('coastal', 'valley');
  assert.equal(coastalValley.length, 2);
});
