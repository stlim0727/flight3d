#!/usr/bin/env node
// Estimate agent cost for a window of an omp session transcript.
// Primary model usage is not logged, so prompt volume is a chars/4 approximation.
// Usage: node metrics.mjs <session.jsonl> [--match "<prompt text>"] [--start <ISO time>]
import { readFileSync } from 'node:fs';

const BASE_PROMPT_TOKENS = 8000; // system prompt, tool schemas and skills
const GAP_SECONDS = 60;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let file = null;
let match = null;
let start = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--match') match = args[++index];
  else if (args[index] === '--start') start = args[++index];
  else if (!args[index].startsWith('--') && !file) file = args[index];
  else fail(`Unknown argument: ${args[index]}`);
}
if (!file) {
  fail('Usage: node metrics.mjs <session.jsonl> [--match "<prompt text>"] [--start <ISO time>]');
}

let rows;
try {
  rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return fail(`Invalid JSON at line ${index + 1}: ${err.message}`);
      }
    });
} catch (err) {
  fail(`Cannot read session file: ${err.message}`);
}

const messages = rows.filter(row => row.type === 'message' && row.message);
if (!messages.length) fail('No message records in the session file');

let windowStart = 0;
if (match) {
  const found = messages.findIndex(row => row.message.role === 'user'
    && JSON.stringify(row.message.content ?? '').includes(match));
  if (found === -1) fail(`No user message contains: ${match}`);
  windowStart = found;
} else if (start) {
  const found = messages.findIndex(row => row.timestamp >= start);
  if (found === -1) fail(`No message at or after: ${start}`);
  windowStart = found;
}
const window = messages.slice(windowStart);

let cumulativeChars = 0;
let estimatedPromptTokens = 0;
const calls = { user: 0, assistant: 0, toolResult: 0 };
for (const row of window) {
  const role = row.message.role;
  if (role === 'assistant') {
    // The call's prompt holds everything before its own output.
    estimatedPromptTokens += Math.floor(cumulativeChars / 4) + BASE_PROMPT_TOKENS;
  }
  if (role in calls) calls[role]++;
  cumulativeChars += JSON.stringify(row.message).length;
}

const gaps = [];
for (let index = 1; index < window.length; index++) {
  const seconds = (Date.parse(window[index].timestamp) - Date.parse(window[index - 1].timestamp)) / 1000;
  if (seconds >= GAP_SECONDS) {
    gaps.push({ from: window[index - 1].timestamp, to: window[index].timestamp, seconds: Math.round(seconds) });
  }
}
gaps.sort((a, b) => b.seconds - a.seconds);

const first = Date.parse(window[0].timestamp);
const last = Date.parse(window.at(-1).timestamp);
console.log(JSON.stringify({
  session: file,
  windowStart: window[0].timestamp,
  windowEnd: window.at(-1).timestamp,
  wallSeconds: Math.round((last - first) / 1000),
  calls,
  estimatedPromptTokens,
  contextEndTokens: Math.floor(cumulativeChars / 4) + BASE_PROMPT_TOKENS,
  longestGaps: gaps.slice(0, 5),
  method: 'prompt tokens estimated as sum over assistant calls of (cumulative transcript chars / 4 + 8000)',
}, null, 2));
