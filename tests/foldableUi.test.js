import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/i18n/en.js';
import ko from '../src/i18n/ko.js';

test('index.html contains fold and unfold buttons for main menu and pause menu', () => {
  const html = readFileSync(resolve('index.html'), 'utf8');

  // Lobby fold button and unfold pill
  assert.ok(html.includes('id="btn-lobby-fold"'), 'must have btn-lobby-fold');
  assert.ok(html.includes('id="btn-lobby-unfold"'), 'must have btn-lobby-unfold');

  // Pause fold button and unfold pill
  assert.ok(html.includes('id="btn-pause-fold"'), 'must have btn-pause-fold');
  assert.ok(html.includes('id="btn-pause-unfold"'), 'must have btn-pause-unfold');
});

test('DebriefOverlay includes fold and unfold affordances', () => {
  const debriefSrc = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  assert.ok(debriefSrc.includes('id="debrief-fold"'), 'must have debrief-fold button');
  assert.ok(debriefSrc.includes('id="debrief-unfold"'), 'must have debrief-unfold pill');
  assert.ok(debriefSrc.includes('setFolded('), 'must have setFolded method');
});

test('ReplayPanel includes fold and unfold affordances and updates mini time', () => {
  const replaySrc = readFileSync(resolve('src/ui/ReplayPanel.js'), 'utf8');
  assert.ok(replaySrc.includes('data-fold'), 'must have data-fold button');
  assert.ok(replaySrc.includes('data-unfold'), 'must have data-unfold pill');
  assert.ok(replaySrc.includes('data-time-mini'), 'must have data-time-mini output in pill');
  assert.ok(replaySrc.includes('setFolded('), 'must have setFolded method');
});

test('DiagnosticsInspector includes fold button for compact header viewing', () => {
  const diagSrc = readFileSync(resolve('src/ui/DiagnosticsInspector.js'), 'utf8');
  assert.ok(diagSrc.includes('id="diag-fold"'), 'must have diag-fold button');
});

test('FlightPanels includes HUD fold button and unfold pill', () => {
  const panelsSrc = readFileSync(resolve('src/ui/FlightPanels.js'), 'utf8');
  assert.ok(panelsSrc.includes('id = \'btn-hud-fold\''), 'must have btn-hud-fold button');
  assert.ok(panelsSrc.includes('id = \'btn-hud-unfold\''), 'must have btn-hud-unfold pill');
});

test('SimulatorHudAndBindings binds U key and handles fold/unfold in ESC chain', () => {
  const bindingsSrc = readFileSync(resolve('src/ui/SimulatorHudAndBindings.js'), 'utf8');
  assert.ok(bindingsSrc.includes("e.code !== 'KeyU'"), 'must bind KeyU for UI toggle');
  assert.ok(bindingsSrc.includes("is-folded"), 'must check is-folded in ESC handler');
});

test('CSS files define .is-folded and .ui-unfold-pill styles for clear plane watching', () => {
  const lobbyCss = readFileSync(resolve('src/styles/lobby-and-overlays.css'), 'utf8');
  assert.ok(lobbyCss.includes('#lobby-screen.is-folded'), 'lobby CSS must define #lobby-screen.is-folded');
  assert.ok(lobbyCss.includes('#pause-menu.is-folded'), 'lobby CSS must define #pause-menu.is-folded');
  assert.ok(lobbyCss.includes('.ui-unfold-pill'), 'lobby CSS must define .ui-unfold-pill');
  assert.ok(lobbyCss.includes('.ui-unfold-pill[hidden]'), 'lobby CSS must hide .ui-unfold-pill[hidden]');
  assert.ok(lobbyCss.includes('.lobby-unfold-pill'), 'lobby CSS must define .lobby-unfold-pill');
  assert.ok(lobbyCss.includes('.pause-unfold-pill'), 'lobby CSS must define .pause-unfold-pill');

  const debriefCss = readFileSync(resolve('src/styles/debrief.css'), 'utf8');
  assert.ok(debriefCss.includes('#debrief-overlay.is-folded'), 'debrief CSS must define #debrief-overlay.is-folded');
  assert.ok(debriefCss.includes('.debrief-unfold-pill'), 'debrief CSS must define .debrief-unfold-pill');
  assert.ok(debriefCss.includes('.debrief-unfold-pill[hidden]'), 'debrief CSS must hide .debrief-unfold-pill[hidden]');

  const replayCss = readFileSync(resolve('src/styles/replay.css'), 'utf8');
  assert.ok(replayCss.includes('#replay-panel.is-folded'), 'replay CSS must define #replay-panel.is-folded');
  assert.ok(replayCss.includes('.replay-unfold-pill'), 'replay CSS must define .replay-unfold-pill');
  assert.ok(replayCss.includes('.replay-unfold-pill[hidden]'), 'replay CSS must hide .replay-unfold-pill[hidden]');

  const flightLayoutCss = readFileSync(resolve('src/styles/flight-layout.css'), 'utf8');
  assert.ok(flightLayoutCss.includes('body.hud-folded'), 'flight-layout CSS must define body.hud-folded');
  assert.ok(flightLayoutCss.includes('.hud-unfold-pill'), 'flight-layout CSS must define .hud-unfold-pill');
  assert.ok(flightLayoutCss.includes('.hud-unfold-pill[hidden]'), 'flight-layout CSS must hide .hud-unfold-pill[hidden]');

  const diagCss = readFileSync(resolve('src/styles/diagnostics-and-crash.css'), 'utf8');
  assert.ok(diagCss.includes('.diagnostics-panel.is-folded'), 'diag CSS must define .diagnostics-panel.is-folded');
});

test('i18n catalogs include fold and unfold translations for both EN and KO', () => {
  assert.equal(en['ui.fold'], 'Fold');
  assert.equal(ko['ui.fold'], '접기');
  assert.equal(en['ui.unfold'], 'Unfold');
  assert.equal(ko['ui.unfold'], '펼치기');
  assert.equal(en['ui.foldHud'], 'Hide HUD (U)');
  assert.equal(ko['ui.foldHud'], 'HUD 숨김 (U)');
  assert.equal(en['ui.unfoldHud'], 'Show HUD (U)');
  assert.equal(ko['ui.unfoldHud'], 'HUD 표시 (U)');
  assert.ok(en['notice.hudHidden']);
  assert.ok(ko['notice.hudHidden']);
});
