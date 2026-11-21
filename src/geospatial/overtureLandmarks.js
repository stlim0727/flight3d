import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { tileToWgs84 } from './TileCoordinateSystem.js';

const EARTH_EQUATOR_CIRCUMFERENCE_M = 40075016;
const GENERIC_UNIT_RE = /^(?:\d+동?|\d+호|\d+통|\d+반|[a-z]동|building\s*\d+|block\s*[a-z0-9]+)$/i;
const RESIDENTIAL_NAME_RE = /(?:\b(?:apartments?|apt|condos?|condominiums?|residences?|residential|lofts?|flats?|dormitor(?:y|ies)|housing)\b|아파트|오피스텔|빌라|맨션|자이|푸르지오|래미안|힐스테이트|더샵|캐슬|아이파크|스위첸|이편한세상|e편한세상|호반|중흥|우미린|sk뷰|롯데캐슬)/i;

const RESIDENTIAL_BUILDING_CLASSES = new Set([
  'apartments', 'house', 'detached', 'semidetached_house', 'terrace',
  'residential', 'dormitory', 'parking', 'garage', 'shed', 'warehouse',
]);
const ICONIC_BUILDING_CLASSES = new Set([
  'stadium', 'museum', 'cathedral', 'palace', 'castle', 'tower', 'terminal', 'train_station',
  'performing_arts', 'opera_house',
]);
const AIRPORT_CLASSES = new Set([
  'international_airport', 'airport', 'regional_airport', 'municipal_airport', 'airfield',
]);
const TOWER_CLASSES = new Set(['communication_tower', 'observation_tower', 'tower', 'lighthouse']);
const PARK_CLASSES = new Set(['park', 'state_park', 'nature_reserve', 'protected_landscape_seascape']);
const WATER_CLASSES = new Set(['lake', 'bay', 'strait', 'waterfall']);

function parsedNamesObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isUsableName(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || GENERIC_UNIT_RE.test(trimmed)) return false;
  return true;
}

/** Extract clean localized `{ ko, en }` names from Overture feature properties. */
export function parseOvertureNames(properties) {
  if (!properties) return null;
  const parsed = parsedNamesObject(properties.names);
  const primary = typeof parsed?.primary === 'string' && parsed.primary.trim()
    ? parsed.primary.trim()
    : (typeof properties['@name'] === 'string' ? properties['@name'].trim() : '');
  const common = parsed?.common && typeof parsed.common === 'object' ? parsed.common : {};
  const rules = Array.isArray(parsed?.rules) ? parsed.rules : [];
  const shortKo = rules.find(rule => rule?.variant === 'short' && rule?.language === 'ko' && typeof rule?.value === 'string')?.value?.trim();
  const commonKo = typeof common.ko === 'string' ? common.ko.trim() : '';
  const commonEn = typeof common.en === 'string' ? common.en.trim() : '';
  const ko = shortKo || commonKo || (/[가-힣]/.test(primary) ? primary : (commonEn || primary));
  const en = commonEn || primary || ko;
  if (!isUsableName(ko) || !isUsableName(en)) return null;
  return { ko: ko.trim(), en: en.trim() };
}

/** Compute centroid WGS84 coordinate and approximate metric span for an MVT feature. */
export function featureGeometryMeta(feature, tile, zoom) {
  const extent = feature.extent || 4096;
  const [west, north, east, south] = feature.bbox();
  const cx = (west + east) / (2 * extent);
  const cy = (north + south) / (2 * extent);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx < 0 || cx >= 1 || cy < 0 || cy >= 1) return null;
  const { latitude, longitude } = tileToWgs84(tile.x + cx, tile.y + cy, zoom);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const tileSizeM = (EARTH_EQUATOR_CIRCUMFERENCE_M * Math.cos(latitude * Math.PI / 180)) / (2 ** zoom);
  const widthM = Math.abs(east - west) / extent * tileSizeM;
  const heightM = Math.abs(south - north) / extent * tileSizeM;
  return {
    latitude,
    longitude,
    widthM,
    heightM,
    areaM2: widthM * heightM,
    spanM: Math.hypot(widthM, heightM),
    clipped: west <= 0 || north <= 0 || east >= extent || south >= extent,
  };
}

function airportCode(properties, keys, length) {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (new RegExp(`^[A-Z]{${length}}$`).test(code)) return code;
  }
  return undefined;
}

