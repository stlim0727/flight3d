import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/i18n/en.js';
import ko from '../src/i18n/ko.js';
import { SAVE_REPLAY_STATUS, DEBRIEF_ACTIONS } from '../src/ui/DebriefOverlay.js';
import enDebrief from '../src/i18n/locales/en/debrief.js';
import koDebrief from '../src/i18n/locales/ko/debrief.js';

test('debrief overlay positions main menu back button in the footer with u-turn arrow and caption', () => {
  const debriefSource = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');

  // Must have debrief-footer at the bottom of the overlay with debrief-lobby button
  assert.match(
    debriefSource,
    /<footer class="debrief-footer">[\s\S]*?<button class="btn debrief-primary debrief-lobby-btn" id="debrief-lobby"[\s\S]*?<\/footer>/,
    'debrief-lobby button must be inside debrief-footer at the bottom of the overlay'
  );

  // Must contain u-turn arrow glyph ↩
  assert.match(
    debriefSource,
    /<span class="debrief-back-glyph" aria-hidden="true">↩<\/span>/,
    'debrief-lobby must have the u-turn arrow glyph'
  );

  // Must have localized caption
  assert.match(
    debriefSource,
    /<span class="debrief-back-caption" data-i18n="debrief\.lobby"><\/span>/,
    'debrief-lobby must have localized debrief.lobby caption'
  );

  // Must have accessible aria-label and title
  assert.match(
    debriefSource,
    /data-i18n-aria-label="debrief\.lobby"/,
    'debrief-lobby must have localized aria-label'
  );
  assert.match(
    debriefSource,
    /data-i18n-title="debrief\.lobby"/,
    'debrief-lobby must have localized title'
  );

  // debrief-actions must not contain debrief-lobby or debrief-feedback
  const debriefActionsMatch = debriefSource.match(/<div class="debrief-actions">([\s\S]*?)<\/div>/);
  assert.ok(debriefActionsMatch, 'debrief-actions block must exist');
  assert.ok(
    !debriefActionsMatch[1].includes('id="debrief-lobby"'),
    'debrief-actions must not contain debrief-lobby'
  );
  assert.ok(
    !debriefActionsMatch[1].includes('id="debrief-feedback"'),
    'debrief-actions must not contain debrief-feedback'
  );
  assert.match(
    debriefSource,
    /<header class="debrief-header">[\s\S]*?id="debrief-feedback"[\s\S]*?<\/header>/,
    'debrief-feedback must be inside debrief-header as a discrete utility icon button'
  );
  // The streamlined overlay is a single scrolling view without tabs (#649).
  assert.doesNotMatch(debriefSource, /role="tab"/, 'the overlay must not reinstate tabs');
  assert.doesNotMatch(debriefSource, /id="debrief-retry"/, 'the overlay must not reinstate the instant retry button');
});

test('debrief localization includes Main menu caption for both locales', () => {
  assert.equal(enDebrief['debrief.lobby'], 'Main menu');
  assert.equal(koDebrief['debrief.lobby'], '메인 메뉴');
});

test('debrief CSS defines responsive styling for top-left header and back button', () => {
  const cssSource = readFileSync(resolve('src/styles/debrief.css'), 'utf8');

  assert.ok(cssSource.includes('.debrief-header'), 'CSS must define .debrief-header');
  assert.ok(cssSource.includes('.debrief-lobby-btn'), 'CSS must define .debrief-lobby-btn');
  assert.ok(cssSource.includes('.debrief-back-glyph'), 'CSS must define .debrief-back-glyph');
  assert.ok(cssSource.includes('.debrief-back-caption'), 'CSS must define .debrief-back-caption');
  assert.ok(cssSource.includes('.debrief-overlay .debrief-lobby-btn'), 'CSS must define .debrief-overlay .debrief-lobby-btn');
});

test('pause menu positions main menu back button at top left with u-turn arrow and caption', () => {
  const htmlSource = readFileSync(resolve('index.html'), 'utf8');
  assert.match(
    htmlSource,
    /<div class="pause-card">[\s\S]*?<header class="pause-header">[\s\S]*?<button class="btn pause-lobby-btn" id="btn-pause-lobby"[\s\S]*?↩[\s\S]*?<\/header>/,
    'pause card must have pause-lobby-btn in pause-header with ↩ arrow'
  );

  const cssSource = readFileSync(resolve('src/styles/lobby-and-overlays.css'), 'utf8');
  assert.ok(cssSource.includes('.pause-header'), 'lobby-and-overlays.css must define .pause-header');
  assert.ok(cssSource.includes('.pause-lobby-btn'), 'lobby-and-overlays.css must define .pause-lobby-btn');
});

