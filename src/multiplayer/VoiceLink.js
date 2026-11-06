/** A stable silent outgoing track permits two-way calls even for listen-only pilots. */
export class VoiceLink {
  constructor({ context, capture = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }), changed = () => {} } = {}) {
    this.context = context ?? new AudioContext();
    this.capture = capture; this.changed = changed; this.closed = false; this.talking = false;
    this.output = this.context.createMediaStreamDestination();
    this.gain = this.context.createGain(); this.gain.gain.value = 0;
    this.gain.connect(this.output);
    // Keep audio frames flowing when no microphone exists; no audible local output.
    this.silence = this.context.createConstantSource(); this.silence.offset.value = 0;
    this.silence.connect(this.gain); this.silence.start();
    this.stream = this.output.stream;
    this.stream.getAudioTracks()[0].enabled = false;
  }
  async enableMicrophone() {
    if (this.closed || this.microphone || this.requesting) return;
    this.requesting = true; this.error = null; this.changed();
    try {
      await this.context.resume();
      const stream = await this.capture();
      if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
      this.microphone = stream;
      this.source = this.context.createMediaStreamSource(stream); this.source.connect(this.gain);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        this.setTalking(false); this.disableMicrophone(); this.error = 'microphone'; this.changed();
      }));
    } catch { this.error = 'microphone'; }
    finally { this.requesting = false; this.changed(); }
  }
  setTalking(pressed) {
    this.talking = Boolean(pressed && this.microphone && !this.closed && this.context.state === 'running');
    this.gain.gain.value = this.talking ? 1 : 0;
    this.stream.getAudioTracks().forEach(t => { t.enabled = this.talking; });
    this.changed();
  }
  disableMicrophone() {
    this.setTalking(false); this.source?.disconnect(); this.source = null;
    const stream = this.microphone; this.microphone = null;
    stream?.getTracks().forEach(t => t.stop()); this.changed();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.disableMicrophone(); this.silence.stop(); this.silence.disconnect();
    this.gain.disconnect(); this.stream.getTracks().forEach(t => t.stop());
    this.context.close().catch(() => {});
  }
}
