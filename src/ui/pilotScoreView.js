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
  const hasScore = isSucceeded && (Number.isFinite(m.finalScore) || Number.isFinite(m.altitudeCostM));
  const hasAltitudeScore = hasScore;

  const durationSec = (record.tick / (record.manifest?.physicsHz ?? 120));
  const durationText = `${durationSec.toFixed(1)}초`;
  const isHuman = record.pilotKind === 'human';
  const pilotPrefix = isHuman ? '👤 사람 조종' : '🤖 AI 조종';
  const pilotRoleText = isHuman ? '사람 (직접 조종)' : 'AI 파일럿';

  let badgeText = '미션 종료';
  let badgeType = 'neutral';
  let mainLabel = '결과';
  let mainValue = `${durationText}`;
  let mainUnit = '';
  let subtext = '';
  const stats = [];

  if (isValley) {
    if (isSucceeded) {
      badgeText = `${pilotPrefix} · 🏁 계곡 완주`;
      badgeType = 'success';
      mainLabel = '최종 점수';
      if (Number.isFinite(m.finalScore)) {
        mainValue = m.finalScore.toLocaleString('ko-KR');
        mainUnit = '점';
        subtext = '완주 시간 단축 시 고득점 · 100 m 초과 고도 페널티';
      } else {
        mainValue = m.altitudeCostM != null ? m.altitudeCostM.toFixed(2) : '완주';
        mainUnit = m.altitudeCostM != null ? 'm' : '';
        const targetAgl = record.manifest?.course?.targetAglM ?? 100;
        subtext = `낮을수록 우수 · ${targetAgl} m 초과 고도 페널티`;
      }
      stats.push({ label: '조종 구분', value: pilotRoleText });
      stats.push({ label: '완주 시간', value: durationText });
      if (Number.isFinite(m.meanIasKnots)) stats.push({ label: '평균 속도', value: `${Math.round(m.meanIasKnots)} KT` });
      if (Number.isFinite(m.maxIasKnots)) stats.push({ label: '최고 속도', value: `${Math.round(m.maxIasKnots)} KT` });
      const cleared = m.clearedGates ?? m.completedGates ?? 6;
      const total = m.totalGates ?? 6;
      stats.push({ label: '경유지', value: `${cleared} / ${total} 완주` });
      if (Number.isFinite(m.medianAglM)) stats.push({ label: '중위 고도', value: `${Math.round(m.medianAglM)} m` });
      if (Number.isFinite(m.minAglM)) stats.push({ label: '최저 고도', value: `${Math.round(m.minAglM)} m` });
      if (Number.isFinite(m.altitudeCostM)) stats.push({ label: '100m 초과 고도', value: `${m.altitudeCostM.toFixed(1)} m` });
      if (m.totalPenalties > 0) stats.push({ label: '제약 감점', value: `-${m.totalPenalties.toLocaleString('ko-KR')}점` });
    } else if (isFailed) {
      badgeText = `${pilotPrefix} · ⚠️ 미션 실패`;
      badgeType = 'failed';
      mainLabel = '실패 사유';
      mainValue = koreanReason(record.reason);
      mainUnit = '';
      subtext = '완주 시 고도 점수가 기록됩니다';
      stats.push({ label: '조종 구분', value: pilotRoleText });
      stats.push({ label: '비행 시간', value: durationText });
      if (Number.isFinite(m.meanIasKnots)) stats.push({ label: '평균 속도', value: `${Math.round(m.meanIasKnots)} KT` });
      if (Number.isFinite(m.completedGates ?? m.gatesCleared)) {
        stats.push({ label: '통과 경유지', value: `${m.completedGates ?? m.gatesCleared ?? 0} / ${m.totalGates ?? 6}` });
      }
      if (Number.isFinite(m.progressM)) {
        stats.push({ label: '진행 거리', value: `${Math.round(m.progressM).toLocaleString('ko-KR')} m` });
      }
      if (Number.isFinite(m.minAglM)) stats.push({ label: '최저 고도', value: `${Math.round(m.minAglM)} m` });
    } else {
      badgeText = `${pilotPrefix} · 수동 중지`;
      badgeType = 'aborted';
      mainLabel = '중지 사유';
      mainValue = koreanReason(record.reason);
      subtext = '수동 인계 또는 비행 설정이 변경되었습니다';
      stats.push({ label: '조종 구분', value: pilotRoleText });
      stats.push({ label: '비행 시간', value: durationText });
    }
  } else {
    // Takeoff or landing or general mission
    if (isSucceeded) {
      badgeText = `${pilotPrefix} · 🏁 미션 성공`;
      badgeType = 'success';
      mainLabel = '완료 시간';
      mainValue = durationText;
      stats.push({ label: '조종 구분', value: pilotRoleText });
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
      badgeText = `${pilotPrefix} · ⚠️ 미션 실패`;
      badgeType = 'failed';
      mainLabel = '실패 사유';
      mainValue = koreanReason(record.reason);
      stats.push({ label: '조종 구분', value: pilotRoleText });
      stats.push({ label: '비행 시간', value: durationText });
    } else {
      badgeText = `${pilotPrefix} · 수동 중지`;
      badgeType = 'aborted';
      mainLabel = '중지 사유';
      mainValue = koreanReason(record.reason);
      stats.push({ label: '조종 구분', value: pilotRoleText });
      stats.push({ label: '비행 시간', value: durationText });
    }
  }

  return {
    status,
    isSucceeded,
    isFailed,
    isAborted,
    isValley,
    isHuman,
    hasScore,
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
      <div class="modal-mission-title">${data.missionName} · ${data.isHuman ? '사람 직접 조종' : 'AI 자동 조종'}</div>
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
