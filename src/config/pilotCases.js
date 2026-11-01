import { FLIGHT_BASE_URL } from './flightUrls.js';

/** Built-in examples only; a link can never supply executable pilot source. */
export function pilotCases() {
  return ['takeoff', 'landing', 'valley'].flatMap(type => {
    const name = type === 'takeoff' ? '이륙' : type === 'landing' ? '착륙' : 'F-16 루클라 계곡 저공';
    const common = type === 'valley' ? { aircraft: 'F16', airport: 'lukla', scenario: 'cruise' } : {};
    return [
    { id: `${type}-calm`, missionId: `${type}-basic-v1`, type,
      ...common, ...(type === 'valley' ? { missionId: 'valley-low-v1' } : {}),
      environmentProfile: 'calm-debug-v1', seed: 1, label: `${name} · 무풍 기준` },
    ...[1, 2, 3, 4, 5].map(seed => ({ id: `${type}-mild-${seed}`, missionId: `${type}-basic-v1`, type,
      ...common, ...(type === 'valley' ? { missionId: 'valley-low-v1' } : {}),
      environmentProfile: 'mild-disturbance-v1', seed,
      label: `${name} · 측풍·돌풍 · seed ${seed}` })),
  ]; });
}

export function resolvePilotCase(search) {
  const id = new URLSearchParams(search).get('pilotCase');
  return pilotCases().find(row => row.id === id) ?? null;
}

export function pilotCaseUrl(row, base = FLIGHT_BASE_URL) {
  const known = pilotCases().find(item => item.id === row.id);
  if (!known) throw new TypeError('Unknown pilot case');
  const url = new URL(base);
  url.search = new URLSearchParams({ aircraft: known.aircraft ?? 'B738', terrain: known.airport ?? 'coastal',
    scenario: known.scenario ?? (known.type === 'takeoff' ? 'runway' : 'approach'), pilotArena: '1', pilotCase: known.id }).toString();
  return url.href;
}
