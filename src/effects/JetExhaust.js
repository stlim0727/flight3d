import * as THREE from 'three';

/** Aft-facing, engine-driven plume. Geometry stays outside the nozzle and airframe. */
export class JetExhaust {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'F16-engine-exhaust';
    this.group.position.set(0, 0, 6.9);
    this.power = 0;
    const geometry = new THREE.CylinderGeometry(.48, .06, 1, 24, 16, true);
    geometry.translate(0, -.5, 0);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { time: { value: 0 }, power: { value: 0 }, burner: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; uniform float time,power,burner;
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          float tail=1.0-vUv.y;
          float ripple=0.65+0.35*sin(tail*65.0-time*35.0+sin(vUv.x*25.0));
          float diamonds=pow(0.5+0.5*cos(tail*45.0-time*2.0),8.0);
          vec3 hot=mix(vec3(0.1,0.3,0.8),vec3(1.0,0.35,0.08),burner);
          hot=mix(hot,vec3(0.55,0.7,1.0),diamonds*burner);
          float alpha=power*(0.05+burner*0.7)*pow(1.0-tail,1.6)*ripple;
          gl_FragColor=vec4(hot,alpha);
        }`,
    });
    this.plume = new THREE.Mesh(geometry, this.material);
    this.plume.frustumCulled = false;
    this.group.add(this.plume);
  }

  update(dt, state, crashed = false) {
    const engine = state.engine1;
    const n1 = THREE.MathUtils.clamp((engine?.n1 ?? 0) / 100, 0, 1);
    const thrust = engine?.thrust ?? 0;
    const target = crashed || thrust <= 0 ? 0 : n1;
    this.power += (target - this.power) * (1 - Math.exp(-Math.max(0, dt) * 5));
    const burner = THREE.MathUtils.smoothstep(this.power, .82, .98);
    this.material.uniforms.time.value += Math.max(0, dt);
    this.material.uniforms.power.value = this.power;
    this.material.uniforms.burner.value = burner;
    this.plume.scale.set(1, 1, .8 + this.power * 1.5 + burner * 5);
    this.group.visible = !crashed && this.power > .005;
  }
}