function makeLandmark(properties, names, meta, extra) {
  const icao = airportCode(properties, ['icao_code', 'icao'], 4);
  const iata = airportCode(properties, ['iata_code', 'iata'], 3);
  return {
    id: properties.wikidata || properties.id || `${extra.prefix}:${names.en}`,
    wikidata: typeof properties.wikidata === 'string' && properties.wikidata ? properties.wikidata : undefined,
    ...(icao ? { icao } : {}),
    ...(iata ? { iata } : {}),
    names,
    latitude: meta.latitude,
    longitude: meta.longitude,
    importance: extra.importance,
    prominence: extra.prominence,
    kinds: extra.kinds,
    elevationM: extra.elevationM,
    groundRelative: extra.groundRelative ?? true,
    heightOffsetM: extra.heightOffsetM ?? 20,
    clipped: Boolean(extra.clipped ?? meta.clipped),
    streamed: true,
  };
}

/** Extract city, district, and notable town anchors from an Overture `divisions` tile. */
export function extractDivisionLandmarks(data, tile, zoom) {
  const layer = new VectorTile(new PbfReader(data)).layers.division;
  if (!layer?.length) return [];
  const records = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 1) continue;
    const properties = feature.properties;
    const names = parseOvertureNames(properties);
    if (!names) continue;
    const sub = properties.subtype;
    const cls = properties.class;
    const prom = Number(properties['@prominence']) || 0;
    const pop = Number(properties.population) || 0;
    const hasWd = Boolean(properties.wikidata);

    let importance = 0;
    let prominence = 0.4;
    let kinds;
    let heightOffsetM = 20;

    if (sub === 'locality' && cls === 'city') {
      importance = (prom >= 85 || pop >= 1_000_000) ? 5 : (prom >= 60 || pop >= 200_000) ? 4 : 3;
      prominence = Math.min(1, Math.max(prom / 100, pop > 0 ? Math.log10(pop) / 7 : 0.4));
      kinds = ['city'];
      heightOffsetM = 40;
    } else if (sub === 'county' || sub === 'macrohood') {
      if (!hasWd && pop < 100_000 && sub !== 'macrohood') continue;
      importance = 3;
      prominence = hasWd ? 0.55 : 0.4;
      kinds = ['district', 'city'];
      heightOffsetM = 30;
    } else if (sub === 'locality' && (cls === 'town' || cls === 'village')) {
      if (!hasWd) continue;
      importance = cls === 'town' ? 2 : 1;
      prominence = 0.35;
      kinds = ['town', 'city'];
      heightOffsetM = 20;
    } else {
      continue;
    }

    const meta = featureGeometryMeta(feature, tile, zoom);
    if (!meta) continue;
    records.push(makeLandmark(properties, names, meta, {
      prefix: 'div',
      importance,
      prominence,
      kinds,
      groundRelative: true,
      heightOffsetM,
      clipped: false,
    }));
  }
  return records;
}

function classifyInfrastructure(feature, properties, names, meta) {
  const sub = properties.subtype;
  const cls = properties.class;
  const hasWd = Boolean(properties.wikidata);
  const height = Number(properties.height) || 0;

  if (sub === 'airport' && AIRPORT_CLASSES.has(cls)) {
    return {
      prefix: 'airport',
      importance: (cls === 'international_airport' || hasWd) ? 5 : 4,
      prominence: 0.95,
      kinds: ['airport'],
      heightOffsetM: 35,
    };
  }
  if (TOWER_CLASSES.has(cls) && (hasWd || height >= 80)) {
    return {
      prefix: 'tower',
      importance: hasWd ? 5 : 4,
      prominence: hasWd ? 0.9 : 0.7,
      kinds: ['tower', 'attraction'],
      heightOffsetM: Math.max(height, 60),
    };
  }
  if (sub === 'bridge' && cls === 'bridge' && hasWd && feature.type === 3 && meta.spanM >= 150) {
    return {
      prefix: 'bridge',
      importance: meta.spanM >= 1200 ? 5 : 4,
      prominence: 0.8,
      kinds: ['bridge'],
      heightOffsetM: Math.max(height, 45),
    };
  }
  if (cls === 'dam' || (sub === 'power' && cls === 'plant' && hasWd)) {
    const isDam = cls === 'dam' || /댐|dam/i.test(`${names.ko} ${names.en}`);
    return {
      prefix: isDam ? 'dam' : 'plant',
      importance: 3,
      prominence: 0.7,
      kinds: isDam ? ['dam'] : ['corporate'],
      heightOffsetM: 35,
    };
  }
  if (sub === 'transit' && (cls === 'railway_station' || cls === 'subway_station') && hasWd) {
    return {
      prefix: 'station',
      importance: cls === 'railway_station' ? 2 : 1,
      prominence: cls === 'railway_station' ? 0.65 : 0.45,
      kinds: ['station', cls === 'subway_station' ? 'subway' : 'rail'],
      heightOffsetM: 20,
    };
  }
  return null;
}

