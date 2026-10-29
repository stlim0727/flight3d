import { CameraSystem } from '../cameras/CameraSystem.js';
import { bindText, t } from '../i18n/index.js';
import { hudDirection, projectHudDirection } from './HudProjection.js';

/** HUD is a camera presentation; all commands use the existing flight controls. */
export class HudView {
  constructor(sim) {
    this.sim = sim;
    this.root = document.createElement('section');
    this.root.id = 'hud-view';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'HUD');
    this.root.innerHTML = `
      <canvas class="hud-flight-glass" aria-hidden="true"></canvas>
      <nav class="hud-camera-switch" aria-label="Camera">
        <button type="button" id="hud-camera-prev">‹</button><span>CAM <b>HUD</b></span>
        <button type="button" id="hud-camera-next">›</button>
      </nav>
      <div class="hud-side hud-side-left">
        <div class="hud-control-card"><span data-hud-label="hud.trim"></span><output id="hud-trim-value"></output>
          <div class="hud-pair"><button type="button" id="hud-trim-less">−</button><button type="button" id="hud-trim-more">+</button></div></div>
        <div class="hud-control-card"><span data-hud-label="hud.flaps"></span><output id="hud-flaps-value"></output>
          <div class="hud-pair"><button type="button" id="hud-flaps-less">−</button><button type="button" id="hud-flaps-more">+</button></div></div>
        <button type="button" id="hud-park-brake" data-hud-label="hud.brake" aria-pressed="false"></button>
      </div>
      <div class="hud-side hud-side-right">
        <button type="button" id="hud-autopilot" aria-controls="ap-panel" aria-expanded="false">AP OFF</button>
        <button type="button" id="hud-systems" data-hud-label="hud.systems" aria-controls="hud-systems-panel" aria-expanded="false"></button>
        ${['time', 'plan', 'ground', 'map'].map(name => `<button type="button" class="hud-unavailable" disabled><span data-hud-label="hud.${name}"></span><small data-hud-label="hud.soon"></small></button>`).join('')}
      </div>
      <div id="hud-systems-panel" class="hud-systems-panel" hidden></div>
      <footer class="hud-flight-footer">${[['speed','AIRSPEED'], ['altitude','ALTITUDE MSL'], ['heading','HEADING'], ['vsi','VERT SPEED'], ['fuel','FUEL'], ['camera','CAM']].map(([name,label]) => `<div><span>${label}</span><output id="hud-footer-${name}"></output></div>`).join('')}</footer>`;
    document.getElementById('hud-overlay').append(this.root);
    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.nodes = Object.fromEntries([...this.root.querySelectorAll('[id]')].map(node => [node.id, node]));
    for (const node of this.root.querySelectorAll('[data-hud-label]')) {
      bindText(node, () => t(node.dataset.hudLabel));
    }
    const on = (id, action) => this.nodes[id].addEventListener('click', action);
    const proxy = id => document.getElementById(id)?.click();
    const cycle = delta => {
      const views = CameraSystem.QUICK_CYCLE;
      const index = views.indexOf(sim.cameraSystem.mode);
      sim.controls.onSelectCamera(views[(index + delta + views.length) % views.length]);
    };
    on('hud-camera-prev', () => cycle(-1));
    on('hud-camera-next', () => cycle(1));
    for (const [id, key] of [['hud-camera-prev','hud.previous'], ['hud-camera-next','hud.next'],
      ['hud-trim-less','hud.trim.less'], ['hud-trim-more','hud.trim.more'],
      ['hud-flaps-less','ui.flaps.less'], ['hud-flaps-more','ui.flaps.more']]) {
      bindText(this.nodes[id], () => t(key, { angle: '' }), 'aria-label');
    }
    for (const [id, sign] of [['hud-trim-less', -1], ['hud-trim-more', 1]]) {
      on(id, () => {
        if (this.flightControlsDisabled()) return;
        sim.aero.setTrim(sign * .2);
        sim.controls.pitchTrim = sim.aero.pitchTrim;
      });
    }
    on('hud-flaps-less', () => proxy('btn-flaps-ret'));
    on('hud-flaps-more', () => proxy('btn-flaps-ext'));
    on('hud-park-brake', () => {
      if (!this.flightControlsDisabled()) sim.controls.setParkingBrake(!sim.controls.parkingBrake);
    });
    on('hud-autopilot', () => proxy('btn-ap-toggle'));
    on('hud-systems', () => this.setSystemsOpen(this.nodes['hud-systems-panel'].hidden));
    // Reuse existing control handlers and their disabled states, including demo lockout.
    for (const source of ['btn-gear', 'btn-spoilers', 'btn-reverser', 'btn-mute', 'btn-fullscreen']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `hud-system-${source}`;
      button.addEventListener('click', () => proxy(source));
      this.nodes['hud-systems-panel'].append(button);
    }
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#hud-systems, #hud-systems-panel')) this.setSystemsOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (!this.root.hidden && event.key === 'Escape' && !this.nodes['hud-systems-panel'].hidden) {
        event.preventDefault(); event.stopPropagation();
        this.setSystemsOpen(false); this.nodes['hud-systems'].focus();
      }
    });
  }

  flightControlsDisabled() {
    return this.sim.controls.aircraftControlsDisabled || this.sim.controls.inputBlocked || this.sim.isCrashed;
  }

  setSystemsOpen(open) {
    this.nodes['hud-systems-panel'].hidden = !open;
    this.nodes['hud-systems'].setAttribute('aria-expanded', String(open));
  }

  update() {
    const sim = this.sim;
    const active = sim.cameraSystem.mode === CameraSystem.MODES.HUD && !sim.isCrashed;
    if (this.root.hidden === active) {
      // A removed mode must not leave keyboard focus inside hidden controls.
      const restoreFocus = !active && this.root.contains(document.activeElement);
      this.root.hidden = !active;
      document.body.classList.toggle('hud-camera-mode', active);
      if (restoreFocus) document.getElementById('open-camera')?.focus();
      this.setSystemsOpen(false);
    }
    if (!active) return;
    const data = sim.telemetry;
    const set = (id, value) => { if (this.nodes[id].textContent !== value) this.nodes[id].textContent = value; };
    const heading = ((Math.round(data.headingDeg || 0) % 360) + 360) % 360;
    set('hud-footer-speed', `${Math.round(data.iasKnots || 0)} KT`);
    set('hud-footer-altitude', `${Math.round(data.altitudeFt || 0).toLocaleString('en-US')} FT`);
    set('hud-footer-heading', `${String(heading).padStart(3, '0')}°`);
    const vsi = Math.round((data.vsiFpm || 0) / 10) * 10;
    set('hud-footer-vsi', `${vsi > 0 ? '+' : ''}${vsi} FPM`);
    set('hud-footer-fuel', `${Math.round(Math.max(0, Math.min(100, 100 * (data.fuelKg || 0) / sim.engines.fuelCapacityKg)))}%`);
    set('hud-footer-camera', 'HUD');
    set('hud-trim-value', `${sim.controls.pitchTrim.toFixed(1)}°`);
    set('hud-flaps-value', `${Math.round(data.flapDegree || 0)}°`);
    set('hud-autopilot', `AP ${sim.autopilot.master ? 'ON' : 'OFF'} ▾`);
    this.nodes['hud-autopilot'].setAttribute('aria-expanded', document.getElementById('btn-ap-toggle').getAttribute('aria-expanded'));
    this.nodes['hud-autopilot'].classList.toggle('is-active', sim.autopilot.master);
    this.nodes['hud-park-brake'].setAttribute('aria-pressed', String(sim.controls.parkingBrake));
    const disabled = this.flightControlsDisabled();
    for (const id of ['hud-trim-less', 'hud-trim-more', 'hud-park-brake']) this.nodes[id].disabled = disabled;
    for (const [target, source] of [['hud-flaps-less', 'btn-flaps-ret'], ['hud-flaps-more', 'btn-flaps-ext']]) {
      this.nodes[target].disabled = disabled || document.getElementById(source).disabled;
    }
    for (const source of ['btn-gear', 'btn-spoilers', 'btn-reverser', 'btn-mute', 'btn-fullscreen']) {
      const button = document.getElementById(`hud-system-${source}`), original = document.getElementById(source);
      button.textContent = original.getAttribute('aria-label') || original.title || original.textContent;
      button.disabled = original.disabled;
      button.setAttribute('aria-pressed', original.getAttribute('aria-pressed') || 'false');
    }
    this.draw(data, heading);
  }

  draw(data, heading) {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(1, width / 1100);
    const narrow = width < 700, touch = document.body.classList.contains('touch-mode');
    const hy = height * (touch && (narrow || height < 550) ? .62 : .79);
    const font = Math.max(11, 15 * scale);
    ctx.strokeStyle = '#b8ff9b'; ctx.fillStyle = '#b8ff9b'; ctx.lineWidth = 1.5;
    ctx.font = `600 ${font}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#142b1c'; ctx.shadowBlur = 3;
    const project = (h, e) => projectHudDirection(hudDirection(h, e), this.sim.camera, width, height);
    const segment = (e, start, end) => {
      ctx.beginPath();
      let drawing = false;
      for (let h = start; h <= end + .01; h += .5) {
        const p = project(heading + h, e);
        if (!p) { drawing = false; continue; }
        if (drawing) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        drawing = true;
      }
      ctx.stroke();
    };
    // Clip only the conformal symbols: side tapes and menus retain fixed positions.
    ctx.save(); ctx.beginPath(); ctx.rect(width * (width < 700 ? .37 : .31), height * .14, width * (width < 700 ? .26 : .38), Math.max(0, hy - 35 - height * .14)); ctx.clip();
    for (let pitch = -80; pitch <= 80; pitch += 5) {
      ctx.setLineDash(pitch < 0 ? [5, 4] : []);
      const span = pitch === 0 ? 30 : 9;
      segment(pitch, -span, -2); segment(pitch, 2, span);
      if (pitch && pitch % 10 === 0) {
        for (const sign of [-1, 1]) {
          const p = project(heading + sign * 11, pitch);
          if (p) ctx.fillText(String(pitch), p.x, p.y);
        }
      }
    }
    ctx.restore(); ctx.setLineDash([]);
    const cx = width / 2, cy = height / 2;
    ctx.beginPath(); ctx.moveTo(cx - 42 * scale, cy); ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 42 * scale, cy); ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy - 9);
    ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
    // Portrait clipping leaves little room for ladder labels; retain a numeric pitch.
    if (narrow) {
      const forward = hudDirection(0, 0).applyQuaternion(this.sim.camera.quaternion);
      const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI;
      ctx.fillText(`${pitch > 0 ? '+' : ''}${pitch.toFixed(0)}°`, cx, cy + 25);
    }
    // Roll scale: aircraft pointer rotates against the fixed angle marks.
    const radius = Math.min(width * .14, height * .21), ry = height * .29;
    for (const degrees of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = degrees * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * radius, ry - Math.cos(a) * radius);
      ctx.lineTo(cx + Math.sin(a) * (radius + 8), ry - Math.cos(a) * (radius + 8)); ctx.stroke();
    }
    const up = hudDirection(0, 90).applyQuaternion(this.sim.camera.quaternion.clone().invert());
    const roll = Math.atan2(up.x, up.y);
    ctx.save(); ctx.translate(cx, ry); ctx.rotate(roll);
    ctx.beginPath(); ctx.moveTo(0, -radius + 5); ctx.lineTo(-5, -radius + 15); ctx.lineTo(5, -radius + 15); ctx.closePath(); ctx.stroke(); ctx.restore();
    this.tape(width * (narrow ? .29 : .265), height * .46, Math.max(0, data.iasKnots || 0), 10, 'KT', scale);
    this.tape(width * (narrow ? .71 : .735), height * .46, data.altitudeFt || 0, 100, 'FT', scale);
    ctx.fillText(`${data.vsiFpm > 0 ? '+' : ''}${Math.round(data.vsiFpm || 0)} FPM`, width * (narrow ? .71 : .735), height * .46 + Math.min(145, height * .21) + 22);
    const spacing = Math.max(2, Math.min(4, width / 360));
    ctx.save(); ctx.beginPath(); ctx.rect(cx - width * .18, hy - 22, width * .36, 55); ctx.clip();
    for (let delta = -60; delta <= 60; delta++) {
      const degree = heading + delta;
      if (degree % 5 !== 0) continue;
      const x = cx + delta * spacing;
      ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, hy + (degree % 10 === 0 ? 10 : 5)); ctx.stroke();
      if (degree % (narrow ? 30 : 10) === 0) ctx.fillText(String((degree % 360 + 360) % 360).padStart(3, '0'), x, hy + 23);
    }
    ctx.restore(); ctx.fillText(`${String(heading).padStart(3, '0')}°`, cx, hy - 13);
  }

  tape(x, y, value, step, unit, scale) {
    const ctx = this.ctx, half = Math.min(145, this.root.clientHeight * .21);
    const w = Math.max(54, 76 * scale), pixels = half / (step * 3);
    ctx.fillStyle = 'rgba(9,24,36,.45)'; ctx.fillRect(x - w / 2, y - half, w, half * 2);
    ctx.strokeStyle = '#b8ff9b'; ctx.strokeRect(x - w / 2, y - half, w, half * 2);
    ctx.fillStyle = '#b8ff9b'; ctx.fillText(unit, x, y - half - 14);
    ctx.save(); ctx.beginPath(); ctx.rect(x - w / 2, y - half + 1, w, half * 2 - 2); ctx.clip();
    for (let i = -4; i <= 4; i++) {
      const tick = Math.floor(value / step) * step + i * step;
      if (unit === 'KT' && tick < 0) continue;
      const ty = y - (tick - value) * pixels;
      ctx.beginPath(); ctx.moveTo(x + w / 2 - 9, ty); ctx.lineTo(x + w / 2, ty); ctx.stroke();
      ctx.fillText(String(tick), x - 3, ty);
    }
    ctx.restore();
    ctx.fillStyle = '#102a20'; ctx.fillRect(x - w / 2 - 3, y - 17, w + 6, 34);
    ctx.strokeRect(x - w / 2 - 3, y - 17, w + 6, 34);
    ctx.fillStyle = '#cbffb2'; ctx.font = `600 ${Math.max(16, 24 * scale)}px monospace`;
    ctx.fillText(String(Math.round(value)), x, y);
    ctx.font = `600 ${Math.max(11, 15 * scale)}px monospace`;
  }
}
