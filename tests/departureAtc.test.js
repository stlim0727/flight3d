import test from 'node:test';
import assert from 'node:assert/strict';
import { DepartureAtc } from '../src/director/DepartureAtc.js';

test('delivery clearance and readback precede the apron pushback voice call', () => {
  const calls = [];
  const atc = new DepartureAtc('gate', stage => calls.push(stage));
  assert.match(atc.caption(), /request clearance/);
  assert.deepEqual(calls, []);
  atc.update(100);
  assert.match(atc.caption(), /Squawk 4213/);
  atc.update(100);
  assert.match(atc.caption(), /climb 3000 feet, squawk 4213/);
  atc.update(100);
  assert.match(atc.caption(), /readback correct/);
  atc.update(100);
  assert.deepEqual(calls, ['gate']);
  atc.update(100, true);
  assert.equal(atc.busy, true, 'audio end is required even after reading time');
  atc.update(0, false);
  assert.equal(atc.busy, false);
});

test('caption exchanges work offline and simulation pause preserves the current exchange', () => {
  const atc = new DepartureAtc('departure');
  atc.update(0);
  assert.equal(atc.index, 0);
  while (atc.busy) atc.update(100);
  assert.match(atc.caption(), /climb 3000 feet/);
  assert.equal(atc.busy, false);
});

test('tower handoff completes before the tower holding-short call starts', () => {
  const calls = [];
  const atc = new DepartureAtc('hold', stage => calls.push(stage));
  atc.update(100);
  assert.deepEqual(calls, []);
  atc.update(100);
  assert.deepEqual(calls, ['hold']);
});


test('equipment-clear audio cannot play while the tug is still driving away', () => {
  const calls=[];
  const atc=new DepartureAtc('disconnect', stage=>calls.push(stage));
  atc.update(100,false,false);
  assert.equal(atc.busy,true);
  assert.deepEqual(calls,[]);
  atc.update(0,false,true);
  assert.deepEqual(calls,['disconnect']);
});
