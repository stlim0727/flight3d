import { MathUtils, Quaternion, Vector3 } from 'three';
import { CameraSystem } from '../cameras/CameraSystem.js';
import { t } from '../i18n/index.js';
import { distanceLabel } from '../multiplayer/remoteIndicator.js';
import { MISSILE_TYPES } from '../weapons/missileSpecs.js';
import { hudDirection, projectHudDirection } from './HudProjection.js';

export const MAX_BANDIT_LOCATOR_RANGE_M = 15000;

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
    document.getElementById('hud-overlay')?.append(this.root);
    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas?.getContext('2d');
    if (typeof document !== 'undefined') {
      this.arrowCanvas = document.createElement('canvas');
      this.arrowCanvas.id = 'hud-locator-glass';
      this.arrowCanvas.setAttribute('aria-hidden', 'true');
      this.arrowCanvas.hidden = true;
      document.body?.append(this.arrowCanvas);
      this.arrowCtx = this.arrowCanvas.getContext?.('2d');
    }
    this._hudInverse = new Quaternion();
    this._hudPoint = new Vector3();
    this._hudForward = new Vector3();
  }

  update() {
    const sim = this.sim;
    const hudFolded = typeof document !== 'undefined' && document.body?.classList.contains('hud-folded');
    const hudActive = sim.cameraSystem.mode === CameraSystem.MODES.HUD
      && !sim.cameraSystem.isLookingAwayFromCenter() && !sim.isCrashed && !hudFolded;
    // Cockpit and chase views keep a light target/weapon overlay so the player
    // can still see the lock without switching to the full HUD camera.
    const combat = this.combatHudState();
    const combatOnly = !hudActive && !sim.isCrashed && !hudFolded && Boolean(combat);
    // DIRECTOR is the replay's film camera: the jet and each live round carry a
    // label so the viewer can tell what the shot is following.
    const markers = this.replayMarkers();
    const markerOnly = !hudActive && !sim.isCrashed && !hudFolded && Boolean(markers?.length);
    const visible = hudActive || combatOnly || markerOnly;
    if (this.root.hidden === visible) this.root.hidden = !visible;
    if (this.arrowCanvas && this.arrowCanvas.hidden === visible) this.arrowCanvas.hidden = !visible;
    document.body.classList.toggle('hud-camera-mode', hudActive);
    if (!visible) return;
    if (!hudActive) {
      this.drawCombatOnly(combat);
      if (markers?.length) this.drawReplayMarkers(markers, this.root.clientWidth, this.root.clientHeight);
      return;
    }
    const heading = ((Math.round(sim.telemetry.headingDeg || 0) % 360) + 360) % 360;
    this.draw(sim.telemetry, heading, combat);
  }

  /** Live F-16 state, or the recorded combat state while a replay owns the scene. */
  combatHudState() {
    if (this.sim.replayDirector?.active) return this.sim.replayDirector.combatHudState?.() ?? null;
    if (this.sim.currentAircraftId === 'F16' && this.sim.combatActive?.()) {
      return this.sim.missileCombat?.getHudState?.() ?? null;
    }
    return null;
  }

  /** Identity markers belong to the replay's DIRECTOR camera, not live flight. */
  replayMarkers() {
    const director = this.sim.replayDirector;
    if (!director?.active || this.sim.cameraSystem.mode !== CameraSystem.MODES.DIRECTOR) return null;
    return director.markerState?.() ?? null;
  }

  /** Transparent target/weapon/RWR layer for cockpit and chase cameras. */
  drawCombatOnly(combat) {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    }
    if (this.arrowCanvas && (this.arrowCanvas.width !== Math.round(width * dpr) || this.arrowCanvas.height !== Math.round(height * dpr))) {
      this.arrowCanvas.width = Math.round(width * dpr); this.arrowCanvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this.arrowCtx) {
      this.arrowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.arrowCtx.clearRect(0, 0, width, height);
    }
    if (combat) this.drawCombat(width, height, Math.min(1, width / 1100), combat, true);
  }

  /** Labels and edge locators for the replay host aircraft and each live round. */
  drawReplayMarkers(markers, width, height) {
    if (!width || !height) return;
    const ctx = this.ctx;
    const scale = Math.min(1, width / 1100);
    const font = Math.max(10, 12 * scale);
    const camera = this.sim.camera;
    ctx.save();
    ctx.font = `600 ${font}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#0a141c';
    ctx.shadowBlur = 4;
    for (const marker of markers) {
      if (!marker?.position) continue;
      const player = marker.kind === 'player';
      const color = player ? '#b8ff9b' : '#ffcc66';
      const label = player ? t('replay.marker.player')
        : t(MISSILE_TYPES[marker.typeId]?.labelKey ?? 'replay.marker.missile');
      const screen = this.projectWorld(marker.position, width, height);
      const offscreen = screen.behind || screen.x < 0 || screen.x > width
        || screen.y < 0 || screen.y > height;
      if (offscreen) {
        this.drawReplayLocator(screen, width, height, scale, color, label,
          distanceLabel(camera.position.distanceTo(marker.position)));
        continue;
      }
      const x = screen.x, y = screen.y;
      const size = Math.max(9, 13 * scale);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = player ? 1.8 : 1.5;
      if (player) {
        const arm = size * .55;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(x + sx * size, y + sy * size - sy * arm);
          ctx.lineTo(x + sx * size, y + sy * size);
          ctx.lineTo(x + sx * size - sx * arm, y + sy * size);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y - size); ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size); ctx.lineTo(x - size, y);
        ctx.closePath(); ctx.stroke();
      }
      ctx.fillText(label, x, y - size - font * .75);
    }
    ctx.restore();
  }

  /** Edge arrow plus range for a marker whose subject is outside the shot. */
  drawReplayLocator(screen, width, height, scale, color, label, range) {
    const ctx = this.ctx;
    const angle = screen.behind
      ? screen.angle || 0
      : Math.atan2(screen.x - width / 2, height / 2 - screen.y);
    const radius = Math.min(width, height) * .43;
    const x = width / 2 + Math.sin(angle) * radius;
    const y = height / 2 - Math.cos(angle) * radius;
    const size = Math.max(7, 10 * scale);
    const font = Math.max(10, 12 * scale);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size); ctx.lineTo(-size * .65, size * .55);
    ctx.lineTo(size * .65, size * .55); ctx.closePath(); ctx.fill();
    ctx.restore();
    // Keep both text lines inside the frame, on the sightline side of the arrow.
    const inset = size + 10 + font * 2.1;
    const half = Math.max(label.length, range.length) * font * .32 + 6;
    const tx = MathUtils.clamp(x - Math.sin(angle) * inset, half, width - half);
    const ty = MathUtils.clamp(y + Math.cos(angle) * inset, font * 1.2, height - font * 1.2);
    ctx.save();
    ctx.font = `600 ${font}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = '#0a141c';
    ctx.shadowBlur = 4;
    ctx.fillText(label, tx, ty - font * .55);
    ctx.fillText(range, tx, ty + font * .55);
    ctx.restore();
  }

  draw(data, heading, combat) {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    }
    if (this.arrowCanvas && (this.arrowCanvas.width !== Math.round(width * dpr) || this.arrowCanvas.height !== Math.round(height * dpr))) {
      this.arrowCanvas.width = Math.round(width * dpr); this.arrowCanvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this.arrowCtx) {
      this.arrowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.arrowCtx.clearRect(0, 0, width, height);
    }
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
    if (combat) this.drawCombat(width, height, scale, combat);
    const destination = data.destination;
    if (destination) {
      const known = Number.isFinite(destination.bearingDeg) && Number.isFinite(destination.distanceNm);
      const degrees = known ? String(Math.round(destination.bearingDeg)).padStart(3, '0') : '';
      const bearing = known ? ` ${destination.synthetic ? '~' : ''}${degrees}${destination.synthetic ? '°' : '°T'}` : '';
      const range = known ? ` ${destination.synthetic ? '~' : ''}${Math.round(destination.distanceNm)}NM` : '';
      const prepare = destination.prepare === 'loading' ? ' PREP'
        : destination.prepare === 'failed' ? ' NO DATA' : '';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`DEST ${destination.code}${bearing}${range}${prepare}`, cx, hy - font * 2.2);
      ctx.fillStyle = '#b8ff9b';
    }
  }

  /** Project a world point into HUD pixels; behind-eye points clamp to the frame. */
  projectWorld(point, width, height) {
    const camera = this.sim.camera;
    this._hudInverse.copy(camera.quaternion).invert();
    this._hudPoint.copy(point).sub(camera.position).applyQuaternion(this._hudInverse);
    const behind = this._hudPoint.z >= -0.001;
    const focal = height / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    if (behind) {
      // Behind the camera there is no perspective projection, so point along the
      // camera-relative side/up offset. A target on the rear axis itself has no
      // screen direction; keep the azimuth fallback (bottom edge) for that case.
      const offset = Math.hypot(this._hudPoint.x, this._hudPoint.y);
      const angle = offset > Math.abs(this._hudPoint.z) * 1e-4
        ? Math.atan2(this._hudPoint.x, this._hudPoint.y)
        : Math.atan2(this._hudPoint.x, -this._hudPoint.z);
      return { behind, angle, x: width / 2 + Math.sin(angle) * width * .42, y: height / 2 - Math.cos(angle) * height * .38 };
    }
    return {
      behind,
      angle: Math.atan2(this._hudPoint.x, -this._hudPoint.z),
      x: width / 2 + this._hudPoint.x / -this._hudPoint.z * focal,
      y: height / 2 - this._hudPoint.y / -this._hudPoint.z * focal,
    };
  }

  drawCombat(width, height, scale, state, light = false) {
    const ctx = this.ctx;
    ctx.lineWidth = 1.5;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#142b1c';
    ctx.shadowBlur = 3;
    const green = '#b8ff9b';
    const amber = '#ffcc66';
    const red = '#ff6b57';
    const font = Math.max(11, 15 * scale);
    const small = Math.max(10, 12 * scale);
    const target = state.selectedTarget;

    // Seeker field-of-view circle follows the aircraft boresight, not the
    // camera's look offset, so head turns cannot move the acquisition cone.
    this._hudForward.set(0, 0, -1).applyQuaternion(this.sim.quaternion);
    const boresight = light ? null : projectHudDirection(this._hudForward, this.sim.camera, width, height);
    if (boresight) {
      const radius = height / (2 * Math.tan(MathUtils.degToRad(this.sim.camera.fov) / 2))
        * Math.tan(MathUtils.degToRad(28));
      ctx.save();
      ctx.strokeStyle = target && state.lockProgress > 0 ? amber : green;
      ctx.globalAlpha = .55;
      ctx.setLineDash([6, 7]);
      ctx.beginPath(); ctx.arc(boresight.x, boresight.y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    if (target) {
      const screen = this.projectWorld(target.position, width, height);
      const offscreen = screen.behind || screen.x < 0 || screen.x > width
        || screen.y < 0 || screen.y > height;
      const inLocatorRange = !Number.isFinite(state.rangeM) || state.rangeM <= MAX_BANDIT_LOCATOR_RANGE_M;
      if (offscreen) {
        if (inLocatorRange) {
          this.drawTargetLocator(screen, width, height, scale, state, red);
        }
      } else {
        // Conformal symbols follow the actual line of sight, including near the edge.
        const x = screen.x;
        const y = screen.y;
        const locked = state.locked;
        const size = Math.max(16, 22 * scale);
        ctx.strokeStyle = locked ? amber : green;
        ctx.fillStyle = locked ? amber : green;
        ctx.lineWidth = 1.8;
        if (locked) {
          ctx.beginPath();
          ctx.moveTo(x, y - size); ctx.lineTo(x + size, y);
          ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath(); ctx.stroke();
        } else {
          const tick = size * .55;
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            ctx.beginPath();
            ctx.moveTo(x + sx * size, y + sy * size - sy * tick);
            ctx.lineTo(x + sx * size, y + sy * size);
            ctx.lineTo(x + sx * size - sx * tick, y + sy * size);
            ctx.stroke();
          }
          if (state.lockProgress > 0) {
            ctx.beginPath();
            ctx.arc(x, y, size + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.lockProgress);
            ctx.stroke();
          }
        }

        ctx.font = `600 ${small}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${target.callsign}  ${(state.rangeM / 1852).toFixed(1)} NM`, x, y - size - 14);
        if (Number.isFinite(state.closureMps)) {
          const closure = Math.round(state.closureMps * 1.94384);
          ctx.fillText(`${closure >= 0 ? '+' : ''}${closure} KT`, x, y + size + 15);
        }
        if (locked && state.remaining > 0 && state.nextMissileType && state.rangeM <= state.nextMissileType.seekerRangeM) {
          ctx.fillStyle = amber;
          ctx.fillText(t('weapons.shoot'), x, y - size - 31);
        } else if (state.lockProgress > 0 && !locked) {
          ctx.fillStyle = green;
          ctx.fillText(t('weapons.acquiring'), x, y - size - 31);
        }
      }
    }

    this.drawGunSight(width, height, scale, state);
    this.drawRwr(width, height, scale, state.rwr);

    // Weapon inventory block: next rail type, gun rounds, kills and missiles in flight.
    const label = state.nextMissileType ? t(state.nextMissileType.labelKey) : t('weapons.empty');
    const blockX = width < 700 ? width * .5 : Math.max(90 * scale, width * .12);
    const blockY = width < 700 ? height * .17 : height * .23;
    let line = 0;
    ctx.textAlign = 'left';
    ctx.font = `600 ${font}px monospace`;
    ctx.fillStyle = state.remaining > 0 ? green : amber;
    ctx.fillText(`${label}  ${state.remaining}/${state.total}`, blockX, blockY);
    line++;
    if (state.gun) {
      ctx.fillStyle = state.gun.rounds > 0 ? green : amber;
      ctx.fillText(`${t('weapons.gun')}  ${state.gun.rounds}/${state.gun.capacity}`, blockX, blockY + (font + 5) * line);
      line++;
    }
    ctx.fillStyle = green;
    ctx.fillText(`${t('weapons.splash')} ${state.splash}`, blockX, blockY + (font + 5) * line);
    line++;
    if (state.missilesInFlight > 0) {
      ctx.fillStyle = amber;
      ctx.fillText(`${t('weapons.inFlight')} ${state.missilesInFlight}`, blockX, blockY + (font + 5) * line);
    }
  }

  /**
   * Gun reticle and LCOS pipper. The fixed cross marks the boresight; when a
   * bandit is inside gun range the pipper sits at the lead point that puts the
   * projectile on the target after gravity drop.
   */
  drawGunSight(width, height, scale, state) {
    const gun = state.gun;
    if (!gun) return;
    const ctx = this.ctx;
    const green = '#b8ff9b';
    const amber = '#ffcc66';
    // The fixed cross follows the aircraft boresight, not the camera centre,
    // so cockpit head turns do not move the gun line.
    this._hudForward.set(0, 0, -1).applyQuaternion(this.sim.quaternion);
    const bore = projectHudDirection(this._hudForward, this.sim.camera, width, height);
    const bx = bore ? MathUtils.clamp(bore.x, 24, width - 24) : width / 2;
    const by = bore ? MathUtils.clamp(bore.y, 24, height - 24) : height / 2;
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = gun.rounds > 0 ? green : amber;
    ctx.globalAlpha = .85;
    const size = Math.max(5, 6 * scale);
    ctx.beginPath(); ctx.moveTo(bx - size, by); ctx.lineTo(bx - size * .35, by);
    ctx.moveTo(bx + size * .35, by); ctx.lineTo(bx + size, by);
    ctx.moveTo(bx, by - size); ctx.lineTo(bx, by - size * .35);
    ctx.moveTo(bx, by + size * .35); ctx.lineTo(bx, by + size);
    ctx.stroke();
    ctx.restore();

    const aim = gun.aim;
    if (!aim) return;
    const pipper = this.projectWorld(aim.point, width, height);
    if (pipper.behind) return;
    const px = MathUtils.clamp(pipper.x, 24, width - 24);
    const py = MathUtils.clamp(pipper.y, 24, height - 24);
    ctx.save();
    ctx.strokeStyle = amber;
    ctx.fillStyle = amber;
    ctx.globalAlpha = .9;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 5]);
    const spread = Math.max(18, 24 * scale);
    ctx.beginPath();
    ctx.moveTo(bx - spread, by + 70 * scale); ctx.lineTo(px - 3, py + 3);
    ctx.moveTo(bx + spread, by + 70 * scale); ctx.lineTo(px + 3, py + 3);
    ctx.stroke();
    ctx.setLineDash([]);
    const radius = Math.max(7, 9 * scale);
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${Math.max(10, 12 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(aim.rangeM)} m`, px, py + radius + 13);
    if (gun.firing) ctx.fillText(t('weapons.gun'), px, py - radius - 12);
    ctx.restore();
  }

  drawTargetLocator(screen, width, height, scale, state, redColor) {
    const ctx = this.arrowCtx || this.ctx;
    if (!ctx) return;
    const angle = screen.behind
      ? screen.angle || 0
      : Math.atan2(screen.x - width / 2, height / 2 - screen.y);
    const padTop = Math.max(54, 64 * scale);
    const padBottom = Math.max(60, 72 * scale);
    const padSide = Math.max(28, 36 * scale);
    const radius = Math.min(
      width / 2 - padSide,
      height / 2 - Math.max(padTop, padBottom),
      Math.min(width, height) * .40
    );
    const minX = padSide, maxX = width - padSide;
    const minY = padTop, maxY = height - padBottom;
    const x = MathUtils.clamp(width / 2 + Math.sin(angle) * radius, minX, maxX);
    const y = MathUtils.clamp(height / 2 - Math.cos(angle) * radius, minY, maxY);
    const size = Math.max(7, 10 * scale);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = state.locked ? '#ffcc66' : redColor;
    ctx.shadowColor = '#142b1c';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(0, -size); ctx.lineTo(-size * .65, size * .55); ctx.lineTo(size * .65, size * .55); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    this.root?.remove();
    this.arrowCanvas?.remove();
  }

  drawRwr(width, height, scale, rwr) {
    if (!rwr) return;
    const ctx = this.ctx;
    const radius = Math.max(34, 46 * scale);
    const narrow = width < 700;
    const cx = narrow ? width * .85 : width - radius - 26;
    const cy = narrow ? height * .23 : height - radius - 26;
    const level = rwr.level || 0;
    const color = level >= 3 ? '#ff6b57' : level === 2 ? '#ffcc66' : level === 1 ? '#b8ff9b' : '#6f8f76';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = level ? .95 : .45;
    ctx.lineWidth = level >= 3 ? 2.2 : 1.3;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, radius * .16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy - radius * .82);
    ctx.stroke();
    for (const contact of rwr.contacts || []) {
      const a = contact.bearingRad;
      const r0 = radius * .38, r1 = radius * .9;
      ctx.strokeStyle = contact.level >= 3 ? '#ff6b57' : contact.level === 2 ? '#ffcc66' : '#b8ff9b';
      ctx.lineWidth = contact.level >= 2 ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
      ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(9, 11 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('RWR', cx, cy + radius + 12);
    if (level) ctx.fillText(String(rwr.levelName || '').toUpperCase(), cx, cy + radius + 12 + Math.max(10, 12 * scale));
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
