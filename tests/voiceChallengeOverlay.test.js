import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceChallengeOverlay } from '../src/ui/VoiceChallengeOverlay.js';
import { VoiceRecognitionService } from '../src/audio/VoiceRecognitionService.js';

class MockVoiceService extends VoiceRecognitionService {
  constructor() {
    super({ SpeechRecognitionClass: null });
    this.started = false;
    this.stopped = false;
    this.callbacks = {};
  }
  isSupported() { return true; }
  start({ onInterim, onFinal, onError }) {
    this.started = true;
    this.callbacks = { onInterim, onFinal, onError };
    return true;
  }
  stop() {
    this.stopped = true;
  }
  emitSpeech(text, isFinal = true) {
    if (isFinal) this.callbacks.onFinal?.(text);
    else this.callbacks.onInterim?.(text);
  }
}

function createMockContainer() {
  const elements = {};
  const querySelector = (sel) => {
    const id = sel.replace(/[#.]/g, '');
    if (!elements[id]) {
      elements[id] = {
        id,
        className: '',
        textContent: '',
        style: {},
        classList: {
          add(c) { elements[id].className += ' ' + c; },
          remove(c) { elements[id].className = elements[id].className.replace(c, '').trim(); }
        },
        querySelector: (sub) => querySelector(sub),
        addEventListener() {}
      };
    }
    return elements[id];
  };

  return {
    style: { display: 'none' },
    querySelector
  };
}

test('VoiceChallengeOverlay displays options A and B and passes when recognized speech matches option A', async () => {
  const container = createMockContainer();
  const mockVoice = new MockVoiceService();
  const overlay = new VoiceChallengeOverlay({ container, voiceService: mockVoice });

  const options = [
    {
      id: 'a',
      tag: 'A',
      primary: 'Brakes set, ready to taxi',
      secondary: '(브레이크 설정 완료)',
      phrases: ['Brakes set, ready to taxi', '브레이크 설정 완료']
    },
    {
      id: 'b',
      tag: 'B',
      primary: 'Korean Air 123, taking manual control',
      secondary: '(대한항공 123, 직접 조종 인계)',
      phrases: ['Korean Air 123, taking manual control', '대한항공 123']
    }
  ];

  let passedResult = null;
  overlay.show({
    options,
    onPass: res => { passedResult = res; }
  });

  assert.equal(overlay.active, true);
  assert.equal(container.style.display, 'block');
  assert.equal(mockVoice.started, true);

  // Emit recognized speech for Option A
  mockVoice.emitSpeech('brakes set ready to taxi', true);

  // Wait for the overlay handoff timer
  await new Promise(r => setTimeout(r, 600));

  assert.ok(passedResult);
  assert.equal(passedResult.option.id, 'a');
  assert.equal(overlay.active, false);
});

test('VoiceChallengeOverlay bypasses immediately with keyboard or skip action', () => {
  const container = createMockContainer();
  const mockVoice = new MockVoiceService();
  const overlay = new VoiceChallengeOverlay({ container, voiceService: mockVoice });

  let passedResult = null;
  overlay.show({
    options: [{ id: 'opt1', primary: 'Test Phrase' }],
    onPass: res => { passedResult = res; }
  });

  // Simulate Enter key press
  overlay.handleKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.ok(passedResult);
  assert.equal(passedResult.option.id, 'opt1');
  assert.equal(overlay.active, false);
});
