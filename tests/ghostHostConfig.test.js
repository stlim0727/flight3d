import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { defaultStateDir, findChrome, readConfig } from '../host/config.mjs';

test('standalone configuration validates inputs and preserves private ICE credentials', () => {
  const config = readConfig(['--name', 'Wing', '--room', 'K7M2QX', '--signal-url', 'https://signal.example/peer'], {});
  assert.equal(config.name, 'Wing'); assert.equal(config.room, 'K7M2QX');
  assert.equal(config.options.host, 'signal.example'); assert.equal(config.options.secure, true);
  for (const args of [['--unknown'], ['--name'], ['--room', 'bad'], ['--public-url', 'file:///etc/passwd'], ['--signal-url', 'ftp://wrong'], ['--ice-servers', '{}'], ['--ice-servers', '[{"urls":[2]}]']]) assert.throws(() => readConfig(args, {}));
  assert.throws(() => readConfig(['--ice-servers', 'private-credential-invalid-json'], {}), error => !error.message.includes('private-credential'));
  assert.equal(readConfig(['--version'], { GHOST_ICE_SERVERS: 'invalid' }).flags.has('version'), true);
});
test('state belongs to the user, independently of package/install/working directory', () => {
  assert.equal(defaultStateDir({ XDG_STATE_HOME: '/tmp/test-state' }, 'linux'), '/tmp/test-state/flight3d-ghost');
  assert.equal(defaultStateDir({ LOCALAPPDATA: '/tmp/test-local' }, 'win32'), '/tmp/test-local/Flight3dGhost');
  assert.ok(defaultStateDir({}, 'darwin').startsWith(homedir()));
});
test('installed browser discovery handles explicit paths, spaces, PATH, and missing binaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghost-config-'));
  try {
    const browser = join(dir, 'browser with spaces'); await writeFile(browser, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(findChrome(browser, {}), browser);
    const chromium = join(dir, 'chromium'); await writeFile(chromium, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(findChrome(undefined, { PATH: dir }), chromium);
    const folder = join(dir, 'not-a-browser'); await mkdir(folder);
    assert.throws(() => findChrome(folder, {}));
    assert.throws(() => findChrome(join(dir, 'missing'), {}));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('configuration supports guest mode, join code, and voice flag', () => {
  const guest = readConfig(['--join', 'K7M2QX', '--voice'], {});
  assert.equal(guest.role, 'guest');
  assert.equal(guest.room, 'K7M2QX');
  assert.equal(guest.name, 'Goose');
  assert.equal(guest.voice, true);

  const customGuest = readConfig(['--guest', '--room', 'K7M2QX', '--name', 'Iceman'], {});
  assert.equal(customGuest.role, 'guest');
  assert.equal(customGuest.name, 'Iceman');
  assert.equal(customGuest.voice, false);

  const host = readConfig(['--host', '--voice'], {});
  assert.equal(host.role, 'host');
  assert.equal(host.name, 'Maverick');
  assert.equal(host.voice, true);

  assert.throws(() => readConfig(['--guest'], {}), /Guest mode requires a six-character room code/);
  assert.throws(() => readConfig(['--role', 'unknown'], {}), /Role must be either/);
});
