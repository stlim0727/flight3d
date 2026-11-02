import '../styles/pilot-arena.css';
import { PilotHost } from '../pilot/PilotHost.js';
import { MissionRunner } from '../arena/MissionRunner.js';
import { PilotMissionAdapter } from '../arena/PilotMissionAdapter.js';
import takeoffSource from '../pilot/examples/takeoff.js?raw';
import landingSource from '../pilot/examples/landing.js?raw';
import valleySource from '../pilot/examples/valley.js?raw';
import { resolvePilotCase } from '../config/pilotCases.js';
import { createRealtimePacer } from '../arena/realtimePacer.js';
import { ValleyScoreboard } from '../arena/ValleyScoreboard.js';
import { valleyBriefingMarkup, valleyNavigationText } from './valleyNavigationView.js';
import { bindPilotPanelInput } from './pilotPanelInput.js';
import { formatPilotScoreData, scoreBannerMarkup, scoreOverlayMarkup, koreanReason } from './pilotScoreView.js';

/** Opt-in local pilot lab. No remote upload and no security sandbox claims. */
export function installPilotArena(sim) {
  const isDevMode = new URLSearchParams(location.search).get('pilotArena') === '1';
  const shell = document.createElement('details');
  shell.id = 'pilot-arena';
  shell.hidden = !isDevMode;
  shell.open = isDevMode && !window.matchMedia('(max-width: 640px)').matches;
  shell.innerHTML = `<summary><span>Pilot · <span data-compact-status>대기 중</span></span><span data-toggle-label>최소화</span></summary>
    <div data-score-banner class="pilot-score-banner" hidden></div>
    <p>본인이 신뢰하는 코드만 실행하세요. 예제는 제한된 물리 테스트를 통과한 실험용이며 결과는 로컬 비랭킹입니다.</p>
    <label>미션 <select data-mission><option value="takeoff-basic-v1">이륙</option><option value="landing-basic-v1">착륙</option><option value="valley-low-v1">F-16 루클라 계곡 로우패스 (고속·저공)</option></select></label>
    <label>조종 <select data-kind><option value="ai">AI</option><option value="human">사람 · F-16 계곡 로우패스</option></select></label>
    <details data-briefing hidden><summary>미션 브리핑 · 항로 지도</summary>${valleyBriefingMarkup()}</details>
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
    <details data-debug><summary>실시간 디버깅 · 로그</summary>
      <pre data-telemetry aria-label="최신 관측과 조종 명령">관측 대기 중</pre>
      <p>코드에서 api.log("메시지") 사용 · 실행당 최대 100개</p>
      <label><input data-follow type="checkbox" checked> 새 로그 따라가기</label>
      <button data-clear-log type="button">로그 지우기</button>
      <pre data-log role="log" aria-label="파일럿 실행 로그" aria-live="off"></pre>
    </details>
    <pre data-result></pre>
    <details><summary>공통 스코어보드 · 로컬 / 비랭킹</summary>
      <p>이 브라우저에 최근 200회 저장합니다. 동일 조건만 비교하며 실패·중단은 순위가 없습니다.</p>
      <p data-storage-status></p><div data-board></div></details>`;
  document.body.append(shell);
  const find = name => shell.querySelector(`[data-${name}]`);
  const updateToggle = () => {
    find('toggle-label').textContent = shell.open ? '− 최소화' : '+ 펼치기';
  };
  shell.addEventListener('toggle', updateToggle);
  updateToggle();
  const navigationHud = document.createElement('pre');
  navigationHud.id = 'valley-navigation';
  navigationHud.hidden = true;
  navigationHud.setAttribute('aria-label', '계곡 미션 공통 항법 보조');
  document.body.append(navigationHud);
  const scoreOverlay = document.createElement('div');
  scoreOverlay.id = 'pilot-score-overlay';
  scoreOverlay.hidden = true;
  scoreOverlay.setAttribute('role', 'dialog');
  scoreOverlay.setAttribute('aria-modal', 'true');
  scoreOverlay.setAttribute('aria-label', '미션 결과 점수');
  document.body.append(scoreOverlay);
  let shownOverlayRecord = null;
  let selectedRetryMode = 'human';
  const scoreboard = new ValleyScoreboard(typeof window !== 'undefined' ? window.localStorage : null);
  let savedRecord = null;
  const hideScoreOverlay = () => { scoreOverlay.hidden = true; };
  const returnToLobbyMenu = () => {
    hideScoreOverlay();
    runner.stop();
    if (isDevMode) {
      shell.open = true;
      updateToggle();
    } else {
      sim.demoDirector?.stop();
      if (typeof sim.gameFlow?.returnToLobby === 'function') {
        sim.gameFlow.returnToLobby(false);
      }
      document.getElementById('btn-fly')?.focus();
    }
  };
  scoreOverlay.addEventListener('click', event => {
    if (event.target.closest('[data-save-callsign]')) {
      const input = scoreOverlay.querySelector('[data-score-callsign]');
      if (input && savedRecord) {
        const newCallsign = scoreboard.saveCallsign(input.value);
        scoreboard.updateCallsign(savedRecord.id, newCallsign);
        renderBoard();
        const missionLabel = find('mission').selectedOptions[0]?.textContent ?? '계곡 미션';
        const refreshed = formatPilotScoreData(shownOverlayRecord, missionLabel, { scoreboard, callsign: newCallsign });
        const modal = scoreOverlay.querySelector('.pilot-score-modal');
        const prevScroll = modal ? modal.scrollTop : scoreOverlay.scrollTop;
        scoreOverlay.innerHTML = scoreOverlayMarkup(refreshed);
        const newModal = scoreOverlay.querySelector('.pilot-score-modal');
        if (newModal) newModal.scrollTop = prevScroll;
        else scoreOverlay.scrollTop = prevScroll;
      }
      return;
    }
    const modeBtn = event.target.closest('[data-score-mode]');
    if (modeBtn) {
      selectedRetryMode = modeBtn.dataset.scoreMode;
      for (const btn of scoreOverlay.querySelectorAll('[data-score-mode]')) {
        const active = btn.dataset.scoreMode === selectedRetryMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-checked', String(active));
      }
      return;
    }
    if (event.target.closest('[data-score-retry]')) {
      hideScoreOverlay();
      const kindSelect = shell.querySelector('[data-kind]');
      if (kindSelect) {
        kindSelect.value = selectedRetryMode;
        kindSelect.dispatchEvent(new Event('change'));
      }
      if (sim.lobby) sim.lobby.pilotMode = selectedRetryMode;
      find('run').click();
      return;
    }
    if (event.target === scoreOverlay || event.target.closest('[data-score-close]')) {
      if (sim.lobby) sim.lobby.pilotMode = selectedRetryMode;
      returnToLobbyMenu();
    }
  });
  scoreOverlay.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-score-callsign]')) {
      scoreOverlay.querySelector('[data-save-callsign]')?.click();
    }
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !scoreOverlay.hidden) {
      returnToLobbyMenu();
    }
  });
  find('score-banner').addEventListener('click', event => {
    if (event.target.closest('[data-banner-retry]')) find('run').click();
  });
  const renderBoard = comparisonKey => {
    const rows = scoreboard.read().filter(r => !comparisonKey || r.comparisonKey === comparisonKey);
    rows.sort((a, b) => {
      const scoreA = a.metrics?.finalScore;
      const scoreB = b.metrics?.finalScore;
      if (scoreA != null && scoreB != null) return scoreB - scoreA;
      if (scoreA != null) return -1;
      if (scoreB != null) return 1;
      return (a.status === 'succeeded' ? a.metrics?.altitudeCostM ?? Infinity : Infinity) -
        (b.status === 'succeeded' ? b.metrics?.altitudeCostM ?? Infinity : Infinity);
    });
    find('board').replaceChildren();
    for (const row of rows) {
      const line = document.createElement('p');
      const speedPart = Number.isFinite(row.metrics?.meanIasKnots) ? `평균 ${Math.round(row.metrics.meanIasKnots)} KT · ` : '';
      const scoreText = row.metrics?.finalScore != null
        ? `${row.metrics.finalScore.toLocaleString('ko-KR')}점`
        : row.metrics?.altitudeCostM != null ? `${row.metrics.altitudeCostM.toFixed(2)} m` : '점수 없음';
      line.textContent = `${row.pilotKind === 'human' ? '사람' : 'AI'} · ${row.status} / ${row.reason} · ` +
        `${scoreText} · ` +
        `${row.durationSeconds.toFixed(1)}초 · ${speedPart}경유지 ${row.metrics.completedGates ?? 0}/${row.metrics.totalGates ?? 6} · ` +
        `${row.conditions.environmentProfile} / seed ${row.conditions.environmentSeed} · ` +
        `${row.conditions.navigationProfile} · ${row.recordedAt}`;
      const detail = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = '조건·AGL·소스 해시';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(row, null, 2);
      detail.append(summary, pre); find('board').append(line, detail);
    }
    find('storage-status').textContent = scoreboard.error ? `저장소 사용 불가: ${scoreboard.error}` :
      comparisonKey ? '현재 실행과 동일한 조건의 기록' : '저장된 모든 조건의 기록 · 서로 다른 조건은 순위 비교 불가';
  };
  renderBoard();
  const logs = [];
  const appendLog = (message, tick = runner.record?.tick ?? 0) => {
    logs.push(`[${(tick / 120).toFixed(1)}s] ${message}`);
    if (logs.length > 200) logs.shift();
    const output = find('log');
    output.textContent = logs.join('\n');
    if (find('follow').checked) output.scrollTop = output.scrollHeight;
  };
  find('clear-log').addEventListener('click', () => { logs.length = 0; find('log').textContent = ''; });
  bindPilotPanelInput(shell, sim.controls);
  const source = find('source');
  source.value = takeoffSource;
  const renderTelemetry = record => {
    if (!record || !find('debug').open) return;
    find('telemetry').textContent = JSON.stringify({
      tick: record.tick,
      observation: record.observations.at(-1),
      appliedCommand: record.commands.at(-1),
      pose: record.poses.at(-1),
    }, null, 2);
  };
  find('debug').addEventListener('toggle', () => renderTelemetry(runner.record));
  let lastStatus = null;
  const runner = sim.pilotArena = new MissionRunner(new PilotMissionAdapter(sim), {
    canAdvance: () => !sim.browserBackgrounded && !sim.gameFlow.isPhysicsFrozen(),
    hostFactory: () => new PilotHost({ onLog: message => appendLog(message) }),
    // One rendered frame per 0.2 simulated seconds keeps this a fast local lab.
    yieldFrame: () => new Promise(resolve => requestAnimationFrame(resolve)),
    onUpdate: record => {
      const active = runner.active;
      const isHuman = record.pilotKind === 'human';
      const pilotTag = isHuman ? '사람' : 'AI';
      const valley = record.manifest?.type === 'valley' || record.manifest?.id?.startsWith('valley-');

      if (!active && savedRecord !== record && valley) {
        savedRecord = record;
        const attempt = scoreboard.add(record, { callsign: scoreboard.getSavedCallsign() });
        record.id = attempt?.id;
        renderBoard(attempt?.comparisonKey);
      }

      const missionLabel = find('mission').selectedOptions[0]?.textContent ?? '계곡 미션';
      const scoreData = !active && record ? formatPilotScoreData(record, missionLabel, { scoreboard }) : null;

      if (active) {
        find('compact-status').textContent = `${pilotTag} · 비행 중 · ${(record.tick / 120).toFixed(1)}초`;
      } else if (scoreData?.hasScore) {
        find('compact-status').textContent = `${pilotTag} · 완주 · 점수 ${scoreData.mainValue}${scoreData.mainUnit} · ${(record.tick / 120).toFixed(1)}초`;
      } else if (scoreData?.isSucceeded) {
        find('compact-status').textContent = `${pilotTag} · 성공 · ${(record.tick / 120).toFixed(1)}초`;
      } else if (scoreData?.isFailed) {
        find('compact-status').textContent = `${pilotTag} · 실패 (${koreanReason(record.reason)}) · ${(record.tick / 120).toFixed(1)}초`;
      } else {
        find('compact-status').textContent = `${pilotTag} · ${record.status} · ${(record.tick / 120).toFixed(1)}초`;
      }

      if (record.status !== lastStatus) {
        appendLog(`[${pilotTag}] ${record.status}${record.reason ? ` · ${koreanReason(record.reason)}` : ''}${record.detail ? ` · ${record.detail}` : ''}`, record.tick);
        lastStatus = record.status;
      }
      renderTelemetry(record);
      for (const name of ['kind', 'run', 'mission', 'environment', 'seed', 'playback', 'file', 'example', 'source']) find(name).disabled = active;
      find('stop').disabled = !active;
      find('save').disabled = active || !record;

      if (scoreData?.hasScore) {
        find('status').textContent = `[${pilotTag}] 완주 · 최종 점수 ${scoreData.mainValue} ${scoreData.mainUnit} · ${(record.tick / 120).toFixed(1)}초 (시뮬레이션 시간)`;
      } else {
        find('status').textContent = `[${pilotTag}] ${record.status} · ${(record.tick / 120).toFixed(1)}초 (시뮬레이션 시간)${record.reason ? ` · ${koreanReason(record.reason)}` : ''}`;
      }

      const scoreBanner = find('score-banner');
      if (!active && scoreData) {
        scoreBanner.className = `pilot-score-banner${scoreData.isFailed ? ' is-failed' : scoreData.isAborted ? ' is-aborted' : ''}`;
        scoreBanner.innerHTML = scoreBannerMarkup(scoreData);
        scoreBanner.hidden = false;
        if ((scoreData.isSucceeded || scoreData.isFailed) && shownOverlayRecord !== record) {
          shownOverlayRecord = record;
          selectedRetryMode = record.pilotKind === 'ai' ? 'ai' : 'human';
          scoreOverlay.innerHTML = scoreOverlayMarkup(scoreData);
          scoreOverlay.hidden = false;
          scoreOverlay.scrollTop = 0;
          const modal = scoreOverlay.querySelector('.pilot-score-modal');
          if (modal) modal.scrollTop = 0;
        }
      } else if (active) {
        scoreBanner.hidden = true;
      }

      if (!active) find('result').textContent = JSON.stringify(record.result?.metrics ?? { detail: record.detail ?? record.reason }, null, 2);
      if (!active) syncMode();
      navigationHud.hidden = !valley || !active;
      if (valley) navigationHud.textContent = valleyNavigationText(record.observations.at(-1)?.observation.navigation);
      const points = record.poses.map(p => `${Math.max(0, Math.min(400, (p.runwayS + (valley ? 0 : 3500)) / (valley ? record.manifest.courseLengthM : 6500) * 400))},${50 + Math.max(-45, Math.min(45, p.centerlineOffsetM * (valley ? 0.1 : 1)))}`).join(' ');
      find('plot').querySelector('polyline').setAttribute('points', points);
    },
  });
  const loadExample = () => { source.value = find('mission').value === 'valley-low-v1' ? valleySource : find('mission').value.startsWith('landing') ? landingSource : takeoffSource; };
  const syncMode = () => {
    const human = find('kind').value === 'human';
    if (human) find('mission').value = 'valley-low-v1';
    find('briefing').hidden = find('mission').value !== 'valley-low-v1';
    if (human) { find('briefing').open = true; find('playback').value = 'realtime'; }
    for (const name of ['playback', 'source', 'example', 'file']) find(name).disabled = human;
  };
  find('kind').addEventListener('change', () => { hideScoreOverlay(); find('score-banner').hidden = true; syncMode(); loadExample(); });
  find('mission').addEventListener('change', () => { hideScoreOverlay(); find('score-banner').hidden = true; syncMode(); loadExample(); });
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
    hideScoreOverlay();
    find('score-banner').hidden = true;
    shownOverlayRecord = null;
    find('result').textContent = '';
    logs.length = 0; find('log').textContent = '';
    find('telemetry').textContent = '관측 대기 중';
    lastStatus = null;
    runner.paceTick = find('kind').value === 'human' || find('playback').value === 'realtime' ? createRealtimePacer() : null;
    if (find('kind').value === 'human' || new URLSearchParams(location.search).get('pilotArena') !== '1') shell.open = false;
    sim.gameFlow.enterFlight();
    if (!source.value && find('kind').value === 'ai') loadExample();
    void runner.start(source.value, { pilotKind: find('kind').value, missionId: find('mission').value,
      environmentProfile: find('environment').value, seed }).catch(error => {
      find('status').textContent = error.message;
    });
  });
  find('stop').addEventListener('click', () => { hideScoreOverlay(); runner.stop(); });
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
    syncMode();
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
