import * as THREE from 'three';

function createHudCanvasElement(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return {
    width,
    height,
    getContext: () => null,
  };
}

/**
 * Collimated-style Cockpit Head-Up Display (HUD / HGS) Canvas Texture
 * Renders live green phosphor flight symbology onto the 3D cockpit HUD combiner glass
 * for both the F-16 Fighting Falcon (WAC HUD) and Boeing 737-800 (Overhead HGS).
 */
export class CockpitHudCanvas {
  constructor(width = 512, height = 512, options = {}) {
    this.width = width;
    this.height = height;
    this.variant = options.variant || 'f16';

    this.canvas = createHudCanvasElement(width, height);
    this.ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;

    this.pitchDeg = 0;
    this.rollDeg = 0;
    this.iasKnots = 0;
    this.altitudeFt = 0;
    this.headingDeg = 0;
    this.vsiFpm = 0;
    this.gForce = 1.0;
    this.mach = 0;
    this.alphaDeg = 0;
    this.sideslipDeg = 0;
    this.flightPathPitchDeg = 0;
    this.flightPathDriftDeg = 0;
    this.radioAltFt = 0;
    this.gearDown = true;
    this.flapsDeg = 0;
    this.isStalling = false;
    this.apEngaged = false;
    this.renderCount = 0;

    this.render();
  }

  updateData(telemetry = {}) {
    if (!telemetry) return;
    this.pitchDeg = Number.isFinite(telemetry.pitchDeg) ? telemetry.pitchDeg : 0;
    this.rollDeg = Number.isFinite(telemetry.rollDeg) ? telemetry.rollDeg : 0;
    this.iasKnots = Number.isFinite(telemetry.iasKnots) ? Math.max(0, telemetry.iasKnots) : 0;
    this.altitudeFt = Number.isFinite(telemetry.altitudeFt) ? telemetry.altitudeFt : 0;
    const rawHdg = Number.isFinite(telemetry.headingDeg) ? telemetry.headingDeg : 0;
    this.headingDeg = ((rawHdg % 360) + 360) % 360;
    this.vsiFpm = Number.isFinite(telemetry.vsiFpm) ? telemetry.vsiFpm : 0;
    this.gForce = Number.isFinite(telemetry.gForce) ? telemetry.gForce : 1.0;
    this.mach = Number.isFinite(telemetry.mach)
      ? Math.max(0, telemetry.mach)
      : Math.max(0, this.iasKnots / 661.5);
    this.alphaDeg = Number.isFinite(telemetry.alphaDeg) ? telemetry.alphaDeg : 0;
    this.sideslipDeg = Number.isFinite(telemetry.sideslipDeg) ? telemetry.sideslipDeg : 0;

    const rollRad = (this.rollDeg * Math.PI) / 180;
    this.flightPathPitchDeg = Number.isFinite(telemetry.flightPathPitchDeg)
      ? telemetry.flightPathPitchDeg
      : this.pitchDeg - this.alphaDeg * Math.cos(rollRad);
    this.flightPathDriftDeg = Number.isFinite(telemetry.flightPathDriftDeg)
      ? telemetry.flightPathDriftDeg
      : -this.sideslipDeg;

    if (Number.isFinite(telemetry.heightAboveGroundFt)) {
      this.radioAltFt = Math.max(0, telemetry.heightAboveGroundFt);
    } else if (Number.isFinite(telemetry.heightAboveGround)) {
      this.radioAltFt = Math.max(0, telemetry.heightAboveGround * 3.28084);
    } else {
      this.radioAltFt = Math.max(0, this.altitudeFt);
    }

    this.gearDown = (telemetry.gearState ?? 1) > 0.5;
    this.flapsDeg = Number.isFinite(telemetry.flapsDeg) ? telemetry.flapsDeg : 0;
    this.isStalling = Boolean(telemetry.isStalling);
    this.apEngaged = Boolean(telemetry.apEngaged);
  }

