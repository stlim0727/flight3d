import assert from 'node:assert/strict';
import test from 'node:test';
import { PbfWriter } from 'pbf';
import {
  dedupeLandmarks,
  extractBaseLandmarks,
  extractBuildingLandmarks,
  extractDivisionLandmarks,
  parseOvertureNames,
} from '../src/geospatial/overtureLandmarks.js';

function zigzag(value) {
  return (value << 1) ^ (value >> 31);
}

function encodeGeometry(type, ringsOrPoints) {
  if (type === 1) {
    const [x, y] = ringsOrPoints;
    return [9, zigzag(x), zigzag(y)];
  }
  const rings = type === 2 ? [ringsOrPoints] : ringsOrPoints;
  const commands = [];
  let px = 0;
  let py = 0;
  for (const points of rings) {
    commands.push(9, zigzag(points[0][0] - px), zigzag(points[0][1] - py));
    px = points[0][0];
    py = points[0][1];
    if (points.length > 1) {
      commands.push(2 | ((points.length - 1) << 3));
      for (const [x, y] of points.slice(1)) {
        commands.push(zigzag(x - px), zigzag(y - py));
        px = x;
        py = y;
      }
    }
    if (type === 3) commands.push(15);
  }
  return commands;
}

function encodeMvt(layers) {
  const writer = new PbfWriter();
  for (const { name, features, extent = 4096 } of layers) {
    writer.writeMessage(3, (_, layer) => {
      layer.writeStringField(1, name);
      layer.writeVarintField(15, 2);
      layer.writeVarintField(5, extent);
      const keys = [];
      const values = [];
      const keyIndex = key => {
        const existing = keys.indexOf(key);
        if (existing >= 0) return existing;
        keys.push(key);
        return keys.length - 1;
      };
      const valueIndex = value => {
        const tag = `${typeof value}:${String(value)}`;
        const existing = values.findIndex(entry => entry.tag === tag);
        if (existing >= 0) return existing;
        values.push({ tag, value });
        return values.length - 1;
      };
      for (const feature of features) {
        const tags = Object.entries(feature.properties ?? {})
          .filter(([, value]) => value !== undefined && value !== null)
          .flatMap(([key, value]) => [keyIndex(key), valueIndex(value)]);
        layer.writeMessage(2, (_, msg) => {
          msg.writeVarintField(3, feature.type);
          if (tags.length) msg.writePackedVarint(2, tags);
          msg.writePackedVarint(4, encodeGeometry(feature.type, feature.geom));
        }, null);
      }
      for (const key of keys) layer.writeStringField(3, key);
      for (const { value } of values) {
        layer.writeMessage(4, (_, msg) => {
          if (typeof value === 'boolean') msg.writeBooleanField(7, value);
          else if (typeof value === 'number') msg.writeDoubleField(3, value);
          else msg.writeStringField(1, String(value));
        }, null);
      }
    }, null);
  }
  return writer.finish();
}

test('parseOvertureNames prefers short Korean rule, falls back to English for non-Korean scripts, and filters unit codes', () => {
  assert.deepEqual(
    parseOvertureNames({
      '@name': '서울특별시',
      names: JSON.stringify({
        primary: '서울특별시',
        common: { ko: '서울특별시', en: 'Seoul' },
        rules: [{ variant: 'short', language: 'ko', value: '서울' }],
      }),
    }),
    { ko: '서울', en: 'Seoul' },
  );

  // Non-Korean primary without ko translation falls back to English rather than Devanagari
  assert.deepEqual(
    parseOvertureNames({
      '@name': 'नेपाल',
      names: JSON.stringify({ primary: 'नेपाल', common: { en: 'Lukla', ne: 'नेपाल' } }),
    }),
    { ko: 'Lukla', en: 'Lukla' },
  );

  assert.equal(parseOvertureNames({ '@name': '1동' }), null);
  assert.equal(parseOvertureNames({ '@name': '123' }), null);
  assert.equal(parseOvertureNames({ '@name': '32통' }), null);
  assert.equal(parseOvertureNames({ '@name': 'Building 4', names: JSON.stringify({ primary: '4동', common: { en: 'Building 4' } }) }), null);
  assert.equal(parseOvertureNames({}), null);
});

