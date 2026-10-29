/**
 * @file Render a demo sweep report where a reader will look for it.
 *
 * Reads `demo-sweep-report.json` written by scripts/demo-sweep.mjs and turns it
 * into GitHub step-summary markdown plus `::error` / `::warning` annotations, so
 * a failing route is visible in the PR check itself rather than only in an
 * artifact. Without `GITHUB_STEP_SUMMARY` it prints the same table to stdout,
 * which makes the local reading of a run identical to the CI one.
 *
 *   node scripts/demo-sweep-summary.mjs [report.json]
 */
import fs from 'node:fs';

const file = process.argv[2] || '.cache/demo-sweep/demo-sweep-report.json';
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

/** Annotation payloads break on `%` and newlines, and neither is worth losing a row over. */
function escape(text) {
  return String(text).replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
}

function line(text) {
  if (summaryPath) fs.appendFileSync(summaryPath, `${text}\n`);
  else console.log(text);
}

function annotation(kind, route, text) {
  console.log(`::${kind} title=demo ${route.id}::${escape(`${route.id}: ${text}`)}`);
}

let report = null;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.log(`::error title=demo sweep::${escape(`${file} is unreadable (${error.message}); the sweep never produced a verdict`)}`);
}

if (report) render(report);

function render(report) {
  const rows = report.routes ?? [];
  line(`## Demo sweep — ${report.tier ?? '?'} tier, ${rows.length} route(s) fast-played`);
  line('');
  line(`\`${report.chrome ?? 'unknown browser'}\` serving \`${report.server ?? '?'}\`, `
    + `${report.sliceSeconds ?? 0.25} s slices, ${report.summary?.wallSeconds ?? '?'} s wall.`);
  line('');
  line('| route | tier | verdict | sim s | wall s | FAIL | REPORT | KNOWN | visited stages |');
  line('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const route of rows) {
    const verdict = route.fails?.length ? '**FAIL**'
      : route.knownIssues?.length ? 'known issue'
      : route.reports?.length ? 'reports' : 'clean';
    line(`| \`${route.id}\` | ${route.tier ?? '?'} | ${verdict} | ${Math.round(route.simSeconds ?? 0)}`
      + ` | ${route.wallSeconds ?? 0} | ${route.fails?.length ?? 0} | ${route.reports?.length ?? 0}`
      + ` | ${route.knownIssues?.length ?? 0}`
      + ` | ${(route.visitedStages ?? []).join(' → ') || '—'} |`);
  }

  for (const route of rows) {
    if (!route.fails?.length && !route.reports?.length && !route.knownIssues?.length) continue;
    line('');
    line(`### \`${route.id}\``);
    for (const text of route.fails ?? []) {
      line(`- FAIL ${text}`);
      annotation('error', route, text);
    }
    // A declared known issue is a fault the route table admits to; quote it in full so a
    // reader sees what was tolerated rather than only that something was.
    for (const text of route.knownIssues ?? []) {
      line(`- known ${text}`);
      annotation('notice', route, text);
    }
    for (const text of route.reports ?? []) {
      line(`- drift ${text}`);
      annotation('warning', route, text);
    }
  }

  const counted = kind => rows.reduce((sum, route) => sum + (route[kind]?.length ?? 0), 0);
  line('');
  line(`${report.summary?.fails ?? counted('fails')} hard failure(s), `
    + `${report.summary?.reports ?? counted('reports')} report(s), `
    + `${counted('knownIssues')} declared known issue(s) across ${rows.length} route(s).`
    + ' A FAIL is a physical or contractual fact (crash, stall, gear damage, stuck stage, broken'
    + ' handoff); a report is a measured peak that drifted from `scripts/demo-sweep-baseline.json`;'
    + ' a known issue is a route-table declaration that must be deleted once the demo is fixed.');
}
