import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { RemoteEngineAudio } from '../src/audio/nodes/RemoteEngineAudio.js';

function createMockAudioContext() {
  class MockAudioParam {
    constructor(value = 1) { this.value = value; }
    setValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    cancelScheduledValues() {}
  }
  class MockNode {
    constructor() { this.connectedTo = []; this.startTimes = []; this.stopTimes = []; }
    connect(dest) { this.connectedTo.push(dest); return dest; }
    start(when = 0) { this.startTimes.push(when); }
    stop(when = 0) { this.stopTimes.push(when); }
  }
  class MockGainNode extends MockNode { constructor() { super(); this.gain = new MockAudioParam(1); } }
  class MockFilterNode extends MockNode {
    constructor() { super(); this.type = 'lowpass'; this.frequency = new MockAudioParam(350); this.Q = new MockAudioParam(1); }
  }
  class MockOscillatorNode extends MockNode {
    constructor() { super(); this.type = 'sine'; this.frequency = new MockAudioParam(440); }
  }
  class MockPannerNode extends MockNode { constructor() { super(); this.pan = new MockAudioParam(0); } }
  class MockBufferSource extends MockNode {
    constructor() { super(); this.buffer = null; this.loop = false; this.playbackRate = new MockAudioParam(1); }
  }
  return class MockAudioContext {
    constructor() {
      this.currentTime = 10;
      this.sampleRate = 44100;
      this.destination = new MockNode();
    }
    createGain() { return new MockGainNode(); }
    createBiquadFilter() { return new MockFilterNode(); }
    createOscillator() { return new MockOscillatorNode(); }
    createStereoPanner() { return new MockPannerNode(); }
    createBuffer(channels, size) { return { getChannelData: () => new Float32Array(size) }; }
    createBufferSource() { return new MockBufferSource(); }
  };
}

function makeTarget(id, x, z, velocity = new THREE.Vector3(), n1 = 80) {
  return {
    id, alive: true, callsign: id,
    position: new THREE.Vector3(x, 1000, z),
    velocity,
    flight: { engines: { n1: [n1] } },
  };
}

function makeHarness() {
  const MockAudioContext = createMockAudioContext();
  const ctx = new MockAudioContext();
  const output = ctx.createGain();
  const engineAudio = new RemoteEngineAudio(ctx, output);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1000, 0);
  return { ctx, output, engineAudio, camera };
}

describe('Remote aircraft engine audio', () => {
  it('creates one voice per live target and routes it through air absorption, gain and pan', () => {
    const { engineAudio, camera, output } = makeHarness();
    engineAudio.update([makeTarget('bandit-1', 100, 0)], camera, new THREE.Vector3());
    assert.strictEqual(engineAudio.voices.size, 1);
    const voice = engineAudio.voices.get('bandit-1');
    assert.ok(voice.filter.connectedTo.includes(voice.gain));
    assert.ok(voice.gain.connectedTo.includes(voice.panner));
    assert.ok(voice.panner.connectedTo.includes(engineAudio.bus));
    assert.ok(engineAudio.bus.connectedTo.includes(output));
    assert.ok(voice.gain.gain.value > 0);
    assert.ok(voice.panner.pan.value > 0.5, 'starboard bandit sits on the right channel');
  });

  it('shrinks and dulls a receding target, then retires it out of range', () => {
    const { engineAudio, camera } = makeHarness();
    const listener = new THREE.Vector3();
    engineAudio.update([makeTarget('bandit-1', 200, 0)], camera, listener);
    const near = engineAudio.voices.get('bandit-1');
    const nearGain = near.gain.gain.value;
    const nearCutoff = near.filter.frequency.value;

    engineAudio.update([makeTarget('bandit-1', 3000, 0)], camera, listener);
    const far = engineAudio.voices.get('bandit-1');
    assert.ok(far.gain.gain.value < nearGain);
    assert.ok(far.filter.frequency.value < nearCutoff);

    engineAudio.update([], camera, listener);
    assert.strictEqual(engineAudio.voices.size, 0, 'a vanished bandit releases its oscillators');
    assert.ok(far.synth.turbineWhine.stopTimes.length > 0);
  });

  it('raises the turbine pitch when the bandit closes and keeps level pitch when stationary', () => {
    const { engineAudio, camera } = makeHarness();
    const still = makeTarget('still', 2000, 0, new THREE.Vector3());
    engineAudio.update([still], camera, new THREE.Vector3());
    const stillHz = engineAudio.voices.get('still').synth.turbineWhine.frequency.value;

    const closing = makeTarget('closing', 2000, 0, new THREE.Vector3(-250, 0, 0));
    engineAudio.update([closing], camera, new THREE.Vector3());
    const closingHz = engineAudio.voices.get('closing').synth.turbineWhine.frequency.value;
    assert.ok(closingHz > stillHz * 1.1, 'closing source bends the whine upward');
    assert.ok(engineAudio.voices.get('closing').synth.engineNoise.playbackRate.value > 1);
  });

  it('gives voices to the nearest targets instead of array order', () => {
    const { engineAudio, camera } = makeHarness();
    const far = Array.from({ length: 4 }, (_, index) => makeTarget(`far-${index}`, 7000, 0));
    const near = makeTarget('near', 10, 0);
    engineAudio.update([...far, near], camera, new THREE.Vector3());
    assert.strictEqual(engineAudio.voices.size, 4);
    assert.ok(engineAudio.voices.has('near'), 'the close bandit must not be dropped behind distant voices');
    assert.strictEqual([...engineAudio.voices.keys()].filter(id => id.startsWith('far')).length, 3);
    const nearGain = engineAudio.voices.get('near').gain.gain.value;
    const farGain = engineAudio.voices.get('far-0').gain.gain.value;
    assert.ok(nearGain > farGain * 20, 'priority follows distance, not insertion order');
  });

  it('shares the listener noise buffer and honours the engine volume slider', () => {
    const { engineAudio, output } = makeHarness();
    const buffer = { getChannelData: () => new Float32Array(16) };
    const shared = new RemoteEngineAudio(engineAudio.ctx, output, buffer);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1000, 0);
    shared.update([makeTarget('bandit-1', 100, 0)], camera, new THREE.Vector3());
    assert.strictEqual(shared.voices.get('bandit-1').synth.engineNoiseBuffer, buffer);
    shared.setEngineVolume(0.25);
    assert.strictEqual(shared.bus.gain.value, 0.25);
    shared.setEngineVolume(Number.NaN);
    assert.strictEqual(shared.bus.gain.value, 0.25, 'invalid volume keeps the current setting');
  });
});
