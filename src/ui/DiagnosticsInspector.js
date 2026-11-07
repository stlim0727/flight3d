import { t, translateDOM } from '../i18n/index.js';
/**
 * @file DiagnosticsInspector.js
 * @description Real-time In-Game Aerodynamic Physics Inspector & Live Parameter Tuning Panel.
 * Enables live telemetry inspection, performance metric tracking (FPS, substepping, memory),
 * and dynamic on-the-fly aerodynamic derivative adjustments without reloading.
 */
export class DiagnosticsInspector {
  constructor(simulator) {
    this.sim = simulator;
    this.visible = false;

    // Rolling telemetry history for graph
    this.historyLength = 120;
    this.gHistory = new Float32Array(this.historyLength);
    this.aoaHistory = new Float32Array(this.historyLength);
    this.historyIndex = 0;

    // Performance tracking
    this.fps = 60;
    this.frameTimeMs = 16.6;
    this.lastTimestamp = performance.now();
    this.frameCount = 0;

    this.createDOM();
    this.initListeners();
  }

  createDOM() {
    this.panel = document.createElement('div');
    this.panel.id = 'diagnostics-panel';
    this.panel.className = 'diagnostics-panel';
    this.panel.innerHTML = `
      <div class="diag-header">
        <span class="diag-title"><span data-i18n="physics.aerodynamics.inspector">🔬 실시간 물리 & 항공역학 진단기 (Physics Inspector)</span></span>
        <div class="diag-header-actions">
          <button id="diag-fold" class="btn btn-card-fold diag-fold-btn" type="button" title="접기" aria-label="Fold" data-i18n-title="ui.fold" data-i18n-aria-label="ui.fold">&minus;</button>
          <button id="diag-close" class="diag-close-btn">&times;</button>
        </div>
      </div>

      <div class="diag-content">
        <!-- Performance Metrics -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="performance.physics.metrics">⚡ 성능 & 물리 연산 지표 (Metrics)</span></div>
          <div class="diag-row"><span class="k">FPS / Frame Time</span><span id="m-fps" class="v cyan">60 FPS (16.6 ms)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="physics.substep.frequency">물리 연산 주파수 (Substep)</span></span><span id="m-substep" class="v">120 Hz (2 ticks/f)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="aircraft.mass">현재 기체 질량</span></span><span id="m-mass" class="v">66,000 kg</span></div>
        </div>

        <!-- Input latency & boot responsiveness -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="performance.input.latency">⏱ Input latency & boot responsiveness</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="input.latency.last.click">Last input: paint / handler wait</span></span><span id="m-input-last" class="v">–</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="input.latency.worst.5s">Worst handler wait (30 s)</span></span><span id="m-input-worst" class="v">–</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="input.latency.long.tasks">Long tasks (5 s / max)</span></span><span id="m-input-longtask" class="v">–</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="input.latency.boot.first.input">First input after page load</span></span><span id="m-input-boot" class="v">–</span></div>
        </div>

        <!-- Terrain PBR Rendering Metrics & Controls -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="terrain.pbr.shaders.triplanar.mapping">🏔️ 지형 PBR 셰이더 & 트라이플래너 (Terrain)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="quality.preset">품질 프리셋 (Quality)</span></span><span id="m-terrain-quality" class="v cyan">HIGH (5 Layers + Triplanar)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="height.above.terrain.agl">지표면 고도 (AGL Height)</span></span><span id="m-terrain-h" class="v">12.0 m</span></div>
          <button id="btn-toggle-terrain-quality" class="btn btn-demo-skip" style="margin-top:6px; width:100%;"><span data-i18n="toggle.terrain.quality.high.low">지형 품질 전환 [High ⇄ Low]</span></button>
        </div>

        <!-- Aircraft 3D Model & IBL Reflection Metrics -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="aircraft.pbr.model.ibl.reflections">✈️ 기체 PBR 모델 & IBL 환경 반사 (Aircraft)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="model.format">모델 포맷 (Model Format)</span></span><span id="m-aircraft-model" class="v cyan">GLTF PBR (237 KB)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="environment.reflections.ibl.sky.map">환경 반사 (IBL Sky Map)</span></span><span id="m-aircraft-ibl" class="v green">ACTIVE (1K HDR)</span></div>
        </div>

        <!-- Live Forces & Aerodynamic Vectors -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="aerodynamic.forces">✈️ 실시간 공력 & 힘 벡터 (Forces)</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="lift.weight">양력 (Lift) / 중력 (Weight)</span></span><span id="m-lift" class="v green">0 kN / 647 kN</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="thrust.drag">추력 (Thrust) / 항력 (Drag)</span></span><span id="m-thrust" class="v amber">0 kN / 0 kN</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="angle.of.attack.sideslip">받음각 (AoA) / 옆미끄럼 (Beta)</span></span><span id="m-aoa" class="v">0.0° / 0.0°</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="dynamic.pressure.q">동압 (Dynamic Pressure q)</span></span><span id="m-qdyn" class="v">0 Pa</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="radar.altitude.agl">대지 레이더 고도 (AGL)</span></span><span id="m-radalt" class="v">0 FT</span></div>
          <div class="diag-row"><span class="k"><span data-i18n="stall.severity">실속 상태 (Stall Severity)</span></span><span id="m-stall" class="v status-green">NORMAL (0%)</span></div>
        </div>

        <!-- Telemetry Sparkline Canvas -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="g.force.aoa.history">📈 실시간 G-Force & 받음각 그래프</span></div>
          <canvas id="diag-sparkline" width="320" height="60" class="sparkline-canvas"></canvas>
          <div class="sparkline-legend">
            <span class="leg-item"><span class="dot green"></span> G-Force</span>
            <span class="leg-item"><span class="dot cyan"></span> AoA (deg)</span>
          </div>
        </div>

        <!-- Live Tuning Sliders -->
        <div class="diag-section">
          <div class="diag-subheading"><span data-i18n="live.physics.tuning">🎛️ 실시간 물리 튜닝 (Live Tuning Sliders)</span></div>
          
          <div class="tune-control">
            <div class="tune-lbl"><span><span data-i18n="elevator.authority">피치 반응성 (Elevator Authority)</span></span><span id="val-elev">1.0x</span></div>
            <input type="range" id="tune-elev" min="0.3" max="2.5" step="0.05" value="1.0">
          </div>

          <div class="tune-control">
            <div class="tune-lbl"><span><span data-i18n="aileron.authority">롤 반응성 (Aileron Authority)</span></span><span id="val-aileron">1.0x</span></div>
            <input type="range" id="tune-aileron" min="0.3" max="2.5" step="0.05" value="1.0">
          </div>

          <div class="tune-control">
            <div class="tune-lbl"><span><span data-i18n="rudder.yaw.authority">러더/요 반응성 (Rudder Authority)</span></span><span id="val-rudder">1.0x</span></div>
            <input type="range" id="tune-rudder" min="0.3" max="2.5" step="0.05" value="1.0">
          </div>

          <div class="tune-control">
            <div class="tune-lbl"><span><span data-i18n="critical.stall.aoa">임계 실속각 (Stall Critical AoA)</span></span><span id="val-stall">15.5°</span></div>
            <input type="range" id="tune-stall" min="0.7" max="1.5" step="0.05" value="1.0">
          </div>

          <div class="tune-control">
            <div class="tune-lbl"><span><span data-i18n="ground.effect.strength">지면 효과 강도 (Ground Effect)</span></span><span id="val-ge">1.0x</span></div>
            <input type="range" id="tune-ge" min="0.0" max="2.0" step="0.1" value="1.0">
          </div>

          <button id="btn-reset-tuning" class="btn btn-reset"><span data-i18n="reset.to.factory.specifications">공장 초기치로 복원 (Reset Specs)</span></button>
        </div>
      </div>
    `;

    document.body.appendChild(this.panel);
    translateDOM(this.panel);

    // Sparkline Canvas context
    const cvs = document.getElementById('diag-sparkline');
    this.sparkCtx = cvs.getContext('2d');
  }

