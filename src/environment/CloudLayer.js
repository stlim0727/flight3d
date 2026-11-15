import * as THREE from 'three';

export const CLOUD_DENSITY_SIZE = 48;
export const CLOUD_VARIANTS = 4;

// Original 3D density assets, baked once on the CPU. Each variant has two empty
// Z slices so linear filtering cannot blend it into an adjacent volume.
export function createCloudDensity(size = CLOUD_DENSITY_SIZE) {
  const hash = (x, y, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const lattice = new Float32Array(32 ** 3);
  for (let z = 0; z < 32; z++) {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) lattice[(z * 32 + y) * 32 + x] = hash(x, y, z);
    }
  }
  const smooth = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const value = (x, y, z) => lattice[((z & 31) * 32 + (y & 31)) * 32 + (x & 31)];
  const noise = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
    return lerp(
      lerp(lerp(value(ix, iy, iz), value(ix + 1, iy, iz), fx), lerp(value(ix, iy + 1, iz), value(ix + 1, iy + 1, iz), fx), fy),
      lerp(lerp(value(ix, iy, iz + 1), value(ix + 1, iy, iz + 1), fx), lerp(value(ix, iy + 1, iz + 1), value(ix + 1, iy + 1, iz + 1), fx), fy), fz);
  };
  const stride = size + 2;
  const data = new Uint8Array(size * size * stride * CLOUD_VARIANTS);
  for (let variant = 0; variant < CLOUD_VARIANTS; variant++) {
    const lobes = [
      [-0.19, -0.14, 0, 0.25, 0.27, 0.28],
      [0.02 + Math.sin(variant * 2) * 0.08, -0.015, 0.015, 0.26, 0.34 + variant * 0.03, 0.27],
      [0.23, -0.15, -0.02, 0.23, 0.25, 0.24],
      [-0.06, -0.14, 0.23, 0.27, 0.26, 0.21],
      [0.04, -0.16, -0.24, 0.26, 0.25, 0.20],
    ];
    for (let z = 1; z < size - 1; z++) {
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const px = x / (size - 1) - 0.5;
          const py = y / (size - 1) - 0.5;
          const pz = z / (size - 1) - 0.5;
          let shape = -10;
          for (const [cx, cy, cz, rx, ry, rz] of lobes) {
            shape = Math.max(shape, 1 - ((px - cx) / rx) ** 2 - ((py - cy) / ry) ** 2 - ((pz - cz) / rz) ** 2);
          }
          const offset = variant * 7.71;
          const billows = noise(px * 6 + offset, py * 6 + offset, pz * 6 + offset);
          const detail = noise(px * 19 + offset, py * 19 + offset, pz * 19 + offset);
          const body = shape - 0.40 + billows * 0.85 - (1 - detail) * 0.42;
          const base = THREE.MathUtils.smoothstep(py, -0.43, -0.28);
          const boundary = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(px), Math.abs(py), Math.abs(pz)), 0.44, 0.48);
          const density = THREE.MathUtils.smoothstep(body, 0, 0.28) * base * boundary;
          data[((variant * stride + z + 1) * size + y) * size + x] = Math.round(density * 255);
        }
      }
    }
  }
  const texture = new THREE.Data3DTexture(data, size, size, stride * CLOUD_VARIANTS);
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export class CloudLayer extends THREE.InstancedMesh {
  constructor() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const densityTexture = createCloudDensity();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        densityTexture: { value: densityTexture },
        densitySize: { value: CLOUD_DENSITY_SIZE },
        sunDirection: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color() },
        ambientColor: { value: new THREE.Color() },
      },
      vertexShader: `
        uniform vec3 sunDirection;
        attribute float cloudVariant;
        varying vec3 localCamera;
        varying vec3 localPosition;
        varying vec3 localSun;
        varying float variant;
        varying vec3 worldScale;
        #include <fog_pars_vertex>
        void main() {
          mat4 world = modelMatrix * instanceMatrix;
          mat4 local = inverse(world);
          localCamera = (local * vec4(cameraPosition, 1.)).xyz;
          localSun = normalize((local * vec4(sunDirection, 0.)).xyz);
          localPosition = position;
          variant = cloudVariant;
          worldScale = vec3(length(world[0].xyz), length(world[1].xyz), length(world[2].xyz));
          vec4 mvPosition = viewMatrix * world * vec4(position, 1.);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        precision highp sampler3D;
        uniform sampler3D densityTexture;
        uniform float densitySize;
        uniform vec3 sunColor;
        uniform vec3 ambientColor;
        varying vec3 localCamera;
        varying vec3 localPosition;
        varying vec3 localSun;
        varying float variant;
        varying vec3 worldScale;
        #include <fog_pars_fragment>

        float density(vec3 p) {
          if (any(greaterThan(abs(p), vec3(0.5)))) return 0.;
          vec3 uv = (p + 0.5) * (densitySize - 1.) + 0.5;
          uv.z += variant * (densitySize + 2.) + 1.;
          uv /= vec3(densitySize, densitySize, (densitySize + 2.) * 4.);
          return texture(densityTexture, uv).r;
        }

        void main() {
          vec3 ray = normalize(localPosition - localCamera);
          // A parallel ray has an infinite slab interval, not a NaN at a box face.
          vec3 safeRay = mix(vec3(0.00001), ray, greaterThan(abs(ray), vec3(0.00001)));
          vec3 a = (-0.5 - localCamera) / safeRay;
          vec3 b = (0.5 - localCamera) / safeRay;
          vec3 nearSlab = min(a, b), farSlab = max(a, b);
          float start = max(0., max(max(nearSlab.x, nearSlab.y), nearSlab.z));
          float end = min(min(farSlab.x, farSlab.y), farSlab.z);
          if (end <= start) discard;
          float stepLength = (end - start) / 24.;
          float worldStep = length(ray * worldScale) * stepLength;
          // Jitter hides slice bands; density itself is fixed in world space.
          float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
          vec3 p = localCamera + ray * (start + stepLength * jitter);
          vec3 color = vec3(0.);
          float transmittance = 1.;
          for (int i = 0; i < 24; i++) {
            float d = density(p);
            if (d > 0.005) {
              float shadow = density(p + localSun * 0.09)
                + density(p + localSun * 0.24) * 0.8;
              float sunlight = exp(-shadow * 1.1);
              float alpha = 1. - exp(-d * worldStep * 0.012);
              vec3 lighting = ambientColor * (0.7 + 0.3 * (p.y + 0.5))
                + sunColor * (0.15 + 0.85 * sunlight);
              color += transmittance * alpha * lighting;
              transmittance *= 1. - alpha;
              if (transmittance < 0.015) break;
            }
            p += ray * stepLength;
          }
          float alpha = 1. - transmittance;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color / alpha, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: true,
    });
    super(geometry, material, 64);
    this.name = 'Cumulus density volumes';
    this.densityTexture = densityTexture;
    this.clouds = [];
    let seed = 12012;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 64; i++) {
      const x = (random() - 0.5) * 32000;
      const z = (random() - 0.5) * 32000;
      if (Math.abs(x) < 4000 && Math.abs(z) < 2500) continue;
      const width = 1500 + random() * 1800;
      this.clouds.push({
        position: new THREE.Vector3(x, 2800 + random() * 800, z),
        width,
        height: width * (0.42 + random() * 0.33),
        depthSize: width * (0.65 + random() * 0.5),
        variant: i % CLOUD_VARIANTS,
        yaw: random() * Math.PI * 2,
        depth: 0,
      });
    }
    this.count = this.clouds.length;
    this.variants = new THREE.InstancedBufferAttribute(new Float32Array(64), 1);
    geometry.setAttribute('cloudVariant', this.variants);
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.variants.setUsage(THREE.DynamicDrawUsage);
    this.sortMatrix = new THREE.Matrix4();
    this.cloudMatrix = new THREE.Matrix4();
    this.cloudScale = new THREE.Vector3();
    this.sortForCamera(new THREE.PerspectiveCamera());
    this.computeBoundingSphere();
  }

  sortForCamera(camera) {
    camera.updateWorldMatrix(true, false);
    this.updateWorldMatrix(true, false);
    this.sortMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
    for (const cloud of this.clouds) {
      const p = cloud.position;
      const m = this.sortMatrix.elements;
      cloud.depth = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    }
    this.clouds.sort((a, b) => a.depth - b.depth);
    this.clouds.forEach((cloud, i) => {
      this.cloudMatrix.makeRotationY(cloud.yaw);
      this.cloudMatrix.scale(this.cloudScale.set(cloud.width, cloud.height, cloud.depthSize));
      this.cloudMatrix.setPosition(cloud.position);
      this.setMatrixAt(i, this.cloudMatrix);
      this.variants.setX(i, cloud.variant);
    });
    this.instanceMatrix.needsUpdate = true;
    this.variants.needsUpdate = true;
  }

  syncLighting(sun, ambient) {
    this.material.uniforms.sunDirection.value.copy(sun.position).sub(sun.target.position).normalize();
    this.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity * 0.3);
    this.material.uniforms.ambientColor.value.copy(ambient.color).multiplyScalar(ambient.intensity * 0.5);
  }

  dispose() {
    this.densityTexture.dispose();
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
