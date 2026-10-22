import * as THREE from 'three';

/**
 * Boeing EICAS (Engine Indication and Crew Alerting System)
 * Displays N1, EGT, N2, Fuel Flow, Landing Gear, Flaps, and flight alert messages.
 */
export class EICASCanvas {
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

    this.e1 = { n1: 22, n2: 60, egt: 420, ff: 350 };
    this.e2 = { n1: 22, n2: 60, egt: 420, ff: 350 };
    this.gearState = 1.0;
    this.gearDamage = {};
    this.isTransit = false;
    this.flapDegree = 0;
    this.spoilers = 0;
    this.parkBrake = false;
    this.reverserActive = false;
    this.isStalled = false;
    this.fuelKg = 14200;
  }

  updateData(state) {
    if (state.engine1) this.e1 = state.engine1;
    if (state.engine2) this.e2 = state.engine2;
    this.gearState = state.gearState !== undefined ? state.gearState : 1.0;
    this.isTransit = state.isTransit || false;
    this.gearDamage = state.gearDamage || {};
    this.flapDegree = state.flapDegree || 0;
    this.spoilers = state.spoilers || 0;
    this.parkBrake = state.parkBrake || false;
    this.reverserActive = state.reverserActive || false;
    this.isStalled = state.isStalled || false;
    if (state.fuelKg !== undefined) this.fuelKg = state.fuelKg;
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark screen bezel
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);

    // Top Engine Dial Header
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.e1.failed ? '#ef4444' : '#4a5d78';
    ctx.fillText(this.e1.failed ? 'ENG 1 FAIL' : 'ENG 1', w * 0.28, 22);
    ctx.fillStyle = this.e2.failed ? '#ef4444' : '#4a5d78';
    ctx.fillText(this.e2.failed ? 'ENG 2 FAIL' : 'ENG 2', w * 0.72, 22);

    // 1. Dual N1% Round Gauges
    const n1Y = 75;
    const n1Radius = 38;
    this.drawDial(ctx, w * 0.28, n1Y, n1Radius, this.e1.n1, 0, 110, 'N1 %', '%');
    this.drawDial(ctx, w * 0.72, n1Y, n1Radius, this.e2.n1, 0, 110, 'N1 %', '%');

    // 2. Dual EGT Round Gauges
    const egtY = 175;
    const egtRadius = 38;
    this.drawDial(ctx, w * 0.28, egtY, egtRadius, this.e1.egt, 0, 1000, 'EGT', '°C', 850);
    this.drawDial(ctx, w * 0.72, egtY, egtRadius, this.e2.egt, 0, 1000, 'EGT', '°C', 850);

    // 3. Digital Readouts: N2% and Fuel Flow (FF)
    const rowY1 = 245;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N2 %', w * 0.5, rowY1);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.e1.n2.toFixed(1), w * 0.28, rowY1);
    ctx.fillText(this.e2.n2.toFixed(1), w * 0.72, rowY1);

    const rowY2 = 270;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('FF KG/H', w * 0.5, rowY2);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(Math.round(this.e1.ff ?? this.e1.fuelFlow ?? 0).toString(), w * 0.28, rowY2);
    ctx.fillText(Math.round(this.e2.ff ?? this.e2.fuelFlow ?? 0).toString(), w * 0.72, rowY2);

    // Hydraulic Pressure & Total Fuel Quantity
    const rowY3 = 292;
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('HYD A 3000', 36, rowY3);
    ctx.textAlign = 'center';
    ctx.fillStyle = this.fuelKg <= 1000 ? '#ef4444' : this.fuelKg <= 3000 ? '#f59e0b' : '#ffffff';
    ctx.fillText(`TOTAL FUEL ${Math.round(this.fuelKg).toLocaleString('en-US')} KG`, w * 0.5, rowY3);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#10b981';
    ctx.fillText('HYD B 3000', w - 36, rowY3);

    // Divider Line
    ctx.strokeStyle = '#222f3e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(24, 304);
    ctx.lineTo(w - 24, 304);
    ctx.stroke();

    // 4. Landing Gear Status (NOSE, L MAIN, R MAIN)
    this.drawGearStatus(ctx, 36, 318, 140, 110);

    // 5. Flaps Position Ladder Indicator
    this.drawFlapsIndicator(ctx, w - 160, 318, 130, 110);

    // 6. Crew Alerting Messages (CAS)
    this.drawAlerts(ctx, 36, 440, w - 72, 60);

    this.texture.needsUpdate = true;
  }

  drawDial(ctx, cx, cy, radius, value, minVal, maxVal, label, unit, redline = 104) {
    // Dial background arc (from -210° to +30°)
    const startAngle = THREE.MathUtils.degToRad(140);
    const endAngle = THREE.MathUtils.degToRad(400);
    const totalAngle = endAngle - startAngle;

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();

    // Redline arc
    const redlineRatio = (redline - minVal) / (maxVal - minVal);
    const redAngle = startAngle + totalAngle * redlineRatio;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, redAngle, endAngle);
    ctx.stroke();

    // Target N1 Command Bug (Green triangle on outer rim at 96% N1)
    if (label.includes('N1')) {
      const targetN1Ratio = (96.0 - minVal) / (maxVal - minVal);
      const targetAngle = startAngle + totalAngle * targetN1Ratio;
      const bugRadius = radius + 6;
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(targetAngle) * bugRadius, cy + Math.sin(targetAngle) * bugRadius, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Needle
    const clampedVal = Math.max(minVal, Math.min(maxVal, value));
    const valRatio = (clampedVal - minVal) / (maxVal - minVal);
    const needleAngle = startAngle + totalAngle * valRatio;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(needleAngle) * (radius - 2), cy + Math.sin(needleAngle) * (radius - 2));
    ctx.stroke();

    // Center hub
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Digital readout box
    const boxW = 54;
    const boxH = 18;
    ctx.fillStyle = '#06090e';
    ctx.fillRect(cx - boxW * 0.5, cy + radius * 0.35, boxW, boxH);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxW * 0.5, cy + radius * 0.35, boxW, boxH);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value.toFixed(1), cx, cy + radius * 0.35 + boxH * 0.5);

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(label, cx, cy - radius * 0.3);
  }

  drawGearStatus(ctx, x, y, width, height) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('LANDING GEAR', x, y + 10);

    const isDown = this.gearState > 0.95;
    const inTransit = this.isTransit || (this.gearState > 0.05 && this.gearState < 0.95);

    let fillColor = '#061a12';
    let borderColor = '#047857';
    let textColor = '#10b981';
    let text = 'DOWN';

    if (isDown) {
      fillColor = '#064e3b';
      borderColor = '#10b981';
      textColor = '#34d399';
      text = 'DOWN';
    } else if (inTransit) {
      fillColor = '#78350f';
      borderColor = '#f59e0b';
      textColor = '#fbbf24';
      text = 'TRANS';
    } else {
      fillColor = '#0f172a';
      borderColor = '#334155';
      textColor = '#64748b';
      text = 'UP';
    }

    // Draw Nose, Left Main, Right Main triangles/boxes
    const drawGearBox = (bx, by, id) => {
      const damage = this.gearDamage[id];
      const failed = damage === 'collapsed';
      const damaged = damage === 'damaged';
      const label = failed ? 'FAIL' : damaged ? 'DMG' : text;
      ctx.fillStyle = failed ? '#450a0a' : damaged ? '#78350f' : fillColor;
      ctx.fillRect(bx, by, 40, 22);
      ctx.strokeStyle = failed ? '#ef4444' : damaged ? '#f59e0b' : borderColor;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(bx, by, 40, 22);

      ctx.fillStyle = failed ? '#ef4444' : damaged ? '#fbbf24' : textColor;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 20, by + 11);
    };

    // Nose
    drawGearBox(x + 46, y + 26, 'nose');
    // Left Main
    drawGearBox(x + 10, y + 60, 'mainLeft');
    // Right Main
    drawGearBox(x + 82, y + 60, 'mainRight');
  }

  drawFlapsIndicator(ctx, x, y, width, height) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('FLAPS', x + width, y + 10);

    // Flap ladder positions: UP, 1, 5, 15, 20, 30, 40
    const stops = [
      { name: 'UP', deg: 0 },
      { name: '1',  deg: 1 },
      { name: '5',  deg: 5 },
      { name: '15', deg: 15 },
      { name: '20', deg: 20 },
      { name: '30', deg: 30 },
      { name: '40', deg: 40 }
    ];

    const ladderX = x + width - 30;
    const startY = y + 26;
    const endY = y + height - 8;
    const ladderLen = endY - startY;

    // Background track
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ladderX, startY);
    ctx.lineTo(ladderX, endY);
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    stops.forEach((s, idx) => {
      const sy = startY + (idx / (stops.length - 1)) * ladderLen;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ladderX, sy);
      ctx.lineTo(ladderX + 8, sy);
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.fillText(s.name, ladderX - 8, sy);
    });

    // Flap indicator pointer
    const norm = Math.min(1.0, this.flapDegree / 40.0);
    const pointerY = startY + norm * ladderLen;

    ctx.fillStyle = '#00ff44';
    ctx.beginPath();
    ctx.moveTo(ladderX + 10, pointerY);
    ctx.lineTo(ladderX + 18, pointerY - 5);
    ctx.lineTo(ladderX + 18, pointerY + 5);
    ctx.closePath();
    ctx.fill();

    // Current Flap digital readout
    ctx.fillStyle = '#00ff44';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(this.flapDegree)}°`, ladderX + 22, pointerY);
  }

  drawAlerts(ctx, x, y, width, height) {
    ctx.fillStyle = '#0d131a';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#222f3e';
    ctx.strokeRect(x, y, width, height);

    let alertLine = y + 16;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';

    if (this.e1.failed || this.e2.failed) {
      ctx.fillStyle = '#ef4444';
      const both = this.e1.failed && this.e2.failed;
      ctx.fillText(both ? 'ENG FAIL 1 AND 2 — FLAMEOUT'
        : `ENG FAIL ${this.e1.failed ? '1' : '2'} — WINDMILLING`, x + 12, alertLine);
      alertLine += 18;
    }

    if (this.isStalled) {
      ctx.fillStyle = '#ef4444';
      ctx.fillText('WARNING: STALL DETECTED', x + 12, alertLine);
      alertLine += 18;
    }

    if (this.reverserActive) {
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('REV: REVERSE THRUST DEPLOYED', x + 12, alertLine);
      alertLine += 18;
    }

    if (this.spoilers > 0.05) {
      ctx.fillStyle = '#34d399';
      ctx.fillText('SPEED BRAKE EXTENDED', x + 12, alertLine);
      alertLine += 18;
    }

    if (this.parkBrake) {
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('PARK BRAKE SET', x + 12, alertLine);
      alertLine += 18;
    }
  }
}
