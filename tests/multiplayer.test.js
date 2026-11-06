import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from 'three';
import { RoomSession } from '../src/multiplayer/RoomSession.js';
import { DEFAULT_CONFIG, RemoteTrack, validSnapshot, inviteUrl, validRoom, newRoom, slotOffset, cleanName } from '../src/multiplayer/protocol.js';
import { VoiceLink } from '../src/multiplayer/VoiceLink.js';

const pose = (seq = 0, epoch = 0) => ({ seq, epoch, round: 1, p: [0, 750, 0], q: [0, 0, 0, 1], v: [0, 0, -60], gear: 1, flaps: 0, crashed: false, held: false, talking: false });
const settle = () => new Promise(resolve => setImmediate(resolve));
function pair({ prepareHost = async () => {}, prepareGuest = async () => {} } = {}) {
  let now = 0, hostFlights = 0, guestFlights = 0;
  const hq = [], gq = [], ends = [];
  const host = new RoomSession({ host: true, name: 'Host', config: DEFAULT_CONFIG, now: () => now, send: m => gq.push(m), prepare: prepareHost, fly: () => hostFlights++, ended: r => ends.push(['host', r]) });
  const guest = new RoomSession({ host: false, name: 'Guest', now: () => now, send: m => hq.push(m), prepare: prepareGuest, fly: () => guestFlights++, ended: r => ends.push(['guest', r]) });
  const flush = () => { while (hq.length || gq.length) { while (hq.length) host.receive(hq.shift()); while (gq.length) guest.receive(gq.shift()); } };
  guest.opened(); flush();
  return { host, guest, flush, hq, gq, ends, advance: ms => { now += ms; }, flights: () => [hostFlights, guestFlights] };
}

test('invite IDs use 128-bit UUID capabilities, retain deployment path and discard solo URL/hash', () => {
  const room = newRoom(); assert.equal(validRoom(room), true);
  const u = new URL(inviteUrl(room, 'https://example.org/flight3d/?fly=1&terrain=lukla#x'));
  assert.equal(u.pathname, '/flight3d/'); assert.equal(u.searchParams.get('room'), room); assert.equal(u.hash, ''); assert.equal(u.searchParams.size, 1);
  for (const invalid of ['', '<script>', 'f3d-1234', null, room + '/x']) assert.equal(validRoom(invalid), false);
  assert.equal(cleanName('<b>\nPilot\0'), 'bPilot');
  assert.equal(cleanName(''), 'Pilot');
});

test('host owns config and start; neither pilot flies until both prepare, duplicates cannot restart', async () => {
  let readyHost, readyGuest;
  const p = pair({ prepareHost: () => new Promise(r => { readyHost = r; }), prepareGuest: () => new Promise(r => { readyGuest = r; }) });
  assert.equal(p.host.state, 'connected'); assert.deepEqual(p.guest.config, DEFAULT_CONFIG);
  assert.equal(p.guest.start(), false);
  p.host.receive({ type: 'prepare', round: 1 }); assert.equal(p.host.state, 'connected');
  assert.equal(p.host.start(), true); p.flush(); assert.deepEqual(p.flights(), [0, 0]);
  readyGuest(); await settle(); p.flush(); assert.deepEqual(p.flights(), [0, 0]);
  readyHost(); await settle(); p.flush(); assert.deepEqual(p.flights(), [1, 1]);
  p.host.receive({ type: 'ready', round: 1 }); p.guest.receive({ type: 'go', round: 1 }); p.guest.receive({ type: 'prepare', round: 1 });
  assert.deepEqual(p.flights(), [1, 1]); assert.equal(p.host.start(), true); p.flush();
  readyGuest(); readyHost(); await settle(); p.flush(); assert.deepEqual(p.flights(), [2, 2]);
});

test('disconnect during asynchronous prepare cannot release an ended room', async () => {
  let ready;
  const p = pair({ prepareGuest: () => new Promise(r => { ready = r; }) });
  p.host.start(); p.flush(); await settle(); p.flush();
  p.guest.end('peer-left'); ready(); await settle(); p.flush();
  assert.equal(p.guest.state, 'ended'); assert.deepEqual(p.flights(), [0, 0]);
  p.guest.end('again'); assert.equal(p.ends.length, 1);
});

test('failed prepare, incompatible versions and handshakes time out explicitly', async () => {
  const p = pair({ prepareHost: async () => { throw new Error('scene'); } });
  p.host.start(); await settle(); assert.equal(p.host.state, 'ended'); assert.equal(p.ends[0][1], 'prepare-failed');
  const session = new RoomSession({ host: true, config: DEFAULT_CONFIG, send() {} });
  session.receive({ type: 'hello', version: 999, name: 'x' }); assert.equal(session.state, 'ended');
  const q = pair(); q.advance(20001); q.host.tick(); assert.equal(q.ends[0][1], 'timeout');
  let clock = 0;
  const connecting = new RoomSession({ host: false, send() {}, now: () => clock });
  clock = 20001; connecting.tick(); assert.equal(connecting.state, 'ended');
});

