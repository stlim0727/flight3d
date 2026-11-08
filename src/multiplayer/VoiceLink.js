/** A stable silent outgoing track permits two-way calls even for listen-only pilots. */
export class VoiceLink {
  constructor({ context, capture = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }), changed = () => {} } = {}) {
    this.context = context ?? new AudioContext();
    this.capture = capture; this.changed = changed; this.closed = false; this.talking = false; this.muted = false;
    this.output = this.context.createMediaStreamDestination();
    this.gain = this.context.createGain(); this.gain.gain.value = 0;
    this.gain.connect(this.output);
    // Keep audio frames flowing when no microphone exists; no audible local output.
    this.silence = this.context.createConstantSource(); this.silence.offset.value = 0;
    this.silence.connect(this.gain); this.silence.start();
    this.stream = this.output.stream;
    this.stream.getAudioTracks()[0].enabled = false;
    this.context.addEventListener?.('statechange', () => this.syncTransmission());
  }
  async enableMicrophone() {
    if (this.closed || this.microphone || this.requesting) return;
    this.requesting = true; this.error = null; this.changed();
    try {
      // An invite can open without a user gesture. Never let suspended playback
      // prevent the browser's microphone permission request from being shown.
      this.context.resume().catch(() => {});
      const stream = await this.capture();
      if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
      this.microphone = stream;
      this.source = this.context.createMediaStreamSource(stream); this.source.connect(this.gain);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        this.disableMicrophone(); this.error = 'microphone'; this.changed();
      }));
      this.context.resume().then(() => this.syncTransmission(), () => {});
      this.syncTransmission();
    } catch { this.error = 'microphone'; }
    finally { this.requesting = false; this.changed(); }
  }
  attachRemoteStream(stream) {
    this.remoteSource?.disconnect();
    this.remoteSource = null;
    if (this.closed || !stream || typeof this.context.createMediaStreamSource !== 'function') return;
    try {
      if (!this.remoteGain) {
        this.remoteGain = this.context.createGain();
        this.remoteGain.gain.value = 0;
        if (this.context.destination) this.remoteGain.connect(this.context.destination);
      }
      this.remoteSource = this.context.createMediaStreamSource(stream);
      this.remoteSource.connect(this.remoteGain);
    } catch {}
  }
  setRemoteOutput(enabled) {
    if (this.remoteGain) {
      this.remoteGain.gain.value = enabled && !this.closed ? 1 : 0;
    }
  }
  setMuted(muted) {
    this.muted = Boolean(muted); this.syncTransmission();
  }
  syncTransmission() {
    this.talking = Boolean(!this.muted && this.microphone && !this.closed && this.context.state === 'running');
    this.gain.gain.value = this.talking ? 1 : 0;
    this.stream.getAudioTracks().forEach(t => { t.enabled = this.talking; });
    this.changed();
  }
  disableMicrophone() {
    this.source?.disconnect(); this.source = null;
    const stream = this.microphone; this.microphone = null;
    this.syncTransmission();
    stream?.getTracks().forEach(t => t.stop()); this.changed();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.disableMicrophone(); this.silence.stop(); this.silence.disconnect();
    this.remoteSource?.disconnect(); this.remoteSource = null;
    this.remoteGain?.disconnect(); this.remoteGain = null;
    this.gain.disconnect(); this.stream.getTracks().forEach(t => t.stop());
    this.context.close().catch(() => {});
  }
}
