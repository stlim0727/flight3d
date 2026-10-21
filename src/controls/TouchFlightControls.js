import { t, translateDOM } from '../i18n/index.js';
/**
 * TouchFlightControls.js
 * Comprehensive Mobile & Touchscreen Flight Control System
 * 
 * Features:
 * 1. Virtual Flight Stick (Right Thumb) - 2D Pitch (Elevator) & Roll (Aileron) with spring-centering
 * 2. Vertical Throttle Quadrant (Left Thumb) - 0% IDLE to 100% TOGA with detents & instant presets
 * 3. Rudder Pedals / Slider - Left/Right Yaw & Nosewheel Steering with auto-center
 * 4. Hydraulic Wheel Brakes - Touch-and-hold with visual active indicator
 * 5. Device Orientation Gyro Flight - Optional tilt-to-fly with zero-point calibration (iOS & Android)
 * 6. Quick Action Buttons - Gear, Flaps, Spoilers, Reverser, Camera, Gyro Toggle
 * 7. Modern Web Pointer Events & touch-action: none for zero-lag gesture immunity
 */
export class TouchFlightControls {
  constructor(flightControls, options = {}) {
    this.controls = flightControls;
    this.options = options;

    // Active state
    this.enabled = false;
    this.gyroActive = false;
    this.gyroZeroPitch = 38.0; // Comfortable holding angle (~38° tilted towards pilot)
    this.gyroZeroRoll = 0.0;
    this.gyroSensitivity = 0.035;

    // Virtual Stick State
    this.stickActive = false;
    this.stickPointerId = null;
    this.stickCenterX = 0;
    this.stickCenterY = 0;
    this.stickRadius = 60; // Max deflection in px
    this.stickCurrentX = 0;
    this.stickCurrentY = 0;

    // Rudder State
    this.rudderActive = false;
    this.rudderPointerId = null;
    this.rudderCenterX = 0;
    this.rudderMaxDeflection = 55; // px

    // Throttle Drag State
    this.throttleActive = false;
    this.throttlePointerId = null;

    // DOM References
    this.overlay = null;
    this.stickZone = null;
    this.stickKnob = null;
    this.throttleTrack = null;
    this.throttleThumb = null;
    this.throttleFill = null;
    this.throttleReadout = null;
    this.rudderTrack = null;
    this.rudderThumb = null;
    this.brakeBtn = null;
    this.gyroBtn = null;

    // Auto-detect touchscreen environment or allow explicit toggle
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    this.initDOM();
    this.bindEvents();

    if (isTouch) {
      this.enable();
    }
  }

