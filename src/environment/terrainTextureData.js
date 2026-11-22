/**
 * Pure CPU procedural PBR texture buffer generators for Flight3D Terrain.
 * No Three.js or DOM dependencies so this module can run inside a Web Worker.
 */

function createPeriodicNoiseGrid(w, h, basePeriod = 16, octaves = 4, persistence = 0.5, seed = 42) {
  const lattice = (x, y, octave) => {
    let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed ^ Math.imul(octave, 1274126177);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  };

  const out = new Float32Array(w * h);
  let maxAmp = 0;
  let curAmp = 1.0;
  let curFreq = 1;

  for (let o = 0; o < octaves; o++) {
    const period = basePeriod * curFreq;

    for (let y = 0; y < h; y++) {
      const yCoord = (y / h) * period;
      const j0 = Math.floor(yCoord);
      const j1 = (j0 + 1) % period;
      const fy = yCoord - j0;
      const sy = fy * fy * (3.0 - 2.0 * fy);

      const yOffset = y * w;

      for (let x = 0; x < w; x++) {
        const xCoord = (x / w) * period;
        const i0 = Math.floor(xCoord);
        const i1 = (i0 + 1) % period;
        const fx = xCoord - i0;
        const sx = fx * fx * (3.0 - 2.0 * fx);

        const v00 = lattice(i0, j0, o);
        const v10 = lattice(i1, j0, o);
        const v01 = lattice(i0, j1, o);
        const v11 = lattice(i1, j1, o);

        const v0 = v00 * (1.0 - sx) + v10 * sx;
        const v1 = v01 * (1.0 - sx) + v11 * sx;
        const val = (v0 * (1.0 - sy) + v1 * sy) * curAmp;

        out[yOffset + x] += val;
      }
    }

    maxAmp += curAmp;
    curAmp *= persistence;
    curFreq *= 2;
  }

  const invMax = 1.0 / maxAmp;
  for (let i = 0; i < out.length; i++) {
    out[i] *= invMax;
  }

  return out;
}

function createNormalFromHeights(heights, w, h, strength = 1.5) {
  const normalData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const yU = ((y - 1 + h) % h) * w;
    const yD = ((y + 1) % h) * w;
    const yCur = y * w;

    for (let x = 0; x < w; x++) {
      const xL = (x - 1 + w) % w;
      const xR = (x + 1) % w;

      const dx = (heights[yCur + xR] - heights[yCur + xL]) * strength;
      const dy = (heights[yD + x] - heights[yU + x]) * strength;

      const invLen = 1.0 / Math.sqrt(dx * dx + dy * dy + 1.0);
      const nx = -dx * invLen;
      const ny = -dy * invLen;
      const nz = invLen;

      const idx = (yCur + x) * 4;
      normalData[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  return normalData;
}

function generateGrassBuffers(w = 512, h = 512) {
  const nMacro = createPeriodicNoiseGrid(w, h, 8, 4, 0.5, 101);
  const nMicro = createPeriodicNoiseGrid(w, h, 32, 3, 0.5, 202);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const macro = nMacro[i];
    const micro = nMicro[i];
    heights[i] = macro * 0.65 + micro * 0.35;

    const patch = macro * 0.8 + micro * 0.2;
    let r, g, b;
    if (patch < 0.45) {
      const t = patch / 0.45;
      r = 45 * (1 - t) + 40 * t;
      g = 52 * (1 - t) + 82 * t;
      b = 32 * (1 - t) + 38 * t;
    } else if (patch < 0.8) {
      const t = (patch - 0.45) / 0.35;
      r = 40 * (1 - t) + 68 * t;
      g = 82 * (1 - t) + 125 * t;
      b = 38 * (1 - t) + 48 * t;
    } else {
      const t = (patch - 0.8) / 0.2;
      r = 68 * (1 - t) + 95 * t;
      g = 125 * (1 - t) + 155 * t;
      b = 48 * (1 - t) + 62 * t;
    }

    const roughness = Math.round((0.87 + macro * 0.06) * 255);
    const idx = i * 4;
    albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
    albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
    albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
    albedoData[idx + 3] = roughness;
  }

  return {
    albedo: { data: albedoData, width: w, height: h },
    normal: { data: createNormalFromHeights(heights, w, h, 1.4), width: w, height: h },
  };
}

function generateSandBuffers(w = 256, h = 256) {
  const nMacro = createPeriodicNoiseGrid(w, h, 6, 3, 0.5, 303);
  const nMicro = createPeriodicNoiseGrid(w, h, 24, 3, 0.5, 404);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;
      const macro = nMacro[i];
      const micro = nMicro[i];

      const ripple = Math.sin(u * 20.0 * Math.PI + macro * 4.0) * 0.12;
      const hVal = macro * 0.5 + ripple + micro * 0.38;
      heights[i] = hVal;

      const tone = Math.min(1.0, Math.max(0.0, macro * 0.6 + ripple * 0.5 + micro * 0.4));
      const r = 188 + tone * 36;
      const g = 160 + tone * 32;
      const b = 118 + tone * 24;

      const roughness = Math.round((0.82 + micro * 0.06) * 255);
      const idx = i * 4;
      albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData[idx + 3] = roughness;
    }
  }

  return {
    albedo: { data: albedoData, width: w, height: h },
    normal: { data: createNormalFromHeights(heights, w, h, 1.1), width: w, height: h },
  };
}

