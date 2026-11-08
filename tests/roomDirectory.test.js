import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryRoomDirectoryStore,
  handleDirectoryRequest,
  validateRoomRegistration,
  hashToken,
} from '../src/multiplayer/roomDirectory.js';
import { RoomDirectoryClient } from '../src/multiplayer/RoomDirectoryClient.js';
import { PROTOCOL_VERSION, FLIGHT_REVISION } from '../src/multiplayer/compatibility.js';

test('validateRoomRegistration accepts valid input and rejects malformed values', () => {
  const valid = {
    roomCode: 'K7M2QX',
    name: 'Maverick',
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'cruise',
    currentPlayers: 1,
    maxPlayers: 2,
    status: 'waiting',
    protocolMajor: 2,
    flightRevision: 1,
  };

  const parsed = validateRoomRegistration(valid);
  assert.equal(parsed.roomCode, 'K7M2QX');
  assert.equal(parsed.name, 'Maverick');
  assert.equal(parsed.airport, 'coastal');
  assert.equal(parsed.aircraft, 'B738');

  assert.throws(() => validateRoomRegistration({ ...valid, roomCode: 'INVALID!' }), /invalid-room-code/);
  assert.throws(() => validateRoomRegistration({ ...valid, name: '' }), /invalid-host-name/);
  assert.throws(() => validateRoomRegistration({ ...valid, name: 'A'.repeat(25) }), /invalid-host-name/);
  assert.throws(() => validateRoomRegistration({ ...valid, currentPlayers: 5 }), /invalid-current-players/);
  assert.throws(() => validateRoomRegistration({ ...valid, maxPlayers: 0 }), /invalid-max-players/);
  assert.throws(() => validateRoomRegistration({ ...valid, status: 'unknown' }), /invalid-status/);
  assert.throws(() => validateRoomRegistration({ ...valid, protocolMajor: 0 }), /invalid-protocol-major/);
  assert.throws(() => validateRoomRegistration({ ...valid, flightRevision: null }), /invalid-flight-revision/);
});

test('MemoryRoomDirectoryStore handles registration, token secrecy, heartbeat and 45s expiration', async () => {
  const store = new MemoryRoomDirectoryStore({ ttlMs: 45000 });
  const t0 = 100000;

  const reg = await store.registerRoom({
    roomCode: 'K7M2QX',
    name: 'Maverick',
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'cruise',
    currentPlayers: 1,
    maxPlayers: 2,
    status: 'waiting',
    protocolMajor: 2,
    flightRevision: 1,
  }, t0);

  assert.ok(reg.id);
  assert.ok(reg.token);
  assert.equal(reg.leaseGeneration, 1);
  assert.equal(reg.expiresAt, t0 + 45000);
  assert.equal(reg.room.roomCode, 'K7M2QX');
  assert.equal(reg.room.token, undefined);
  assert.equal(reg.room.tokenHash, undefined);

  // List returns the room before expiration
  let list = store.listRooms({ now: t0 + 10000 });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, reg.id);
  assert.equal(list[0].token, undefined);

  // Heartbeat updates expiration and status
  const hb = await store.heartbeat(reg.id, reg.token, { status: 'full', currentPlayers: 2 }, t0 + 15000);
  assert.equal(hb.status, 200);
  assert.equal(hb.body.expiresAt, t0 + 15000 + 45000);
  assert.equal(hb.body.room.status, 'full');
  assert.equal(hb.body.room.currentPlayers, 2);

  // Heartbeat with invalid token fails with 403
  const badTokenHb = await store.heartbeat(reg.id, 'wrong-token', {}, t0 + 20000);
  assert.equal(badTokenHb.status, 403);

  // Heartbeat with stale generation fails with 409
  const staleHb = await store.heartbeat(reg.id, reg.token, { leaseGeneration: 999 }, t0 + 20000);
  assert.equal(staleHb.status, 409);

  // 45 seconds after last heartbeat (t0 + 15000 + 45000), room expires
  const expiredTime = t0 + 15000 + 45001;
  list = store.listRooms({ now: expiredTime });
  assert.equal(list.length, 0);

  const lateHb = await store.heartbeat(reg.id, reg.token, {}, expiredTime);
  assert.equal(lateHb.status, 404);
});

