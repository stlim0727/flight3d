import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG_TO_RAD = Math.PI / 180;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function box(group, name, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export class AddonAircraft {
  constructor(descriptor, { pfdCanvas, ndCanvas } = {}) {
    this.descriptor = descriptor;
    this.group = new THREE.Group();
    this.group.name = `Aircraft_Addon_${descriptor.id}`;
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.visible = false;
    this.group.add(this.gltfGroup);
    this.proceduralGroup = new THREE.Group();
    this.group.add(this.proceduralGroup);
    this.cockpit = {
      group: new THREE.Group(),
      yokesVisible: true,
      cockpitModelFailed: !descriptor.cockpit,
      gltfCockpitGroup: null,
      syncLighting: () => {},
      toggleYokes: () => { this.cockpit.yokesVisible = !this.cockpit.yokesVisible; return this.cockpit.yokesVisible; },
      onModelReady: null,
    };
    this.group.add(this.cockpit.group);
    this.loadingGltf = Boolean(descriptor.model);
    this.modelLoaded = false;
    this.isCrashed = false;
    this.flatShading = false;
    this.propAngle = 0;
    this.surfaceNodes = new Map();
    this.surfaceState = new Map();
    this.ready = Promise.resolve();
    this.pfdCanvas = pfdCanvas;
    this.ndCanvas = ndCanvas;
    this.buildProceduralFallback();
    if (descriptor.model) this.loadGltfModel(descriptor.model.url);
  }

  buildProceduralFallback() {
    const aero = this.descriptor.config.aerodynamics ?? {};
    const span = aero.wingspanM ?? 11;
    const area = aero.wingAreaM2 ?? 16;
    const length = this.descriptor.config.massProperties ? undefined : 8;
    const chord = Math.max(1, area / span);
    const bodyLength = length ?? Math.max(8, chord * 3.6);
    const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 0.05, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1252a8, metalness: 0.1, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x12151c, metalness: 0.2, roughness: 0.6 });
    box(this.proceduralGroup, 'fuselage_node', [0.95, 0.95, bodyLength], [0, 0, 0], white);
    box(this.proceduralGroup, 'wing_node', [chord, 0.16, span], [0.4, 0.05, 0], blue);
    box(this.proceduralGroup, 'tailplane_node', [chord * 0.5, 0.1, span * 0.36], [-bodyLength * 0.42, 0.28, 0], white);
    box(this.proceduralGroup, 'elevator_node', [chord * 0.24, 0.06, span * 0.32], [-bodyLength * 0.5, 0.28, 0], white);
    box(this.proceduralGroup, 'rudder_node', [chord * 0.5, 1.3, 0.08], [-bodyLength * 0.43, 0.7, 0], blue);
    box(this.proceduralGroup, 'flaps_node', [chord * 0.22, 0.05, span * 0.5], [-0.2, 0.05, 0], dark);
    box(this.proceduralGroup, 'gear_node', [0.4, 0.7, 1.5], [0.2, -0.7, 0], dark);
    box(this.proceduralGroup, 'azimuth_node', [0.12, 1.6, 0.12], [bodyLength * 0.52, 0, 0], dark);
    this.proceduralGroup.visible = true;
    for (const node of this.proceduralGroup.children) this.surfaceNodes.set(node.name, node);
  }

  loadGltfModel(url) {
    let settle;
    this.ready = new Promise(resolve => { settle = resolve; });
    const loader = new GLTFLoader();
    loader.load(url, gltf => {
      const nodes = new Map();
      gltf.scene.traverse(node => {
        const sanitized = THREE.PropertyBinding.sanitizeNodeName(node.name);
        if (node.name) nodes.set(node.name, node);
        if (sanitized !== node.name) nodes.set(sanitized, node);
      });
      this.surfaceNodes = nodes;
      gltf.scene.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
      });
      this.gltfGroup.add(gltf.scene);
      this.gltfGroup.visible = true;
      this.proceduralGroup.visible = false;
      this.modelLoaded = true;
      this.cockpit.gltfCockpitGroup = gltf.scene;
      this.cockpit.cockpitModelFailed = !this.descriptor.cockpit;
      this.loadingGltf = false;
      this.cockpit.onModelReady?.();
      settle();
    }, undefined, error => {
      console.error('Addon aircraft GLB failed to load:', error);
      this.loadingGltf = false;
      this.modelLoaded = false;
      this.cockpit.cockpitModelFailed = true;
      settle();
    });
  }

  inputValue(input, telemetry) {
    switch (input) {
      case 'elevator': return clamp(telemetry.controlInputs?.elevator ?? 0, -1, 1);
      case 'aileron': return clamp(telemetry.controlInputs?.aileron ?? 0, -1, 1);
      case 'rudder': return clamp(telemetry.controlInputs?.rudder ?? 0, -1, 1);
      case 'normalized': return clamp(telemetry.controlInputs?.elevator ?? 0, -1, 1);
      case 'rpm': return (telemetry.engine1N1 ?? telemetry.engine1?.n1 ?? 25) / 100;
      case 'gearState': return clamp(telemetry.gearState ?? 1, 0, 1);
      case 'flapsIndex': return clamp(telemetry.flapsIndex ?? 0, 0, 8);
      case 'compressions': return clamp(telemetry.compressions?.[0] ?? 0, 0, 1);
      default: return 0;
    }
  }

  applyControl(control, binding, telemetry, dt) {
    const node = this.surfaceNodes.get(binding.node);
    if (!node) return;
    const range = binding.rangeDeg ?? [0, 0];
    let target = binding.input === 'rpm'
      ? clamp(this.inputValue('rpm', telemetry), ...(binding.rpmRange ?? [0, 100])) / (binding.rpmRange?.[1] ?? 100)
      : clamp(this.inputValue(binding.input, telemetry), -1, 1);
    if (binding.input === 'flapsIndex') target = clamp(target / 3, 0, 1);
    let degrees = binding.neutralDeg ?? 0;
    if (binding.continuous) {
      this.surfaceState.set(control, (this.surfaceState.get(control) ?? 0) + target * dt * 720);
      degrees += this.surfaceState.get(control);
    } else {
      degrees += range[0] + (range[1] - range[0]) * clamp((target + 1) / 2, 0, 1);
    }
    const smoothed = this.smooth(control, degrees, binding.smoothingSec ?? 0, dt);
    node.rotation[binding.axis ?? 'x'] = smoothed * DEG_TO_RAD;
  }

  smooth(control, target, smoothingSec, dt) {
    if (smoothingSec <= 0 || dt <= 0) return target;
    const previous = this.surfaceState.get(`${control}:degrees`) ?? target;
    const alpha = 1 - Math.exp(-dt / smoothingSec);
    const value = previous + (target - previous) * alpha;
    this.surfaceState.set(`${control}:degrees`, value);
    return value;
  }

  update(dt, telemetry = {}) {
    if (this.isCrashed) return;
    for (const [control, binding] of Object.entries(this.descriptor.controls)) {
      this.applyControl(control, binding, telemetry, dt);
    }
  }

  setCockpitMode(isCockpit) {
    this.cockpit.group.visible = isCockpit;
    this.gltfGroup.visible = true;
  }

  triggerCrashVisuals() { this.isCrashed = true; }
  resetCrashVisuals() {
    this.isCrashed = false;
    this.gltfGroup.visible = this.modelLoaded;
    this.proceduralGroup.visible = !this.modelLoaded;
  }

  setFlatShading(flatShading) {
    this.flatShading = Boolean(flatShading);
    this.group.traverse(node => {
      if (node.isMesh && node.material) node.material.flatShading = this.flatShading;
    });
  }
}
