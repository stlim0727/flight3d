import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';

const outDir = process.env.UI_SCREENSHOTS_DIR
  ? resolve(process.cwd(), process.env.UI_SCREENSHOTS_DIR)
  : resolve(process.cwd(), 'public/screenshots/ui');

await mkdir(outDir, { recursive: true });

const tierArg = process.argv.find(arg => arg.startsWith('--tier=') || arg === '--tier');
const tier = tierArg
  ? (tierArg.includes('=') ? tierArg.split('=')[1] : process.argv[process.argv.indexOf('--tier') + 1])
  : 'all';

console.log(`[capture-all-ui-screens] Target directory: ${outDir} (tier: ${tier})`);

const catalog = [];

async function recordScreen(screenshot, meta) {
  const filePath = `${outDir}/${meta.file}`;
  await screenshot(filePath);
  catalog.push(meta);
  console.log(`✓ [${meta.id}] ${meta.title_ko} (${meta.file})`);
}

await withBrowserSession({ width: 1920, height: 1080, path: '/' }, async ({ evaluate, screenshot, send, delay, origin, exceptions }) => {
  // Wait for simulator to be ready
  for (let i = 0; i < 60; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await delay(300);
  }

  // 1. Startup & Loading Progress Overlay
  await evaluate(() => {
    const el = document.getElementById('startup-overlay');
    el.hidden = false;
    el.style.display = 'flex';
    document.getElementById('startup-status').textContent = '시뮬레이터 준비 중… (고해상도 지형 및 3D 모델 준비 5/6)';
    const prog = document.getElementById('startup-progress');
    prog.max = 6;
    prog.value = 5;
  });
  await delay(200);
  await recordScreen(screenshot, {
    id: '01_startup_loading',
    category: 'lobby',
    file: '01_startup_loading.png',
    title_ko: '시뮬레이터 시작 및 로딩 진행 상태',
    title_en: 'Startup & Loading Progress Overlay',
    description_ko: '초기 시뮬레이터 구동 및 고해상도 지형/3D 기체 에셋 로딩 진행바 오버레이',
    description_en: 'Initial simulator boot and high-resolution 3D asset loading progress overlay',
    selector: '#startup-overlay',
    tier: 'core',
  });
  await evaluate(() => {
    const el = document.getElementById('startup-overlay');
    el.hidden = true;
    el.style.display = 'none';
  });

  // Ensure Lobby is open
  await evaluate(() => {
    window.simulator.gameFlow.returnToLobby();
    window.simulator.syncFlowUi();
    document.querySelector('#lobby-tab-scenario').click();
  });
  await delay(300);

  // 2. Lobby Scenario Tab - Coastal Airport, Boeing 737
  await recordScreen(screenshot, {
    id: '02_lobby_scenario_main',
    category: 'lobby',
    file: '02_lobby_scenario_main.png',
    title_ko: '메인 로비 — 기본 시나리오 탭',
    title_en: 'Main Lobby — Scenario Selection (Default)',
    description_ko: '기본 화면: Coastal Airport, Boeing 737-800, 활주로 이륙 (09L), 시간대 선택 및 디스패치 브리핑 카드',
    description_en: 'Default lobby: Coastal Airport, Boeing 737-800, Runway Takeoff (09L), and dispatch briefing card',
    selector: '#lobby-panel-scenario',
    tier: 'core',
  });

  if (tier === 'all') {
    // 3. Lobby - F-16C Selection
    await evaluate(() => { document.querySelector('#lobby-aircraft-f16')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '03_lobby_scenario_f16',
      category: 'lobby',
      file: '03_lobby_scenario_f16.png',
      title_ko: '메인 로비 — F-16C Fighting Falcon 기종 선택',
      title_en: 'Main Lobby — F-16C Fighting Falcon Aircraft',
      description_ko: '초음속 전투기 제원 배지(최고속도 Mach 2.0+, 추력 대 중량비) 및 브리핑',
      description_en: 'Supersonic fighter jet specifications (Mach 2.0+, T/W ratio) and flight briefing',
      selector: '#lobby-aircraft-f16',
      tier: 'full',
    });

    // 4. Lobby - Cessna 172 Selection
    await evaluate(() => { document.querySelector('#lobby-aircraft-c172')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '04_lobby_scenario_cessna172',
      category: 'lobby',
      file: '04_lobby_scenario_cessna172.png',
      title_ko: '메인 로비 — Cessna 172 Skyhawk 경비행기 선택',
      title_en: 'Main Lobby — Cessna 172 Skyhawk Aircraft',
      description_ko: '단발 프로펠러 경비행기 V-speeds 및 VFR 시각 비행 규칙 브리핑',
      description_en: 'Single-engine propeller aircraft V-speeds and VFR flight briefing',
      selector: '#lobby-aircraft-c172',
      tier: 'full',
    });

    // 5. Lobby - Lukla Airport
    await evaluate(() => { document.querySelector('#lobby-airport-lukla')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '05_lobby_airport_lukla',
      category: 'lobby',
      file: '05_lobby_airport_lukla.png',
      title_ko: '메인 로비 — 루클라 공항 (VNLK) 산악 활주로',
      title_en: 'Main Lobby — Lukla Mountain Airport (VNLK)',
      description_ko: '해발 9,334 FT 고산지대, 12% 경사 단거리 절벽 활주로(Rwy 24) 브리핑',
      description_en: 'Elevation 9,334 FT, 12% sloping short cliff runway (Rwy 24) briefing',
      selector: '#lobby-airport-lukla',
      tier: 'full',
    });

    // 6. Lobby - Incheon Airport
    await evaluate(() => { document.querySelector('#lobby-airport-incheon')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '06_lobby_airport_incheon',
      category: 'lobby',
      file: '06_lobby_airport_incheon.png',
      title_ko: '메인 로비 — 인천국제공항 (RKSI) 해상 활주로',
      title_en: 'Main Lobby — Incheon International Airport (RKSI)',
      description_ko: '인천국제공항 장거리 평행 활주로(33L/33R) 및 해상 접근 브리핑',
      description_en: 'Dual parallel long runways (33L/33R) and oceanic approach briefing',
      selector: '#lobby-airport-incheon',
      tier: 'full',
    });

    // 7. Lobby - Valley Slalom Mode
    await evaluate(() => { document.querySelector('#lobby-airport-valley')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '07_lobby_airport_valley',
      category: 'lobby',
      file: '07_lobby_airport_valley.png',
      title_ko: '메인 로비 — 가상 계곡 슬라롬 조종 방식 선택',
      title_en: 'Main Lobby — Valley Slalom Mode Selection',
      description_ko: '사람 직접 조종 vs AI 자율 비행 라디오 버튼 및 자이로 사전 점검 박스',
      description_en: 'Human manual piloting vs. AI autonomous flight radio controls and gyro preflight',
      selector: '#lobby-airport-valley',
      tier: 'full',
    });
  }

  // 8. Lobby Settings Tab - Graphics
  await evaluate(() => { document.querySelector('#lobby-tab-settings')?.click(); });
  await delay(300);
  await recordScreen(screenshot, {
    id: '08_lobby_settings_graphics',
    category: 'lobby',
    file: '08_lobby_settings_graphics.png',
    title_ko: '메인 로비 — 설정 탭 (그래픽 렌더 품질)',
    title_en: 'Main Lobby — Settings Tab (Graphics Quality)',
    description_ko: '렌더 품질 프리셋(Low/Med/High/Ultra), UI 배율, 조종 감도 옵션',
    description_en: 'Render Quality presets (Low/Med/High/Ultra), UI scaling, and flight controls',
    selector: '#lobby-panel-settings',
    tier: 'core',
  });

  if (tier === 'all') {
    // 9. Lobby Settings Tab - Audio & Language
    await evaluate(() => {
      const panels = document.querySelector('.lobby-panels');
      if (panels) panels.scrollTop = panels.scrollHeight;
    });
    await delay(200);
    await recordScreen(screenshot, {
      id: '09_lobby_settings_audio_language',
      category: 'lobby',
      file: '09_lobby_settings_audio_language.png',
      title_ko: '메인 로비 — 설정 탭 (음량 및 다국어 언어 변경)',
      title_en: 'Main Lobby — Settings (Audio & Language)',
      description_ko: '엔진 음량, 지상 마찰음 슬라이더, 조종 감도 및 한국어/English 언어 토글',
      description_en: 'Engine volume, ground acoustics sliders, sensitivity, and Korean/English switch',
      selector: '#lobby-settings',
      tier: 'full',
    });

    // 10. Lobby Developer Mode Tab
    await evaluate(() => {
      const devCheck = document.querySelector('#dev-enabled');
      if (devCheck) {
        devCheck.checked = true;
        devCheck.dispatchEvent(new Event('change'));
      }
      const devTab = document.querySelector('#lobby-tab-dev');
      if (devTab) {
        devTab.hidden = false;
        devTab.click();
      }
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '10_lobby_developer_tab',
      category: 'lobby',
      file: '10_lobby_developer_tab.png',
      title_ko: '메인 로비 — 개발자 탭 (Dev Scenarios & Flags)',
      title_en: 'Main Lobby — Developer Tab',
      description_ko: 'Dev Scenarios, 실시간 디버그 플래그, 빌드 커밋 정보 및 렌더링 진단기',
      description_en: 'Dev scenarios, realtime debug flags, build commit diagnostics, and visual trials',
      selector: '#lobby-panel-dev',
      tier: 'full',
    });
  }

  // Switch to Coastal runway with Boeing 737 and enter flight!
  await evaluate(() => {
    document.querySelector('#lobby-tab-scenario')?.click();
    document.querySelector('#lobby-airport-coastal')?.click();
    document.querySelector('#lobby-aircraft-b738')?.click();
    document.querySelector('#lobby-preset-rwy')?.click();
  });
  await delay(200);

  await evaluate(async () => {
    await window.simulator.fly();
    window.simulator.cameraSystem.setMode(0, true);
  });
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(() => Boolean(
      window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded &&
      window.simulator?.cameraSystem?.mode === 0
    ));
    if (ready) break;
    await delay(200);
  }
  await delay(400);

  // 11. In-Flight Cockpit View
  await evaluate(() => { window.simulator.controls.onSelectCamera(0); });
  await delay(400);
  await recordScreen(screenshot, {
    id: '11_flight_cockpit_view_b738',
    category: 'flight',
    file: '11_flight_cockpit_view_b738.png',
    title_ko: '비행 화면 — 보잉 737-800 콕핏 뷰',
    title_en: 'In-Flight Cockpit View (Boeing 737-800)',
    description_ko: '보잉 737 조종석 계기판 (PFD, ND, EICAS, MCP, ISFD, CDU) 및 상단 HUD 텔레메트리 리본',
    description_en: 'Glass cockpit avionics (PFD, ND, EICAS, MCP, ISFD, CDU) and top telemetry HUD ribbon',
    selector: '#hud-overlay',
    tier: 'core',
  });

  // 12. Autopilot Bar Expanded
  await evaluate(() => {
    const apPanel = document.getElementById('ap-panel');
    const apBar = document.getElementById('ap-bar');
    if (apPanel) apPanel.hidden = false;
    if (apBar) apBar.classList.remove('ap-collapsed');
    const apToggle = document.getElementById('btn-ap-toggle');
    if (apToggle) apToggle.setAttribute('aria-expanded', 'true');
  });
  await delay(300);
  await recordScreen(screenshot, {
    id: '12_flight_autopilot_expanded',
    category: 'flight',
    file: '12_flight_autopilot_expanded.png',
    title_ko: '비행 화면 — 오토파일럿(AP) 바 확장 상태',
    title_en: 'In-Flight Autopilot Bar (Expanded)',
    description_ko: '오토파일럿 바 확장: AP Master, HDG 헤딩, ALT 고도, SPD 속도, APP ILS 접근 모드',
    description_en: 'Autopilot master, HDG heading hold, ALT altitude, SPD speed, and APP localizer modes',
    selector: '#ap-bar',
    tier: 'core',
  });

  if (tier === 'all') {
    // 13. Chase Camera
    await evaluate(() => { window.simulator.controls.onSelectCamera(1); });
    await delay(400);
    await recordScreen(screenshot, {
      id: '13_flight_camera_chase',
      category: 'flight',
      file: '13_flight_camera_chase.png',
      title_ko: '비행 화면 — 3인칭 기체 추적(Chase) 카메라',
      title_en: 'In-Flight Chase Camera (3rd Person)',
      description_ko: '항공기 후방 3인칭 추적 카메라: 기체 3D 모델 및 주변 해안 지형 조망',
      description_en: 'Exterior 3rd-person follow camera tracking aircraft over coastal terrain',
      selector: '#canvas-container',
      tier: 'full',
    });

    // 14. Wing Camera
    await evaluate(() => { window.simulator.controls.onSelectCamera(2); });
    await delay(400);
    await recordScreen(screenshot, {
      id: '14_flight_camera_wing',
      category: 'flight',
      file: '14_flight_camera_wing.png',
      title_ko: '비행 화면 — 주익(Wing) 승객 시점 카메라',
      title_en: 'In-Flight Passenger Wing Camera',
      description_ko: '주익 승객 시점 카메라: 엔진 나셀과 플랩, 날개 시야 확보',
      description_en: 'Cabin window view over the wing, engine nacelle, and trailing flaps',
      selector: '#canvas-container',
      tier: 'full',
    });

    // 15. Tower Camera
    await evaluate(() => { window.simulator.controls.onSelectCamera(3); });
    await delay(400);
    await recordScreen(screenshot, {
      id: '15_flight_camera_tower',
      category: 'flight',
      file: '15_flight_camera_tower.png',
      title_ko: '비행 화면 — 관제탑(Tower) 조망 카메라',
      title_en: 'In-Flight Airport Tower Camera',
      description_ko: '관제탑 조망 카메라: 활주로와 공항 전경을 배경으로 기체 포커스',
      description_en: 'Airport control tower view tracking aircraft departure across airfield',
      selector: '#canvas-container',
      tier: 'full',
    });

    // 16. Mobile Touch Controls
    await evaluate(() => {
      window.simulator.controls.onSelectCamera(0);
      document.body.classList.add('touch-controls-active');
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '16_flight_mobile_touch_controls',
      category: 'flight',
      file: '16_flight_mobile_touch_controls.png',
      title_ko: '비행 화면 — 모바일 터치 조종 UI 오버레이',
      title_en: 'Mobile Touch Controls UI Overlay',
      description_ko: '가상 비행 조종간(Stick), 수직 스로틀 바, 좌우 러더 페달 및 플랩 제어',
      description_en: 'Virtual flight stick, vertical throttle slider, rudder control pedals, and flap buttons',
      selector: '#hud-overlay',
      tier: 'full',
    });
    await evaluate(() => { document.body.classList.remove('touch-controls-active'); });

    // 17. Stall Warning Banner
    await evaluate(() => {
      const stall = document.getElementById('hud-stall');
      if (stall) { stall.classList.add('active'); stall.style.display = 'block'; }
    });
    await delay(200);
    await recordScreen(screenshot, {
      id: '17_flight_stall_warning',
      category: 'flight',
      file: '17_flight_stall_warning.png',
      title_ko: '비행 화면 — 실속(Stall) 경고 배너',
      title_en: 'In-Flight Stall Warning Banner',
      description_ko: '한계 받음각 초과 시 상단에 점멸하는 고시인성 실속(STALL) 경고 배너',
      description_en: 'Flashing high-visibility aerodynamic stall warning banner',
      selector: '#hud-stall',
      tier: 'full',
    });
    await evaluate(() => {
      const stall = document.getElementById('hud-stall');
      if (stall) { stall.classList.remove('active'); stall.style.display = 'none'; }
    });
  }

  // 18. Pause Menu Overlay
  await evaluate(() => {
    window.simulator.gameFlow.pause();
    window.simulator.syncFlowUi();
  });
  await delay(300);
  await recordScreen(screenshot, {
    id: '18_pause_menu_modal',
    category: 'modal',
    file: '18_pause_menu_modal.png',
    title_ko: '일시정지 메뉴 (Pause Menu)',
    title_en: 'Pause Menu Overlay',
    description_ko: 'ESC 키 일시정지 메뉴: 비행 계속하기, 재시작, 메인 메뉴, 비행 가이드 모달 연결',
    description_en: 'In-flight pause menu: Resume, Restart, Main Menu, and Flight Guide actions',
    selector: '#pause-menu',
    tier: 'core',
  });

  // 19. Flight Guide Modal
  await evaluate(() => {
    const helpModal = document.getElementById('help-modal');
    if (helpModal) helpModal.classList.add('visible');
  });
  await delay(300);
  await recordScreen(screenshot, {
    id: '19_flight_guide_modal',
    category: 'modal',
    file: '19_flight_guide_modal.png',
    title_ko: '비행 도움말 모달 (Flight Guide)',
    title_en: 'Flight Guide & Keybindings Modal',
    description_ko: '키보드 단축키, 조종간 키 매핑, 콕핏 6대 계기 판독법, 오토파일럿 설명',
    description_en: 'Keyboard shortcuts, flight controls reference, instrument guide, and autopilot instructions',
    selector: '#help-modal',
    tier: 'core',
  });
  await evaluate(() => {
    const helpModal = document.getElementById('help-modal');
    if (helpModal) helpModal.classList.remove('visible');
  });

  if (tier === 'all') {
    // 20. Multiplayer Host Modal
    await evaluate(() => {
      const mpDialog = document.getElementById('mp-dialog');
      if (mpDialog) { mpDialog.showModal(); document.querySelector('#mp-choose-host')?.click(); }
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '20_multiplayer_host_modal',
      category: 'modal',
      file: '20_multiplayer_host_modal.png',
      title_ko: '멀티플레이어 대화상자 — 방 만들기(Host)',
      title_en: 'Multiplayer Setup Dialog (Host Room)',
      description_ko: 'P2P WebRTC 멀티플레이어: 파일럿 호출부호, 공항/기종/시나리오 선택 및 방 생성',
      description_en: 'P2P WebRTC multiplayer host room setup: nickname, airport, aircraft, and scenario',
      selector: '#mp-dialog',
      tier: 'full',
    });

    // 21. Multiplayer Join Modal
    await evaluate(() => { document.querySelector('#mp-choose-join')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '21_multiplayer_join_modal',
      category: 'modal',
      file: '21_multiplayer_join_modal.png',
      title_ko: '멀티플레이어 대화상자 — 방 참여(Join)',
      title_en: 'Multiplayer Setup Dialog (Join Room)',
      description_ko: '멀티플레이어 참여 모드: 룸 초대 코드 입력 및 세션 참가 인터페이스',
      description_en: 'Multiplayer join room mode: invite room code input and connection control',
      selector: '#mp-dialog',
      tier: 'full',
    });
    await evaluate(() => {
      const mpDialog = document.getElementById('mp-dialog');
      if (mpDialog && mpDialog.open) mpDialog.close();
    });

    // 22. Joystick Calibration Dialog
    await evaluate(() => { window.simulator.openJoystickCheckDialog(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '22_joystick_calibration_dialog',
      category: 'modal',
      file: '22_joystick_calibration_dialog.png',
      title_ko: '조이스틱 / HOTAS 캘리브레이션 대화상자',
      title_en: 'Joystick / HOTAS Calibration Dialog',
      description_ko: '물리 하드웨어 조이스틱/스로틀 감지, 실시간 축 게이지, 데드존 조정 및 버튼 테스트',
      description_en: 'Hardware joystick/throttle detection, realtime axis meters, deadzone sliders, and button test',
      selector: '#joystick-dialog',
      tier: 'full',
    });
    await evaluate(() => { window.simulator.joystickDialog?.close(); });

    // 23. Feedback Dialog
    await evaluate(() => { window.simulator.openFeedbackDialog(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '23_feedback_bug_report_dialog',
      category: 'modal',
      file: '23_feedback_bug_report_dialog.png',
      title_ko: '사용자 의견 및 버그 제보 모달',
      title_en: 'User Feedback & Bug Report Modal',
      description_ko: '비행 피드백/버그 제보: 실시간 기체 상태, 텔레메트리, 브라우저 스펙 JSON 자동 첨부',
      description_en: 'User feedback and bug report modal with auto-collected flight state telemetry JSON',
      selector: '#feedback-dialog-overlay',
      tier: 'full',
    });
    await evaluate(() => {
      const fb = document.getElementById('feedback-dialog-overlay');
      if (fb) fb.hidden = true;
    });

    // 24. Render Diagnostics Inspector
    await evaluate(() => {
      const diag = document.getElementById('diagnostics-panel');
      if (diag) diag.classList.add('visible');
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '24_render_diagnostics_inspector',
      category: 'modal',
      file: '24_render_diagnostics_inspector.png',
      title_ko: '실시간 렌더링 성능 진단 패널 (Diagnostics)',
      title_en: 'Real-time Render Diagnostics Inspector',
      description_ko: '실시간 렌더링 성능 진단: FPS, 드로우콜, 트라이앵글 수, 텍스처/지오메트리, 물리 Hz',
      description_en: 'Real-time WebGL performance metrics: FPS, draw calls, triangles, memory, and physics timing',
      selector: '#diagnostics-panel',
      tier: 'full',
    });
    await evaluate(() => {
      const diag = document.getElementById('diagnostics-panel');
      if (diag) diag.classList.remove('visible');
    });

    // 25. ATC Voice Challenge
    await evaluate(() => {
      window.simulator.voiceChallengeOverlay?.show({
        options: [
          { id: 'optA', tag: 'A', primary: 'Incheon Tower, HL7380 ready for departure runway 33L', secondary: '인천 타워, HL7380 33L 이륙 준비 완료' },
          { id: 'optB', tag: 'B', primary: 'Hold short runway 33L, HL7380', secondary: '33L 대기선 정지, HL7380' }
        ]
      });
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '25_atc_voice_challenge_overlay',
      category: 'modal',
      file: '25_atc_voice_challenge_overlay.png',
      title_ko: 'ATC 음성 관제 챌린지 오버레이',
      title_en: 'ATC Voice Radio Challenge Overlay',
      description_ko: '음성 관제 챌린지: 마이크 음성 인식, 관제 무전 대화 선택지(A/B), 발음 일치 점수 게이지',
      description_en: 'ATC voice recognition prompt with radio speech options (A/B) and pronunciation match score meter',
      selector: '#voice-challenge-overlay',
      tier: 'full',
    });
    await evaluate(() => {
      const el = document.getElementById('voice-challenge-overlay');
      if (el) el.style.display = 'none';
    });

    // 26. Cockpit Shadow Study Demo
    await evaluate(() => {
      const demo = document.getElementById('shadow-demo');
      if (demo) {
        demo.hidden = false;
        document.getElementById('shadow-status').textContent = '태양 방위각 180° · 고도 45° (정오 콕핏 그림자 분석 중)';
      }
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '26_cockpit_shadow_study_demo',
      category: 'modal',
      file: '26_cockpit_shadow_study_demo.png',
      title_ko: '콕핏 태양광 및 그림자 분석 데모 툴바',
      title_en: 'Cockpit Sunlight & Shadow Study Demo',
      description_ko: '콕핏 태양광 각도 및 캐노피 프레임 그림자 전이 스터디 제어 툴바',
      description_en: 'Cockpit sun azimuth and canopy shadow study progression control bar',
      selector: '#shadow-demo',
      tier: 'full',
    });
    await evaluate(() => {
      const demo = document.getElementById('shadow-demo');
      if (demo) demo.hidden = true;
    });

    // 27. Demo Restart Dialog
    await evaluate(() => {
      const dlg = document.getElementById('demo-restart-dialog');
      if (dlg) dlg.hidden = false;
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '27_demo_restart_dialog',
      category: 'modal',
      file: '27_demo_restart_dialog.png',
      title_ko: '데모 자동 재시작 확인 대화상자',
      title_en: 'Demo Automatic Restart Confirmation Dialog',
      description_ko: '데모 비행 완료 후 자동 순환 재시작 여부를 묻는 확인 대화상자',
      description_en: 'Modal dialog prompt for automatic cyclical demo flight restart',
      selector: '#demo-restart-dialog',
      tier: 'full',
    });
    await evaluate(() => {
      const dlg = document.getElementById('demo-restart-dialog');
      if (dlg) dlg.hidden = true;
    });
  }

  // Resume flight and trigger debriefs
  await evaluate(() => { window.simulator.gameFlow.resume(); });
  await delay(200);

  // 28. Debrief Overlay - Summary Tab
  await evaluate(() => {
    const mockReport = {
      sufficient: true,
      metadata: { airport: 'coastal', aircraft: 'B738', scenario: 'rwy' },
      durationSec: 184.2,
      reason: 'manual',
      crash: null,
      peaks: { altitudeFt: { altitudeFt: 3500 }, iasKnots: { iasKnots: 245 }, gForce: { gForce: 1.15 } },
      touchdowns: [{ sinkRateFpm: -140, contactG: 1.08 }],
      samples: Array.from({ length: 50 }, (_, i) => ({ timeSec: i * 3.6, altitudeFt: Math.sin(i / 10) * 3000 + 500 }))
    };
    window.simulator.debriefReport = mockReport;
    window.simulator.debriefReplay = { durationSec: 184.2, frames: [] };
    window.simulator.gameFlow.endFlight();
    window.simulator.debriefOverlay.show(mockReport, window.simulator.debriefReplay);
    document.querySelector('#debrief-tab-summary')?.click();
  });
  await delay(300);
  await recordScreen(screenshot, {
    id: '28_debrief_flight_summary',
    category: 'debrief',
    file: '28_debrief_flight_summary.png',
    title_ko: '디브리프 — 비행 종합 요약 탭',
    title_en: 'Debrief Overlay — Flight Summary Tab',
    description_ko: '비행 종합 결과: 총 비행 시간, 최고 도달 고도, 최고 대기속도, 최대 하중(G-Force)',
    description_en: 'Flight summary: duration, peak altitude, top airspeed, and maximum G-force',
    selector: '#debrief-overlay',
    tier: 'core',
  });

  if (tier === 'all') {
    // 29. Debrief - Touchdown Evaluation
    await evaluate(() => {
      const mockLandingReport = {
        sufficient: true,
        metadata: { airport: 'coastal', aircraft: 'B738', scenario: 'app' },
        durationSec: 120.0,
        reason: 'landed',
        crash: null,
        peaks: { altitudeFt: { altitudeFt: 1500 }, iasKnots: { iasKnots: 142 }, gForce: { gForce: 1.12 } },
        touchdowns: [{ sinkRateFpm: -95, contactG: 1.05 }],
        samples: Array.from({ length: 40 }, (_, i) => ({ timeSec: i * 3, altitudeFt: Math.max(0, 1500 - i * 38) }))
      };
      window.simulator.debriefReport = mockLandingReport;
      window.simulator.debriefOverlay.show(mockLandingReport, window.simulator.debriefReplay);
      document.querySelector('#debrief-tab-summary')?.click();
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '29_debrief_landing_touchdown',
      category: 'debrief',
      file: '29_debrief_landing_touchdown.png',
      title_ko: '디브리프 — 터치다운 정밀 착륙 평가 점수',
      title_en: 'Debrief Overlay — Touchdown Landing Score',
      description_ko: '정밀 착륙 평가: 접지 시 강하율(-95 FPM), 접지 하중(1.05 G), 버터 랜딩 등급',
      description_en: 'Precision touchdown landing rating: sink rate (-95 FPM) and touchdown G (1.05 G)',
      selector: '#debrief-overlay',
      tier: 'full',
    });

    // 30. Debrief - Record Chart
    await evaluate(() => { document.querySelector('#debrief-tab-record')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '30_debrief_flight_record_chart',
      category: 'debrief',
      file: '30_debrief_flight_record_chart.png',
      title_ko: '디브리프 — 비행 기록 탭 (SVG 고도 차트)',
      title_en: 'Debrief Overlay — Flight Record Chart (SVG)',
      description_ko: '비행 고도 프로파일 SVG 곡선 차트, 타임라인 스크러버 및 주요 비행 이벤트 마커',
      description_en: 'Flight altitude profile SVG curve chart, time scrubber, and flight event markers',
      selector: '#debrief-record',
      tier: 'full',
    });

    // 31. Debrief - Share Report Tab
    await evaluate(() => { document.querySelector('#debrief-tab-share')?.click(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '31_debrief_flight_share_report',
      category: 'debrief',
      file: '31_debrief_flight_share_report.png',
      title_ko: '디브리프 — 보고서 공유 및 리플레이 저장 탭',
      title_en: 'Debrief Overlay — Share Report Tab',
      description_ko: '텍스트 형식 비행 결과지 프리뷰, 클립보드 복사, 파일 내보내기 및 리플레이 저장',
      description_en: 'Text format debrief preview, copy to clipboard, export, and save replay actions',
      selector: '#debrief-share',
      tier: 'full',
    });

    // 32. Debrief - Crash Investigation
    await evaluate(() => {
      const mockCrashReport = {
        sufficient: true,
        metadata: { airport: 'lukla', aircraft: 'B738', scenario: 'rwy' },
        durationSec: 42.5,
        reason: 'crash',
        crash: { name: '산악 지형 충돌', type: 'terrain', speedKnots: 168, timeSec: 42.5 },
        peaks: { altitudeFt: { altitudeFt: 9200 }, iasKnots: { iasKnots: 168 }, gForce: { gForce: 4.8 } },
        touchdowns: [],
        samples: Array.from({ length: 30 }, (_, i) => ({ timeSec: i * 1.4, altitudeFt: 9100 + i * 5 }))
      };
      window.simulator.debriefReport = mockCrashReport;
      window.simulator.debriefOverlay.show(mockCrashReport, window.simulator.debriefReplay);
      document.querySelector('#debrief-tab-summary')?.click();
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '32_debrief_crash_report',
      category: 'debrief',
      file: '32_debrief_crash_report.png',
      title_ko: '디브리프 — 지형 충돌 사고 분석 보고서',
      title_en: 'Debrief Overlay — Crash Investigation Report',
      description_ko: '기체 파손/지형 충돌 사고 분석: 충돌 지점, 충돌 속도, 기체 구조 분해 보고서',
      description_en: 'Structural crash report: collision target, speed at impact, and damage breakdown',
      selector: '#debrief-crash',
      tier: 'full',
    });
  }

  // Hide debrief and return flow to flight
  await evaluate(() => {
    window.simulator.gameFlow.enterFlight();
    window.simulator.syncFlowUi();
    const debrief = document.getElementById('debrief-overlay');
    if (debrief) debrief.classList.remove('visible');
  });

  // 33. Replay Controls Panel
  await evaluate(() => {
    const rp = document.getElementById('replay-panel');
    rp.hidden = false;
    document.body.classList.add('replaying');
    const seek = rp.querySelector('[data-seek]');
    if (seek) { seek.max = 180; seek.value = 65; }
    const time = rp.querySelector('[data-time]');
    if (time) time.textContent = '01:05 / 03:00';
  });
  await delay(300);
  await recordScreen(screenshot, {
    id: '33_flight_replay_controls_panel',
    category: 'replay',
    file: '33_flight_replay_controls_panel.png',
    title_ko: '비행 리플레이 제어 패널 (Replay Transport)',
    title_en: 'Flight Replay Transport Controls Panel',
    description_ko: '하단 리플레이 제어 바: 재생/일시정지, 0.25x~4x 배속, 타임라인 시크, 8종 카메라 전환',
    description_en: 'Replay transport bar: play/pause, 0.25x-4x speed presets, timeline seek, and cameras',
    selector: '#replay-panel',
    tier: 'core',
  });

  if (tier === 'all') {
    // 34. Replay Library Modal
    await evaluate(() => { window.simulator.replayPanel?.openLibrary(); });
    await delay(300);
    await recordScreen(screenshot, {
      id: '34_replay_library_modal',
      category: 'replay',
      file: '34_replay_library_modal.png',
      title_ko: '비행 기록 보관함 모달 (Replay Library)',
      title_en: 'Flight Replay Library Modal',
      description_ko: '비행 기록 보관함: 로컬 저장된 소티 목록, 날짜/비행시간, 다시보기 재생 및 JSON 내보내기',
      description_en: 'Replay library modal: stored sorties list, dates, flight durations, watch, and JSON export',
      selector: '#replay-library',
      tier: 'full',
    });
    await evaluate(() => {
      window.simulator.replayPanel?.closeLibrary();
      document.getElementById('replay-panel').hidden = true;
      document.body.classList.remove('replaying');
    });

    // 35. Pilot Mission Score Modal
    await evaluate(() => {
      let overlay = document.getElementById('pilot-score-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pilot-score-overlay';
        overlay.className = 'pilot-score-overlay';
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = `
        <div class="pilot-score-modal">
          <button type="button" class="btn-score-lobby" data-score-close aria-label="메인 메뉴" title="메인 메뉴">
            <span class="score-back-glyph" aria-hidden="true">↩</span>
            <span class="score-back-caption">메인 메뉴</span>
          </button>
          <button type="button" class="btn-modal-close" data-score-close aria-label="닫기">×</button>
          <span class="modal-badge">🏆 임무 완주 (MISSION ACCOMPLISHED)</span>
          <div class="modal-mission-title">F-16 가상 계곡 슬라롬 · 사람 직접 조종</div>
          <div class="modal-score-box">
            <div class="modal-score-label">최종 완주 시간</div>
            <div class="modal-score-value">104.8<span class="modal-score-unit">초</span></div>
            <div class="modal-score-sub">평균 대지속도 562 KT · 최저 통과 고도 24 m</div>
          </div>
          <div class="modal-stats-grid">
            <div class="modal-stat-item"><span class="modal-stat-name">평균 비행 고도</span><strong class="modal-stat-value">32.4 m</strong></div>
            <div class="modal-stat-item"><span class="modal-stat-name">웨이포인트 통과</span><strong class="modal-stat-value">12 / 12</strong></div>
            <div class="modal-stat-item"><span class="modal-stat-name">최대 가속도</span><strong class="modal-stat-value">7.82 G</strong></div>
            <div class="modal-stat-item"><span class="modal-stat-name">항로 편차</span><strong class="modal-stat-value">±18 m</strong></div>
          </div>
          <div class="modal-callsign-box">
            <label class="modal-callsign-label" for="score-callsign-input">🎖️ 파일럿 콜사인 (CALLSIGN)</label>
            <div class="modal-callsign-row">
              <input id="score-callsign-input" type="text" class="input-callsign" maxlength="8" value="MAVERICK" readonly />
              <button type="button" class="btn-save-callsign">등록됨</button>
            </div>
          </div>
          <div class="modal-leaderboard">
            <div class="leaderboard-header"><span>🏆 글로벌 계곡 슬라롬 순위표 (TOP 5)</span></div>
            <div class="leaderboard-table">
              <div class="leaderboard-row is-me"><span class="lb-rank">#1</span><span class="lb-callsign">MAVERICK <small>(사람)</small></span><span class="lb-time">104.8초</span></div>
              <div class="leaderboard-row"><span class="lb-rank">#2</span><span class="lb-callsign">VIPER <small>(사람)</small></span><span class="lb-time">106.2초</span></div>
              <div class="leaderboard-row"><span class="lb-rank">#3</span><span class="lb-callsign">AI_AGENT_V2 <small>(AI)</small></span><span class="lb-time">108.5초</span></div>
              <div class="leaderboard-row"><span class="lb-rank">#4</span><span class="lb-callsign">ROOSTER <small>(사람)</small></span><span class="lb-time">109.1초</span></div>
              <div class="leaderboard-row"><span class="lb-rank">#5</span><span class="lb-callsign">PHOENIX <small>(사람)</small></span><span class="lb-time">111.4초</span></div>
            </div>
          </div>
        </div>
      `;
      overlay.style.display = 'block';
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '35_pilot_mission_score_modal',
      category: 'pilot',
      file: '35_pilot_mission_score_modal.png',
      title_ko: '파일럿 아레나 — 미션 완료 스코어카드 및 글로벌 순위표',
      title_en: 'Pilot Arena — Mission Scorecard & Global Leaderboard',
      description_ko: '계곡 슬라롬 완료 스코어카드: 최종 완주 시간, 통과 고도, 콜사인 등록 및 TOP 5 랭킹',
      description_en: 'Valley slalom score overlay: completion time, flight stats, callsign registration, and leaderboard',
      selector: '.pilot-score-modal',
      tier: 'full',
    });
    await evaluate(() => {
      const overlay = document.getElementById('pilot-score-overlay');
      if (overlay) overlay.style.display = 'none';
    });

    // 36. Standalone Flights URL Selection Page (flights.html)
    await send('Page.navigate', { url: `${origin}/flights.html` });
    await delay(600);
    await recordScreen(screenshot, {
      id: '36_standalone_flights_html',
      category: 'standalone',
      file: '36_standalone_flights_html.png',
      title_ko: '독립 페이지 — 비행 URL 및 기종/지형/시나리오 조합 선택기',
      title_en: 'Standalone Tool — Flight URL Direct Launcher (flights.html)',
      description_ko: '모든 공항·기종·시나리오 유효 조합을 필터링하여 바로가기 링크 생성',
      description_en: 'Combinatorial flight link generator by terrain, aircraft, and scenario parameters',
      selector: 'body',
      tier: 'full',
    });

    // 37. Standalone Incheon 3D Layout Preview Page (incheon.html)
    await send('Page.navigate', { url: `${origin}/incheon.html` });
    await delay(1200);
    await recordScreen(screenshot, {
      id: '37_standalone_incheon_html',
      category: 'standalone',
      file: '37_standalone_incheon_html.png',
      title_ko: '독립 페이지 — 인천공항·영종도 3D 실제 배치 모형 뷰어',
      title_en: 'Standalone Tool — Incheon 3D Layout Preview (incheon.html)',
      description_ko: '인천공항 및 영종도 3D 실제 건물, 도로, 녹지 레이아웃 프리뷰 페이지',
      description_en: 'Real layout 3D preview of Incheon Airport & Yeongjongdo with viewpoint buttons',
      selector: 'body',
      tier: 'full',
    });
  }

  assert.equal(exceptions.length, 0, `Uncaught browser exceptions: ${exceptions.join('; ')}`);
});

if (tier === 'all') {
  // 38. AI Pilot Lab Arena Panel (?pilotArena=1)
  await withBrowserSession({ width: 1920, height: 1080, path: '/?pilotArena=1&airport=valley&aircraft=F16' }, async ({ evaluate, screenshot, delay, exceptions }) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
      await delay(300);
    }
    await delay(800);
    await evaluate(() => {
      const arena = document.getElementById('pilot-arena');
      if (arena) arena.open = true;
      const btnEx = document.querySelector('#pilot-arena [data-example]');
      if (btnEx) btnEx.click();
    });
    await delay(300);
    await recordScreen(screenshot, {
      id: '38_pilot_arena_panel',
      category: 'pilot',
      file: '38_pilot_arena_panel.png',
      title_ko: 'AI 파일럿 랩 — 계곡 저공 비행 자율 비행 알고리즘 패널',
      title_en: 'AI Pilot Lab Arena — Autonomous Flight Algorithm Panel',
      description_ko: 'AI 자율 비행 코드 에디터, 실시간 경로 오차 SVG 플롯, 관측/로그 모니터',
      description_en: 'Autonomous flight script editor, real-time trajectory deviation SVG plot, and live logger',
      selector: '#pilot-arena',
      tier: 'full',
    });

    assert.equal(exceptions.length, 0, `Uncaught browser exceptions in pilot arena: ${exceptions.join('; ')}`);
  });
}

console.log(`[capture-all-ui-screens] Finished. Total captured: ${catalog.length} screens.`);
await writeFile(`${outDir}/catalog.json`, JSON.stringify(catalog, null, 2));
