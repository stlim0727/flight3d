// Geometry and type are laid out in CSS pixels, independently of canvas DPR.
const FAMILY = 'Georgia, Batang, serif';
const FONT = {
  region: `bold 16px ${FAMILY}`,
  city: `12px ${FAMILY}`,
};

function box(x, y, halfWidth, halfHeight) {
  return { x, y, halfWidth, halfHeight };
}

export function overlaps(a, b) {
  return Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth &&
    Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight;
}

export function projectAtlas(features, screenPoint) {
  const borders = new Path2D();
  const regions = new Map();
  const cities = [];
  for (const { kind, id, en, ko, rank, lines } of features) {
    if (kind === 'cities') {
      const [x, y] = screenPoint(lines[0][0]);
      cities.push({ en, ko, rank, x, y });
      continue;
    }
    let path = borders;
    if (kind === 'regions') {
      if (!regions.has(id)) regions.set(id, { en, ko, path: new Path2D() });
      path = regions.get(id).path;
    }
    for (const line of lines) {
      path.moveTo(...screenPoint(line[0]));
      for (let i = 1; i < line.length; i++) path.lineTo(...screenPoint(line[i]));
      if (kind === 'regions') path.closePath();
    }
  }
  cities.sort((a, b) => a.rank - b.rank);
  return { borders, regions, cities };
}

/** Airport text is printed first. Give the new lettering only unoccupied paper. */
export function layoutAtlasNames(atlas, { ctx, width, height, language, reserved, aircraft }) {
  const placed = [...reserved, aircraft];
  const names = [];
  const localName = (item, kind) => {
    if (language !== 'ko' || !item.ko) return item.en;
    return kind === 'city' ? item.ko.replace(/(광역시|특별시)$/, '') : item.ko;
  };
  function place(item, kind, candidates) {
    const text = localName(item, kind);
    ctx.font = FONT[kind];
    const halfWidth = ctx.measureText(text).width / 2 + 4;
    const halfHeight = kind === 'region' ? 12 : 9;
    for (const [x, y] of candidates) {
      const bounds = box(x, y, halfWidth, halfHeight);
      if (x - halfWidth < 3 || x + halfWidth > width - 3 ||
          y - halfHeight < 3 || y + halfHeight > height - 30 || placed.some(p => overlaps(p, bounds))) continue;
      placed.push(bounds);
      names.push({ ...bounds, kind, text, font: FONT[kind] });
      return true;
    }
    return false;
  }

  // Land within the visible sheet supplies the anchor even if the province's
  // capital or cartographic centroid lies far outside the view.
  const anchors = [];
  for (let row = 1; row < 10; row++) {
    for (let col = 1; col < 12; col++) anchors.push([width * col / 12, height * row / 10]);
  }
  anchors.sort((a, b) => Math.hypot(a[0] - width / 2, a[1] - height * .32) -
    Math.hypot(b[0] - width / 2, b[1] - height * .32));
  const regions = [...atlas.regions.values()].map(region => {
    ctx.font = FONT.region;
    const half = ctx.measureText(localName(region, 'region')).width / 2;
    const interior = [], edge = [];
    for (const point of anchors) {
      const [x, y] = point;
      if (!ctx.isPointInPath(region.path, x, y, 'evenodd')) continue;
      const fits = ctx.isPointInPath(region.path, x - half, y, 'evenodd') &&
        ctx.isPointInPath(region.path, x + half, y, 'evenodd');
      (fits ? interior : edge).push(point);
    }
    return { region, anchors: interior.concat(edge) };
  }).sort((a, b) => b.anchors.length - a.anchors.length);
  const cap = Math.max(3, Math.min(12, Math.floor(width * height / 17000)));
  const regionCap = Math.max(2, Math.floor(cap / 2));
  // A city has one geographic point. Give it first choice near that point;
  // a province name can move to another clear part of the same polygon.
  const cityCap = cap - Math.min(regionCap, regions.filter(entry => entry.anchors.length).length);
  for (const city of atlas.cities) {
    if (names.length >= cityCap) break;
    const { x, y } = city;
    if (x < 0 || x > width || y < 0 || y > height) continue;
    ctx.font = FONT.city;
    const dx = ctx.measureText(localName(city, 'city')).width / 2 + 8;
    const candidates = [[x, y - 12], [x, y + 13], [x + dx, y], [x - dx, y],
      [x + dx, y + 13], [x - dx, y + 13], [x + dx, y - 12], [x - dx, y - 12],
      [x, y - 25], [x, y + 25], [x - dx, y + 24], [x + dx, y + 24], [x - dx, y - 24], [x + dx, y - 24]];
    if (place(city, 'city', candidates)) names.at(-1).dot = [x, y];
  }
  let regionCount = 0;
  for (const entry of regions) {
    if (regionCount >= regionCap) break;
    if (place(entry.region, 'region', entry.anchors)) regionCount++;
  }
  return names;
}

export function chartRunwayBoxes(runways, screenPoint, metersPerPixel) {
  // Short intervals keep the free corners around a diagonal runway available.
  return runways.flatMap(runway => {
    const [x, y] = screenPoint(runway.from);
    const [endX, endY] = screenPoint(runway.to);
    const dx = endX - x, dy = endY - y;
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 16));
    const pad = Math.max(3, runway.widthM / metersPerPixel / 2 + 2);
    return Array.from({ length: count }, (_, i) => box(x + dx * (i + .5) / count, y + dy * (i + .5) / count,
      Math.abs(dx) / count / 2 + pad, Math.abs(dy) / count / 2 + pad));
  });
}
