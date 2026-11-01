/**
 * Format pilot mission results into prominent score cards and overlays.
 * Used by PilotArenaPanel to display prominent post-flight scores.
 */

export const REASON_KO = {
  'completed': '완주',
  'crash': '지형 충돌',
  'body-strike': '동체 접촉',
  'damage': '기체 손상',
  'timeout': '시간 초과',
  'clearance-floor': '최저 고도 위반 (20m 미만)',
  'speed-envelope': '속도 한계 초과',
  'course-excursion': '항로 이탈 (±400m 초과)',
  'corridor-excursion': '협곡 이탈',
  'gate-missed': '경유지 미통과',
  'invalid-spawn': '출발 위치 오류',
  'discontinuous-flight': '비행 불연속',
  'runway-excursion': '활주로 이탈',
  'hard-touchdown': '하드 랜딩 (과도한 하강 충격)',
  'nose-first': '노즈기어 선접지',
  'touchdown-outside-zone': '접지 구역 이탈',
  'unstable-touchdown': '불안정 접지',
  'missed-landing': '착륙 복행',
  'approach-abandoned': '접근 이탈',
  'recontact': '활주로 재접촉',
  'user-stopped': '수동 중지',
  'preset-changed': '설정 변경',
  'browser-backgrounded': '백그라운드 전환',
};

export function koreanReason(reason) {
  return REASON_KO[reason] ?? reason ?? '종료';
}

export function formatPilotScoreData(record, missionName = '계곡 미션') {
  if (!record) return null;
  const m = record.result?.metrics ?? {};
  const status = record.status;
  const isSucceeded = status === 'succeeded';
  const isFailed = status === 'failed';
  const isAborted = status === 'aborted';
  const isValley = record.manifest?.type === 'valley' || record.manifest?.type === 'valley-slalom'
    || record.manifest?.id === 'valley-low-v1';
  const hasAltitudeScore = isSucceeded && Number.isFinite(m.altitudeCostM);

  const durationSec = (record.tick / (record.manifest?.physicsHz ?? 120));
  const durationText = `${durationSec.toFixed(1)}초`;

  let badgeText = '미션 종료';
  let badgeType = 'neutral';
  let mainLabel = '결과';
  let mainValue = `${durationText}`;
  let mainUnit = '';
  let subtext = '';
  const stats = [];

  if (isValley) {
    if (isSucceeded) {
      badgeText = '🏁 계곡 저공 완주';
      badgeType = 'success';
      mainLabel = '최종 점수 (고도 초과 비용)';
      mainValue = m.altitudeCostM != null ? m.altitudeCostM.toFixed(2) : '완주';
      mainUnit = m.altitudeCostM != null ? 'm' : '';
      subtext = '낮을수록 우수 · 50 m 초과 고도 페널티';
      stats.push({ label: '소요 시간', value: durationText });
      stats.push({ label: '경유지', value: `${m.completedGates ?? m.gatesCleared ?? 6} / ${m.totalGates ?? 6} 완주` });
      if (Number.isFinite(m.medianAglM)) stats.push({ label: '중위 고도', value: `${Math.round(m.medianAglM)} m` });
      if (Number.isFinite(m.minAglM)) stats.push({ label: '최저 고도', value: `${Math.round(m.minAglM)} m` });
      if (Number.isFinite(m.maxAglM)) stats.push({ label: '최고 고도', value: `${Math.round(m.maxAglM)} m` });
      if (Number.isFinite(m.meanExcessM)) stats.push({ label: '평균 초과', value: `${m.meanExcessM.toFixed(1)} m` });
    } else if (isFailed) {
      badgeText = '⚠️ 미션 실패';
      badgeType = 'failed';
      mainLabel = '실패 사유';
      mainValue = koreanReason(record.reason);
      mainUnit = '';
      subtext = '완주 시 고도 점수가 기록됩니다';
      stats.push({ label: '비행 시간', value: durationText });
      if (Number.isFinite(m.completedGates ?? m.gatesCleared)) {
        stats.push({ label: '통과 경유지', value: `${m.completedGates ?? m.gatesCleared ?? 0} / ${m.totalGates ?? 6}` });
      }
      if (Number.isFinite(m.progressM)) {
        stats.push({ label: '진행 거리', value: `${Math.round(m.progressM).toLocaleString('ko-KR')} m` });
      }
      if (Number.isFinite(m.minAglM)) stats.push({ label: '최저 고도', value: `${Math.round(m.minAglM)} m` });
    } else {
      badgeText = '수동 중지';
      badgeType = 'aborted';
      mainLabel = '중지 사유';
      mainValue = koreanReason(record.reason);
      subtext = '수동 인계 또는 비행 설정이 변경되었습니다';
      stats.push({ label: '비행 시간', value: durationText });
    }
  } else {
    // Takeoff or landing or general mission
    if (isSucceeded) {
      badgeText = '🏁 미션 성공';
      badgeType = 'success';
      mainLabel = '완료 시간';
      mainValue = durationText;
      if (m.liftoffIasKnots) {
        stats.push({ label: '이륙 속도', value: `${Math.round(m.liftoffIasKnots)} KT` });
      }
      if (m.touchdown?.sinkRateMs) {
        stats.push({ label: '접지 하강률', value: `${Math.round(m.touchdown.sinkRateMs * 196.85)} FPM` });
      }
      if (Number.isFinite(m.centerlineRmsM ?? m.touchdown?.centerlineOffsetM)) {
        stats.push({ label: '중심선 오차', value: `${(m.centerlineRmsM ?? m.touchdown?.centerlineOffsetM).toFixed(1)} m` });
      }
      stats.push({ label: '소요 시간', value: durationText });
    } else if (isFailed) {
      badgeText = '⚠️ 미션 실패';
      badgeType = 'failed';
      mainLabel = '실패 사유';
      mainValue = koreanReason(record.reason);
      stats.push({ label: '비행 시간', value: durationText });
    } else {
      badgeText = '수동 중지';
      badgeType = 'aborted';
      mainLabel = '중지 사유';
      mainValue = koreanReason(record.reason);
      stats.push({ label: '비행 시간', value: durationText });
    }
  }

  return {
    status,
    isSucceeded,
    isFailed,
    isAborted,
    isValley,
    hasAltitudeScore,
    missionName,
    badgeText,
    badgeType,
    mainLabel,
    mainValue,
    mainUnit,
    subtext,
    durationText,
    stats,
  };
}

