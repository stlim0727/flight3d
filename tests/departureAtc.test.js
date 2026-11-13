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

test('traffic exchanges wait for the traffic phase, share the frequency and are bounded by a watchdog', async () => {
  const { TRAFFIC_WAIT_LIMIT_SECONDS } = await import('../src/director/DepartureAtc.js');
  const { BANGKOK_DEPARTURE_ATC } = await import('../src/config/bangkokDepartureAtc.js');
  const { BANGKOK_DEPARTURE_RADIO } = await import('../src/config/bangkokDepartureRadio.js');
  const { TRAFFIC_RADIO, TRAFFIC_DEPARTURE_ATC } = await import('../src/config/trafficDepartureRadio.js');
  const traffic = { plan: TRAFFIC_DEPARTURE_ATC, radio: TRAFFIC_RADIO };
  const calls = [];
  let ready = false;
  const atc = new DepartureAtc('hold', voice => calls.push(voice), BANGKOK_DEPARTURE_ATC, BANGKOK_DEPARTURE_RADIO, traffic);
  assert.equal(atc.waitingForTraffic, true);
  assert.deepEqual(calls, [], 'a waiting traffic exchange is not keyed up');
  assert.equal(atc.caption(), '', 'nothing has been read yet');
  atc.update(50, false, true, key => { assert.equal(key, 'lineup'); return ready; });
  assert.equal(atc.index, 0, 'waiting time is not reading time');
  ready = true;
  atc.update(0.1, true, true, () => ready);
  assert.deepEqual(calls, [], 'another clip on the frequency must finish first');
  atc.update(0.1, false, true, () => ready);
  assert.deepEqual(calls, ['traffic:clearance']);
  assert.match(atc.caption(), /Korean Air Six-Five-Three, wind 290/);
  atc.update(100, false, true, () => ready);
  assert.deepEqual(calls, ['traffic:clearance', 'hold']);

  const stalled = [];
  const watchdog = new DepartureAtc('lineup', voice => stalled.push(voice), BANGKOK_DEPARTURE_ATC, BANGKOK_DEPARTURE_RADIO, traffic);
  watchdog.update(TRAFFIC_WAIT_LIMIT_SECONDS - 1, false, true, () => false);
  assert.deepEqual(stalled, []);
  watchdog.update(2, false, true, () => false);
  assert.deepEqual(stalled, ['traffic:handoff'], 'missing traffic cannot stall the departure');
});

test('without a traffic plan the departure ATC blocks are unchanged', () => {
  const atc = new DepartureAtc('taxi', () => {}, undefined, undefined, null);
  assert.ok(atc.blocks.every(block => !String(block.voice ?? '').startsWith('traffic:')));
});

test('every traffic exchange slot names a scripted clip whose speakers have localized labels', async () => {
  const { TRAFFIC_RADIO, TRAFFIC_DEPARTURE_ATC } = await import('../src/config/trafficDepartureRadio.js');
  const en = (await import('../src/i18n/locales/en/scenarios.js')).default;
  const ko = (await import('../src/i18n/locales/ko/scenarios.js')).default;
  const keys = Object.values(TRAFFIC_DEPARTURE_ATC).flatMap(plan => [...(plan.before ?? []), ...(plan.after ?? [])]).map(entry => entry.voiceKey);
  assert.deepEqual([...new Set(keys)].sort(), Object.keys(TRAFFIC_RADIO).sort(), 'each clip is used exactly by the plan');
  for (const [speaker] of Object.values(TRAFFIC_RADIO).flat()) {
    assert.ok(en[`departure.speaker.${speaker}`], `en label for ${speaker}`);
    assert.ok(ko[`departure.speaker.${speaker}`], `ko label for ${speaker}`);
  }
  assert.ok(Object.values(TRAFFIC_RADIO).flat().some(([speaker, text]) => speaker === 'traffic' && text.includes('Korean Air Six-Five-Three')));
});
