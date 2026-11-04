import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import enDebrief from '../src/i18n/locales/en/debrief.js';
import koDebrief from '../src/i18n/locales/ko/debrief.js';

test('debrief overlay positions main menu back button at top left with u-turn arrow and caption', () => {
  const debriefSource = readFileSync(resolve('src/ui/DebriefOverlay.js'), 'utf8');

  // Must have debrief-header at top of debrief-card with debrief-lobby button
  assert.match(
    debriefSource,
    /<header class="debrief-header">[\s\S]*?<button class="btn debrief-lobby-btn" id="debrief-lobby"[\s\S]*?<\/header>/,
    'debrief-lobby button must be inside debrief-header at the top of the card'
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

  // debrief-actions must no longer contain debrief-lobby
  const debriefActionsMatch = debriefSource.match(/<div class="debrief-actions">([\s\S]*?)<\/div>/);
  assert.ok(debriefActionsMatch, 'debrief-actions block must exist');
  assert.ok(
    !debriefActionsMatch[1].includes('id="debrief-lobby"'),
    'debrief-actions at bottom must not contain debrief-lobby'
  );
  assert.ok(
    debriefActionsMatch[1].includes('id="debrief-retry"'),
    'debrief-actions must contain debrief-retry'
  );
  assert.ok(
    debriefActionsMatch[1].includes('id="debrief-feedback"'),
    'debrief-actions must contain debrief-feedback'
  );
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
  assert.ok(cssSource.includes('.debrief-card .debrief-lobby-btn'), 'CSS must define .debrief-card .debrief-lobby-btn');
});