function generateRockBuffers(w = 512, h = 512) {
  const nMacro = createPeriodicNoiseGrid(w, h, 8, 4, 0.55, 505);
  const nRidge = createPeriodicNoiseGrid(w, h, 16, 4, 0.5, 606);
  const nMicro = createPeriodicNoiseGrid(w, h, 32, 3, 0.45, 707);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const macro = nMacro[i];
      let ridge = 1.0 - Math.abs(nRidge[i] * 2.0 - 1.0);
      ridge = ridge * ridge;

      const strata = Math.sin(v * 24.0 * Math.PI + macro * 5.0) * 0.15;
      const hVal = macro * 0.35 + ridge * 0.45 + strata + nMicro[i] * 0.2;
      heights[i] = hVal;

      let r, g, b;
      if (hVal < 0.35) {
        const t = hVal / 0.35;
        r = 50 * (1 - t) + 72 * t;
        g = 46 * (1 - t) + 68 * t;
        b = 42 * (1 - t) + 64 * t;
      } else if (hVal < 0.7) {
        const t = (hVal - 0.35) / 0.35;
        r = 72 * (1 - t) + 112 * t;
        g = 68 * (1 - t) + 98 * t;
        b = 64 * (1 - t) + 82 * t;
      } else {
        const t = (hVal - 0.7) / 0.3;
        r = 112 * (1 - t) + 145 * t;
        g = 98 * (1 - t) + 140 * t;
        b = 82 * (1 - t) + 132 * t;
      }

      const roughness = Math.round((0.72 + (1.0 - ridge) * 0.12) * 255);
      const idx = i * 4;
      albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData[idx + 3] = roughness;
    }
  }

  return {
    albedo: { data: albedoData, width: w, height: h },
    normal: { data: createNormalFromHeights(heights, w, h, 2.4), width: w, height: h },
  };
}

function generateSnowBuffers(w = 256, h = 256) {
  const nMacro = createPeriodicNoiseGrid(w, h, 6, 3, 0.5, 808);
  const nMicro = createPeriodicNoiseGrid(w, h, 24, 3, 0.4, 909);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;
      const macro = nMacro[i];
      const micro = nMicro[i];

      const drift = Math.sin((u + v * 0.5) * 12.0 * Math.PI + macro * 3.0) * 0.1;
      const hVal = macro * 0.6 + drift + micro * 0.3;
      heights[i] = hVal;

      const t = Math.min(1.0, Math.max(0.0, hVal));
      const r = 215 * (1 - t) + 248 * t;
      const g = 226 * (1 - t) + 250 * t;
      const b = 240 * (1 - t) + 254 * t;

      const roughness = Math.round((0.50 + micro * 0.12) * 255);
      const idx = i * 4;
      albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData[idx + 3] = roughness;
    }
  }

  return {
    albedo: { data: albedoData, width: w, height: h },
    normal: { data: createNormalFromHeights(heights, w, h, 0.8), width: w, height: h },
  };
}

function generateRunwayBuffers(w = 256, h = 256) {
  const nMacro = createPeriodicNoiseGrid(w, h, 8, 3, 0.5, 1111);
  const nMicro = createPeriodicNoiseGrid(w, h, 32, 3, 0.5, 1212);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const macro = nMacro[i];
    const micro = nMicro[i];
    heights[i] = macro * 0.4 + micro * 0.6;

    const aggregate = micro;
    const r = 40 + aggregate * 25;
    const g = 50 + aggregate * 26;
    const b = 44 + aggregate * 22;

    const roughness = Math.round((0.80 + micro * 0.05) * 255);
    const idx = i * 4;
    albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
    albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
    albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
    albedoData[idx + 3] = roughness;
  }

  return {
    albedo: { data: albedoData, width: w, height: h },
    normal: { data: createNormalFromHeights(heights, w, h, 1.2), width: w, height: h },
  };
}

function generateMicroNormalBuffer(w = 256, h = 256) {
  const n1 = createPeriodicNoiseGrid(w, h, 32, 2, 0.5, 1313);
  const n2 = createPeriodicNoiseGrid(w, h, 64, 2, 0.5, 1414);

  const heights = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    heights[i] = n1[i] * 0.6 + n2[i] * 0.4;
  }

  return { data: createNormalFromHeights(heights, w, h, 1.8), width: w, height: h };
}

export function generateAllTerrainTextureBuffers() {
  const grass = generateGrassBuffers(512, 512);
  const sand = generateSandBuffers(256, 256);
  const rock = generateRockBuffers(512, 512);
  const snow = generateSnowBuffers(256, 256);
  const runway = generateRunwayBuffers(256, 256);
  const microNormal = generateMicroNormalBuffer(256, 256);

  return {
    grassMap: grass.albedo,
    grassNormal: grass.normal,
    sandMap: sand.albedo,
    sandNormal: sand.normal,
    rockMap: rock.albedo,
    rockNormal: rock.normal,
    snowMap: snow.albedo,
    snowNormal: snow.normal,
    runwayMap: runway.albedo,
    runwayNormal: runway.normal,
    microNormal,
  };
}
