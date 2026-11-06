#!/usr/bin/env node
/** Publish the shared leaderboard snapshot: query PostHog for `score_submitted`
 * events made under the current score rules fingerprint, and write
 * public/leaderboard.json next to the site build. Run by the Pages workflow.
 * Without POSTHOG_API_KEY / POSTHOG_PROJECT_ID secrets it keeps whatever
 * snapshot is already committed, so forks and secret-less runs still work. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { groupTop } from './lib/leaderboard-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, '..', 'public', 'leaderboard.json');
const { SCORE_RULES_FINGERPRINT } = await import('../src/arena/ValleyScoreboard.js');

const fingerprintHash = createHash('sha256').update(SCORE_RULES_FINGERPRINT).digest('hex');
const host = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';
const apiKey = process.env.POSTHOG_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const windowDays = 30;
const limit = 5;

async function keepSnapshot(reason) {
  console.warn(`build-leaderboard: ${reason}; keeping the existing public/leaderboard.json`);
  try {
    const existing = JSON.parse(await readFile(outPath, 'utf8'));
    console.log(`build-leaderboard: snapshot has ${existing.boards?.length ?? 0} boards`);
  } catch {
    console.warn('build-leaderboard: no readable snapshot is present');
  }
}

if (!apiKey || !projectId) {
  await keepSnapshot('missing POSTHOG_API_KEY or POSTHOG_PROJECT_ID');
  process.exit(0);
}

if (!/^[0-9a-f]{64}$/.test(fingerprintHash)) throw new Error('fingerprint hash malformed');

const hogql = `
SELECT
  toString(properties.mission) AS mission,
  toString(properties.comparison_key_hash) AS comparison_key_hash,
  toString(properties.callsign) AS callsign,
  toString(properties.pilot_kind) AS pilot_kind,
  toFloat(properties.score) AS score,
  toFloat(properties.duration_seconds) AS duration_seconds,
  toString(properties.recorded_at) AS recorded_at
FROM events
WHERE event = 'score_submitted'
  AND timestamp >= now() - INTERVAL ${windowDays} DAY
  AND toString(properties.fingerprint_hash) = '${fingerprintHash}'
  AND toFloat(properties.score) > 0
ORDER BY score DESC
LIMIT 50000`;

let rows;
try {
  const response = await fetch(`${host}/projects/${encodeURIComponent(projectId)}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'hogql', query: hogql } }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const FIELDS = ['mission', 'comparisonKeyHash', 'callsign', 'pilotKind', 'score', 'durationSeconds', 'recordedAt'];
  rows = (payload.results ?? []).map(row => Object.fromEntries(FIELDS.map((field, index) => [field, row[index]])));
} catch (error) {
  await keepSnapshot(`PostHog query failed: ${error.message}`);
  process.exit(0);
}

const boards = groupTop(rows, { limit });
await writeFile(outPath, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  fingerprintHash,
  boards,
}, null, 2)}\n`);
console.log(`build-leaderboard: wrote ${boards.length} boards from ${rows.length} scored attempts`);
