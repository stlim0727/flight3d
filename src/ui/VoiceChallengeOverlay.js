import { VoiceRecognitionService } from '../audio/VoiceRecognitionService.js';
import { evaluatePronunciation } from '../audio/PronunciationEvaluator.js';
import { t } from '../i18n/index.js';

/**
 * UI Overlay for presenting ATC dialogue options (A or B) and showing real-time
 * recognized speech subtitles before engaging manual control.
 */
export class VoiceChallengeOverlay {
  constructor({
    sim,
    container = (typeof document !== 'undefined' ? document.getElementById('voice-challenge-overlay') : null),
    voiceService = new VoiceRecognitionService(),
    threshold = 0.78
  } = {}) {
    this.sim = sim;
    this.container = container;
    this.voiceService = voiceService;
    this.threshold = threshold;
    this.active = false;
    this.options = [];
    this.onPassCallback = null;
    this.onCancelCallback = null;
    this.recognizedTextEl = null;
    this.scoreEl = null;
    this.bannerEl = null;
    this.micStatusEl = null;
    this.optAEl = null;
    this.optBEl = null;
    this.skipBtn = null;
    this.retryBtn = null;
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.initElements();
  }

  initElements() {
    if (!this.container) return;
    this.recognizedTextEl = this.container.querySelector('#voice-recognized-text');
    this.scoreEl = this.container.querySelector('#voice-match-score');
    this.bannerEl = this.container.querySelector('.voice-recognized-banner');
    this.micStatusEl = this.container.querySelector('.voice-mic-status');
    this.optAEl = this.container.querySelector('#voice-opt-a');
    this.optBEl = this.container.querySelector('#voice-opt-b');
    this.skipBtn = this.container.querySelector('#btn-voice-skip');
    this.retryBtn = this.container.querySelector('#btn-voice-retry');

    this.skipBtn?.addEventListener('click', () => this.pass(this.options[0], 1, 'skipped'));
    this.retryBtn?.addEventListener('click', () => this.startListening());

    // Clicking option cards provides immediate interactive / accessibility selection
    this.optAEl?.addEventListener('click', () => {
      if (this.active && this.options[0]) this.pass(this.options[0], 1, 'clicked');
    });
    this.optBEl?.addEventListener('click', () => {
      if (this.active && this.options[1]) this.pass(this.options[1], 1, 'clicked');
    });
  }

