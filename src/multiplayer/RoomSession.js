import { SESSION_CONTRACT, compatibilityFailure } from './compatibility.js';
import { VERSION, validConfig, cleanName, RemoteTrack } from './protocol.js';

/** Pure two-pilot protocol. Transport and simulation are injected, never DOM/WebRTC. */
export class RoomSession {
  constructor({ host, name, config, contract = SESSION_CONTRACT, send, prepare = async () => {}, canStart = () => true, fly = () => {}, changed = () => {}, ended = () => {}, now = () => performance.now() }) {
    if (!Number.isSafeInteger(contract?.flight) || contract.flight < 1) throw new Error('invalid-contract');
    this.contract = Object.freeze({ flight: contract.flight });
    if (host && !validConfig(config)) throw new Error('invalid-config');
    Object.assign(this, { host, name: cleanName(name), config, send, prepare, canStart, fly, changed, ended, now });
    this.state = 'connecting'; this.round = 0; this.track = new RemoteTrack();
    this.lastSeen = now(); this.createdAt = now(); this.seq = 0; this.epoch = 0;
  }
  opened() {
    if (!this.host) this.send({ type: 'hello', version: VERSION, contract: this.contract, name: this.name });
  }
  receive(m) {
    if (this.state === 'ended' || !m || typeof m !== 'object') return;
    if (m.type === 'reject') { this.end(['full', 'cancelled'].includes(m.reason) ? m.reason : 'incompatible'); return; }
    if (m.type === 'bye') { this.end(m.reason === 'cancelled' ? 'cancelled' : 'peer-left'); return; }
    if (m.type === 'ping') { this.lastSeen = this.now(); return; }
    if (m.type === 'hello' && this.host && this.state === 'connecting') {
      if (!this.acceptContract(m)) return;
      if (typeof m.name !== 'string' || m.name.length > 64) { this.rejectIncompatible('malformed-handshake'); return; }
      this.remoteName = cleanName(m.name); this.state = 'connected';
      this.send({ type: 'welcome', version: VERSION, contract: this.contract, name: this.name, config: this.config });
      this.lastSeen = this.now(); this.changed(); return;
    }
    if (m.type === 'welcome' && !this.host && this.state === 'connecting') {
      if (!this.acceptContract(m)) return;
      if (!validConfig(m.config) || typeof m.name !== 'string' || m.name.length > 64) { this.rejectIncompatible('malformed-handshake'); return; }
      this.config = { airport: m.config.airport, aircraft: m.config.aircraft, scenario: m.config.scenario };
      this.remoteName = cleanName(m.name); this.state = 'connected'; this.lastSeen = this.now(); this.changed(); return;
    }
    if (m.type === 'prepare' && !this.host && ['connected', 'flying'].includes(this.state) && Number.isSafeInteger(m.round) && m.round === this.round + 1) {
      this.beginRound(m.round); return;
    }
    if (m.type === 'ready' && this.host && this.state === 'starting' && m.round === this.round) {
      this.remoteReady = true; this.release(); return;
    }
    if (m.type === 'go' && !this.host && this.state === 'starting' && this.localReady && m.round === this.round) {
      this.state = 'flying'; this.lastSeen = this.now(); this.fly(); this.changed(); return;
    }
    if (m.type === 'snapshot' && this.state === 'flying' && m.round === this.round && this.track.push(m, this.now())) {
      this.lastSeen = this.now();
    }
  }
  acceptContract(message) {
    const failure = compatibilityFailure(message, this.contract);
    if (!failure) return true;
    this.rejectIncompatible(failure);
    return false;
  }
  rejectIncompatible(failure) {
    this.compatibilityFailure = failure;
    this.send({ type: 'reject', reason: 'incompatible' });
    this.end('incompatible');
  }
  start() {
    if (!this.host || !['connected', 'flying'].includes(this.state) || !this.canStart()) return false;
    this.send({ type: 'prepare', round: this.round + 1 });
    this.beginRound(this.round + 1); return true;
  }
  async beginRound(round) {
    this.round = round; this.state = 'starting'; this.roundAt = this.now();
    this.localReady = this.remoteReady = false; this.track.clear(); this.epoch = 0;
    this.changed();
    try {
      await this.prepare(this.config, this.host ? 0 : 1);
      if (this.state !== 'starting' || this.round !== round) return;
      this.localReady = true;
      if (this.host) this.release(); else this.send({ type: 'ready', round });
    } catch { this.end('prepare-failed'); }
  }
  release() {
    if (this.state !== 'starting' || !this.localReady || !this.remoteReady) return;
    this.send({ type: 'go', round: this.round });
    this.state = 'flying'; this.lastSeen = this.now(); this.fly(); this.changed();
  }
  snapshot(pose) {
    if (this.state !== 'flying') return;
    this.send({ ...pose, type: 'snapshot', seq: this.seq++, epoch: this.epoch, round: this.round });
  }
  tick() {
    if (this.state === 'ended') return;
    const now = this.now();
    if ((this.state === 'connecting' && now - this.createdAt > 20000)
      || (this.state === 'starting' && now - this.roundAt > 45000)
      || (['connected', 'flying'].includes(this.state) && now - this.lastSeen > 20000)) this.end('timeout');
    else this.send({ type: 'ping' });
  }
  end(reason = 'left') {
    if (this.state === 'ended') return;
    this.state = 'ended'; this.track.clear(); this.ended(reason); this.changed();
  }
}
