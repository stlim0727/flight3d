import { Vector3 } from 'three';
import { getLanguage, t } from '../i18n/index.js';
import { overtureBase } from '../geospatial/overtureWater.js';
import { ATLAS_ZOOM, atlasOnSheet, decodeAtlasTile, regionalAtlas } from '../geospatial/regionalAtlas.js';
import { chartRunwayBoxes, layoutAtlasNames, overlaps, projectAtlas } from './regionalChartNames.js';
import { findAirportsInRegion, loadAirportManifest } from '../geospatial/airportIndex.js';
import {
  AIRPORT_RADIUS_KM, CHART_TILE_LIMIT, CHART_WATER_ZOOM, chartAircraftMark, chartAirports, chartBounds, chartMetersPerPixel,
  chartNeedsRecenter, chartProjection, chartScaleBar, chartTileTransform, chartWaterTiles,
  decodeWaterRings, formatChartPosition,
} from '../geospatial/regionalChart.js';

const RETRY_MS = 10000;
const TIMEOUT_MS = 8000;
const LAND = '#ece2c6';
const WATER = '#a9c5cb';
const RUNWAY = '#352c25';
const AIRPORT_INK = '#7b2d63';
const INK = '#372e25';
// Overlap neighbouring land quads by a few pixels so antialiased seams do not show.
const SEAM = 0.01;

function ringsPath(rings) {
  const path = new Path2D();
  for (const ring of rings) {
    path.moveTo(ring[0], ring[1]);
    for (let i = 2; i < ring.length; i += 2) path.lineTo(ring[i], ring[i + 1]);
    path.closePath();
  }
  return path;
}

/**
 * North-up paper chart centred where it was unfolded: Overture water tiles for
 * coastline, OurAirports runways and the aircraft at one scale. Requests start
 * only while the paper is shown and are dropped when it folds.
 */
export class RegionalChart {
  constructor(map, { waterSource = overtureBase, atlasSource = regionalAtlas, loadManifest = loadAirportManifest, findAirports = findAirportsInRegion } = {}) {
    this.canvas = map.querySelector('canvas');
    this.aircraft = map.querySelector('.map-aircraft');
    this.status = map.querySelector('.map-area');
    this.credit = map.querySelector('.map-credit');
    this.waterSource = waterSource;
    this.atlasSource = atlasSource;
    this.atlasTiles = new Map();
    this.nameLayer = document.createElement('div');
    this.nameLayer.className = 'map-names';
    this.canvas.after(this.nameLayer);
    this.names = [];
    this.loadManifest = loadManifest;
    this.findAirports = findAirports;
    this.forward = new Vector3();
    this.heading = 0;
    this.tiles = new Map();
    this.view = [];
    this.projection = null;
    this.airports = null;
    this.session = null;
    this.version = 0;
    this.nextUpdate = 0;
  }

  show() {
    this.session?.abort();
    this.session = new AbortController();
    this.key = null;
    this.nextUpdate = 0;
    this.credit.textContent = 'Natural Earth · © OSM · ⓘ';
    this.credit.href = `${import.meta.env?.BASE_URL ?? '/'}data/regional-chart/credits.html`;
  }

  /** Folding drops in-flight requests; the next unfold centres on the aircraft again. */
  hide() {
    this.session?.abort();
    this.session = null;
    for (const [key, entry] of this.tiles) if (entry.state === 'loading') this.tiles.delete(key);
    this.projection = null;
    this.airports = null;
    this.frame = null;
    this.atlasTiles.clear();
    this.atlasExtent = null;
    this.atlasData = null;
    this.projectedAtlas = null;
    this.atlasLayoutExtent = null;
    this.nameAtlas = null;
    this.names = [];
    this.nameLayer.replaceChildren();
  }

