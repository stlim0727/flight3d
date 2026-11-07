import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/random.js';

// Preserve the original terrain/city/ship stream as well as the uint32 valley
// variant: changing either would change seeded worlds and course contracts.
function legacyRandom(seed) {
  return () => {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('shared PRNG preserves seeded scenery streams across uint32 wraparound', () => {
  for (const seed of [0, 1, 424242, -1, 0xFFFFFFFF, 0x5bf03635]) {
    const random = mulberry32(seed), legacy = legacyRandom(seed);
    for (let index = 0; index < 100000; index++) {
      assert.equal(random(), legacy(), `seed ${seed}, sample ${index}`);
    }
  }
});

test('random generators maintain independent reproducible state', () => {
  const first = mulberry32(424242), second = mulberry32(424242);
  const expected = Array.from({ length: 100 }, first);
  assert.deepEqual(Array.from({ length: 100 }, second), expected);
  assert.ok(expected.every(value => value >= 0 && value < 1));
});
