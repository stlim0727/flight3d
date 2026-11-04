import test from 'node:test';
import assert from 'node:assert/strict';
import {
  levenshteinDistance,
  normalizePhrase,
  stringSimilarity,
  keywordCoverage,
  getWordFeedback,
  evaluatePronunciation
} from '../src/audio/PronunciationEvaluator.js';

test('levenshteinDistance calculates exact edit distances', () => {
  assert.equal(levenshteinDistance('', ''), 0);
  assert.equal(levenshteinDistance('brake', 'brake'), 0);
  assert.equal(levenshteinDistance('brake', 'brakes'), 1);
  assert.equal(levenshteinDistance('cat', 'hat'), 1);
  assert.equal(levenshteinDistance('korean air', 'korean'), 4);
});

test('normalizePhrase strips punctuation, normalizes spacing and converts numbers', () => {
  assert.equal(normalizePhrase('Jeju Air 1102, ready for pushback!'), 'jeju air one one zero two ready for pushback');
  assert.equal(normalizePhrase('Korean Air 123, ready for pushback!'), 'korean air one two three ready for pushback');
  assert.equal(normalizePhrase('Runway 33L, cleared for takeoff.'), 'runway thirty three left cleared for takeoff');
  assert.equal(normalizePhrase('푸시백 완료!  1102번.', 'ko'), '푸시백 완료 일일공이번');
});

test('stringSimilarity returns 1.0 for exact matches and degrades gracefully with errors', () => {
  assert.equal(stringSimilarity('Brake set', 'brake set'), 1.0);
  const simMinor = stringSimilarity('Brakes set', 'brake set');
  assert.ok(simMinor > 0.85, 'minor plural difference keeps high similarity');
  const simDiff = stringSimilarity('Brake set', 'Throttle full');
  assert.ok(simDiff < 0.4, 'completely different phrases yield low similarity');
});

test('keywordCoverage accounts for all critical words with minor typo tolerance', () => {
  assert.equal(keywordCoverage('Brake set, ready to taxi', 'brake set ready to taxi'), 1.0);
  assert.equal(keywordCoverage('Brake set, ready to taxi', 'brakes set ready taxi'), 1.0);
  const half = keywordCoverage('Brake set, ready to taxi', 'brake set');
  assert.ok(half > 0.3 && half < 0.6);
});

test('getWordFeedback identifies matched and missed words', () => {
  const feedback = getWordFeedback('Brake set ready to taxi', 'brake set');
  assert.deepEqual(feedback, [
    { word: 'brake', matched: true },
    { word: 'set', matched: true },
    { word: 'ready', matched: false },
    { word: 'to', matched: false },
    { word: 'taxi', matched: false }
  ]);
});

test('evaluatePronunciation evaluates against multiple target phrases (EN & KO)', () => {
  const targets = [
    'Pushback complete, taking manual control',
    'Brakes set, ready to taxi',
    '푸시백 완료, 직접 조종하겠습니다'
  ];

  // Exact English match
  const res1 = evaluatePronunciation(targets, 'Pushback complete, taking manual control');
  assert.equal(res1.passed, true);
  assert.ok(res1.score >= 0.95);
  assert.equal(res1.bestTarget, targets[0]);

  // English with slight pronunciation variation
  const res2 = evaluatePronunciation(targets, 'push back complete taking manual control');
  assert.equal(res2.passed, true);
  assert.ok(res2.score >= 0.8);

  // Korean match
  const res3 = evaluatePronunciation(targets, '푸시백 완료 직접 조종하겠습니다');
  assert.equal(res3.passed, true);
  assert.ok(res3.score >= 0.9);
  assert.equal(res3.bestTarget, targets[2]);

  // Failure on irrelevant speech
  const res4 = evaluatePronunciation(targets, 'Hello world how are you');
  assert.equal(res4.passed, false);
  assert.ok(res4.score < 0.4);
});
