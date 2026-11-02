import { createSlalomManifest } from '../arena/slalomCourse.js';

/** Dynamic chart for seed-based virtual valley courses. */
export function valleyBriefingMarkup(seed = 1) {
  const m = createSlalomManifest({ seed: Number.isSafeInteger(seed) && seed >= 0 ? seed : 1 });
  const points = m.course.points;
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const minX = Math.min(...xs) - 200, maxX = Math.max(...xs) + 200;
  const minZ = Math.min(...zs) - 100, maxZ = Math.max(...zs) + 100;
  const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;
  const xy = p => `${30 + (p.x - minX) / rangeX * 340},${25 + (p.z - minZ) / rangeZ * 150}`;
  const totalGates = points.length - 1;

  return `<p>F-16 · 가상 계곡 슬라롬 (시드 ${seed}) · 약 ${(m.course.lengthM / 1000).toFixed(2)} km. 목표 속도 ${m.envelope.cruiseKnots} KT · 최저 고도 ${m.course.clearanceFloorM} m AGL.
    출발 → 1–${totalGates - 1}번 게이트 → 도착선 순서로 통과하세요.</p>
    <svg viewBox="0 0 400 210" role="img" aria-label="가상 계곡 항로 지도. 출발에서 경유지를 거쳐 도착">
      <polyline points="${points.map(xy).join(' ')}" fill="none" stroke="#63e3b4" stroke-width="2"/>
      ${points.map((p, i) => { const [x, y] = xy(p).split(','); return `<circle cx="${x}" cy="${y}" r="4" fill="#fff"/><text x="${Number(x) + 9}" y="${Number(y) + 4}" fill="#fff" font-size="12">${i === 0 ? '출발' : i === points.length - 1 ? '도착' : i}</text>`; }).join('')}
      <text x="12" y="202" fill="#b8cddd" font-size="11">동 → · 남 ↓ | 시드 기반 절차적 가상 협곡 지형</text>
    </svg>
    <p>게이트 통과 공간 진입 · 최저 고도 ${m.course.clearanceFloorM} m 유지 · ${(m.timeoutTicks / m.physicsHz).toFixed(0)}초 이내 · 충돌 금지.
    <strong>완주 시간 단축 및 통과 천장 준수</strong>에 따라 최종 점수가 기록됩니다.</p>`;
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
