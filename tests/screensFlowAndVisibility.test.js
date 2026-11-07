import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/i18n/en.js';
import ko from '../src/i18n/ko.js';
import { DebriefOverlay } from '../src/ui/DebriefOverlay.js';
import { TouchFlightControls } from '../src/controls/TouchFlightControls.js';

test('index.html contains back button in lobby header and 3 canonical pause modal options', () => {
  const html = readFileSync(resolve('index.html'), 'utf8');

  // 1. Lobby setup back button
  assert.ok(html.includes('id="btn-lobby-back"'), 'lobby header must have btn-lobby-back');

  // 2. Pause menu modal options (Resume, Restart, Exit)
  assert.ok(html.includes('id="btn-pause-resume"'), 'pause menu must have btn-pause-resume');
  assert.ok(html.includes('id="btn-pause-restart"'), 'pause menu must have btn-pause-restart');
  assert.ok(html.includes('id="btn-pause-exit"'), 'pause menu must have btn-pause-exit');
});

test('DiagnosticsInspector uses chevron glyph instead of OS window minus character', () => {
  const diagSrc = readFileSync(resolve('src/ui/DiagnosticsInspector.js'), 'utf8');
  assert.ok(diagSrc.includes('class="fold-glyph"'), 'diag fold button must have fold-glyph');
  assert.ok(!diagSrc.includes('&minus;'), 'diag fold button must not use &minus;');
  assert.ok(!diagSrc.includes("textContent = isFolded ? '+' : '−'"), 'diag fold must not toggle +/-');
});

test('DebriefOverlay separates instant retry and setup change actions', () => {
  // Check markup
  const debriefSrc = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  assert.ok(debriefSrc.includes('id="debrief-retry"'), 'debrief must have debrief-retry');
  assert.ok(debriefSrc.includes('id="debrief-change-setup"'), 'debrief must have debrief-change-setup');
  assert.ok(debriefSrc.includes("data-i18n=\"debrief.retrySame\""), 'retry button must use debrief.retrySame');
  assert.ok(debriefSrc.includes("data-i18n=\"debrief.changeConditions\""), 'change setup button must use debrief.changeConditions');
  assert.ok(debriefSrc.includes("this.el('retry').addEventListener('click', onRetry)"), 'must bind onRetry');
  assert.ok(debriefSrc.includes("this.el('change-setup')?.addEventListener('click', onLobby)"), 'must bind onLobby to change-setup');
});

test('Touch controls CSS and JS define translucent outline styles and auto-fading', () => {
  const css = readFileSync(resolve('src/styles/touch-controls.css'), 'utf8');
  assert.ok(css.includes('.touch-controls-overlay.touch-faded'), 'CSS must define .touch-controls-overlay.touch-faded');
  assert.ok(css.includes('rgba(15, 23, 42, 0.32)'), 'CSS must define translucent background for touch cards');

  // Check TouchFlightControls prototype method
  assert.equal(typeof TouchFlightControls.prototype.resetFadeTimer, 'function', 'TouchFlightControls must implement resetFadeTimer');
});

test('Lobby CSS defines dark background dim and solid accent button styling', () => {
  const css = readFileSync(resolve('src/styles/lobby-and-overlays.css'), 'utf8');
  assert.ok(css.includes('.lobby-back-btn'), 'lobby CSS must define .lobby-back-btn');
  assert.ok(css.includes('.pause-card .btn-pause-exit'), 'lobby CSS must define .btn-pause-exit');
  assert.ok(css.includes('.lobby-card .btn-fly'), 'lobby CSS must define .btn-fly');
});

test('i18n catalogs include translations for new screen flow actions', () => {
  assert.equal(en['ui.back'], 'Back');
  assert.equal(ko['ui.back'], '뒤로');
  assert.equal(en['pause.exit'], 'Exit to Lobby');
  assert.equal(ko['pause.exit'], '로비로 나가기');
  assert.equal(en['debrief.retrySame'], 'Instant Retry');
  assert.equal(ko['debrief.retrySame'], '같은 조건 즉시 재도전');
  assert.equal(en['debrief.changeConditions'], 'Change Flight Setup');
  assert.equal(ko['debrief.changeConditions'], '비행 조건 변경');
});
