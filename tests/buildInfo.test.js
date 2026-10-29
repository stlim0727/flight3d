import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCommitAge } from '../src/ui/BuildInfo.js';
import { setLanguage } from '../src/i18n/index.js';

const NOW = Date.parse('2026-10-29T00:00:00Z');
const minutes = 60_000;
const hours = 60 * minutes;
const days = 24 * hours;
const storage = { setItem() {} };
const age = offset => describeCommitAge(new Date(NOW - offset).toISOString(), NOW);

test('English commit ages use the largest whole unit', () => {
  setLanguage('en', storage);
  assert.equal(age(23 * minutes), 'Merged 23 minutes ago');
  assert.equal(age(11 * hours), 'Merged 11 hours ago');
  assert.equal(age(4 * days), 'Merged 4 days ago');
  assert.equal(age(14 * days), 'Merged 2 weeks ago');
});

test('Korean commit ages use the largest whole unit', () => {
  setLanguage('ko', storage);
  assert.equal(age(23 * minutes), '23분 전 병합');
  assert.equal(age(11 * hours), '11시간 전 병합');
  assert.equal(age(4 * days), '4일 전 병합');
});

test('sub-minute and future builds stay non-negative instead of counting backwards', () => {
  setLanguage('en', storage);
  assert.equal(age(40_000), 'Merged 40 seconds ago');
  assert.equal(age(-5 * minutes), 'Merged now');
  assert.equal(age(0), 'Merged now');
});

test('missing or unparsable commit dates produce no age claim', () => {
  for (const value of ['unknown', '', undefined, null, 'not-a-date']) {
    assert.equal(describeCommitAge(value, NOW), null, String(value));
  }
});

test('the age text follows the selected language', () => {
  const landed = new Date(NOW - 3 * hours).toISOString();
  setLanguage('en', storage);
  assert.equal(describeCommitAge(landed, NOW), 'Merged 3 hours ago');
  setLanguage('ko', storage);
  assert.equal(describeCommitAge(landed, NOW), '3시간 전 병합');
});
