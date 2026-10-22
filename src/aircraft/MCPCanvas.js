import * as THREE from 'three';

/**
 * Boeing 737 / 777 Class Mode Control Panel (MCP) Canvas
 * Renders the glareshield autopilot control panel with glowing amber 7-segment LED windows,
 * backlit selector knobs, autopilot engagement pushbuttons, and Master Warning/Caution indicators.
 */
export class MCPCanvas {
  constructor(width = 1024, height = 128) {
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

    // Autopilot / Flight Director States
    this.fdLeft = true;
    this.fdRight = true;
    this.atArm = true;
    this.speed = 160;
    this.heading = 90;
    this.altitude = 5000;
    this.vsi = 0;
    this.courseLeft = 90;
    this.courseRight = 90;
    this.apCmdA = true;
    this.apCmdB = false;
    this.lnav = false;
    this.vnav = false;
    this.app = false;
    this.altHold = true;
    this.masterCaution = false;
    this.fireWarning = false;

    this.render();
  }

  updateData(state) {
    if (state.selectedSpeed !== undefined) this.speed = state.selectedSpeed;
    if (state.selectedHeading !== undefined) this.heading = state.selectedHeading;
    if (state.selectedAltitude !== undefined) this.altitude = state.selectedAltitude;
    if (state.apEngaged !== undefined) this.apCmdA = state.apEngaged;
    if (state.apModes !== undefined) {
      this.app = state.apModes.includes('APP');
      this.altHold = state.apModes.includes('ALT');
      this.lnav = state.apModes.includes('HDG');
    }
    if (state.apArmed !== undefined) this.atArm = state.apArmed;
    if (state.isStalled) this.masterCaution = true;
    else this.masterCaution = false;

    const key = JSON.stringify([this.fdLeft, this.fdRight, this.atArm, this.speed,
      this.heading, this.altitude, this.vsi, this.courseLeft, this.courseRight,
      this.apCmdA, this.apCmdB, this.lnav, this.vnav, this.app, this.altHold,
      this.masterCaution, this.fireWarning]);
    if (key !== this.renderKey) {
      this.renderKey = key;
      this.render();
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark Boeing cockpit slate background
    ctx.fillStyle = '#1c222b';
    ctx.fillRect(0, 0, w, h);

    // Bezel border styling
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Subtle brushed metal gradient overlay
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.06)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.1)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Master Warning & Master Caution on left and right flanks
    this.drawAnnunciator(ctx, 16, 24, 52, 38, 'FIRE\nWARN', this.fireWarning ? '#ff2222' : '#3a1111', this.fireWarning ? '#ffffff' : '#662222');
    this.drawAnnunciator(ctx, 74, 24, 62, 38, 'MASTER\nCAUTION', this.masterCaution ? '#ffaa00' : '#3a2800', this.masterCaution ? '#000000' : '#885500');

    // 1. Captain Course Window
    this.drawLedWindow(ctx, 160, 26, 68, 36, 'COURSE', this.courseLeft.toString().padStart(3, '0'));
    this.drawSwitch(ctx, 185, 78, 'F/D', this.fdLeft);

    // 2. Autothrottle (A/T ARM) & Speed Window
    this.drawSwitch(ctx, 252, 38, 'A/T ARM', this.atArm);
    this.drawLedWindow(ctx, 296, 26, 82, 36, 'IAS / MACH', Math.round(this.speed).toString());
    this.drawButton(ctx, 296, 78, 38, 26, 'N1', false);
    this.drawButton(ctx, 340, 78, 38, 26, 'SPEED', true);

    // 3. VNAV / LNAV
    this.drawButton(ctx, 400, 32, 42, 28, 'VNAV', this.vnav);
    this.drawButton(ctx, 400, 72, 42, 28, 'LNAV', this.lnav);

    // 4. Heading Window & HDG SEL
    this.drawLedWindow(ctx, 464, 26, 82, 36, 'HEADING', this.heading.toString().padStart(3, '0'));
    this.drawButton(ctx, 464, 78, 54, 26, 'HDG SEL', true);
    this.drawButton(ctx, 526, 78, 52, 26, 'VOR LOC', false);