test('snapshots require a live matching round, bounded normalized values and monotonic sequence/epoch', async () => {
  const p = pair(); p.host.start(); p.flush(); await settle(); p.flush();
  p.host.snapshot(pose()); p.flush(); assert.equal(p.guest.track.samples.length, 1);
  p.guest.receive({ type: 'snapshot', ...pose(10), round: 0 }); assert.equal(p.guest.track.seq, 0);
  for (const bad of [{ p: [Infinity, 0, 0] }, { q: [0, 0, 0, 0] }, { p: [0, 0] }, { v: [1e8, 0, 0] }, { seq: -1 }, { epoch: 0.5 }, { gear: 2 }, { flaps: NaN }]) assert.equal(validSnapshot({ ...pose(), ...bad }), false);
  const track = new RemoteTrack();
  assert.equal(track.push(pose(1), 0), true); assert.equal(track.push(pose(1), 1), false);
  track.push({ ...pose(2), p: [100, 750, 0] }, 100);
  assert.equal(track.sample(170).p[0], 50);
  track.push({ ...pose(3, 1), p: [5000, 750, 0] }, 200);
  assert.equal(track.samples.length, 1); assert.equal(track.sample(200).p[0], 5000);
  assert.equal(track.push(pose(4, 0), 220), false);
  assert.equal(track.sample(800).stale, true); assert.equal(track.sample(3201), null);
});

test('slots are non-overlapping in aircraft coordinates and rotate with heading', () => {
  assert.deepEqual(slotOffset('runway', 0, new Quaternion()).toArray(), [0, 0, 0]);
  assert.deepEqual(slotOffset('runway', 1, new Quaternion()).toArray(), [0, 0, 80]);
  const q = new Quaternion(0, -Math.SQRT1_2, 0, Math.SQRT1_2);
  assert.ok(slotOffset('runway', 1, q).distanceTo({ x: -80, y: 0, z: 0 }) < 1e-8);
  assert.ok(slotOffset('cruise', 1, q).length() > 60);
});

function voiceFixture(capture) {
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const micTrack = { ...track };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const mic = { getTracks: () => [micTrack], getAudioTracks: () => [micTrack] };
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, gain: { value: 1 }, offset: { value: 1 } });
  const context = { state: 'suspended', createMediaStreamDestination: () => ({ ...node(), stream }), createGain: node, createConstantSource: node, createMediaStreamSource: node,
    async resume() { this.state = 'running'; }, async close() { this.state = 'closed'; } };
  const voice = new VoiceLink({ context, capture: capture ?? (async () => mic) });
  return { voice, context, track, micTrack, mic };
}

test('listen-only never captures; PTT needs permission, release and disable silence, leave stops all tracks', async () => {
  const { voice, context, track, micTrack } = voiceFixture();
  assert.equal(track.enabled, false); voice.setTalking(true); assert.equal(voice.talking, false);
  await voice.enableMicrophone(); assert.equal(track.enabled, false);
  voice.setTalking(true); assert.equal(voice.talking, true); assert.equal(track.enabled, true); assert.equal(voice.gain.gain.value, 1);
  voice.setTalking(false); assert.equal(track.enabled, false); assert.equal(voice.gain.gain.value, 0);
  voice.disableMicrophone(); assert.equal(micTrack.stopped, true);
  voice.close(); voice.close(); assert.equal(track.stopped, true); assert.equal(context.state, 'closed');
});

test('permission denial retains listening; capture resolving after leave is stopped', async () => {
  const { voice } = voiceFixture(async () => { throw new Error('denied'); });
  await voice.enableMicrophone(); assert.equal(voice.error, 'microphone'); assert.equal(voice.closed, false);
  voice.close();
  let resolve;
  const f = voiceFixture(() => new Promise(r => { resolve = r; }));
  const pending = f.voice.enableMicrophone(); await settle(); f.voice.close(); resolve(f.mic); await pending;
  assert.equal(f.micTrack.stopped, true); assert.equal(f.voice.microphone, null);
});

test('multiplayer crash debrief retry resets only this pilot, preserving the shared room', async () => {
  const { SimulatorClass } = await import('./helpers/simulatorClass.js');
  const sim = Object.create(SimulatorClass.prototype);
  let resets = 0;
  sim.multiplayer = { active: true, respawnLocal: () => resets++ };
  // No debrief metadata required: the shared room owns spawn configuration.
  sim.retryDebrief(); assert.equal(resets, 1);
});

test('regular flight, aircraft, and lighting changes cannot bypass shared room configuration', async () => {
  const { SimulatorClass } = await import('./helpers/simulatorClass.js');
  const sim = Object.create(SimulatorClass.prototype);
  sim.multiplayer = { locked: true };
  await sim.fly(); sim.startFlight(); sim.setAircraft('F16'); sim.setTimeOfDay(23);
  assert.equal(sim.currentAircraftId, undefined); assert.equal(sim.sky, undefined);
});
