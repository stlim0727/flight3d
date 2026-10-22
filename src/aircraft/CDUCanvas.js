import * as THREE from 'three';

/**
 * Boeing 737 / 777 Class Flight Management Computer (FMC) / Control Display Unit (CDU) Canvas
 * Renders the authentic flight management screen and tactile keypad mounted on the center pedestal.
 */
export class CDUCanvas {
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

    this.activeWpt = 'RW09L';
    this.distNm = 5.2;
    this.v2Speed = 142;
    this.airportId = 'coastal';

    this.render();
  }

  setAirport(airportId) {
    this.airportId = airportId;
    this.activeWpt = (airportId === 'lukla') ? 'RW06' : 'RW09L';
    this.render();
  }

  updateData() {
    const key = JSON.stringify([this.airportId, this.activeWpt, this.distNm, this.v2Speed]);
    if (key !== this.renderKey) {
      this.renderKey = key;
      this.render();
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Outer CDU chassis (Boeing slate grey)
    ctx.fillStyle = '#222933';
    ctx.fillRect(0, 0, w, h);

    // Bezel border
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // 1. CRT / LCD Screen Area (Top half, y: 16 to 240)
    const sx = 32, sy = 24, sw = w - 64, sh = 216;
    ctx.fillStyle = '#060a0f';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);

    // Subtle phosphor CRT scanline effect
    ctx.fillStyle = 'rgba(0, 255, 128, 0.02)';
    for (let y = sy; y < sy + sh; y += 4) {
      ctx.fillRect(sx, y, sw, 1);
    }

    // Line Select Keys (6 left, 6 right) on bezel
    ctx.fillStyle = '#4b5563';
    for (let i = 0; i < 6; i++) {
      const ly = sy + 28 + i * 30;
      // Left key
      ctx.fillRect(8, ly, 18, 12);
      ctx.strokeRect(8, ly, 18, 12);
      // Right key
      ctx.fillRect(w - 26, ly, 18, 12);
      ctx.strokeRect(w - 26, ly, 18, 12);
    }

    // CDU Screen Content
    // Header Line
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ACT RTE 1 LEGS', sx + 12, sy + 24);
    ctx.textAlign = 'right';
    ctx.fillText('1/2', sx + sw - 12, sy + 24);

    // Subheader
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FIX    DIST', sx + 12, sy + 44);
    ctx.textAlign = 'right';
    ctx.fillText('SPD / ALT', sx + sw - 12, sy + 44);

    // Waypoint Rows
    const drawRow = (y, name, dist, spdAlt, isMagenta = false) => {
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = isMagenta ? '#ec4899' : '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(name, sx + 12, y);

      ctx.fillStyle = '#22c55e';
      ctx.font = '12px monospace';
      ctx.fillText(dist, sx + 90, y);

      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = isMagenta ? '#ec4899' : '#22c55e';
      ctx.textAlign = 'right';
      ctx.fillText(spdAlt, sx + sw - 12, y);
    };

    if (this.airportId === 'lukla') {
      drawRow(sy + 70, 'SURKE', '08NM', '160/12000');
      drawRow(sy + 102, 'PHAKD', '04NM', '140/10500');
      drawRow(sy + 134, 'RW06', '01NM', '125/ 9200', true);
    } else {
      drawRow(sy + 70, 'MERIT', '14NM', '250/10000');
      drawRow(sy + 102, 'APPR1', '08NM', '210/ 5000');
      drawRow(sy + 134, 'RW09L', '05NM', '142/  50FL', true);
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('------------------------', sx + sw * 0.5, sy + 162);

    // Bottom Navigation Prompts
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('<RTE DATA', sx + 12, sy + 188);
    ctx.textAlign = 'right';
    ctx.fillText('LEGS INTC>', sx + sw - 12, sy + 188);

    // Scratchpad Line
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('NAV ARMED _', sx + 12, sy + 208);

    // 2. CDU Keypad Area (Bottom half, y: 250 to 500)
    // Mode Buttons: INIT REF, RTE, CLB, CRZ, DES, MENU, LEGS, DEP ARR, HOLD, PROG, EXEC
    const modeKeys = [
      ['INIT REF', 'RTE', 'CLB', 'CRZ', 'DES'],
      ['MENU', 'LEGS', 'DEP ARR', 'HOLD', 'PROG']
    ];

    const kw = 42, kh = 22, kPadX = 14, kPadY = 10;
    const kStartX = 36, kStartY = 252;

    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 5; c++) {
        const kx = kStartX + c * (kw + kPadX);
        const ky = kStartY + r * (kh + kPadY);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(kx, ky, kw, kh);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(kx, ky, kw, kh);

        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(modeKeys[r][c], kx + kw * 0.5, ky + 14);
      }
    }

    // EXEC Key with Amber Light
    const execX = w - 68, execY = 284;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(execX, execY, 44, 24);
    ctx.strokeStyle = '#eab308';
    ctx.strokeRect(execX, execY, 44, 24);
    ctx.fillStyle = '#eab308';
    ctx.fillRect(execX + 6, execY + 3, 32, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('EXEC', execX + 22, execY + 18);

    // Alphanumeric Keypad (Letters & Numbers)
    const numStartX = 36, numStartY = 330;
    const numKeys = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['.', '0', '+/-']
    ];

    ctx.font = 'bold 12px sans-serif';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const nx = numStartX + c * 38;
        const ny = numStartY + r * 38;
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(nx + 14, ny + 14, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#64748b';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(numKeys[r][c], nx + 14, ny + 18);
      }
    }

    // Alphabet Keys (5x5 matrix on right)
    const alphaStartX = 200, alphaStartY = 330;
    const letters = [
      ['A', 'B', 'C', 'D', 'E'],
      ['F', 'G', 'H', 'I', 'J'],
      ['K', 'L', 'M', 'N', 'O'],
      ['P', 'Q', 'R', 'S', 'T'],
      ['U', 'V', 'W', 'X', 'Y']
    ];

    ctx.font = 'bold 11px sans-serif';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const ax = alphaStartX + c * 32;
        const ay = alphaStartY + r * 30;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(ax, ay, 24, 22);
        ctx.strokeStyle = '#475569';
        ctx.strokeRect(ax, ay, 24, 22);

        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(letters[r][c], ax + 12, ay + 15);
      }
    }

    // CLR / DEL Keys at bottom
    ctx.fillStyle = '#475569';
    ctx.fillRect(alphaStartX + 160, alphaStartY + 120, 36, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('CLR', alphaStartX + 178, alphaStartY + 135);

    this.texture.needsUpdate = true;
  }
}
