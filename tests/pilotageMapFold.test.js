import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindPilotageMapFold, MAP_FOLD_MS } from '../src/ui/pilotageMapFold.js';

function fakeMap() {
  const listeners = new Map();
  const on = target => (type, fn) => {
    const key = `${target}:${type}`;
    listeners.set(key, [...(listeners.get(key) ?? []), fn]);
  };
  const fire = (target, type, event = {}) => {
    for (const fn of listeners.get(`${target}:${type}`) ?? []) fn(event);
  };
  const classes = new Set();
  const map = {
    open: false,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    },
    addEventListener: on('map'),
    querySelector: sel => (sel === 'summary' ? { addEventListener: on('summary') } : null),
  };
  // Mirrors a real summary click: listeners run first, then the native toggle
  // unless one of them called preventDefault; `toggle` fires afterwards.
  const tapSummary = () => {
    let prevented = false;
    fire('summary', 'click', { preventDefault: () => { prevented = true; } });
    if (prevented) return false;
    map.open = !map.open;
    fire('map', 'toggle');
    return true;
  };
  const gameClose = () => {
    map.open = false;
    fire('map', 'toggle');
  };
  return { map, tapSummary, gameClose, fire };
}

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => { pending.set(next, { fn, ms }); return next++; },
    clearTimer: id => pending.delete(id),
    pending,
    flush() {
      for (const [id, { fn }] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
  };
}

function bind({ reduce = false } = {}) {
  const fake = fakeMap();
  const timers = fakeTimers();
  const sounds = { unfold: 0, fold: 0 };
  const gesture = bindPilotageMapFold(fake.map, {
    onUnfold: () => { sounds.unfold++; },
    onFold: () => { sounds.fold++; },
    reduceMotion: { matches: reduce },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  // Close events dispatch synchronously in this fake, so the timer's
  // `open = false` also needs its toggle event to reach the listener.
  const flush = () => {
    const wasOpen = fake.map.open;
    timers.flush();
    if (wasOpen && !fake.map.open) fake.fire('map', 'toggle');
  };
  return { ...fake, timers, sounds, gesture, flush };
}

test('opening unfolds natively and rustles once', () => {
  const { map, tapSummary, sounds, timers } = bind();
  assert.equal(tapSummary(), true);
  assert.equal(map.open, true);
  assert.deepEqual(sounds, { unfold: 1, fold: 0 });
  assert.equal(timers.pending.size, 0);
});

test('a pilot fold animates first, then closes after the fold rustle length', () => {
  const { map, tapSummary, sounds, timers, gesture, flush } = bind();
  tapSummary();
  assert.equal(tapSummary(), false, 'native close is held back for the animation');
  assert.equal(map.open, true);
  assert.equal(map.classList.contains('is-folding'), true);
  assert.equal(gesture.folding, true);
  assert.deepEqual(sounds, { unfold: 1, fold: 1 }, 'fold rustle starts with the animation');
  assert.deepEqual([...timers.pending.values()].map(t => t.ms), [MAP_FOLD_MS]);

  flush();
  assert.equal(map.open, false);
  assert.equal(map.classList.contains('is-folding'), false);
  assert.equal(gesture.folding, false);
  assert.deepEqual(sounds, { unfold: 1, fold: 1 }, 'closing after the animation stays silent');
});

test('taps during the fold are ignored, then the map opens again normally', () => {
  const { map, tapSummary, sounds, timers, flush } = bind();
  tapSummary();
  tapSummary();
  assert.equal(tapSummary(), false, 'mid-fold tap does not reopen the sheet');
  assert.equal(timers.pending.size, 1, 'no second fold is scheduled');
  assert.deepEqual(sounds, { unfold: 1, fold: 1 });
  flush();
  assert.equal(tapSummary(), true);
  assert.equal(map.open, true);
  assert.deepEqual(sounds, { unfold: 2, fold: 1 });
});

test('a game close mid-fold closes at once and cancels the pending fold', () => {
  const { map, tapSummary, gameClose, sounds, timers, gesture } = bind();
  tapSummary();
  tapSummary();
  gameClose();
  assert.equal(map.open, false);
  assert.equal(map.classList.contains('is-folding'), false);
  assert.equal(gesture.folding, false);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(sounds, { unfold: 1, fold: 1 });
});

test('a game close of an open map stays silent and skips the animation', () => {
  const { map, tapSummary, gameClose, sounds, timers } = bind();
  tapSummary();
  gameClose();
  assert.equal(map.open, false);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(sounds, { unfold: 1, fold: 0 });
});

test('reduced motion folds at once with the same single rustle', () => {
  const { map, tapSummary, sounds, timers } = bind({ reduce: true });
  tapSummary();
  assert.equal(tapSummary(), true);
  assert.equal(map.open, false);
  assert.equal(map.classList.contains('is-folding'), false);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(sounds, { unfold: 1, fold: 1 });
});

test('the CSS fold keyframes last as long as MAP_FOLD_MS', () => {
  const css = readFileSync(new URL('../src/styles/flight-panels.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`animation: map-fold ${MAP_FOLD_MS}ms`));
  assert.match(css, new RegExp(`animation: map-crease-gather ${MAP_FOLD_MS}ms`));
  assert.match(css, /animation: map-unfold 600ms/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
