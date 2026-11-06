import { PeerRoom } from './PeerRoom.js';
import { VoiceLink } from './VoiceLink.js';
import { RemoteAircraft } from './RemoteAircraft.js';
import { inviteUrl, validRoom, DEFAULT_CONFIG, slotOffset } from './protocol.js';
import { t, bindText } from '../i18n/index.js';
import { setSimulationWind } from '../physics/WindField.js';

export class MultiplayerController {
  constructor(sim) {
    this.sim = sim; this.preparing = false; this.preparationHold = false;
    this.soloControls = new Map();
    this.audio = document.getElementById('mp-audio');
    this.roomInput = document.getElementById('mp-room');
    const invite = new URLSearchParams(location.search).get('room');
    if (invite) {
      this.roomInput.value = invite;
      document.getElementById('lobby-tab-multiplayer').click();
      if (!validRoom(invite)) this.message = 'invalid-room';
    }
    document.getElementById('mp-create').onclick = () => this.connect();
    document.getElementById('mp-join').onclick = () => {
      let room = this.roomInput.value.trim();
      try { if (room.startsWith('http')) room = new URL(room).searchParams.get('room'); } catch { /* Invalid below. */ }
      if (!validRoom(room)) { this.message = 'invalid-room'; this.refresh(); return; }
      this.connect(room);
    };
    document.getElementById('mp-start').onclick = () => this.room?.session.start();
    document.getElementById('mp-respawn').onclick = () => this.respawnLocal();
    document.getElementById('mp-leave').onclick = () => this.room?.close();
    document.getElementById('mp-copy').onclick = async () => {
      const input = document.getElementById('mp-invite'); input.select();
      try { await navigator.clipboard.writeText(input.value); this.message = 'copied'; }
      catch { this.message = 'copy-manually'; }
      this.refresh();
    };
    document.getElementById('mp-microphone').onclick = () => {
      if (this.voice?.microphone) this.voice.disableMicrophone();
      else this.voice?.enableMicrophone();
    };
    document.getElementById('mp-listen').onclick = () => this.playAudio();
    document.getElementById('mp-mute').onclick = () => { this.audio.muted = !this.audio.muted; this.refresh(); };
    const ptt = document.getElementById('mp-ptt');
    ptt.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); ptt.setPointerCapture(e.pointerId); this.voice?.setTalking(true); };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) ptt.addEventListener(event, () => this.releaseTalk());
    ptt.onkeydown = e => { if ([' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); this.voice?.setTalking(true); } };
    ptt.onkeyup = e => { if ([' ', 'Enter'].includes(e.key)) { e.preventDefault(); this.releaseTalk(); } };
    ptt.onblur = () => this.releaseTalk();
    // Capture N before flight controls, only outside text inputs, only while in a room.
    window.addEventListener('keydown', e => {
      if (this.active && e.code === 'KeyN' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.target.closest?.('input,textarea,select,[contenteditable=true]')) {
        e.preventDefault(); e.stopImmediatePropagation(); this.voice?.setTalking(true);
      }
    }, true);
    window.addEventListener('keyup', e => { if (e.code === 'KeyN') this.releaseTalk(); }, true);
    window.addEventListener('blur', () => this.releaseTalk());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseTalk(); });
    window.addEventListener('pagehide', () => this.room?.close());
    this.refresh();
  }
  get active() { return Boolean(this.room && !this.room.closed); }
  get locked() { return this.active && !this.preparing; }
  releaseTalk() { this.voice?.setTalking(false); }
  connect(room) {
    if (this.active || this.preparing || this.sim.startingFlight || this.sim.airportLoading) return;
    this.message = null;
    const config = Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key => [key, document.getElementById(`mp-${key}`).value]));
    try {
      this.voice = new VoiceLink({ changed: () => this.refresh() });
      // Unlock the voice context inside Create/Join's user gesture, even for listeners.
      this.voice.context.resume().catch(() => {});
      this.room = new PeerRoom({ room, name: document.getElementById('mp-name').value, config, voice: this.voice,
        prepare: (c, slot) => this.prepare(c, slot), fly: () => this.startTogether(),
        changed: () => this.refresh(), remoteStream: stream => { this.audio.srcObject = stream; this.playAudio(); },
        ended: reason => this.ended(reason) });
      this.snapshotTimer = setInterval(() => this.sendSnapshot(), 1000 / 15);
    } catch { this.voice?.close(); this.message = 'connection'; }
    this.refresh();
  }
  startTogether() {
    this.preparationHold = false;
    this.sim.gameFlow.enterFlight(); this.sim.syncFlowUi();
  }
  releasePreparationHold() {
    const owned = this.preparationHold;
    this.preparationHold = false;
    if (owned && this.sim.gameFlow.state === 'paused') this.sim.gameFlow.resume();
  }
  async prepare(config, slot) {
    const room = this.room;
    this.preparing = true; this.preparationHold = true; this.slot = slot; this.releaseTalk();
    this.remote?.dispose(); this.remote = null;
    try {
      this.sim.pilotArena?.stop('multiplayer'); this.sim.demoDirector.stop();
      this.sim.gameFlow.returnToLobby(true); this.sim.gameFlow.holdForPendingStart();
      Object.assign(this.sim.lobby, { airport: config.airport, aircraft: config.aircraft, preset: config.scenario, pilotMode: 'human' });
      await this.sim.fly();
      if (!this.active || this.room !== room) {
        this.releasePreparationHold();
        return;
      }
      if (this.sim.activeAirport !== config.airport || this.sim.currentAircraftId !== config.aircraft || this.sim.lastPresetType !== config.scenario) throw new Error('prepare-failed');
      this.sim.setTimeOfDay(12, { persist: false, userChoice: false });
      setSimulationWind(this.sim);
      this.sim.aero.windWorld.set(0, 0, 0);
      this.sim.gameFlow.pause();
      this.remote = new RemoteAircraft(this.sim.scene, config.aircraft);
    } finally { this.preparing = false; this.refresh(); }
  }
  /** Called exactly once at the end of each preset reset, including crash recovery. */
  respawn() {
    if (!this.active || !['starting', 'flying'].includes(this.room.session.state)) return;
    const sim = this.sim;
    sim.position.add(slotOffset(this.room.session.config.scenario, this.slot, sim.quaternion));
    sim.renderPose.reset(sim.position, sim.quaternion);
    sim.aircraft.group.position.copy(sim.position); sim.aircraft.group.quaternion.copy(sim.quaternion);
    sim.aircraft.group.updateMatrixWorld(true); sim.cameraSystem.snapToTarget(sim.aircraft.group);
    this.room.session.epoch++;
  }
  respawnLocal() {
    if (!this.active || this.room.session.state !== 'flying') return;
    this.releaseTalk();
    this.sim.setPreset(this.room.session.config.scenario);
    this.sim.gameFlow.enterFlight();
    this.sim.beginFlightRecording();
  }
  sendSnapshot() {
    if (!this.active) return;
    const sim = this.sim;
    this.room.session.snapshot({ p: sim.position.toArray(), q: sim.quaternion.toArray(), v: sim.linearVelocity.toArray(),
      crashed: sim.isCrashed, held: sim.browserBackgrounded === true || sim.gameFlow.isPhysicsFrozen(),
      gear: sim.gear.gearState, flaps: sim.aero.currentFlapAngle, talking: this.voice?.talking === true });
  }
  update() {
    if (!this.remote || !this.active) return;
    const s = this.room.session;
    const sample = s.track.sample(performance.now());
    this.remote.update(sample, `${s.remoteName}${sample?.talking ? " ●" : ""}${sample?.held ? ` · ${t('mp.held')}` : ''}${sample?.stale ? ` · ${t('mp.stale')}` : ''}`, this.sim.camera);
  }
  async playAudio() {
    try {
      // A suspended AudioContext resume can remain pending until another gesture.
      // Do not let it prevent the audio element from reporting autoplay rejection.
      this.voice?.context.resume().catch(() => {});
      await this.audio.play(); this.playbackBlocked = false;
    }
    catch { this.playbackBlocked = true; }
    this.refresh();
  }
  ended(reason) {
    clearInterval(this.snapshotTimer); this.remote?.dispose(); this.remote = null;
    this.audio.pause(); this.audio.srcObject = null; this.audio.muted = false;
    this.message = reason; this.releaseTalk();
    this.sim.showToast(() => t(`mp.status.${reason}`));
    this.sim.lobbyScreen?.setSelectionBusy(false);
    this.sim.lobbyScreen?.refresh();
    // A failed prepare must not leave the local simulator stuck at the barrier.
    this.releasePreparationHold();
    this.refresh();
  }
  refresh() {
    const active = this.active, room = this.room, s = room?.session;
    document.getElementById('mp-controls').hidden = !active;
    document.getElementById('mp-connect').disabled = active;
    document.getElementById('mp-create').disabled = active;
    document.getElementById('mp-join').disabled = active;
    document.getElementById('mp-invite-row').hidden = !active || !room.host || !room.registered;
    if (active && room.host) document.getElementById('mp-invite').value = inviteUrl(room.room, location.href);
    document.getElementById('mp-respawn').disabled = s?.state !== 'flying';
    const start = document.getElementById('mp-start');
    start.hidden = !active || !room.host;
    start.disabled = !['connected', 'flying'].includes(s?.state);
    bindText(start, () => t(s?.state === 'flying' ? 'mp.restart' : 'mp.start'));
    bindText(document.getElementById('mp-status'), () => {
      if (this.message) return t(`mp.status.${this.message}`);
      if (!active) return t('mp.idle');
      return `${t(`mp.state.${s.state}`)}${s.remoteName ? ` · ${s.remoteName} · 2/2` : ' · 1/2'}`;
    });
    bindText(document.getElementById('mp-roster'), () => active ? `${s.name} + ${s.remoteName || t('mp.waiting')} · ${s.config ? `${t(`mp.${s.config.airport}`)} / ${s.config.aircraft} / ${t(`mp.${s.config.scenario}`)}` : ''}` : '');
    const microphone = document.getElementById('mp-microphone');
    microphone.disabled = !active || this.voice?.requesting;
    bindText(microphone, () => t(this.voice?.microphone ? 'mp.disableMic' : 'mp.enableMic'));
    microphone.setAttribute('aria-pressed', String(Boolean(this.voice?.microphone)));
    const ptt = document.getElementById('mp-ptt');
    ptt.disabled = !active || !this.voice?.microphone;
    ptt.setAttribute('aria-pressed', String(Boolean(this.voice?.talking)));
    bindText(document.getElementById('mp-voice-status'), () => t(this.voice?.error ? 'mp.status.microphone' : room?.voiceError ? 'mp.voiceFailed' : this.voice?.talking ? 'mp.transmitting' : room?.mediaConnected ? 'mp.voiceReady' : 'mp.listenOnly'));
    document.getElementById('mp-listen').hidden = !this.playbackBlocked;
    document.getElementById('mp-mute').setAttribute('aria-pressed', String(this.audio.muted));
    // Room configuration is immutable until leaving; regular solo selections cannot diverge it.
    if (active) {
      for (const el of document.querySelectorAll('#lobby-panel-scenario button, #lobby-panel-scenario select, #btn-fly')) {
        if (!this.soloControls.has(el)) this.soloControls.set(el, el.disabled);
        el.disabled = true;
      }
    } else if (this.soloControls.size) {
      for (const [el, disabled] of this.soloControls) el.disabled = disabled;
      this.soloControls.clear();
      // Recompute aircraft/time availability for any scenery changed during preparation.
      this.sim.lobbyScreen?.refresh();
    }
  }
}
