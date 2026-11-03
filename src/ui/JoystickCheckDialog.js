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
              <label class="joystick-field-label" data-i18n="joystick.rudder.mode">러더 입력 소스</label>
              <select class="joystick-select" data-select-rudder-mode>
                <option value="auto" data-i18n="joystick.rudder.auto">자동 감지 (트위스트 + 패들/페달)</option>
                <option value="twist" data-i18n="joystick.rudder.twist">스틱 트위스트 전용 (Axis 3)</option>
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
    this.valRudder = this.dialog.querySelector('[data-val-rudder]');
    this.barRudder = this.dialog.querySelector('[data-bar-rudder]');
    this.valBrakes = this.dialog.querySelector('[data-val-brakes]');
    this.barBrakes = this.dialog.querySelector('[data-bar-brakes]');

    this.buttonsGrid = this.dialog.querySelector('[data-buttons-grid]');
    this.rawAxesList = this.dialog.querySelector('[data-raw-axes-list]');
  }

  initListeners() {
    if (!this.dialog) return;

    // Close buttons
    this.dialog.querySelectorAll('[data-joystick-close], [data-joystick-close-btn]').forEach(btn => {
      btn.addEventListener('click', () => this.close());
    });

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

    // Profile selector
    this.profileSelect?.addEventListener('change', () => {
      this.hotas?.applyConfig({ profileOverride: this.profileSelect.value });
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

    // Populate current config
    const config = this.hotas?.getConfig() || {};
    if (this.profileSelect) this.profileSelect.value = config.profileOverride || 'auto';
    if (this.throttleInvertCheck) this.throttleInvertCheck.checked = Boolean(config.throttleInverted);
    if (this.pitchInvertCheck) this.pitchInvertCheck.checked = Boolean(config.pitchInverted);
    if (this.rudderModeSelect) this.rudderModeSelect.value = config.rudderMode || 'auto';
    if (this.deadzoneSlider) {
      const dz = config.deadzoneStick ?? 0.04;
      this.deadzoneSlider.value = String(dz);
      if (this.deadzoneVal) this.deadzoneVal.textContent = `${Math.round(dz * 100)}%`;
    }

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
        12: 'POV ▲ (기수 내림 트림)',
        13: 'POV ▼ (기수 올림 트림)',
        14: 'POV ◀ (시간대 -)',
        15: 'POV ▶ (시간대 +)',
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
      12: 'POV ▲ (기수 내림 트림)',
      13: 'POV ▼ (기수 올림 트림)',
      14: 'POV ◀ (시간대 -)',
      15: 'POV ▶ (시간대 +)',
    };
    return pcActions[index] || `Button ${index}`;
  }

  updateTelemetry() {
    if (!this.hotas) return;
    const diag = this.hotas.getDiagnostics();

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
      while (this.rawAxesList.children.length < axes.length) {
        const idx = this.rawAxesList.children.length;
        const item = document.createElement('div');
        item.className = 'joystick-raw-item';
        item.innerHTML = `<span>Axis ${idx}:</span><span data-raw-axis="${idx}">0.000</span>`;
        this.rawAxesList.appendChild(item);
      }
      for (let i = 0; i < axes.length; i++) {
        const span = this.rawAxesList.querySelector(`[data-raw-axis="${i}"]`);
        if (span) span.textContent = axes[i].toFixed(3);
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
      throttleInverted: false,
      pitchInverted: false,
      rudderMode: 'auto',
      deadzoneStick: 0.04,
      deadzoneRudder: 0.05,
    };
    this.hotas.applyConfig(defaults);

    if (this.profileSelect) this.profileSelect.value = 'auto';
    if (this.throttleInvertCheck) this.throttleInvertCheck.checked = false;
    if (this.pitchInvertCheck) this.pitchInvertCheck.checked = false;
    if (this.rudderModeSelect) this.rudderModeSelect.value = 'auto';
    if (this.deadzoneSlider) {
      this.deadzoneSlider.value = '0.04';
      if (this.deadzoneVal) this.deadzoneVal.textContent = '4%';
    }

    this.savePreferences();
  }
}
