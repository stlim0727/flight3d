/**
 * Service for capturing microphone audio and running browser-native SpeechRecognition.
 * Supports interim and final transcripts, language selection, and headless/mock test injection.
 */
export class VoiceRecognitionService {
  constructor({
    SpeechRecognitionClass = (typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null),
    defaultLang = 'en-US'
  } = {}) {
    this.SpeechRecognitionClass = SpeechRecognitionClass;
    this.defaultLang = defaultLang;
    this.recognition = null;
    this.isListening = false;
    this.lastError = null;
    this.onInterimCallback = null;
    this.onFinalCallback = null;
    this.onErrorCallback = null;
    this.onStateChangeCallback = null;
  }

  isSupported() {
    return Boolean(this.SpeechRecognitionClass);
  }

  start({
    lang = this.defaultLang,
    onInterim = () => {},
    onFinal = () => {},
    onError = () => {},
    onStateChange = () => {}
  } = {}) {
    this.stop();

    if (!this.isSupported()) {
      const err = new Error('SpeechRecognition not supported in this environment');
      this.lastError = err.message;
      onError(err);
      return false;
    }

    this.onInterimCallback = onInterim;
    this.onFinalCallback = onFinal;
    this.onErrorCallback = onError;
    this.onStateChangeCallback = onStateChange;
    this.lastError = null;

    try {
      const recognition = new this.SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        this.isListening = true;
        this.onStateChangeCallback?.({ state: 'listening' });
      };

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          if (res.isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        if (interim) {
          this.onInterimCallback?.(interim.trim());
        }
        if (final) {
          this.onFinalCallback?.(final.trim());
        }
      };

      recognition.onerror = (event) => {
        // 'no-speech' is routine in noisy or silent environments; don't abort immediately
        if (event.error === 'no-speech') return;
        this.lastError = event.error;
        this.onErrorCallback?.(event);
      };

      recognition.onend = () => {
        if (this.isListening) {
          // Attempt continuous listen unless explicitly stopped
          try {
            recognition.start();
          } catch {
            this.isListening = false;
            this.onStateChangeCallback?.({ state: 'idle' });
          }
        } else {
          this.onStateChangeCallback?.({ state: 'idle' });
        }
      };

      this.recognition = recognition;
      recognition.start();
      return true;
    } catch (error) {
      this.lastError = error.message;
      this.isListening = false;
      this.onErrorCallback?.(error);
      return false;
    }
  }

  stop() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop?.();
      } catch {
        // Ignore stop errors if already inactive
      }
      this.recognition = null;
    }
    this.onStateChangeCallback?.({ state: 'idle' });
  }

  abort() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.abort?.();
      } catch {
        // Ignore abort errors
      }
      this.recognition = null;
    }
    this.onStateChangeCallback?.({ state: 'idle' });
  }
}
