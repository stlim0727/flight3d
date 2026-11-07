// Repository convenience entry. Distributed users run the built CLI directly.
import { existsSync } from 'node:fs';
const entry = new URL('../artifacts/ghost-host/package/cli.mjs', import.meta.url);
if (!existsSync(entry)) throw new Error('Build the standalone host first: npm run build:ghost');
await import(entry.href);
