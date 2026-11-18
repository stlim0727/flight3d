import test from 'node:test';
import assert from 'node:assert/strict';
import { peerOptions, DEFAULT_ICE_SERVERS } from '../src/multiplayer/peerOptions.js';

test('peerOptions returns default multi-region STUN servers when ICE servers are unspecified', () => {
  const options = peerOptions({});
  assert.equal(options.debug, 0);
  assert.deepEqual(options.config?.iceServers, DEFAULT_ICE_SERVERS);
  assert.ok(DEFAULT_ICE_SERVERS.some(s => s.urls.includes('cloudflare.com')));
  assert.ok(DEFAULT_ICE_SERVERS.some(s => s.urls.includes('google.com')));
  assert.ok(DEFAULT_ICE_SERVERS.some(s => (typeof s.urls === 'string' && s.urls.includes('peerjs.com')) || (Array.isArray(s.urls) && s.urls.some(u => u.includes('peerjs.com')))));
});

test('peerOptions parses custom ICE servers from environment', () => {
  const custom = [{ urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pwd' }];
  const options = peerOptions({ VITE_MULTIPLAYER_ICE_SERVERS: JSON.stringify(custom) });
  assert.deepEqual(options.config?.iceServers, custom);
});

test('peerOptions preserves build VITE_MULTIPLAYER_ICE_SERVERS over dynamic servers', () => {
  const buildServers = [{ urls: 'turn:turn.build.example.com:3478', username: 'build', credential: 'pwd' }];
  const dynamicServers = [{ urls: 'turn:turn.dynamic.example.com:3478', username: 'dyn', credential: 'pwd' }];
  const options = peerOptions({ VITE_MULTIPLAYER_ICE_SERVERS: JSON.stringify(buildServers) }, dynamicServers);
  assert.deepEqual(options.config?.iceServers, buildServers);
});

test('peerOptions uses dynamicIceServers when build environment has no ICE servers', () => {
  const dynamic = [{ urls: 'turn:turn.cloudflare.com:3478', username: 'u', credential: 'c' }];
  const options = peerOptions({}, dynamic);
  assert.deepEqual(options.config?.iceServers, dynamic);
});

test('peerOptions parses custom signaling URL from environment', () => {
  const options = peerOptions({ VITE_MULTIPLAYER_SIGNAL_URL: 'https://signal.example.com:8443/custom' });
  assert.equal(options.host, 'signal.example.com');
  assert.equal(options.port, 8443);
  assert.equal(options.path, '/custom');
  assert.equal(options.secure, true);
});

test('peerOptions rejects invalid signaling protocols', () => {
  assert.throws(() => peerOptions({ VITE_MULTIPLAYER_SIGNAL_URL: 'ftp://example.com' }), /invalid-signaling/);
});