test('pilot arena score modal provides prominent top-left return to main menu button', () => {
  const viewSource = readFileSync(resolve('src/ui/pilotScoreView.js'), 'utf8');
  assert.match(
    viewSource,
    /class="btn-score-lobby"[\s\S]*?↩[\s\S]*?메인 메뉴/,
    'scoreOverlayMarkup must include btn-score-lobby with ↩ glyph and caption'
  );

  const cssSource = readFileSync(resolve('src/styles/pilot-arena.css'), 'utf8');
  assert.ok(cssSource.includes('.btn-score-lobby'), 'pilot-arena.css must define .btn-score-lobby');
});

test('debrief offers save replay only when the sortie produced a pose track', () => {
  const debriefSource = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  assert.match(debriefSource, /show\(report, replay = null\)/, 'show must accept the recorded track');
  assert.match(debriefSource, /id="debrief-save-replay"[^>]*hidden/);
  assert.match(debriefSource, /<button class="btn" id="debrief-save-replay"[\s\S]*?data-i18n="debrief\.saveReplay"/,
    'save replay caption must use debrief.saveReplay');
  assert.match(debriefSource, /this\.el\('save-replay'\)\.hidden = !replay;/);
  assert.match(debriefSource, /this\.el\('save-replay'\)\.disabled = false;/, 'a fresh debrief must be savable again');
  const shareStart = debriefSource.indexOf('debrief-share-section');
  const shareEnd = debriefSource.indexOf('debrief-footer');
  assert.ok(shareStart >= 0 && shareEnd > shareStart, 'debrief-share-section must precede the debrief-footer');
  const share = debriefSource.slice(shareStart, shareEnd);
  assert.ok(share.includes('id="debrief-save-replay"') && share.includes('id="debrief-status"'),
    'save replay must sit beside the live region that reports its result');
  assert.match(debriefSource, /if \(this\.replaySaved\) return;/, 'one save per sortie');
});

test('every replay store refusal token has a localized reason in both catalogs', () => {
  for (const [token, key] of Object.entries(SAVE_REPLAY_STATUS)) {
    assert.match(key, /^replay\./, `${token} must report a replay-scoped message`);
    assert.ok(en[key], `english message for ${token}`);
    assert.ok(ko[key], `korean message for ${token}`);
    assert.doesNotMatch(en[key], /[가-힣]/, key);
  }
  assert.ok(en['replay.saveFailed'] && ko['replay.saveFailed'], 'quota and codec failures need a message');
  assert.ok(enDebrief['debrief.saveReplay'] && koDebrief['debrief.saveReplay']);
});


test('header outcome pill shows a short single-line label instead of a sentence (#597)', () => {
  const debriefSource = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  const pillBinding = debriefSource.match(/bindText\(headerPill, \(\) => ([^\n]*)\);/);
  assert.ok(pillBinding, 'header pill text must be bound');
  assert.doesNotMatch(pillBinding[1], /debrief\.(insufficient|outcome\.|crashSeverity)/,
    'the narrow header pill must not reuse full-sentence outcome messages');
  for (const state of ['manual', 'landed', 'crash', 'empty']) {
    const key = `debrief.pill.${state}`;
    assert.ok(enDebrief[key] && koDebrief[key], `${key} must exist in both locales`);
    assert.ok(koDebrief[key].length <= 5, `${key} must stay badge-sized in Korean`);
    assert.ok(enDebrief[key].length <= 8, `${key} must stay badge-sized in English`);
  }

  const css = readFileSync(resolve('src/styles/debrief.css'), 'utf8');
  const pillRule = css.match(/\.debrief-header-pill \{([^}]*)\}/);
  assert.ok(pillRule, 'header pill rule must exist');
  assert.match(pillRule[1], /white-space:\s*nowrap/, 'pill must never break one glyph per line');
  assert.match(pillRule[1], /text-overflow:\s*ellipsis/, 'pill must clip instead of growing vertically');
  assert.match(css, /@media \(max-width: 420px\) \{\s*\.debrief-fold-btn \.fold-caption \{ display: none; \}/,
    'phone headers drop the fold caption so "Flight3d" does not overlap the utility buttons');
});

test('every debrief action names a button that exists in the overlay markup', () => {
  const source = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  const actions = Object.entries(DEBRIEF_ACTIONS);
  assert.ok(actions.length >= 5);
  for (const [id, action] of actions) {
    assert.match(source, new RegExp(`id="debrief-${id}"`), `${action} must be bound to #debrief-${id}`);
    assert.match(action, /^[a-z_]+$/, 'action values are snake_case event properties');
  }
});

test('debrief download emits flight3d.sortie.v1 unifying telemetry report and track', () => {
  const source = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');
  assert.match(source, /createSortie\(this\.report,\s*this\.replay\)/, 'download handler must call createSortie');
  assert.match(source, /import\s*\{[^}]*createSortie[^}]*\}\s*from '\.\.\/replay\/ReplayStore\.js'/,
    'DebriefOverlay must import createSortie from ReplayStore');
  assert.match(enDebrief['debrief.saveReplay'], /library/i, 'save replay caption should indicate library');
  assert.match(koDebrief['debrief.saveReplay'], /라이브러리/, 'korean save replay caption should indicate library');
});
