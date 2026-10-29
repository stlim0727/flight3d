// Deprecated shim: the B737 coastal demo is flown and judged by the demo sweep, which
// claims its own ports and browser and checks the flight instead of one assertion list.
// `npm run test:demo` still works; see scripts/demo-sweep.mjs for the knobs.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/demo-sweep.mjs', '--only', 'b738-coastal-classic', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
