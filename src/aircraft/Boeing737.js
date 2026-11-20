import * as THREE from 'three';
import { cutGearBays } from './gearGeometry.js';
import { Cockpit } from './Cockpit.js';
import { excludeFromDeckShadow } from './CockpitLighting.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindGltfControlSurfaces, updateGltfControlSurfaces } from './GltfControlSurfaces.js';
import { applyKoreanAirLivery } from './KoreanAirLivery.js';
import { applyJejuAirLivery } from './JejuAirLivery.js';
import { applyFlatShading } from '../config/renderQuality.js';
import { CockpitHudCanvas, createB737HudCombiner } from './CockpitHudCanvas.js';
import { clampGearExtension, calculateGearFold, isGearCollapsed } from './common/GearKinematicsRig.js';

/**
 * Boeing 737-800 Airliner 3D Model
 * High-detail airliner with swept wings, blended winglets, twin turbofans with spinning fan blades,
 * fully articulated control surfaces (ailerons, flaps, spoilers, elevators, rudder),
 * retractable tricycle landing gear with doors, and complete navigation/strobe/landing light system.
 */
export class Boeing737 {
  constructor(pfdCanvas, ndCanvas, eicasCanvas, mcpCanvas = null, isfdCanvas = null, cduCanvas = null, options = {}) {
    this.group = new THREE.Group();
    this.livery = options.livery ?? 'jeju';
    this.exteriorOnly = options.exteriorOnly === true;

    // Internal cockpit
    this.cockpit = null;
    this.hudCanvas = null;
    this.hudCombiner = null;
    if (!this.exteriorOnly) {
      this.cockpit = new Cockpit(pfdCanvas, ndCanvas, eicasCanvas, mcpCanvas, isfdCanvas, cduCanvas);
      this.hudCanvas = options.hudCanvas || new CockpitHudCanvas(512, 512, { variant: 'b738' });
      this.hudCombiner = createB737HudCombiner(this.hudCanvas);
      this.cockpit.hudCombiner = this.hudCombiner;
      this.cockpit.group.add(this.hudCombiner);
      this.group.add(this.cockpit.group);
      const prevOnModelReady = this.cockpit.onModelReady;
      this.cockpit.onModelReady = () => {
        prevOnModelReady?.();
        if (this.flatShading) applyFlatShading(this.cockpit.group, true);
      };
    }

    // GLTF PBR High-Detail Model references
    this.gltfModel = null;
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.name = 'GLTF_Boeing737';
    this.gltfGroup.visible = false;
    this.group.add(this.gltfGroup);
    this.gltfFans = [];
    this.gltfFanL = null;
    this.gltfFanR = null;
    this.gltfControlSurfaces = [];
    this.loadingGltf = false;
    this.modelLoaded = false;
    this.isCockpit = false;
    this.flatShading = false;
    this.gltfShadowProxy = null;
    this.gearGroup = null;

    // Landing Gear meshes
    this.noseGearGroup = null;
    this.mainGearLGroup = null;
    this.mainGearRGroup = null;
    this.noseTruck = null;
    this.mainTruckL = null;
    this.mainTruckR = null;
    this.gearDoors = [];
    this.gearScissors = [];

    // Lighting
    this.navLights = [];
    this.strobeLights = [];
    this.beaconLights = [];
    this.landingLights = [];
    this.lightsOn = true;

    this.initAircraft();
  }

  initAircraft() {
    // Procedural gear and lights are intrinsic to the loaded airframe.
    this.buildLandingGear();
    this.buildLights();

    // Asynchronous high-detail GLTF PBR model loading.
    this.loadGltfModel(`${import.meta.env?.BASE_URL ?? '/'}models/b737-800.glb`);
  }


