// Check tracked application/tooling JavaScript without executing browser code.
import { execFileSync, spawnSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '--others',
  '--exclude-standard', '-z', '--', 'src', 'scripts', 'tests', 'host', 'vite.config.js'],
  { encoding: 'utf8' }).split('\0').filter(file => /\.m?js$/.test(file));
if (!files.length) throw new Error('No JavaScript files found; run from the repository root.');
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) failures++;
}
console.log(`Syntax checked ${files.length} JavaScript files; failures: ${failures}`);
if (failures) process.exitCode = 1;
