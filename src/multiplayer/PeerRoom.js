import { Peer } from 'peerjs';
import { RoomSession } from './RoomSession.js';
import { newRoom, validRoom, VERSION } from './protocol.js';

/** Production configuration comes from the build, never an invite link. */
export function peerOptions(env = import.meta.env) {
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
  constructor({ room, name, config, voice, options = peerOptions(), prepare, fly, changed = () => {}, remoteStream = () => {}, ended = () => {} }) {
    if (room && !validRoom(room)) throw new Error('invalid-room');
    this.host = !room; this.room = room || newRoom(); this.closed = false;
    Object.assign(this, { voice, changed, remoteStream, ended });
    this.session = new RoomSession({ host: this.host, name, config, prepare, fly,
      send: m => this.send(m), changed, ended: reason => this.close(reason) });
    this.peer = new Peer(this.host ? this.room : undefined, options);
    this.peer.on('open', () => {
      if (this.closed) return;
      this.registered = true; this.changed();
      if (!this.host) this.attach(this.peer.connect(this.room, { reliable: true, serialization: 'json', metadata: { version: VERSION } }));
    });
    this.peer.on('connection', conn => {
      if (!this.host || this.connection || this.closed) {
        conn.on('open', () => {
          conn.send({ type: 'reject', reason: 'full' });
          // Give the rejection a chance to leave the reliable channel before closing it.
          const timer = setTimeout(() => { conn.close(); this.rejections.delete(conn); }, 250);
          this.rejections.set(conn, timer);
        });
        conn.on('error', () => conn.close()); return;
      }
      this.attach(conn);
    });
    this.peer.on('call', call => {
      if (this.closed || !this.connection?.open || call.peer !== this.connection.peer || this.call || !this.voice) { call.close(); return; }
      this.attachCall(call); call.answer(this.voice.stream);
    });
    this.peer.on('error', error => this.close(error.type === 'peer-unavailable' ? 'not-found' : 'connection'));
    this.peer.on('disconnected', () => this.close('connection'));
    this.rejections = new Map();
    this.timer = setInterval(() => {
      // A host can wait indefinitely for its first friend, but not a half-open join.
      if (this.host && this.registered && !this.connection) this.session.createdAt = performance.now();
      this.session.tick();
    }, 1000);
  }
  attach(conn) {
    this.connection = conn;
    conn.on('open', () => {
      if (this.closed) { conn.close(); return; }
      this.session.opened(); this.changed();
    });
    conn.on('data', message => {
      if (typeof message !== 'object' || message === null || JSON.stringify(message).length > 4096) return;
      // Bound work from a peer independently of rendering and room heartbeat.
      const second = Math.floor(performance.now() / 1000);
      if (second !== this.messageSecond) { this.messageSecond = second; this.messageCount = 0; }
      if (++this.messageCount > 100) { this.close('connection'); return; }
      this.session.receive(message);
      if (!this.host && this.session.state === 'connected' && !this.call && this.voice) {
        this.attachCall(this.peer.call(conn.peer, this.voice.stream));
      }
    });
    conn.on('close', () => this.close('peer-left'));
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
    this.send({ type: 'bye' }); this.closed = true; clearInterval(this.timer);
    this.session.end(reason);
    for (const [conn, timer] of this.rejections) { clearTimeout(timer); conn.close(); }
    this.rejections.clear();
    this.call?.close(); this.connection?.close(); this.peer.destroy(); this.voice?.close();
    this.ended(reason); this.changed();
  }
}
