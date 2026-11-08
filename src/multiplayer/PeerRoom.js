import { Peer } from 'peerjs';
import { RoomSession } from './RoomSession.js';
import { WaitingLease, WAITING_TIMEOUT_MS } from './WaitingLease.js';
import { newRoom, validRoom, roomPeerId, VERSION } from './protocol.js';

/** Production configuration comes from the build, never an invite link. */
function peerOptions(env = import.meta.env) {
  const options = { debug: 0 };
  if (env.VITE_MULTIPLAYER_SIGNAL_URL) {
    const url = new URL(env.VITE_MULTIPLAYER_SIGNAL_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid-signaling');
    Object.assign(options, { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), path: url.pathname, secure: url.protocol === 'https:' });
  }
  if (env.VITE_MULTIPLAYER_ICE_SERVERS) options.config = { iceServers: JSON.parse(env.VITE_MULTIPLAYER_ICE_SERVERS) };
  return options;
}

/** Exactly one admitted peer. PeerJS is confined here so protocol tests need no browser. */
export class PeerRoom {
  constructor({ room, hostRoom, name, config, voice, options = peerOptions(), prepare, fly, changed = () => {}, remoteStream = () => {}, ended = () => {}, waitingMs = WAITING_TIMEOUT_MS }) {
    if ((room && hostRoom) || (hostRoom && !validRoom(hostRoom)) || (room && !validRoom(room))) throw new Error('invalid-room');
    this.host = !room; this.room = room || hostRoom || newRoom(); this.closed = false; this.disposed = false; this.waitingMs = waitingMs; this.rejections = new Map();
    Object.assign(this, { voice, changed, remoteStream, ended });
    this.session = new RoomSession({ host: this.host, name, config, prepare, canStart: () => this.checkWaiting(),
      fly: () => { this.hasStarted = true; fly?.(); },
      send: m => this.send(m), changed, ended: reason => this.close(reason) });
    this.peer = new Peer(this.host ? roomPeerId(this.room) : undefined, options);
    this.peer.on('open', () => {
      if (this.closed) return;
      this.registered = true;
      if (this.host) this.waitingLease = new WaitingLease({ duration: this.waitingMs });
      this.changed();
      if (!this.host) this.attach(this.peer.connect(roomPeerId(this.room), { reliable: true, serialization: 'json', metadata: { version: VERSION } }));
    });
    this.peer.on('connection', conn => {
      this.checkWaiting();
      if (this.closed) { this.reject(conn, 'cancelled'); return; }
      if (!this.host || this.connection) { this.reject(conn, 'full'); return; }
      this.attach(conn);
    });
    this.peer.on('call', call => {
      if (!this.checkWaiting()) { call.close(); return; }
      if (this.closed || !this.connection?.open || call.peer !== this.connection.peer || this.call || !this.voice) { call.close(); return; }
      this.attachCall(call); call.answer(this.voice.stream);
    });
    this.peer.on('error', error => {
      if (this.closed) { this.dispose(); return; }
      this.close(error.type === 'peer-unavailable' ? 'not-found' : 'connection');
    });
    this.peer.on('disconnected', () => { if (this.closed) this.dispose(); else this.close('connection'); });
    this.lastHeartbeat = performance.now();
    this.timer = setInterval(() => {
      if (!this.checkWaiting()) return;
      const seconds = this.waitingSeconds;
      if (seconds !== this.shownSeconds) { this.shownSeconds = seconds; this.changed(); }
      if (performance.now() - this.lastHeartbeat < 1000) return;
      this.lastHeartbeat = performance.now();
      if (this.host && this.registered && !this.connection) this.session.createdAt = performance.now();
      this.session.tick();
    }, 100);
  }
  // Only until a friend is admitted: a joined room never expires while waiting for Start.
  get waiting() { return this.host && this.registered && !this.closed && this.session.state === 'connecting'; }
  get waitingSeconds() { return this.waiting ? Math.ceil(this.waitingLease.remaining / 1000) : null; }
  checkWaiting() {
    if (this.closed) return false;
    if (this.waiting && this.waitingLease.expired) { this.close('cancelled'); return false; }
    return true;
  }
  keepWaiting() {
    if (!this.checkWaiting() || !this.waiting || !this.waitingLease.renew()) return false;
    this.changed(); return true;
  }
  reject(conn, reason) {
    const cleanup = () => { clearTimeout(this.rejections.get(conn)); this.rejections.delete(conn); conn.close(); };
    this.rejections.set(conn, setTimeout(cleanup, 5000));
    conn.on('error', cleanup);
    conn.on('open', () => {
      if (this.disposed) { cleanup(); return; }
      conn.send({ type: 'reject', reason });
      clearTimeout(this.rejections.get(conn));
      this.rejections.set(conn, setTimeout(cleanup, 2000));
    });
  }
  attach(conn) {
    this.connection = conn;
    conn.on('open', () => {
      if (!this.checkWaiting()) { conn.close(); return; }
      this.session.opened(); this.changed();
    });
    conn.on('data', message => {
      if (typeof message !== 'object' || message === null || JSON.stringify(message).length > 4096) return;
      if (!this.checkWaiting()) return;
      // Bound work from a peer independently of rendering and room heartbeat.
      const second = Math.floor(performance.now() / 1000);
      if (second !== this.messageSecond) { this.messageSecond = second; this.messageCount = 0; }
      if (++this.messageCount > 100) { this.close('connection'); return; }
      this.session.receive(message);
      if (!this.host && this.session.state === 'connected' && !this.call && this.voice) {
        this.attachCall(this.peer.call(conn.peer, this.voice.stream));
      }
    });
    conn.on('close', () => this.close(this.hasStarted ? 'peer-left' : 'cancelled'));
    conn.on('error', () => this.close('connection'));
  }
  attachCall(call) {
    if (!call) return;
    this.call = call;
    call.on('stream', stream => { if (this.closed || this.call !== call) return; this.mediaConnected = true; this.remoteStream(stream); this.changed(); });
    call.on('close', () => { this.mediaConnected = false; this.voiceError = !this.closed; this.changed(); });
    call.on('error', () => { this.mediaConnected = false; this.voiceError = true; this.changed(); });
  }
  send(message) {
    if (!this.connection?.open || this.closed) return;
    if (message.type === 'snapshot' && this.connection.dataChannel?.bufferedAmount > 16384) return;
    try { this.connection.send(message); } catch { this.close('connection'); }
  }
  close(reason = 'left') {
    if (this.closed) return;
    this.send({ type: 'bye', reason: reason === 'cancelled' ? 'cancelled' : 'peer-left' }); this.closed = true; clearInterval(this.timer);
    this.session.end(reason);
    for (const [conn, timer] of this.rejections) { clearTimeout(timer); conn.close(); }
    this.rejections.clear();
    this.call?.close(); this.connection?.close(); this.voice?.close();
    // Keep a cancelled host address reserved while this tab lives, so late joiners
    // get an explicit rejection rather than joining a silently abandoned room.
    if (!this.host || !this.registered || this.disposed || reason === 'connection') this.peer.destroy();
    this.ended(reason); this.changed();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.close();
    for (const [conn, timer] of this.rejections) { clearTimeout(timer); conn.close(); }
    this.rejections.clear(); this.peer.destroy();
  }
}
