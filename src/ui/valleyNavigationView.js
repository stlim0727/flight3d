import { createValleyManifest, valleyLegs } from '../arena/valleyCourse.js';

/** Static chart only; no live truth position or terrain predictions. */
export function valleyBriefingMarkup() {
  const m = createValleyManifest(), points = m.course.points;
  const xy = p => `${35 + (p.x + 3400) / 2000 * 320},${175 - (p.z - 500) / 5500 * 150}`;
  return `<p>F-16 · 루클라 고속·저공 로우패스 · 약 ${(m.courseLengthM / 1000).toFixed(2)} km. 출발 ${m.spawn.aglM} m AGL / ${m.spawn.iasKnots} KIAS.
    출발 → 1–5번 경유지 → 도착선 순서로 통과하세요. 도착 방향 ${valleyLegs(m.course).at(-1).headingDeg.toFixed(0)}°.</p>
    <svg viewBox="0 0 400 210" role="img" aria-label="정적 계곡 항로 지도. 위쪽이 남쪽, 오른쪽이 동쪽. 출발에서 다섯 경유지를 거쳐 도착">
      <polyline points="${points.map(xy).join(' ')}" fill="none" stroke="#63e3b4" stroke-width="2"/>
      ${points.map((p, i) => { const [x, y] = xy(p).split(','); return `<circle cx="${x}" cy="${y}" r="4" fill="#fff"/><text x="${Number(x) + 9}" y="${Number(y) + 4}" fill="#fff" font-size="12">${i === 0 ? '출발' : i === points.length - 1 ? '도착' : i}</text>`; }).join('')}
      <text x="12" y="202" fill="#b8cddd" font-size="11">남 ↑ · 동 → | 정적 지도 · 지형/장애물 감지 아님</text>
    </svg>
    <p>로컬 좌표 (동 x, 남 z / m): ${points.map((p, i) => `${i === 0 ? '출발' : i === 6 ? '도착' : i}: (${p.x}, ${p.z})`).join(' · ')}</p>
    <p>경유지 ±${m.course.gateHalfWidthM} m · 항로 ±${m.course.corridorHalfWidthM} m · 최저 ${m.course.minimumAglM} m AGL · ${m.minimumIasKnots}–${m.maximumIasKnots} KIAS · ${(m.timeoutTicks / m.physicsHz).toFixed(0)}초 이내 · 접촉/손상 금지.
    완주 후 ${m.course.targetAglM} m 초과 고도의 평균 70% + P95 30%가 점수이며 낮을수록 좋습니다.</p>`;
}

export function valleyNavigationText(navigation) {
  if (!navigation) return '항법 측정 대기 중';
  const value = (s, unit) => s?.status === 'available' && Number.isFinite(s.mean)
    ? `${s.mean.toFixed(0)}${unit} (±${s.std.toFixed(1)})` : '사용 불가';
  return `항법 보조 · 경유지 ${navigation.currentGateIndex}/${navigation.totalGates}\n` +
    `다음: ${value(navigation.goalBearingDeg, '°')} · ${value(navigation.goalRangeM, ' m')}\n` +
    `최종 도착: ${value(navigation.finishBearingDeg, '°')} · ${value(navigation.finishRangeM, ' m')}\n` +
    '5 Hz · 측정 오차 ±표시 · 장애물 감지 아님';
}
