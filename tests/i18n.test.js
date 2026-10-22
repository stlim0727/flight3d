import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/en.js';
import ko from '../src/i18n/ko.js';
import { locales, resolveLanguage, setLanguage, getLanguage, t, bindText, STORAGE_KEY } from '../src/i18n/index.js';

const storage = { setItem() {} };

test('saved choice takes priority, browser region variants resolve, unsupported languages use English', () => {
  assert.equal(resolveLanguage('ko', ['en-US']), 'ko');
  assert.equal(resolveLanguage('invalid', ['fr-FR', 'ko-KR', 'en-US']), 'ko');
  assert.equal(resolveLanguage(null, ['en-GB']), 'en');
  assert.equal(resolveLanguage(null, ['fr-FR']), 'en');
  assert.equal(resolveLanguage(null), 'en');
});

test('catalogs cover the same messages and interpolation parameters, with no Korean in English', () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim(), key);
    assert.ok(ko[key].trim(), key);
    assert.doesNotMatch(en[key], /[가-힣]/, key);
    const parameters = value => [...value.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(parameters(ko[key]), parameters(en[key]), key);
  }
});

test('every explicit JS and HTML translation reference exists', () => {
  function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  }
  for (const file of ['index.html', ...walk('src').filter(file => file.endsWith('.js') && !file.startsWith('src/i18n/'))]) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\('([^']+)'|data-i18n(?:-title|-aria-label)?="([^"]+)"/g)) {
      assert.ok(Object.hasOwn(en, match[1] ?? match[2]), `${file}: ${match[1] ?? match[2]}`);
    }
  }
});

test('language changes persist and refresh existing text and accessible labels without resetting state', () => {
  let saved;
  const store = { setItem(key, value) { saved = [key, value]; } };
  const element = { textContent: '', isConnected: true, setAttribute(key, value) { this[key] = value; } };
  let visible = false;
  setLanguage('ko', storage);
  bindText(element, () => visible ? t('hide.yokes.j') : t('show.yokes.j'));
  bindText(element, () => t('ui.environment'), 'aria-label');
  assert.equal(element.textContent, '조종간 표시 [J]');
  setLanguage('en', store);
  assert.equal(element.textContent, 'Show yokes [J]');
  assert.equal(element['aria-label'], 'Environment');
  assert.deepEqual(saved, [STORAGE_KEY, 'en']);
  visible = true;
  setLanguage('ko', storage);
  assert.equal(element.textContent, '조종간 숨김 [J]');
  assert.equal(visible, true);
  assert.equal(setLanguage('unknown', storage), false);
  assert.equal(getLanguage(), 'ko');
  element.isConnected = false;
});

test('unavailable storage is tolerated; missing messages use English and values stay plain text', () => {
  setLanguage('en', { setItem() { throw new Error('blocked'); } });
  assert.equal(t('airport.changed.value', { value: '<b>Lukla</b>' }), 'Airport changed: <b>Lukla</b>');
  assert.equal(t('missing.key'), 'missing.key');
  delete locales.ko.messages['camera.view.centered'];
  try {
    setLanguage('ko', storage);
    assert.equal(t('camera.view.centered'), 'Camera view centered');
  } finally {
    locales.ko.messages['camera.view.centered'] = '카메라 시선 정면 초기화';
  }
});

test('a retained crash result changes language without changing collision codes or telemetry', async () => {
  const { CollisionDetector } = await import('../src/physics/CollisionDetector.js');
  const { Vector3, Quaternion } = await import('three');
  const detector = new CollisionDetector(null, null, null, null, null);
  detector.checkControlTower = (position, probes) => ({ point: position.clone(), get part() { return probes[0].desc; } });
  setLanguage('ko', storage);
  const result = detector.checkCollision(new Vector3(0, 20, 0), new Quaternion(), new Vector3(80, 0, 0), 1, 0, 0);
  assert.match(result.description, /기수/);
  const speed = result.speedKnots;
  setLanguage('en', storage);
  assert.equal(result.name, 'CONTROL TOWER COLLISION');
  assert.equal(result.description, 'The Nose radome struck the airport control tower.');
  assert.equal(result.type, 'TOWER');
  assert.equal(result.speedKnots, speed);
  setLanguage('ko', storage);
  assert.match(result.description, /기수/);
});
