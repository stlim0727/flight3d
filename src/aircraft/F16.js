import * as THREE from 'three';
import { installInstrumentLighting } from './InstrumentLighting.js';
import { F16_FALCON } from '../config/aircraftConfigs.js';
import { tireContact } from './gearVisualContact.js';
import { getControlInput } from './common/ControlSurfaceRig.js';
import { clampGearExtension, calculateGearFold, isGearCollapsed, computeGearContactOffset } from './common/GearKinematicsRig.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JetExhaust } from '../effects/JetExhaust.js';
import { applyFlatShading, RENDER_QUALITY } from '../config/renderQuality.js';
import { CockpitHudCanvas, configureF16HudMesh } from './CockpitHudCanvas.js';
import { bindGltfControlSurfaces, updateGltfControlSurfaces } from './GltfControlSurfaces.js';
import { createMissileMesh, createPylonMesh, preloadMissileModels } from '../weapons/missileGeometry.js';
import { F16_MISSILE_STATIONS } from '../weapons/missileSpecs.js';
import { createPilotMesh, setPilotCockpitMode, updatePilotDynamics, F16_PILOT_OFFSET } from './pilotGeometry.js';

// The supplied asset is +X forward, with a 93.94-unit wingspan. Its authored
// hierarchy supplies the Z-up conversion; mount it in our metre/-Z-forward frame.
export const F16_SCALE = 9.96 / 93.93575286865234;
export const F16_CENTER_X = 25.935216903686523;

// The airframe is one merged mesh. Hinges are measured in f-16.glb airframe units
// (+X nose, +Y starboard, +Z down) and mapped to the mounted metre frame
// (+X starboard, +Y up, -Z nose), where installModel bakes the geometry.
const glbPoint = (x, y, z) => [y * F16_SCALE, -z * F16_SCALE, (F16_CENTER_X - x) * F16_SCALE];
const glbAxis = (x, y, z) => [y, -z, -x];
const glbPlane = (x, y, z, constant) => ({ x: y, y: -z, z: -x, constant: (x * F16_CENTER_X + constant) * F16_SCALE });
const deg = THREE.MathUtils.degToRad;

/** All-moving stabilators (pitch, differential roll), flaperons (roll, 20° flaps) and rudder. */
export function f16ControlSurfaceSpecs() {
  const specs = [];
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    // Each axis points starboard, so a positive angle lowers the trailing edge.
    specs.push(
      { name: `stabilator${side}`, boundaries: [glbPlane(0, sign, 0, -10.66), glbPlane(-1, 0, 0, -15)],
        origin: glbPoint(-34, sign * 10.66, 0.2), axis: glbAxis(0, 17.15, 3.6 * sign),
        deflection: state => -deg(20) * getControlInput(state, 'elevator') - deg(5) * sign * getControlInput(state, 'aileron') },
      { name: `flaperon${side}`, boundaries: [glbPlane(0, sign, 0, -13.64), glbPlane(0, -sign, 0, 34.75),
        glbPlane(-0.9873, -0.159 * sign, 0, 0.244), glbPlane(1, 0, 0, 12)],
        origin: glbPoint(-1.95, sign * 13.64, -0.52), axis: glbAxis(-3.4 * sign, 21.11, -0.4 * sign),
        deflection: state => THREE.MathUtils.clamp(
          deg(getControlInput(state, 'flapDegree', 0, 0, 20)) - deg(20) * sign * getControlInput(state, 'aileron'),
          -deg(23), deg(20)) }
    );
  }
  // The hinge axis points up, so a positive angle swings the trailing edge starboard.
  specs.push({ name: 'rudder', boundaries: [glbPlane(-0.8178, 0, 0.5758, -19.27), glbPlane(0, 0, -1, -11.6), glbPlane(0, 0, 1, 30.55)],
    origin: glbPoint(-31.62, 0, -11.45), axis: glbAxis(-13.4, 0, -19.03),
    deflection: state => deg(26) * getControlInput(state, 'rudder') });
  return specs;
}

/**
 * Authentic F-16 curved bubble canopy material with Indium Tin Oxide (ITO)
 * radar-reflective golden sheen and view-dependent Fresnel light reflections.
 */