  update(position, quaternion, frame) {
    if (!this.session || !frame) return;
    const { toWgs } = frame;
    const now = performance.now();
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + 250;
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    const here = toWgs(position.x, position.z);
    if (!here) return;
    const m = chartMetersPerPixel(width, height);
    this.forward.set(0, 0, -1).applyQuaternion(quaternion);
    let mark = this.projection && chartAircraftMark(this.projection, toWgs, position, this.forward, this.heading);
    if (!mark || frame.origin !== this.frame?.origin || chartNeedsRecenter(mark.point, width, height, m)) {
      this.frame = frame;
      this.recenter(here);
      mark = chartAircraftMark(this.projection, toWgs, position, this.forward, this.heading);
    }
    this.heading = mark.heading;
    this.metersPerPixel = m;
    this.requestTiles(width, height, m, now);
    const extent = [width, height, this.projection.center.latitude, this.projection.center.longitude].join('/');
    if (extent !== this.atlasExtent) {
      this.atlasExtent = extent;
      this.loadAtlas(chartWaterTiles(this.projection, width, height, m, ATLAS_ZOOM));
    }

    const language = getLanguage();
    const ratio = window.devicePixelRatio || 1;
    const { latitude, longitude } = this.projection.center;
    const key = [width, height, ratio, language, latitude, longitude, this.version].join('/');
    if (key !== this.key) {
      this.print(width, height, ratio, mark.point);
      this.key = key;
    }
    const loading = this.airports === null || [...this.atlasTiles.values()].some(entry => !entry.features && !entry.failed) ||
      this.view.some(tile => this.tiles.get(tile.key)?.state === 'loading');
    this.status.textContent = loading ? t('map.chart.loading') : formatChartPosition(here);

    const x = width / 2 + mark.point[0] / m;
    const y = height / 2 + mark.point[1] / m;
    const aircraftBox = { x, y, halfWidth: 13, halfHeight: 13 };
    for (const name of this.names) name.element.hidden = overlaps(name, aircraftBox);
    this.aircraft.hidden = x < 0 || x > width || y < 0 || y > height;
    this.aircraft.style.left = x + 'px';
    this.aircraft.style.top = y + 'px';
    this.aircraft.style.transform = `translate(-50%, -50%) rotate(${mark.heading}rad)`;
  }

  async loadAtlas(tiles) {
    const previous = this.atlasTiles;
    const current = new Map();
    const session = this.session;
    this.atlasTiles = current;
    for (const tile of tiles) {
      const key = `${tile.zoom}/${tile.x}/${tile.y}`;
      let entry = previous.get(key);
      if (!entry || entry.failed) {
        entry = {};
        const signal = AbortSignal.any([session.signal, AbortSignal.timeout(TIMEOUT_MS)]);
        entry.ready = this.atlasSource.getZxy(tile.zoom, tile.x, tile.y, signal)
          .then(result => { entry.features = decodeAtlasTile(result?.data, tile); })
          .catch(error => {
            entry.failed = true;
            if (!session.signal.aborted) console.warn('[RegionalChart] atlas tile unavailable', key, error);
          });
      }
      current.set(key, entry);
    }
    const entries = [...current.values()];
    const visible = () => entries.flatMap(entry => entry.features ?? []);
    this.atlasData = visible();
    if (entries.every(entry => entry.features)) return;
    await Promise.all(entries.map(entry => entry.ready));
    if (session.signal.aborted || this.atlasTiles !== current) return;
    this.atlasData = visible();
    this.version++;
  }

  recenter(center) {
    this.projection = chartProjection(center);
    this.airports = null;
    this.version++;
    this.loadAirports(this.projection, this.session, this.frame.placeAirport);
  }

  async loadAirports(projection, session, place) {
    let airports = { runways: [], labels: [] };
    try {
      const manifest = await this.loadManifest();
      if (session.signal.aborted || projection !== this.projection) return;
      const { latitude, longitude } = projection.center;
      const list = await this.findAirports(manifest, { latitude, longitude, radiusKm: AIRPORT_RADIUS_KM });
      airports = chartAirports(list, projection, place);
    } catch (error) {
      console.warn('[RegionalChart] airport index unavailable', error);
    }
    if (session !== this.session || projection !== this.projection) return;
    this.airports = airports;
    this.version++;
  }

