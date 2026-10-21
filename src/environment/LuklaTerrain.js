import * as THREE from 'three';
import grid from '../config/luklaTerrainGrid.json' with { type: 'json' };

/**
 * Real-World Himalayan Terrain for Nepal Tenzing-Hillary Airport (Lukla, VNLK)
 * Copernicus GLO-30 DSM and imagery reprojected to a common local-meter grid.
 * Only the airport footprint is graded; surrounding terrain retains DEM heights.
 * See docs/development/lukla-terrain.md for provenance and accuracy limits.
 */
export class LuklaTerrain {
  constructor(size = grid.worldSize, segments = 255, customElevations = null) {
    this.size = size;
    this.segments = segments;
    this.gridSize = grid.gridSize;

    // Both assets are centered on the runway midpoint: +X east, +Z south.
    this.shiftX = 0;
    this.shiftZ = 0;

    // Existing simulator airport model; not surveyed threshold elevations.
    this.runwayHeadingDeg = 58.0;
    this.runwayHeadingRad = THREE.MathUtils.degToRad(58.0);
    this.runwayLength = 527.0; // meters
    this.runwayWidth = 30.0;   // meters
    this.runwayGradient = 0.1176; // 11.76% (approx 6.7° slope)
    this.threshold06Elevation = 2805.0; // SW end
    this.threshold24Elevation = 2867.0; // NE end
    this.midElevation = 2836.0;

    // North-to-south rows of west-to-east indexed Float32 samples.
    if (customElevations && customElevations.length === this.gridSize * this.gridSize && customElevations.every(Number.isFinite)) {
      this.elevations = customElevations;
      this.isLoaded = true;
    } else {
      this.elevations = new Float32Array(this.gridSize * this.gridSize);
      this.isLoaded = false;
      this.initProceduralFallback();
    }
    this.onLoaded = null;
    this.loadError = null;

    // Three.js 3D Mesh
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI * 0.5);

    // High-resolution local terrace mesh for the carved runway and airport grounds
    // Tessellates the 800m x 300m airport envelope at 10m spacing (80 x 30 segments)
    // to preserve exact carved runway and terrace geometry without coarse DEM interpolation bulge
    const sLength = 800; // -400m to +400m along runway heading 058°
    const wWidth = 300;  // -150m to +150m across runway
    const sSegs = 80;
    const wSegs = 30;
    const sin58 = 0.848048;
    const cos58 = 0.529919;

    this.localTerraceGeometry = new THREE.PlaneGeometry(sLength, wWidth, sSegs, wSegs);
    this.localTerraceGeometry.rotateX(-Math.PI * 0.5);

    const localPos = this.localTerraceGeometry.attributes.position;
    for (let i = 0; i < localPos.count; i++) {
      const s = localPos.getX(i);
      const w = localPos.getZ(i);
      const x = s * sin58 + w * cos58;
      const z = -s * cos58 + w * sin58;
      localPos.setXYZ(i, x, 0, z);
    }

    // Initial elevation setup (both coarse mesh and local terrace mesh)
    this.updateGeometryElevations();

    // Material with high-resolution satellite texture
    this.textureLoader = new THREE.TextureLoader();
    this.satelliteTexture = null;

