import test from 'node:test';
import assert from 'node:assert/strict';
import { StartupProgressView } from '../src/ui/StartupProgressView.js';

function fixture() {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.scrollHeight = 0; this.scrollTop = 0; this.clientHeight = 0; }
    append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    setAttribute(key, value) { this[key] = value; }
  }
  const elements = new Map(['log', 'progress', 'overlay', 'retry', 'wait', 'detail', 'step', 'elapsed', 'status', 'details']
    .map(id => [`startup-${id}`, new Element()]));
  let now = 0, tick;
  const cancelled = [];
  const view = new StartupProgressView({
    document: { getElementById: id => elements.get(id), createElement: () => new Element() },
    clock: () => now, schedule: callback => { tick = callback; return 1; }, cancel: id => cancelled.push(id),
  });
  return { view, elements, cancelled, time: value => { now = value; tick?.(); } };
}

test('loading history advances on real steps, keeps elapsed timings and stops on completion', () => {
  const f = fixture(); f.view.reset();
  f.view.stage(0, 'startup.scene');
  f.time(2000); f.view.detail('startup.detail.terrain');
  assert.equal(f.view.rows[0].row.dataset.state, 'done');
  assert.match(f.view.rows[0].timing.textContent, /2\.0/);
  f.time(11000);
  assert.equal(f.elements.get('startup-wait').hidden, false);
  f.view.detail('startup.detail.terrain');
  assert.equal(f.view.rows.length, 2, 'polling the same task adds no duplicate rows');
  f.view.finish();
  assert.equal(f.view.rows[1].row.dataset.state, 'done');
  assert.equal(f.view.timer, null);
  assert.equal(f.elements.get('startup-overlay')['aria-busy'], 'false');
});

test('failure keeps failed task visible; a new scene change resets history and timer', () => {
  const f = fixture(); f.view.reset(); f.view.stage(3, 'startup.controls');
  f.view.fail();
  assert.equal(f.view.rows[0].row.dataset.state, 'failed');
  assert.equal(f.elements.get('startup-details').open, true);
  assert.equal(f.view.timer, null);
  f.view.reset({ max: 3, steps: 3 });
  assert.equal(f.view.rows.length, 0);
  assert.equal(f.elements.get('startup-log').children.length, 0);
  f.view.stage(1, 'startup.world');
  assert.equal(f.elements.get('startup-progress').max, 3);
  assert.equal(f.elements.get('startup-progress').value, 1);
  for (let i = 0; i < 60; i++) f.view.detail(`task-${i}`);
  assert.equal(f.view.rows.length, 40);
  assert.equal(f.elements.get('startup-log').children.length, 40);
  f.view.reset();
  assert.ok(f.cancelled.length >= 2, 'reset never leaves the previous timer running');
  f.view.stop();
});
