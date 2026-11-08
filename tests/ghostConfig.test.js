import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../host/config.mjs';

test('readConfig parses --public and --directory flags and environment variables', () => {
  const conf1 = readConfig(['--public', '--directory', 'https://directory.flight3d/v1']);
  assert.equal(conf1.isPublic, true);
  assert.equal(conf1.directoryUrl, 'https://directory.flight3d/v1');

  const conf2 = readConfig([], { GHOST_PUBLIC: '1', GHOST_DIRECTORY_URL: 'https://directory.example.com/' });
  assert.equal(conf2.isPublic, true);
  assert.equal(conf2.directoryUrl, 'https://directory.example.com/');

  const confDefault = readConfig([]);
  assert.equal(confDefault.isPublic, false);
  assert.equal(confDefault.directoryUrl, null);

  assert.throws(() => readConfig(['--directory', 'ftp://invalid']), /Directory URL must be an HTTP\(S\) URL/);
});
