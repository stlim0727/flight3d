/**
 * @file JoystickCheckDialog.js
 * @description Real-time Joystick & HOTAS Input Check and Calibration Dialog.
 * Allows pilots to verify device connectivity, resolve mapping mismatches (e.g. T.Flight Hotas One PC vs Xbox modes),
 * inspect live axis meters and button activations, invert throttle/pitch, and configure deadzones.
 */
import { t, translateDOM } from '../i18n/index.js';
import { saveSimulatorPreferences } from '../config/simulatorPreferences.js';

export class JoystickCheckDialog {
  constructor(simulator) {
    this.sim = simulator;
    this.dialog = null;
    this.isOpen = false;
    this.rafId = null;
    this.storage = simulator?.storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);

    this.wizardActive = false;
    this.wizardStep = 0;
    this.wizardBaseline = null;
    this.wizardCandidate = null;
    this.wizardExtremes = {};
    this.wizardMapping = {
      rollAxis: null,
      rollInverted: false,
      pitchAxis: null,
      pitchInverted: false,
      throttleAxis: null,
      throttleIdleVal: null,
      throttleMaxVal: null,
      throttleInverted: false,
      rudderAxis: null,
      rudderInverted: false,
      brakesButton: 0,
      brakesAxis: null,
    };

    this.createDOM();
    this.initListeners();
  }

  get hotas() {
    return this.sim?.controls?.hotas || null;
  }

  createDOM() {
    if (typeof document === 'undefined') return;

    const overlay = document.createElement('div');
    overlay.id = 'joystick-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'joystick-dialog-title');
    overlay.hidden = true;

    overlay.innerHTML = `
      <div class="joystick-card">
        <div class="joystick-header">
          <h2 id="joystick-dialog-title" class="joystick-title">
            <span data-i18n="joystick.dialog.title">🕹️ 조이스틱 & HOTAS 입력 점검</span>
          </h2>
          <button type="button" class="joystick-close-btn" data-joystick-close aria-label="닫기">&times;</button>
        </div>

        <p class="joystick-desc" data-i18n="joystick.dialog.desc">
          연결된 조종간(T.Flight Hotas One 등)의 축과 버튼 입력을 실시간으로 점검하고, 매핑 및 반전 설정을 조정합니다.
        </p>

        <!-- Device Status Banner -->
        <div class="joystick-status-banner">
          <div class="joystick-status-row">
            <span class="joystick-device-name" data-device-name>미연결 (No controller detected)</span>
            <span class="joystick-badge waiting" data-status-badge data-i18n="joystick.status.waiting">⚠️ 감지 대기 중</span>
          </div>
          <div class="joystick-device-details" data-device-details>
            브라우저 보안상 조종간 레버를 움직이거나 버튼을 누르면 활성화됩니다.
          </div>
        </div>

        <!-- Profile Selection -->
        <div class="joystick-section">
          <label class="joystick-field-label" for="joystick-profile-select" data-i18n="joystick.profile.label">조종간 매핑 프로필</label>
          <select id="joystick-profile-select" class="joystick-select" data-profile-select>
            <option value="auto" data-i18n="joystick.profile.auto">자동 감지 (Auto-Detect)</option>
            <option value="hotas-one" data-i18n="joystick.profile.hotas_one_pc">Thrustmaster T.Flight Hotas One (PC 모드 - 5축 원시 HID)</option>
            <option value="hotas-one-xbox" data-i18n="joystick.profile.hotas_one_xbox">Thrustmaster T.Flight Hotas One (XBOX 모드 / XInput)</option>
            <option value="hotas-tflight" data-i18n="joystick.profile.hotas_tflight">Thrustmaster T.Flight Hotas 4 / X</option>
            <option value="flight-stick" data-i18n="joystick.profile.flight_stick">일반 비행 조종간 (Generic Flight Stick)</option>
            <option value="standard-gamepad" data-i18n="joystick.profile.standard_gamepad">표준 게임패드 (Standard Gamepad / Xbox)</option>
          </select>
        </div>

        <div class="joystick-section">
          <h3 class="joystick-section-title">전투 버튼 매핑 (Combat buttons)</h3>
          <p>아래 버튼 번호는 실시간 버튼 표시에서 확인하세요. 지정한 버튼의 기존 기능은 해제됩니다.</p>
          ${[['missile', '미사일 발사'], ['gun', '기관포 (누르고 유지)'], ['target', '표적 전환'], ['chaff', '채프 (미구현)'], ['flare', '플레어 (미구현)']].map(([action, label]) => `
            <label class="joystick-field-label">${label}
              <select class="joystick-select" data-combat-button="${action}">
                <option value="-1">미지정</option>
                ${Array.from({ length: 65 }, (_, i) => `<option value="${i}">Button ${i}</option>`).join('')}
              </select>
            </label>`).join('')}
        </div>

        <!-- Flight Control Surfaces Real-time Meters -->
        <div class="joystick-section">
          <h3 class="joystick-section-title">주요 비행 조종면 실시간 상태 (Flight Controls)</h3>
          <div class="joystick-meters-grid">
            <!-- Pitch -->
            <div class="joystick-meter-card">
              <div class="joystick-meter-head">
                <span class="joystick-meter-name" data-i18n="joystick.axis.pitch">피치 (승강타 / Elevator)</span>
                <span class="joystick-meter-val" data-val-pitch>0.00</span>
              </div>
              <div class="joystick-meter-bar-wrap">
                <div class="joystick-meter-center"></div>
                <div class="joystick-meter-fill" data-bar-pitch style="left: 50%; width: 0%;"></div>
              </div>
              <div class="joystick-meter-sub">
                <span>◀ 하강(밀기)</span>
                <span data-i18n="joystick.axis.pitch.desc">밀기(하강) ◀ ▶ 당기기(상승)</span>
                <span>상승(당기기) ▶</span>
              </div>
            </div>

            <!-- Roll -->
            <div class="joystick-meter-card">
              <div class="joystick-meter-head">
                <span class="joystick-meter-name" data-i18n="joystick.axis.roll">롤 (보조익 / Aileron)</span>
                <span class="joystick-meter-val" data-val-roll>0.00</span>
              </div>
              <div class="joystick-meter-bar-wrap">
                <div class="joystick-meter-center"></div>
                <div class="joystick-meter-fill" data-bar-roll style="left: 50%; width: 0%;"></div>
              </div>
              <div class="joystick-meter-sub">
                <span>◀ 좌측 롤</span>
                <span data-i18n="joystick.axis.roll.desc">좌측 선회 ◀ ▶ 우측 선회</span>
                <span>우측 롤 ▶</span>
              </div>
            </div>

            <!-- Throttle -->
            <div class="joystick-meter-card">
              <div class="joystick-meter-head">
                <span class="joystick-meter-name" data-i18n="joystick.axis.throttle">스로틀 레버 (추력 / Throttle)</span>
                <span class="joystick-meter-source" data-source-throttle></span>
                <span class="joystick-meter-val" data-val-throttle>0%</span>
              </div>
              <div class="joystick-meter-bar-wrap">
                <div class="joystick-meter-fill throttle" data-bar-throttle style="left: 0; width: 0%;"></div>
              </div>
              <div class="joystick-meter-sub">
                <span>아이들 (0% Idle)</span>
                <span data-i18n="joystick.axis.throttle.desc">아이들(0%) ~ 최대추력(100% TOGA)</span>
                <span>최대 추력 (100% TOGA)</span>
              </div>
            </div>

            <!-- Rudder -->
            <div class="joystick-meter-card">
              <div class="joystick-meter-head">
                <span class="joystick-meter-name" data-i18n="joystick.axis.rudder">러더 (방향타 & 지상조향 / Rudder)</span>
                <span class="joystick-meter-source" data-source-rudder></span>
                <span class="joystick-meter-val" data-val-rudder>0.00</span>
              </div>
              <div class="joystick-meter-bar-wrap">
                <div class="joystick-meter-center"></div>
                <div class="joystick-meter-fill" data-bar-rudder style="left: 50%; width: 0%;"></div>
              </div>
              <div class="joystick-meter-sub">
                <span>◀ 좌측 요</span>
                <span data-i18n="joystick.axis.rudder.desc">좌측 요 ◀ ▶ 우측 요 (트위스트/로커 패들)</span>
                <span>우측 요 ▶</span>
              </div>
            </div>

            <!-- Wheel Brakes -->
            <div class="joystick-meter-card">
              <div class="joystick-meter-head">
                <span class="joystick-meter-name" data-i18n="joystick.axis.brakes">휠 브레이크 (Wheel Brakes)</span>
                <span class="joystick-meter-val" data-val-brakes>0%</span>
              </div>
              <div class="joystick-meter-bar-wrap">
                <div class="joystick-meter-fill brakes" data-bar-brakes style="left: 0; width: 0%;"></div>
              </div>
              <div class="joystick-meter-sub">
                <span>해제 (0%)</span>
                <span data-i18n="joystick.axis.brakes.desc">메인 트리거</span>
                <span>최대 제동 (100%)</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Calibration Wizard Card -->
        <div class="joystick-wizard-card">
          <div class="joystick-wizard-info">
            <div class="joystick-wizard-title" data-i18n="joystick.wizard.title">🧙‍♂️ 맞춤형 축 자동 보정 마법사</div>
            <div class="joystick-wizard-desc" data-i18n="joystick.wizard.desc">스틱과 스로틀을 안내에 따라 움직여 하드웨어 축을 100% 오차 없이 맞춤 보정합니다.</div>
            <div class="joystick-calibrated-badge" data-calibrated-badge style="display: none;"></div>
          </div>
          <div class="joystick-wizard-actions">
            <button type="button" class="btn-joystick-wizard" data-btn-start-wizard data-i18n="joystick.wizard.btn_start">마법사 시작</button>
            <button type="button" class="btn-joystick-reset-cal" data-btn-reset-cal style="display: none;" data-i18n="joystick.wizard.btn_reset">맞춤 보정 초기화</button>
          </div>
        </div>

        <!-- Wizard Step Overlay Panel -->
        <div class="joystick-wizard-panel" data-wizard-panel style="display: none;">
          <div class="wizard-header">
            <span class="wizard-step-tag" data-wizard-step-tag>Step 1 / 6</span>
            <button type="button" class="wizard-close-btn" data-wizard-cancel aria-label="Cancel Wizard">✕</button>
          </div>
          <h4 class="wizard-step-title" data-wizard-title>준비 및 초기 기준점</h4>
          <p class="wizard-step-prompt" data-wizard-prompt>스틱은 중앙에 두고, 스로틀 레버는 맨 뒤(아이들/0%)로 당긴 상태에서 [측정 시작]을 누르세요.</p>
          <div class="wizard-tip-box" data-wizard-tip style="display: none;"></div>
          
          <div class="wizard-visual-box">
            <div class="wizard-progress-bar-wrap">
              <div class="wizard-progress-bar" data-wizard-progress style="width: 0%;"></div>
            </div>
            <div class="wizard-detected-label" data-wizard-detected>대기 중...</div>
            <div class="wizard-summary-list" data-wizard-summary style="display: none;"></div>
          </div>

          <div class="wizard-footer">
            <button type="button" class="btn-wizard-nav secondary" data-wizard-cancel data-i18n="joystick.wizard.cancel">취소</button>
            <button type="button" class="btn-wizard-nav secondary" data-wizard-skip style="display: none;" data-i18n="joystick.wizard.skip">건너뛰기</button>
            <button type="button" class="btn-wizard-nav primary" data-wizard-next data-i18n="joystick.wizard.next">측정 시작</button>
          </div>
        </div>

        <!-- Calibration & Tuning Toggles -->
        <div class="joystick-section">
          <h3 class="joystick-section-title">조종간 튜닝 & 축 보정 (Calibration)</h3>
          <div class="joystick-options-grid">
            <label class="joystick-checkbox-label">
              <input type="checkbox" data-check-throttle-invert>
              <span data-i18n="joystick.invert.throttle">스로틀 반전 (밀어서 최대 출력 TOGA 100%)</span>
            </label>
            <label class="joystick-checkbox-label">
              <input type="checkbox" data-check-pitch-invert>
              <span data-i18n="joystick.invert.pitch">피치 반전 (당겨서 상승, 밀어서 하강)</span>
            </label>
            <div class="joystick-field">
              <label class="joystick-field-label" data-i18n="joystick.layout.label">축 배치 (Axis Layout)</label>
              <select class="joystick-select" data-select-axes-layout>
                <option value="thrustmaster" data-i18n="joystick.layout.thrustmaster">Thrustmaster 표준 (러더: Axis 2, 스로틀: Axis 3)</option>
                <option value="legacy" data-i18n="joystick.layout.legacy">반전 레이아웃 (스로틀: Axis 2, 러더: Axis 3)</option>
                <option value="auto" data-i18n="joystick.layout.auto">연결 시 축 역할 자동 판별 (Auto-Detect)</option>
              </select>
            </div>
            <div class="joystick-field">
              <label class="joystick-field-label" data-i18n="joystick.rudder.mode">러더 입력 소스</label>
              <select class="joystick-select" data-select-rudder-mode>
                <option value="auto" data-i18n="joystick.rudder.auto">자동 감지 (트위스트 + 패들/페달)</option>
                <option value="twist" data-i18n="joystick.rudder.twist">스틱 트위스트 전용</option>
                <option value="pedals" data-i18n="joystick.rudder.pedals">로커 패들 / TFRP 페달 전용 (Axis 4)</option>
              </select>
            </div>
            <div class="joystick-field">
              <label class="joystick-field-label" data-i18n="joystick.deadzone">중앙 데드존</label>
              <div class="joystick-slider-wrap">
                <input type="range" min="0" max="0.15" step="0.01" value="0.04" data-range-deadzone>
                <span class="joystick-slider-val" data-deadzone-val>4%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Buttons & Hat Switch Inspector -->
        <div class="joystick-section">
          <h3 class="joystick-section-title" data-i18n="joystick.buttons.title">버튼 및 햇 스위치 실시간 점검</h3>
          <div class="joystick-buttons-grid" data-buttons-grid>
            <!-- Generated dynamically -->
          </div>
        </div>

        <!-- Raw Axes Details -->
        <details class="joystick-raw-details">
          <summary data-i18n="joystick.raw.title">🔍 원시 입력 데이터 상세 (Raw Gamepad Axes & Buttons)</summary>
          <div class="joystick-raw-list" data-raw-axes-list>
            <!-- Rendered live -->
          </div>
        </details>

        <!-- Hardware Troubleshooting Guide -->
        <div class="joystick-tips-card">
          <h4 data-i18n="joystick.hw.tips">💡 T.Flight Hotas One 하드웨어 팁 & 문제 해결</h4>
          <ul>
            <li data-i18n="joystick.tip.switch">스위치 위치: T.Flight Hotas One 본체 뒤쪽 'PC / XBOX' 스위치가 PC에 있어야 5축 원시 HID로 작동합니다. XBOX 모드인 경우 위 프로필에서 'XBOX 모드'를 선택하면 스로틀과 러더가 자동 정렬됩니다.</li>
            <li data-i18n="joystick.tip.led">5축 / 4축 모드 LED: Home/Preset 버튼 LED가 초록색이면 5축 모드(로커 패들 독립), 빨간색이면 4축 모드(트위스트와 로커 패들 연동)입니다.</li>
            <li data-i18n="joystick.tip.rudder">러더 고정 현상: TFRP 페달이 연결되지 않은 경우 Axis 4(RJ12 단자)가 +1.0/-1.0으로 고정될 수 있습니다. 시스템이 부유 핀을 자동 차단하여 스틱 트위스트로 정상 비행할 수 있으며, 필요 시 '러더 입력 소스'를 '스틱 트위스트 전용'으로 설정할 수 있습니다.</li>
            <li data-i18n="joystick.tip.browser">브라우저 보안: 웹 브라우저는 보안상 조종간 레버를 움직이거나 버튼을 누르기 전까지 입력을 노출하지 않습니다.</li>
          </ul>
        </div>

        <!-- Actions -->
        <div class="joystick-actions">
          <button type="button" class="btn-joystick-reset" data-joystick-reset data-i18n="joystick.reset">기본값 복원</button>
          <button type="button" class="btn-joystick-close" data-joystick-close-btn data-i18n="joystick.close">닫기</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    translateDOM(overlay);

    this.dialog = overlay;
    this.bindDomElements();
  }

  bindDomElements() {
    if (!this.dialog) return;
    this.nameEl = this.dialog.querySelector('[data-device-name]');
    this.statusBadge = this.dialog.querySelector('[data-status-badge]');
    this.detailsEl = this.dialog.querySelector('[data-device-details]');
    this.profileSelect = this.dialog.querySelector('[data-profile-select]');
    this.axesLayoutSelect = this.dialog.querySelector('[data-select-axes-layout]');
    this.throttleInvertCheck = this.dialog.querySelector('[data-check-throttle-invert]');
    this.pitchInvertCheck = this.dialog.querySelector('[data-check-pitch-invert]');
    this.rudderModeSelect = this.dialog.querySelector('[data-select-rudder-mode]');
    this.deadzoneSlider = this.dialog.querySelector('[data-range-deadzone]');
    this.deadzoneVal = this.dialog.querySelector('[data-deadzone-val]');

    this.valPitch = this.dialog.querySelector('[data-val-pitch]');
    this.barPitch = this.dialog.querySelector('[data-bar-pitch]');
    this.valRoll = this.dialog.querySelector('[data-val-roll]');
    this.barRoll = this.dialog.querySelector('[data-bar-roll]');
    this.valThrottle = this.dialog.querySelector('[data-val-throttle]');
    this.barThrottle = this.dialog.querySelector('[data-bar-throttle]');
    this.sourceThrottle = this.dialog.querySelector('[data-source-throttle]');
    this.valRudder = this.dialog.querySelector('[data-val-rudder]');
    this.barRudder = this.dialog.querySelector('[data-bar-rudder]');
    this.sourceRudder = this.dialog.querySelector('[data-source-rudder]');
    this.valBrakes = this.dialog.querySelector('[data-val-brakes]');
    this.barBrakes = this.dialog.querySelector('[data-bar-brakes]');

    this.buttonsGrid = this.dialog.querySelector('[data-buttons-grid]');
    this.rawAxesList = this.dialog.querySelector('[data-raw-axes-list]');

    // Wizard DOM elements
    this.btnStartWizard = this.dialog.querySelector('[data-btn-start-wizard]');
    this.btnResetCal = this.dialog.querySelector('[data-btn-reset-cal]');
    this.calibratedBadge = this.dialog.querySelector('[data-calibrated-badge]');
    this.wizardPanel = this.dialog.querySelector('[data-wizard-panel]');
    this.wizardStepTag = this.dialog.querySelector('[data-wizard-step-tag]');
    this.wizardTitle = this.dialog.querySelector('[data-wizard-title]');
    this.wizardPrompt = this.dialog.querySelector('[data-wizard-prompt]');
    this.wizardTip = this.dialog.querySelector('[data-wizard-tip]');
    this.wizardProgress = this.dialog.querySelector('[data-wizard-progress]');
    this.wizardDetected = this.dialog.querySelector('[data-wizard-detected]');
    this.wizardSummary = this.dialog.querySelector('[data-wizard-summary]');
    this.btnWizardNext = this.dialog.querySelector('[data-wizard-next]');
    this.btnWizardSkip = this.dialog.querySelector('[data-wizard-skip]');
  }

  initListeners() {
    if (!this.dialog) return;

    // Close buttons
    this.dialog.querySelectorAll('[data-joystick-close], [data-joystick-close-btn]').forEach(btn => {
      btn.addEventListener('click', () => this.close());
    });

    // Wizard buttons
    this.btnStartWizard?.addEventListener('click', () => this.startWizard());
    this.btnResetCal?.addEventListener('click', () => this.resetCustomCalibration());
    this.dialog.querySelectorAll('[data-wizard-cancel]').forEach(btn => {
      btn.addEventListener('click', () => this.cancelWizard());
    });
    this.btnWizardNext?.addEventListener('click', () => this.advanceWizardStep());
    this.btnWizardSkip?.addEventListener('click', () => this.skipWizardStep());

    // Background overlay click
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.close();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    for (const select of this.dialog.querySelectorAll('[data-combat-button]')) {
      select.addEventListener('change', () => {
        const mapping = { ...this.hotas.getConfig().combatButtons };
        const selected = Number(select.value);
        if (selected >= 0) {
          for (const action of Object.keys(mapping)) if (mapping[action] === selected) mapping[action] = -1;
        }
        mapping[select.getAttribute('data-combat-button')] = selected;
        this.hotas.applyConfig({ combatButtons: mapping });
        for (const field of this.dialog.querySelectorAll('[data-combat-button]')) field.value = String(mapping[field.getAttribute('data-combat-button')]);
        this.savePreferences();
      });
    }

    // Profile selector
    this.profileSelect?.addEventListener('change', () => {
      this.hotas?.applyConfig({ profileOverride: this.profileSelect.value });
      this.savePreferences();
    });

    // Axes layout selector
    this.axesLayoutSelect?.addEventListener('change', () => {
      this.hotas?.applyConfig({ axesLayout: this.axesLayoutSelect.value });
      this.savePreferences();
    });

    // Throttle invert
    this.throttleInvertCheck?.addEventListener('change', () => {
      this.hotas?.applyConfig({ throttleInverted: this.throttleInvertCheck.checked });
      this.savePreferences();
    });

    // Pitch invert
    this.pitchInvertCheck?.addEventListener('change', () => {
      this.hotas?.applyConfig({ pitchInverted: this.pitchInvertCheck.checked });
      this.savePreferences();
    });

    // Rudder mode
    this.rudderModeSelect?.addEventListener('change', () => {
      this.hotas?.applyConfig({ rudderMode: this.rudderModeSelect.value });
      this.savePreferences();
    });

    // Deadzone slider
    this.deadzoneSlider?.addEventListener('input', () => {
      const val = parseFloat(this.deadzoneSlider.value);
      if (this.deadzoneVal) this.deadzoneVal.textContent = `${Math.round(val * 100)}%`;
      this.hotas?.applyConfig({ deadzoneStick: val, deadzoneRudder: val + 0.01 });
      this.savePreferences();
    });

    // Reset defaults
    this.dialog.querySelector('[data-joystick-reset]')?.addEventListener('click', () => {
      this.resetDefaults();
    });
  }

  open() {
    if (this.isOpen || !this.dialog) return;
    this.isOpen = true;
    this.dialog.hidden = false;
    // Keep controller outputs mapped from live axes while the meters poll,
    // without writing anything through to the aircraft.
    if (this.hotas) this.hotas.diagnosticActive = true;

    // Populate current config
    const config = this.hotas?.getConfig() || {};
    for (const field of this.dialog.querySelectorAll('[data-combat-button]')) field.value = String(config.combatButtons?.[field.getAttribute('data-combat-button')] ?? -1);
    if (this.profileSelect) this.profileSelect.value = config.profileOverride || 'auto';
    if (this.axesLayoutSelect) this.axesLayoutSelect.value = config.axesLayout || 'auto';
    if (this.throttleInvertCheck) this.throttleInvertCheck.checked = Boolean(config.throttleInverted);
    if (this.pitchInvertCheck) this.pitchInvertCheck.checked = Boolean(config.pitchInverted);
    if (this.rudderModeSelect) this.rudderModeSelect.value = config.rudderMode || 'auto';
    if (this.deadzoneSlider) {
      const dz = config.deadzoneStick ?? 0.04;
      this.deadzoneSlider.value = String(dz);
      if (this.deadzoneVal) this.deadzoneVal.textContent = `${Math.round(dz * 100)}%`;
    }

    this.refreshConfigUI();
    this.startLoop();
  }

  _requestFrame(cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(cb);
    return setTimeout(cb, 16);
  }

  _cancelFrame(id) {
    if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame(id);
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') return window.cancelAnimationFrame(id);
    clearTimeout(id);
  }

  close() {
    if (!this.isOpen || !this.dialog) return;
    this.isOpen = false;
    this.dialog.hidden = true;
    if (this.wizardActive) this.cancelWizard();
    if (this.hotas) this.hotas.diagnosticActive = false;
    if (this.rafId) {
      this._cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.savePreferences();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  startLoop() {
    const step = () => {
      if (!this.isOpen) return;
      // The flight loop may be frozen while a menu holds this dialog open, so
      // sample the controller here; diagnostic mode keeps it aircraft-neutral.
      this.hotas?.update(1 / 60);
      this.updateTelemetry();
      this.rafId = this._requestFrame(step);
    };
    this.rafId = this._requestFrame(step);
  }

  getButtonActionLabel(index, profile) {
    if (profile === 'hotas-one-xbox') {
      const xboxActions = {
        0: 'A (스포일러)',
        1: 'B (랜딩 기어)',
        2: 'X (파킹 브레이크)',
        3: 'Y (역추진)',
        4: 'LB (플랩 접기)',
        5: 'RB (플랩 펼치기)',
        6: 'LT (예비 브레이크)',
        7: 'RT (메인 트리거/브레이크)',
        8: 'View (카메라 순환)',
        9: 'Menu (시선 정면)',
        10: 'LS (조명)',
        11: 'RS (엔진 고장)',
        12: 'POV ▲ (시선 상향)',
        13: 'POV ▼ (시선 하향)',
        14: 'POV ◀ (시선 좌측)',
        15: 'POV ▶ (시선 우측)',
      };
      return xboxActions[index] || `Button ${index}`;
    }

    // Default PC Hotas One / Flight stick profile
    const pcActions = {
      0: '메인 트리거 (브레이크)',
      1: 'B1 (스포일러)',
      2: 'B2 (랜딩 기어)',
      3: 'B3 (역추진)',
      4: 'B4 (플랩 접기)',
      5: 'B5 (플랩 펼치기)',
      6: 'B6 (파킹 브레이크)',
      7: 'B7 (카메라 순환)',
      8: 'B8 (시선 정면)',
      9: 'B9 (조명)',
      10: 'B10 (엔진 고장)',
      11: 'B11 (오디오 토글)',
      12: 'POV ▲ (시선 상향)',
      13: 'POV ▼ (시선 하향)',
      14: 'POV ◀ (시선 좌측)',
      15: 'POV ▶ (시선 우측)',
    };
    return pcActions[index] || `Button ${index}`;
  }

  updateTelemetry() {
    if (!this.hotas) return;
    const diag = this.hotas.getDiagnostics();

    // 0. Update Wizard Telemetry if active
    if (this.wizardActive) {
      this.processWizardTelemetry(diag);
    }

    // 1. Connection & Device Banner
    if (diag.connected) {
      if (this.nameEl) this.nameEl.textContent = diag.device.name;
      if (this.statusBadge) {
        this.statusBadge.textContent = t('joystick.status.connected');
        this.statusBadge.className = 'joystick-badge connected';
      }
      if (this.detailsEl) {
        this.detailsEl.textContent = `[Index ${diag.device.index}] Mode: ${diag.device.mapping} · ${diag.axes.length} Axes · ${diag.buttons.length} Buttons · Active Profile: ${diag.activeProfile}`;
      }
    } else {
      if (this.nameEl) this.nameEl.textContent = '미연결 (No controller detected)';
      if (this.statusBadge) {
        this.statusBadge.textContent = t('joystick.status.waiting');
        this.statusBadge.className = 'joystick-badge waiting';
      }
      if (this.detailsEl) {
        this.detailsEl.textContent = '브라우저 보안상 조종간 레버를 움직이거나 버튼을 누르면 활성화됩니다.';
      }
    }

    // 2. Flight Controls Meters
    const { elevator, aileron, throttle, rudder, brakes } = diag.outputs;
    const isCustom = Boolean(diag.customMapping);

    // Pitch (bipolar: -1.0 to 1.0)
    if (this.valPitch && this.barPitch) {
      const p = elevator;
      this.valPitch.textContent = `${(p * 100).toFixed(0)}% (${p > 0.05 ? '당김/Climb' : p < -0.05 ? '밀기/Dive' : '중립'})`;
      if (p >= 0) {
        this.barPitch.style.left = '50%';
        this.barPitch.style.width = `${Math.min(50, p * 50)}%`;
      } else {
        const w = Math.min(50, -p * 50);
        this.barPitch.style.left = `${50 - w}%`;
        this.barPitch.style.width = `${w}%`;
      }
    }

    // Roll (bipolar: -1.0 to 1.0)
    if (this.valRoll && this.barRoll) {
      const r = aileron;
      this.valRoll.textContent = `${(r * 100).toFixed(0)}% (${r > 0.05 ? '우측/Right' : r < -0.05 ? '좌측/Left' : '중립'})`;
      if (r >= 0) {
        this.barRoll.style.left = '50%';
        this.barRoll.style.width = `${Math.min(50, r * 50)}%`;
      } else {
        const w = Math.min(50, -r * 50);
        this.barRoll.style.left = `${50 - w}%`;
        this.barRoll.style.width = `${w}%`;
      }
    }

    // Throttle (unipolar: 0.0 to 1.0)
    if (this.valThrottle && this.barThrottle) {
      const th = Math.max(0, Math.min(1, throttle));
      this.valThrottle.textContent = `${Math.round(th * 100)}% (${th >= 0.95 ? 'TOGA 100%' : th <= 0.05 ? 'Idle' : 'Thrust'})`;
      this.barThrottle.style.left = '0%';
      this.barThrottle.style.width = `${(th * 100).toFixed(1)}%`;
    }

    if (this.sourceThrottle) {
      if (isCustom && diag.customMapping.throttleAxis != null) {
        this.sourceThrottle.textContent = `[맞춤 보정: Axis ${diag.customMapping.throttleAxis}]`;
        this.sourceThrottle.className = 'joystick-meter-source active';
      } else {
        this.sourceThrottle.textContent = `[Axis ${diag.throttleAxis ?? 3}]`;
        this.sourceThrottle.className = 'joystick-meter-source active';
      }
    }

    // Rudder (bipolar: -1.0 to 1.0)
    if (this.valRudder && this.barRudder) {
      const rud = rudder;
      this.valRudder.textContent = `${(rud * 100).toFixed(0)}% (${rud > 0.05 ? '우측/Right' : rud < -0.05 ? '좌측/Left' : '중립'})`;
      if (rud >= 0) {
        this.barRudder.style.left = '50%';
        this.barRudder.style.width = `${Math.min(50, rud * 50)}%`;
      } else {
        const w = Math.min(50, -rud * 50);
        this.barRudder.style.left = `${50 - w}%`;
        this.barRudder.style.width = `${w}%`;
      }
    }

    if (this.sourceRudder) {
      if (isCustom && diag.customMapping.rudderAxis != null) {
        this.sourceRudder.textContent = `[맞춤 보정: Axis ${diag.customMapping.rudderAxis}]`;
        this.sourceRudder.className = 'joystick-meter-source active';
      } else {
        const rAxis = diag.rudderAxis ?? 2;
        if (diag.axis4Floating) {
          this.sourceRudder.textContent = t('joystick.rudder.source.floating');
          this.sourceRudder.className = 'joystick-meter-source warning';
        } else if (diag.activeRudderSource === 'pedals') {
          this.sourceRudder.textContent = t('joystick.rudder.source.pedals');
          this.sourceRudder.className = 'joystick-meter-source active';
        } else if (diag.activeProfile === 'hotas-one-xbox') {
          this.sourceRudder.textContent = t('joystick.rudder.source.xbox');
          this.sourceRudder.className = 'joystick-meter-source active';
        } else {
          this.sourceRudder.textContent = `${t('joystick.rudder.source.twist')} (Axis ${rAxis})`;
          this.sourceRudder.className = 'joystick-meter-source';
        }
      }
    }

    // Wheel Brakes (unipolar: 0.0 to 1.0)
    if (this.valBrakes && this.barBrakes) {
      const brk = Math.max(0, Math.min(1, brakes));
      this.valBrakes.textContent = `${Math.round(brk * 100)}% (${brk > 0.05 ? '제동 중/Active' : '해제/Released'})`;
      this.barBrakes.style.left = '0%';
      this.barBrakes.style.width = `${(brk * 100).toFixed(1)}%`;
    }

    // 3. Buttons Grid
    if (this.buttonsGrid) {
      const btnCount = Math.max(16, diag.buttons.length);
      // Ensure chips exist
      while (this.buttonsGrid.children.length < btnCount) {
        const idx = this.buttonsGrid.children.length;
        const chip = document.createElement('div');
        chip.className = 'joystick-btn-chip';
        chip.innerHTML = `
          <span class="btn-name">B${idx}</span>
          <span class="btn-action">${this.getButtonActionLabel(idx, diag.activeProfile)}</span>
        `;
        this.buttonsGrid.appendChild(chip);
      }

      // Update button pressed state & action labels
      for (let i = 0; i < this.buttonsGrid.children.length; i++) {
        const chip = this.buttonsGrid.children[i];
        const btnData = diag.buttons[i];
        const isPressed = Boolean(btnData && btnData.pressed);
        chip.classList.toggle('is-pressed', isPressed);

        const actionEl = chip.querySelector('.btn-action');
        if (actionEl) {
          actionEl.textContent = this.getButtonActionLabel(i, diag.activeProfile);
        }
      }
    }

    // 4. Raw Axes Inspector
    if (this.rawAxesList) {
      const axes = diag.axes || [];
      const isXbox = diag.activeProfile === 'hotas-one-xbox';
      const rAxis = diag.rudderAxis ?? 2;
      const tAxis = diag.throttleAxis ?? 3;
      const axisDescriptions = {
        0: 'Roll / 에일러론',
        1: 'Pitch / 엘리베이터',
        2: isXbox
          ? 'Rudder / 우측 스틱 X (Xbox)'
          : (rAxis === 2 ? 'Rudder Twist / 트위스트 (Z)' : 'Throttle / 스로틀 레버 (Z)'),
        3: isXbox
          ? 'Throttle / 우측 스틱 Y (Xbox)'
          : (tAxis === 3 ? 'Throttle / 스로틀 레버 (RZ)' : 'Rudder Twist / 트위스트 (RZ)'),
        4: diag.axis4Floating ? 'Rocker/Pedal (부유 핀 감지 · 차단됨)' : 'Rocker/Pedal / 로커·페달',
      };

      while (this.rawAxesList.children.length < axes.length) {
        const idx = this.rawAxesList.children.length;
        const item = document.createElement('div');
        item.className = 'joystick-raw-item';
        item.innerHTML = `<span>Axis ${idx}:</span><span data-raw-axis="${idx}">0.000</span><span class="raw-desc" data-raw-desc="${idx}"></span>`;
        this.rawAxesList.appendChild(item);
      }
      for (let i = 0; i < axes.length; i++) {
        const span = this.rawAxesList.querySelector(`[data-raw-axis="${i}"]`);
        if (span) span.textContent = axes[i].toFixed(3);
        const descSpan = this.rawAxesList.querySelector(`[data-raw-desc="${i}"]`);
        if (descSpan) {
          descSpan.textContent = axisDescriptions[i] ? ` (${axisDescriptions[i]})` : '';
        }
      }
    }
  }

  savePreferences() {
    if (!this.hotas) return;
    saveSimulatorPreferences({ joystick: this.hotas.getConfig() }, this.storage);
  }

  resetDefaults() {
    if (!this.hotas) return;
    const defaults = {
      profileOverride: 'auto',
      axesLayout: 'auto',
      throttleInverted: false,
      pitchInverted: false,
      rudderMode: 'auto',
      deadzoneStick: 0.04,
      deadzoneRudder: 0.05,
      customMapping: null,
      combatButtons: { missile: -1, gun: -1, target: -1, chaff: -1, flare: -1 },
    };
    this.hotas.applyConfig(defaults);

    for (const field of this.dialog.querySelectorAll('[data-combat-button]')) field.value = '-1';
    if (this.profileSelect) this.profileSelect.value = 'auto';
    if (this.axesLayoutSelect) this.axesLayoutSelect.value = 'auto';
    if (this.throttleInvertCheck) this.throttleInvertCheck.checked = false;
    if (this.pitchInvertCheck) this.pitchInvertCheck.checked = false;
    if (this.rudderModeSelect) this.rudderModeSelect.value = 'auto';
    if (this.deadzoneSlider) {
      this.deadzoneSlider.value = '0.04';
      if (this.deadzoneVal) this.deadzoneVal.textContent = '4%';
    }

    this.refreshConfigUI();
    this.savePreferences();
  }

  refreshConfigUI() {
    const config = this.hotas?.getConfig() || {};
    const hasCustom = Boolean(config.customMapping);
    if (this.calibratedBadge) {
      this.calibratedBadge.style.display = hasCustom ? 'inline-block' : 'none';
      if (hasCustom) {
        this.calibratedBadge.textContent = t('joystick.wizard.badge.calibrated');
      }
    }
    if (this.btnResetCal) {
      this.btnResetCal.style.display = hasCustom ? 'inline-block' : 'none';
    }
  }

  startWizard() {
    this.wizardActive = true;
    this.wizardStep = 1;
    this.wizardBaseline = null;
    this.wizardCandidate = null;
    this.wizardExtremes = {};
    this.wizardMapping = {
      rollAxis: null,
      rollInverted: false,
      pitchAxis: null,
      pitchInverted: false,
      throttleAxis: null,
      throttleIdleVal: null,
      throttleMaxVal: null,
      throttleInverted: false,
      rudderAxis: null,
      rudderInverted: false,
      brakesButton: 0,
      brakesAxis: null,
    };
    if (this.wizardPanel) this.wizardPanel.style.display = 'block';
    this.renderWizardStep();
  }

  cancelWizard() {
    this.wizardActive = false;
    this.wizardStep = 0;
    this.wizardBaseline = null;
    this.wizardCandidate = null;
    if (this.wizardPanel) this.wizardPanel.style.display = 'none';
  }

  resetCustomCalibration() {
    this.hotas?.applyConfig({ customMapping: null });
    this.savePreferences();
    this.refreshConfigUI();
  }

  renderWizardStep() {
    if (!this.wizardPanel) return;

    if (this.wizardSummary) this.wizardSummary.style.display = 'none';
    if (this.wizardTip) this.wizardTip.style.display = 'none';
    const progressWrap = this.wizardPanel.querySelector('.wizard-progress-bar-wrap');
    if (progressWrap) progressWrap.style.display = 'block';
    if (this.wizardDetected) this.wizardDetected.style.display = 'block';

    this.wizardCandidate = null;
    this.wizardExtremes = {};

    switch (this.wizardStep) {
      case 1: // Baseline (Idle & Center)
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.step1.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.step1.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.step1.prompt');
        if (this.wizardProgress) this.wizardProgress.style.width = '0%';
        if (this.wizardDetected) this.wizardDetected.textContent = '대기 중... (레버를 아이들(0%)에 두고 [측정 시작] 클릭)';
        if (this.btnWizardNext) this.btnWizardNext.textContent = t('joystick.wizard.next');
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'none';
        break;

      case 2: // Roll
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.step2.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.step2.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.step2.prompt');
        if (this.wizardProgress) this.wizardProgress.style.width = '16%';
        if (this.wizardDetected) this.wizardDetected.textContent = '스틱을 좌우로 끝까지 움직이세요...';
        if (this.btnWizardNext) this.btnWizardNext.textContent = '다음 (Next)';
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'inline-block';
        break;

      case 3: // Pitch
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.step3.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.step3.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.step3.prompt');
        if (this.wizardProgress) this.wizardProgress.style.width = '33%';
        if (this.wizardDetected) this.wizardDetected.textContent = '스틱을 앞뒤로 끝까지 움직이세요...';
        if (this.btnWizardNext) this.btnWizardNext.textContent = '다음 (Next)';
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'inline-block';
        break;

      case 4: // Throttle
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.step4.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.step4.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.step4.prompt');
        if (this.wizardProgress) this.wizardProgress.style.width = '50%';
        if (this.wizardDetected) this.wizardDetected.textContent = '스로틀을 맨 앞(TOGA)까지 밀어주세요...';
        if (this.btnWizardNext) this.btnWizardNext.textContent = '다음 (Next)';
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'inline-block';
        break;

      case 5: // Rudder
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.step5.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.step5.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.step5.prompt');
        if (this.wizardTip) {
          this.wizardTip.style.display = 'block';
          this.wizardTip.textContent = t('joystick.wizard.step5.tip');
        }
        if (this.wizardProgress) this.wizardProgress.style.width = '66%';
        if (this.wizardDetected) this.wizardDetected.textContent = '스틱을 비틀거나 스로틀 뒤 로커 패들을 움직이세요...';
        if (this.btnWizardNext) this.btnWizardNext.textContent = '다음 (Next)';
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'inline-block';
        break;

      case 6: // Brakes
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.step6.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.step6.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.step6.prompt');
        if (this.wizardProgress) this.wizardProgress.style.width = '83%';
        if (this.wizardDetected) this.wizardDetected.textContent = '메인 트리거를 당기거나 브레이크 버튼을 누르세요...';
        if (this.btnWizardNext) this.btnWizardNext.textContent = '다음 (Next)';
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'inline-block';
        break;

      case 7: // Summary
        if (this.wizardStepTag) this.wizardStepTag.textContent = t('joystick.wizard.complete.tag');
        if (this.wizardTitle) this.wizardTitle.textContent = t('joystick.wizard.complete.title');
        if (this.wizardPrompt) this.wizardPrompt.textContent = t('joystick.wizard.complete.prompt');
        if (this.wizardProgress) this.wizardProgress.style.width = '100%';
        if (progressWrap) progressWrap.style.display = 'none';
        if (this.wizardDetected) this.wizardDetected.style.display = 'none';
        if (this.wizardSummary) {
          this.wizardSummary.style.display = 'block';
          const r = this.wizardMapping.rollAxis ?? 0;
          const p = this.wizardMapping.pitchAxis ?? 1;
          const th = this.wizardMapping.throttleAxis ?? 3;
          const rud = this.wizardMapping.rudderAxis ?? 2;
          const brk = this.wizardMapping.brakesButton ?? 0;
          const idleStr = (this.wizardMapping.throttleIdleVal ?? 1).toFixed(2);
          const maxStr = (this.wizardMapping.throttleMaxVal ?? -1).toFixed(2);

          this.wizardSummary.innerHTML = `
            <div class="wizard-summary-item"><span>에일러론 (Roll)</span><strong>Axis ${r}${this.wizardMapping.rollInverted ? ' (반전)' : ''}</strong></div>
            <div class="wizard-summary-item"><span>엘리베이터 (Pitch)</span><strong>Axis ${p}${this.wizardMapping.pitchInverted ? ' (반전)' : ''}</strong></div>
            <div class="wizard-summary-item"><span>스로틀 (Throttle)</span><strong>Axis ${th} (Idle: ${idleStr} → TOGA: ${maxStr})</strong></div>
            <div class="wizard-summary-item"><span>러더 (Rudder)</span><strong>Axis ${rud}${this.wizardMapping.rudderInverted ? ' (반전)' : ''}</strong></div>
            <div class="wizard-summary-item"><span>브레이크 (Brakes)</span><strong>Button ${brk}</strong></div>
          `;
        }
        if (this.btnWizardNext) this.btnWizardNext.textContent = t('joystick.wizard.save');
        if (this.btnWizardSkip) this.btnWizardSkip.style.display = 'none';
        break;
    }
  }

  processWizardTelemetry(diag) {
    if (!this.wizardActive || !diag || !diag.connected) return;
    const axes = diag.axes || [];
    const buttons = diag.buttons || [];

    if (this.wizardStep === 1) return;
    const baseline = this.wizardBaseline || [];

    switch (this.wizardStep) {
      case 2: { // Roll
        let bestAxis = null;
        let maxDelta = 0;
        for (let i = 0; i < axes.length; i++) {
          const delta = Math.abs(axes[i] - (baseline[i] ?? 0));
          if (delta > maxDelta) {
            maxDelta = delta;
            bestAxis = i;
          }
        }
        if (bestAxis !== null && maxDelta >= 0.35) {
          this.wizardCandidate = bestAxis;
          if (this.wizardDetected) {
            this.wizardDetected.textContent = `감지됨: Axis ${bestAxis} (변화량: ${(maxDelta * 100).toFixed(0)}%)`;
          }
        }
        break;
      }

      case 3: { // Pitch
        let bestAxis = null;
        let maxDelta = 0;
        for (let i = 0; i < axes.length; i++) {
          if (i === this.wizardMapping.rollAxis) continue;
          const delta = Math.abs(axes[i] - (baseline[i] ?? 0));
          if (delta > maxDelta) {
            maxDelta = delta;
            bestAxis = i;
          }
        }
        if (bestAxis !== null && maxDelta >= 0.35) {
          this.wizardCandidate = bestAxis;
          if (this.wizardDetected) {
            this.wizardDetected.textContent = `감지됨: Axis ${bestAxis} (변화량: ${(maxDelta * 100).toFixed(0)}%)`;
          }
        }
        break;
      }

      case 4: { // Throttle
        let bestAxis = null;
        let maxDelta = 0;
        for (let i = 0; i < axes.length; i++) {
          if (i === this.wizardMapping.rollAxis || i === this.wizardMapping.pitchAxis) continue;
          const delta = Math.abs(axes[i] - (baseline[i] ?? 0));
          if (delta > maxDelta) {
            maxDelta = delta;
            bestAxis = i;
          }
        }
        if (bestAxis !== null && maxDelta >= 0.35) {
          this.wizardCandidate = bestAxis;
          const idleVal = baseline[bestAxis] ?? 1;
          this.wizardExtremes[bestAxis] = this.wizardExtremes[bestAxis] || {
            idle: idleVal,
            peak: axes[bestAxis],
          };
          if (Math.abs(axes[bestAxis] - idleVal) > Math.abs(this.wizardExtremes[bestAxis].peak - idleVal)) {
            this.wizardExtremes[bestAxis].peak = axes[bestAxis];
          }
          if (this.wizardDetected) {
            this.wizardDetected.textContent = `감지됨: Axis ${bestAxis} (아이들: ${idleVal.toFixed(2)} → 현재: ${axes[bestAxis].toFixed(2)})`;
          }
        }
        break;
      }

      case 5: { // Rudder
        let bestAxis = null;
        let maxDelta = 0;
        for (let i = 0; i < axes.length; i++) {
          if (
            i === this.wizardMapping.rollAxis ||
            i === this.wizardMapping.pitchAxis ||
            i === this.wizardMapping.throttleAxis
          ) continue;
          const delta = Math.abs(axes[i] - (baseline[i] ?? 0));
          if (delta > maxDelta) {
            maxDelta = delta;
            bestAxis = i;
          }
        }
        if (bestAxis !== null && maxDelta >= 0.30) {
          this.wizardCandidate = bestAxis;
          const label = bestAxis === 4 ? '로커 패들 / Axis 4' : `스틱 트위스트 / Axis ${bestAxis}`;
          if (this.wizardDetected) {
            this.wizardDetected.textContent = `감지됨: ${label} (변화량: ${(maxDelta * 100).toFixed(0)}%)`;
          }
        }
        break;
      }

      case 6: { // Brakes
        for (let i = 0; i < buttons.length; i++) {
          if (buttons[i] && (buttons[i].pressed || buttons[i].value > 0.6)) {
            this.wizardCandidate = i;
            if (this.wizardDetected) {
              this.wizardDetected.textContent = `감지됨: Button ${i} (${this.getButtonActionLabel(i, diag.activeProfile)})`;
            }
            break;
          }
        }
        break;
      }
    }
  }

  advanceWizardStep() {
    if (!this.wizardActive) return;

    const diag = this.hotas?.getDiagnostics?.() || {};
    const axes = diag.axes || [];

    switch (this.wizardStep) {
      case 1: { // Baseline captured
        this.wizardBaseline = [...axes];
        this.wizardStep = 2;
        this.renderWizardStep();
        break;
      }
      case 2: { // Roll confirmed
        this.wizardMapping.rollAxis = this.wizardCandidate ?? 0;
        this.wizardStep = 3;
        this.renderWizardStep();
        break;
      }
      case 3: { // Pitch confirmed
        this.wizardMapping.pitchAxis = this.wizardCandidate ?? 1;
        this.wizardStep = 4;
        this.renderWizardStep();
        break;
      }
      case 4: { // Throttle confirmed
        const thAxis = this.wizardCandidate ?? 3;
        this.wizardMapping.throttleAxis = thAxis;
        const baselineIdle = this.wizardBaseline ? (this.wizardBaseline[thAxis] ?? 1) : 1;
        const peakVal = (this.wizardExtremes[thAxis] && this.wizardExtremes[thAxis].peak !== undefined)
          ? this.wizardExtremes[thAxis].peak
          : (baselineIdle > 0 ? -1 : 1);
        this.wizardMapping.throttleIdleVal = baselineIdle;
        this.wizardMapping.throttleMaxVal = peakVal;
        this.wizardStep = 5;
        this.renderWizardStep();
        break;
      }
      case 5: { // Rudder confirmed
        let rudAxis = this.wizardCandidate;
        if (rudAxis == null) {
          const taken = [this.wizardMapping.rollAxis, this.wizardMapping.pitchAxis, this.wizardMapping.throttleAxis];
          rudAxis = [2, 4, 3, 0].find(a => !taken.includes(a)) ?? 2;
        }
        this.wizardMapping.rudderAxis = rudAxis;
        this.wizardStep = 6;
        this.renderWizardStep();
        break;
      }
      case 6: { // Brakes confirmed
        this.wizardMapping.brakesButton = this.wizardCandidate ?? 0;
        this.wizardStep = 7;
        this.renderWizardStep();
        break;
      }
      case 7: { // Save & apply
        if (this.hotas) {
          this.hotas.applyConfig({ customMapping: { ...this.wizardMapping } });
          this.savePreferences();
          this.refreshConfigUI();
        }
        this.cancelWizard();
        break;
      }
    }
  }

  skipWizardStep() {
    if (!this.wizardActive) return;
    switch (this.wizardStep) {
      case 2: // Roll skip -> default 0
        this.wizardMapping.rollAxis = 0;
        this.wizardStep = 3;
        this.renderWizardStep();
        break;
      case 3: // Pitch skip -> default 1
        this.wizardMapping.pitchAxis = 1;
        this.wizardStep = 4;
        this.renderWizardStep();
        break;
      case 4: // Throttle skip -> default 3
        this.wizardMapping.throttleAxis = 3;
        this.wizardMapping.throttleIdleVal = 1;
        this.wizardMapping.throttleMaxVal = -1;
        this.wizardStep = 5;
        this.renderWizardStep();
        break;
      case 5: // Rudder skip -> default 2
        this.wizardMapping.rudderAxis = 2;
        this.wizardStep = 6;
        this.renderWizardStep();
        break;
      case 6: // Brakes skip -> default 0
        this.wizardMapping.brakesButton = 0;
        this.wizardStep = 7;
        this.renderWizardStep();
        break;
    }
  }
}