  /**
   * Present dialogue options A and B and start listening for microphone speech.
   * @param {Object} params
   * @param {Array<{id: string, tag: string, primary: string, secondary: string, phrases: string[]}>} params.options
   * @param {Function} params.onPass Called when speech is verified or skipped
   * @param {Function} [params.onCancel] Called if challenge is aborted
   */
  show({ options = [], onPass = () => {}, onCancel = () => {} }) {
    this.options = options;
    this.onPassCallback = onPass;
    this.onCancelCallback = onCancel;
    this.active = true;

    if (!this.container) {
      // In headless / test environments without DOM, automatically pass
      onPass({ option: options[0], score: 1, transcript: 'mock-auto-pass' });
      return;
    }

    this.renderOptions();
    this.container.style.display = 'block';
    if (this.bannerEl) this.bannerEl.className = 'voice-recognized-banner';
    if (this.recognizedTextEl) this.recognizedTextEl.textContent = t('voice.waiting.speech');
    if (this.scoreEl) this.scoreEl.textContent = '';
    if (this.micStatusEl) this.micStatusEl.textContent = t('voice.mic.listening');

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown, true);
    }

    this.startListening();
  }

  renderOptions() {
    if (this.optAEl && this.options[0]) {
      this.optAEl.className = 'voice-option-card';
      const p = this.optAEl.querySelector('.voice-opt-primary');
      const s = this.optAEl.querySelector('.voice-opt-secondary');
      if (p) p.textContent = this.options[0].primary;
      if (s) s.textContent = this.options[0].secondary || '';
    }
    if (this.optBEl && this.options[1]) {
      this.optBEl.className = 'voice-option-card';
      const p = this.optBEl.querySelector('.voice-opt-primary');
      const s = this.optBEl.querySelector('.voice-opt-secondary');
      if (p) p.textContent = this.options[1].primary;
      if (s) s.textContent = this.options[1].secondary || '';
    }
  }

  startListening() {
    if (!this.active) return;
    if (this.bannerEl) this.bannerEl.className = 'voice-recognized-banner';
    if (this.scoreEl) this.scoreEl.textContent = '';
    if (this.micStatusEl) this.micStatusEl.textContent = t('voice.mic.listening');

    this.voiceService.start({
      lang: 'en-US',
      onInterim: (text) => this.handleSpeech(text, false),
      onFinal: (text) => this.handleSpeech(text, true),
      onError: (err) => {
        if (!this.active) return;
        if (this.micStatusEl) this.micStatusEl.textContent = '⚠️ 마이크 권한 또는 네트워크 확인 필요';
        if (this.scoreEl) this.scoreEl.textContent = '스킵 버튼[Enter]을 눌러 계속할 수 있습니다.';
      }
    });
  }

  handleSpeech(transcript, isFinal) {
    if (!this.active || !transcript) return;

    // Show recognized transcript in subtitle area
    if (this.recognizedTextEl) {
      this.recognizedTextEl.textContent = `"${transcript}"`;
    }

    // Evaluate against each option's accepted phrases
    let bestMatch = null;
    let highestScore = 0;

    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const evalResult = evaluatePronunciation(opt.phrases || [opt.primary], transcript, this.threshold);
      if (evalResult.score > highestScore) {
        highestScore = evalResult.score;
        bestMatch = { optionIndex: i, option: opt, evalResult };
      }
    }

    if (bestMatch && (bestMatch.evalResult.passed || highestScore >= this.threshold)) {
      // Success!
      const el = bestMatch.optionIndex === 0 ? this.optAEl : this.optBEl;
      el?.classList.add('matched');
      if (this.bannerEl) this.bannerEl.className = 'voice-recognized-banner success';
      if (this.scoreEl) {
        this.scoreEl.textContent = `✔ ${t('voice.match.success').replace('{score}', Math.round(highestScore * 100))}`;
      }
      if (this.micStatusEl) this.micStatusEl.textContent = '✔ 통과!';

      // Smooth brief delay before handing off control
      this.voiceService.stop();
      setTimeout(() => {
        if (this.active) this.pass(bestMatch.option, highestScore, transcript);
      }, 500);
    } else {
      // Feedback while speaking or unverified
      if (this.scoreEl && highestScore > 0.2) {
        const pct = Math.round(highestScore * 100);
        this.scoreEl.textContent = t('voice.match.retry').replace('{score}', pct);
      }
    }
  }

  handleKeyDown(e) {
    if (!this.active) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      this.pass(this.options[0], 1, 'keyboard-bypass');
    } else if (e.key === 'a' || e.key === 'A') {
      if (this.options[0]) {
        e.preventDefault();
        this.pass(this.options[0], 1, 'key-a');
      }
    } else if (e.key === 'b' || e.key === 'B') {
      if (this.options[1]) {
        e.preventDefault();
        this.pass(this.options[1], 1, 'key-b');
      }
    }
  }

  pass(chosenOption, score = 1, transcript = '') {
    if (!this.active) return;
    this.hide();
    const cb = this.onPassCallback;
    this.onPassCallback = null;
    cb?.({ option: chosenOption, score, transcript });
  }

  hide() {
    this.active = false;
    this.voiceService.stop();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown, true);
    }
    if (this.container) {
      this.container.style.display = 'none';
      this.optAEl?.classList.remove('matched');
      this.optBEl?.classList.remove('matched');
    }
  }
}
