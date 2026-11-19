import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  exteriorDistanceGain, exteriorAirCutoff, propagationDelaySeconds, dopplerFactor,
  remoteEngineGain, remoteEngineCutoff, stereoPan, SPEED_OF_SOUND_MPS,
} from '../src/audio/distanceAcoustics.js';

describe('Exterior distance acoustics', () => {
  it('is unattenuated in the near field and for missing input', () => {
    assert.strictEqual(exteriorDistanceGain(0), 1);
    assert.strictEqual(exteriorAirCutoff(0), 8800);
    for (const bad of [undefined, NaN, -5]) {
      assert.strictEqual(exteriorDistanceGain(bad), 1);
      assert.strictEqual(exteriorAirCutoff(bad), 8800);
    }
  });

  it('quiets and dulls the mix monotonically as the camera backs away', () => {
    const distances = [0, 20, 38, 55, 90, 140, 300];
    const gains = distances.map(exteriorDistanceGain);
    const cutoffs = distances.map(exteriorAirCutoff);
    for (let i = 1; i < distances.length; i++) {
      assert.ok(gains[i] < gains[i - 1], `gain should drop from ${distances[i - 1]}m to ${distances[i]}m`);
      assert.ok(cutoffs[i] < cutoffs[i - 1], `cutoff should drop from ${distances[i - 1]}m to ${distances[i]}m`);
    }
    // Chase cam at its default 55 m distance halves the perceived engine level.
    assert.ok(Math.abs(exteriorDistanceGain(60) - 0.5) < 1e-9);
  });

  it('keeps a tower flyby audible but removes the host engine from bandit range (#862)', () => {
    assert.ok(exteriorDistanceGain(500) >= 0.08, 'a few hundred metres still carries the flyby');
    assert.ok(exteriorDistanceGain(1000) < 0.08, 'the floor starts fading past 600 m');
    assert.ok(exteriorDistanceGain(2500) < 0.02, 'kilometre-scale bandit views are nearly silent');
    assert.ok(exteriorDistanceGain(4200) < 0.001, 'no engine floor at bandit camera range');
    assert.ok(exteriorDistanceGain(100000) < 1e-5);
    assert.ok(exteriorAirCutoff(5000) >= 1500, 'air absorption keeps a dull far-field cutoff');
  });
});

describe('Sound propagation', () => {
  it('delays arrivals by one second per 343 m and caps gameplay latency', () => {
    assert.strictEqual(propagationDelaySeconds(0), 0);
    assert.strictEqual(propagationDelaySeconds(undefined), 0);
    assert.ok(Math.abs(propagationDelaySeconds(SPEED_OF_SOUND_MPS) - 1) < 1e-12);
    assert.ok(Math.abs(propagationDelaySeconds(686) - 2) < 1e-12);
    assert.strictEqual(propagationDelaySeconds(10000), 8, 'capped so replays do not schedule tiny late booms');
  });

  it('raises pitch for closing sources and lowers it for receding ones', () => {
    const listener = { x: 1000, y: 0, z: 0 };
    assert.strictEqual(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, listener, { x: 0, y: 0, z: 0 }), 1);
    assert.ok(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, listener, null) > 1);
    assert.ok(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: -100, y: 0, z: 0 }, listener, null) < 1);
    assert.strictEqual(dopplerFactor({ x: 0, y: 0, z: 0 }, null, { x: 0, y: 0, z: 0 }, null), 1);
    // A chase camera travelling with the aircraft hears no approach shift.
    assert.strictEqual(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: 240, y: 0, z: 0 }, listener, { x: 240, y: 0, z: 0 }), 1);
  });

  it('clamps transonic passes so the mix does not screech', () => {
    const listener = { x: 1000, y: 0, z: 0 };
    assert.strictEqual(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: 400, y: 0, z: 0 }, listener, null), 1.4);
    assert.strictEqual(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: -400, y: 0, z: 0 }, listener, null), 0.65);
    assert.strictEqual(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: 343, y: 0, z: 0 }, listener, null), 1.4);
  });

  it('keeps formation flight neutral even at or above the speed of sound', () => {
    // Source and observer fly together, so the closing rate is zero.
    const source = { x: 0, y: 0, z: 0 };
    const listener = { x: 55, y: 0, z: 0 };
    for (const speed of [342, 343, 400, 500]) {
      const velocity = { x: speed, y: 0, z: 0 };
      assert.strictEqual(dopplerFactor(source, velocity, listener, velocity), 1, `${speed} m/s formation`);
    }
    // Same supersonic source, but a stationary observer: a real closing pass.
    assert.strictEqual(dopplerFactor(source, { x: 400, y: 0, z: 0 }, listener, null), 1.4);
  });
});

describe('Remote aircraft engines', () => {
  it('stays below the listener engine and fades out at combat range', () => {
    assert.ok(remoteEngineGain(0) > 0 && remoteEngineGain(0) < 0.6);
    const distances = [100, 500, 1000, 3000, 6000];
    for (let i = 1; i < distances.length; i++) {
      assert.ok(remoteEngineGain(distances[i]) < remoteEngineGain(distances[i - 1]));
    }
    assert.strictEqual(remoteEngineGain(8000), 0);
    assert.strictEqual(remoteEngineGain(20_000), 0);
    for (const bad of [undefined, NaN, -10]) assert.strictEqual(remoteEngineGain(bad), 0);
  });

  it('dulls distant engines without dropping them to a whistle', () => {
    assert.strictEqual(remoteEngineCutoff(0), 5200);
    const distances = [100, 500, 1000, 3000];
    for (let i = 1; i < distances.length; i++) {
      assert.ok(remoteEngineCutoff(distances[i]) < remoteEngineCutoff(distances[i - 1]));
    }
    assert.ok(remoteEngineCutoff(20_000) >= 320);
  });

  it('pans by the listener right axis and centres on the nose/tail', () => {
    const right = { x: 1, y: 0, z: 0 };
    const listener = { x: 0, y: 0, z: 0 };
    assert.ok(stereoPan({ x: 100, y: 0, z: 0 }, listener, right) > 0.8);
    assert.ok(stereoPan({ x: -100, y: 0, z: 0 }, listener, right) < -0.8);
    assert.strictEqual(stereoPan({ x: 0, y: 0, z: 100 }, listener, right), 0);
    assert.strictEqual(stereoPan(null, listener, right), 0);
  });
});