    // 5. Altitude Window & ALT HLD
    this.drawLedWindow(ctx, 600, 26, 94, 36, 'ALTITUDE', Math.round(this.altitude).toString().padStart(5, '0'));
    this.drawButton(ctx, 600, 78, 44, 26, 'APP', this.app);
    this.drawButton(ctx, 650, 78, 44, 26, 'ALT HLD', this.altHold);

    // 6. Vertical Speed Window
    const vsiStr = (this.vsi >= 0 ? '+' : '-') + Math.abs(this.vsi).toString().padStart(4, '0');
    this.drawLedWindow(ctx, 716, 26, 86, 36, 'VERT SPEED', vsiStr);
    this.drawButton(ctx, 730, 78, 54, 26, 'V / S', false);

    // 7. Autopilot CMD A & CMD B
    this.drawButton(ctx, 824, 32, 54, 32, 'CMD A', this.apCmdA, '#10b981');
    this.drawButton(ctx, 824, 74, 54, 32, 'CWS A', false);

    this.drawButton(ctx, 890, 32, 54, 32, 'CMD B', this.apCmdB, '#10b981');
    this.drawButton(ctx, 890, 74, 54, 32, 'CWS B', false);

    // 8. Autopilot Disengage Paddle Bar (Red/White Bar)
    this.drawDisengageBar(ctx, 824, 114, 120, 10);

    // 9. First Officer Course Window
    this.drawLedWindow(ctx, 960, 26, 68, 36, 'COURSE', this.courseRight.toString().padStart(3, '0'));
    this.drawSwitch(ctx, 985, 78, 'F/D', this.fdRight);

    this.texture.needsUpdate = true;
  }

  drawLedWindow(ctx, x, y, w, h, label, value) {
    // Label above window
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w * 0.5, y - 6);

    // Sunken LED window frame
    ctx.fillStyle = '#06080b';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Glowing Amber 7-Segment style readout
    ctx.fillStyle = '#ff9f1c';
    ctx.shadowColor = '#ff9f1c';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(value, x + w * 0.5, y + 25);
    ctx.shadowBlur = 0; // Reset
  }

  drawButton(ctx, x, y, w, h, label, active, activeColor = '#22c55e') {
    ctx.fillStyle = active ? '#1a2e26' : '#111827';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? activeColor : '#374151';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Active indicator light bar on top of button
    if (active) {
      ctx.fillStyle = activeColor;
      ctx.fillRect(x + 4, y + 3, w - 8, 3);
    }

    ctx.fillStyle = active ? '#ffffff' : '#9ca3af';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w * 0.5, y + (active ? 18 : 16));
  }

  drawSwitch(ctx, x, y, label, active) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 10);

    // Toggle switch base
    ctx.fillStyle = '#0b0f17';
    ctx.beginPath();
    ctx.arc(x, y + 4, 8, 0, Math.PI * 2);
    ctx.fill();

    // Toggle metal bat
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    if (active) {
      ctx.lineTo(x, y - 8); // Toggled UP
    } else {
      ctx.lineTo(x, y + 16); // Toggled DOWN
    }
    ctx.stroke();

    // Indicator green dot
    if (active) {
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(x + 12, y + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawAnnunciator(ctx, x, y, w, h, text, bg, fg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = fg;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    const lines = text.split('\n');
    if (lines.length === 1) {
      ctx.fillText(lines[0], x + w * 0.5, y + h * 0.5 + 3);
    } else {
      ctx.fillText(lines[0], x + w * 0.5, y + 15);
      ctx.fillText(lines[1], x + w * 0.5, y + 27);
    }
  }

  drawDisengageBar(ctx, x, y, w, h) {
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Diagonal stripes on disengage bar
    ctx.fillStyle = '#ffffff';
    for (let sx = x + 10; sx < x + w - 10; sx += 18) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 8, y);
      ctx.lineTo(sx + 13, y);
      ctx.lineTo(sx + 5, y + h);
      ctx.fill();
    }
  }
}
