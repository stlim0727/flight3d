import { MissionRunner } from '../arena/MissionRunner.js';
import { SimulatorMissionAdapter } from '../arena/SimulatorMissionAdapter.js';
import takeoffSource from '../pilot/examples/takeoff.js?raw';
import landingSource from '../pilot/examples/landing.js?raw';
import { resolvePilotCase } from '../config/pilotCases.js';
import { createRealtimePacer } from '../arena/realtimePacer.js';
import { bindPilotPanelInput } from './pilotPanelInput.js';

/** Opt-in local pilot lab. No remote upload and no security sandbox claims. */
export function installPilotArena(sim) {
  const shell = document.createElement('details');
  shell.id = 'pilot-arena';
  shell.open = true;
  shell.innerHTML = `<summary>파일럿 아레나 · 실험 기능</summary>
    <p>본인이 신뢰하는 코드만 실행하세요. 예제는 제한된 물리 테스트를 통과한 실험용이며 결과는 로컬 비랭킹입니다.</p>
    <label>미션 <select data-mission><option value="takeoff-basic-v1">이륙</option><option value="landing-basic-v1">착륙</option></select></label>
    <label>환경 <select data-environment><option value="mild-disturbance-v1">약한 측풍·돌풍</option><option value="calm-debug-v1">무풍 · 디버깅</option></select></label>
    <label>시드 <input data-seed type="number" min="0" step="1" value="1"></label>
    <label>재생 속도 <select data-playback><option value="realtime">실시간 · 1배속</option><option value="fast">빠른 평가</option></select></label>
    <label>내 파일럿 파일 <input data-file type="file" accept=".js,.mjs,text/javascript"></label>
    <label>파일럿 코드 <textarea data-source rows="9" spellcheck="false"></textarea></label>
    <button data-example type="button">예제 불러오기</button>
    <button data-run type="button">미션 실행</button>
    <button data-stop type="button" disabled>중지 · 수동 인계</button>
    <button data-save type="button" disabled>실행 기록 저장</button>
    <p data-status role="status">대기 중</p>
    <svg data-plot viewBox="0 0 400 100" role="img" aria-label="활주로 진행 거리와 중심선 오차 궤적"><path d="M0 50H400" stroke="#82909d"/><polyline fill="none" stroke="#63e3b4" stroke-width="2"/></svg>
    <pre data-result></pre>`;
  const style = document.createElement('style');
  style.textContent = `#pilot-arena{position:fixed;right:12px;top:65px;z-index:1200;width:min(400px,calc(100vw - 24px));max-height:80vh;overflow:auto;padding:14px;color:#eef5fb;background:#101e2bf5;border:1px solid #526879;border-radius:10px;font:13px/1.5 system-ui}#pilot-arena summary{cursor:pointer;font-weight:700}#pilot-arena label{display:block;margin:8px 0}#pilot-arena input,#pilot-arena select,#pilot-arena textarea{box-sizing:border-box;max-width:100%}#pilot-arena textarea{display:block;width:100%;font:11px/1.4 monospace;background:#09131c;color:#d6eefb}#pilot-arena button{margin:4px;padding:6px;cursor:pointer}#pilot-arena svg{width:100%;height:90px;background:#071019}#pilot-arena pre{white-space:pre-wrap;overflow-wrap:anywhere}`;
  document.head.append(style);
  document.body.append(shell);
  const find = name => shell.querySelector(`[data-${name}]`);
  bindPilotPanelInput(shell, sim.controls);
  const source = find('source');
  source.value = takeoffSource;
  const runner = sim.pilotArena = new MissionRunner(new SimulatorMissionAdapter(sim), {
    // One rendered frame per 0.2 simulated seconds keeps this a fast local lab.
    yieldFrame: () => new Promise(resolve => requestAnimationFrame(resolve)),
    onUpdate: record => {
      const active = runner.active;
      for (const name of ['run', 'mission', 'environment', 'seed', 'playback', 'file', 'example', 'source']) find(name).disabled = active;
      find('stop').disabled = !active;
      find('save').disabled = active || !record;
      find('status').textContent = `${record.status} · ${(record.tick / 120).toFixed(1)}초 (시뮬레이션 시간)${record.reason ? ` · ${record.reason}` : ''}`;
      if (!active) find('result').textContent = JSON.stringify(record.result?.metrics ?? { detail: record.detail ?? record.reason }, null, 2);
      const points = record.poses.map(p => `${Math.max(0, Math.min(400, (p.runwayS + 3500) / 6500 * 400))},${50 + Math.max(-45, Math.min(45, p.centerlineOffsetM))}`).join(' ');
      shell.querySelector('polyline').setAttribute('points', points);
    },
  });
  const loadExample = () => { source.value = find('mission').value.startsWith('landing') ? landingSource : takeoffSource; };
  find('mission').addEventListener('change', loadExample);
  find('example').addEventListener('click', loadExample);
  find('file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 256 * 1024) { find('status').textContent = '코드 파일은 256 KiB 이하여야 합니다.'; return; }
    source.value = await file.text();
  });
  find('run').addEventListener('click', () => {
    const seed = Number(find('seed').value);
    if (!Number.isSafeInteger(seed) || seed < 0) { find('status').textContent = '시드는 0 이상의 정수여야 합니다.'; return; }
    find('result').textContent = '';
    runner.paceTick = find('playback').value === 'realtime' ? createRealtimePacer() : null;
    sim.gameFlow.enterFlight();
    void runner.start(source.value, { missionId: find('mission').value,
      environmentProfile: find('environment').value, seed }).catch(error => {
      find('status').textContent = error.message;
    });
  });
  find('stop').addEventListener('click', () => runner.stop());
  find('save').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(runner.record, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `pilot-${runner.record.manifest?.id ?? 'run'}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const selected = resolvePilotCase(location.search);
  if (selected) {
    find('mission').value = selected.missionId;
    find('environment').value = selected.environmentProfile;
    find('seed').value = String(selected.seed);
    loadExample();
    find('status').textContent = `${selected.label} · 준비 중`;
    const started = performance.now();
    const startWhenReady = () => {
      if (sim.startupReady && !sim.browserBackgrounded) find('run').click();
      else if (performance.now() - started < 30000) requestAnimationFrame(startWhenReady);
      else find('status').textContent = '시뮬레이터 준비 시간이 초과되었습니다. 준비 후 미션 실행을 눌러주세요.';
    };
    requestAnimationFrame(startWhenReady);
  }
  return runner;
}