test('superseding registration increments generation and removes old entry', async () => {
  const store = new MemoryRoomDirectoryStore();
  const t0 = 1000;

  const reg1 = await store.registerRoom({
    roomCode: 'K7M2QX',
    name: 'First Host',
    airport: 'coastal',
    aircraft: 'C172',
    scenario: 'runway',
    protocolMajor: 2,
    flightRevision: 1,
  }, t0);
  assert.equal(reg1.leaseGeneration, 1);

  const reg2 = await store.registerRoom({
    roomCode: 'K7M2QX',
    name: 'Reopened Host',
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'cruise',
    protocolMajor: 2,
    flightRevision: 1,
  }, t0 + 5000);
  assert.equal(reg2.leaseGeneration, 2);
  assert.notEqual(reg1.id, reg2.id);

  // Old process heartbeat must fail
  const oldHb = await store.heartbeat(reg1.id, reg1.token, {}, t0 + 6000);
  assert.equal(oldHb.status, 404);

  // New heartbeat succeeds
  const newHb = await store.heartbeat(reg2.id, reg2.token, {}, t0 + 6000);
  assert.equal(newHb.status, 200);

  // Deleting new room with old token or stale generation fails
  const badDel = await store.deleteRoom(reg2.id, reg1.token, {}, t0 + 7000);
  assert.equal(badDel.status, 403);

  const goodDel = await store.deleteRoom(reg2.id, reg2.token, { leaseGeneration: 2 }, t0 + 7000);
  assert.equal(goodDel.status, 200);
  assert.equal(store.listRooms({ now: t0 + 7000 }).length, 0);
});

test('handleDirectoryRequest handles HTTP routes, CORS, filters and errors', async () => {
  const store = new MemoryRoomDirectoryStore();
  const now = 200000;

  // OPTIONS request for CORS preflight
  const optRes = await handleDirectoryRequest(new Request('https://directory.flight3d/v1/rooms', { method: 'OPTIONS' }), store, { now });
  assert.equal(optRes.status, 204);
  assert.equal(optRes.headers.get('Access-Control-Allow-Origin'), '*');

  // Register room via POST /v1/rooms
  const postRes = await handleDirectoryRequest(new Request('https://directory.flight3d/v1/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: '8W3N9Z',
      name: 'Pilot Park',
      airport: 'incheon',
      aircraft: 'F16',
      scenario: 'runway',
      protocolMajor: 2,
      flightRevision: 1,
    }),
  }), store, { now });

  assert.equal(postRes.status, 201);
  const postData = await postRes.json();
  assert.ok(postData.id);
  assert.ok(postData.token);

  // GET /v1/rooms matching filter
  const getRes = await handleDirectoryRequest(new Request('https://directory.flight3d/v1/rooms?protocol=2&flight=1'), store, { now: now + 1000 });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.rooms.length, 1);
  assert.equal(getData.rooms[0].roomCode, '8W3N9Z');

  // GET /v1/rooms with incompatible filter returns empty
  const filterRes = await handleDirectoryRequest(new Request('https://directory.flight3d/v1/rooms?protocol=3'), store, { now: now + 1000 });
  const filterData = await filterRes.json();
  assert.equal(filterData.rooms.length, 0);

  // Heartbeat via POST /v1/rooms/:id/heartbeat with Bearer token
  const hbRes = await handleDirectoryRequest(new Request(`https://directory.flight3d/v1/rooms/${postData.id}/heartbeat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${postData.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'flying' }),
  }), store, { now: now + 5000 });

  assert.equal(hbRes.status, 200);
  const hbData = await hbRes.json();
  assert.equal(hbData.ok, true);

  // DELETE /v1/rooms/:id
  const delRes = await handleDirectoryRequest(new Request(`https://directory.flight3d/v1/rooms/${postData.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${postData.token}` },
  }), store, { now: now + 6000 });

  assert.equal(delRes.status, 200);
  assert.equal(store.listRooms({ now: now + 6000 }).length, 0);

  // Asynchronous store listRooms (e.g. D1RoomDirectoryStore) is awaited
  const asyncStore = {
    async listRooms() {
      return [{ id: 'room-async', name: 'AsyncHost', roomCode: 'K7M2QX' }];
    },
  };
  const asyncGetRes = await handleDirectoryRequest(new Request('https://directory.flight3d/v1/rooms'), asyncStore);
  assert.equal(asyncGetRes.status, 200);
  const asyncGetData = await asyncGetRes.json();
  assert.equal(Array.isArray(asyncGetData.rooms), true);
  assert.equal(asyncGetData.rooms.length, 1);
  assert.equal(asyncGetData.rooms[0].name, 'AsyncHost');
});

