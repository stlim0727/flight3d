/**
 * GpwsCalloutSystem — Boeing GPWS / RADALT automated altitude callouts
 * and voice synthesis management.
 */
export class GpwsCalloutSystem {
  constructor(host) {
    this.host = host;
    this.lastRadioAlt = 9999;
    this.calledAltitudes = new Set();
    this.synthVoice = undefined;
  }

  reset() {
    this.lastRadioAlt = 9999;
    this.calledAltitudes.clear();
    this.cancelSpeech();
  }

  cancelSpeech() {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel?.();
  }

  pickSynthVoice(synthesis) {
    let voices = [];
    try { voices = synthesis.getVoices() ?? []; } catch (e) { return null; }
    if (!voices.length) return null;
    const score = (v) => {
      const lang = (v.lang || '').toLowerCase().replace('_', '-');
      if (!lang.startsWith('en')) return -1;
      const google = (v.name || '').toLowerCase().includes('google');
      return ((lang === 'en-us' || lang === 'en-gb') ? 4 : 2) + (google && v.localService === false ? 2 : 0);
    };
    let best = null, bestScore = -1;
    for (const v of voices) {
      const s = score(v);
      if (s > bestScore) { best = v; bestScore = s; }
    }
    return bestScore >= 0 ? best : null;
  }

  playGpwsCallout(text) {
    if (this.host.isMuted || this.host.effectiveVolume === 0 || this.host.isPiston || this.host.crashed) return;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const s = window.speechSynthesis;
        if (this.synthVoice === undefined) this.synthVoice = this.pickSynthVoice(s);
        if (!this.synthVoice && s.onvoiceschanged === null) s.onvoiceschanged = () => { this.synthVoice = undefined; };
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        if (this.synthVoice) u.voice = this.synthVoice;
        u.rate = 0.95;
        u.pitch = 0.5;
        u.volume = this.host.effectiveVolume;
        s.speak(u);
      } catch (e) {}
    }
  }

  update(state, alert) {
    const rAlt = state.radioAltFt;
    if (this.host.aircraftId === 'B738' && !alert && rAlt !== undefined && !state.onGround && state.vsiFpm < -100) {
      const callouts = [
        ['Five hundred, five hundred', 500], ['One hundred, one hundred', 100],
        ['Fifty', 50], ['Forty', 40], ['Thirty', 30], ['Twenty', 20], ['Ten', 10],
      ];
      for (const [text, call] of callouts) {
        if (this.lastRadioAlt > call && rAlt <= call && !this.calledAltitudes.has(call)) {
          this.calledAltitudes.add(call);
          this.host.playGpwsCallout(text);
          break;
        }
      }
    }
    if (rAlt > 1000) this.calledAltitudes.clear();
    this.lastRadioAlt = rAlt;
  }
}
