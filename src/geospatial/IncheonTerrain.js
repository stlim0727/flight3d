/** Build a Z-slab spatial index over ring edges for O(k) exact point-in-ring queries. */
function indexRing(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const spanZ = maxZ - minZ;
  const numSlabs = spanZ > 0 ? Math.max(1, Math.min(256, Math.ceil(spanZ / 50))) : 1;
  const invSlab = spanZ > 0 ? numSlabs / spanZ : 0;
  const slabs = Array.from({ length: numSlabs }, () => []);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] === b[1]) continue;
    const zLo = Math.min(a[1], b[1]);
    const zHi = Math.max(a[1], b[1]);
    const s0 = Math.max(0, Math.min(numSlabs - 1, Math.floor((zLo - minZ) * invSlab)));
    const s1 = Math.max(0, Math.min(numSlabs - 1, Math.floor((zHi - minZ) * invSlab)));
    const edge = [a[0], a[1], b[0], b[1]];
    for (let s = s0; s <= s1; s++) slabs[s].push(edge);
  }
  return { minX, maxX, minZ, maxZ, numSlabs, invSlab, slabs };
}

function insideIndexedRing(indexed, x, z) {
  if (x < indexed.minX || x >= indexed.maxX || z < indexed.minZ || z >= indexed.maxZ) return false;
  const slabIndex = Math.max(0, Math.min(indexed.numSlabs - 1, Math.floor((z - indexed.minZ) * indexed.invSlab)));
  const edges = indexed.slabs[slabIndex];
  let inside = false;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const ax = e[0], az = e[1], bx = e[2], bz = e[3];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Shared terrain sampling for preview meshes and feature placement; no DOM. */
export class IncheonTerrain {
  constructor(metadata, grids, coastline) {
    if (metadata.schemaVersion !== 1 || !metadata.grids || !coastline?.land) throw new Error('Invalid Incheon terrain metadata');
    this.metadata = metadata;
    this.grids = grids;
    this.coastline = coastline;
    for (const [name, descriptor] of Object.entries(metadata.grids)) {
      const values = grids[name];
      if (!Number.isInteger(descriptor.gridSize) || descriptor.gridSize < 2 || !(descriptor.worldSize > 0)
        || !values || values.length !== descriptor.gridSize ** 2 || !values.every(Number.isFinite)) {
        throw new Error(`Invalid terrain grid: ${name}`);
      }
    }
    const { type, coordinates } = coastline.land;
    if (!['Polygon', 'MultiPolygon'].includes(type)) throw new Error('Invalid land polygon type');
    const rawPolygons = type === 'Polygon' ? [coordinates] : coordinates;
    this._indexedPolygons = rawPolygons.map(rings => ({
      outer: indexRing(rings[0]),
      holes: rings.slice(1).map(indexRing),
    }));
  }

  sampleGrid(name, x, z) {
    const { gridSize, worldSize } = this.metadata.grids[name];
    const half = worldSize / 2;
    if (![x, z].every(Number.isFinite) || Math.abs(x) > half || Math.abs(z) > half) throw new RangeError('Outside Incheon terrain bounds');
    const col = (x + half) / worldSize * (gridSize - 1);
    const row = (z + half) / worldSize * (gridSize - 1);
    const ix = Math.min(Math.floor(col), gridSize - 2);
    const iz = Math.min(Math.floor(row), gridSize - 2);
    const fx = col - ix;
    const fz = row - iz;
    const data = this.grids[name];
    const i = iz * gridSize + ix;
    return data[i] * (1-fx) * (1-fz) + data[i+1] * fx * (1-fz)
      + data[i+gridSize] * (1-fx) * fz + data[i+gridSize+1] * fx * fz;
  }

  getNaturalHeight(x, z) {
    return this.sampleGrid(Math.max(Math.abs(x), Math.abs(z)) <= 1000 ? 'local-natural' : 'regional-natural', x, z);
  }

  getHeight(x, z) {
    return Math.max(Math.abs(x), Math.abs(z)) <= 1000
      ? this.sampleGrid('local-graded', x, z) : this.getNaturalHeight(x, z);
  }

  isLand(x, z) {
    for (let p = 0; p < this._indexedPolygons.length; p++) {
      const poly = this._indexedPolygons[p];
      if (!insideIndexedRing(poly.outer, x, z)) continue;
      let inHole = false;
      for (let h = 0; h < poly.holes.length; h++) {
        if (insideIndexedRing(poly.holes[h], x, z)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }
}

export async function loadIncheonTerrain(baseUrl) {
  const json = async file => {
    const response = await fetch(`${baseUrl}${file}`);
    if (!response.ok) throw new Error(`Terrain asset ${file}: HTTP ${response.status}`);
    return response.json();
  };
  const [metadata, coastline] = await Promise.all([json('terrain-metadata.json'), json('coastline.json')]);
  const entries = await Promise.all(Object.entries(metadata.grids).map(async ([name, descriptor]) => {
    const response = await fetch(`${baseUrl}${descriptor.file}`);
    if (!response.ok) throw new Error(`Terrain grid ${name}: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== descriptor.gridSize ** 2 * 4) throw new Error(`Terrain grid size mismatch: ${name}`);
    const view = new DataView(buffer);
    const values = new Float32Array(descriptor.gridSize ** 2);
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
    return [name, values];
  }));
  return new IncheonTerrain(metadata, Object.fromEntries(entries), coastline);
}
