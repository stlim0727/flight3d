import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyAircraftLivery } from './applyAircraftLivery.js';

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
    this.cockpitMode = false;
    this.cockpit = {
      group: new THREE.Group(),
      yokesVisible: true,
      cockpitModelFailed: false,
      cockpitModelLoading: false,
      gltfCockpitLoaded: false,
      gltfCockpitGroup: null,
      syncLighting: () => {},
      toggleYokes: () => { this.cockpit.yokesVisible = !this.cockpit.yokesVisible; return this.cockpit.yokesVisible; },
      onModelReady: null,
      ensureCockpitModel: () => this.ensureCockpitModel(),
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
    const chord = Math.max(1, area / span);
    const bodyLength = Number.isFinite(this.descriptor.config.lengthM) && this.descriptor.config.lengthM > 0
      ? this.descriptor.config.lengthM
      : Math.max(8, chord * 3.6);
    const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 0.05, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1252a8, metalness: 0.1, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x12151c, metalness: 0.2, roughness: 0.6 });
    box(this.proceduralGroup, 'fuselage_node', [0.95, 0.95, bodyLength], [0, 0, 0], white);
    box(this.proceduralGroup, 'wing_node', [span, 0.16, chord], [0, 0.05, -0.4], blue);
    box(this.proceduralGroup, 'tailplane_node', [span * 0.36, 0.1, chord * 0.5], [0, 0.28, bodyLength * 0.42], white);
    box(this.proceduralGroup, 'elevator_node', [span * 0.32, 0.06, chord * 0.24], [0, 0.28, bodyLength * 0.5], white);
    box(this.proceduralGroup, 'rudder_node', [0.08, 1.3, chord * 0.5], [0, 0.7, bodyLength * 0.43], blue);
    box(this.proceduralGroup, 'flaps_node', [span * 0.5, 0.05, chord * 0.22], [0, 0.05, 0.2], dark);
    box(this.proceduralGroup, 'gear_node', [1.5, 0.7, 0.4], [0, -0.7, -0.2], dark);
    box(this.proceduralGroup, 'azimuth_node', [1.6, 0.12, 0.12], [0, 0, -bodyLength * 0.52], dark);
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
      if (this.descriptor.livery) {
        applyAircraftLivery(gltf.scene, this.group, this.gltfGroup, this.descriptor.livery);
      }
      this.modelLoaded = true;
      this.gltfGroup.visible = !this.cockpitMode || !this.descriptor.cockpit;
      this.proceduralGroup.visible = false;
      if (!this.descriptor.cockpit) {
        this.cockpit.gltfCockpitGroup = gltf.scene;
        this.cockpit.gltfCockpitLoaded = true;
        this.cockpit.cockpitModelFailed = false;
        this.cockpit.onModelReady?.();
      }
      this.loadingGltf = false;
      settle();
    }, undefined, error => {
      console.error('Addon aircraft GLB failed to load:', error);
      this.loadingGltf = false;
      this.modelLoaded = false;
      if (!this.descriptor.cockpit) this.cockpit.cockpitModelFailed = true;
      settle();
    });
  }

  inputValue(input, telemetry) {
    switch (input) {
      case 'elevator': return clamp(telemetry.controlInputs?.elevator ?? 0, -1, 1);
      case 'aileron': return clamp(telemetry.controlInputs?.aileron ?? 0, -1, 1);
      case 'rudder': return clamp(telemetry.controlInputs?.rudder ?? 0, -1, 1);
      case 'normalized': return clamp(telemetry.controlInputs?.elevator ?? 0, -1, 1);
      case 'rpm': return telemetry.engine1N1 ?? telemetry.engine1?.n1 ?? 25;
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
    const value = this.inputValue(binding.input, telemetry);
    const signed = ['elevator', 'aileron', 'rudder', 'normalized'].includes(binding.input);
    let target = signed
      ? (clamp(value, -1, 1) + 1) / 2
      : clamp(value, 0, 1);
    if (binding.input === 'flapsIndex') {
      const maxFlap = Math.max(1, (this.descriptor.config?.aerodynamics?.flapAngles?.length ?? 1) - 1);
      target = clamp(value / maxFlap, 0, 1);
    } else if (binding.input === 'rpm') {
      const [minimum, maximum] = binding.rpmRange ?? [0, 100];
      target = clamp((clamp(value, minimum, maximum) - minimum) / (maximum - minimum || 1), 0, 1);
    }
    let degrees = binding.neutralDeg ?? 0;
    if (binding.continuous) {
      const next = (((this.surfaceState.get(control) ?? 0) + target * dt * 900) % 360 + 360) % 360;
      this.surfaceState.set(control, next);
      degrees += next;
    } else {
      degrees += range[0] + (range[1] - range[0]) * target;
    }
    const smoothed = this.smooth(control, degrees, binding.smoothingSec ?? 0, dt);
    node.rotation[binding.axis ?? 'x'] = smoothed * DEG_TO_RAD;
  }

  ensureCockpitModel() {
    if (!this.descriptor.cockpit || this.cockpit.cockpitModelLoading || this.cockpit.gltfCockpitLoaded) return false;
    this.cockpit.cockpitModelLoading = true;
    const loader = new GLTFLoader();
    loader.load(this.descriptor.cockpit.url, gltf => {
      gltf.scene.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = false;
        node.receiveShadow = true;
      });
      this.cockpit.group.add(gltf.scene);
      this.cockpit.gltfCockpitGroup = gltf.scene;
      this.cockpit.gltfCockpitLoaded = true;
      this.cockpit.cockpitModelLoading = false;
      this.cockpit.cockpitModelFailed = false;
      this.cockpit.onModelReady?.();
    }, undefined, error => {
      console.error('Addon cockpit GLB failed to load:', error);
      this.cockpit.cockpitModelLoading = false;
      this.cockpit.cockpitModelFailed = true;
    });
    return true;
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
    this.cockpitMode = Boolean(isCockpit);
    this.cockpit.group.visible = this.cockpitMode;
    this.gltfGroup.visible = this.modelLoaded && (!this.cockpitMode || !this.descriptor.cockpit);
    this.proceduralGroup.visible = !this.modelLoaded && !this.cockpitMode;
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