export function scoreBannerMarkup(data) {
  if (!data) return '';
  const failedClass = data.isFailed ? ' is-failed' : data.isAborted ? ' is-aborted' : '';
  const statsHtml = data.stats.map(s => `<div><span>${s.label}</span><strong>${s.value}</strong></div>`).join('');
  return `
    <div class="score-banner-badge">${data.badgeText}</div>
    <div class="score-banner-main">
      <div class="score-banner-label">${data.mainLabel}</div>
      <div class="score-banner-val">${data.mainValue}${data.mainUnit ? `<span class="score-banner-unit">${data.mainUnit}</span>` : ''}</div>
      ${data.subtext ? `<div class="score-banner-sub">${data.subtext}</div>` : ''}
    </div>
    ${statsHtml ? `<div class="score-banner-grid">${statsHtml}</div>` : ''}
    <div class="score-banner-actions">
      <button type="button" class="btn btn-primary" data-banner-retry>다시 실행</button>
    </div>
  `;
}

export function scoreOverlayMarkup(data) {
  if (!data) return '';
  const failedClass = data.isFailed ? ' is-failed' : data.isAborted ? ' is-aborted' : '';
  const statsHtml = data.stats.map(s => `
    <div class="modal-stat-item">
      <span class="modal-stat-name">${s.label}</span>
      <strong class="modal-stat-value">${s.value}</strong>
    </div>
  `).join('');

  return `
    <div class="pilot-score-modal${failedClass}">
      <span class="modal-badge">${data.badgeText}</span>
      <div class="modal-mission-title">${data.missionName}</div>
      <div class="modal-score-box">
        <div class="modal-score-label">${data.mainLabel}</div>
        <div class="modal-score-value">${data.mainValue}${data.mainUnit ? `<span class="modal-score-unit">${data.mainUnit}</span>` : ''}</div>
        ${data.subtext ? `<div class="modal-score-sub">${data.subtext}</div>` : ''}
      </div>
      ${statsHtml ? `<div class="modal-stats-grid">${statsHtml}</div>` : ''}
      <div class="modal-actions">
        <button type="button" class="btn-retry" data-score-retry>다시 도전</button>
        <button type="button" class="btn-close" data-score-close>닫기</button>
      </div>
    </div>
  `;
}
