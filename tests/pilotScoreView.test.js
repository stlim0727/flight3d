import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPilotScoreData, scoreBannerMarkup, scoreOverlayMarkup, koreanReason } from '../src/ui/pilotScoreView.js';

test('koreanReason translates known internal reasons and preserves unknown strings', () => {
  assert.equal(koreanReason('completed'), '완주');
  assert.equal(koreanReason('crash'), '지형 충돌');
  assert.equal(koreanReason('clearance-floor'), '최저 고도 위반 (20m 미만)');
  assert.equal(koreanReason('timeout'), '시간 초과');
  assert.equal(koreanReason('custom-error'), 'custom-error');
});

test('formatPilotScoreData handles valley slalom success with large altitude score', () => {
  const record = {
    status: 'succeeded',
    reason: 'completed',
    tick: 5580, // 46.5 seconds at 120 Hz
    manifest: { type: 'valley', physicsHz: 120 },
    result: {
      metrics: {
        altitudeCostM: 279.218,
        completedGates: 6,
        totalGates: 6,
        medianAglM: 290.4,
        minAglM: 120.1,
        maxAglM: 412.8,
        meanExcessM: 260.1,
      },
    },
  };

  const data = formatPilotScoreData(record, 'F-16 루클라 계곡 저공');
  assert.equal(data.isSucceeded, true);
  assert.equal(data.hasAltitudeScore, true);
  assert.equal(data.mainValue, '279.22');
  assert.equal(data.mainUnit, 'm');
  assert.equal(data.durationText, '46.5초');
  assert.equal(data.badgeText, '🏁 계곡 저공 완주');
  assert.equal(data.stats.some(s => s.label === '경유지' && s.value === '6 / 6 완주'), true);
  assert.equal(data.stats.some(s => s.label === '중위 고도' && s.value === '290 m'), true);

  const banner = scoreBannerMarkup(data);
  assert.match(banner, /score-banner-val.*279\.22.*<span class="score-banner-unit">m<\/span>/);
  assert.match(banner, /data-banner-retry/);

  const overlay = scoreOverlayMarkup(data);
  assert.match(overlay, /modal-score-value.*279\.22.*<span class="modal-score-unit">m<\/span>/);
  assert.match(overlay, /data-score-retry/);
  assert.match(overlay, /data-score-close/);
});

test('formatPilotScoreData handles valley failure with reason and progress', () => {
  const record = {
    status: 'failed',
    reason: 'crash',
    tick: 1440, // 12 seconds
    manifest: { type: 'valley', physicsHz: 120 },
    result: {
      metrics: {
        altitudeCostM: null,
        completedGates: 2,
        totalGates: 6,
        progressM: 1850,
      },
    },
  };

  const data = formatPilotScoreData(record, 'F-16 루클라 계곡 저공');
  assert.equal(data.isFailed, true);
  assert.equal(data.hasAltitudeScore, false);
  assert.equal(data.mainValue, '지형 충돌');
  assert.equal(data.mainUnit, '');
  assert.equal(data.badgeText, '⚠️ 미션 실패');
  assert.equal(data.stats.some(s => s.label === '통과 경유지' && s.value === '2 / 6'), true);
  assert.equal(data.stats.some(s => s.label === '진행 거리' && s.value === '1,850 m'), true);

  const overlay = scoreOverlayMarkup(data);
  assert.match(overlay, /is-failed/);
  assert.match(overlay, /지형 충돌/);
});

test('formatPilotScoreData handles takeoff success', () => {
  const record = {
    status: 'succeeded',
    reason: 'completed',
    tick: 2160, // 18 seconds
    manifest: { type: 'takeoff', physicsHz: 120 },
    result: {
      metrics: {
        liftoffIasKnots: 145.2,
        centerlineRmsM: 1.4,
      },
    },
  };

  const data = formatPilotScoreData(record, '이륙');
  assert.equal(data.isSucceeded, true);
  assert.equal(data.stats.some(s => s.label === '이륙 속도' && s.value === '145 KT'), true);
  assert.equal(data.stats.some(s => s.label === '중심선 오차' && s.value === '1.4 m'), true);
});