function classifyLand(feature, properties, meta) {
  const cls = properties.class;
  const hasWd = Boolean(properties.wikidata);
  if (feature.type === 1 && (cls === 'peak' || cls === 'volcano')) {
    const elevation = Number(properties.elevation);
    const hasElev = Number.isFinite(elevation);
    if (!hasWd && !(hasElev && elevation >= 700)) return null;
    const elevVal = hasElev ? elevation : 0;
    const importance = ((cls === 'volcano' && hasWd) || (hasWd && elevVal >= 1500) || elevVal >= 5000) ? 5
      : ((hasWd && elevVal >= 500) || cls === 'volcano' || elevVal >= 2500) ? 4 : 3;
    const prominence = (hasWd ? 0.55 : 0.25) + Math.min(0.45, Math.max(0, elevVal / 3000));
    return {
      prefix: 'peak',
      importance,
      prominence,
      kinds: ['peak'],
      elevationM: hasElev ? elevation : undefined,
      groundRelative: !hasElev,
      heightOffsetM: hasElev ? 0 : 15,
    };
  }
  if (cls === 'island' && hasWd && !meta.clipped && meta.areaM2 >= 2e5 && meta.areaM2 <= 4e8) {
    return {
      prefix: 'island',
      importance: meta.areaM2 >= 1e7 ? 4 : 3,
      prominence: 0.65,
      kinds: ['island', 'water'],
      groundRelative: true,
      heightOffsetM: 30,
    };
  }
  if (cls === 'islet' && hasWd && !meta.clipped && meta.areaM2 >= 2e4) {
    return {
      prefix: 'islet',
      importance: 3,
      prominence: 0.6,
      kinds: ['island', 'water'],
      groundRelative: true,
      heightOffsetM: 20,
    };
  }
  if (cls === 'beach' && hasWd && !meta.clipped) {
    return {
      prefix: 'beach',
      importance: 3,
      prominence: 0.65,
      kinds: ['attraction', 'water'],
      groundRelative: true,
      heightOffsetM: 15,
    };
  }
  return null;
}

function classifyLandUse(properties, names, meta, zoom) {
  if (meta.clipped && zoom >= 13 && meta.spanM > 3000) return null;
  const cls = properties.class;
  const sub = properties.subtype;
  const hasWd = Boolean(properties.wikidata);
  if (cls === 'airfield' && hasWd) {
    return { prefix: 'airfield', importance: 4, prominence: 0.85, kinds: ['airport'], heightOffsetM: 30 };
  }
  if (cls === 'national_park' && hasWd) {
    return { prefix: 'park', importance: 4, prominence: 0.8, kinds: ['park', 'attraction'], heightOffsetM: 40 };
  }
  if (cls === 'theme_park' && (hasWd || meta.areaM2 >= 5e4)) {
    return { prefix: 'theme', importance: 4, prominence: 0.8, kinds: ['attraction'], heightOffsetM: 35 };
  }
  if (cls === 'stadium' && hasWd) {
    return { prefix: 'stadium', importance: 3, prominence: 0.7, kinds: ['attraction'], heightOffsetM: 35 };
  }
  if (cls === 'university' && (hasWd || meta.areaM2 >= 3e5)) {
    return { prefix: 'univ', importance: 3, prominence: 0.6, kinds: ['corporate'], heightOffsetM: 30 };
  }
  if (PARK_CLASSES.has(cls) && hasWd && meta.areaM2 >= 2e5) {
    return { prefix: 'park', importance: 3, prominence: 0.6, kinds: ['park', 'attraction'], heightOffsetM: 25 };
  }
  if ((cls === 'industrial' || cls === 'commercial') && meta.areaM2 >= 5e5 && !RESIDENTIAL_NAME_RE.test(names.ko)) {
    return { prefix: 'campus', importance: 3, prominence: 0.65, kinds: ['corporate'], heightOffsetM: 30 };
  }
  if (cls === 'port' || cls === 'harbour' || (sub === 'transportation' && hasWd && meta.areaM2 >= 2e5)) {
    return { prefix: 'port', importance: 3, prominence: 0.6, kinds: ['corporate'], heightOffsetM: 25 };
  }
  return null;
}

function classifyWater(properties, meta) {
  const cls = properties.class;
  if (!properties.wikidata || meta.clipped || !WATER_CLASSES.has(cls)) return null;
  if (cls !== 'waterfall' && meta.areaM2 < 2e4) return null;
  return {
    prefix: 'water',
    importance: meta.areaM2 >= 1e7 ? 4 : 3,
    prominence: 0.65,
    kinds: ['water'],
    groundRelative: true,
    heightOffsetM: 15,
  };
}

