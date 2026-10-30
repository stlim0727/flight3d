import * as THREE from 'three';

const WINDOW_WARM = new THREE.Color(0xffd39a);

/** Automatic dusk switch shared by airfield, terminal and instrument lighting. */
export function nightLightLevel(sunHeight) {
  return 1 - THREE.MathUtils.smoothstep(sunHeight, -0.10, 0.08);
}

/** Visible light sources are batched; only a small fixed set of apron lamps cast light. */
export class AirportNightLighting {
  constructor(parent, runways, lamps = []) {
    this.group = new THREE.Group();
    this.group.name = 'Airport night lighting';
    parent.add(this.group);
    this.windows = new Map();
    this.windowCopies = new WeakMap();
    this.lamps = [];
    this.sources = [];
    this.level = 0;
    for (const runway of runways) this.addRunway(runway);
    for (const lamp of lamps) this.addLamp(lamp);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.sources.flatMap(s => s.position), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.sources.flatMap(s => s.color), 3));
    geometry.setAttribute('endDirection', new THREE.Float32BufferAttribute(this.sources.flatMap(s => s.endDirection ?? [0, 0, 0]), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { brightness: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 color;
        attribute vec3 endDirection;
        varying vec3 lightColor;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.);
          vec4 mvPosition = viewMatrix * world;
          lightColor = color;
          if (length(endDirection) > .5) {
            // Green looking into the runway, red looking out toward its end.
            lightColor = dot(cameraPosition - world.xyz, endDirection) > 0.
              ? vec3(1., .025, .01) : vec3(.02, 1., .12);
          }
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(1800. / max(1., -mvPosition.z), 3., 24.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float brightness;
        varying vec3 lightColor;
        void main() {
          float radius = length(gl_PointCoord - .5) * 2.;
          if (radius > 1.) discard;
          #include <logdepthbuf_fragment>
          float glow = exp(-radius * radius * 5.) * (1. - smoothstep(.7, 1., radius));
          gl_FragColor = vec4(lightColor * 2., glow * brightness);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'Runway and apron light halos';
    this.group.add(this.points);
  }

  source(position, color, endDirection) {
    this.sources.push({ position, color: new THREE.Color(color).toArray(), endDirection });
  }

  addRunway({ start, end, width, spacing = 60 }) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const along = b.clone().sub(a);
    const right = new THREE.Vector3(-along.z, 0, along.x).normalize();
    const count = Math.ceil(Math.hypot(along.x, along.z) / spacing);
    for (let i = 0; i <= count; i++) {
      for (const side of [-1, 1]) {
        const p = a.clone().addScaledVector(along, i / count).addScaledVector(right, side * (width / 2 + 1));
        p.y += .65;
        // Last 600 m of edge lighting is amber on long runways.
        this.source(p.toArray(), count * spacing > 1200 && (i * spacing < 600 || (count - i) * spacing < 600) ? 0xffcc55 : 0xfff3db);
      }
    }
    for (const [p, sign] of [[a, -1], [b, 1]]) {
      for (let across = -width / 2; across <= width / 2; across += 3) {
        const position = p.clone().addScaledVector(right, across); position.y += .65;
        this.source(position.toArray(), 0xffffff, along.clone().normalize().multiplyScalar(-sign).toArray());
      }
    }
  }

  addLamp({ x, y, z, height = 10 }) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.12, .22, height, 6),
      new THREE.MeshStandardMaterial({ color: 0x596574, roughness: .8 }));
    pole.position.set(x, y + height / 2, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, .25, 1),
      new THREE.MeshStandardMaterial({ color: 0xe4ddc9, emissive: 0xffd69a, emissiveIntensity: 0 }));
    head.position.set(x, y + height, z);
    const light = new THREE.SpotLight(0xffdfb0, 0, height * 5, Math.PI / 3, .65, 2);
    light.position.copy(head.position);
    light.target.position.set(x, y, z);
    // No shadow maps or per-runway PointLights: bounded shader/light cost.
    this.group.add(pole, head, light, light.target);
    this.lamps.push({ light, head, maximum: height * height * 5 });
    this.source([x, y + height, z], 0xffdfb0);
  }

  /** Clone once so shared GLB/library materials and other airports stay independent. */
  illuminateWindows(root, matches = material => /glass|window/i.test(material.name)) {
    root.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const lit = materials.map(material => {
        if (!material.emissive || !matches(material)) return material;
        if (this.windows.has(material)) return material;
        if (this.windowCopies.has(material)) return this.windowCopies.get(material);
        const copy = material.clone();
        this.windowCopies.set(material, copy);
        this.windows.set(copy, { color: material.emissive.clone(), intensity: material.emissiveIntensity });
        copy.emissive.set(0xffd39a); copy.emissiveIntensity = this.level * .75;
        return copy;
      });
      node.material = Array.isArray(node.material) ? lit : lit[0];
    });
  }

  update(sunHeight) {
    this.level = nightLightLevel(sunHeight);
    this.material.uniforms.brightness.value = this.level;
    for (const { light, head, maximum } of this.lamps) {
      light.intensity = maximum * this.level;
      head.material.emissiveIntensity = this.level * 2;
    }
    for (const [material, base] of this.windows) {
      material.emissive.copy(base.color).lerp(WINDOW_WARM, this.level);
      material.emissiveIntensity = THREE.MathUtils.lerp(base.intensity, .75, this.level);
    }
  }
}