  buildLandingGear() {
    const noseY = -1.75;
    const noseLength = -3.27 - noseY;
    const noseMinZ = -14.55;
    const noseMaxZ = -11.95;
    const noseCenterZ = (noseMinZ + noseMaxZ) / 2;
    // Keep deployed hubs at +/-3.2, -3.3 while placing stowed wheels
    // beneath the center belly, with their outer faces exposed (no wheel doors).
    this.mainMountX = 2.85;
    this.mainMountY = -1.12;
    this.mainStowedY = -1.72;
    const mainDrop = 3.30 + this.mainMountY;
    const mainRake = 3.20 - this.mainMountX;
    this.mainLegLength = Math.hypot(mainDrop, mainRake);
    this.mainDeployAngle = Math.atan2(mainRake, mainDrop);
    this.mainStowAngle = Math.acos((this.mainMountY - this.mainStowedY) / this.mainLegLength);
    this.mainStowedX = this.mainMountX - this.mainLegLength * Math.sin(this.mainStowAngle);
    this.gearGroup = new THREE.Group();
    this.gearGroup.name = 'LandingGear';
    this.gearDoors = [];
    this.gearBayVolumes = [
      new THREE.Box3(new THREE.Vector3(-0.54, -4, noseMinZ), new THREE.Vector3(0.54, -1.30, noseMaxZ))
    ];
    for (const side of [-1, 1]) {
      const cx = side * this.mainStowedX, radius = 0.58, top = this.mainStowedY + 0.60;
      const pocket = new THREE.Box3(new THREE.Vector3(cx - radius, -4, 1.8 - radius), new THREE.Vector3(cx + radius, top, 1.8 + radius));
      // Convex polygonal cylinder: a round opening in the original belly skin.
      pocket.clipPlanes = [[0, 1, 0, -4], [0, -1, 0, -top]];
      for (let i = 0; i < 32; i++) {
        const angle = i / 32 * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
        pocket.clipPlanes.push([-x, 0, -z, -radius - x * cx - z * 1.8]);
      }
      this.gearBayVolumes.push(pocket);

    }
    this.gearScissors = [];

    const strutMat = new THREE.MeshStandardMaterial({ color: 0x88929e, metalness: 0.8, roughness: 0.3 });
    const chromePistonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95, roughness: 0.1 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9, metalness: 0.1 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.7, roughness: 0.3 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xc8d1dc, roughness: 0.28, metalness: 0.18, side: THREE.DoubleSide });
    const brakeMat = new THREE.MeshStandardMaterial({ color: 0x2b2e34, metalness: 0.85, roughness: 0.5 });

    const makeWheel = (radius, width) => {
      const wheel = new THREE.Group();
      const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 16);
      tireGeo.rotateZ(Math.PI * 0.5);
      const tire = new THREE.Mesh(tireGeo, tireMat);

      const rimGeo = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.02, 16);
      rimGeo.rotateZ(Math.PI * 0.5);
      const rim = new THREE.Mesh(rimGeo, rimMat);

      wheel.add(tire, rim);
      return wheel;
    };

    const makeScissorsPair = (length, width, parentGroup, rootY, truckRef) => {
      const linkGeo = new THREE.BoxGeometry(width, length, 0.04);
      const upperPivot = new THREE.Group();
      upperPivot.position.set(0, rootY, 0.12);
      const upperMesh = new THREE.Mesh(linkGeo, strutMat);
      upperMesh.position.y = -length * 0.5;
      upperPivot.add(upperMesh);

      const lowerPivot = new THREE.Group();
      lowerPivot.position.set(0, rootY - length, 0.12);
      const lowerMesh = new THREE.Mesh(linkGeo, strutMat);
      lowerMesh.position.y = length * 0.5;
      lowerPivot.add(lowerMesh);

      parentGroup.add(upperPivot, lowerPivot);
      this.gearScissors.push({ truck: truckRef, upper: upperPivot, lower: lowerPivot });
    };

    // 1. Nose mount sits inside the belly; hub stays at the physics datum.
    this.noseGearGroup = new THREE.Group();
    this.noseGearGroup.position.set(0, noseY, -12.5);
    const noseRatio = -noseLength / 2.42;

    // Outer stationary strut housing cylinder
    const nStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5 * noseRatio, 12), strutMat);
    nStrut.position.y = -0.75 * noseRatio;
    this.noseGearGroup.add(nStrut);

    // Movable Nose Truck (Sliding oleo chrome piston + dual wheels)
    this.noseTruck = new THREE.Group();
    const nPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.5 * noseRatio, 12), chromePistonMat);
    nPiston.position.y = -1.65 * noseRatio;
    this.noseTruck.add(nPiston);

    // Dual Nose Wheels
    const nWheelL = makeWheel(0.38, 0.22);
    nWheelL.position.set(-0.24, noseLength, 0);
    const nWheelR = makeWheel(0.38, 0.22);
    nWheelR.position.set(0.24, noseLength, 0);
    this.noseTruck.add(nWheelL, nWheelR);

    // Nose Scissors
    makeScissorsPair(0.22, 0.06, this.noseTruck, -0.90, this.noseTruck);

    this.noseGearGroup.add(this.noseTruck);

    // Bay doors hinge on the airframe, independently of the folding leg.
    const nDoorGeo = new THREE.BoxGeometry(0.54, 0.035, noseMaxZ - noseMinZ);
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * 0.54, -2.18, noseCenterZ);
      const panel = new THREE.Mesh(nDoorGeo, doorMat);
      panel.position.x = -side * 0.27;
      hinge.add(panel); this.gearGroup.add(hinge);
      this.gearDoors.push({ obj: hinge, axis: 'z', side, maxAngle: Math.PI * 0.48 });
    }

    // 2. Raked main legs fold inward. A separate axle swivel keeps the
    // deployed wheels upright and the stowed outer tire face parallel to the belly.
    const makeMainBogie = side => {
      const mainGear = new THREE.Group();
      mainGear.position.set(side * this.mainMountX, this.mainMountY, 0);
      mainGear.rotation.z = side * this.mainDeployAngle;
      const length = this.mainLegLength;
      const direction = new THREE.Vector3(0, -length, 1.8);
      const makeLegTube = (radius, fraction, center, material) => {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length() * fraction, 12), material);
        tube.position.copy(direction).multiplyScalar(center);
        tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
        return tube;
      };
      const housing = makeLegTube(0.14, 0.62, 0.31, strutMat);
      mainGear.add(housing);
      const truck = new THREE.Group();
      const piston = makeLegTube(0.10, 0.58, 0.71, chromePistonMat); truck.add(piston);
      truck.userData.housing = housing; truck.userData.piston = piston;
      truck.userData.suspensionAxis = new THREE.Vector3();
      const axle = new THREE.Group(); axle.position.set(0, -length, 1.8);
      axle.rotation.z = -side * this.mainDeployAngle;
      const wheels = [-0.35, 0.35].map(x => {
        const wheel = makeWheel(0.48, 0.32); wheel.position.x = x; axle.add(wheel); return wheel;
      });
      for (const x of [-0.18, 0.18]) {
        const brakeGeometry = new THREE.CylinderGeometry(0.30, 0.30, 0.08, 12); brakeGeometry.rotateZ(Math.PI / 2);
        const brake = new THREE.Mesh(brakeGeometry, brakeMat); brake.position.x = x; axle.add(brake);
      }
      truck.add(axle); truck.userData.axle = axle; truck.userData.wheels = wheels;
      const scissors = new THREE.Group(); truck.add(scissors); truck.userData.scissors = scissors;
      makeScissorsPair(0.22, 0.08, scissors, 0, truck);
      mainGear.add(truck);
      return { root: mainGear, truck };
    };
    const mainL = makeMainBogie(-1), mainR = makeMainBogie(1);
    this.mainGearLGroup = mainL.root; this.mainTruckL = mainL.truck;
    this.mainGearRGroup = mainR.root; this.mainTruckR = mainR.truck;
    this.updateMainGearSuspension(this.mainTruckL, -1, 0);
    this.updateMainGearSuspension(this.mainTruckR, 1, 0);

    const bayMat = new THREE.MeshStandardMaterial({ color: 0x303b42, roughness: 0.85, side: THREE.DoubleSide });
    this.gearBayGroup = new THREE.Group();
    this.gearBayGroup.name = 'FixedGearBays';
    this.noseBayWalls = [];
    for (const [index, volume] of this.gearBayVolumes.slice(0, 1).entries()) {
      const bottom = index === 0 ? -2.15 : -2.45;
      const width = volume.max.x - volume.min.x, depth = volume.max.z - volume.min.z;
      const height = volume.max.y - bottom;
      const cx = (volume.min.x + volume.max.x) / 2, cz = (volume.min.z + volume.max.z) / 2;
      const addWall = (size, at) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...size), bayMat);
        wall.position.set(...at); wall.castShadow = true; wall.receiveShadow = true;
        this.gearBayGroup.add(wall);
        if (index === 0 && size[1] > 0.1) this.noseBayWalls.push(wall);
      };
      if (index === 0) {
        addWall([width, 0.035, depth], [cx, volume.max.y + 0.02, cz]);
        for (const side of [-1, 1]) {
          addWall([0.035, height, depth], [cx + side * width / 2, bottom + height / 2, cz]);
          addWall([width, height, 0.035], [cx, bottom + height / 2, cz + side * depth / 2]);
        }
      }
    }
    this.gearGroup.add(this.gearBayGroup);
    this.gearGroup.add(this.noseGearGroup, this.mainGearLGroup, this.mainGearRGroup);
    this.group.add(this.gearGroup);
    this.gearGroup.traverse(mesh => {
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
  }

  updateMainGearSuspension(truck, side, compression) {
    // Preserve the vertical physics contact displacement, then articulate both
    // rigid tubes along the line from the fixed mount to the displaced axle.
    // Translating the raked piston alone would pull it sideways out of its housing.
    truck.position.set(side * Math.sin(this.mainDeployAngle) * compression, Math.cos(this.mainDeployAngle) * compression, 0);
    const { axle, housing, piston, suspensionAxis: axis, scissors } = truck.userData;
    axis.copy(truck.position).add(axle.position).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    housing.quaternion.setFromUnitVectors(up, axis);
    housing.position.copy(axis).multiplyScalar(housing.geometry.parameters.height / 2);
    piston.quaternion.copy(housing.quaternion);
    piston.position.copy(axle.position).addScaledVector(axis, -piston.geometry.parameters.height / 2);
    scissors.position.copy(axle.position).addScaledVector(axis, -this.mainLegLength * 0.4);
    scissors.quaternion.setFromUnitVectors(up, axis.clone().negate());
  }

  fitMainBaysToSkin(exterior) {
    // Recess liners stay entirely inside the sampled airframe skin. There is
    // no added exterior pod, wheel cover, or panel across either tire opening.
    this.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), origin = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0).transformDirection(this.group.matrixWorld);
    const material = new THREE.MeshStandardMaterial({ color: 0x242a2c, roughness: 0.9, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const cx = side * this.mainStowedX, radius = 0.58, ceiling = this.mainStowedY + 0.60;
      const vertices = [], indices = [];
      for (let i = 0; i <= 64; i++) {
        const angle = i / 64 * Math.PI * 2;
        const x = cx + radius * Math.cos(angle), z = 1.8 + radius * Math.sin(angle);
        origin.set(x, -10, z).applyMatrix4(this.group.matrixWorld); ray.set(origin, up);
        const hit = ray.intersectObject(exterior, true)[0];
        const bottom = hit ? this.group.worldToLocal(hit.point.clone()).y + 0.025 : this.mainMountY - 0.48;
        vertices.push(x, bottom, z, x, ceiling, z);
        if (i < 64) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 2, j + 1, j + 3); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      const liner = new THREE.Mesh(geometry, material); liner.receiveShadow = true; this.gearBayGroup.add(liner);
      const roof = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), material);
      roof.rotation.x = Math.PI / 2; roof.position.set(cx, ceiling, 1.8); this.gearBayGroup.add(roof);
    }
  }

  buildLights() {
    this.lightsGroup = new THREE.Group();

    // Left Wingtip Navigation Light (Steady RED)
    const navL = new THREE.PointLight(0xff0000, 1.5, 8);
    navL.position.set(-18.6, 1.2, 0.6);

    // Right Wingtip Navigation Light (Steady GREEN)
    const navR = new THREE.PointLight(0x00ff00, 1.5, 8);
    navR.position.set(18.6, 1.2, 0.6);

    // Tail Position Light (Steady WHITE)
    const navTail = new THREE.PointLight(0xffffff, 1.5, 8);
    navTail.position.set(0, 1.2, 19.4);

    this.navLights.push(navL, navR, navTail);
    this.lightsGroup.add(navL, navR, navTail);

    // Wingtip Flashing Strobes (High intensity white)
    const strobeL = new THREE.PointLight(0xffffff, 4.0, 15);
    strobeL.position.set(-18.7, 1.3, 0.5);
    const strobeR = new THREE.PointLight(0xffffff, 4.0, 15);
    strobeR.position.set(18.7, 1.3, 0.5);
    const strobeTail = new THREE.PointLight(0xffffff, 4.0, 15);
    strobeTail.position.set(0, 7.8, 17.0);

    this.strobeLights.push(strobeL, strobeR, strobeTail);
    this.lightsGroup.add(strobeL, strobeR, strobeTail);

    // Red Anti-Collision Beacons (Top and bottom of fuselage)
    const beaconTop = new THREE.PointLight(0xff0000, 3.5, 12);
    beaconTop.position.set(0, 2.05, 1.2);
    const beaconBottom = new THREE.PointLight(0xff0000, 3.5, 12);
    beaconBottom.position.set(0, -1.95, -2.0);

    this.beaconLights.push(beaconTop, beaconBottom);
    this.lightsGroup.add(beaconTop, beaconBottom);

    // High Intensity Landing Light Spotlights (illuminates runway ahead!)
    const makeLandingSpot = (xPos) => {
      const spot = new THREE.SpotLight(0xfff5e6, 4.5, 450, Math.PI * 0.18, 0.45, 1.2);
      spot.position.set(xPos, -0.6, -5.0);
      spot.target.position.set(xPos, -5.0, -120.0);
      this.lightsGroup.add(spot.target);
      return spot;
    };

    const landL = makeLandingSpot(-3.8);
    const landR = makeLandingSpot(3.8);
    this.landingLights.push(landL, landR);
    this.lightsGroup.add(landL, landR);

    this.scopeAirframeLamps();
    this.group.add(this.lightsGroup);
  }

  /**
   * Three compiles every visible punctual light into the light loop of every
   * material. Wingtip navigation and strobe lamps only ever shine on the
   * airframe skin, which the pilot seat does not render and which sits outside
   * the cockpit view, so they cost the whole loop and shade nothing.
   */
  scopeAirframeLamps() {
    for (const light of [...this.navLights, ...this.strobeLights]) light.visible = !this.isCockpit;
  }

  /**
   * Update visual aircraft state and animations
   */
  update(dt, flightState) {
    // 1. Turbofan Fan Blade Rotation tied to Engine N1 RPM
    const n1Left = flightState.engine1?.n1 ?? flightState.engineN1 ?? 22;
    const n1Right = flightState.engine2?.n1 ?? flightState.engineN1 ?? 22;

    const rotSpeedL = (n1Left / 100.0) * 85.0 * dt;
    const rotSpeedR = (n1Right / 100.0) * 85.0 * dt;

    // GLTF turbine fans (X-axis rotation in GLTF engine coordinate frame)
    if (this.gltfFanL) this.gltfFanL.rotation.x += rotSpeedL;
    if (this.gltfFanR) this.gltfFanR.rotation.x += rotSpeedR;
    else if (this.gltfFans && this.gltfFans.length > 0) {
      this.gltfFans.forEach(fan => {
        fan.rotation.x += rotSpeedL;
      });
    }

    // 2. Control Surface Deflections
    updateGltfControlSurfaces(this.gltfControlSurfaces, flightState);

    // 3. Landing Gear Retraction & Dynamic Suspension Compression Animation
    const extension = clampGearExtension(flightState.gearState);
    // Hold doors open before moving rigid legs. This mapping is reversible:
    // changing direction in transit retraces the same clearance-safe path.
    const legExtension = THREE.MathUtils.smoothstep(extension, 0.18, 0.88);
    const fold = calculateGearFold(legExtension);
    if (this.noseGearGroup) this.noseGearGroup.rotation.x = fold;
    for (const [leg, truck, side] of [[this.mainGearLGroup, this.mainTruckL, -1], [this.mainGearRGroup, this.mainTruckR, 1]]) {
      if (!leg) continue;
      leg.rotation.z = side * (this.mainDeployAngle * legExtension - this.mainStowAngle * (1 - legExtension));
      truck.userData.axle.rotation.z = -side * Math.PI / 2 * (1 - legExtension) - leg.rotation.z;
    }
    // Failed legs hinge independently; keep the existing rigid wheel/strut geometry.
    const damage = flightState.gearDamage || {};
    for (const [id, group, axis, sign] of [
      ['nose', this.noseGearGroup, 'x', 1],
      ['mainLeft', this.mainGearLGroup, 'z', -1],
      ['mainRight', this.mainGearRGroup, 'z', 1],
    ]) {
      if (!group || !damage[id] || damage[id] === 'normal') continue;
      group.rotation[axis] += sign * (isGearCollapsed(damage, id) ? 1.1 : 0.15);
    }
    const doorOpen = THREE.MathUtils.smoothstep(extension, 0, 0.18);
    for (const item of this.gearDoors) item.obj.rotation[item.axis] = item.side * doorOpen * item.maxAngle;

    // Dynamic Oleo Strut Suspension Squat ("털썩" 하중 압축)
    if (extension > 0.8 && flightState.compressions) {
      const compNose = Math.min(0.9, Math.max(0, flightState.compressions.nose || 0));
      const compL = Math.min(0.9, Math.max(0, flightState.compressions.mainLeft || 0));
      const compR = Math.min(0.9, Math.max(0, flightState.compressions.mainRight || 0));

      if (this.noseTruck) this.noseTruck.position.y = compNose;
      if (this.mainTruckL) this.updateMainGearSuspension(this.mainTruckL, -1, compL);
      if (this.mainTruckR) this.updateMainGearSuspension(this.mainTruckR, 1, compR);
    } else {
      if (this.noseTruck) this.noseTruck.position.y = 0;
      if (this.mainTruckL) this.updateMainGearSuspension(this.mainTruckL, -1, 0);
      if (this.mainTruckR) this.updateMainGearSuspension(this.mainTruckR, 1, 0);
    }

    // Dynamic Scissors torque link folding
    if (this.gearScissors && this.gearScissors.length > 0) {
      for (const item of this.gearScissors) {
        const comp = item.truck ? (item.truck.position.y || 0) : 0;
        if (item.upper) item.upper.rotation.x = (-comp * 0.7) || 0;
        if (item.lower) item.lower.rotation.x = (comp * 0.7) || 0;
      }
    }

    // 4. Strobe & Beacon Flashing Animation
    const now = performance.now() * 0.001;
    // Strobe flashes every 1.2 seconds with double pulse
    const strobePhase = (now % 1.2);
    const strobeActive = (strobePhase < 0.08) || (strobePhase > 0.16 && strobePhase < 0.24);
    this.strobeLights.forEach(light => {
      light.intensity = strobeActive ? 8.0 : 0.0;
    });

    // Beacon flashes every 1.0s
    const beaconPhase = (now % 1.0);
    const beaconActive = beaconPhase < 0.15;
    this.beaconLights.forEach(light => {
      light.intensity = beaconActive ? 6.0 : 0.1;
    });

    // 5. Update Cockpit Interior Controls
    this.cockpit?.updateControls(flightState);
  }

  fitNoseDoorsToSkin(exterior = this.gltfModel) {
    // Sample the uncut loaded skin in aircraft coordinates. Closed doors then
    // follow its curvature and livery rather than floating below a flat patch.
    const ray = new THREE.Raycaster();
    const world = new THREE.Vector3(), local = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 1, 0).transformDirection(this.group.matrixWorld);
    const skinAt = (x, z) => {
      world.set(x, -10, z).applyMatrix4(this.group.matrixWorld);
      ray.set(world, direction);
      const hit = ray.intersectObject(exterior, true)[0];
      if (!hit) return { y: -2.28, material: null, uv: new THREE.Vector2() };
      local.copy(hit.point); this.group.worldToLocal(local);
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
      return { y: local.y - 0.012, material, uv: hit.uv || new THREE.Vector2() };
    };
    for (const wall of this.noseBayWalls) {
      const vertices = wall.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        if (vertices.getY(i) >= 0) continue;
        const x = wall.position.x + vertices.getX(i), z = wall.position.z + vertices.getZ(i);
        vertices.setY(i, skinAt(x, z).y + 0.025 - wall.position.y);
      }
      vertices.needsUpdate = true;
      wall.geometry.computeBoundingBox(); wall.geometry.computeBoundingSphere();
    }
    const volume = this.gearBayVolumes[0];
    const centerZ = (volume.min.z + volume.max.z) / 2;
    const skin = skinAt(0, centerZ);
    const doorMaterial = skin.material?.clone();
    if (doorMaterial) {
      doorMaterial.side = THREE.DoubleSide;
      // The classic Korean Air belly continues over the nose bay panels.
      doorMaterial.map = null; doorMaterial.color.set(0xe9edf0);
      doorMaterial.roughness = .35;
    }
    for (const { obj: hinge, side } of this.gearDoors) {
      const panel = hinge.children[0];
      const positions = [], uvs = [], indices = [];
      const columns = 4, rows = 16;
      // side is the outboard hinge side; panel spans inward toward the seam.
      hinge.position.y = skinAt(side * 0.54, centerZ).y;
      panel.position.set(0, 0, 0);
      for (let row = 0; row <= rows; row++) {
        const z = volume.min.z + row / rows * (volume.max.z - volume.min.z);
        for (let column = 0; column <= columns; column++) {
          const x = side * 0.54 * (1 - column / columns);
          const sample = skinAt(x, z);
          positions.push(x - hinge.position.x, sample.y - hinge.position.y, z - hinge.position.z);
          uvs.push(sample.uv.x, sample.uv.y);
        }
      }
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column, b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      panel.geometry.dispose(); panel.geometry = geometry;
      if (doorMaterial) panel.material = doorMaterial;
    }
  }

  loadGltfModel(url) {
    this.ready = Promise.resolve();
    if (typeof window === 'undefined') return;
    let settle;
    this.ready = new Promise(resolve => { settle = resolve; });
    this.loadingGltf = true;


    try {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          this.loadingGltf = false;
          this.gltfModel = gltf.scene;

          // Rotate 90° clockwise around Y so nose (-X in raw asset) faces -Z (simulator flight direction)
          this.gltfModel.rotation.y = Math.PI * 0.5;
          this.gltfModel.position.set(0, 0, 0);

          // Cut real apertures so rigid wheels enter bays rather than passing
          // through the rendered fuselage. The shadow proxy shares this geometry.
          this.gltfGroup.add(this.gltfModel);
          this.group.updateMatrixWorld(true);
          this.fitNoseDoorsToSkin();
          this.fitMainBaysToSkin(this.gltfModel);
          this.gltfModel.traverse(mesh => {
            if (mesh.isMesh && mesh.name === 'B737') cutGearBays(mesh, this.group, this.gearBayVolumes);
          });

          // PBR enhancements: cast/receive shadow and tune roughness/metalness
          this.gltfModel.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material) {
                child.material.roughness = Math.min(child.material.roughness, 0.35);
                child.material.metalness = Math.max(child.material.metalness, 0.3);
                child.material.envMapIntensity = 1.35;
                child.material.needsUpdate = true;
              }
            }
          });

          // Preserve the complete neutral airframe for the cockpit shadow proxy.
          const originalAirframeGeometry = this.gltfModel.getObjectByName('B737')?.geometry;
          this.gltfControlSurfaces = bindGltfControlSurfaces(this.gltfModel);
          this.applyCurrentLivery();
          if (this.flatShading) {
            applyFlatShading(this.gltfModel, true);
          }

          // Turbine fan blades ('turbs' = port/left engine, 'tur_01' = starboard/right engine)
          this.gltfFanL = this.gltfModel.getObjectByName('turbs') || null;
          this.gltfFanR = this.gltfModel.getObjectByName('tur_01') || null;
          this.gltfFans = [this.gltfFanL, this.gltfFanR].filter(Boolean);

          this.gltfGroup.visible = !this.isCockpit;
          this.modelLoaded = true;

          // Setup airframe shadow proxy so realistic airframe shadows are cast in cockpit view
          // while preserving gltfGroup.visible = false contract in cockpit mode
          const b737Mesh = this.gltfModel.getObjectByName('B737');
          if (b737Mesh && !this.exteriorOnly) {
            const shadowMat = new THREE.MeshBasicMaterial({
              colorWrite: false,
              depthWrite: false
            });
            const shadowProxy = new THREE.Mesh(originalAirframeGeometry, shadowMat);
            shadowProxy.name = 'Airframe_Shadow_Proxy';
            shadowProxy.rotation.copy(this.gltfModel.rotation);
            shadowProxy.position.copy(this.gltfModel.position);
            shadowProxy.scale.copy(this.gltfModel.scale);
            shadowProxy.castShadow = true;
            excludeFromDeckShadow(shadowProxy);
            shadowProxy.receiveShadow = false;
            shadowProxy.visible = this.isCockpit;
            this.gltfShadowProxy = shadowProxy;
            this.group.add(shadowProxy);
          }

          settle();
        },
        undefined,
        (err) => {
          console.error('B737 GLB model failed to load:', err);
          this.loadingGltf = false;
          settle();
        }
      );
    } catch (e) {
      console.error('B737 GLB loader initialization failed:', e);
      this.loadingGltf = false;
      settle();
    }
  }

  setCockpitMode(isCockpit, showInterior = true) {
    this.isCockpit = isCockpit;
    this.gltfGroup.visible = !isCockpit;
    if (this.gltfShadowProxy) {
      this.gltfShadowProxy.visible = isCockpit;
    }
    if (this.cockpit && this.cockpit.group) {
      this.cockpit.group.visible = isCockpit && showInterior;
    }
    this.scopeAirframeLamps();
  }

  triggerCrashVisuals(collisionType) {
    this.isCrashed = true;
    if (this.lightsGroup) this.lightsGroup.visible = false;

    // Keep the visible airframe aligned with the physical terrain contacts.
    // Explosion/light effects convey the crash without rotating geometry underground.
  }

  resetCrashVisuals() {
    this.isCrashed = false;
    if (this.lightsGroup) this.lightsGroup.visible = this.lightsOn;

    if (this.gltfGroup) {
      this.gltfGroup.rotation.z = 0;
      this.gltfGroup.rotation.x = 0;
    }
    if (this.gltfShadowProxy) {
      this.gltfShadowProxy.rotation.z = 0;
      this.gltfShadowProxy.rotation.x = 0;
    }

  }

  setFlatShading(flatShading) {
    this.flatShading = Boolean(flatShading);
    applyFlatShading(this.group, this.flatShading);
  }

  applyCurrentLivery() {
    if (!this.gltfModel) return;
    const existingKorean = this.gltfGroup.getObjectByName('KoreanAirLivery');
    if (existingKorean) this.gltfGroup.remove(existingKorean);
    const existingJeju = this.gltfGroup.getObjectByName('JejuAirLivery');
    if (existingJeju) this.gltfGroup.remove(existingJeju);

    if (this.livery === 'korean') {
      applyKoreanAirLivery(this.gltfModel, this.group, this.gltfGroup);
    } else {
      applyJejuAirLivery(this.gltfModel, this.group, this.gltfGroup);
    }
  }

  setLivery(liveryName) {
    this.livery = liveryName;
    this.applyCurrentLivery();
  }
}