  defineCombinerPath(ctx, w, h, inset = 8) {
    ctx.beginPath();
    if (this.variant === 'f16') {
      // Matches F-16-hud_3 geometry: bottom rectangle with semicircular top arch
      const left = inset;
      const right = w - inset;
      const bottom = h - inset;
      const archCenterY = h * 0.5;
      const radius = (right - left) * 0.5;
      ctx.moveTo(left, bottom);
      ctx.lineTo(left, archCenterY);
      ctx.arc(w * 0.5, archCenterY, radius, Math.PI, 0, false);
      ctx.lineTo(right, bottom);
      ctx.closePath();
    } else {
      // Official Boeing 737 Rockwell Collins HGS-4000 round/oval combiner aperture
      const cx = w * 0.5;
      const cy = h * 0.5;
      const rx = (w * 0.5) - inset;
      const ry = (h * 0.44) - inset;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.closePath();
    }
  }

  strokeContrastPath(ctx, lineWidth = 2.2) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(2, 20, 9, 0.78)';
    ctx.lineWidth = lineWidth + 2.2;
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  drawTextWithContrast(ctx, text, x, y) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = 'rgba(2, 20, 9, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.restore();
    ctx.fillText(text, x, y);
  }

  render() {
    this.renderCount += 1;
    this.texture.needsUpdate = true;
    const ctx = this.ctx;
    if (!ctx || typeof ctx.clearRect !== 'function') return;

    const w = this.width;
    const h = this.height;
    const cx = w * 0.5;
    const cy = h * 0.52;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    this.defineCombinerPath(ctx, w, h, 6);
    ctx.clip();

    // Subtle optical combiner glass tint and edge coating
    const glassGrad = ctx.createRadialGradient(cx, cy, w * 0.08, cx, cy, w * 0.52);
    glassGrad.addColorStop(0, 'rgba(10, 42, 22, 0.20)');
    glassGrad.addColorStop(0.8, 'rgba(8, 36, 18, 0.28)');
    glassGrad.addColorStop(1, 'rgba(20, 90, 45, 0.38)');
    ctx.fillStyle = glassGrad;
    ctx.fillRect(0, 0, w, h);

    // Combiner edge bevel highlight
    this.defineCombinerPath(ctx, w, h, 8);
    ctx.strokeStyle = 'rgba(64, 255, 140, 0.52)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Primary HUD phosphor style
    const hudGreen = '#3dff8b';
    const hudBright = '#9effc2';
    ctx.strokeStyle = hudGreen;
    ctx.fillStyle = hudGreen;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0, 255, 108, 0.6)';
    ctx.shadowBlur = 3;

    // 1. Conformal Pitch Ladder & Horizon Line (clipped to central combiner FOV)
    this.drawAttitudeAndPitchLadder(ctx, cx, cy, w, h, hudGreen, hudBright);

    // 2. Fixed Aircraft Boresight / Reference Symbol & Flight Path Vector (FPV)
    this.drawBoresightAndFpv(ctx, cx, cy, w, h, hudGreen, hudBright);

    // 3. Top Heading Tape & Bank Scale Arc
    this.drawHeadingAndRollScale(ctx, cx, cy, w, h, hudGreen, hudBright);

    // 4. Left Indicated Airspeed (IAS) Tape & Readout
    this.drawAirspeedTape(ctx, cy, w, h, hudGreen, hudBright);

    // 5. Right Altitude Tape & Readout
    this.drawAltitudeTape(ctx, cy, w, h, hudGreen, hudBright);

    // 6. Bottom Flight Data Blocks & Stall/Mode Annunciations
    this.drawBottomDataAndAlerts(ctx, cx, cy, w, h, hudGreen, hudBright);

    ctx.restore();
  }

  drawAttitudeAndPitchLadder(ctx, cx, cy, w, h, hudGreen, hudBright) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.265, 0, Math.PI * 2);
    ctx.clip();

    const rollRad = -(this.rollDeg * Math.PI) / 180;
    const pxPerDeg = h * 0.0135;
    ctx.translate(cx, cy);
    ctx.rotate(rollRad);
    ctx.translate(0, this.pitchDeg * pxPerDeg);

    // Horizon line (0 deg) with center gap for FPV
    const gap = w * 0.045;
    const hSpan = w * 0.22;
    ctx.beginPath();
    ctx.moveTo(-hSpan, 0);
    ctx.lineTo(-gap, 0);
    ctx.moveTo(gap, 0);
    ctx.lineTo(hSpan, 0);
    this.strokeContrastPath(ctx, 2.4);

    // Pitch ladder rungs every 5 degrees
    ctx.font = 'bold 13px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textBaseline = 'middle';

    const minPitch = Math.max(-45, Math.floor((this.pitchDeg - 22) / 5) * 5);
    const maxPitch = Math.min(45, Math.ceil((this.pitchDeg + 22) / 5) * 5);

    for (let deg = minPitch; deg <= maxPitch; deg += 5) {
      if (deg === 0) continue;
      const y = -deg * pxPerDeg;
      const innerGap = w * 0.04;
      const outerSpan = w * (Math.abs(deg) % 10 === 0 ? 0.115 : 0.085);
      const tickH = deg > 0 ? 7 : -7;

      ctx.beginPath();
      if (deg > 0) {
        // Solid positive pitch rungs with downward horizon-pointing tips
        ctx.moveTo(-outerSpan, y);
        ctx.lineTo(-innerGap, y);
        ctx.lineTo(-innerGap, y + tickH);

        ctx.moveTo(outerSpan, y);
        ctx.lineTo(innerGap, y);
        ctx.lineTo(innerGap, y + tickH);
      } else {
        // Dashed negative pitch rungs with upward horizon-pointing tips
        const segs = 3;
        const spanLen = outerSpan - innerGap;
        for (let s = 0; s < segs; s++) {
          const t0 = innerGap + (s / segs) * spanLen;
          const t1 = innerGap + ((s + 0.6) / segs) * spanLen;
          ctx.moveTo(-t1, y);
          ctx.lineTo(-t0, y);
          ctx.moveTo(t0, y);
          ctx.lineTo(t1, y);
        }
        ctx.moveTo(-innerGap, y);
        ctx.lineTo(-innerGap, y + tickH);
        ctx.moveTo(innerGap, y);
        ctx.lineTo(innerGap, y + tickH);
      }
      this.strokeContrastPath(ctx, 2.0);

      const label = `${Math.abs(deg)}`;
      ctx.fillStyle = hudBright;
      ctx.textAlign = 'right';
      this.drawTextWithContrast(ctx, label, -outerSpan - 5, y);
      ctx.textAlign = 'left';
      this.drawTextWithContrast(ctx, label, outerSpan + 5, y);
    }

    ctx.restore();
  }

  drawBoresightAndFpv(ctx, cx, cy, w, h, hudGreen, hudBright) {
    ctx.save();
    ctx.strokeStyle = hudBright;

    // Aircraft Boresight / Waterline reference symbol at center
    if (this.variant === 'f16') {
      // F-16 gun/boresight cross
      const s = 8;
      const g = 3;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy);
      ctx.lineTo(cx - g, cy);
      ctx.moveTo(cx + g, cy);
      ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx, cy - g);
      ctx.moveTo(cx, cy + g);
      ctx.lineTo(cx, cy + s);
      this.strokeContrastPath(ctx, 2.0);
    } else {
      // Boeing HGS aircraft reference "-v-" symbol
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy);
      ctx.lineTo(cx - 8, cy);
      ctx.lineTo(cx - 4, cy + 5);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 4, cy + 5);
      ctx.lineTo(cx + 8, cy);
      ctx.lineTo(cx + 22, cy);
      this.strokeContrastPath(ctx, 2.2);
    }

    // Flight Path Vector (Velocity Vector) symbol
    const pxPerDeg = h * 0.0135;
    const fpvDx = THREE.MathUtils.clamp(this.flightPathDriftDeg * pxPerDeg, -w * 0.16, w * 0.16);
    const fpvDy = THREE.MathUtils.clamp((this.pitchDeg - this.flightPathPitchDeg) * pxPerDeg, -h * 0.16, h * 0.16);
    const fx = cx + fpvDx;
    const fy = cy + fpvDy;
    const r = 7.5;

    ctx.strokeStyle = hudGreen;
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.moveTo(fx - r - 13, fy);
    ctx.lineTo(fx - r, fy);
    ctx.moveTo(fx + r, fy);
    ctx.lineTo(fx + r + 13, fy);
    ctx.moveTo(fx, fy - r);
    ctx.lineTo(fx, fy - r - 9);
    this.strokeContrastPath(ctx, 2.2);

    ctx.restore();
  }

  drawHeadingAndRollScale(ctx, cx, cy, w, h, hudGreen, hudBright) {
    ctx.save();
    const tapeY = h * 0.14;
    const tapeHalfW = w * 0.21;
    const pxPerDeg = (tapeHalfW * 2) / 36;

    // Heading tape clip window
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - tapeHalfW, tapeY - 26, tapeHalfW * 2, 34);
    ctx.clip();

    // Baseline
    ctx.beginPath();
    ctx.moveTo(cx - tapeHalfW, tapeY);
    ctx.lineTo(cx + tapeHalfW, tapeY);
    this.strokeContrastPath(ctx, 2.0);

    const baseHdg = Math.floor(this.headingDeg / 5) * 5;
    ctx.font = 'bold 13px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = hudGreen;

    for (let offset = -25; offset <= 25; offset += 5) {
      const tickHdg = baseHdg + offset;
      let delta = tickHdg - this.headingDeg;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const x = cx + delta * pxPerDeg;
      const normHdg = ((tickHdg % 360) + 360) % 360;
      const isMajor = normHdg % 10 === 0;

      ctx.beginPath();
      ctx.moveTo(x, tapeY);
      ctx.lineTo(x, tapeY - (isMajor ? 8 : 4));
      this.strokeContrastPath(ctx, 1.8);

      if (isMajor) {
        const hdgText = String(Math.round(normHdg / 10)).padStart(2, '0');
        this.drawTextWithContrast(ctx, hdgText, x, tapeY - 9);
      }
    }
    ctx.restore();

    // Heading lubber caret & digital box above tape
    ctx.beginPath();
    ctx.moveTo(cx, tapeY + 2);
    ctx.lineTo(cx - 6, tapeY + 10);
    ctx.lineTo(cx + 6, tapeY + 10);
    ctx.closePath();
    this.strokeContrastPath(ctx, 2.0);

    const hdgStr = String(Math.round(this.headingDeg) % 360).padStart(3, '0');
    const boxW = 46;
    const boxH = 20;
    const boxY = tapeY - 46;
    ctx.fillStyle = 'rgba(4, 24, 12, 0.72)';
    ctx.fillRect(cx - boxW * 0.5, boxY, boxW, boxH);
    ctx.beginPath();
    ctx.rect(cx - boxW * 0.5, boxY, boxW, boxH);
    this.strokeContrastPath(ctx, 2.0);

    ctx.fillStyle = hudBright;
    ctx.font = 'bold 14px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.drawTextWithContrast(ctx, hdgStr, cx, boxY + boxH * 0.5 + 1);

    // Upper bank scale ticks & roll pointer
    const arcR = w * 0.295;
    const bankTicks = [-45, -30, -20, -10, 0, 10, 20, 30, 45];
    for (const bDeg of bankTicks) {
      const a = ((bDeg - 90) * Math.PI) / 180;
      const r0 = arcR;
      const r1 = arcR + (bDeg % 30 === 0 ? 9 : 5);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      this.strokeContrastPath(ctx, 1.8);
    }

    // Roll pointer triangle clamped to ±45 deg along bank arc
    const clampedRoll = THREE.MathUtils.clamp(-this.rollDeg, -45, 45);
    const rollAngle = ((clampedRoll - 90) * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx + Math.cos(rollAngle) * (arcR - 2), cy + Math.sin(rollAngle) * (arcR - 2));
    ctx.rotate(rollAngle + Math.PI * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-5, 9);
    ctx.lineTo(5, 9);
    ctx.closePath();
    this.strokeContrastPath(ctx, 2.0);
    ctx.restore();

    ctx.restore();
  }

  drawAirspeedTape(ctx, cy, w, h, hudGreen, hudBright) {
    ctx.save();
    const tapeX = w * 0.22;
    const tapeHalfH = h * 0.23;
    const pxPerKt = (tapeHalfH * 2) / 80;

    // Vertical backbone line
    ctx.beginPath();
    ctx.moveTo(tapeX, cy - tapeHalfH);
    ctx.lineTo(tapeX, cy + tapeHalfH);
    this.strokeContrastPath(ctx, 2.2);

    // Ticks & labels
    ctx.save();
    ctx.beginPath();
    ctx.rect(8, cy - tapeHalfH, tapeX + 6, tapeHalfH * 2);
    ctx.clip();

    const baseSpd = Math.floor(this.iasKnots / 10) * 10;
    ctx.font = 'bold 13px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hudGreen;

    for (let offset = -50; offset <= 50; offset += 10) {
      const spd = baseSpd + offset;
      if (spd < 0) continue;
      const y = cy - (spd - this.iasKnots) * pxPerKt;
      const isMajor = spd % 20 === 0;

      ctx.beginPath();
      ctx.moveTo(tapeX, y);
      ctx.lineTo(tapeX - (isMajor ? 9 : 5), y);
      this.strokeContrastPath(ctx, 1.8);

      if (isMajor && Math.abs(y - cy) > 18) {
        this.drawTextWithContrast(ctx, String(spd), tapeX - 12, y);
      }
    }
    ctx.restore();

    // Digital IAS readout box
    const boxW = 64;
    const boxH = 26;
    const boxX = tapeX - boxW - 6;
    ctx.fillStyle = 'rgba(4, 24, 12, 0.82)';
    ctx.beginPath();
    ctx.moveTo(boxX, cy - boxH * 0.5);
    ctx.lineTo(tapeX - 6, cy - boxH * 0.5);
    ctx.lineTo(tapeX, cy);
    ctx.lineTo(tapeX - 6, cy + boxH * 0.5);
    ctx.lineTo(boxX, cy + boxH * 0.5);
    ctx.closePath();
    ctx.fill();
    this.strokeContrastPath(ctx, 2.2);

    ctx.fillStyle = hudBright;
    ctx.font = 'bold 17px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    this.drawTextWithContrast(ctx, String(Math.round(this.iasKnots)), tapeX - 10, cy + 1);

    // Label above tape
    ctx.fillStyle = hudGreen;
    ctx.font = 'bold 12px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'right';
    this.drawTextWithContrast(ctx, 'IAS', tapeX, cy - tapeHalfH - 10);

    ctx.restore();
  }

  drawAltitudeTape(ctx, cy, w, h, hudGreen, hudBright) {
    ctx.save();
    const tapeX = w * 0.78;
    const tapeHalfH = h * 0.23;
    const pxPerFt = (tapeHalfH * 2) / 800;

    // Vertical backbone line
    ctx.beginPath();
    ctx.moveTo(tapeX, cy - tapeHalfH);
    ctx.lineTo(tapeX, cy + tapeHalfH);
    this.strokeContrastPath(ctx, 2.2);

    // Ticks & labels
    ctx.save();
    ctx.beginPath();
    ctx.rect(tapeX - 6, cy - tapeHalfH, w - tapeX - 2, tapeHalfH * 2);
    ctx.clip();

    const baseAlt = Math.floor(this.altitudeFt / 100) * 100;
    ctx.font = 'bold 13px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hudGreen;

    for (let offset = -500; offset <= 500; offset += 100) {
      const alt = baseAlt + offset;
      const y = cy - (alt - this.altitudeFt) * pxPerFt;
      const isMajor = alt % 200 === 0;

      ctx.beginPath();
      ctx.moveTo(tapeX, y);
      ctx.lineTo(tapeX + (isMajor ? 9 : 5), y);
      this.strokeContrastPath(ctx, 1.8);

      if (isMajor && Math.abs(y - cy) > 18) {
        this.drawTextWithContrast(ctx, String(alt), tapeX + 12, y);
      }
    }
    ctx.restore();

    // Digital Altitude readout box
    const boxW = 76;
    const boxH = 26;
    const boxX = tapeX + 6;
    ctx.fillStyle = 'rgba(4, 24, 12, 0.82)';
    ctx.beginPath();
    ctx.moveTo(tapeX, cy);
    ctx.lineTo(boxX, cy - boxH * 0.5);
    ctx.lineTo(boxX + boxW, cy - boxH * 0.5);
    ctx.lineTo(boxX + boxW, cy + boxH * 0.5);
    ctx.lineTo(boxX, cy + boxH * 0.5);
    ctx.closePath();
    ctx.fill();
    this.strokeContrastPath(ctx, 2.2);

    ctx.fillStyle = hudBright;
    ctx.font = 'bold 17px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    this.drawTextWithContrast(ctx, String(Math.round(this.altitudeFt)), boxX + 6, cy + 1);

    // Label above tape
    ctx.fillStyle = hudGreen;
    ctx.font = 'bold 12px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.textAlign = 'left';
    this.drawTextWithContrast(ctx, 'ALT', tapeX, cy - tapeHalfH - 10);

    ctx.restore();
  }

  drawBottomDataAndAlerts(ctx, cx, cy, w, h, hudGreen, hudBright) {
    ctx.save();
    ctx.font = 'bold 14px "JetBrains Mono", "Roboto Mono", monospace';
    ctx.fillStyle = hudBright;
    ctx.textBaseline = 'alphabetic';

    const leftX = this.variant === 'f16' ? w * 0.12 : w * 0.15;
    const rightX = this.variant === 'f16' ? w * 0.88 : w * 0.85;
    const row1Y = this.variant === 'f16' ? h * 0.80 : h * 0.77;
    const row2Y = this.variant === 'f16' ? h * 0.855 : h * 0.825;
    const row3Y = this.variant === 'f16' ? h * 0.91 : h * 0.88;

    // Left block: G-Load, Mach, AoA
    ctx.textAlign = 'left';
    this.drawTextWithContrast(ctx, `G ${this.gForce.toFixed(1)}`, leftX, row1Y);
    this.drawTextWithContrast(ctx, `M ${this.mach.toFixed(2)}`, leftX, row2Y);
    this.drawTextWithContrast(ctx, `AOA ${this.alphaDeg.toFixed(1)}°`, leftX, row3Y);

    // Right block: Vertical speed, Radio Altitude, Gear/AP status
    ctx.textAlign = 'right';
    const vsRounded = Math.round(this.vsiFpm / 50) * 50;
    const vsSign = vsRounded >= 0 ? '+' : '';
    this.drawTextWithContrast(ctx, `VS ${vsSign}${vsRounded}`, rightX, row1Y);

    if (this.radioAltFt <= 2500) {
      this.drawTextWithContrast(ctx, `RA ${Math.round(this.radioAltFt)}`, rightX, row2Y);
    } else {
      this.drawTextWithContrast(ctx, this.apEngaged ? 'AP CMD' : 'MAN', rightX, row2Y);
    }

    const modeStr = this.gearDown
      ? (this.flapsDeg > 0 ? `GEAR DN  FLP ${Math.round(this.flapsDeg)}` : 'GEAR DN')
      : (this.apEngaged ? 'HGS PRI  AP' : 'HGS PRI');
    this.drawTextWithContrast(ctx, modeStr, rightX, row3Y);

    // Stall alert box
    if (this.isStalling) {
      const bw = 112;
      const bh = 28;
      const bx = cx - bw * 0.5;
      const by = cy - h * 0.18;
      ctx.fillStyle = 'rgba(40, 12, 4, 0.85)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#ff6b4a';
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      this.strokeContrastPath(ctx, 2.4);

      ctx.fillStyle = '#ff8566';
      ctx.font = 'bold 17px "JetBrains Mono", "Roboto Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.drawTextWithContrast(ctx, 'STALL', cx, by + bh * 0.5 + 1);
    }

    ctx.restore();
  }
}