test('extractDivisionLandmarks ranks cities by prominence/population and filters microhoods/hamlets', () => {
  const data = encodeMvt([{
    name: 'division',
    features: [
      { type: 1, geom: [1000, 1000], properties: { id: 'busan', wikidata: 'Q16520', subtype: 'locality', class: 'city', '@prominence': 93, population: 3300000, '@name': '부산광역시', names: JSON.stringify({ primary: '부산광역시', common: { ko: '부산광역시', en: 'Busan' }, rules: [{ variant: 'short', language: 'ko', value: '부산' }] }) } },
      { type: 1, geom: [1200, 1200], properties: { id: 'haeundae', wikidata: 'Q489401', subtype: 'macrohood', '@name': '해운대구', names: JSON.stringify({ primary: '해운대구', common: { en: 'Haeundae-gu' } }) } },
      { type: 1, geom: [1400, 1400], properties: { id: 'bukdo', wikidata: 'Q498600', subtype: 'locality', class: 'town', '@name': '북도면', names: JSON.stringify({ primary: '북도면', common: { en: 'Bukdo-myeon' } }) } },
      { type: 1, geom: [1600, 1600], properties: { id: 'micro', subtype: 'microhood', '@name': '우동' } },
      { type: 1, geom: [1800, 1800], properties: { id: 'hamlet', subtype: 'locality', class: 'hamlet', '@name': '안골' } },
      // Polygon feature in division must be skipped
      { type: 3, geom: [[[100, 100], [500, 100], [500, 500], [100, 500]]], properties: { id: 'poly', subtype: 'locality', class: 'city', '@name': '서울' } },
    ],
  }]);

  const extracted = extractDivisionLandmarks(data, { x: 436, y: 198 }, 9);
  assert.equal(extracted.length, 3);
  assert.deepEqual(extracted.map(item => item.names.en), ['Busan', 'Haeundae-gu', 'Bukdo-myeon']);
  assert.equal(extracted[0].importance, 5);
  assert.deepEqual(extracted[0].kinds, ['city']);
  assert.equal(extracted[1].importance, 3);
  assert.deepEqual(extracted[1].kinds, ['district', 'city']);
  assert.equal(extracted[2].importance, 2);
});

