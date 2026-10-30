import { CameraSystem } from '../cameras/CameraSystem.js';
import { hudDirection, projectHudDirection } from './HudProjection.js';

const tapeWidth = (scale) => Math.max(54, 76 * scale);

/** HUD is a camera presentation; all commands use the existing flight controls. */
export class HudView {
  constructor(sim) {
    this.sim = sim;
    this.root = document.createElement('section');
    this.root.id = 'hud-view';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'HUD');
    this.root.innerHTML = '<canvas class="hud-flight-glass" aria-hidden="true"></canvas>';
    document.getElementById('hud-overlay').append(this.root);
    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  update() {
    const sim = this.sim;
    const active = sim.cameraSystem.mode === CameraSystem.MODES.HUD && !sim.isCrashed;
    if (this.root.hidden === active) {
      this.root.hidden = !active;
      document.body.classList.toggle('hud-camera-mode', active);
    }
    if (!active) return;
    const heading = ((Math.round(sim.telemetry.headingDeg || 0) % 360) + 360) % 360;
    this.draw(sim.telemetry, heading);
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
    const tapeY = height * .46;
    // Portrait has no room to clear the conformal centre; landscape must not press into the corner controls.
    const gutter = tapeWidth(scale) / 2 + 12;
    const hug = narrow && height > width;
    const speedX = hug ? gutter : width * .265;
    const altX = hug ? width - gutter : width * .735;
    this.tape(speedX, tapeY, Math.max(0, data.iasKnots || 0), 10, 'KT', scale);
    this.tape(altX, tapeY, data.altitudeFt || 0, 100, 'FT', scale);
    ctx.fillText(`${data.vsiFpm > 0 ? '+' : ''}${Math.round(data.vsiFpm || 0)} FPM`, altX, tapeY + Math.min(145, height * .21) + 22);
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
    const w = tapeWidth(scale), pixels = half / (step * 3);
    ctx.fillStyle = 'rgba(9,24,36,.18)'; ctx.fillRect(x - w / 2, y - half, w, half * 2);
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
    const bx = x - w / 2 - 3, by = y - 17, bw = w + 6, bh = 34;
    // Punch the ticks out from under the readout so the box can stay translucent without ghosting.
    ctx.save(); ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(bx, by, bw, bh); ctx.restore();
    ctx.fillStyle = 'rgba(16,42,32,.55)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#cbffb2'; ctx.font = `600 ${Math.max(16, 24 * scale)}px monospace`;
    ctx.fillText(String(Math.round(value)), x, y);
    ctx.font = `600 ${Math.max(11, 15 * scale)}px monospace`;
  }
}
