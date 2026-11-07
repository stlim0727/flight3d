// Build on the target OS/architecture: the executable embeds its Node runtime and assets.
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, chmod, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'artifacts/ghost-host');
const portable = join(out, 'package');
const original = JSON.parse(await readFile(join(portable, 'manifest.json'), 'utf8'));
if (!['linux', 'darwin', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported native build platform');
const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const target = `${platform}-${process.arch}`;
const work = join(out, `native-${target}`);
const stage = join(work, 'package');
await rm(work, { recursive: true, force: true }); await mkdir(stage, { recursive: true });
await build({ root, configFile: false, publicDir: false, logLevel: 'warn',
  build: { ssr: join(root, 'host/native-entry.mjs'), outDir: work, emptyOutDir: false,
    rolldownOptions: { output: { format: 'cjs', entryFileNames: 'entry.cjs', codeSplitting: false } } },
});
const manifest = { ...original, distribution: 'native', platform: process.platform, arch: process.arch, nodeVersion: process.versions.node };
await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const blob = join(work, 'host.blob');
const seaConfig = join(work, 'sea.json');
await writeFile(seaConfig, JSON.stringify({ main: join(work, 'entry.cjs'), output: blob,
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false,
  assets: { 'manifest.json': join(work, 'manifest.json'), 'web/host.js': join(portable, 'web/host.js'), 'web/index.html': join(portable, 'web/index.html') },
}));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
const executable = join(stage, `flight3d-ghost-host${process.platform === 'win32' ? '.exe' : ''}`);
await copyFile(process.execPath, executable); await chmod(executable, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', executable]);
const postjectRoot = dirname(require.resolve('postject/package.json'));
const metadata = JSON.parse(await readFile(join(postjectRoot, 'package.json'), 'utf8'));
execFileSync(process.execPath, [join(postjectRoot, metadata.bin.postject), executable, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', executable]);
const actual = JSON.parse(execFileSync(executable, ['--version'], { encoding: 'utf8' }));
if (actual.sourceCommit !== original.sourceCommit || actual.platform !== process.platform || actual.arch !== process.arch) throw new Error('Native executable metadata verification failed');
for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(join(portable, name), join(stage, name));
await copyFile(join(root, 'host/SETUP.md'), join(stage, 'SETUP.md'));
await copyFile(join(root, 'deploy/flight3d-ghost-native.service'), join(stage, 'flight3d-ghost.service'));
let nodeLicense;
for (const path of [join(dirname(process.execPath), 'LICENSE'), join(dirname(process.execPath), '..', 'LICENSE')]) {
  try { nodeLicense = await readFile(path); break; } catch { /* Try distribution root. */ }
}
if (!nodeLicense) throw new Error('Node distribution LICENSE is required to redistribute the runtime.');
await writeFile(join(stage, 'NODE_LICENSE.txt'), nodeLicense);
const archive = join(out, `flight3d-ghost-host-${original.version}-${target}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`);
await rm(archive, { force: true });
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-ChildItem -LiteralPath $env:GHOST_ARCHIVE_SOURCE | Compress-Archive -DestinationPath $env:GHOST_ARCHIVE_TARGET'],
  { env: { ...process.env, GHOST_ARCHIVE_SOURCE: stage, GHOST_ARCHIVE_TARGET: archive }, stdio: 'inherit' });
} else execFileSync('tar', ['-czf', archive, '-C', stage, '.']);
const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(join(out, `SHA256SUMS-${target}`), `${sha}  ${archive.slice(out.length + 1)}\n`);
console.log(JSON.stringify({ executable, archive, bytes: (await stat(archive)).size, sha256: sha, target }));
