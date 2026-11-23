import * as THREE from 'three';

const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
const smoothFade = (distance, width) => {
  const t = clamp(distance / width, 0, 1);
  return 1 - t * t * (3 - 2 * t);
};

/**
 * DEM-backed anchor surface driven entirely by declarative region data.
 * Heights, grading, mesh carving and asset URLs come from the config object;
 * the same class can back any local raster region without a dedicated terrain
 * implementation.
 */
export class RasterRegionSurface {
  constructor(config = {}, options = {}) {
    const {
      size = 44000,
      gridSize = 1025,
      segments = 255,
      demUrl = '',
      imageryUrl = '',
      runway = {},
      grading = {},
      terrace = {},
    } = config;
    this.config = config;
    this.size = size;
    this.gridSize = gridSize;
    this.segments = segments;
    this.demUrl = demUrl;
    this.imageryUrl = imageryUrl;
    this.runway = {
      headingDeg: runway.headingDeg ?? 58,
      lengthM: runway.lengthM ?? 527,
      widthM: runway.widthM ?? 30,
      gradient: runway.gradient ?? 0.1176,
      threshold06ElevationM: runway.threshold06ElevationM ?? 2805,
      threshold24ElevationM: runway.threshold24ElevationM ?? 2867,
      midElevationM: runway.midElevationM ?? 2836,
    };
    this.grading = {
      runwayFadeM: grading.runwayFadeM ?? 50,
      widthFadeM: grading.widthFadeM ?? 30,
      apronS: grading.apronS ?? [-15, 135],
      apronW: grading.apronW ?? [15, 85],
      apronFadeM: grading.apronFadeM ?? 20,
      apronMinElevationM: grading.apronMinElevationM ?? 2844,
    };
    this.terrace = {
      lengthM: terrace.lengthM ?? 800,
      widthM: terrace.widthM ?? 300,
      segmentsX: terrace.segmentsX ?? 80,
      segmentsZ: terrace.segmentsZ ?? 30,
      depressionM: terrace.depressionM ?? 0.5,
      coarseDepressionM: terrace.coarseDepressionM ?? 10,
    };
    const angle = this.runway.headingDeg * DEG;
    this.sin = Math.sin(angle);
    this.cos = Math.cos(angle);

    const samples = options.elevations;
    if (samples?.length === gridSize * gridSize && samples.every(Number.isFinite)) {
      this.elevations = samples;
      this.isLoaded = true;
    } else {
      this.elevations = new Float32Array(gridSize * gridSize).fill(this.runway.midElevationM);
      this.isLoaded = false;
    }
    this.onLoaded = null;
    this.loadError = null;
    this.openWorld = null;

    this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);
    this.localTerraceGeometry = new THREE.PlaneGeometry(
      this.terrace.lengthM, this.terrace.widthM, this.terrace.segmentsX, this.terrace.segmentsZ,
    );
    this.localTerraceGeometry.rotateX(-Math.PI / 2);
    const localPos = this.localTerraceGeometry.attributes.position;
    for (let i = 0; i < localPos.count; i++) {
      const s = localPos.getX(i);
      const w = localPos.getZ(i);
      localPos.setXYZ(i, s * this.sin + w * this.cos, 0, -s * this.cos + w * this.sin);
    }
    this.updateGeometryElevations();

    const createMaterial = options.createMaterial ?? (() => new THREE.MeshStandardMaterial({ color: 0xb8c3a5 }));
    this.material = createMaterial(options.imagery ?? null);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.localTerraceMesh = new THREE.Mesh(this.localTerraceGeometry, this.material);
    this.localTerraceMesh.receiveShadow = true;
    this.mesh.add(this.localTerraceMesh);
    options.castShadow?.(this.mesh);