/** Extract airports, towers, bridges, peaks, parks, campuses, and water landmarks from `base.pmtiles`. */
export function extractBaseLandmarks(data, tile, zoom) {
  const layers = new VectorTile(new PbfReader(data)).layers;
  const records = [];
  const runners = [
    [layers.infrastructure, (f, p, n, m) => classifyInfrastructure(f, p, n, m)],
    [layers.land, (f, p, _n, m) => classifyLand(f, p, m)],
    [layers.land_use, (_f, p, n, m) => classifyLandUse(p, n, m, zoom)],
    [layers.water, (_f, p, _n, m) => classifyWater(p, m)],
  ];
  for (const [layer, classify] of runners) {
    for (let i = 0; i < (layer?.length ?? 0); i++) {
      const feature = layer.feature(i);
      const properties = feature.properties;
      const names = parseOvertureNames(properties);
      if (!names) continue;
      const meta = featureGeometryMeta(feature, tile, zoom);
      if (!meta) continue;
      const spec = classify(feature, properties, names, meta);
      if (!spec) continue;
      records.push(makeLandmark(properties, names, meta, spec));
    }
  }
  return records;
}

/** Extract tall or iconic non-residential buildings from an Overture `buildings` tile. */
export function extractBuildingLandmarks(data, tile, zoom) {
  const layer = new VectorTile(new PbfReader(data)).layers.building;
  if (!layer?.length) return [];
  const records = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.properties.is_underground) continue;
    const properties = feature.properties;
    if (properties.subtype === 'residential' || RESIDENTIAL_BUILDING_CLASSES.has(properties.class)) continue;
    const names = parseOvertureNames(properties);
    if (!names || RESIDENTIAL_NAME_RE.test(names.ko) || RESIDENTIAL_NAME_RE.test(names.en)) continue;
    const rawHeight = Number(properties.height);
    const floors = Number(properties.num_floors);
    const height = (Number.isFinite(rawHeight) && rawHeight > 0) ? rawHeight
      : (Number.isFinite(floors) && floors > 0 ? floors * 3.5 : 0);
    const iconic = ICONIC_BUILDING_CLASSES.has(properties.class);
    if (height < 120 && !iconic) continue;
    const meta = featureGeometryMeta(feature, tile, zoom);
    if (!meta) continue;
    const importance = height >= 240 ? 5 : height >= 170 ? 4 : 3;
    const prominence = Math.min(1, 0.45 + height / 600);
    const kinds = (height >= 160 || properties.class === 'tower') ? ['tower', 'corporate']
      : (properties.class === 'terminal' ? ['airport'] : ['corporate']);
    records.push(makeLandmark(properties, names, meta, {
      prefix: 'bldg',
      importance,
      prominence,
      kinds,
      groundRelative: true,
      heightOffsetM: Math.max(height, 25),
    }));
  }
  return records;
}

function normalizeNameKey(value) {
  if (typeof value !== 'string') return '';
  let text = value.trim().toLowerCase();
  if (!text) return '';
  text = text
    .replace(/국제공항/g, '공항')
    .replace(/\b(?:international|int'l)\s+airport\b/g, 'airport')
    .replace(/^(.+?)(?:특별시|광역시|특별자치시|특별자치도|시)$/, '$1');
  return text.replace(/[\s·.,\-_'’"()/]+/g, '');
}

function horizontalDistanceSq(a, b) {
  if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) return Infinity;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function preferenceRank(a, b) {
  return Number(Boolean(a.streamed)) - Number(Boolean(b.streamed))
    || (b.importance ?? 5) - (a.importance ?? 5)
    || (b.prominence ?? 0.5) - (a.prominence ?? 0.5)
    || Number(Boolean(a.clipped)) - Number(Boolean(b.clipped))
    || Number(Number.isFinite(b.elevationM ?? b.height)) - Number(Number.isFinite(a.elevationM ?? a.height));
}

/** Merge curated and streamed records, dropping duplicates by Wikidata, ID, or proximity. */
export function dedupeLandmarks(records) {
  const ordered = [...records].filter(Boolean).sort(preferenceRank);
  const kept = [];
  for (const record of ordered) {
    const koKey = normalizeNameKey(record.names?.ko ?? record.ko);
    const enKey = normalizeNameKey(record.names?.en ?? record.en);
    const isAirport = record.kinds?.includes('airport');
    const duplicate = kept.some(other => {
      if (record.wikidata && other.wikidata === record.wikidata) return true;
      if (record.id != null && other.id === record.id) return true;
      const distSq = horizontalDistanceSq(record, other);
      if (distSq <= 5000 ** 2) {
        const otherKo = normalizeNameKey(other.names?.ko ?? other.ko);
        const otherEn = normalizeNameKey(other.names?.en ?? other.en);
        if ((koKey && otherKo && koKey === otherKo) || (enKey && otherEn && enKey === otherEn)) return true;
      }
      if (isAirport && other.kinds?.includes('airport') && distSq <= 2500 ** 2) return true;
      return false;
    });
    if (!duplicate) kept.push(record);
  }
  return kept;
}
