// Compact Node test reporter: prints full diagnostics on failure and a 1-line summary on pass.
// Prevents 5,000+ lines (~198 KB) of TAP output from flooding AI agent context windows in non-TTY runs.
export default async function* compactReporter(source) {
  let passed = 0;
  let failed = 0;
  let suites = 0;
  const startMs = Date.now();
  const failures = [];
  const stderrChunks = [];

  for await (const event of source) {
    if (event.type === 'test:pass') {
      if (event.data.details?.type === 'suite') suites++;
      else passed++;
    } else if (event.type === 'test:fail') {
      if (event.data.details?.type !== 'suite') {
        failed++;
        const err = event.data.details?.error;
        const msg = err?.stack || err?.message || String(err || 'Test failed');
        const loc = event.data.file ? `${event.data.file}:${event.data.line ?? 1}` : '';
        failures.push(`✖ ${event.data.name}${loc ? ` (${loc})` : ''}\n  ${msg.replace(/\n/g, '\n  ')}\n`);
      }
    } else if (event.type === 'test:stderr') {
      stderrChunks.push(event.data.message);
    }
  }

  if (failed > 0) {
    if (stderrChunks.length > 0) yield stderrChunks.join('');
    yield `\n${failures.join('\n')}\n`;
  }
  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
  yield `${failed === 0 ? '✔' : '✖'} tests: ${passed} passed, ${failed} failed (${suites} suites, ${elapsedSec}s)\n`;
}
