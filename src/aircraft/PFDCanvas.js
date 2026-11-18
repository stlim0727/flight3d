import * as THREE from 'three';
import { Atmosphere } from '../physics/Atmosphere.js';
import { PROFILES } from '../systems/FlightWarningsCore.js';

export function b738MaximumSpeedKnots(altitudeFt) {
  const { vne, mach } = PROFILES.B738;
  const { speedOfSound, densityRatio } = Atmosphere.getConditions(Atmosphere.feetToMeters(altitudeFt));
  const machLimit = Atmosphere.msToKnots(Atmosphere.tasToIas(mach * speedOfSound, densityRatio));
  return Math.min(vne, machLimit);
}

/**
 * Boeing 737 / 777 Class Primary Flight Display (PFD)
 * High-definition vector rendering onto an HTML5 Canvas, updated dynamically for Three.js textures.
 */
export class PFDCanvas {
  constructor(width = 512, height = 512) {
    this.width = width;
    this.height = height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Internal state cache for smooth rendering
    this.pitch = 0; // degrees
    this.roll = 0;  // degrees
    this.heading = 0; // degrees
    this.ias = 0; // knots
    this.altitude = 0; // feet
    this.radioAlt = 0; // feet AGL
    this.verticalSpeed = 0; // ft/min
    this.mach = 0.0;
    this.stall = false;
    this.apEngaged = true;

    this.selectedAltitude = 5000;
    this.selectedHeading = 90;
    this.selectedSpeed = 160;
  }

  updateData(state) {
    this.takeoff = state.takeoff;
    this.stallSpeedKnots = state.stallSpeedKnots;
    this.pitch = state.pitchDeg || 0;
    this.roll = state.rollDeg || 0;
    this.heading = (state.headingDeg || 0 + 360) % 360;
    this.ias = state.iasKnots || 0;
    this.altitude = state.altitudeFt || 0;
    this.radioAlt = state.radioAltFt !== undefined ? state.radioAltFt : 9999;
    this.verticalSpeed = state.vsiFpm || 0;
    this.mach = state.mach || 0;
    this.stall = state.isStalled || false;
    this.apEngaged = state.apEngaged || false;
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark cockpit bezel background
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);

    // Instrument active display window
    const pfdX = 24;
    const pfdY = 32;
    const pfdW = w - 48;
    const pfdH = h - 54;

    ctx.save();
    ctx.beginPath();
    ctx.rect(pfdX, pfdY, pfdW, pfdH);
    ctx.clip();

    // 1. Center Electronic Attitude Director Indicator (EADI)
    const eadiW = 210;
    const eadiH = 260;
    const eadiX = w * 0.5;
    const eadiY = h * 0.48;

    this.drawAttitudeIndicator(ctx, eadiX, eadiY, eadiW, eadiH);

    // 2. Airspeed Tape (Left)
    const speedTapeX = pfdX + 10;
    const speedTapeY = eadiY - eadiH * 0.5;
    const speedTapeW = 68;
    const speedTapeH = eadiH;
    this.drawAirspeedTape(ctx, speedTapeX, speedTapeY, speedTapeW, speedTapeH);

    // 3. Altitude Tape (Right)
    const altTapeW = 74;
    const altTapeX = pfdX + pfdW - altTapeW - 32;
    const altTapeY = eadiY - eadiH * 0.5;
    const altTapeH = eadiH;
    this.drawAltitudeTape(ctx, altTapeX, altTapeY, altTapeW, altTapeH);

    // 4. Vertical Speed Indicator (Far Right)
    const vsiX = altTapeX + altTapeW + 4;
    const vsiW = 26;
    this.drawVSI(ctx, vsiX, altTapeY, vsiW, altTapeH);

    // 5. Compass Rose / Heading Tape (Bottom)
    const hdgY = eadiY + eadiH * 0.5 + 8;
    this.drawHeadingTape(ctx, eadiX, hdgY, 260, 62);

    // 6. Flight Mode Annunciator (Top FMA)
    this.drawFMA(ctx, pfdX, pfdY, pfdW, 36);

    ctx.restore();