  requestTiles(width, height, m, now) {
    const session = this.session;
    this.view = chartWaterTiles(this.projection, width, height, m).map(tile => ({
      ...tile, key: `${tile.zoom}/${tile.x}/${tile.y}`,
    }));
    for (const tile of this.view) {
      const existing = this.tiles.get(tile.key);
      if (existing) {
        existing.used = now;
        if (existing.state !== 'failed' || now < existing.retryAt) continue;
      }
      const entry = { state: 'loading', used: now, path: null };
      this.tiles.set(tile.key, entry);
      const signal = AbortSignal.any([session.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return this.waterSource.getZxy(tile.zoom, tile.x, tile.y, signal);
        })
        .then(result => {
          if (this.tiles.get(tile.key) !== entry) return;
          entry.path = result?.data ? ringsPath(decodeWaterRings(result.data)) : null;
          entry.state = 'ready';
          this.version++;
        }).catch(() => {
          if (this.tiles.get(tile.key) !== entry) return;
          if (session.signal.aborted) {
            this.tiles.delete(tile.key);
            return;
          }
          entry.state = 'failed';
          entry.retryAt = performance.now() + RETRY_MS;
          this.version++;
        });
    }
    if (this.tiles.size <= CHART_TILE_LIMIT) return;
    const visible = new Set(this.view.map(tile => tile.key));
    const stale = [...this.tiles].filter(([key, entry]) => !visible.has(key) && entry.state !== 'loading')
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key] of stale.slice(0, this.tiles.size - CHART_TILE_LIMIT)) this.tiles.delete(key);
  }

  layoutNames(ctx, width, height, screen, [x, y], placed, x0) {
    const language = getLanguage();
    if (this.nameAtlas === this.projectedAtlas && this.nameLanguage === language &&
        this.nameAirports === this.airports) return;
    const runwayBoxes = chartRunwayBoxes(this.airports?.runways ?? [], screen, this.metersPerPixel);
    const reserved = [
      ...runwayBoxes, ...placed.map(p => ({ ...p, halfWidth: p.radius, halfHeight: p.size / 2 + 3 })),
      { x: (x0 + width) / 2, y: 20, halfWidth: (width - x0) / 2 + 3, halfHeight: 20 },
    ];
    // isPointInPath takes canvas coordinates. Our atlas paths and label boxes
    // are in CSS pixels, including on high-DPR phones.
    ctx.save();
    ctx.resetTransform();
    this.names = layoutAtlasNames(this.projectedAtlas, { ctx, width, height, language, reserved,
      aircraft: { x, y, halfWidth: 13, halfHeight: 13 } });
    ctx.restore();
    this.nameLayer.replaceChildren(...this.names.map(name => {
      const span = document.createElement('span');
      span.textContent = name.text;
      span.style.font = name.font;
      span.style.left = name.x + 'px';
      span.style.top = name.y + 'px';
      name.element = span;
      if (name.dot && runwayBoxes.some(b => overlaps(b, { x: name.dot[0], y: name.dot[1], halfWidth: 2, halfHeight: 2 }))) {
        delete name.dot;
      }
      return span;
    }));
    this.nameAtlas = this.projectedAtlas;
    this.nameLanguage = language;
    this.nameAirports = this.airports;
  }

  print(width, height, ratio, aircraftPoint) {
    this.canvas.setAttribute('aria-label', t('ui.regionalChart'));
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    const ctx = this.canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const m = this.metersPerPixel;
    const cx = width / 2, cy = height / 2;
    const screen = ([east, south]) => [cx + east / m, cy + south / m];
    if (this.atlasLayoutExtent !== this.atlasExtent || this.atlasLayoutData !== this.atlasData) {
      const features = atlasOnSheet(this.atlasData ?? [], chartBounds(this.projection, width * m, height * m));
      this.projectedAtlas = projectAtlas(features, point => screen(this.projection.project(point)));
      this.atlasLayoutExtent = this.atlasExtent;
      this.atlasLayoutData = this.atlasData;
    }

    // Unloaded and failed tiles keep the canvas hatch, so missing data never reads as land.
    // All land goes down before any water, so a tile edge never paints land over its neighbour's sea.
    const ready = this.view.filter(tile => this.tiles.get(tile.key)?.state === 'ready');
    for (const pass of ['land', 'water']) {
      for (const tile of ready) {
        const { path } = this.tiles.get(tile.key);
        if (pass === 'water' && !path) continue;
        const transform = chartTileTransform(this.projection, tile.x, tile.y, tile.zoom ?? CHART_WATER_ZOOM);
        ctx.save();
        ctx.transform(1 / m, 0, 0, 1 / m, cx, cy);
        ctx.transform(...transform);
        ctx.beginPath();
        ctx.rect(-SEAM, -SEAM, 1 + 2 * SEAM, 1 + 2 * SEAM);
        if (pass === 'land') {
          ctx.fillStyle = LAND;
          ctx.fill();
        } else {
          ctx.clip();
          ctx.fillStyle = WATER;
          ctx.fill(path, 'nonzero');
          // Polygons are cut at the tile edge; a same-colour rim closes the antialiased seam.
          ctx.strokeStyle = WATER;
          ctx.lineWidth = 1.5 * m / Math.hypot(transform[0], transform[1]);
          ctx.stroke(path);
        }
        ctx.restore();
      }
    }

    ctx.strokeStyle = '#765d46';
    ctx.lineWidth = 1.35;
    ctx.setLineDash([5, 2]);
    ctx.stroke(this.projectedAtlas.borders);
    ctx.setLineDash([]);

    const { runways = [], labels = [] } = this.airports ?? {};
    ctx.save();
    ctx.transform(1 / m, 0, 0, 1 / m, cx, cy);
    ctx.strokeStyle = RUNWAY;
    ctx.lineCap = 'butt';
    for (const runway of runways) {
      ctx.lineWidth = Math.max(runway.widthM, 3 * m);
      ctx.beginPath();
      ctx.moveTo(...runway.from);
      ctx.lineTo(...runway.to);
      ctx.stroke();
    }
    ctx.restore();

    const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(width, height) / 2);
    shade.addColorStop(0, '#fff2d314');
    shade.addColorStop(1, '#80572727');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const { code, point, major } of [...labels].sort((a, b) => b.major - a.major)) {
      const px = cx + point[0] / m, py = cy + point[1] / m - 14;
      if (px < 0 || px > width || py < 0 || py > height) continue;
      const size = major ? 13 : 11;
      ctx.font = `bold ${size}px Georgia, Batang, serif`;
      const radius = ctx.measureText(code).width / 2 + 4;
      if (placed.some(l => Math.abs(l.x - px) < radius + l.radius && Math.abs(l.y - py) < (size + l.size) / 2 + 3)) continue;
      placed.push({ x: px, y: py, radius, size });
      ctx.strokeStyle = LAND;
      ctx.lineWidth = 3;
      ctx.strokeText(code, px, py);
      ctx.fillStyle = AIRPORT_INK;
      ctx.fillText(code, px, py);
    }

    // Scale bar beside the north arrow, clear of overlays on the paper's left edge.
    const scale = chartScaleBar(m, Math.min(140, width / 4));
    const x0 = width - 40 - scale.pixels, y0 = 20;
    this.layoutNames(ctx, width, height, screen, screen(aircraftPoint), placed, x0);
    ctx.fillStyle = INK;
    for (const { dot } of this.names) {
      if (!dot) continue;
      ctx.beginPath();
      ctx.arc(...dot, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + scale.pixels, y0);
    ctx.lineTo(x0 + scale.pixels, y0 - 4);
    ctx.stroke();
    ctx.font = '600 11px Georgia, Batang, serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(`${scale.km} km`, x0, y0 + 11);

    const nx = width - 18;
    ctx.beginPath();
    ctx.moveTo(nx, 10);
    ctx.lineTo(nx + 5, 22);
    ctx.lineTo(nx, 19);
    ctx.lineTo(nx - 5, 22);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px Georgia, Batang, serif';
    ctx.fillText('N', nx, 31);
  }
}
