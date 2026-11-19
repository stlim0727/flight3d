import { APPROACH_DATA } from '../config/approachData.js';
import { projectToLocal } from '../geospatial/incheon.js';
import koreaRoutes from '../config/koreaFlightRoutes.json' with { type: 'json' };
import * as THREE from 'three';

const jejuOrigin = {
  latitude: koreaRoutes.destination.latitude,
  longitude: koreaRoutes.destination.longitude,
};
const tamnaWpt = koreaRoutes.route.find(w => w.ident === 'TAMNA');
const [tamnaWorldX, tamnaWorldZ] = projectToLocal(tamnaWpt.latitude, tamnaWpt.longitude, jejuOrigin);

/**
 * Boeing Navigation Display (ND)
 * Shows compass rose arc, runway centerline, airport fix waypoints, range rings, wind vector, GS/TAS.
 */
export class NDCanvas {
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

    this.heading = 0;
    this.track = 0;
    this.groundSpeed = 0;
    this.tas = 0;
    this.windDir = 270;
    this.windSpeed = 10;
    this.planePos = new THREE.Vector2(0, 0); // World X, Z in meters

    // Range setting in Nautical Miles (10 NM = 18,520m)
    this.rangeNm = 10;
    this.airportId = 'coastal';
  }

  setAirport(airportId) {
    this.airportId = airportId;
    this.render();
  }

  updateData(state) {
    this.heading = (state.headingDeg || 0 + 360) % 360;
    this.track = (state.trackDeg || this.heading + 360) % 360;
    this.groundSpeed = state.groundSpeedKnots || 0;
    this.tas = state.tasKnots || 0;
    this.planePos.set(state.x || 0, state.z || 0);
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Background
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.78; // Aircraft symbol at bottom-center in ARC mode
    const arcRadius = h * 0.62;

    // Top status readouts: GS, TAS, Wind
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`GS ${Math.round(this.groundSpeed)}`, 24, 28);
    ctx.fillText(`TAS ${Math.round(this.tas)}`, 24, 46);

    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(this.windDir)}° / ${Math.round(this.windSpeed)} KT`, w - 24, 28);

    // Range rings
    ctx.strokeStyle = '#283548';
    ctx.lineWidth = 1.5;
    const rings = [0.25, 0.5, 0.75, 1.0];
    rings.forEach((ratio, idx) => {
      const r = arcRadius * ratio;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI * 0.82, -Math.PI * 0.18);
      ctx.stroke();

      // Range text
      ctx.fillStyle = '#4a5d78';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      const nmLabel = Math.round(this.rangeNm * ratio);
      ctx.fillText(`${nmLabel}`, cx - 6, cy - r + 4);
    });

    // Outer compass arc
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, arcRadius, -Math.PI * 0.80, -Math.PI * 0.20);
    ctx.stroke();

    // Compass tick marks
    const pxPerNm = arcRadius / this.rangeNm;
    const hdgRad = THREE.MathUtils.degToRad(this.heading);

    for (let deg = -60; deg <= 60; deg += 5) {
      const markHdg = (Math.round(this.heading) + deg + 360) % 360;
      const angle = THREE.MathUtils.degToRad(deg - 90);
      const isMajor = markHdg % 10 === 0;
      const len = isMajor ? 12 : 6;

      const x1 = cx + Math.cos(angle) * (arcRadius - len);
      const y1 = cy + Math.sin(angle) * (arcRadius - len);
      const x2 = cx + Math.cos(angle) * arcRadius;
      const y2 = cy + Math.sin(angle) * arcRadius;

      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (isMajor) {
        let label = (markHdg / 10).toString().padStart(2, '0');
        if (markHdg === 0) label = 'N';
        if (markHdg === 90) label = 'E';
        if (markHdg === 180) label = 'S';
        if (markHdg === 270) label = 'W';

        const tx = cx + Math.cos(angle) * (arcRadius - 22);
        const ty = cy + Math.sin(angle) * (arcRadius - 22);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, tx, ty);
      }
    }

    // Top heading track triangle & box
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - arcRadius - 4);
    ctx.lineTo(cx - 7, cy - arcRadius - 14);
    ctx.lineTo(cx + 7, cy - arcRadius - 14);
    ctx.closePath();
    ctx.fill();

    const boxW = 50;
    const boxH = 22;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - boxW * 0.5, cy - arcRadius - 38, boxW, boxH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - boxW * 0.5, cy - arcRadius - 38, boxW, boxH);

    ctx.fillStyle = '#00ff44';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(this.heading).toString().padStart(3, '0'), cx, cy - arcRadius - 27);

    // Track line (Current course track)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - arcRadius * 0.95);
    ctx.stroke();

    // Draw Runway & Waypoints relative to aircraft
    // 1 Nautical Mile = 1852 meters
    const metersToNm = 1.0 / 1852.0;

    // Helper to project world (X, Z) into ND screen space
    const projectToScreen = (worldX, worldZ) => {
      // Delta from aircraft in world coordinates (East is +X, North is -Z)
      const dxMeters = worldX - this.planePos.x;
      const dzMeters = worldZ - this.planePos.y; // world Z corresponds to planePos.y

      const eastNm = dxMeters * metersToNm;
      const northNm = -dzMeters * metersToNm;

      // Transform to aircraft heading-relative coordinates (Ahead / Right)
      // Ahead is along heading hdgRad, Right is perpendicular (+90°)
      const sinH = Math.sin(hdgRad);
      const cosH = Math.cos(hdgRad);

      const aheadNm = northNm * cosH + eastNm * sinH;
      const rightNm = eastNm * cosH - northNm * sinH;

      return {
        x: cx + rightNm * pxPerNm,
        y: cy - aheadNm * pxPerNm
      };
    };

    const isLukla = this.airportId === 'lukla';
    const sin58 = 0.848048;
    const cos58 = 0.529919;

    let rwyStart, rwyEnd, extStart, extEnd, activeWpt, threshPos, vor1, vor2, fixes;

    if (this.airportId === 'jeju') {
      const a = APPROACH_DATA.jeju, h = a.headingDeg * Math.PI / 180;
      const at = distance => ({ x: a.threshold.x + Math.sin(h) * distance, z: a.threshold.z - Math.cos(h) * distance });
      activeWpt = 'RW07';
      threshPos = a.threshold;
      rwyStart = projectToScreen(threshPos.x, threshPos.z);
      rwyEnd = projectToScreen(a.end.x, a.end.z);
      const before = at(-6000), after = at(4500);
      extStart = projectToScreen(before.x, before.z); extEnd = projectToScreen(after.x, after.z);
      vor1 = 'RKPC  RW07'; vor2 = 'ILS 109.90';
      fixes = [{ name: 'TAMNA', x: tamnaWorldX, z: tamnaWorldZ }, { name: 'FINAL', ...at(-3000) }, { name: 'RW07', ...threshPos }];
    } else if (this.airportId === 'incheon') {
      const a = APPROACH_DATA.incheon, h = a.headingDeg*Math.PI/180;
      const at = distance => ({ x:a.threshold.x+Math.sin(h)*distance, z:a.threshold.z-Math.cos(h)*distance });
      activeWpt = 'RW15R';
      threshPos = a.threshold;
      rwyStart = projectToScreen(threshPos.x,threshPos.z);
      rwyEnd = projectToScreen(a.end.x,a.end.z);
      const before=at(-6000),after=at(4500);
      extStart=projectToScreen(before.x,before.z);extEnd=projectToScreen(after.x,after.z);
      vor1='RKSI  RW15R';vor2='MODEL APPROACH';
      fixes=[{name:'FINAL',...at(-1500)},{name:'RW15R',...threshPos}];
    } else if (isLukla) {
      activeWpt = 'RW06';
      threshPos = { x: -223.5, z: 139.6 };
      rwyStart = projectToScreen(-223.5, 139.6);
      rwyEnd = projectToScreen(223.5, -139.6);
      extStart = projectToScreen(-8480, 5299);
      extEnd = projectToScreen(848, -530);
      vor1 = 'VOR 1  112.30';
      vor2 = 'NDB    390.0';
      fixes = [
        { name: 'SURKE', x: -6784, z: 4239 },
        { name: 'PHAKD', x: -3816, z: 2385 },
        { name: 'GORGE', x: -1696, z: 1060 },
        { name: 'RW06', x: -224, z: 140 },
        { name: 'NAMCH', x: 2500, z: -5500 }
      ];
    } else if (this.airportId === 'neon') {
      activeWpt = 'RW09';
      threshPos = { x: -2000, z: 0 };
      rwyStart = projectToScreen(-2000, 0);
      rwyEnd = projectToScreen(1800, 0);
      extStart = projectToScreen(-8000, 0);
      extEnd = projectToScreen(6000, 0);
      vor1 = 'SYNTH  108.80';
      vor2 = 'OUTRN  114.20';
      fixes = [
        { name: 'OUTRN', x: -6000, z: 0 },
        { name: 'SYNTH', x: -3500, z: 0 },
        { name: 'RW09', x: -2000, z: 0 },
        { name: 'TOWER', x: 2000, z: 0 }
      ];
    } else {
      activeWpt = 'RW09L';
      threshPos = { x: -1350, z: 0 };
      rwyStart = projectToScreen(-1500, 0);
      rwyEnd = projectToScreen(1500, 0);
      extStart = projectToScreen(-10000, 0);
      extEnd = projectToScreen(8000, 0);
      vor1 = 'VOR 1  109.50';
      vor2 = 'VOR 2  113.80';
      fixes = [
        { name: 'MERIT', x: -12000, z: 2500 },
        { name: 'APPR1', x: -6500, z: 0 },
        { name: 'RW09L', x: -1350, z: 0 },
        { name: 'COAST', x: 3500, z: 4500 },
        { name: 'BAY', x: -2000, z: 8000 }
      ];
    }

    // Extended Runway Centerline (dashed line extending 5 NM with 1 NM cross ticks)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(extStart.x, extStart.y);
    ctx.lineTo(extEnd.x, extEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 1 NM tick marks along final approach course
    for (let nm = 1; nm <= 5; nm++) {
      let tickPos;
      if (this.airportId === 'jeju' || this.airportId === 'incheon') {
        const a = APPROACH_DATA[this.airportId], h = a.headingDeg * Math.PI / 180;
        tickPos = projectToScreen(a.threshold.x - Math.sin(h) * nm * 1852, a.threshold.z + Math.cos(h) * nm * 1852);
      } else if (isLukla) {
        const sTick = -263.5 - nm * 1852;
        tickPos = projectToScreen(sTick * sin58, -sTick * cos58);
      } else {
        tickPos = projectToScreen(-1350 - nm * 1852, 0);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tickPos.x, tickPos.y - 6);
      ctx.lineTo(tickPos.x, tickPos.y + 6);
      ctx.stroke();
    }

    // Active Flight Plan Route (Vivid Magenta Line connecting fixes)
    ctx.strokeStyle = '#f72585';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    fixes.forEach((f, idx) => {
      const p = projectToScreen(f.x, f.z);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Runway symbol (solid white outline rectangle on threshold)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rwyStart.x, rwyStart.y);
    ctx.lineTo(rwyEnd.x, rwyEnd.y);
    ctx.stroke();

    // Waypoint symbols (Cyan stars / triangles with white labels)
    fixes.forEach(fix => {
      const p = projectToScreen(fix.x, fix.z);
      ctx.fillStyle = '#00d2ff';
      ctx.beginPath();
      // Triangle waypoint
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x - 5, p.y + 4);
      ctx.lineTo(p.x + 5, p.y + 4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fix.name, p.x + 8, p.y + 4);
    });

    // Top Right Active Waypoint Block
    ctx.fillStyle = '#f72585';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(activeWpt, w - 24, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    const distMeters = Math.hypot(this.planePos.x - threshPos.x, this.planePos.y - threshPos.z);
    const distToThreshold = Math.max(0.1, distMeters / 1852.0);
    ctx.fillText(`${distToThreshold.toFixed(1)} NM`, w - 24, 62);

    // Bottom Left & Right VOR Frequency Data
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(vor1, 24, h - 24);
    ctx.textAlign = 'right';
    ctx.fillText(vor2, w - 24, h - 24);

    // Aircraft symbol at bottom-center (Authentic Boeing white aircraft glyph)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14); // Nose
    ctx.lineTo(cx - 12, cy + 6); // Left wingtip
    ctx.lineTo(cx - 3, cy + 4);
    ctx.lineTo(cx - 5, cy + 12); // Left stab
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx + 5, cy + 12); // Right stab
    ctx.lineTo(cx + 3, cy + 4);
    ctx.lineTo(cx + 12, cy + 6); // Right wingtip
    ctx.closePath();
    ctx.fill();

    this.texture.needsUpdate = true;
  }
}