    this.texture.needsUpdate = true;
  }

  drawAttitudeIndicator(ctx, cx, cy, width, height) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - width * 0.5, cy - height * 0.5, width, height);
    ctx.clip();

    // Rotate for aircraft roll angle
    ctx.translate(cx, cy);
    const rollRad = THREE.MathUtils.degToRad(this.roll);
    ctx.rotate(-rollRad);

    // Pitch displacement: ~5 pixels per degree
    const pitchOffset = this.pitch * 5.0;

    // Authentic Boeing Sky (deep cyan-blue) & Ground (earth olive-brown)
    ctx.fillStyle = '#0082c8';
    ctx.fillRect(-width * 1.5, -height * 2.0 + pitchOffset, width * 3.0, height * 2.0);

    ctx.fillStyle = '#543820';
    ctx.fillRect(-width * 1.5, pitchOffset, width * 3.0, height * 2.0);

    // White Horizon line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-width * 1.5, pitchOffset);
    ctx.lineTo(width * 1.5, pitchOffset);
    ctx.stroke();

    // Pitch ladder bars
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let deg = -80; deg <= 80; deg += 2.5) {
      if (deg === 0) continue;
      const y = pitchOffset - deg * 5.0;
      if (y < -height * 1.2 || y > height * 1.2) continue;

      const isMajor = deg % 10 === 0;
      const isFive = deg % 5 === 0;
      const barLen = isMajor ? 54 : (isFive ? 32 : 16);

      ctx.lineWidth = isMajor ? 2.0 : 1.2;
      ctx.beginPath();

      if (deg > 0) {
        // Nose up: solid bars with downward chevrons on ends
        ctx.moveTo(-barLen * 0.5, y);
        ctx.lineTo(barLen * 0.5, y);
        if (isMajor) {
          ctx.moveTo(-barLen * 0.5, y);
          ctx.lineTo(-barLen * 0.5, y + 6);
          ctx.moveTo(barLen * 0.5, y);
          ctx.lineTo(barLen * 0.5, y + 6);
        }
      } else {
        // Nose down: dashed bars with upward chevrons on ends
        ctx.setLineDash([4, 4]);
        ctx.moveTo(-barLen * 0.5, y);
        ctx.lineTo(barLen * 0.5, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (isMajor) {
          ctx.moveTo(-barLen * 0.5, y);
          ctx.lineTo(-barLen * 0.5, y - 6);
          ctx.moveTo(barLen * 0.5, y);
          ctx.lineTo(barLen * 0.5, y - 6);
        }
      }
      ctx.stroke();

      if (isMajor) {
        ctx.fillText(Math.abs(deg).toString(), -barLen * 0.5 - 14, y);
        ctx.fillText(Math.abs(deg).toString(), barLen * 0.5 + 14, y);
      }
    }

    ctx.restore();

    // Draw Roll Scale arc & Roll Pointer (fixed to display center)
    ctx.save();
    ctx.translate(cx, cy);

    const rollRadius = 92;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, rollRadius, -Math.PI * 0.75, -Math.PI * 0.25);
    ctx.stroke();

    // Roll tick marks at -60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60
    const rollTicks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
    rollTicks.forEach(tick => {
      const rad = THREE.MathUtils.degToRad(tick - 90);
      const isLarge = Math.abs(tick) === 30 || Math.abs(tick) === 60 || tick === 0;
      const len = isLarge ? 12 : 7;
      const x1 = Math.cos(rad) * rollRadius;
      const y1 = Math.sin(rad) * rollRadius;
      const x2 = Math.cos(rad) * (rollRadius + len);
      const y2 = Math.sin(rad) * (rollRadius + len);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    // Rotating Roll Pointer & Inclinometer / Slip-skid indicator
    ctx.save();
    ctx.rotate(-rollRad);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -rollRadius);
    ctx.lineTo(-6, -rollRadius + 10);
    ctx.lineTo(6, -rollRadius + 10);
    ctx.closePath();
    ctx.fill();

    // Slip/Skid indicator brick (trapezoid beneath pointer)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-7, -rollRadius + 12, 14, 4);
    ctx.restore();

    // Fixed Aircraft Symbol (Boeing flying mustache: black border with bright amber/white wings)
    ctx.fillStyle = '#000000';
    ctx.fillRect(-48, -5, 34, 10);
    ctx.fillRect(14, -5, 34, 10);
    ctx.fillRect(-6, -6, 12, 12);

    ctx.fillStyle = '#ffaa00';
    ctx.fillRect(-46, -3, 30, 6);
    ctx.fillRect(16, -3, 30, 6);
    ctx.fillRect(-4, -4, 8, 8);

    // Split-Cue Flight Director (FD) Crosshairs in Vivid Magenta
    if (this.apEngaged) {
      ctx.strokeStyle = '#f72585';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;

      // Target pitch bar (horizontal)
      const targetPitch = 2.5; // Glideslope/climb target
      const fdY = (this.pitch - targetPitch) * 4.5;
      ctx.beginPath();
      ctx.moveTo(-52, fdY);
      ctx.lineTo(52, fdY);
      ctx.stroke();

      // Target roll bar (vertical)
      const fdX = (this.roll - 0) * 2.2;
      ctx.beginPath();
      ctx.moveTo(fdX, -48);
      ctx.lineTo(fdX, 48);
      ctx.stroke();

      ctx.shadowBlur = 0; // Reset
    }

    // Radio Altimeter Digital Readout below 2500 ft (Boeing amber/white box)
    if (this.radioAlt < 2500) {
      const isDecision = this.radioAlt < 200;
      ctx.fillStyle = '#06090e';
      ctx.fillRect(-38, 62, 76, 26);
      ctx.strokeStyle = isDecision ? '#ffaa00' : '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(-38, 62, 76, 26);

      ctx.fillStyle = isDecision ? '#ffaa00' : '#ffffff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.max(0, Math.round(this.radioAlt)).toString(), 0, 81);
    }

    // Stall Warning Annunciator on Attitude Indicator
    if (this.stall) {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(-65, -88, 130, 28);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-65, -88, 130, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STALL', 0, -70);
    }

    ctx.restore();
  }

  drawAirspeedTape(ctx, x, y, width, height) {
    ctx.save();
    ctx.fillStyle = '#10141b';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#445065';
    ctx.strokeRect(x, y, width, height);

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const cy = y + height * 0.5;
    const pxPerKnot = 2.4;
    const currentIas = Math.max(0, this.ias);

    // Ticks and numbers
    const minKts = Math.floor((currentIas - (height * 0.5) / pxPerKnot) / 10) * 10;
    const maxKts = Math.ceil((currentIas + (height * 0.5) / pxPerKnot) / 10) * 10;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let kts = minKts; kts <= maxKts; kts += 10) {
      if (kts < 0) continue;
      const tickY = cy - (kts - currentIas) * pxPerKnot;

      ctx.lineWidth = kts % 20 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x + width - (kts % 20 === 0 ? 16 : 9), tickY);
      ctx.lineTo(x + width, tickY);
      ctx.stroke();

      if (kts % 20 === 0 && kts >= 40) {
        ctx.fillText(kts.toString(), x + width - 20, tickY);
      }
    }

    // High-speed barber pole follows the more restrictive VMO/MMO limit.
    const vmoKts = b738MaximumSpeedKnots(this.altitude);
    const vmoBottomY = cy - (vmoKts - currentIas) * pxPerKnot;
    if (vmoBottomY > y) {
      const bBottom = Math.min(y + height, vmoBottomY);
      const bTop = Math.max(y, bBottom - 120);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x + width - 6, bTop, 6, bBottom - bTop);
      ctx.fillStyle = '#ffffff';
      for (let by = bTop; by < bBottom; by += 10) {
        ctx.fillRect(x + width - 6, by, 6, Math.min(5, bBottom - by));
      }
    }

    // Estimated 1g boundary follows current loading/CG/configuration. Actual
    // stall annunciation still comes from the live separation model.
    const stallKts = this.stallSpeedKnots ?? 0;
    const amberKts = stallKts * 1.13;
    const amberTopY = cy - (amberKts - currentIas) * pxPerKnot;
    const stallTopY = cy - (stallKts - currentIas) * pxPerKnot;

    if (amberTopY < y + height) {
      // Amber minimum maneuver band
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x + width - 6, Math.max(y, amberTopY), 6, Math.min(height, y + height - amberTopY));
    }
    if (stallTopY < y + height) {
      // Red stall warning strip with zipper pattern
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x + width - 6, Math.max(y, stallTopY), 6, Math.min(height, y + height - stallTopY));
      ctx.fillStyle = '#ffffff';
      for (let sy = Math.max(y, stallTopY); sy < y + height; sy += 8) {
        ctx.fillRect(x + width - 6, sy, 6, 4);
      }
    }

    // Estimated VR/V2 only; V1 needs an accelerate-stop/runway model.
    const vSpeeds = this.takeoff?.status === 'estimate' ? [
      { kts: this.takeoff.vr, label: 'R~' },
      { kts: this.takeoff.v2, label: '2~' }
    ] : [];
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    vSpeeds.forEach(v => {
      const vy = cy - (v.kts - currentIas) * pxPerKnot;
      if (vy >= y && vy <= y + height) {
        ctx.fillStyle = '#10b981'; // Green bug
        ctx.fillText(`V${v.label}`, x + width - 8, vy + 4);
      }
    });

    // 6-Second Speed Trend Vector (Magenta vertical arrow)
    const speedTrendKts = Math.min(30, Math.max(-30, (currentIas - 140) * 0.15));
    if (Math.abs(speedTrendKts) > 1.5) {
      const trendY = cy - speedTrendKts * pxPerKnot;
      ctx.strokeStyle = '#f72585';
      ctx.fillStyle = '#f72585';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + width - 3, cy);
      ctx.lineTo(x + width - 3, trendY);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      const dir = speedTrendKts > 0 ? -1 : 1;
      ctx.moveTo(x + width - 7, trendY + dir * 6);
      ctx.lineTo(x + width - 3, trendY);
      ctx.lineTo(x + width + 1, trendY + dir * 6);
      ctx.fill();
    }

    ctx.restore();

    // Center Current Speed Window (Black box with white border and rolling digits)
    const winH = 28;
    const winW = width + 8;
    const winY = cy - winH * 0.5;
    ctx.fillStyle = '#06090e';
    ctx.fillRect(x, winY, winW, winH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, winY, winW, winH);

    // Speed pointing arrow cursor
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x + winW, cy - 6);
    ctx.lineTo(x + winW + 6, cy);
    ctx.lineTo(x + winW, cy + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(currentIas).toString(), x + winW - 6, cy);

    // Selected Speed Bug (Magenta readout at top)
    ctx.fillStyle = '#f72585';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.selectedSpeed}`, x + width * 0.5, y - 8);

    // Mach Readout below tape
    if (this.mach > 0.35) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`. ${Math.round(this.mach * 1000)}`, x + width * 0.5, y + height + 16);
    }
  }

  drawAltitudeTape(ctx, x, y, width, height) {
    ctx.save();
    ctx.fillStyle = '#10141b';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#445065';
    ctx.strokeRect(x, y, width, height);

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const cy = y + height * 0.5;
    const pxPer100Ft = 24.0;
    const currentAlt = this.altitude;

    const minAlt = Math.floor((currentAlt - (height * 0.5 / pxPer100Ft) * 100) / 100) * 100;
    const maxAlt = Math.ceil((currentAlt + (height * 0.5 / pxPer100Ft) * 100) / 100) * 100;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let alt = minAlt; alt <= maxAlt; alt += 100) {
      const tickY = cy - ((alt - currentAlt) / 100.0) * pxPer100Ft;
      const isMajor = alt % 500 === 0;

      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, tickY);
      ctx.lineTo(x + (isMajor ? 14 : 8), tickY);
      ctx.stroke();

      if (isMajor) {
        ctx.fillText(alt.toString(), x + 18, tickY);
      }
    }

    ctx.restore();

    // Center Altitude Window (Rolling drum box with pointer cursor)
    const winH = 30;
    const winW = width + 10;
    const winY = cy - winH * 0.5;
    ctx.fillStyle = '#06090e';
    ctx.fillRect(x - 4, winY, winW, winH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 4, winY, winW, winH);

    // Left-pointing pointer cursor into altitude tape
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x - 4, cy - 6);
    ctx.lineTo(x - 10, cy);
    ctx.lineTo(x - 4, cy + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#10b981'; // Boeing green rolling drum numbers
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(currentAlt).toString(), x + winW - 8, cy);

    // Selected Altitude at Top (Magenta)
    ctx.fillStyle = '#f72585';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.selectedAltitude}`, x + width * 0.5, y - 8);

    // Decision Height / Baro Minimums Bug (Amber)
    const minsAlt = 200;
    const minsY = cy - ((minsAlt - currentAlt) / 100.0) * pxPer100Ft;
    if (minsY >= y && minsY <= y + height) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('BARO 200', x + 4, minsY - 4);
      ctx.fillRect(x, minsY, 12, 2);
    }

    // Baro Standard Setting at Bottom in Green Box
    ctx.fillStyle = '#06090e';
    ctx.fillRect(x - 2, y + height + 6, width + 4, 18);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2, y + height + 6, width + 4, 18);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STD 29.92IN', x + width * 0.5, y + height + 18);
  }

  drawVSI(ctx, x, y, width, height) {
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#445065';
    ctx.strokeRect(x, y, width, height);

    const cy = y + height * 0.5;
    // Scale: ±6000 FPM mapped onto half height
    const maxFpm = 6000;
    const clampedVsi = Math.max(-maxFpm, Math.min(maxFpm, this.verticalSpeed));
    const needleY = cy - (clampedVsi / maxFpm) * (height * 0.46);

    // Zero tick mark
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + width, cy);
    ctx.stroke();

    // Indicator Needle
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + width, needleY);
    ctx.stroke();

    // Digital readout if significant climb/descent
    if (Math.abs(this.verticalSpeed) > 300) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      const readY = this.verticalSpeed > 0 ? y + 10 : y + height - 4;
      ctx.fillText(Math.round(this.verticalSpeed / 100).toString(), x + width * 0.5, readY);
    }
  }

  drawHeadingTape(ctx, cx, y, width, height) {
    ctx.save();
    ctx.fillStyle = '#10141b';
    ctx.fillRect(cx - width * 0.5, y, width, height);
    ctx.strokeStyle = '#445065';
    ctx.strokeRect(cx - width * 0.5, y, width, height);

    ctx.beginPath();
    ctx.rect(cx - width * 0.5, y, width, height);
    ctx.clip();

    const pxPerDeg = 4.2;
    const currentHdg = this.heading;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';

    for (let deg = -180; deg <= 180; deg += 5) {
      const rawHdg = (Math.round(currentHdg) + deg + 360) % 360;
      const x = cx + deg * pxPerDeg;
      if (x < cx - width * 0.5 - 20 || x > cx + width * 0.5 + 20) continue;

      const isMajor = rawHdg % 10 === 0;
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + (isMajor ? 12 : 7));
      ctx.stroke();

      if (isMajor) {
        let label = (rawHdg / 10).toString().padStart(2, '0');
        if (rawHdg === 0) label = 'N';
        if (rawHdg === 90) label = 'E';
        if (rawHdg === 180) label = 'S';
        if (rawHdg === 270) label = 'W';
        ctx.fillText(label, x, y + 26);
      }
    }

    ctx.restore();

    // Center Heading Triangle pointer & readout box
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx - 6, y + 8);
    ctx.lineTo(cx + 6, y + 8);
    ctx.closePath();
    ctx.fill();

    const boxW = 46;
    const boxH = 20;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - boxW * 0.5, y + height - boxH, boxW, boxH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - boxW * 0.5, y + height - boxH, boxW, boxH);

    ctx.fillStyle = '#00ff44';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(currentHdg).toString().padStart(3, '0'), cx, y + height - boxH * 0.5);
  }

  drawFMA(ctx, x, y, width, height) {
    ctx.fillStyle = '#0c1017';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#2d3748';
    ctx.strokeRect(x, y, width, height);

    // Three columns: Autothrottle | Roll Mode | Pitch Mode
    const colW = width / 3;

    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // A/T
    ctx.fillStyle = '#00ff44';
    ctx.fillText('SPEED', x + colW * 0.5, y + height * 0.5);

    // Roll
    ctx.fillStyle = '#00ff44';
    ctx.fillText('HDG SEL', x + colW * 1.5, y + height * 0.5);

    // Pitch
    ctx.fillStyle = '#00ff44';
    ctx.fillText('ALT HLD', x + colW * 2.5, y + height * 0.5);
  }
}
