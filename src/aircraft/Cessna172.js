import * as THREE from 'three';
import { installInstrumentLighting } from './InstrumentLighting.js';
import { CESSNA_172 } from '../config/aircraftConfigs.js';
import { tireContact } from './gearVisualContact.js';
import { computeGearContactOffset } from './common/GearKinematicsRig.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { applyFlatShading } from '../config/renderQuality.js';
import { applyLogDepthOffset } from '../environment/RunwayMarkings.js';
import { createC172Pilot, setCivilPilotView } from './civilPilotGeometry.js';
import { updatePilotDynamics } from './pilotGeometry.js';

// Ground-handling assembly baked into c172.glb, which must never travel with the
// aircraft: tie-down straps, their metal spreader bars and cables, the chock bar,
// and the concrete pad. GLTFLoader passes every node name through
// PropertyBinding.sanitizeNodeName, which strips the dots from these raw names, so
// match against the sanitized form instead of the authored spelling.
export const GROUND_ARTIFACT_NODES = new Set([
  'Circle.002_32', // wing tie-down straps
  'Plane.022_20',  // tie-down cable
  'Plane.029_33',  // wing tie-down spreader bar
  'Plane.030_34',  // nose tie-down strap
  'Plane.031_35',  // tie-down strap and cable
  'Circle.005_49', // chock bar
  'Cube.010_50'    // concrete pad
].map(name => THREE.PropertyBinding.sanitizeNodeName(name)));

// Material markers the asset author uses for parking geometry.
export const GROUND_ARTIFACT_MATERIALS = ['Concrete', 'remove_before_flight'];

/**
 * Cessna 172 Skyhawk Single-Engine Aircraft
 *
 * High-wing general aviation aircraft with:
 * - High-wing airframe with diagonal lift struts and cambered wingtips
 * - Tricycle fixed landing gear with wheel pants / fairings
 * - Two-blade tractor propeller with dynamic spinning & RPM blur disk
 * - Articulated control surfaces: ailerons, flaps, elevator, rudder, and steerable nose gear
 * - Navigation, strobe, rotating beacon, and landing light systems
 * - PBR GLTF airframe and integrated 3D cockpit
 */
export class Cessna172 {
  constructor(pfdCanvas = null, ndCanvas = null, options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'Aircraft_Cessna172';

    this.pfdCanvas = pfdCanvas;
    this.ndCanvas = ndCanvas;

    // Model and mode states
    this.loadingGltf = false;
    this.modelLoaded = false;
    this.isCockpit = false;
    this.isCrashed = false;
    this.lightsOn = true;
    this.flatShading = false;

    // GLTF references
    this.gltfModel = null;
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.name = 'GLTF_Cessna172';
    this.gltfGroup.visible = false;
    this.group.add(this.gltfGroup);
    this.visualGear = [];
    this.gltfControlSurfaces = [];
    this.gltfPropellers = [];
    this.propAngle = 0;

    this.lightsGroup = new THREE.Group();
    this.group.add(this.lightsGroup);


    // Lighting elements
    this.strobeLights = [];
    this.beaconLight = null;
    this.beaconTimer = 0;
    this.strobeTimer = 0;

    // Cockpit interface for simulation & camera integration
    this.cockpit = {
      group: new THREE.Group(),
      yokesVisible: true,
      gltfYokes: [],
      cockpitModelFailed: true,
      gltfCockpitGroup: new THREE.Group(),
      syncLighting: () => {},
      toggleYokes: () => {
        this.cockpit.yokesVisible = !this.cockpit.yokesVisible;
        for (const y of this.cockpit.gltfYokes) {
          y.visible = this.cockpit.yokesVisible;
        }
        return this.cockpit.yokesVisible;
      },
      onModelReady: null
    };
    this.group.add(this.cockpit.group);
    // Left-seat pilot, visible through the cabin windows and from the cockpit camera.
    this.pilot = createC172Pilot();
    this.group.add(this.pilot);
    if (!options.exteriorOnly) this.instrumentLight = installInstrumentLighting(this.cockpit, CESSNA_172.cockpit.captainEyePos, 0xffb46b, () => !this.isCrashed);
    this.buildLights();

    // Attempt to load the GLB airframe.
    this.loadGltfModel(`${import.meta.env?.BASE_URL ?? '/'}models/c172.glb`);
  }