    const defaultColorMat = new THREE.MeshStandardMaterial({
      color: 0x5a6358,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(this.geometry, defaultColorMat);
    this.mesh.receiveShadow = true;

    this.localTerraceMesh = new THREE.Mesh(this.localTerraceGeometry, defaultColorMat);
    this.localTerraceMesh.receiveShadow = true;
    this.mesh.add(this.localTerraceMesh);

    // Load real DEM and satellite imagery if in browser environment
    if (!this.isLoaded) {
      this.loadRealWorldAssets();
    }
  }

  /**
   * Neutral placeholder while the bundled DEM loads, also usable in Node tests.
   */
  initProceduralFallback() {
    // Temporary loading surface only; do not invent Himalayan ridges or canyons.
    this.elevations.fill(this.midElevation);
  }

  /**
   * Load real DEM binary file (lukla_dem.bin) and satellite texture (lukla_satellite.jpg)
   */
  async loadRealWorldAssets() {
    this.loadError = null;
    try {
      if (typeof window !== 'undefined' && window.fetch) {
        // Browser environment: fetch binary DEM
        const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}terrain/lukla_dem.bin`);
        if (!res.ok) throw new Error(`Lukla DEM request failed (HTTP ${res.status})`);
        const buf = await res.arrayBuffer();
        const data = new Float32Array(buf);
        if (data.length !== this.gridSize * this.gridSize || !data.every(Number.isFinite)) {
          throw new Error('Invalid Lukla DEM grid');
        }
        this.elevations = data;
        this.isLoaded = true;
        this.updateGeometryElevations();
        if (this.onLoaded) this.onLoaded();

        // Load satellite texture
        this.textureLoader.load(`${import.meta.env?.BASE_URL ?? '/'}terrain/lukla_satellite.jpg`, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = 8;
          this.satelliteTexture = tex;

          this.mesh.material = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.88,
            metalness: 0.05,
            flatShading: false,
            side: THREE.DoubleSide
          });
          this.mesh.material.needsUpdate = true;
          if (this.localTerraceMesh) {
            this.localTerraceMesh.material = this.mesh.material;
          }
        });
      }
    } catch (e) {
      if (!this.isLoaded) this.loadError = e.message || String(e);
      console.warn('Could not load real-world Lukla DEM, using procedural fallback:', e);
    }
  }

  /**
   * Updates PlaneGeometry vertex heights using the DEM data and runway blend
   */
  updateGeometryElevations() {
    const sin58 = 0.848048;
    const cos58 = 0.529919;
    const pos = this.geometry.attributes.position;
    const uvs = this.geometry.attributes.uv;
    const count = pos.count;
    // A rotated coarse cell can extend this far along either runway axis.
    const coarseMargin = (this.size / this.segments) * (sin58 + cos58);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      let h = this.getHeight(x, z);

      // Depress coarse mesh vertices within the local high-res terrace envelope
      // so coarse 86m triangles never bulge above the carved terrace or runway surface
      const s = x * sin58 - z * cos58;
      const w = x * cos58 + z * sin58;
      if (Math.abs(s) <= 360.0 && Math.abs(w) <= 130.0) {
        h -= 10.0;
      }
      if (Math.abs(s) <= this.runwayLength * 0.5 + coarseMargin &&
          Math.abs(w) <= this.runwayWidth * 0.5 + coarseMargin) {
        h = Math.min(h, this.midElevation + s * this.runwayGradient - 10.0);
      }

      pos.setY(i, h);

      // Adjust UV mapping so satellite image perfectly aligns with world coordinates
      if (uvs) {
        const u = (x / this.size) + 0.5;
        const v = 0.5 - (z / this.size);
        uvs.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
      }
    }

    pos.needsUpdate = true;
    if (uvs) uvs.needsUpdate = true;
    this.geometry.computeVertexNormals();

    // Update local high-resolution terrace mesh (10m spacing)
    if (this.localTerraceGeometry) {
      const lPos = this.localTerraceGeometry.attributes.position;
      const lUvs = this.localTerraceGeometry.attributes.uv;
      const lCount = lPos.count;

      for (let i = 0; i < lCount; i++) {
        const x = lPos.getX(i);
        const z = lPos.getZ(i);
        let h = this.getHeight(x, z);
        const s = x * sin58 - z * cos58;
        const w = x * cos58 + z * sin58;
        // Recess only the rendered terrain beneath the asphalt. Include one
        // terrace cell beyond each edge so interpolated boundary triangles
        // cannot cross the runway plane, especially at the uphill threshold.
        // Keep getHeight() unchanged for landing gear and collision queries.
        if (Math.abs(s) <= this.runwayLength * 0.5 + 10.0 &&
            Math.abs(w) <= this.runwayWidth * 0.5 + 10.0) {
          h = Math.min(h, this.midElevation + s * this.runwayGradient - 0.5);
        }
        lPos.setY(i, h);

        if (lUvs) {
          const u = (x / this.size) + 0.5;
          const v = 0.5 - (z / this.size);
          lUvs.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
        }
      }

      lPos.needsUpdate = true;
      if (lUvs) lUvs.needsUpdate = true;
      this.localTerraceGeometry.computeVertexNormals();
    }
  }

  /**
   * Bilinear source DSM elevation at world (x, z), without airport grading.
   */
  getNaturalHeight(x, z) {
    // 1. Bilinear DEM interpolation
    const demX = x + this.shiftX;
    const demZ = z + this.shiftZ;

    const gx = ((demX / this.size) + 0.5) * (this.gridSize - 1);
    const gy = ((demZ / this.size) + 0.5) * (this.gridSize - 1);

    const cx = Math.max(0, Math.min(this.gridSize - 1, gx));
    const cy = Math.max(0, Math.min(this.gridSize - 1, gy));

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

  getHeight(x, z) {
    const naturalH = this.getNaturalHeight(x, z);

    // 2. Runway 06/24 Carving & 11.7% Grade Blending
    // Heading 058°: Longitudinal axis (s) along runway, Lateral axis (w) across runway
    // Vector along runway: sin(58°), -cos(58°)
    const sin58 = 0.848048;
    const cos58 = 0.529919;

    const s = x * sin58 - z * cos58; // Distance along runway from midpoint (-263.5m to +263.5m)
    const w = x * cos58 + z * sin58; // Distance perpendicular to runway

    const halfLength = this.runwayLength * 0.5; // 263.5m
    const halfWidth = this.runwayWidth * 0.5;   // 15.0m
    const absW = Math.abs(w);

    // Local grading only. Blend to the DEM on all four sides, without an
    // artificial mountain wall or a carved departure canyon beyond the runway.
    const fade = (distance, width) => {
      const t = THREE.MathUtils.clamp(distance / width, 0, 1);
      return 1 - t * t * (3 - 2 * t);
    };
    const rwyH = this.midElevation + s * this.runwayGradient;
    const runwayWeight = fade(Math.max(0, Math.abs(s) - halfLength), 50) *
      fade(Math.max(0, absW - halfWidth), 30);
    const apronDistanceS = Math.max(-15 - s, 0, s - 135);
    const apronDistanceW = Math.max(15 - w, 0, w - 85);
    const apronWeight = fade(apronDistanceS, 20) * fade(apronDistanceW, 20);
    const apronH = Math.max(rwyH, 2844);
    const graded = THREE.MathUtils.lerp(naturalH, apronH, apronWeight);
    return THREE.MathUtils.lerp(graded, rwyH, runwayWeight);
  }

  /**
   * Surface normal at world (x, z) for physics calculation
   */
  getNormal(x, z) {
    const eps = 2.0;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    const normal = new THREE.Vector3(hL - hR, 2.0 * eps, hD - hU);
    normal.normalize();
    return normal;
  }
}