  initDOM() {
    // Check if overlay already exists in DOM
    let el = document.getElementById('touch-controls-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'touch-controls-overlay';
      el.className = 'touch-controls-overlay';
      el.style.display = 'none';
      el.innerHTML = `
        <!-- Left Side: Throttle Quadrant & Quick Presets -->
        <div class="touch-quadrant touch-left">
          <div class="touch-throttle-card">
            <div class="touch-card-header">
              <span class="touch-label">THROTTLE</span>
              <span id="touch-thr-val" class="touch-value cyan">0%</span>
            </div>
            <div class="touch-throttle-body">
              <div class="touch-throttle-presets">
                <button type="button" class="btn-touch-preset" data-thr="1.0" title="TOGA 100%">TOGA</button>
                <button type="button" class="btn-touch-preset" data-thr="0.85" title="CLIMB 85%">CLB</button>
                <button type="button" class="btn-touch-preset" data-thr="0.55" title="APPROACH 55%">APP</button>
                <button type="button" class="btn-touch-preset" data-thr="0.0" title="IDLE 22%">IDLE</button>
              </div>
              <div id="touch-throttle-track" class="touch-throttle-track">
                <div id="touch-throttle-fill" class="touch-throttle-fill"></div>
                <div id="touch-throttle-thumb" class="touch-throttle-thumb">
                  <span class="thumb-grip"></span>
                </div>
                <div class="throttle-detent detent-toga" style="top: 0%;"></div>
                <div class="throttle-detent detent-clb" style="top: 15%;"></div>
                <div class="throttle-detent detent-app" style="top: 45%;"></div>
                <div class="throttle-detent detent-idle" style="top: 100%;"></div>
              </div>
            </div>
          </div>

          <!-- Quick Action Buttons Column on Left -->
          <div class="touch-left-actions">
            <button type="button" id="touch-btn-sound" class="btn-touch-pill active" title="소리 켜기 / 끄기 (M)" data-i18n-title="audio.volume.tooltip">
              <span class="pill-icon">🔊</span> VOL
            </button>
            <button type="button" id="touch-btn-reverser" class="btn-touch-pill" title="역추진 (Reverse Thrust)" data-i18n-title="reverse.thrust">
              <span class="pill-icon">⚡</span> REV
            </button>
            <button type="button" id="touch-btn-gear" class="btn-touch-pill active" title="랜딩 기어 (Gear)" data-i18n-title="landing.gear">
              <span class="pill-icon">🛞</span> GEAR
            </button>
            <button type="button" id="touch-btn-spoilers" class="btn-touch-pill" title="스포일러 (Spoilers)" data-i18n-title="spoilers">
              <span class="pill-icon">🛡️</span> SP OIL
            </button>
          </div>
        </div>

        <!-- Center Bottom: Rudder & Brakes Bar -->
        <div class="touch-quadrant touch-center">
          <!-- Hydraulic Wheel Brake Button -->
          <button type="button" id="touch-btn-brake" class="btn-touch-brake" title="휠 브레이크 (Hold to Brake)" data-i18n-title="wheel.brakes.hold.to.brake">
            <span class="brake-label">BRAKE</span>
            <span class="brake-sub">HOLD</span>
          </button>

          <!-- Rudder Slider -->
          <div class="touch-rudder-card">
            <div class="rudder-label-strip">
              <span>◄ L RUDDER</span>
              <span id="touch-rudder-val">0°</span>
              <span>R RUDDER ►</span>
            </div>
            <div id="touch-rudder-track" class="touch-rudder-track">
              <div class="rudder-center-notch"></div>
              <div id="touch-rudder-thumb" class="touch-rudder-thumb"></div>
            </div>
          </div>
        </div>

        <!-- Right Side: Virtual Stick & Secondary Controls -->
        <div class="touch-quadrant touch-right">
          <!-- Flaps & Camera Bar -->
          <div class="touch-right-actions">
            <button type="button" id="touch-btn-cam" class="btn-touch-pill" title="시점 변경 (Camera)" data-i18n-title="change.camera">
              <span class="pill-icon">🎥</span> CAM
            </button>
            <button type="button" id="touch-btn-flaps-dec" class="btn-touch-pill" title="플랩 - (Flaps Retract)" data-i18n-title="flaps.retract">
              FLAP -
            </button>
            <button type="button" id="touch-btn-flaps-inc" class="btn-touch-pill" title="플랩 + (Flaps Extend)" data-i18n-title="flaps.extend">
              FLAP +
            </button>
            <button type="button" id="touch-btn-gyro" class="btn-touch-pill" title="기기 기울기 자이로 센서 모드" data-i18n-title="gyroscope.device.tilt.mode">
              <span class="pill-icon">📱</span> GYRO
            </button>
          </div>

          <!-- Virtual Flight Stick Yoke -->
          <div class="touch-stick-card">
            <div class="touch-card-header">
              <span class="touch-label">FLIGHT YOKE</span>
              <span id="touch-stick-telemetry" class="touch-value">P: 0° | R: 0°</span>
            </div>
            <div id="touch-stick-zone" class="touch-stick-zone">
              <div class="stick-crosshair-h"></div>
              <div class="stick-crosshair-v"></div>
              <div class="stick-boundary"></div>
              <div id="touch-stick-knob" class="touch-stick-knob">
                <div class="knob-ring"></div>
                <div class="knob-dot"></div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(el);
    translateDOM(el);
    }

    this.overlay = el;
    this.stickZone = el.querySelector('#touch-stick-zone');
    this.stickKnob = el.querySelector('#touch-stick-knob');
    this.throttleTrack = el.querySelector('#touch-throttle-track');
    this.throttleThumb = el.querySelector('#touch-throttle-thumb');
    this.throttleFill = el.querySelector('#touch-throttle-fill');
    this.throttleReadout = el.querySelector('#touch-thr-val');
    this.rudderTrack = el.querySelector('#touch-rudder-track');
    this.rudderThumb = el.querySelector('#touch-rudder-thumb');
    this.brakeBtn = el.querySelector('#touch-btn-brake');
    this.gyroBtn = el.querySelector('#touch-btn-gyro');
    // Retain references when compact UI moves action groups into the menu.
    this.gearBtn = el.querySelector('#touch-btn-gear');
    this.spoilersBtn = el.querySelector('#touch-btn-spoilers');
    this.reverserBtn = el.querySelector('#touch-btn-reverser');
    this.soundBtn = el.querySelector('#touch-btn-sound');
    this.stickTelemetry = el.querySelector('#touch-stick-telemetry');
    this.rudderReadout = el.querySelector('#touch-rudder-val');
  }

  bindEvents() {
    if (!this.overlay) return;

    // 1. Virtual Stick Pointer Events
    this.stickZone.addEventListener('pointerdown', (e) => this.onStickPointerDown(e));
    this.stickZone.addEventListener('pointermove', (e) => this.onStickPointerMove(e));
    this.stickZone.addEventListener('pointerup', (e) => this.onStickPointerUp(e));
    this.stickZone.addEventListener('pointercancel', (e) => this.onStickPointerUp(e));

    // 2. Throttle Pointer Events
    this.throttleTrack.addEventListener('pointerdown', (e) => this.onThrottlePointerDown(e));
    this.throttleTrack.addEventListener('pointermove', (e) => this.onThrottlePointerMove(e));
    this.throttleTrack.addEventListener('pointerup', (e) => this.onThrottlePointerUp(e));
    this.throttleTrack.addEventListener('pointercancel', (e) => this.onThrottlePointerUp(e));

    // Throttle preset buttons
    const presetButtons = this.overlay.querySelectorAll('.btn-touch-preset');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const thr = parseFloat(btn.getAttribute('data-thr') || '0');
        this.setThrottleValue(thr);
        this.triggerHaptic(15);
      });
    });

    // 3. Rudder Pointer Events
    this.rudderTrack.addEventListener('pointerdown', (e) => this.onRudderPointerDown(e));
    this.rudderTrack.addEventListener('pointermove', (e) => this.onRudderPointerMove(e));
    this.rudderTrack.addEventListener('pointerup', (e) => this.onRudderPointerUp(e));
    this.rudderTrack.addEventListener('pointercancel', (e) => this.onRudderPointerUp(e));

    // 4. Brake Button (Hold to Brake)
    const startBraking = (e) => {
      e.preventDefault();
      this.brakeBtn.classList.add('active');
      this.controls.setTouchBrakes(1.0);
      this.triggerHaptic(20);
    };
    const stopBraking = (e) => {
      e.preventDefault();
      this.brakeBtn.classList.remove('active');
      this.controls.setTouchBrakes(0.0);
    };

    this.brakeBtn.addEventListener('pointerdown', startBraking);
    this.brakeBtn.addEventListener('pointerup', stopBraking);
    this.brakeBtn.addEventListener('pointercancel', stopBraking);
    this.brakeBtn.addEventListener('pointerleave', stopBraking);

    // 5. Quick Action Buttons
    this.overlay.querySelector('#touch-btn-sound')?.addEventListener('click', () => {
      if (this.controls.onUserInteract) this.controls.onUserInteract();
      if (this.controls.onToggleAudio) this.controls.onToggleAudio();
      this.triggerHaptic(20);
    });

    this.overlay.querySelector('#touch-btn-gear')?.addEventListener('click', () => {
      if (this.controls.onUserInteract) this.controls.onUserInteract();
      if (this.controls.onToggleGear) this.controls.onToggleGear();
      this.triggerHaptic(25);
    });

    this.overlay.querySelector('#touch-btn-spoilers')?.addEventListener('click', () => {
      if (this.controls.onToggleSpoilers) this.controls.onToggleSpoilers();
      this.triggerHaptic(20);
    });

    this.overlay.querySelector('#touch-btn-reverser')?.addEventListener('click', () => {
      if (this.controls.onToggleReverser) this.controls.onToggleReverser();
      this.triggerHaptic(30);
    });

    this.overlay.querySelector('#touch-btn-cam')?.addEventListener('click', () => {
      if (this.controls.onCycleCamera) this.controls.onCycleCamera();
      this.triggerHaptic(15);
    });

    this.overlay.querySelector('#touch-btn-flaps-inc')?.addEventListener('click', () => {
      if (this.controls.onCycleFlaps) this.controls.onCycleFlaps(1);
      this.triggerHaptic(20);
    });

    this.overlay.querySelector('#touch-btn-flaps-dec')?.addEventListener('click', () => {
      if (this.controls.onCycleFlaps) this.controls.onCycleFlaps(-1);
      this.triggerHaptic(20);
    });

    // 6. Gyroscope Toggle Button
    this.gyroBtn?.addEventListener('click', () => this.toggleGyro());
  }

  /* ---------------- Virtual Stick Handling ---------------- */
  updateStickGeometry() {
    const rect = this.stickZone.getBoundingClientRect();
    this.stickCenterX = rect.left + rect.width * 0.5;
    this.stickCenterY = rect.top + rect.height * 0.5;
    // Keep the entire knob inside the zone, including its border, after resize.
    const knobSize = Math.max(this.stickKnob.offsetWidth, this.stickKnob.offsetHeight);
    this.stickRadius = Math.max(1, (Math.min(rect.width, rect.height) - knobSize) * 0.5 - 2);
  }

  onStickPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.controls.onUserInteract) this.controls.onUserInteract();
    this.stickActive = true;
    this.stickPointerId = e.pointerId;
    this.stickZone.setPointerCapture(e.pointerId);

    this.updateStickGeometry();

    this.updateStickPosition(e.clientX, e.clientY);
  }

  onStickPointerMove(e) {
    if (!this.stickActive || e.pointerId !== this.stickPointerId) return;
    this.updateStickPosition(e.clientX, e.clientY);
  }

  onStickPointerUp(e) {
    if (!this.stickActive || e.pointerId !== this.stickPointerId) return;
    this.stickActive = false;
    this.stickPointerId = null;

    // Smooth spring back to center
    this.stickCurrentX = 0;
    this.stickCurrentY = 0;
    if (this.stickKnob) {
      this.stickKnob.style.transform = `translate(0px, 0px)`;
    }

    if (!this.gyroActive) {
      this.controls.setTouchStick(0.0, 0.0);
    }
    this.updateStickTelemetry(0.0, 0.0);
  }

  updateStickPosition(clientX, clientY) {
    let dx = clientX - this.stickCenterX;
    let dy = clientY - this.stickCenterY;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.stickRadius) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * this.stickRadius;
      dy = Math.sin(angle) * this.stickRadius;
    }

    this.stickCurrentX = dx;
    this.stickCurrentY = dy;

    if (this.stickKnob) {
      this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    // Aviation Standard Yoke Deflection:
    // Pull stick down (dy > 0) -> Nose UP (Elevator > 0, climb)
    // Push stick up (dy < 0) -> Nose DOWN (Elevator < 0, dive)
    // Push stick right (dx > 0) -> Bank RIGHT (Aileron > 0)
    // Push stick left (dx < 0) -> Bank LEFT (Aileron < 0)
    const normRoll = dx / this.stickRadius;
    const normPitch = dy / this.stickRadius;

    if (!this.gyroActive) {
      this.controls.setTouchStick(normPitch, normRoll);
    }
    this.updateStickTelemetry(normPitch, normRoll);
  }

  updateStickTelemetry(pitch, roll) {
    if (this.stickTelemetry) {
      const pDeg = Math.round(pitch * 25);
      const rDeg = Math.round(roll * 30);
      this.stickTelemetry.textContent = `P: ${pDeg > 0 ? '+' : ''}${pDeg}° | R: ${rDeg > 0 ? '+' : ''}${rDeg}°`;
    }
  }

  /* ---------------- Throttle Quadrant Handling ---------------- */
  onThrottlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.controls.onUserInteract) this.controls.onUserInteract();
    this.throttleActive = true;
    this.throttlePointerId = e.pointerId;
    this.throttleTrack.setPointerCapture(e.pointerId);
    this.updateThrottleFromPointer(e.clientY);
  }

  onThrottlePointerMove(e) {
    if (!this.throttleActive || e.pointerId !== this.throttlePointerId) return;
    this.updateThrottleFromPointer(e.clientY);
  }

  onThrottlePointerUp(e) {
    if (!this.throttleActive || e.pointerId !== this.throttlePointerId) return;
    this.throttleActive = false;
    this.throttlePointerId = null;
  }

  updateThrottleFromPointer(clientY) {
    const rect = this.throttleTrack.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    // Top of track = 1.0 (TOGA), bottom = 0.0 (IDLE)
    const clampedY = Math.max(0, Math.min(rect.height, relativeY));
    const normalized = 1.0 - (clampedY / rect.height);
    this.setThrottleValue(normalized);
  }

  setThrottleValue(val) {
    const clamped = Math.max(0.0, Math.min(1.0, val));
    this.controls.setTouchThrottle(clamped);

    // Update UI Elements
    const pct = Math.round(clamped * 100);
    if (this.throttleReadout) {
      let label = `${pct}%`;
      if (pct >= 98) label = 'TOGA 100%';
      else if (pct >= 82 && pct <= 88) label = 'CLB 85%';
      else if (pct <= 2) label = 'IDLE';
      this.throttleReadout.textContent = label;
    }

    if (this.throttleFill) {
      this.throttleFill.style.height = `${pct}%`;
    }
    if (this.throttleThumb) {
      // 0% throttle is bottom (100% top offset), 100% throttle is top (0% top offset)
      this.throttleThumb.style.top = `${(1.0 - clamped) * 100}%`;
    }
  }

  /* ---------------- Rudder Bar Handling ---------------- */
  onRudderPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.controls.onUserInteract) this.controls.onUserInteract();
    this.rudderActive = true;
    this.rudderPointerId = e.pointerId;
    this.rudderTrack.setPointerCapture(e.pointerId);

    const rect = this.rudderTrack.getBoundingClientRect();
    this.rudderCenterX = rect.left + rect.width * 0.5;
    this.rudderMaxDeflection = (rect.width * 0.5) - 16;
    this.updateRudderFromPointer(e.clientX);
  }

  onRudderPointerMove(e) {
    if (!this.rudderActive || e.pointerId !== this.rudderPointerId) return;
    this.updateRudderFromPointer(e.clientX);
  }

  onRudderPointerUp(e) {
    if (!this.rudderActive || e.pointerId !== this.rudderPointerId) return;
    this.rudderActive = false;
    this.rudderPointerId = null;

    // Auto-center rudder
    if (this.rudderThumb) {
      this.rudderThumb.style.transform = `translateX(0px)`;
    }
    this.controls.setTouchRudder(0.0);
    if (this.rudderReadout) this.rudderReadout.textContent = '0°';
  }

  updateRudderFromPointer(clientX) {
    let dx = clientX - this.rudderCenterX;
    dx = Math.max(-this.rudderMaxDeflection, Math.min(this.rudderMaxDeflection, dx));

    if (this.rudderThumb) {
      this.rudderThumb.style.transform = `translateX(${dx}px)`;
    }

    const normRudder = dx / this.rudderMaxDeflection;
    this.controls.setTouchRudder(normRudder);

    if (this.rudderReadout) {
      const deg = Math.round(normRudder * 30);
      this.rudderReadout.textContent = `${deg > 0 ? '+' : ''}${deg}°`;
    }
  }

  /* ---------------- Gyroscope / Tilt Flight Mode ---------------- */
  async toggleGyro() {
    if (this.gyroActive) {
      this.disableGyro();
      return;
    }

    // Check permission for iOS 13+ devices
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === 'granted') {
          this.enableGyro();
        } else {
          alert(t('permission.to.access.the.device.tilt.sensor'));
        }
      } catch (err) {
        console.warn('DeviceOrientation permission error:', err);
      }
    } else if (window.DeviceOrientationEvent) {
      this.enableGyro();
    } else {
      alert(t('this.device.does.not.support.gyroscope.tilt'));
    }
  }

  enableGyro() {
    this.gyroActive = true;
    this.handleOrientation = this.handleOrientation.bind(this);
    window.addEventListener('deviceorientation', this.handleOrientation);
    if (this.gyroBtn) {
      this.gyroBtn.classList.add('active');
      this.gyroBtn.innerHTML = '<span class="pill-icon">📱</span> TILT: ON';
    }
    this.triggerHaptic([30, 50, 30]);
  }

  disableGyro() {
    this.gyroActive = false;
    window.removeEventListener('deviceorientation', this.handleOrientation);
    if (this.gyroBtn) {
      this.gyroBtn.classList.remove('active');
      this.gyroBtn.innerHTML = '<span class="pill-icon">📱</span> GYRO';
    }
    this.controls.setTouchStick(0.0, 0.0);
    this.updateStickTelemetry(0.0, 0.0);
  }

  handleOrientation(e) {
    if (!this.gyroActive) return;

    // Beta: Front-to-back tilt in degrees (-180 to 180) -> Pitch
    // Gamma: Left-to-right tilt in degrees (-90 to 90) -> Roll
    const rawBeta = e.beta || 0;
    const rawGamma = e.gamma || 0;

    // Offset relative to comfortable resting angle (~38°)
    const deltaPitchDeg = rawBeta - this.gyroZeroPitch;
    const deltaRollDeg = rawGamma - this.gyroZeroRoll;

    // Map to normalized range [-1.0, 1.0]
    // Tilt forward (deltaPitchDeg < 0) -> Nose Down (Elevator < 0)
    // Tilt backward (deltaPitchDeg > 0) -> Nose Up (Elevator > 0)
    const normPitch = Math.max(-1.0, Math.min(1.0, (deltaPitchDeg / 25.0)));
    const normRoll = Math.max(-1.0, Math.min(1.0, (deltaRollDeg / 30.0)));

    this.controls.setTouchStick(normPitch, normRoll);
    this.updateStickTelemetry(normPitch, normRoll);

    // Update virtual stick graphic to match gyro deflection
    if (this.stickKnob && !this.stickActive) {
      this.updateStickGeometry();
      const magnitude = Math.max(1, Math.hypot(normRoll, normPitch));
      const gx = normRoll / magnitude * this.stickRadius;
      const gy = normPitch / magnitude * this.stickRadius;
      this.stickKnob.style.transform = `translate(${gx}px, ${gy}px)`;
    }
  }

  /* ---------------- Sync Telemetry State to Buttons ---------------- */
  updateUI(telemetry) {
    if (!telemetry) return;

    // Sync throttle display if not actively dragging
    if (!this.throttleActive) {
      const currentThr = this.controls.throttle;
      const pct = Math.round(currentThr * 100);
      if (this.throttleFill) this.throttleFill.style.height = `${pct}%`;
      if (this.throttleThumb) this.throttleThumb.style.top = `${(1.0 - currentThr) * 100}%`;
      if (this.throttleReadout) this.throttleReadout.textContent = `${pct}%`;
    }

    // Sync Gear Button
    const gearBtn = this.gearBtn;
    if (gearBtn) {
      const isDown = telemetry.gearState > 0.5;
      gearBtn.className = isDown ? 'btn-touch-pill active' : 'btn-touch-pill';
      gearBtn.innerHTML = `<span class="pill-icon">🛞</span> ${telemetry.gearState > 0.95 ? 'GEAR DN' : (telemetry.gearState < 0.05 ? 'GEAR UP' : 'TRANS')}`;
    }

    // Sync Spoilers Button
    const spBtn = this.spoilersBtn;
    if (spBtn) {
      const isExt = telemetry.spoilers > 0.1;
      spBtn.className = isExt ? 'btn-touch-pill active' : 'btn-touch-pill';
    }

    // Sync Reverser Button
    const revBtn = this.reverserBtn;
    if (revBtn) {
      const isRev = telemetry.engine1?.reverserActive;
      revBtn.className = isRev ? 'btn-touch-pill active-amber' : 'btn-touch-pill';
    }
  }

  /* ---------------- Audio UI State ---------------- */
  updateAudioUI(state) {
    if (!this.overlay || !state) return;
    const soundBtn = this.soundBtn;
    if (!soundBtn) return;
    if (state.muted) {
      soundBtn.className = 'btn-touch-pill muted';
      soundBtn.innerHTML = '<span class="pill-icon">🔇</span> OFF';
    } else {
      soundBtn.className = 'btn-touch-pill active';
      soundBtn.innerHTML = '<span class="pill-icon">🔊</span> 100%';
    }
  }

  /* ---------------- Visibility & Toggle ---------------- */
  enable() {
    this.enabled = true;
    if (typeof document !== 'undefined') {
      document.body.classList.add('touch-mode');
    }
    if (this.overlay) {
      this.overlay.style.display = 'flex';
    }
    const toggleBtn = document.getElementById('btn-touch-toggle');
    if (toggleBtn) {
      toggleBtn.classList.add('active');
    }
  }

  disable() {
    this.enabled = false;
    if (typeof document !== 'undefined') {
      document.body.classList.remove('touch-mode');
    }
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
    if (this.gyroActive) {
      this.disableGyro();
    }
    this.controls.setTouchStick(0.0, 0.0);
    this.controls.setTouchRudder(0.0);
    this.controls.setTouchBrakes(0.0);
    const toggleBtn = document.getElementById('btn-touch-toggle');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
    }
  }

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  triggerHaptic(ms = 15) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {}
    }
  }
}
