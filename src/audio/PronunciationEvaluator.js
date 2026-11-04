/**
 * Evaluates speech recognition transcripts against target aviation ATC / handoff phrases.
 * Supports normalization, phonetic number mapping, Levenshtein distance,
 * keyword coverage, and dual-language (English / Korean) matching.
 */

const NUMBER_WORDS_EN = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '123': 'one two three', '33': 'thirty three', '33l': 'thirty three left',
  '737': 'seven three seven', '738': 'seven three eight'
};

const NUMBER_WORDS_KO = {
  '0': '영', '1': '일', '2': '이', '3': '삼', '4': '사',
  '5': '오', '6': '육', '7': '칠', '8': '팔', '9': '구',
  '123': '일이삼', '33': '삼십삼', '33l': '삼십삼 레프트',
  '737': '칠삼칠', '738': '칠삼팔'
};

/** Compute Levenshtein distance between two strings */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Normalize an input string for aviation speech comparison.
 * @param {string} text
 * @param {'en'|'ko'} [lang='en']
 * @returns {string}
 */
export function normalizePhrase(text, lang = 'en') {
  if (!text || typeof text !== 'string') return '';
  let normalized = text.toLowerCase().trim();

  // Strip punctuation and special symbols
  normalized = normalized.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'<>]/g, ' ');

  // Replace digits/numbers with spoken words
  const dict = lang === 'ko' ? NUMBER_WORDS_KO : NUMBER_WORDS_EN;
  for (const [digit, word] of Object.entries(dict)) {
    const regex = new RegExp(`\\b${digit}\\b`, 'gi');
    normalized = normalized.replace(regex, word);
  }

  // Collapse multiple whitespaces
  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Calculate similarity ratio (0.0 to 1.0) between two normalized strings.
 */
export function stringSimilarity(a, b) {
  const normA = normalizePhrase(a);
  const normB = normalizePhrase(b);
  if (!normA && !normB) return 1;
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshteinDistance(normA, normB);
  return Math.max(0, 1 - dist / maxLen);
}

const STOP_WORDS = new Set(['to', 'for', 'the', 'a', 'an', 'and', 'of', 'in', 'at']);

/**
 * Calculate keyword coverage: what ratio of target keywords appear in recognized text.
 * Common filler/stop words are ignored so minor articles don't fail phrase matching.
 */
export function keywordCoverage(target, spoken) {
  const normTarget = normalizePhrase(target);
  const normSpoken = normalizePhrase(spoken);
  if (!normTarget) return 1;
  const targetWords = normTarget.split(' ').filter(w => w.length > 1 && !STOP_WORDS.has(w));
  if (!targetWords.length) return 1;
  const spokenWords = new Set(normSpoken.split(' '));

  let matched = 0;
  for (const word of targetWords) {
    if (spokenWords.has(word)) {
      matched++;
    } else {
      // Allow minor 1-char edit distance for fuzzy word matches (e.g. "brakes" vs "brake")
      for (const sw of spokenWords) {
        if (Math.abs(word.length - sw.length) <= 1 && levenshteinDistance(word, sw) <= 1) {
          matched++;
          break;
        }
      }
    }
  }
  return matched / targetWords.length;
}

/**
 * Detailed word-by-word comparison for visual feedback.
 */
export function getWordFeedback(target, spoken) {
  const normTarget = normalizePhrase(target).split(' ').filter(Boolean);
  const normSpoken = normalizePhrase(spoken).split(' ').filter(Boolean);
  const spokenSet = new Set(normSpoken);

  return normTarget.map(word => {
    let matched = spokenSet.has(word);
    if (!matched) {
      for (const sw of spokenSet) {
        if (Math.abs(word.length - sw.length) <= 1 && levenshteinDistance(word, sw) <= 1) {
          matched = true;
          break;
        }
      }
    }
    return { word, matched };
  });
}

/**
 * Evaluate pronunciation accuracy against one or multiple acceptable target phrases.
 * @param {string|string[]} targetPhrases One or more acceptable target phrases (e.g. EN and KO)
 * @param {string} spokenPhrase The text recognized from user speech
 * @param {number} [threshold=0.8] Pass threshold (0.0 - 1.0, default 0.8 / 80%)
 * @returns {{ score: number, passed: boolean, bestTarget: string, words: Array<{word: string, matched: boolean}> }}
 */
export function evaluatePronunciation(targetPhrases, spokenPhrase, threshold = 0.8) {
  const targets = Array.isArray(targetPhrases) ? targetPhrases : [targetPhrases];
  if (!targets.length) {
    return { score: 1, passed: true, bestTarget: '', words: [] };
  }

  let bestResult = { score: 0, passed: false, bestTarget: targets[0], words: [] };

  for (const target of targets) {
    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(target);
    const lang = isKorean ? 'ko' : 'en';

    const sim = stringSimilarity(target, spokenPhrase);
    const cov = keywordCoverage(target, spokenPhrase);

    // Weighted blend: 55% Levenshtein similarity + 45% key word coverage
    const score = Math.round((sim * 0.55 + cov * 0.45) * 100) / 100;
    const passed = score >= threshold || cov >= 0.85;

    if (score > bestResult.score || (!bestResult.passed && passed)) {
      bestResult = {
        score,
        passed,
        bestTarget: target,
        words: getWordFeedback(target, spokenPhrase)
      };
    }
  }

  return bestResult;
}