export function createF16CanopyMaterial(isCockpit = false) {
  const material = new THREE.MeshPhysicalMaterial({
    name: 'F16-canopy-glass',
    color: new THREE.Color(0.95, 0.91, 0.80),
    transparent: true,
    opacity: isCockpit ? 0.06 : 0.22,
    roughness: 0.04,
    metalness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    ior: 1.54,
    envMapIntensity: isCockpit ? 0.45 : 1.2,
    forceSinglePass: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  material.userData.isF16Canopy = true;
  material.userData.cockpitUniform = { value: isCockpit ? 1 : 0 };

  material.onBeforeCompile = shader => {
    shader.uniforms.uCanopyCockpit = material.userData.cockpitUniform;
    shader.fragmentShader = 'uniform float uCanopyCockpit;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      #ifdef OPAQUE
      diffuseColor.a = 1.0;
      #endif
      #ifdef USE_TRANSMISSION
      diffuseColor.a *= material.transmissionAlpha;
      #endif

      // Ensure effective normal points toward viewing direction from both inside and outside
      vec3 effNormal = geometryNormal;
      if ( dot( effNormal, geometryViewDir ) < 0.0 ) {
        effNormal = -effNormal;
      }

      // Curved glass Fresnel reflection factor based on view angle and surface normal
      float vDotN = clamp( dot( effNormal, geometryViewDir ), 0.0, 1.0 );
      float fresnel = pow( 1.0 - vDotN, 2.0 );

      // Dynamic alpha: clear forward view, highly reflective at glancing angles along the curved bubble
      float baseAlpha = diffuseColor.a;
      float edgeAlpha = mix(0.55, 0.16, uCanopyCockpit);
      float canopyAlpha = mix(baseAlpha, edgeAlpha, fresnel);

      // Curved sky dome and horizon gradient reflection across the bubble canopy
      vec3 viewReflect = reflect( -geometryViewDir, effNormal );
      float skyGradient = smoothstep( -0.2, 0.5, viewReflect.y );
      vec3 ambientSkyReflection = mix( vec3( 0.40, 0.38, 0.32 ), vec3( 0.75, 0.88, 1.05 ), skyGradient );

      // Accumulate direct sun highlight, HDR sky reflection, and clearcoat sheen
      vec3 canopySpecular = totalSpecular + ambientSkyReflection * ( fresnel * 0.45 + 0.10 );

      // F-16 Indium Tin Oxide (ITO) subtle gold/amber sheen along reflection contours
      vec3 itoTint = mix( vec3( 1.0 ), vec3( 1.15, 1.02, 0.80 ), fresnel );
      canopySpecular *= itoTint;

      // Keep interior reflections subtle; inverse-alpha amplification obscures terrain.
      vec3 adjustedOutgoing = outgoingLight + canopySpecular * mix(0.35, 0.06, uCanopyCockpit);

      gl_FragColor = vec4( adjustedOutgoing, canopyAlpha );
      `
    );
  };

  return material;
}

/** Partition the authored, merged deployed gear into three movable legs. */
export function splitF16Gear(geometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const partitions = { nose: [], mainLeft: [], mainRight: [] };
  const positions = source.attributes.position;
  for (let i = 0; i < positions.count; i += 3) {
    const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
    const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
    partitions[z < -0.5 ? 'nose' : x < 0 ? 'mainLeft' : 'mainRight'].push(i, i + 1, i + 2);
  }
  const result = {};
  for (const [name, vertices] of Object.entries(partitions)) {
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const values = new attribute.array.constructor(vertices.length * attribute.itemSize);
      vertices.forEach((vertex, i) => {
        for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.array[vertex * attribute.itemSize + j];
      });
      part.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
    }
    part.computeBoundingBox();
    part.computeBoundingSphere();
    result[name] = part;
  }
  source.dispose();
  return result;
}

export class F16 {
  constructor(options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'Aircraft_F16';
    // AircraftBreakup traverses this hierarchy, including the cockpit and the
    // currently visible gear. Keep it below the world-pose root as on other GLBs.
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.name = 'GLTF_F16';
    this.group.add(this.gltfGroup);
    if (!options.noExhaust) {
      this.exhaust = new JetExhaust();
      this.group.add(this.exhaust.group);
    }
    this.lightsGroup = new THREE.Group();
    this.gltfGroup.add(this.lightsGroup);
    if (typeof window !== 'undefined') preloadMissileModels();
    // Pylons remain permanently attached to the airframe; when missiles are
    // fired or unloaded, the stations visibly remain as empty launcher pylons.
    this.pylonsGroup = new THREE.Group();
    this.pylonsGroup.name = 'F16_Pylons';
    this.gltfGroup.add(this.pylonsGroup);
    this.pylonMeshes = F16_MISSILE_STATIONS.map(station => {
      const pylon = createPylonMesh(station);
      pylon.position.set(...station.position);
      this.pylonsGroup.add(pylon);
      return pylon;
    });
    // Six rail stations keep their missiles resident; launch only toggles the
    // mesh until a preset reset re-arms every station.
    this.missilesGroup = new THREE.Group();
    this.missilesGroup.name = 'F16_Missiles';
    this.gltfGroup.add(this.missilesGroup);
    this.missileMeshes = F16_MISSILE_STATIONS.map(station => {
      const mesh = createMissileMesh(station.type);
      mesh.position.set(...station.position);
      this.missilesGroup.add(mesh);
      return mesh;
    });
    this.missileLoaded = F16_MISSILE_STATIONS.map(() => true);
    this.lightsOn = true;
    this.loadingGltf = true;
    this.modelLoaded = false;
    this.isCrashed = false;
    this.flatShading = false;
    this.gearLegs = {};
    this.gearExtension = 1;
    this.cockpit = {
      group: new THREE.Group(), gltfCockpitGroup: new THREE.Group(),
      cockpitModelFailed: false, cockpitModelLoading: true,
      yokesVisible: true, gltfYokes: [], syncLighting() {},
      toggleYokes() { return this.yokesVisible; },
    };
    // The cockpit stays in the complete airframe, so exterior views also show it.
    this.gltfGroup.add(this.cockpit.group);
    this.cockpit.group.add(this.cockpit.gltfCockpitGroup);
    this.pilotMesh = createPilotMesh('f16');
    this.pilotMesh.position.set(F16_PILOT_OFFSET.x, F16_PILOT_OFFSET.y, F16_PILOT_OFFSET.z);
    this.pilotMesh.userData.onSwap = () => {
      this.breakupVersion = (this.breakupVersion || 0) + 1;
    };
    this.cockpit.group.add(this.pilotMesh);
    this.hudCanvas = options.exteriorOnly
      ? null
      : (options.hudCanvas || new CockpitHudCanvas(512, 512, { variant: 'f16' }));
    this.hudMesh = null;
    if (!options.exteriorOnly) this.instrumentLight = installInstrumentLighting(this.cockpit, F16_FALCON.cockpit.captainEyePos, 0x91ffb5, () => !this.isCrashed);
    const airframePromise = new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL ?? '/'}models/f-16.glb`)
      .then(gltf => {
        this.installModel(gltf.scene);
        if (this.flatShading) {
          applyFlatShading(this.group, true);
        }
      })
      .catch(error => {
        this.cockpit.cockpitModelFailed = true;
        console.error('F-16 model failed to load:', error);
      });
    this.ready = Promise.all([airframePromise, this.pilotMesh.ready]).finally(() => {
      this.loadingGltf = false;
      this.cockpit.cockpitModelLoading = false;
    });
  }

  installModel(scene) {
    const mount = new THREE.Group();
    mount.rotation.y = Math.PI / 2;
    mount.scale.setScalar(F16_SCALE);
    mount.position.z = F16_CENTER_X * F16_SCALE;
    mount.add(scene);
    mount.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    for (const source of meshes) {
      const name = source.parent.name;
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      let material;
      if (name.startsWith('F-16-canopy_')) {
        material = createF16CanopyMaterial(this.isCockpit);
        this.canopyMaterial = material;
      } else {
        material = source.material.clone();
        if (material.transparent) {
          material.depthWrite = false;
          material.side = THREE.FrontSide;
          material.opacity = Math.min(material.opacity, 0.18);
        }
        if (material.name === 'F-16-hud') {
          material.transparent = true;
          material.opacity = 0.3;
          material.depthWrite = false;
        }
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = !material.transparent;
      if (name.startsWith('F-16-hud_') || material.name === 'F-16-hud') {
        this.hudMesh = mesh;
        if (this.hudCanvas) {
          configureF16HudMesh(mesh, this.hudCanvas);
        }
      }
      if (name.startsWith('F-16-canopy_')) {
        this.canopyMesh = mesh;
      }
      if (name.startsWith('F-16-landingOn_')) {
        this.installGear(mesh);
      } else if (name.startsWith('F-16-landingOff_')) {
        this.stowedGear = mesh;
        this.gltfGroup.add(mesh);
      } else if (name.startsWith('F-16-landingOnLight_')) {
        this.landingLight = mesh;
        this.lightsGroup.add(mesh);
      } else if (name.startsWith('F-16-cockpit_') || name.startsWith('F-16-hud_')) {
        this.cockpit.gltfCockpitGroup.add(mesh);
      } else {
        this.gltfGroup.add(mesh);
      }
    }
    this.controlSurfaces = bindGltfControlSurfaces(this.gltfGroup,
      { meshName: 'F-16-airframe_0', specifications: f16ControlSurfaceSpecs });
    this.modelLoaded = true;
    this.cockpit.onModelReady?.();
    this.update(0, { gearState: this.gearExtension });
  }

  installGear(mesh) {
    for (const [id, geometry] of Object.entries(splitF16Gear(mesh.geometry))) {
      const contact = tireContact(geometry);
      const bounds = geometry.boundingBox;
      const pivot = bounds.getCenter(new THREE.Vector3());
      pivot.y = bounds.max.y;
      const group = new THREE.Group();
      group.name = `F16_Gear_${id}`;
      group.position.copy(pivot);
      group.userData.pivotY = pivot.y;
      group.userData.tireContact = contact;
      geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      const leg = new THREE.Mesh(geometry, mesh.material);
      leg.castShadow = leg.receiveShadow = true;
      group.add(leg);
      this.gltfGroup.add(group);
      this.gearLegs[id] = group;
    }
    mesh.geometry.dispose();
  }

  update(dt, state = {}) {
    this.exhaust?.update(dt, state, this.isCrashed);
    updateGltfControlSurfaces(this.controlSurfaces, state);
    const extension = clampGearExtension(state.gearState, this.gearExtension);
    this.gearExtension = extension;
    const fold = calculateGearFold(extension);
    for (const [id, leg] of Object.entries(this.gearLegs)) {
      const contact = leg.userData.tireContact;
      leg.position.y = leg.userData.pivotY + extension * computeGearContactOffset(F16_FALCON.landingGear.contacts, state.compressions, contact);
      leg.visible = extension > 0.001 && !isGearCollapsed(state.gearDamage, id);
      if (id === 'nose') leg.rotation.x = -fold;
      else leg.rotation.z = (id === 'mainLeft' ? -1 : 1) * fold;
    }
    if (this.stowedGear) this.stowedGear.visible = extension < 0.999;
    if (this.landingLight) this.landingLight.visible = this.lightsOn && !this.isCrashed && extension > 0.95;
    updatePilotDynamics(this.pilotMesh, state, dt);
  }

  setCockpitMode(isCockpit, showInterior = true, renderQuality) {
    this.isCockpit = isCockpit;
    if (this.canopyMaterial) {
      this.canopyMaterial.side = THREE.DoubleSide;
      this.canopyMaterial.opacity = isCockpit ? 0.06 : 0.22;
      this.canopyMaterial.envMapIntensity = isCockpit ? 0.45 : 1.2;
      this.canopyMaterial.userData.cockpitUniform.value = isCockpit ? 1 : 0;
      const useSimpleCanopy = isCockpit && Boolean(RENDER_QUALITY[renderQuality]?.simpleF16Canopy);
      if (useSimpleCanopy && !this.simpleCanopyMaterial) {
        this.simpleCanopyMaterial = new THREE.MeshBasicMaterial({
          name: 'F16-simple-canopy-glass',
          color: this.canopyMaterial.color,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
          side: THREE.DoubleSide,
          forceSinglePass: true,
        });
      }
      if (useSimpleCanopy !== Boolean(this.usingSimpleCanopy)) {
        this.canopyMesh.material = useSimpleCanopy ? this.simpleCanopyMaterial : this.canopyMaterial;
        this.usingSimpleCanopy = useSimpleCanopy;
      }
    }
    if (this.cockpit && this.cockpit.group) {
      this.cockpit.group.visible = isCockpit ? showInterior : true;
    }
    setPilotCockpitMode(this.pilotMesh, isCockpit, showInterior);
  }
  triggerCrashVisuals() {
    this.isCrashed = true;
    this.lightsGroup.visible = false;
    this.missilesGroup.visible = false;
    if (this.exhaust) { this.exhaust.power = 0; this.exhaust.group.visible = false; }
  }
  resetCrashVisuals() {
    this.isCrashed = false;
    this.lightsGroup.visible = this.lightsOn;
    this.missilesGroup.visible = true;
    this.pylonsGroup.visible = true;
  }

  /** Rail state is shared with the guidance core: fired stations hide their mesh. */
  setMissileLoaded(index, loaded) {
    if (!this.missileMeshes?.[index]) return false;
    this.missileLoaded[index] = Boolean(loaded);
    this.missileMeshes[index].visible = this.missileLoaded[index];
    return true;
  }

  setMissileLoadout(loadout = []) {
    if (!Array.isArray(loadout)) return;
    for (let index = 0; index < this.missileMeshes?.length; index++) {
      this.setMissileLoaded(index, Boolean(loadout[index]));
    }
  }

  setFlatShading(flatShading) {
    this.flatShading = Boolean(flatShading);
    applyFlatShading(this.group, this.flatShading);
  }
}