/**
 * Normalizes the UV coordinates on the F-16's authored 3D HUD combiner mesh (`F-16-hud_3`)
 * and binds the live `CockpitHudCanvas` texture without changing vertex or triangle counts.
 */
export function configureF16HudMesh(mesh, hudCanvas) {
  if (!mesh || !mesh.geometry || !hudCanvas) return mesh;

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;

  if (pos && box) {
    const spanX = Math.max(1e-5, box.max.x - box.min.x);
    const spanY = Math.max(1e-5, box.max.y - box.min.y);
    const uvs = new Float32Array(pos.count * 2);

    for (let i = 0; i < pos.count; i++) {
      const nz = norm ? norm.getZ(i) : 1;
      if (nz >= 0) {
        uvs[i * 2] = (pos.getX(i) - box.min.x) / spanX;
        uvs[i * 2 + 1] = (pos.getY(i) - box.min.y) / spanY;
      } else {
        // Exterior-facing back surface of the HUD slab samples the transparent edge
        uvs[i * 2] = 0.02;
        uvs[i * 2 + 1] = 0.02;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  mesh.material = new THREE.MeshBasicMaterial({
    name: 'F-16-hud',
    map: hudCanvas.texture,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 12;
  return mesh;
}

/**
 * Builds the Boeing 737-800 3D overhead Head-Up Guidance System (HGS) fold-down combiner
 * assembly mounted above the Captain's windshield line of sight.
 * Mimics the official Rockwell Collins HGS-4000 round/oval optical combiner glass.
 */
export function createB737HudCombiner(hudCanvas) {
  const group = new THREE.Group();
  group.name = 'B737_HGS_Combiner';

  const frameMat = new THREE.MeshBasicMaterial({
    name: 'B737-hgs-frame',
    color: 0x15191f,
    side: THREE.DoubleSide,
  });

  // Captain line-of-sight mount X framed in the center of Captain forward windshield 1L
  const mountX = -0.270;
  const mountY = 0.840;
  const mountZ = -12.740;

  // Overhead projector housing & hinge bracket attached to the Captain ceiling mount
  const housingGeo = new THREE.BoxGeometry(0.12, 0.020, 0.075);
  const housingMesh = new THREE.Mesh(housingGeo, frameMat);
  housingMesh.name = 'B737_HGS_Housing';
  housingMesh.position.set(mountX, 0.955, -12.685);
  housingMesh.castShadow = false;
  housingMesh.receiveShadow = false;
  group.add(housingMesh);

  // Dual support struts connecting ceiling mount to combiner top hinge bracket
  const strutGeo = new THREE.BoxGeometry(0.008, 0.075, 0.009);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(strutGeo, frameMat);
    strut.name = side < 0 ? 'B737_HGS_Strut_L' : 'B737_HGS_Strut_R';
    strut.position.set(mountX + side * 0.042, 0.925, -12.700);
    strut.rotation.x = 0.30;
    strut.castShadow = false;
    strut.receiveShadow = false;
    group.add(strut);
  }

  // Combiner assembly pivot in the Captain's forward windshield above the yoke and glareshield
  const combinerPivot = new THREE.Group();
  combinerPivot.name = 'B737_HGS_Lens_Pivot';
  combinerPivot.position.set(mountX, mountY, mountZ);
  combinerPivot.rotation.x = -0.12;
  group.add(combinerPivot);

  // Official Boeing 737 Rockwell Collins HGS-4000 round/oval combiner lens
  const rx = 0.080; // 16.0 cm total width
  const ry = 0.064; // 12.8 cm total height
  const rimW = 0.0035; // 3.5 mm sleek black protective bezel

  // Optical combiner glass geometry with normalized UVs
  const glassShape = new THREE.Shape();
  glassShape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false);
  const glassGeo = new THREE.ShapeGeometry(glassShape, 36);
  glassGeo.computeBoundingBox();
  const b = glassGeo.boundingBox;
  const pos = glassGeo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const spanX = Math.max(1e-5, b.max.x - b.min.x);
  const spanY = Math.max(1e-5, b.max.y - b.min.y);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = (pos.getX(i) - b.min.x) / spanX;
    uvs[i * 2 + 1] = (pos.getY(i) - b.min.y) / spanY;
  }
  glassGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const glassMat = new THREE.MeshBasicMaterial({
    name: 'B737-hgs-hud',
    map: hudCanvas?.texture || null,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.name = 'B737_HGS_Glass';
  glassMesh.position.set(0, 0, 0.001);
  glassMesh.castShadow = false;
  glassMesh.receiveShadow = false;
  glassMesh.renderOrder = 12;
  combinerPivot.add(glassMesh);

  // Outer oval bezel frame
  const frameShape = new THREE.Shape();
  frameShape.absellipse(0, 0, rx + rimW, ry + rimW, 0, Math.PI * 2, false);
  const frameHole = new THREE.Path();
  frameHole.absellipse(0, 0, rx, ry, 0, Math.PI * 2, true);
  frameShape.holes.push(frameHole);
  const rimGeo = new THREE.ShapeGeometry(frameShape, 36);
  const rimMesh = new THREE.Mesh(rimGeo, frameMat);
  rimMesh.name = 'B737_HGS_Rim';
  rimMesh.position.set(0, 0, 0.002);
  rimMesh.castShadow = false;
  rimMesh.receiveShadow = false;
  combinerPivot.add(rimMesh);

  // Top hinge bracket connecting glass frame to overhead struts
  const topHingeGeo = new THREE.BoxGeometry(0.052, 0.016, 0.014);
  const topHinge = new THREE.Mesh(topHingeGeo, frameMat);
  topHinge.name = 'B737_HGS_TopHinge';
  topHinge.position.set(0, ry + 0.004, 0);
  topHinge.castShadow = false;
  topHinge.receiveShadow = false;
  combinerPivot.add(topHinge);

  group.userData.glassMesh = glassMesh;
  return group;
}