test('extractBaseLandmarks extracts major landmarks and excludes noise features', () => {
  const poly = (x0, y0, size) => [[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size]]];
  const data = encodeMvt([
    {
      name: 'infrastructure',
      features: [
        { type: 3, geom: poly(500, 500, 200), properties: { id: 'icn', wikidata: 'Q20932', subtype: 'airport', class: 'international_airport', '@name': '인천국제공항', names: JSON.stringify({ primary: '인천국제공항', common: { en: 'Incheon International Airport' } }) } },
        { type: 3, geom: poly(800, 800, 900), properties: { id: 'gwangan', wikidata: 'Q486049', subtype: 'bridge', class: 'bridge', '@name': '광안대교', names: JSON.stringify({ primary: '광안대교', common: { en: 'Gwangan Bridge' } }) } },
        // LineString railway/highway viaduct bridge must be excluded globally
        { type: 2, geom: [[100, 200], [3200, 200]], properties: { id: 'viaduct', wikidata: 'Q3239246', subtype: 'bridge', class: 'bridge', '@name': "Ligne d'Ermont - Eaubonne à Champ-de-Mars" } },
        { type: 1, geom: [900, 900], properties: { id: 'nst', wikidata: 'Q485838', subtype: 'communication', class: 'communication_tower', height: 236, '@name': '남산서울타워', names: JSON.stringify({ primary: '남산서울타워', common: { en: 'N Seoul Tower' } }) } },
        { type: 3, geom: poly(1200, 1200, 120), properties: { id: 'dam', wikidata: 'Q12621569', subtype: 'power', class: 'plant', '@name': '팔당댐', names: JSON.stringify({ primary: '팔당댐', common: { en: 'Paldang Dam' } }) } },
        { type: 1, geom: [1400, 1400], properties: { id: 'sub', wikidata: 'Q20415', subtype: 'transit', class: 'subway_station', '@name': '서울역', names: JSON.stringify({ primary: '서울역', common: { en: 'Seoul Station' } }) } },
        // Noise: bus stop & bicycle rental
        { type: 1, geom: [1500, 1500], properties: { id: 'bus', subtype: 'transit', class: 'bus_stop', '@name': '강남역 정류장' } },
        { type: 1, geom: [1600, 1600], properties: { id: 'bike', subtype: 'transit', class: 'bicycle_rental', '@name': '따릉이' } },
      ],
    },
    {
      name: 'land',
      features: [
        { type: 1, geom: [2000, 2000], properties: { id: 'halla', wikidata: 'Q484703', class: 'volcano', elevation: 1947, '@name': '한라산', names: JSON.stringify({ primary: '한라산', common: { en: 'Hallasan' } }) } },
        { type: 1, geom: [2100, 2100], properties: { id: 'subpeak', class: 'peak', elevation: 550, '@name': '작은봉' } },
        { type: 3, geom: poly(2200, 2200, 150), properties: { id: 'haeundae-beach', wikidata: 'Q490226', class: 'beach', '@name': '해운대 해수욕장', names: JSON.stringify({ primary: '해운대 해수욕장', common: { en: 'Haeundae Beach' } }) } },
        { type: 3, geom: poly(2600, 2200, 240), properties: { id: 'liberty-islet', wikidata: 'Q319821', class: 'islet', '@name': 'Liberty Island' } },
        // Clipped peninsula must be dropped
        { type: 3, geom: poly(0, 0, 2000), properties: { id: 'korea', wikidata: 'Q483134', class: 'peninsula', '@name': '조선반도/한반도' } },
      ],
    },
    {
      name: 'land_use',
      features: [
        { type: 3, geom: poly(2500, 2500, 800), properties: { id: 'samsung', subtype: 'developed', class: 'industrial', '@name': '삼성전자 디지털시티', names: JSON.stringify({ primary: '삼성전자 디지털시티', common: { en: 'Samsung Digital City' } }) } },
        { type: 3, geom: poly(1000, 2500, 700), properties: { id: 'liberty-park', wikidata: 'Q3363986', subtype: 'protected', class: 'state_park', '@name': 'Liberty State Park' } },
        { type: 3, geom: poly(100, 2500, 300), properties: { id: 'school', wikidata: 'Q18605313', subtype: 'education', class: 'school', '@name': '서울초등학교' } },
      ],
    },
    {
      name: 'water',
      features: [
        { type: 3, geom: poly(3000, 3000, 600), properties: { id: 'sihwa', wikidata: 'Q12604543', class: 'lake', '@name': '시화호', names: JSON.stringify({ primary: '시화호', common: { en: 'Sihwa Lake' } }) } },
      ],
    },
  ]);

  const extracted = extractBaseLandmarks(data, { x: 6988, y: 3173 }, 13);
  const byId = new Map(extracted.map(item => [item.id, item]));
  assert.equal(byId.get('Q20932')?.importance, 5);
  assert.deepEqual(byId.get('Q20932')?.kinds, ['airport']);
  assert.deepEqual(byId.get('Q486049')?.kinds, ['bridge']);
  assert.equal(byId.has('Q3239246'), false);
  assert.equal(byId.get('Q485838')?.importance, 5);
  assert.deepEqual(byId.get('Q12621569')?.kinds, ['dam']);
  assert.equal(byId.get('Q20415')?.importance, 1);
  assert.equal(byId.get('Q484703')?.importance, 5);
  assert.equal(byId.get('Q484703')?.elevationM, 1947);
  assert.equal(byId.get('Q484703')?.groundRelative, false);
  assert.equal(byId.has('subpeak'), false);
  assert.equal(byId.has('korea'), false);
  assert.deepEqual(byId.get('Q319821')?.kinds, ['island', 'water']);
  assert.deepEqual(byId.get('samsung')?.kinds, ['corporate']);
  assert.deepEqual(byId.get('Q3363986')?.kinds, ['park', 'attraction']);
  assert.equal(byId.has('Q18605313'), false);
  assert.deepEqual(byId.get('Q12604543')?.kinds, ['water']);
  assert.equal(byId.has('bus'), false);
  assert.equal(byId.has('bike'), false);
});

