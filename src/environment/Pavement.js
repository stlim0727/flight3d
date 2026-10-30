import * as THREE from 'three';

// Airports stay allocated for the lifetime of the simulator. Share maps across
// both airports; preset changes never allocate another texture set.
const textureLoads = new Map();
let crackMaterial;
let wearMaterial;
let surfaceWearMaterial;

// One 3m scan tile, independent of slab dimensions or airport orientation.
export function setPavementUVs(geometry) {
  const positions = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    uv.setXY(i, positions.getX(i) / 3, -positions.getZ(i) / 3);
  }
  uv.needsUpdate = true;
  return geometry;
}

export function createPavementMaterial(kind, polygonOffset = -1) {
  const material = new THREE.MeshStandardMaterial({
    color: kind === 'asphalt' ? 0x777777 : 0xb0b0b0,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.35, 0.35),
    polygonOffset: true,
    polygonOffsetFactor: polygonOffset,
    polygonOffsetUnits: polygonOffset
  });
  material.name = `pavement-${kind}`;
  // Keep a usable solid material in headless tests and if any local map fails.
  if (typeof window === 'undefined' || typeof document === 'undefined') return material;
  const loader = new THREE.TextureLoader();
  for (const [slot, suffix] of [['map', 'color'], ['normalMap', 'normal'], ['roughnessMap', 'roughness']]) {
    const url = `${(import.meta.env?.BASE_URL ?? '/')}textures/pavement/${kind}-${suffix}.jpg`;
    if (!textureLoads.has(url)) {
      textureLoads.set(url, loader.loadAsync(url).then(texture => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        // Mipmaps plus bounded anisotropy suppress grazing-angle runway shimmer.
        texture.anisotropy = 4;
        return texture;
      }).catch(() => null));
    }
    textureLoads.get(url).then(texture => {
      if (!texture) return;
      material[slot] = texture;
      material.needsUpdate = true;
    });
  }
  return material;
}

// Original, deterministic tire rubber artwork: no network dependency or extra
// texture per touchdown zone. The geometry follows each runway's own transform.
export function createRunwayWearMaterial() {
  if (wearMaterial) return wearMaterial;
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let seed = 73;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 480; i++) {
    const x = (i % 2 ? 158 : 86) + (random() - 0.5) * 48;
    const y = 80 + random() * 720;
    const length = 45 + random() * 180;
    const gradient = ctx.createLinearGradient(0, y, 0, y + length);
    gradient.addColorStop(0, 'rgba(10,9,8,0)');
    gradient.addColorStop(0.3, `rgba(10,9,8,${0.18 + random() * 0.3})`);
    gradient.addColorStop(1, 'rgba(10,9,8,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, 0.8 + random() * 3, length);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  });
  material.name = 'runway-rubber';
  wearMaterial = material;
  return wearMaterial;
}

// Low-frequency weathering complements the metre-scaled asphalt scan. The
// normalized artwork runs along local Z; each airport supplies its own transform.
// This is visual aging, not a change to tire friction or pavement contact height.
export function createRunwaySurfaceWear(width, length) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!surfaceWearMaterial) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    let seed = 327;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    // Overlapping soft ellipses avoid a repeating tile or rectangular decal edge.
    // Leave transparent margins so the shoulder/threshold silhouette stays clean.
    for (let i = 0; i < 1100; i++) {
      const radius = 8 + random() * 25;
      const stretch = 1.5 + random() * 3;
      const marginX = radius + 16;
      const marginY = radius * stretch + 32;
      const x = marginX + random() * (canvas.width - 2 * marginX);
      const y = marginY + random() * (canvas.height - 2 * marginY);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, stretch);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      const shade = i % 3 === 0 ? '18,17,15' : '179,170,150';
      gradient.addColorStop(0, `rgba(${shade},${0.025 + random() * 0.055})`);
      gradient.addColorStop(1, `rgba(${shade},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    surfaceWearMaterial = new THREE.MeshStandardMaterial({
      map, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    surfaceWearMaterial.name = 'runway-surface-wear';
  }
  const geometry = new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, surfaceWearMaterial);
  mesh.name = 'runway-surface-wear';
  mesh.position.y = 0.004;
  mesh.receiveShadow = true;
  return mesh;
}

export function createRunwayRepairs(width, length) {
  const group = new THREE.Group();
  group.name = 'runway-repairs';
  const material = createPavementMaterial('asphalt', -3);
  material.name = 'runway-repair';
  material.color.multiplyScalar(0.7);
  const geometry = setPavementUVs(new THREE.PlaneGeometry(3, 7).rotateX(-Math.PI / 2));
  for (const side of [-1, 1]) {
    const patch = new THREE.Mesh(geometry, material);
    patch.position.set(side * width * 0.3, 0.012, side * length * 0.18);
    patch.receiveShadow = true;
    group.add(patch);
  }
  // Sparse sealed cracks, in runway-local metres. Keep them inside the edge
  // markings and inherit the parent's heading/grade, including at Lukla.
  const cracks = getCrackMaterial();
  if (cracks) {
    const crackGeometry = new THREE.PlaneGeometry(8, 12).rotateX(-Math.PI / 2);
    for (const side of [-1, 1]) {
      const crack = new THREE.Mesh(crackGeometry, cracks);
      crack.name = 'runway-cracks';
      crack.position.set(side * width * 0.28, 0.018, side * length * 0.3);
      crack.rotation.y = side * 0.3;
      crack.receiveShadow = true;
      group.add(crack);
    }
  }
  return group;
}

function getCrackMaterial() {
  if (crackMaterial) return crackMaterial;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Original artwork, no external asset. Transparent margins avoid hard decal
  // edges; filtered mipmaps fade the centimetre-scale sealant at a distance.
  const paths = [
    [[54, 100], [130, 145], [188, 139], [251, 207], [295, 284], [379, 330], [460, 415]],
    [[188, 139], [211, 85], [259, 49]],
    [[295, 284], [238, 345], [224, 450]],
    [[379, 330], [423, 278], [465, 261]]
  ];
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const [lineWidth, strokeStyle] of [[4, 'rgba(34,31,27,0.25)'], [1.5, 'rgba(19,18,16,0.7)']]) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    for (const path of paths) {
      ctx.beginPath();
      path.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  crackMaterial = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  });
  crackMaterial.name = 'runway-cracks';
  return crackMaterial;
}
