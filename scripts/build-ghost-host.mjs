import { build } from 'vite';
import { mkdir, readFile, writeFile, copyFile, chmod, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PROTOCOL_VERSION, FLIGHT_REVISION, LEGACY_FLIGHT_REVISION } from '../src/multiplayer/compatibility.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'artifacts/ghost-host');
const pkg = join(out, 'package');
const metadata = JSON.parse(await readFile(join(root, 'host/package.json'), 'utf8'));
const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', 'host', 'src', 'scripts', 'package.json', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).trim());
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await rm(out, { recursive: true, force: true });
await mkdir(pkg, { recursive: true });
await build({ root, configFile: false, publicDir: false, logLevel: 'warn',
  define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false }) },
  build: { outDir: join(pkg, 'web'), emptyOutDir: true, minify: true,
    lib: { entry: join(root, 'src/multiplayer/ghostHostPage.js'), name: 'Flight3dGhostHost', formats: ['iife'], fileName: () => 'host.js' } },
});
await build({ root, configFile: false, publicDir: false, logLevel: 'warn',
  build: { ssr: join(root, 'host/cli.mjs'), outDir: pkg, emptyOutDir: false,
    rolldownOptions: { output: { entryFileNames: 'cli.mjs', codeSplitting: false } } },
});
await writeFile(join(pkg, 'web/index.html'), '<!doctype html><meta charset="utf-8"><title>Flight host</title><script src="/host.js"></script>\n');
await writeFile(join(pkg, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(join(pkg, 'manifest.json'), JSON.stringify({ version: metadata.version, sourceCommit, sourceDirty,
  protocolVersion: PROTOCOL_VERSION, flightRevision: FLIGHT_REVISION,
  legacyFlightRevision: LEGACY_FLIGHT_REVISION, configSchema: 1 }, null, 2) + '\n');
for (const name of ['README.md', 'LICENSE']) await copyFile(join(root, 'host', name), join(pkg, name));
await copyFile(join(root, 'deploy/flight3d-ghost.service'), join(pkg, 'flight3d-ghost.service'));
let notices = 'Bundled JavaScript licenses. No aircraft models, scenery, audio or other game assets are distributed.\n';
for (const module of ['three', 'peerjs']) {
  const directory = join(root, 'node_modules', module);
  const name = (await readdir(directory)).find(name => /^licen[cs]e(\.txt|\.md)?$/i.test(name));
  if (!name) throw new Error(`Missing license for ${module}`);
  notices += `\n--- ${module} ---\n` + await readFile(join(directory, name), 'utf8');
}
await writeFile(join(pkg, 'THIRD_PARTY_NOTICES.txt'), notices);
await chmod(join(pkg, 'cli.mjs'), 0o755);
const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], { cwd: pkg, encoding: 'utf8' }))[0];
const archive = join(out, packed.filename);
const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(join(out, 'SHA256SUMS'), `${sha}  ${packed.filename}\n`);
console.log(JSON.stringify({ archive, bytes: packed.size, files: packed.files.map(file => file.path), sha256: sha }));
