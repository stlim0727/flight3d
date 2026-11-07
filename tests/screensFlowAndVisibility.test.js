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

  // 1. Lobby setup back button (hidden by default on boot)
  assert.ok(html.includes('id="btn-lobby-back"'), 'lobby header must have btn-lobby-back');
  assert.ok(/<button[^>]+id="btn-lobby-back"[^>]*hidden/.test(html), 'btn-lobby-back must be hidden on initial boot');

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

test('Mobile header layout and audio hint snackbar positioning are correctly configured', () => {
  const lobbyCss = readFileSync(resolve('src/styles/lobby-and-overlays.css'), 'utf8');
  assert.ok(lobbyCss.includes('.lobby-header-actions'), 'lobby CSS must define .lobby-header-actions');
  assert.ok(lobbyCss.includes('body[data-flow="lobby"] .menu-toggle'), 'lobby CSS must hide redundant menu toggle during lobby');
  assert.ok(lobbyCss.includes('.lobby-actions'), 'lobby CSS must style .lobby-actions');
  assert.ok(lobbyCss.includes('.lobby-panels::-webkit-scrollbar'), 'lobby CSS must style slim scrollbar for panels');

  const hudCss = readFileSync(resolve('src/styles/hud-and-modals.css'), 'utf8');
  assert.ok(hudCss.includes('.audio-start-hint'), 'hud CSS must style .audio-start-hint');
  assert.ok(hudCss.includes('pointer-events: auto'), 'audio start hint must be clickable to dismiss on touch');
  assert.ok(hudCss.includes('.hud-val'), 'hud CSS must style .hud-val');
  assert.ok(hudCss.includes('tabular-nums'), 'hud telemetry values must use tabular nums');

  const flightLayoutCss = readFileSync(resolve('src/styles/flight-layout.css'), 'utf8');
  assert.ok(flightLayoutCss.includes('body[data-flow="flight"] .audio-start-hint'), 'flight-layout CSS must only elevate audio hint during flight');

  const lobbyJs = readFileSync(resolve('src/ui/LobbyScreen.js'), 'utf8');
  assert.ok(lobbyJs.includes('updateBackButton'), 'LobbyScreen must manage back button visibility via updateBackButton');

  const debriefJs = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  assert.ok(debriefJs.includes('debrief-altitude-gradient'), 'DebriefOverlay must render gradient under altitude chart');
  assert.ok(debriefJs.includes('debrief-chart-area'), 'DebriefOverlay must update area polygon points');

  const mpCss = readFileSync(resolve('src/styles/multiplayer.css'), 'utf8');
  assert.ok(mpCss.includes('border-radius: 14px'), 'multiplayer dialog must use unified 14px border radius');
  assert.ok(mpCss.includes('#0284c7'), 'multiplayer start button must use unified sky blue CTA color');

  const replayCss = readFileSync(resolve('src/styles/replay.css'), 'utf8');
  assert.ok(replayCss.includes('::file-selector-button'), 'replay library must style file selector button');
  assert.ok(replayCss.includes('border-radius: 14px'), 'replay library must use unified 14px border radius');
});

test('DebriefOverlay UI layout, header hierarchy, and styling tokens', () => {
  const debriefSrc = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  assert.ok(debriefSrc.includes('class="debrief-header-actions"'), 'header must have debrief-header-actions');
  assert.ok(debriefSrc.includes('id="debrief-feedback"'), 'header must contain debrief-feedback');
  assert.ok(debriefSrc.includes('id="debrief-fold"'), 'header must contain debrief-fold');
  assert.ok(debriefSrc.includes('id="debrief-pill"'), 'header must contain debrief-pill');
  assert.ok(debriefSrc.includes('class="debrief-secondary-actions"'), 'actions must contain debrief-secondary-actions');

  const css = readFileSync(resolve('src/styles/debrief.css'), 'utf8');
  assert.ok(css.includes('rgba(15, 23, 42, 0.85)'), 'debrief card must use dark cockpit glass background');
  assert.ok(css.includes('backdrop-filter: blur(16px)'), 'debrief card must use 16px blur');
  assert.ok(css.includes('max-width: min(calc(440px * var(--ui-scale, 1))') || css.includes('max-width: 440px'), 'debrief card must enforce scaled max width');
  assert.ok(css.includes('max-height: calc(100dvh - 32px)'), 'debrief card must enforce max height');
  assert.ok(css.includes('position: sticky'), 'debrief actions must be sticky');
  assert.ok(css.includes('linear-gradient(135deg, #0284c7 0%, #0369a1 100%)'), 'retry button must use primary accent gradient');
});

test('Multi-viewport screens showcases, concurrent capture, and navigation switcher', () => {
  const desktopHtml = readFileSync(resolve('screens.html'), 'utf8');
  const portraitHtml = readFileSync(resolve('screens-mobile-portrait.html'), 'utf8');
  const landscapeHtml = readFileSync(resolve('screens-mobile-landscape.html'), 'utf8');

  // Verify all 3 pages define the viewport switcher
  for (const html of [desktopHtml, portraitHtml, landscapeHtml]) {
    assert.ok(html.includes('class="viewport-switcher"'), 'must contain viewport-switcher');
    assert.ok(html.includes('href="./screens.html"'), 'must link to desktop screens');
    assert.ok(html.includes('href="./screens-mobile-portrait.html"'), 'must link to mobile portrait screens');
    assert.ok(html.includes('href="./screens-mobile-landscape.html"'), 'must link to mobile landscape screens');
  }

  // Verify respective active states and catalog endpoints
  assert.ok(desktopHtml.includes('class="viewport-tab active" data-viewport="desktop"'));
  assert.ok(desktopHtml.includes('screenshots/ui/catalog.json'));

  assert.ok(portraitHtml.includes('class="viewport-tab active" data-viewport="mobile-portrait"'));
  assert.ok(portraitHtml.includes('screenshots/ui-mobile-portrait/catalog.json'));

  assert.ok(landscapeHtml.includes('class="viewport-tab active" data-viewport="mobile-landscape"'));
  assert.ok(landscapeHtml.includes('screenshots/ui-mobile-landscape/catalog.json'));

  // Verify Vite rollup inputs include all 3 HTML files
  const viteConfig = readFileSync(resolve('vite.config.js'), 'utf8');
  assert.ok(viteConfig.includes("screens: 'screens.html'"));
  assert.ok(viteConfig.includes("screensMobilePortrait: 'screens-mobile-portrait.html'"));
  assert.ok(viteConfig.includes("screensMobileLandscape: 'screens-mobile-landscape.html'"));

  // Verify package.json concurrent and multi-viewport scripts
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.ok(pkg.scripts['screens:capture:all'].includes('--all-viewports'));
  assert.ok(pkg.scripts['screens:capture:portrait'].includes('--viewport mobile-portrait'));
  assert.ok(pkg.scripts['screens:capture:landscape'].includes('--viewport mobile-landscape'));
});