  buildLights() {
    // Left wingtip: Red nav light
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });
    const greenMat = new THREE.MeshBasicMaterial({ color: 0x11ff11 });
    const whiteLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const bulbGeo = new THREE.SphereGeometry(0.04, 8, 8);

    const navL = new THREE.Mesh(bulbGeo, redMat);
    navL.position.set(-5.55, 0.92, -0.25);
    this.lightsGroup.add(navL);

    // Right wingtip: Green nav light
    const navR = new THREE.Mesh(bulbGeo, greenMat);
    navR.position.set(5.55, 0.92, -0.25);
    this.lightsGroup.add(navR);

    // Tail: White position light
    const navTail = new THREE.Mesh(bulbGeo, whiteLightMat);
    navTail.position.set(0, 0.52, 4.3);
    this.lightsGroup.add(navTail);

    // Wingtip Strobes
    const strobeL = new THREE.Mesh(bulbGeo, whiteLightMat);
    strobeL.position.set(-5.55, 0.92, -0.15);
    strobeL.visible = false;
    this.lightsGroup.add(strobeL);
    this.strobeLights.push(strobeL);

    const strobeR = new THREE.Mesh(bulbGeo, whiteLightMat);
    strobeR.position.set(5.55, 0.92, -0.15);
    strobeR.visible = false;
    this.lightsGroup.add(strobeR);
    this.strobeLights.push(strobeR);

    // Vertical Fin Top: Red Rotating Beacon
    this.beaconLight = new THREE.Mesh(bulbGeo, redMat);
    this.beaconLight.position.set(0, 2.0, 3.7);
    this.lightsGroup.add(this.beaconLight);
  }

  loadGltfModel(url = `${import.meta.env?.BASE_URL ?? '/'}models/c172.glb`) {
    this.ready = Promise.resolve();
    if (typeof window === 'undefined') return;
    let settle;
    this.ready = new Promise(resolve => { settle = resolve; });
    this.loadingGltf = true;

    try {
      const dracoLoader = new DRACOLoader();
      this.ready.then(() => dracoLoader.dispose());
      dracoLoader.setDecoderPath(`${import.meta.env?.BASE_URL ?? '/'}draco/gltf/`);

      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);

      loader.load(
        url,
        gltf => {
          this.gltfModel = gltf.scene;
          this.gltfModel.name = 'C172_Airframe_GLTF';

          // Calibrated alignment transform:
          // Raw model: Wingspan 3.68942m, Forward +Z, Height 0.90m
          // Flight3D: Wingspan 11.0m, Forward -Z, Height 2.7m
          // Shift in Y and Z to align tricycle landing gear with runway contact baseline & CG
          this.gltfModel.scale.setScalar(2.9815);
          this.gltfModel.rotation.y = Math.PI;
          this.gltfModel.position.set(0, -1.05, 0.45);

          this.gltfPropellers = [];
          this.gltfYokes = [];

          this.gltfModel.traverse(node => {
            if (node.isMesh) {
              const mat = node.material;
              const matName = Array.isArray(mat) ? mat.map(m => m.name).join(' ') : (mat?.name || '');
              const isWindow = matName.includes('Window') ||
                node.name.toLowerCase().includes('window') ||
                (mat && (mat.transparent || mat.opacity < 0.95));

              // Weaken the authored smoked-glass tint so cabin windows read as clear glass
              for (const windowMat of (Array.isArray(mat) ? mat : [mat])) {
                if (windowMat?.name === 'Window') {
                  windowMat.color.setRGB(0.2, 0.22, 0.25);
                  windowMat.opacity = 0.15;
                }
              }

              // Transparent cockpit and cabin windows must not cast shadows into the cockpit,
              // or they block sunlight from illuminating the instrument panel and deck through the glass.
              node.castShadow = !isWindow;
              node.receiveShadow = !isWindow;

              // Occlude static ground parking / mooring artifacts
              if (GROUND_ARTIFACT_MATERIALS.some(marker => matName.includes(marker))) {
                node.visible = false;
              }
            }

            // Hide the ground mooring assembly that shares the airframe hierarchy
            if (GROUND_ARTIFACT_NODES.has(node.name)) {
              node.visible = false;
            }

            // Bind propeller components (spinner and blades)
            if (node.name === 'Plane_16' || node.name === 'Plane.011_13') {
              node.userData.initialRotZ = node.rotation.z;
              this.gltfPropellers.push(node);
            }
          });

          if (this.flatShading) {
            applyFlatShading(this.gltfModel, true);
          }

          this.cockpit.gltfYokes = [];
          this.cockpit.cockpitModelFailed = false;
          this.cockpit.gltfCockpitGroup = this.gltfModel;

          // Mount live real-time flight displays onto the Garmin G1000 instrument panel
          if (this.pfdCanvas && this.ndCanvas) {
            const createDisplayMat = (canvas) => applyLogDepthOffset(new THREE.MeshBasicMaterial({
              map: canvas.texture,
              toneMapped: false,
              polygonOffset: true,
              polygonOffsetFactor: -1.0,
              polygonOffsetUnits: -2.0
            }), 1);

            const screenGeo = new THREE.PlaneGeometry(0.23, 0.155);
            const mipY = 0.420;
            const mipZ = -1.810;

            // Left Garmin G1000 PFD (Primary Flight Display)
            const pfdMesh = new THREE.Mesh(screenGeo, createDisplayMat(this.pfdCanvas));
            pfdMesh.name = 'C172_Live_PFD';
            pfdMesh.position.set(-0.177, mipY, mipZ);
            this.cockpit.group.add(pfdMesh);

            // Right Garmin G1000 MFD (Multi-Function Display / Navigation)
            const ndMesh = new THREE.Mesh(screenGeo.clone(), createDisplayMat(this.ndCanvas));
            ndMesh.name = 'C172_Live_MFD';
            ndMesh.position.set(0.106, mipY, mipZ);
            this.cockpit.group.add(ndMesh);
          }

          this.gltfGroup.add(this.gltfModel);
          this.installVisualGear();
          this.modelLoaded = true;
          this.loadingGltf = false;
          this.gltfGroup.visible = true;

          if (typeof this.cockpit.onModelReady === 'function') {
            this.cockpit.onModelReady();
          }
          settle();
        },
        undefined,
        err => {
          console.error('C172 GLB model failed to load:', err);
          this.loadingGltf = false;
          this.modelLoaded = false;
          this.cockpit.cockpitModelFailed = true;
          this.gltfGroup.visible = false;
          settle();
        }
      );
    } catch (err) {
      console.error('C172 GLB loader initialization failed:', err);
      this.loadingGltf = false;
      this.modelLoaded = false;
      this.cockpit.cockpitModelFailed = true;
      this.gltfGroup.visible = false;
      settle();
    }
  }

  installVisualGear() {
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    const assemblies = {
      main: ['Object_15', 'Object_17', 'Object_19', 'Object_20'],
      nose: ['Object_22', 'Object_24', 'Object_109', 'Object_110', 'Object_118'],
    };
    for (const [kind, names] of Object.entries(assemblies)) {
      const parts = { nose: [], mainLeft: [], mainRight: [] };
      for (const name of names) {
        const source = this.gltfModel.getObjectByName(name);
        if (!source) continue;
        const geometry = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone();
        geometry.applyMatrix4(inverse.clone().multiply(source.matrixWorld));
        const positions = geometry.attributes.position;
        for (const id of kind === 'nose' ? ['nose'] : ['mainLeft', 'mainRight']) {
          const indices = [];
          for (let i = 0; i < positions.count; i += 3) {
            const x = positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2);
            if (kind === 'nose' || (x < 0) === (id === 'mainLeft')) indices.push(i, i + 1, i + 2);
          }
          const part = geometry.clone();
          part.setIndex(indices);
          // Remove unused vertices so tire bounds describe this leg alone.
          const mesh = new THREE.Mesh(part.toNonIndexed(), source.material);
          part.dispose();
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.flexible = ['Object_15', 'Object_24', 'Object_118'].includes(name);
          mesh.userData.tire = source.material.name === 'Tyre';
          parts[id].push(mesh);
        }
        geometry.dispose();
        source.visible = false;
      }
      for (const meshes of Object.values(parts)) {
        const tire = meshes.find(m => m.userData.tire);
        if (!tire) continue;
        const contact = tireContact(tire.geometry);
        for (const mesh of meshes) {
          if (mesh.userData.flexible) {
            mesh.geometry.computeBoundingBox();
            mesh.userData.rest = mesh.geometry.attributes.position.array.slice();
          }
          this.gltfGroup.add(mesh);
        }
        this.visualGear.push({ contact, meshes, offset: null });
      }
    }
    this.updateVisualGear({});
  }

  updateVisualGear(compressions) {
    for (const gear of this.visualGear) {
      const { contact, meshes } = gear;
      const offset = computeGearContactOffset(CESSNA_172.landingGear.contacts, compressions, contact);
      if (gear.offset === offset) continue;
      gear.offset = offset;
      for (const mesh of meshes) {
        const rest = mesh.userData.rest;
        if (!rest) { mesh.position.y = offset; continue; }
        const p = mesh.geometry.attributes.position;
        const top = mesh.geometry.boundingBox.max.y;
        const bottom = mesh.geometry.boundingBox.min.y;
        for (let i = 0; i < p.count; i++) {
          p.setY(i, rest[i * 3 + 1] + offset * (top - rest[i * 3 + 1]) / (top - bottom));
        }
        p.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
    }
  }

  update(dt, flightState = {}) {
    if (this.isCrashed) return;

    this.updateVisualGear(flightState.compressions);
    updatePilotDynamics(this.pilot, flightState, dt);

    const n1 = flightState.engine1?.n1 ?? flightState.engine1N1 ?? 25.0; // Piston engine RPM indicator

    // 1. Propeller Rotation
    // Idle (~650 RPM) to TOGA (~2700 RPM) -> angular speed ~68 to 282 rad/s
    const rpmFraction = Math.max(0.2, n1 / 100.0);
    const angularSpeed = 70.0 + rpmFraction * 200.0;
    this.propAngle += angularSpeed * dt;

    for (const prop of this.gltfPropellers) {
      prop.rotation.z = (prop.userData.initialRotZ ?? 0) + this.propAngle;
    }

    // 2. Flashing Beacon & Strobes
    this.beaconTimer += dt;
    if (this.beaconLight) {
      // 1.2 Hz beacon flash
      this.beaconLight.visible = this.lightsOn && (Math.sin(this.beaconTimer * 7.5) > 0.3);
    }

    this.strobeTimer += dt;
    const strobeActive = this.lightsOn && ((this.strobeTimer % 1.0) < 0.08 || ((this.strobeTimer % 1.0) > 0.16 && (this.strobeTimer % 1.0) < 0.24));
    for (const strobe of this.strobeLights) {
      strobe.visible = strobeActive;
    }
  }

  setCockpitMode(isCockpit, showInterior = true) {
    this.isCockpit = isCockpit;
    // The unified GLB contains both the exterior and the 3D cockpit.
    this.gltfGroup.visible = true;
    if (this.cockpit && this.cockpit.group) {
      // C172 has a dedicated 3D cockpit only (no 2D photo overlay), so keep cockpit group
      // and live instrument displays visible in cockpit mode.
      this.cockpit.group.visible = isCockpit;
    }
    setCivilPilotView(this.pilot, isCockpit, true);
  }

  triggerCrashVisuals(collisionType) {
    this.isCrashed = true;
    if (this.lightsGroup) this.lightsGroup.visible = false;
  }

  resetCrashVisuals() {
    this.isCrashed = false;
    if (this.lightsGroup) this.lightsGroup.visible = this.lightsOn;
    if (this.gltfGroup) {
      this.gltfGroup.visible = this.modelLoaded;
    }
  }

  setFlatShading(flatShading) {
    this.flatShading = Boolean(flatShading);
    applyFlatShading(this.group, this.flatShading);
  }
}
