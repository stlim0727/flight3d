import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

// Load the production adapter without importing its browser-only PeerJS dependency.
const source = readFileSync(new URL('../src/multiplayer/PeerRoom.js', import.meta.url), 'utf8');
const PeerRoom = new Function(`return (${source.slice(source.indexOf('export class ') + 7)});`)();

test('rejected peers get the reason again when an opening send is dropped', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = Object.assign(Object.create(PeerRoom.prototype), { disposed: false, rejections: new Map() });
  const conn = Object.assign(new EventEmitter(), { open: false, sent: [], closed: 0,
    send(m) { this.sent.push(m); }, close() { this.closed++; } });
  room.reject(conn, 'full');
  // Chrome can report the answerer's channel open while dropping its first send (INVALID_STATE).
  conn.open = true; conn.emit('open'); conn.sent.length = 0;
  conn.emit('data', { type: 'hello' });
  assert.deepEqual(conn.sent, [{ type: 'reject', reason: 'full' }]);
  for (let i = 0; i < 20; i++) conn.emit('data', { type: 'ping' });
  assert.ok(conn.sent.length <= 5, 'a rejected peer cannot drive unbounded replies');
  t.mock.timers.tick(2000);
  assert.equal(conn.closed, 1); assert.equal(room.rejections.size, 0);
});
