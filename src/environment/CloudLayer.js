import * as THREE from 'three';
import { requestProceduralAsset } from '../core/proceduralAssetPool.js';
import { CLOUD_DENSITY_SIZE, CLOUD_VARIANTS, createCloudDensityData } from './cloudDensityData.js';

export { CLOUD_DENSITY_SIZE, CLOUD_VARIANTS };

function buildCloudDensityTexture(data, size = CLOUD_DENSITY_SIZE) {
  const stride = size + 2;
  const texture = new THREE.Data3DTexture(data, size, size, stride * CLOUD_VARIANTS);
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// Original 3D density assets, baked once on the CPU. Each variant has two empty
// Z slices so linear filtering cannot blend it into an adjacent volume.
export function createCloudDensity(size = CLOUD_DENSITY_SIZE) {
  return buildCloudDensityTexture(createCloudDensityData(size), size);
}

function createPlaceholderCloudDensity() {
  const texture = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2);
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export class CloudLayer extends THREE.Group {
  constructor(options = {}) {
    super();
    this.name = 'Cumulus density volumes';
    this.disposed = false;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const deferDensity = Boolean(options.deferDensity) && typeof Worker !== 'undefined';
    const densityTexture = deferDensity ? createPlaceholderCloudDensity() : createCloudDensity();
    const materialOptions = {
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
        uniform float cloudVariant;
        varying vec3 localCamera;
        varying vec3 localPosition;
        varying vec3 localSun;
        varying float variant;
        varying vec3 worldScale;
        #include <fog_pars_vertex>
        void main() {
          mat4 world = modelMatrix;
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
    };
    this.geometry = geometry;
    this.materials = Array.from({ length: CLOUD_VARIANTS }, (_, variant) =>
      new THREE.ShaderMaterial({
        ...materialOptions,
        uniforms: { ...materialOptions.uniforms, cloudVariant: { value: variant } },
      })
    );
    this.material = this.materials[0];
    this.densityTexture = densityTexture;
    this.clouds = [];
    let seed = 12012;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 64; i++) {
      const x = (random() - 0.5) * 32000;
      const z = (random() - 0.5) * 32000;
      if (Math.abs(x) < 4000 && Math.abs(z) < 2500) continue;
      const width = 1500 + random() * 1800;
      const altitude = 2800 + random() * 800;
      const height = width * (0.42 + random() * 0.33);
      const depth = width * (0.65 + random() * 0.5);
      const variant = i % CLOUD_VARIANTS;
      const cloud = new THREE.Mesh(geometry, this.materials[variant]);
      cloud.position.set(x, altitude, z);
      cloud.scale.set(width, height, depth);
      cloud.rotation.y = random() * Math.PI * 2;
      this.clouds.push(cloud);
      this.add(cloud);
    }
    this.count = this.clouds.length;
    if (deferDensity) {
      this.densityReady = requestProceduralAsset('cloud-density', { size: CLOUD_DENSITY_SIZE })
        .then(data => {
          if (this.disposed) return false;
          const previous = this.densityTexture;
          const realTexture = buildCloudDensityTexture(data, CLOUD_DENSITY_SIZE);
          this.densityTexture = realTexture;
          for (const mat of this.materials) {
            mat.uniforms.densityTexture.value = realTexture;
          }
          previous?.dispose();
          return true;
        });
    } else {
      this.densityReady = Promise.resolve(true);
    }
  }

  syncLighting(sun, ambient) {
    this.material.uniforms.sunDirection.value.copy(sun.position).sub(sun.target.position).normalize();
    this.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity * 0.3);
    this.material.uniforms.ambientColor.value.copy(ambient.color).multiplyScalar(ambient.intensity * 0.5);
  }

  dispose() {
    this.disposed = true;
    this.densityTexture.dispose();
    this.geometry.dispose();
    this.materials.forEach(material => material.dispose());
  }
}