    if (!this.isLoaded && options.load !== false) this.loadAssets(options.fetchImpl ?? globalThis.fetch);
  }

  async loadAssets(fetchImpl = globalThis.fetch) {
    this.loadError = null;
    try {
      if (typeof window === 'undefined' || !fetchImpl || !this.demUrl) return;
      const baseUrl = globalThis.importMetaEnv?.BASE_URL ?? '/';
      const response = await fetchImpl(`${baseUrl}${this.demUrl}`);
      if (!response.ok) throw new Error(`DEM request failed (HTTP ${response.status})`);
      const data = new Float32Array(await response.arrayBuffer());
      if (data.length !== this.gridSize * this.gridSize || !data.every(Number.isFinite)) {
        throw new Error(`Invalid DEM grid: ${this.demUrl}`);
      }
      this.elevations = data;
      this.isLoaded = true;
      this.updateGeometryElevations();
      this.onLoaded?.();
    } catch (error) {
      if (!this.isLoaded) this.loadError = error.message ?? String(error);
      console.warn(`Could not load ${this.demUrl}, using fallback:`, error);
    }
  }

  getNaturalHeight(x, z) {
    const gx = ((x / this.size) + 0.5) * (this.gridSize - 1);
    const gy = ((z / this.size) + 0.5) * (this.gridSize - 1);
    const cx = clamp(gx, 0, this.gridSize - 1);
    const cy = clamp(gy, 0, this.gridSize - 1);
    const ix = Math.min(this.gridSize - 2, Math.floor(cx));
    const iy = Math.min(this.gridSize - 2, Math.floor(cy));
    const fx = cx - ix;
    const fy = cy - iy;
    const h00 = this.elevations[iy * this.gridSize + ix];
    const h10 = this.elevations[iy * this.gridSize + ix + 1];
    const h01 = this.elevations[(iy + 1) * this.gridSize + ix];
    const h11 = this.elevations[(iy + 1) * this.gridSize + ix + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  getBoundaryBlendedHeight(x, z) {
    const natural = this.getNaturalHeight(x, z);
    const half = this.size / 2;
    const step = this.size / this.segments;
    const distance = half - Math.max(Math.abs(x), Math.abs(z));
    if (distance >= step) return natural;
    const gx = clamp((x + half) / step, 0, this.segments);
    const gz = clamp((z + half) / step, 0, this.segments);
    const col = Math.min(Math.floor(gx), this.segments - 1);
    const row = Math.min(Math.floor(gz), this.segments - 1);
    const u = gx - col;
    const v = gz - row;
    const width = this.segments + 1;
    const nw = row * width + col;
    const positions = this.geometry.attributes.position;
    const ne = positions.getY(nw + 1);
    const sw = positions.getY(nw + width);
    const rendered = u + v <= 1
      ? positions.getY(nw) * (1 - u - v) + ne * u + sw * v
      : positions.getY(nw + width + 1) * (u + v - 1) + ne * (1 - v) + sw * (1 - u);
    return THREE.MathUtils.lerp(rendered, natural, THREE.MathUtils.smoothstep(distance, 0, step));
  }

  getHeight(x, z) {
    const streamed = this.openWorld?.sample?.(x, z);
    if (streamed) return streamed.height;
    const natural = this.openWorld
      ? this.getBoundaryBlendedHeight(x, z)
      : this.getNaturalHeight(x, z);
    const s = x * this.sin - z * this.cos;
    const w = x * this.cos + z * this.sin;
    const halfLength = this.runway.lengthM / 2;
    const halfWidth = this.runway.widthM / 2;
    const g = this.grading;
    const rwyH = this.runway.midElevationM + s * this.runway.gradient;
    const runwayWeight = smoothFade(Math.max(0, Math.abs(s) - halfLength), g.runwayFadeM)
      * smoothFade(Math.max(0, Math.abs(w) - halfWidth), g.widthFadeM);
    const apronDistanceS = Math.max(g.apronS[0] - s, 0, s - g.apronS[1]);
    const apronDistanceW = Math.max(g.apronW[0] - w, 0, w - g.apronW[1]);
    const apronWeight = smoothFade(apronDistanceS, g.apronFadeM)
      * smoothFade(apronDistanceW, g.apronFadeM);
    const apronH = Math.max(rwyH, g.apronMinElevationM);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(natural, apronH, apronWeight),
      rwyH,
      runwayWeight,
    );
  }

  getNormal(x, z) {
    const d = 2;
    return new THREE.Vector3(
      this.getHeight(x - d, z) - this.getHeight(x + d, z),
      2 * d,
      this.getHeight(x, z - d) - this.getHeight(x, z + d),
    ).normalize();
  }

  isOnRunway(x, z) {
    const s = x * this.sin - z * this.cos;
    const w = x * this.cos + z * this.sin;
    return Math.abs(s) <= this.runway.lengthM / 2 && Math.abs(w) <= this.runway.widthM / 2;
  }

  isRunwaySafetyArea(x, z) {
    const s = x * this.sin - z * this.cos;
    const w = x * this.cos + z * this.sin;
    return Math.abs(s) <= this.runway.lengthM / 2 + this.grading.runwayFadeM
      && Math.abs(w) <= this.runway.widthM / 2 + this.grading.widthFadeM;
  }

  getWaterLevel() { return 0; }

  updateGeometryElevations() {
    const t = this.terrace;
    const pos = this.geometry.attributes.position;
    const uvs = this.geometry.attributes.uv;
    const coarseMargin = (this.size / this.segments) * (this.sin + this.cos);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let h = this.getHeight(x, z);
      const s = x * this.sin - z * this.cos;
      const w = x * this.cos + z * this.sin;
      if (Math.abs(s) <= t.lengthM / 2 && Math.abs(w) <= t.widthM / 2) h -= t.coarseDepressionM;
      if (Math.abs(s) <= this.runway.lengthM / 2 + coarseMargin
        && Math.abs(w) <= this.runway.widthM / 2 + coarseMargin) {
        h = Math.min(h, this.runway.midElevationM + s * this.runway.gradient - t.coarseDepressionM);
      }
      pos.setY(i, h);
      if (uvs) uvs.setXY(i, clamp(x / this.size + 0.5, 0, 1), clamp(0.5 - z / this.size, 0, 1));
    }
    pos.needsUpdate = true;
    if (uvs) uvs.needsUpdate = true;
    this.geometry.computeVertexNormals();

    const localPos = this.localTerraceGeometry.attributes.position;
    const localUvs = this.localTerraceGeometry.attributes.uv;
    for (let i = 0; i < localPos.count; i++) {
      const x = localPos.getX(i);
      const z = localPos.getZ(i);
      let h = this.getHeight(x, z);
      const s = x * this.sin - z * this.cos;
      const w = x * this.cos + z * this.sin;
      if (Math.abs(s) <= this.runway.lengthM / 2 + 10
        && Math.abs(w) <= this.runway.widthM / 2 + 10) {
        h = Math.min(h, this.runway.midElevationM + s * this.runway.gradient - t.depressionM);
      }
      localPos.setY(i, h);
      if (localUvs) localUvs.setXY(i, clamp(x / this.size + 0.5, 0, 1), clamp(0.5 - z / this.size, 0, 1));
    }
    localPos.needsUpdate = true;
    if (localUvs) localUvs.needsUpdate = true;
    this.localTerraceGeometry.computeVertexNormals();
  }

  dispose() {
    this.geometry.dispose();
    this.localTerraceGeometry.dispose();
    this.material?.dispose();
    this.mesh?.removeFromParent();
  }
}
