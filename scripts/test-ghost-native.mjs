import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const name = `flight3d-ghost-host${process.platform === 'win32' ? '.exe' : ''}`;
const built = resolve(`artifacts/ghost-host/native-${platform}-${process.arch}/package/${name}`);
const temp = await mkdtemp(join(tmpdir(), 'ghost-native-'));
try {
  const binary = join(temp, name); await copyFile(built, binary);
  const options = { cwd: temp, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_PATH: '' } };
  const manifest = JSON.parse(execFileSync(binary, ['--version'], options));
  assert.equal(manifest.distribution, 'native'); assert.equal(manifest.platform, process.platform);
  assert.equal(manifest.arch, process.arch); assert.equal(manifest.protocolVersion, 2); assert.equal(manifest.flightRevision, 1);
  assert.match(execFileSync(binary, ['--help'], options), /Chrome\/Chromium/);
  assert.throws(() => execFileSync(binary, ['--check', '--chrome', join(temp, 'missing-browser')], { ...options, stdio: 'pipe' }), error => String(error.stderr).includes('Chrome/Chromium not found'));
  console.log(`PASS native ${platform}-${process.arch}: standalone executable runs in an empty directory, embedded metadata/help, missing-browser diagnostics.`);
} finally { await rm(temp, { recursive: true, force: true }); }
