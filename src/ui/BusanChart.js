import { Vector3 } from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { CHART_ZOOM, chartAircraft, chartTilePoint, chartView } from '../geospatial/busanChart.js';
import { isWaterPolygon, overtureBase } from '../geospatial/overtureWater.js';
import { clipLine, clipRing } from '../geospatial/incheon.js';
import { t } from '../i18n/index.js';

// A desktop map at the Busan spawn covers about 12 tiles.
const MAX_CACHED_TILES = 64;

function blankLayers() {
  return { land: new Path2D(), water: new Path2D(), decks: new Path2D(), spans: new Path2D() };
}

function appendTile(paths, data, x, y) {
  const layers = new VectorTile(new PbfReader(data)).layers;
  const border = paths.land;
  for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const point = chartTilePoint(x + i, y + j);
    if (!i && !j) border.moveTo(...point);
    else border.lineTo(...point);
  }
  border.closePath();
  for (const name of ['water', 'infrastructure']) {
    const layer = layers[name];
    for (let i = 0; i < (layer?.length ?? 0); i++) {
      const feature = layer.feature(i);
      if (name === 'water') {
        if (!isWaterPolygon(feature)) continue;
      } else if (feature.properties.subtype !== 'bridge' || ![2, 3].includes(feature.type)) continue;
      const polygon = feature.type === 3;
      const path = name === 'water' ? paths.water : polygon ? paths.decks : paths.spans;
      const half = feature.extent / 2;
      for (const ring of feature.loadGeometry()) {
        const local = ring.map(p => [p.x - half, p.y - half]);
        const pieces = polygon ? [clipRing(local, half)] : clipLine(local, half);
        for (const piece of pieces) {
          if (!piece.length) continue;
          for (const [j, [u, v]] of piece.entries()) {
            const point = chartTilePoint(x + (u + half) / feature.extent, y + (v + half) / feature.extent);
            if (j === 0) path.moveTo(...point);
            else path.lineTo(...point);
          }
          if (polygon) path.closePath();
        }
      }
    }
  }
}

function drawBase(ctx, paths, metersPerPixel) {
  ctx.fillStyle = '#ede5cc';
  ctx.fill(paths.land);
  ctx.fillStyle = '#acd1d1';
  // MVT exterior/interior rings have opposite winding. A single fill also
  // avoids separately antialiasing the shared edge of adjacent tiles.
  ctx.fill(paths.water);
  ctx.fillStyle = ctx.strokeStyle = '#655847';
  ctx.lineWidth = 1.6 * metersPerPixel;
  ctx.lineJoin = 'round';
  ctx.stroke(paths.spans);
  ctx.fill(paths.decks);
}

export class BusanChart {
  constructor(map) {
    this.canvas = map.querySelector('canvas');
    this.mode = map.querySelector('.map-mode');
    this.scale = map.querySelector('.map-scale');
    this.status = map.querySelector('.map-status');
    this.tiles = new Map();
    this.cachedPaths = new Map();
    this.forward = new Vector3();
    this.heading = 0;
    this.nextDraw = 0;
    this.mode.addEventListener('click', () => {
      this.headingUp = !this.headingUp;
      this.nextDraw = 0;
    });
    map.addEventListener('toggle', () => {
      if (map.open) return;
      this.controller?.abort();
      this.tiles.clear();
      this.paths = null;
      this.center = null;
      this.nextDraw = 0;
    });
  }

  useTilePaths(key, paths, entry) {
    for (const layer of Object.keys(paths)) this.paths[layer].addPath(paths[layer]);
    entry.ready = true;
    this.cachedPaths.delete(key);
    this.cachedPaths.set(key, paths);
    if (this.cachedPaths.size > MAX_CACHED_TILES) {
      this.cachedPaths.delete(this.cachedPaths.keys().next().value);
    }
  }

  tile(x, y, now) {
    const key = x + '/' + y;
    let entry = this.tiles.get(key);
    if (!entry || entry.retryAt <= now) {
      entry = {};
      this.tiles.set(key, entry);
      const cached = this.cachedPaths.get(key);
      if (cached) {
        this.useTilePaths(key, cached, entry);
        return entry;
      }
      overtureBase.getZxy(CHART_ZOOM, x, y, this.controller.signal).then(result => {
        if (this.tiles.get(key) !== entry) return;
        if (result) {
          const paths = blankLayers();
          appendTile(paths, result.data, x, y);
          this.useTilePaths(key, paths, entry);
        } else entry.missing = true;
      }).catch(() => {
        entry.retryAt = performance.now() + 10000;
      });
    }
    return entry;
  }

  update(position, quaternion) {
    const now = performance.now();
    if (now < this.nextDraw) return;
    this.nextDraw = now + 100;
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    this.forward.set(0, 0, -1).applyQuaternion(quaternion);
    const { point, heading } = chartAircraft(position, this.forward, this.heading);
    this.heading = heading;
    if (!this.center) {
      this.center = point;
      this.controller = new AbortController();
      this.paths = blankLayers();
    }
    const angle = this.headingUp ? heading : 0;
    const view = chartView(this.center, width, height, angle);
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(width * ratio), h = Math.round(height * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.transform(...view.transform);
    let loading = false, missing = false;
    for (const { x, y } of view.tiles) {
      const entry = this.tile(x, y, now);
      if (entry.ready) continue;
      if (entry.missing || entry.retryAt) missing = true;
      else loading = true;
    }
    drawBase(ctx, this.paths, view.metersPerPixel);
    ctx.translate(...point);
    ctx.rotate(heading);
    ctx.scale(view.metersPerPixel, view.metersPerPixel);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 5);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#993e2c';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fffaf0';
    ctx.stroke();
    ctx.restore();

    this.mode.querySelector('.map-north').style.transform = 'rotate(' + (-angle) + 'rad)';
    this.mode.querySelector('.map-mode-label').textContent = t(this.headingUp ? 'ui.mapHeadingUp' : 'ui.mapNorthUp');
    this.mode.setAttribute('aria-pressed', String(Boolean(this.headingUp)));
    this.scale.style.width = (1000 / view.metersPerPixel) + 'px';
    const status = missing ? t('ui.mapUnavailable') : loading ? t('ui.mapLoading') : '';
    if (this.status.textContent !== status) this.status.textContent = status;
    this.status.hidden = !status;
  }
}
