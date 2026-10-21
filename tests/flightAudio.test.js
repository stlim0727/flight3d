import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FlightAudio } from '../src/audio/FlightAudio.js';

/**
 * Lightweight mock of Web Audio API for Node.js test environment
 */
function createMockAudioContext() {
  class MockAudioParam {
    constructor(val = 1) {
      this.value = val;
    }
    setValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
  }

  class MockNode {
    constructor() {
      this.connectedTo = [];
    }
    connect(dest) {
      this.connectedTo.push(dest);
      return dest;
    }
    start() {}
    stop() {}
  }

  class MockGainNode extends MockNode {
    constructor() {
      super();
      this.gain = new MockAudioParam(1);
    }
  }

  class MockBiquadFilterNode extends MockNode {
    constructor() {
      super();
      this.type = 'lowpass';
      this.frequency = new MockAudioParam(350);
      this.Q = new MockAudioParam(1);
    }
  }

  class MockOscillatorNode extends MockNode {
    constructor() {
      super();
      this.type = 'sine';
      this.frequency = new MockAudioParam(440);
    }
  }

  class MockCompressorNode extends MockNode {
    constructor() {
      super();
      this.threshold = new MockAudioParam(-12);
      this.knee = new MockAudioParam(8);
      this.ratio = new MockAudioParam(6);
      this.attack = new MockAudioParam(0.002);
      this.release = new MockAudioParam(0.18);
    }
  }

  return class MockAudioContext {
    constructor() {
      this.currentTime = 10.0;
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = new MockNode();
      this.onstatechange = null;
    }
    createGain() { return new MockGainNode(); }
    createBiquadFilter() { return new MockBiquadFilterNode(); }
    createOscillator() { return new MockOscillatorNode(); }
    createDynamicsCompressor() { return new MockCompressorNode(); }
    createBuffer(channels, size, sampleRate) {
      return {
        getChannelData: () => new Float32Array(size)
      };
    }
    createBufferSource() {
      const src = new MockNode();
      src.buffer = null;
      src.loop = false;
      return src;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
  };
}

describe('FlightAudio (Web Audio Engine & Mobile/Bluetooth Loudness Optimization)', () => {
  it('should construct with default audio state and detect mobile environment', () => {
    const audio = new FlightAudio();
    assert.strictEqual(audio.isMuted, false);
    assert.strictEqual(audio.isInitialized, false);
    assert.strictEqual(audio.volume, 1.0);
  });

  it('should initialize mastering chain with DynamicsCompressorNode and makeup gain stage', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.init();

      assert.strictEqual(audio.isInitialized, true);
      assert.ok(audio.ctx, 'AudioContext should be created');
      assert.ok(audio.masterGain, 'Master gain node should be created');
      assert.ok(audio.compressor, 'Master DynamicsCompressorNode should be created for loudness mastering');
      assert.ok(audio.makeupGain, 'Makeup gain booster node should be created for headphones/Bluetooth');

      // Check signal chain: masterGain -> compressor -> makeupGain -> destination
      assert.ok(audio.masterGain.connectedTo.includes(audio.compressor), 'Master gain should feed into compressor');
      assert.ok(audio.compressor.connectedTo.includes(audio.makeupGain), 'Compressor should feed into makeup gain');
      assert.ok(audio.makeupGain.connectedTo.includes(audio.ctx.destination), 'Makeup gain should connect to destination');

      // Check master gain value: should be >= 1.0 when unmuted
      assert.ok(audio.masterGain.gain.value >= 1.0, `Master gain should be >= 1.0, got ${audio.masterGain.gain.value}`);
      // Check makeup gain booster: should be > 1.0 (+4dB makeup)
      assert.ok(audio.makeupGain.gain.value > 1.2, `Makeup gain should be > 1.2, got ${audio.makeupGain.gain.value}`);
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('should cycle volume states between 100% -> 150% Mobile -> 200% Bluetooth Boost -> Mute -> 100%', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.volume = 1.0;
      audio.init();

      // State 1: Default 100%
      let state = audio.getVolumeState();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.mode, 'normal');
      assert.strictEqual(audio.effectiveVolume, 1.0);

      // Cycle to State 2: 150% Mobile Boost
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.mode, 'mobile');
      assert.strictEqual(audio.effectiveVolume, 1.5);
      assert.strictEqual(audio.masterGain.gain.value, 1.5);

      // Cycle to State 3: 200% Bluetooth Max Boost
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.mode, 'bluetooth');
      assert.strictEqual(audio.effectiveVolume, 2.0);
      assert.strictEqual(audio.masterGain.gain.value, 2.0);

      // Cycle to State 4: Muted
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, true);
      assert.strictEqual(state.mode, 'muted');
      assert.strictEqual(audio.effectiveVolume, 0.0);
      assert.strictEqual(audio.masterGain.gain.value, 0.0);

      // Cycle to State 5: Unmuted back to 100%
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.mode, 'normal');
      assert.strictEqual(audio.effectiveVolume, 1.0);
      assert.strictEqual(audio.masterGain.gain.value, 1.0);
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('should output robust commercial loudness levels across idle to TOGA regimes', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.init();

      // Check pack avionics fan sound exists (prevents silence at gate/idle)
      assert.ok(audio.packGain, 'Cockpit avionics pack cooling sound should exist');
      assert.ok(audio.packGain.gain.value > 0.1, 'Pack cooling sound should be audible');

      // Test Regime 1: Engine Idle on Ground (N1 = 22%)
      const idleState = {
        engine1: { n1: 22 },
        iasKnots: 0,
        groundSpeedKnots: 0,
        onGround: true,
        isStalled: false
      };
      audio.update(0.016, idleState, false);

      // Idle engine frequency must be >= 280 Hz so mobile phone speakers & earbuds can reproduce it!
      assert.ok(audio.engineFilter.frequency.value >= 280, `Idle cutoff should be >= 280 Hz, got ${audio.engineFilter.frequency.value}`);
      // Idle engine gain must be loud and clear (>= 0.35)
      assert.ok(audio.engineGain.gain.value >= 0.35, `Idle engine volume should be >= 0.35, got ${audio.engineGain.gain.value}`);
      // Turbine whine must be audible at idle (>= 0.05)
      assert.ok(audio.turbineGain.gain.value >= 0.05, `Turbine whine should be >= 0.05, got ${audio.turbineGain.gain.value}`);

      // Test Regime 2: Full TOGA Takeoff Roll (N1 = 100%, IAS = 140)
      const togaState = {
        engine1: { n1: 100 },
        iasKnots: 140,
        groundSpeedKnots: 140,
        onGround: true,
        isStalled: false
      };
      audio.update(0.016, togaState, false);

      assert.ok(audio.engineFilter.frequency.value >= 850, `TOGA cutoff should be >= 850 Hz, got ${audio.engineFilter.frequency.value}`);
      assert.ok(audio.engineGain.gain.value >= 1.0, `TOGA engine volume should be >= 1.0, got ${audio.engineGain.gain.value}`);
      assert.ok(audio.turbineGain.gain.value >= 0.25, `TOGA turbine whine should be >= 0.25, got ${audio.turbineGain.gain.value}`);

      // Test Regime 3: Ground Roll Rumble during takeoff roll
      assert.ok(audio.rumbleGain.gain.value > 0.3, `Ground roll rumble should be active during ground roll, got ${audio.rumbleGain.gain.value}`);

      // When airborne (onGround: false), ground roll rumble should cut to 0
      const airborneState = {
        engine1: { n1: 85 },
        iasKnots: 250,
        groundSpeedKnots: 250,
        onGround: false,
        isStalled: false
      };
      audio.update(0.016, airborneState, false);
      assert.strictEqual(audio.rumbleGain.gain.value, 0.0, 'Ground rumble should be 0 when airborne');
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('should resume audio context on interrupted and suspended states for Bluetooth audio routes', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.init();

      // Simulate Bluetooth route interruption (iOS WebKit 'interrupted' state)
      audio.ctx.state = 'interrupted';
      audio.ensureContextRunning();
      assert.strictEqual(audio.ctx.state, 'running', 'AudioContext should resume from interrupted state');

      // Simulate standard suspended state
      audio.ctx.state = 'suspended';
      audio.ensureContextRunning();
      assert.strictEqual(audio.ctx.state, 'running', 'AudioContext should resume from suspended state');
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });
});
