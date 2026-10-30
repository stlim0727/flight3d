import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CESSNA_172, BOEING_737_800 } from '../src/config/aircraftConfigs.js';
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
    setPeriodicWave(wave) { this.wave = wave; }
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
    createPeriodicWave(real, imaginary) { return { real, imaginary }; }
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

describe('FlightAudio (Web Audio Engine)', () => {
  it('should construct with normal volume', () => {
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
      assert.ok(audio.makeupGain, 'Output stage should be created');

      // Check signal chain: masterGain -> compressor -> makeupGain -> destination
      assert.ok(audio.masterGain.connectedTo.includes(audio.compressor), 'Master gain should feed into compressor');
      assert.ok(audio.compressor.connectedTo.includes(audio.makeupGain), 'Compressor should feed into makeup gain');
      assert.ok(audio.makeupGain.connectedTo.includes(audio.ctx.destination), 'Makeup gain should connect to destination');

      // Check master gain value: should be >= 1.0 when unmuted
      assert.ok(audio.masterGain.gain.value >= 1.0, `Master gain should be >= 1.0, got ${audio.masterGain.gain.value}`);
      // Output stage must not add a boost.
      assert.strictEqual(audio.makeupGain.gain.value, 1.0);
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('toggles normal volume and mute without boost, including mobile defaults', () => {
    const previous = globalThis.window;
    globalThis.window = { AudioContext: createMockAudioContext(), ontouchstart: null, innerWidth: 320 };
    try {
      const audio = new FlightAudio();
      assert.strictEqual(audio.volume, 1);
      audio.init();
      for (const muted of [true, false, true, false]) {
        const state = audio.cycleVolume();
        assert.strictEqual(state.muted, muted);
        assert.strictEqual(state.mode, muted ? 'muted' : 'normal');
        assert.strictEqual(state.level, muted ? 0 : 1);
        assert.strictEqual(audio.effectiveVolume, muted ? 0 : 1);
        assert.strictEqual(audio.masterGain.gain.value, muted ? 0 : 1);
      }
      for (const requested of [1.5, 2, 3]) {
        audio.setVolume(requested);
        assert.strictEqual(audio.volume, 1);
        assert.strictEqual(audio.masterGain.gain.value, 1);
      }
      audio.setMuted(true);
      assert.strictEqual(audio.masterGain.gain.value, 0);
      audio.setMuted(false);
      assert.strictEqual(audio.masterGain.gain.value, 1);
    } finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
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


function withPiston(test) {
  const previous = globalThis.window;
  let cancellations = 0;
  globalThis.window = { AudioContext: createMockAudioContext(), speechSynthesis: { cancel() { cancellations++; } } };
  try {
    const audio = new FlightAudio(); audio.loadAircraftConfig(CESSNA_172); audio.init();
    test(audio, () => cancellations);
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
}
const pistonState = (n1, extra = {}) => ({ engine1: { n1, failed: false }, iasKnots: 0, groundSpeedKnots: 0, onGround: true, ...extra });

describe('C172 piston sound and lifecycle', () => {
  it('never activates the jet oscillators or pack for a piston aircraft, including initialization', () => withPiston(audio => {
    for (const stage of [null, 25, 70, 100, 25]) {
      if (stage !== null) audio.update(0.1, pistonState(stage), false);
      for (const name of ['engineGain', 'turbineGain', 'turbineGain2', 'packGain']) assert.equal(audio[name].gain.value, 0, name);
    }
    assert.ok(audio.pistonGain.gain.value > 0);
  }));

  it('follows shaft speed through idle, power up and release at firing/blade-passage frequencies', () => withPiston(audio => {
    const frequencies = [];
    for (const n1 of [25, 70, 100, 25]) {
      audio.update(0.1, pistonState(n1), false);
      frequencies.push(audio.pistonPulse.frequency.value);
      assert.equal(audio.pistonPulse.frequency.value, audio.propBeat.frequency.value);
    }
    assert.ok(Math.abs(frequencies[0] - 700 / 30) < 1e-8);
    assert.equal(frequencies[2], 90);
    assert.ok(frequencies[1] > frequencies[0] && frequencies[1] < frequencies[2]);
    assert.equal(frequencies[3], frequencies[0]);
  }));

  it('cuts firing on failure and does not leave a running engine sound when parked', () => withPiston(audio => {
    audio.update(0.1, pistonState(100), false);
    audio.update(0.1, pistonState(100, { engine1: { n1: 100, failed: true } }), false);
    assert.equal(audio.pistonGain.gain.value, 0);
    assert.equal(audio.propGain.gain.value, 0);
    assert.equal(audio.propModGain.gain.value, 0);
    audio.update(0.1, pistonState(9, { engine1: { n1: 9, failed: true }, iasKnots: 90, onGround: false }), false);
    assert.equal(audio.pistonGain.gain.value, 0);
    assert.ok(audio.propGain.gain.value > 0, 'quiet windmilling air sound is distinct from firing');
    audio.update(0.1, pistonState(25), false);
    assert.ok(audio.pistonGain.gain.value > 0, 'restart restores combustion');
  }));

  it('switches profiles without another context, removes residual piston tones, and resets callouts', () => withPiston((audio, cancellations) => {
    const context = audio.ctx, pulse = audio.pistonPulse;
    audio.update(0.1, pistonState(70), false);
    audio.calledAltitudes.add(50);
    audio.loadAircraftConfig(BOEING_737_800);
    assert.equal(audio.calledAltitudes.size, 0);
    assert.equal(audio.pistonGain.gain.value, 0);
    audio.update(0.1, pistonState(80), false);
    assert.ok(audio.turbineGain.gain.value > 0);
    audio.loadAircraftConfig(CESSNA_172);
    audio.init(); audio.update(0.1, pistonState(70), false);
    assert.equal(audio.ctx, context); assert.equal(audio.pistonPulse, pulse);
    assert.equal(audio.turbineGain.gain.value, 0);
    assert.equal(audio.packGain.gain.value, 0);
    assert.ok(cancellations() > 0);
  }));

  it('suppresses Boeing altitude callouts and uses a continuous light-aircraft stall horn', () => withPiston(audio => {
    let calls = 0; audio.playGpwsCallout = () => calls++;
    audio.update(0.1, pistonState(70, { onGround: false, radioAltFt: 40, vsiFpm: -500, isPreStall: true }), true);
    assert.equal(calls, 0);
    assert.equal(audio.warningGain.gain.value, 0.3);
    audio.update(0.2, pistonState(70, { onGround: false, isPreStall: true }), true);
    assert.equal(audio.warningGain.gain.value, 0.3);
    audio.update(0.1, pistonState(70, {isStalled:true}), true);
    assert.equal(audio.warningGain.gain.value, 0, 'ground horn inhibited');
  }));

  it('uses the sensor warning independently of separated flow and clears on ground', () => withPiston(audio => {
    for (const config of [CESSNA_172, BOEING_737_800]) {
      audio.loadAircraftConfig(config);
      audio.update(0.01, pistonState(70, { onGround: false, isStallWarning: true }), true);
      assert.ok(audio.warningGain.gain.value > 0, 'early sensor warning is audible');
      audio.update(0.01, pistonState(70, { onGround: false, isStallWarning: false, isStalled: true }), true);
      assert.equal(audio.warningGain.gain.value, 0, 'reattachment memory must not latch horn');
      audio.update(0.01, pistonState(70, { onGround: true, isStallWarning: true, isStalled: true }), true);
      assert.equal(audio.warningGain.gain.value, 0);
    }
  }));

  it('rearms Boeing altitude callouts after climbing and clears them on a preset reset', () => withPiston(audio => {
    audio.loadAircraftConfig(BOEING_737_800);
    const calls = []; audio.playGpwsCallout = value => calls.push(value);
    const update = (height, vsi) => audio.update(0.1, pistonState(70, {onGround:false,radioAltFt:height,vsiFpm:vsi}), false);
    update(600,-500); update(490,-500);
    update(1200,700); update(490,-500);
    assert.deepEqual(calls, ['Five hundred, five hundred', 'Five hundred, five hundred']);
    audio.reset(); assert.equal(audio.calledAltitudes.size,0);
  }));

  it('keeps engine parameters current while muted so unmute does not revive a stale engine', () => withPiston(audio => {
    audio.update(0.1, pistonState(100), false); audio.setMuted(true);
    audio.update(0.1, pistonState(9, { engine1: { n1: 9, failed: true } }), false);
    audio.setMuted(false);
    assert.equal(audio.masterGain.gain.value, 1);
    assert.equal(audio.pistonGain.gain.value, 0);
    assert.equal(audio.propGain.gain.value, 0);
  }));

  it('silences the bus while the sortie is held and restores the pilot setting on resume', () => withPiston(audio => {
    audio.update(0.1, pistonState(100), false);
    audio.setPaused(true);
    assert.equal(audio.effectiveVolume, 0);
    assert.equal(audio.masterGain.gain.value, 0);
    assert.equal(audio.volume, 1, 'a pause is not a volume setting');
    audio.update(0.1, pistonState(9, { engine1: { n1: 9, failed: true } }), false);
    audio.setPaused(false);
    assert.equal(audio.masterGain.gain.value, 1);
    audio.setMuted(true);
    audio.setPaused(true);
    audio.setPaused(false);
    assert.equal(audio.masterGain.gain.value, 0, 'unpausing must not unmute for the pilot');
  }));

  it('does not restart continuous sounds after a crash, including a muted crash and preset reset', () => withPiston(audio => {
    audio.update(0.1, pistonState(100, { iasKnots: 90 }), false);
    audio.setMuted(true); audio.playExplosion(); audio.setMuted(false);
    audio.update(0.1, pistonState(100), false);
    for (const name of ['pistonGain', 'propGain', 'propModGain', 'windGain', 'rumbleGain', 'packGain', 'warningGain']) assert.equal(audio[name].gain.value, 0, name);
    audio.reset(); audio.update(0.1, pistonState(25), false);
    assert.ok(audio.pistonGain.gain.value > 0);
  }));
});


it('keeps continuous buses silent when audio is first enabled after a crash', () => {
  const previous = globalThis.window;
  globalThis.window = { AudioContext: createMockAudioContext() };
  try {
    const audio = new FlightAudio();
    audio.playExplosion(); audio.init(); audio.update(0.1, pistonState(100), false);
    for (const name of ['engineGain', 'turbineGain', 'packGain', 'pistonGain']) assert.equal(audio[name].gain.value, 0);
    audio.reset(); audio.update(0.1, pistonState(25), false);
    assert.ok(audio.engineGain.gain.value > 0);
    assert.equal(audio.packGain.gain.value, 0.16);
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

describe('Exterior camera distance attenuation in the audio graph', () => {
  const jetState = { engine1: { n1: 100 }, iasKnots: 140, groundSpeedKnots: 140, onGround: true };

  it('routes the cockpit-filtered mix through the distance stage and keeps cockpit view unattenuated', () => {
    const previous = globalThis.window;
    globalThis.window = { AudioContext: createMockAudioContext() };
    try {
      const audio = new FlightAudio();
      audio.init();
      assert.ok(audio.cockpitFilter.connectedTo.includes(audio.distanceGain), 'cockpit filter should feed the distance stage');
      assert.ok(audio.distanceGain.connectedTo.includes(audio.masterGain), 'distance stage should feed master gain');

      audio.update(0.016, jetState, true, 140);
      assert.strictEqual(audio.distanceGain.gain.value, 1, 'cockpit view ignores camera distance');
      assert.strictEqual(audio.cockpitFilter.frequency.value, 2700);
    } finally {
      if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    }
  });

  it('shrinks and dulls the exterior mix as the camera backs away', () => {
    const previous = globalThis.window;
    globalThis.window = { AudioContext: createMockAudioContext() };
    try {
      const audio = new FlightAudio();
      audio.init();
      const levels = [];
      for (const meters of [20, 55, 140, 600]) {
        audio.update(0.016, jetState, false, meters);
        levels.push({ gain: audio.distanceGain.gain.value, cutoff: audio.cockpitFilter.frequency.value });
      }
      for (let i = 1; i < levels.length; i++) {
        assert.ok(levels[i].gain < levels[i - 1].gain, `gain should drop beyond ${[20, 55, 140, 600][i]}m`);
        assert.ok(levels[i].cutoff < levels[i - 1].cutoff, `cutoff should drop beyond ${[20, 55, 140, 600][i]}m`);
      }
      assert.ok(levels[3].gain >= 0.08, 'distant flyby should not vanish entirely');
      // Per-engine gains stay at full level; attenuation happens once at the distance stage.
      assert.ok(audio.engineGain.gain.value >= 1.0);
    } finally {
      if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    }
  });
});


describe('warning audio arbitration', () => {
  it('preempts altitude callouts, repeats urgent alerts, and cancels on recovery', () => withPiston((audio) => {
    audio.loadAircraftConfig(BOEING_737_800);
    const spoken = []; audio.playGpwsCallout = text => spoken.push(text);
    const warning = { id: 'pull-up', voice: 'Whoop whoop, pull up' };
    const state = pistonState(70, { onGround: false, radioAltFt: 490, vsiFpm: -1500, warnings: [warning] });
    audio.update(0.1, state, true);
    audio.update(0.1, state, true);
    assert.deepEqual(spoken, ['Whoop whoop, pull up']);
    audio.update(4, state, true);
    assert.equal(spoken.length, 2);
    audio.update(0.1, { ...state, warnings: [], radioAltFt: 480 }, true);
    assert.equal(audio.alertId, undefined);
  }));
  it('sounds overspeed clacker and engine caution chime, then restores the horn frequency', () => withPiston(audio => {
    audio.loadAircraftConfig(BOEING_737_800);
    const state = pistonState(70, { onGround: false, warnings: [{ id: 'overspeed' }] });
    audio.update(0.1, state, true);
    assert.equal(audio.warningOsc.frequency.value, 800);
    audio.update(0.1, { ...state, warnings: [{ id: 'engine' }] }, true);
    assert.equal(audio.warningGain.gain.value, 0.25);
    audio.update(0.5, { ...state, warnings: [] }, true);
    assert.equal(audio.warningOsc.frequency.value, 680);
    assert.equal(audio.warningGain.gain.value, 0);
    audio.reset(); assert.equal(audio.alertId, null);
  }));
});

describe('GPWS voice authenticity', () => {
  it('pins English speech and a pronouncer cadence regardless of OS locale', () => {
    const previous = globalThis.window, previousUtterance = globalThis.SpeechSynthesisUtterance;
    const enGb = { name: 'Daniel', lang: 'en-GB', localService: true };
    const enUsGoogle = { name: 'Google US English', lang: 'en-US', localService: false };
    const ko = { name: 'Seulgi', lang: 'ko-KR', localService: true };
    const spoken = [];
    class FakeUtterance {
      constructor(text) { this.text = text; }
      set voice(v) { this._voice = v; }
    }
    const synth = {
      onvoiceschanged: null,
      getVoices: () => [ko, enGb, enUsGoogle],
      speak(u) { spoken.push({ text: u.text, voice: u._voice, lang: u.lang, rate: u.rate, pitch: u.pitch }); },
      cancel() {},
    };
    globalThis.window = { AudioContext: createMockAudioContext(), speechSynthesis: synth };
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    try {
      const audio = new FlightAudio();
      audio.loadAircraftConfig(BOEING_737_800); audio.init();
      audio.playGpwsCallout('Terrain, terrain. Pull up, pull up');
      assert.equal(spoken.length, 1);
      const call = spoken[0];
      assert.equal(call.voice, enUsGoogle, 'network Google en-US is preferred over local en-GB');
      assert.equal(call.lang, 'en-US');
      assert.ok(call.rate <= 1 && call.pitch <= 0.6, 'measured low-pitch pronouncer cadence');
      audio.playGpwsCallout('Sink rate, sink rate');
      assert.equal(spoken.length, 2);
    } finally {
      if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
      if (previousUtterance === undefined) delete globalThis.SpeechSynthesisUtterance; else globalThis.SpeechSynthesisUtterance = previousUtterance;
    }
  });

  it('reselects once voices load late, and stays silent-safe without English voices', () => {
    const previous = globalThis.window, previousUtterance = globalThis.SpeechSynthesisUtterance;
    const enUs = { name: 'Zira', lang: 'en-US', localService: true };
    let voices = [];
    const spoken = [];
    class FakeUtterance {
      constructor(text) { this.text = text; }
      set voice(v) { this._voice = v; }
    }
    const synth = {
      onvoiceschanged: null,
      getVoices: () => voices,
      speak(u) { spoken.push({ voice: u._voice, lang: u.lang }); },
      cancel() {},
    };
    globalThis.window = { AudioContext: createMockAudioContext(), speechSynthesis: synth };
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    try {
      const audio = new FlightAudio();
      audio.loadAircraftConfig(BOEING_737_800); audio.init();
      audio.playGpwsCallout('Five hundred, five hundred');
      assert.equal(spoken.length, 1, 'falls back to locale default with no voice list');
      assert.equal(spoken[0].voice, undefined);
      assert.equal(typeof synth.onvoiceschanged, 'function');
      voices = [enUs];
      synth.onvoiceschanged();
      audio.playGpwsCallout('Five hundred, five hundred');
      assert.equal(spoken[1].voice, enUs, 'late-loading voices are picked on the next callout');
    } finally {
      if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
      if (previousUtterance === undefined) delete globalThis.SpeechSynthesisUtterance; else globalThis.SpeechSynthesisUtterance = previousUtterance;
    }
  });
});

describe('Touchdown contact audio', () => {
  it('uses short broadband transients through aircraft acoustics, without pitch sweeps', () => {
    const audio = new FlightAudio();
    const Context = createMockAudioContext();
    audio.ctx = new Context();
    audio.cockpitFilter = audio.ctx.createBiquadFilter();
    const buffers = [], gains = [];
    const createBuffer = audio.ctx.createBuffer.bind(audio.ctx);
    audio.ctx.createBuffer = (...args) => {
      const buffer = createBuffer(...args), data = buffer.getChannelData(0);
      buffer.getChannelData = () => data;
      buffers.push(data);
      return buffer;
    };
    const createGain = audio.ctx.createGain.bind(audio.ctx);
    audio.ctx.createGain = () => { const gain = createGain(); gains.push(gain); return gain; };
    audio.ctx.createOscillator = () => { throw Error('touchdown must not generate pitched chirps'); };
    audio.playTouchdownScreech(100);
    audio.playTouchdownThump(2);
    assert.strictEqual(buffers.length, 3);
    for (const data of buffers) {
      assert.ok(data[0] === 0, 'soft onset avoids a digital click');
      assert.ok(data.some(sample => sample > 0) && data.some(sample => sample < 0));
      assert.ok(Math.abs(data.at(-1)) < 0.003, 'noise decays before source stops');
    }
    assert.ok(gains.every(gain => gain.connectedTo.includes(audio.cockpitFilter)));
    const hardLevel = gains.at(-1).gain.value;
    audio.playTouchdownThump(0.25);
    assert.ok(gains.at(-1).gain.value < hardLevel);
    audio.playTouchdownThump(0);
    audio.playTouchdownScreech(0);
    audio.setMuted(true);
    audio.playTouchdownThump(3);
    assert.strictEqual(buffers.length, 5, 'zero energy contacts and muted audio stay silent');
  });

  it('coalesces contact chatter, preserves later bounces and rearms on reset', () => {
    const previous = globalThis.window;
    globalThis.window = { AudioContext: createMockAudioContext() };
    try {
      const audio = new FlightAudio(); audio.init();
      const impacts = [], scrubs = [];
      audio.playTouchdownThump = sink => impacts.push(sink);
      audio.playTouchdownScreech = speed => scrubs.push(speed);
      const state = { onGround: true, groundSpeedKnots: 70, touchdown: true, touchdownSinkRate: 0.4, vsiFpm: 0 };
      const update = (time, touchdown) => {
        audio.ctx.currentTime = time;
        audio.update(1 / 60, { ...state, touchdown }, true);
      };
      update(10, true); update(10.02, true); update(10.03, false); update(10.04, true);
      assert.deepStrictEqual(impacts, [0.4], 'sustained flag and short gear chatter do not repeat');
      update(10.1, false); update(10.5, true);
      assert.deepStrictEqual(impacts, [0.4, 0.4], 'later bounce remains audible');
      assert.deepStrictEqual(scrubs, [70, 70]);
      audio.reset(); update(10.51, true);
      assert.strictEqual(impacts.length, 3, 'new flight can land immediately');
    } finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });
});
