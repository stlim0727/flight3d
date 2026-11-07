import { PeerRoom } from './PeerRoom.js';
import { VoiceLink } from './VoiceLink.js';
import { MultiplayerDialog } from './MultiplayerDialog.js';
import { RemoteAircraft } from './RemoteAircraft.js';
import { inviteUrl, parseRoom, DEFAULT_CONFIG, slotOffset } from './protocol.js';
import { t, bindText } from '../i18n/index.js';
import { setSimulationWind } from '../physics/WindField.js';
import { bindMultiplayerPreferences } from './preferences.js';

export class MultiplayerController {
  constructor(sim) {
    this.sim = sim; this.preparing = false; this.preparationHold = false;
    this.soloControls = new Map();
    this.dialog = document.getElementById('mp-dialog');
    this.modal = new MultiplayerDialog(sim, this.dialog, () => this.dismissDialog());
    document.getElementById('mp-open').onclick = () => this.openDialog();
    document.getElementById('mp-room-menu').onclick = () => this.openDialog();
    document.getElementById('mp-dialog-close').onclick = () => this.dismissDialog();
    document.getElementById('mp-keep-waiting').onclick = () => this.room?.keepWaiting();
    this.audio = document.getElementById('mp-audio');
    this.roomInput = document.getElementById('mp-room');
    this.preferences = bindMultiplayerPreferences();
    document.getElementById('mp-choose-host').onclick = () => this.chooseSetup('host');
    document.getElementById('mp-choose-join').onclick = () => this.chooseSetup('join');
    document.getElementById('mp-create').onclick = () => this.connect();
    document.getElementById('mp-join').onclick = () => {
      const room = parseRoom(this.roomInput.value);
      if (!room) { this.message = 'invalid-room'; this.refresh(); return; }
      this.connect(room);
    };
    document.getElementById('mp-start').onclick = () => this.room?.session.start();
    document.getElementById('mp-respawn').onclick = () => this.respawnLocal();
    document.getElementById('mp-leave').onclick = () => this.room?.close();
    document.getElementById('mp-copy-code').onclick = () => this.copyInvite('code');
    document.getElementById('mp-copy').onclick = () => this.copyInvite('link');
    document.getElementById('mp-microphone').onclick = () => {
      if (this.voice?.microphone) this.voice.setMuted(!this.voice.muted);
      else this.voice?.enableMicrophone();
    };
    document.getElementById('mp-listen').onclick = () => this.playAudio();
    document.getElementById('mp-mute').onclick = () => { this.audio.muted = !this.audio.muted; this.refresh(); };
    window.addEventListener('pagehide', () => this.room?.dispose());
    this.refresh();
    const params = new URLSearchParams(location.search);
    this.joinInvite(params.get('r') ?? params.get('room'));
  }
  joinInvite(invite) {
    if (invite === null) return;
    this.chooseSetup('join');
    this.roomInput.value = invite;
    this.openDialog();
    const room = parseRoom(invite);
    if (room) this.connect(room);
    else { this.message = 'invalid-room'; this.refresh(); }
  }
  chooseSetup(mode) {
    for (const path of ['host', 'join']) {
      document.getElementById(`mp-${path}-panel`).hidden = path !== mode;
      document.getElementById(`mp-choose-${path}`).setAttribute('aria-pressed', String(path === mode));
    }
  }
  get modalOpen() { return this.dialog.open; }
  openDialog() { this.modal.open(); this.refresh(); }
  dismissDialog() {
    if (this.active && this.room.session.state !== 'flying') this.room.close('cancelled');
    this.modal.close();
  }
  async copyInvite(kind) {
    if (!this.active) return;
    const room = this.room;
    const input = document.getElementById(kind === 'code' ? 'mp-code' : 'mp-invite');
    let copied = false;
    try { await navigator.clipboard.writeText(kind === 'code' ? room.room : input.value); copied = true; }
    catch { /* Offer manual selection below if this room is still live. */ }
    // Permission prompts can outlive the waiting deadline or a replacement room.
    if (room !== this.room || room.closed) return;
    if (!copied) {
      if (kind === 'link') document.getElementById('mp-link-details').open = true;
      input.select();
    }
    this.message = copied ? 'copied' : 'copy-manually'; this.refresh();
  }
  get active() { return Boolean(this.room && !this.room.closed); }
  get locked() { return this.active && !this.preparing; }
  connect(room) {
    if (this.active || this.preparing || this.sim.startingFlight || this.sim.airportLoading) return;
    this.preferences.save();
    this.message = null;
    this.room?.dispose();
    const config = Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key => [key, document.getElementById(`mp-${key}`).value]));
    try {
      this.voice = new VoiceLink({ changed: () => this.refresh() });
      // Invite URLs join without a gesture; blocked audio can be enabled in the modal.
      this.voice.context.resume().catch(() => {});
      this.room = new PeerRoom({ room, name: document.getElementById('mp-name').value, config, voice: this.voice,
        prepare: (c, slot) => this.prepare(c, slot), fly: () => this.startTogether(),
        changed: () => this.refresh(), remoteStream: stream => { this.audio.srcObject = stream; this.playAudio(); },
        ended: reason => this.ended(reason) });
      this.voice.enableMicrophone();
      this.snapshotTimer = setInterval(() => this.sendSnapshot(), 1000 / 15);
    } catch { this.voice?.close(); this.message = 'connection'; }
    this.refresh();
  }
  startTogether() {
    this.preparationHold = false;
    this.modal.close({ resume: false });
    this.sim.gameFlow.enterFlight(); this.sim.syncFlowUi();
  }
  releasePreparationHold() {
    const owned = this.preparationHold;
    this.preparationHold = false;
    if (owned && this.sim.gameFlow.state === 'paused') this.sim.gameFlow.resume();
  }
  async prepare(config, slot) {
    const room = this.room;
    this.openDialog();
    this.preparing = true; this.preparationHold = true; this.slot = slot;
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
    this.sim.setPreset(this.room.session.config.scenario);
    this.modal.close({ resume: false });
    this.sim.gameFlow.enterFlight();
    this.sim.beginFlightRecording();
  }
  sendSnapshot() {
    if (!this.active || this.room.session.state !== 'flying') return;
    const sim = this.sim;
    this.room.session.snapshot({ p: sim.position.toArray(), q: sim.quaternion.toArray(), v: sim.linearVelocity.toArray(),
      crashed: sim.isCrashed, held: this.modalOpen || sim.browserBackgrounded === true || sim.gameFlow.isPhysicsFrozen(),
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
    this.message = reason;
    this.sim.showToast(() => t(`mp.status.${reason}`));
    this.sim.lobbyScreen?.setSelectionBusy(false);
    this.sim.lobbyScreen?.refresh();
    // A failed prepare must not leave the local simulator stuck at the barrier.
    this.releasePreparationHold();
    this.modal.hold();
    // An early local resume may already be in flight while input still belongs to the barrier.
    this.sim.syncFlowUi();
    this.refresh();
  }
  refresh() {
    const active = this.active, room = this.room, s = room?.session;
    document.getElementById('mp-controls').hidden = !active;
    document.getElementById('mp-intro').hidden = active;
    bindText(document.getElementById('mp-dialog-help'), () => t(!active ? 'mp.setupHelp' : s.state === 'starting' ? 'mp.state.starting' : s.state !== 'flying' ? (room.host ? (s.state === 'connected' ? 'mp.hostReadyHelp' : 'mp.hostWaitingHelp') : 'mp.guestWaitingHelp') : 'mp.dialogHelp'));
    document.getElementById('mp-connect').disabled = active;
    document.getElementById('mp-connect').hidden = active;
    document.getElementById('mp-room-menu').hidden = !active;
    bindText(document.getElementById('mp-dialog-close'), () => t(active && s.state !== 'flying' ? 'mp.cancelAndClose' : 'mp.closeDialog'));
    const waiting = active && room.waiting;
    document.getElementById('mp-waiting').hidden = !waiting;
    document.getElementById('mp-keep-waiting').disabled = !waiting;
    bindText(document.getElementById('mp-waiting-status'), () => waiting ? t('mp.keepWaitingCountdown', { seconds: room.waitingSeconds }) : '');
    document.getElementById('mp-create').disabled = active;
    document.getElementById('mp-join').disabled = active;
    document.getElementById('mp-invite-row').hidden = !active || !room.host || !room.registered;
    if (active && room.host) {
      document.getElementById('mp-invite').value = inviteUrl(room.room, location.href);
      document.getElementById('mp-code').value = `${room.room.slice(0, 3)} ${room.room.slice(3)}`;
    }
    document.getElementById('mp-respawn').disabled = s?.state !== 'flying';
    const start = document.getElementById('mp-start');
    start.hidden = !active || !room.host;
    start.disabled = !['connected', 'flying'].includes(s?.state);
    // Highlight the first start once a friend joins; move focus to it only on that transition.
    const ready = active && room.host && s.state === 'connected';
    start.setAttribute('data-ready', String(ready));
    if (ready && !this.startReady && this.dialog?.open) start.focus?.();
    this.startReady = ready;
    bindText(start, () => t(s?.state === 'flying' ? 'mp.restart' : 'mp.start'));
    bindText(document.getElementById('mp-status'), () => {
      if (this.message) return t(`mp.status.${this.message}`);
      if (!active) return t('mp.idle');
      return `${t(`mp.state.${s.state}`)}${s.remoteName ? ` · ${s.remoteName} · 2/2` : ' · 1/2'}`;
    });
    bindText(document.getElementById('mp-roster'), () => active ? `${s.name} + ${s.remoteName || t('mp.waiting')} · ${s.config ? `${t(`mp.${s.config.airport}`)} / ${s.config.aircraft} / ${t(`mp.${s.config.scenario}`)}` : ''}` : '');
    const microphone = document.getElementById('mp-microphone');
    microphone.disabled = !active || this.voice?.requesting;
    bindText(microphone, () => t(this.voice?.microphone ? (this.voice.muted ? 'mp.unmuteMic' : 'mp.muteMic') : 'mp.enableMic'));
    microphone.setAttribute('aria-pressed', String(Boolean(this.voice?.muted)));
    bindText(document.getElementById('mp-voice-status'), () => t(this.voice?.error ? 'mp.status.microphone' : room?.voiceError ? 'mp.voiceFailed' : this.voice?.muted ? 'mp.micMuted' : this.voice?.talking ? 'mp.transmitting' : room?.mediaConnected ? 'mp.voiceReady' : 'mp.listenOnly'));
    document.getElementById('mp-listen').hidden = !this.playbackBlocked;
    document.getElementById('mp-mute').setAttribute('aria-pressed', String(this.audio.muted));
    // Room configuration stays immutable even when the flight menu is reopened.
    if (active) {
      for (const el of document.querySelectorAll('#lobby-panel-scenario button, #lobby-panel-scenario select, #btn-fly')) {
        if (!this.soloControls.has(el)) this.soloControls.set(el, el.disabled);
        el.disabled = true;
      }
    } else if (this.soloControls.size) {
      for (const [el, disabled] of this.soloControls) el.disabled = disabled;
      this.soloControls.clear();
      this.sim.lobbyScreen?.refresh();
    }
  }
}
