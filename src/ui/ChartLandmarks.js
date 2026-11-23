import { LANDMARK_PLACES, landmarkName } from '../config/landmarks.js';
import { chartPoint } from '../geospatial/busanChart.js';
import { getLanguage, t } from '../i18n/index.js';

const catalog = LANDMARK_PLACES.map(place => ({ ...place, point: chartPoint(place) }));

/** The map remembers one checkpoint, independently of the place being inspected. */
export class ChartLandmarks {
  constructor(map, canvas) {
    this.layer = map.querySelector('.map-landmarks');
    this.panel = map.querySelector('.map-inspector');
    this.label = map.querySelector('.map-place');
    this.mark = map.querySelector('.map-mark');
    this.buttons = new Map();
    this.streamed = [];
    this.mark.addEventListener('click', () => {
      if (this.inspected) this.checkpoint = this.inspected;
    });
    canvas.addEventListener('click', event => {
      if (!this.matrix) return;
      const rect = canvas.getBoundingClientRect();
      const screen = new DOMPoint(event.clientX - rect.left, event.clientY - rect.top);
      const { x, y } = screen.matrixTransform(this.matrix.inverse());
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.resetTransform();
      ctx.lineWidth = 10 * this.metersPerPixel;
      const bridge = this.bridges.find(place => ctx.isPointInPath(place.path, x, y))
        ?? this.bridges.find(place => ctx.isPointInStroke(place.path, x, y));
      ctx.restore();
      this.inspected = bridge ?? null;
    });
  }

  reset() {
    this.inspected = null;
    this.checkpoint = null;
  }

  update(view, aircraft, width, height, bridges, records) {
    if (records !== this.records) {
      this.records = records;
      this.streamed = (records ?? []).filter(place =>
        Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
        .map(place => ({ ...place, point: chartPoint(place) }));
    }
    this.matrix = new DOMMatrix(view.transform);
    this.metersPerPixel = view.metersPerPixel;
    this.bridges = bridges;
    const visible = new Set();
    const placed = [];
    const labels = [];
    const candidates = [this.checkpoint, this.inspected, ...bridges, ...catalog, ...this.streamed];
    for (const place of candidates) {
      if (!place || visible.has(place.id)) continue;
      const { x, y } = this.matrix.transformPoint({ x: place.point[0], y: place.point[1] });
      if (x < 0 || y < 0 || x > width || y > height) continue;
      if (placed.some(p => Math.hypot(x - p.x, y - p.y) < 24)) continue;
      visible.add(place.id);
      placed.push({ x, y });
      let button = this.buttons.get(place.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-landmark';
        button.addEventListener('click', () => { this.inspected = button.place; });
        this.layer.append(button);
        this.buttons.set(place.id, button);
      }
      button.place = place;
      const name = landmarkName(place, getLanguage());
      button.title = name;
      const leftward = x > width / 2;
      const labelWidth = Math.min(96, name.length * 12 + 6);
      const left = leftward ? x - 8 - labelWidth : x + 8;
      const right = left + labelWidth;
      const fits = !labels.some(p => Math.abs(y - p.y) < 17 && left < p.right && right > p.left);
      button.setAttribute('data-caption', fits ? name : '');
      button.setAttribute('data-left', String(leftward));
      if (fits) labels.push({ left, right, y });
      button.setAttribute('aria-label', name);
      button.setAttribute('aria-pressed', String(place.id === this.checkpoint?.id));
      button.style.left = x + 'px';
      button.style.top = y + 'px';
    }
    for (const [id, button] of this.buttons) {
      if (!visible.has(id)) {
        button.remove();
        this.buttons.delete(id);
      }
    }

    const target = this.inspected ?? this.checkpoint;
    this.panel.hidden = !target;
    if (!target) return;
    const marked = target.id === this.checkpoint?.id;
    const name = landmarkName(target, getLanguage());
    const distance = Math.hypot(target.point[0] - aircraft[0], target.point[1] - aircraft[1]);
    this.label.textContent = (marked ? t('ui.mapCheckpoint', { name }) : name)
      + ' · ' + (distance / 1000).toFixed(1) + ' km';
    this.mark.hidden = marked;
  }
}
