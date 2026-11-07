import { Vector3 } from 'three';
import { t } from '../i18n/index.js';
import { edgePosition, indicatorMode, screenBearing } from './remoteIndicator.js';

const TOP_UI = '.hud-top-bar, .flight-toolbar';
const BOTTOM_UI = '.touch-throttle-card, .touch-stick-card, .touch-rudder-card, #touch-btn-brake';
const PANELS = '#mp-room-menu, .flight-panel, .ap-panel, .flight-more-panel, .hud-unfold-pill, .flight-warning, .stall-banner, #touch-btn-gyro, #touch-btn-recenter';
const SVG = 'http://www.w3.org/2000/svg';

function visibleRects(selector) {
  return [...document.querySelectorAll(selector)].flatMap(node => {
    const rect = node.getBoundingClientRect();
    return rect.width && rect.height && getComputedStyle(node).visibility === 'visible' ? [rect] : [];
  });
}

function distanceLabel(meters) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export class RemoteAircraftIndicator {
  constructor() {
    this.anchor = new Vector3();
    this.view = new Vector3();
    this.label = document.createElement('div');
    this.label.className = 'mp-nameplate';
    this.bounds = document.createElement('div');
    this.bounds.className = 'mp-indicator-bounds';
    this.marker = document.createElement('div');
    this.marker.className = 'mp-edge-marker';
    this.plate = document.createElement('div');
    this.plate.className = 'mp-nameplate';
    this.name = document.createElement('span');
    this.status = document.createElement('span');
    this.plate.append(this.name, this.status);
    this.arrow = document.createElementNS(SVG, 'svg');
    this.arrow.setAttribute('viewBox', '0 0 20 20');
    this.arrow.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M4 3L17 10L4 17L8 10Z');
    this.arrow.append(path);
    this.marker.append(this.arrow, this.plate);
    this.bounds.append(this.marker);
    document.body.append(this.label, this.bounds);
    this.hide();
  }

  hide() {
    this.mode = 'hidden';
    this.bearing = null;
    this.label.hidden = true;
    this.marker.hidden = true;
  }

  update(position, name, status, camera, { distance, cameraMode } = {}) {
    if (this.cameraMode !== cameraMode) this.hide();
    this.cameraMode = cameraMode;
    const width = innerWidth, height = innerHeight;
    camera.updateWorldMatrix(true, false);
    this.anchor.copy(position);
    this.anchor.y += 10;
    this.anchor.applyMatrix4(camera.matrixWorldInverse);
    const front = this.anchor.z < 0;
    this.anchor.applyMatrix4(camera.projectionMatrix);
    const x = (this.anchor.x + 1) * width / 2;
    const y = (1 - this.anchor.y) * height / 2;
    this.mode = indicatorMode({ x, y, front, inDepth: Math.abs(this.anchor.z) <= 1 }, width, height, this.mode);
    if (this.mode === 'onscreen') {
      this.marker.hidden = true;
      this.label.hidden = false;
      const text = name + status;
      if (this.label.textContent !== text || this.labelViewport !== width) {
        this.label.textContent = text;
        this.labelViewport = width;
        this.labelSize = this.label.getBoundingClientRect();
      }
      const halfWidth = this.labelSize.width / 2;
      this.label.style.left = `${Math.max(halfWidth, Math.min(x, width - halfWidth))}px`;
      this.label.style.top = `${Math.max(this.labelSize.height, y)}px`;
      return;
    }
    this.label.hidden = true;
    this.view.copy(position).applyMatrix4(camera.matrixWorldInverse);
    const matrix = camera.projectionMatrix.elements;
    const bearing = screenBearing(this.view, matrix[0] * width / 2, matrix[5] * height / 2, this.bearing);
    if (!bearing) { this.marker.hidden = true; return; }
    this.bearing = bearing;
    const vertical = Math.abs(bearing.y) > Math.abs(bearing.x);
    const direction = vertical ? (bearing.y < 0 ? 'up' : 'down') : (bearing.x < 0 ? 'left' : 'right');
    const rear = bearing.directlyBehind ? t('mp.directlyBehind')
      : bearing.behind ? t(vertical ? (bearing.y < 0 ? 'mp.behindAbove' : 'mp.behindBelow') : 'mp.behind') : '';
    const suffix = status + (rear ? ` · ${rear}` : '');
    this.place(bearing, direction, name, suffix, Number.isFinite(distance) ? distanceLabel(distance) : '', width, height);
  }

  place(bearing, direction, name, suffix, distance, width, height) {
    const safe = this.bounds.getBoundingClientRect();
    const viewport = {
      left: safe.left, right: safe.right,
      top: Math.max(safe.top, ...visibleRects(TOP_UI).map(r => r.bottom + 8)),
      bottom: Math.min(safe.bottom, ...visibleRects(BOTTOM_UI).map(r => r.top - 8)),
    };
    const obstacles = visibleRects(PANELS);
    const key = JSON.stringify([direction, name, suffix, distance, width, height]);
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      this.sizes = [];
    }
    const options = distance ? [[distance, false], ['', false], ['', true]] : [['', false], ['', true]];
    this.marker.hidden = false;
    for (const [index, [detail, compact]] of options.entries()) {
      // Measure only when the text, direction or viewport changes. Reusing
      // dimensions keeps per-frame position updates out of the layout reads.
      const applyText = () => {
        this.marker.dataset.direction = direction;
        this.marker.classList.toggle('mp-edge-compact', compact);
        this.name.textContent = name;
        this.status.textContent = suffix + (detail ? ` · ${detail}` : '');
        this.variant = `${key}:${index}`;
      };
      if (!this.sizes[index]) {
        applyText();
        const { width, height } = this.marker.getBoundingClientRect();
        this.sizes[index] = { width, height };
      }
      const size = this.sizes[index];
      const p = edgePosition(bearing, viewport, size, obstacles);
      if (!p) continue;
      if (this.variant !== `${key}:${index}`) applyText();
      this.arrow.style.transform = `rotate(${Math.atan2(bearing.y, bearing.x)}rad)`;
      this.marker.style.transform = `translate(${p.x - safe.left - size.width / 2}px, ${p.y - safe.top - size.height / 2}px)`;
      return;
    }
    this.marker.hidden = true;
  }

  dispose() {
    this.label.remove();
    this.bounds.remove();
  }
}
