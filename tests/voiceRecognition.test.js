import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRecognitionService } from '../src/audio/VoiceRecognitionService.js';

class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = 'en-US';
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.started = false;
    this.stopped = false;
  }

  start() {
    this.started = true;
    setTimeout(() => this.onstart?.(), 1);
  }

  stop() {
    this.stopped = true;
    setTimeout(() => this.onend?.(), 1);
  }

  abort() {
    this.stopped = true;
    setTimeout(() => this.onend?.(), 1);
  }

  simulateResult(transcript, isFinal = true) {
    const event = {
      resultIndex: 0,
      results: [
        Object.assign([{ transcript }], { isFinal })
      ]
    };
    this.onresult?.(event);
  }

  simulateError(error) {
    this.onerror?.({ error });
  }
}

test('isSupported reports false when no SpeechRecognition implementation is available', () => {
  const service = new VoiceRecognitionService({ SpeechRecognitionClass: null });
  assert.equal(service.isSupported(), false);
  let errorCaught = null;
  const started = service.start({ onError: err => { errorCaught = err; } });
  assert.equal(started, false);
  assert.ok(errorCaught);
});

test('starts listening and processes interim and final results', async () => {
  let mockInstance = null;
  class InjectedMock extends MockSpeechRecognition {
    constructor() {
      super();
      mockInstance = this;
    }
  }

  const service = new VoiceRecognitionService({ SpeechRecognitionClass: InjectedMock });
  assert.equal(service.isSupported(), true);

  const interims = [];
  const finals = [];
  let state = null;

  service.start({
    lang: 'en-US',
    onInterim: text => interims.push(text),
    onFinal: text => finals.push(text),
    onStateChange: s => { state = s.state; }
  });

  await new Promise(r => setTimeout(r, 10));
  assert.equal(state, 'listening');
  assert.equal(mockInstance.started, true);

  mockInstance.simulateResult('brakes set', false);
  assert.deepEqual(interims, ['brakes set']);
  assert.deepEqual(finals, []);

  mockInstance.simulateResult('brakes set ready to taxi', true);
  assert.deepEqual(finals, ['brakes set ready to taxi']);

  service.stop();
  assert.equal(service.isListening, false);
});

test('handles errors gracefully without unhandled exceptions', async () => {
  let mockInstance = null;
  class InjectedMock extends MockSpeechRecognition {
    constructor() {
      super();
      mockInstance = this;
    }
  }

  const service = new VoiceRecognitionService({ SpeechRecognitionClass: InjectedMock });
  let errorReceived = null;

  service.start({
    onError: err => { errorReceived = err; }
  });

  await new Promise(r => setTimeout(r, 5));
  mockInstance.simulateError('audio-capture');
  assert.equal(errorReceived.error, 'audio-capture');
  service.stop();
});
