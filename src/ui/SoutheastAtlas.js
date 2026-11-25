import data from '../geospatial/southeastAtlas.json' with { type: 'json' };
import { Vector3 } from 'three';
import { getLanguage } from '../i18n/index.js';
import { chartAircraft, chartPoint, SOUTHEAST_ATLAS_BOUNDS } from '../geospatial/busanChart.js';
import { t } from '../i18n/index.js';

// Natural Earth 1:10m admin-1 boundaries, roads and river centerlines.
// Coordinates are simplified for the printed regional scale, in WGS84.
function ink(lines, close = false) {
  const path = new Path2D();
  for (const line of lines) {
    for (const [i, [longitude, latitude]] of line.entries()) {
      const point = chartPoint({ longitude, latitude });
      if (i === 0) path.moveTo(...point);
      else path.lineTo(...point);
    }
    if (close) path.closePath();
  }
  return path;
}

const lettering = [
  ['경상남도', 'Gyeongsangnam-do', 128.12, 35.47, true],
  ['부산', 'Busan', 129.08, 35.19, true],
  ['울산', 'Ulsan', 129.25, 35.56, true],
  ['진주', 'Jinju', 128.08, 35.18],
  ['창원', 'Changwon', 128.68, 35.23],
  ['통영', 'Tongyeong', 128.43, 34.85],
  ['거창', 'Geochang', 127.91, 35.69],
  ['밀양', 'Miryang', 128.75, 35.49],
];

export class SoutheastAtlas {
  constructor(map) {
    this.canvas = map.querySelector('canvas');
    this.aircraft = map.querySelector('.map-aircraft');
    this.forward = new Vector3();
    this.heading = 0;
    this.status = map.querySelector('.map-area');
    this.credit = map.querySelector('.map-credit');
    this.ids = Object.keys(data.regions);
    this.regions = Object.values(data.regions).map(rings => ink(rings, true));
    this.surroundings = ink(data.surroundings, true);
    this.roads = ink(data.roads);
    this.rivers = ink(data.rivers);
    this.hit = document.createElement('canvas').getContext('2d');
    this.nextUpdate = 0;
  }

  areaAt(x, y) {
    const inside = this.regions.findIndex(path => this.hit.isPointInPath(path, x, y, 'evenodd'));
    if (inside >= 0) return this.ids[inside];
    if (this.hit.isPointInPath(this.surroundings, x, y, 'evenodd')) return 'outside';
    // Use the nearest broad coastal belt, including flights over the bay.
    for (const radius of [3000, 8000, 15000]) {
      this.hit.lineWidth = radius * 2;
      const shore = this.regions.findIndex(path => this.hit.isPointInStroke(path, x, y));
      if (shore >= 0) return this.ids[shore];
    }
    return 'outside';
  }

  /** Take over the shared paper; the next update reprints it. */
  show() {
    this.key = null;
    this.nextUpdate = 0;
    this.credit.textContent = 'Natural Earth';
    this.credit.href = 'https://www.naturalearthdata.com/';
  }

  hide() {}

  update(position, quaternion, frame) {
    const now = performance.now();
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + 250;
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    const language = getLanguage();
    this.forward.set(0, 0, -1).applyQuaternion(quaternion);
    const { point, heading } = chartAircraft(position, this.forward, this.heading, frame?.toWgs);
    this.heading = heading;
    const area = this.areaAt(...point);
    const ratio = window.devicePixelRatio || 1;
    const key = [width, height, ratio, language, area].join('/');
    if (key !== this.key) {
      this.print(width, height, ratio, language, area);
      this.key = key;
    }
    const { m, tx, ty } = this.projection;
    const x = tx + point[0] / m, y = ty + point[1] / m;
    this.aircraft.hidden = x < 0 || x > width || y < 0 || y > height;
    this.aircraft.style.left = x + 'px';
    this.aircraft.style.top = y + 'px';
    this.aircraft.style.transform = `translate(-50%, -50%) rotate(${heading}rad)`;
  }

  print(width, height, ratio, language, area) {
    const names = { 'KR-48': ['경상남도 일대', 'South Gyeongsang area'], 'KR-26': ['부산 일대', 'Busan area'],
      'KR-31': ['울산 일대', 'Ulsan area'], outside: ['표시 권역 밖', 'Outside charted regions'] };
    this.status.textContent = names[area][language === 'ko' ? 0 : 1];
    this.canvas.setAttribute('aria-label', t('ui.busanChart'));
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    const ctx = this.canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const bounds = SOUTHEAST_ATLAS_BOUNDS;
    const [west, north] = chartPoint({ longitude: bounds.west, latitude: bounds.north });
    const [east, south] = chartPoint({ longitude: bounds.east, latitude: bounds.south });
    const m = Math.max((east - west) / (width * .89), (south - north) / (height * .84));
    const tx = width / 2 - (west + east) / (2 * m);
    const ty = height / 2 - (north + south) / (2 * m);
    this.projection = { m, tx, ty };

    ctx.fillStyle = '#b8b4a0';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.transform(1 / m, 0, 0, 1 / m, tx, ty);
    ctx.fillStyle = '#d8c4a4';
    ctx.fill(this.surroundings, 'evenodd');
    for (const [i, region] of this.regions.entries()) {
      ctx.fillStyle = this.ids[i] === area ? '#e7c18c' : '#e4ceb0';
      ctx.fill(region, 'evenodd');
      ctx.strokeStyle = '#66523c';
      ctx.lineWidth = 1.25 * m;
      ctx.stroke(region);
    }
    ctx.strokeStyle = '#a18c6b';
    ctx.lineWidth = .75 * m;
    ctx.stroke(this.roads);
    ctx.strokeStyle = '#858f88';
    ctx.lineWidth = 1.8 * m;
    ctx.stroke(this.rivers);
    ctx.restore();

    const shade = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.hypot(width,height)/2);
    shade.addColorStop(0, '#fff2d314');
    shade.addColorStop(1, '#80572727');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = [];
    for (const [ko, en, longitude, latitude, major] of lettering) {
      const [x, y] = chartPoint({ longitude, latitude });
      const px = tx + x / m, py = ty + y / m - (major ? 0 : 9);
      const size = major ? Math.min(26, Math.max(14, height / 23)) : 12;
      ctx.font = (major ? 'bold ' : '') + size + 'px Georgia, Batang, serif';
      const name = language === 'ko' ? ko : en;
      const radius = ctx.measureText(name).width / 2 + 4;
      if (labels.some(l => Math.abs(l.x - px) < radius + l.radius && Math.abs(l.y - py) < (size+l.size)/2+3)) continue;
      labels.push({ x: px, y: py, radius, size });
      ctx.strokeStyle = '#e8d2ae';
      ctx.lineWidth = 3;
      ctx.strokeText(name, px, py);
      ctx.fillStyle = '#372e25';
      ctx.fillText(name, px, py);
      if (!major) {
        ctx.beginPath();
        ctx.arc(px, py + 9, 1.7, 0, 2*Math.PI);
        ctx.fill();
      }
    }
  }
}