test('RoomDirectoryClient handles registration, heartbeat and graceful errors', async () => {
  const store = new MemoryRoomDirectoryStore();
  let fakeNow = 500000;

  // Custom fetch mock routing directly to handleDirectoryRequest
  const mockFetch = async (input, init = {}) => {
    const req = new Request(input, init);
    return handleDirectoryRequest(req, store, { now: fakeNow });
  };

  const client = new RoomDirectoryClient({
    directoryUrl: 'https://directory.flight3d',
    fetchFn: mockFetch,
  });

  // Fetch rooms initially empty
  let res = await client.fetchRooms();
  assert.equal(res.ok, true);
  assert.equal(res.rooms.length, 0);

  // Register room
  const reg = await client.register({
    roomCode: '4M9X2L',
    name: 'TopGun',
    airport: 'neon',
    aircraft: 'C172',
    scenario: 'cruise',
  });
  assert.equal(reg.ok, true);
  assert.equal(client.isRegistered, true);

  // Fetch rooms shows TopGun
  res = await client.fetchRooms();
  assert.equal(res.ok, true);
  assert.equal(res.rooms.length, 1);
  assert.equal(res.rooms[0].name, 'TopGun');

  // Heartbeat succeeds
  fakeNow += 15000;
  const hb = await client.heartbeat({ status: 'flying' });
  assert.equal(hb.ok, true);

  // Unregister clears state
  const unreg = await client.unregister();
  assert.equal(unreg.ok, true);
  assert.equal(client.isRegistered, false);

  res = await client.fetchRooms();
  assert.equal(res.rooms.length, 0);

  // unregisterLease deletes specified lease
  const reg2 = await client.register({
    roomCode: '9X2L4M',
    name: 'GhostLease',
    airport: 'coastal',
    aircraft: 'B738',
    scenario: 'cruise',
  });
  assert.equal(reg2.ok, true);
  assert.equal(client.isRegistered, true);

  // unregistering an unrelated lease does not affect current client registration
  await client.unregisterLease({ id: 'room-other', token: 'tok-other' });
  assert.equal(client.isRegistered, true);

  // unregistering this lease removes the room and clears registration
  const unregLeaseRes = await client.unregisterLease(reg2.registration);
  assert.equal(unregLeaseRes.ok, true);
  assert.equal(client.isRegistered, false);
  res = await client.fetchRooms();
  assert.equal(res.rooms.length, 0);

  // Graceful degradation when directory is not reachable
  const brokenClient = new RoomDirectoryClient({
    directoryUrl: 'https://unreachable.invalid',
    fetchFn: async () => { throw new Error('Failed to fetch'); },
  });
  const brokenFetch = await brokenClient.fetchRooms();
  assert.equal(brokenFetch.ok, false);
  assert.equal(brokenFetch.rooms.length, 0);

  const brokenReg = await brokenClient.register({ roomCode: '4M9X2L', name: 'X' });
  assert.equal(brokenReg.ok, false);
});