test('extractBuildingLandmarks selects tall/iconic non-residential buildings and rejects apartments', () => {
  const box = (x, y) => [[[x, y], [x + 80, y], [x + 80, y + 80], [x, y + 80]]];
  const data = encodeMvt([{
    name: 'building',
    features: [
      { type: 3, geom: box(400, 400), properties: { id: 'posco', height: 305, subtype: 'commercial', class: 'commercial', '@name': '포스코타워-송도', names: JSON.stringify({ primary: '포스코타워-송도', common: { en: 'Posco Tower-Songdo' } }) } },
      { type: 3, geom: box(600, 600), properties: { id: 'museum', class: 'museum', '@name': '국립중앙박물관', names: JSON.stringify({ primary: '국립중앙박물관', common: { en: 'National Museum of Korea' } }) } },
      { type: 3, geom: box(700, 600), properties: { id: 'opera', class: 'opera_house', '@name': 'Sydney Opera House' } },
      { type: 3, geom: box(750, 600), properties: { id: 'baptist', class: 'cathedral', '@name': 'Cathedral of Saint John the Baptist' } },
      { type: 3, geom: box(760, 650), properties: { id: 'captain', class: 'museum', '@name': 'Captain Cook Museum' } },
      { type: 3, geom: box(800, 800), properties: { id: 'apt', height: 240, subtype: 'residential', class: 'apartments', '@name': '잠실엘스아파트' } },
      { type: 3, geom: box(900, 800), properties: { id: 'en-apt', height: 210, subtype: 'commercial', '@name': 'Link Apartments 8 Carlisle' } },
      { type: 3, geom: box(950, 800), properties: { id: 'ko-apt-en', height: 180, subtype: 'commercial', '@name': 'Seoul APT' } },
      { type: 3, geom: box(1000, 1000), properties: { id: 'brand', height: 180, subtype: 'commercial', '@name': '송도더샵오피스텔' } },
      { type: 3, geom: box(1200, 1200), properties: { id: 'low', height: 40, subtype: 'commercial', '@name': '작은상가' } },
    ],
  }]);

  const extracted = extractBuildingLandmarks(data, { x: 13976, y: 6347 }, 14);
  assert.deepEqual(extracted.map(item => item.id), ['posco', 'museum', 'opera', 'baptist', 'captain']);
  assert.equal(extracted[0].importance, 5);
  assert.deepEqual(extracted[0].kinds, ['tower', 'corporate']);
  assert.equal(extracted[0].heightOffsetM, 305);
  assert.equal(extracted[1].importance, 3);
  assert.equal(extracted[2].importance, 3);
});

test('dedupeLandmarks collapses Wikidata, ID, normalized name, and airport duplicates while keeping distinct towers', () => {
  const deduped = dedupeLandmarks([
    { id: 'curated-icn', names: { ko: '인천국제공항', en: 'Incheon Airport' }, x: 0, z: 0, importance: 5, kinds: ['airport'] },
    { id: 'stream-icn', wikidata: 'Q20932', names: { ko: '인천공항', en: 'Incheon International Airport' }, x: 600, z: 400, importance: 5, kinds: ['airport'], streamed: true },
    { id: 'seoul-city', wikidata: 'Q8684', names: { ko: '서울', en: 'Seoul' }, x: 25000, z: 0, importance: 5, kinds: ['city'], streamed: true },
    { id: 'seoul-dup', wikidata: 'Q8684', names: { ko: '서울특별시', en: 'Seoul' }, x: 25100, z: 50, importance: 3, kinds: ['district'], streamed: true },
    { id: 'lukla-local', ko: '루클라 공항', en: 'Lukla Airport', x: 100000, z: 0, importance: 5, kinds: ['airport'] },
    { id: 'lukla-osm', names: { ko: 'Tenzing-Hillary Airport', en: 'Tenzing-Hillary Airport' }, x: 100150, z: 80, importance: 5, kinds: ['airport'], streamed: true },
    { id: 'tower-1', names: { ko: '파크원 타워1', en: 'Parc.1 Tower1' }, x: 20000, z: 500, importance: 5, kinds: ['tower'], streamed: true },
    { id: 'tower-2', names: { ko: '전경련회관', en: 'FKI Tower' }, x: 20400, z: 650, importance: 5, kinds: ['tower'], streamed: true },
  ]);

  assert.deepEqual(
    deduped.map(item => item.id),
    ['curated-icn', 'lukla-local', 'seoul-city', 'tower-1', 'tower-2'],
  );
});