  initListeners() {
    // Toggle key: Backtick (`) or F3
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });

    document.getElementById('diag-close')?.addEventListener('click', () => {
      this.hide();
    });

    const foldBtn = document.getElementById('diag-fold');
    foldBtn?.addEventListener('click', () => {
      const isFolded = this.panel.classList.toggle('is-folded');
      foldBtn.textContent = isFolded ? '+' : '−';
    });

    // Tuning Sliders
    const aero = this.sim.aero;

    document.getElementById('tune-elev')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      aero.tuning.elevatorSensitivity = v;
      document.getElementById('val-elev').textContent = `${v.toFixed(2)}x`;
    });

    document.getElementById('tune-aileron')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      aero.tuning.aileronSensitivity = v;
      document.getElementById('val-aileron').textContent = `${v.toFixed(2)}x`;
    });

    document.getElementById('tune-rudder')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      aero.tuning.rudderSensitivity = v;
      document.getElementById('val-rudder').textContent = `${v.toFixed(2)}x`;
    });

    document.getElementById('tune-stall')?.addEventListener('input', (e) => {
      const mult = parseFloat(e.target.value);
      aero.tuning.stallAngleMultiplier = mult;
      const deg = (15.5 * mult).toFixed(1);
      document.getElementById('val-stall').textContent = `${deg}°`;
    });

    document.getElementById('tune-ge')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      aero.tuning.groundEffectMultiplier = v;
      document.getElementById('val-ge').textContent = `${v.toFixed(1)}x`;
    });

    document.getElementById('btn-reset-tuning')?.addEventListener('click', () => {
      aero.tuning.elevatorSensitivity = 1.0;
      aero.tuning.aileronSensitivity = 1.0;
      aero.tuning.rudderSensitivity = 1.0;
      aero.tuning.stallAngleMultiplier = 1.0;
      aero.tuning.groundEffectMultiplier = 1.0;

      document.getElementById('tune-elev').value = '1.0';
      document.getElementById('tune-aileron').value = '1.0';
      document.getElementById('tune-rudder').value = '1.0';
      document.getElementById('tune-stall').value = '1.0';
      document.getElementById('tune-ge').value = '1.0';

      document.getElementById('val-elev').textContent = '1.00x';
      document.getElementById('val-aileron').textContent = '1.00x';
      document.getElementById('val-rudder').textContent = '1.00x';
      document.getElementById('val-stall').textContent = '15.5°';
      document.getElementById('val-ge').textContent = '1.0x';

      this.sim.showToast(() => t('tuning.reset.to.boeing.737.factory.specifications'));
    });

    document.getElementById('btn-toggle-terrain-quality')?.addEventListener('click', () => {
      if (!this.sim.terrain) return;
      const cur = this.sim.terrain.getQuality();
      const next = cur === 'high' ? 'low' : 'high';
      this.sim.terrain.setQuality(next);
      const qEl = document.getElementById('m-terrain-quality');
      if (qEl) {
        qEl.textContent = next === 'high' ? 'HIGH (5 Layers + Triplanar)' : 'LOW (2 Layers Planar)';
        qEl.className = next === 'high' ? 'v cyan' : 'v amber';
      }
      this.sim.showToast(() => t('terrain.rendering.quality.value', { value: next.toUpperCase() }));
    });
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) {
      this.panel.classList.add('visible');
    } else {
      this.panel.classList.remove('visible');
    }
  }

  hide() {
    this.visible = false;
    this.panel.classList.remove('visible');
  }

  show() {
    this.visible = true;
    this.panel.classList.add('visible');
  }

  update(dt, telemetry) {
    // Keep recording while closed so opening the inspector shows flight history.
    this.gHistory[this.historyIndex] = telemetry.gForce ?? 1.0;
    this.aoaHistory[this.historyIndex] = this.sim.aero.alpha * 180 / Math.PI;
    this.historyIndex = (this.historyIndex + 1) % this.historyLength;
    if (!this.visible) return;

    // Track FPS
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastTimestamp >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastTimestamp));
      this.frameTimeMs = ((now - this.lastTimestamp) / this.frameCount).toFixed(1);
      this.frameCount = 0;
      this.lastTimestamp = now;
    }

    // Update DOM text
    const elFps = document.getElementById('m-fps');
    if (elFps) elFps.textContent = `${this.fps} FPS (${this.frameTimeMs} ms)`;

    this.updateLatencyRows();

    const aero = this.sim.aero;
    const engines = this.sim.engines;

    // Lift vs Weight
    const liftKn = Math.round((aero.lift || 0) / 1000);
    const weightKn = Math.round((aero.mass * 9.80665) / 1000);
    const elLift = document.getElementById('m-lift');
    if (elLift) elLift.textContent = `${liftKn} kN / ${weightKn} kN`;

    // Thrust vs Drag
    const thrustKn = Math.round((engines.thrust[0] + engines.thrust[1]) / 1000);
    const dragKn = Math.round((aero.drag || 0) / 1000);
    const elThrust = document.getElementById('m-thrust');
    if (elThrust) elThrust.textContent = `${thrustKn} kN / ${dragKn} kN`;

    // AoA & Sideslip
    const elAoa = document.getElementById('m-aoa');
    if (elAoa) elAoa.textContent = `${(aero.alpha * 57.2958).toFixed(1)}° / ${(aero.beta * 57.2958).toFixed(1)}°`;

    // Dynamic Pressure
    const elQ = document.getElementById('m-qdyn');
    if (elQ) elQ.textContent = `${Math.round(aero.qDyn || 0)} Pa`;

    // Terrain status
    if (this.sim.terrain) {
      const q = this.sim.terrain.getQuality();
      const qEl = document.getElementById('m-terrain-quality');
      if (qEl) {
        qEl.textContent = q === 'high' ? 'HIGH (5 Layers + Triplanar)' : 'LOW (2 Layers Planar)';
        qEl.className = q === 'high' ? 'v cyan' : 'v amber';
      }
      const hEl = document.getElementById('m-terrain-h');
      if (hEl && telemetry) {
        const gh = this.sim.terrain.getHeight(telemetry.x || 0, telemetry.z || 0);
        hEl.textContent = `${gh.toFixed(1)} m`;
      }
    }

    // Aircraft PBR & IBL status
    if (this.sim.aircraft) {
      const elModel = document.getElementById('m-aircraft-model');
      if (elModel) {
        elModel.textContent = this.sim.aircraft.useGltf ? 'GLTF PBR (237 KB)' : 'Procedural Mesh (Fallback)';
        elModel.className = this.sim.aircraft.useGltf ? 'v cyan' : 'v amber';
      }
      const elIbl = document.getElementById('m-aircraft-ibl');
      if (elIbl) {
        const hasIbl = Boolean(this.sim.scene && this.sim.scene.environment);
        elIbl.textContent = hasIbl ? 'ACTIVE (1K HDR)' : 'STANDARD';
        elIbl.className = hasIbl ? 'v green' : 'v';
      }
    }

    // Radio Alt
    const elRadAlt = document.getElementById('m-radalt');
    if (elRadAlt) elRadAlt.textContent = `${Math.round(telemetry.radioAltFt || 0)} FT`;

    // Stall
    const elStall = document.getElementById('m-stall');
    if (elStall) {
      if (aero.isStalled) {
        elStall.textContent = `STALL CRITICAL (${Math.round(aero.stallSeverity * 100)}%)`;
        elStall.className = 'v status-amber';
      } else {
        elStall.textContent = 'NORMAL FLOW';
        elStall.className = 'v status-green';
      }
    }

    // Draw Sparkline Graph
    this.drawSparkline();
  }

  /** Live input-latency rows; collection always runs in the monitor, we only paint here. */
  updateLatencyRows() {
    const lat = this.sim.inputLatency?.snapshot?.();
    if (!lat) return;
    const setRow = (id, text, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      if (cls) el.className = `v ${cls}`;
    };
    const latencyClass = ms => (ms === null || ms === undefined ? '' : ms < 50 ? 'status-green' : ms < 150 ? 'status-amber' : 'status-red');
    const last = lat.last;
    const win = lat.worst30s || {};
    setRow('m-input-last', last
      ? `${last.totalMs} ms paint / ${last.processingMs ?? '–'} ms wait (${last.type}, ${last.source})`
      : '–', latencyClass(last?.processingMs));
    setRow('m-input-worst', `${win.worstProcessingMs ?? '–'} ms (n=${win.inputs || 0})`, latencyClass(win.worstProcessingMs));
    const lt = lat.longTasks5s;
    setRow('m-input-longtask', lt.count ? `${lt.count} / ${lt.maxMs} ms` : 'none', lt.count ? 'status-amber' : 'status-green');
    const boot = lat.boot;
    setRow('m-input-boot', boot.firstInputMs === null ? 'no input yet'
      : `+${(boot.firstInputMs / 1000).toFixed(1)}s → ${boot.firstInputLatencyMs} ms paint`,
    latencyClass(boot.firstInputLatencyMs));
  }

  drawSparkline() {
    const ctx = this.sparkCtx;
    if (!ctx) return;

    const w = 320;
    const h = 60;
    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.fillStyle = '#0a101d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    // 1. Draw G-Force Line (Green: scale 0G to 3G mapped to h)
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < this.historyLength; i++) {
      const idx = (this.historyIndex + i) % this.historyLength;
      const g = this.gHistory[idx];
      const x = (i / (this.historyLength - 1)) * w;
      // Map 0G..3G to h..0
      const y = h - (g / 3.0) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 2. Draw AoA Line (Cyan: scale -5° to +25° mapped to h)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < this.historyLength; i++) {
      const idx = (this.historyIndex + i) % this.historyLength;
      const aoa = this.aoaHistory[idx];
      const x = (i / (this.historyLength - 1)) * w;
      // Map -5°..+25° to h..0
      const normAoa = Math.max(0, Math.min(1, (aoa + 5.0) / 30.0));
      const y = h - normAoa * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
