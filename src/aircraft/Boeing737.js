import * as THREE from 'three';
import { cutGearBays } from './gearGeometry.js';
import { Cockpit } from './Cockpit.js';
import { excludeFromDeckShadow } from './CockpitLighting.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindGltfControlSurfaces, updateGltfControlSurfaces } from './GltfControlSurfaces.js';
import { applyKoreanAirLivery } from './KoreanAirLivery.js';

/**
 * Boeing 737-800 Airliner 3D Model
 * High-detail airliner with swept wings, blended winglets, twin turbofans with spinning fan blades,
 * fully articulated control surfaces (ailerons, flaps, spoilers, elevators, rudder),
 * retractable tricycle landing gear with doors, and complete navigation/strobe/landing light system.
 */
export class Boeing737 {
  constructor(pfdCanvas, ndCanvas, eicasCanvas, mcpCanvas = null, isfdCanvas = null, cduCanvas = null) {
    this.group = new THREE.Group();

    // Internal cockpit
    this.cockpit = new Cockpit(pfdCanvas, ndCanvas, eicasCanvas, mcpCanvas, isfdCanvas, cduCanvas);
    this.group.add(this.cockpit.group);

    // GLTF PBR High-Detail Model references
    this.gltfModel = null;
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.name = 'GLTF_Boeing737';
    this.gltfGroup.visible = false;
    this.group.add(this.gltfGroup);
    this.gltfFans = [];
    this.gltfControlSurfaces = [];
    this.useGltf = false;
    this.loadingGltf = false;
    this.modelLoaded = false;
    this.isCockpit = false;
    this.gltfShadowProxy = null;
    this.proceduralShadowProxy = null;

    // Control surfaces references
    this.aileronL = null;
    this.aileronR = null;
    this.flapL = null;
    this.flapR = null;
    this.spoilersL = [];
    this.spoilersR = [];
    this.elevatorL = null;
    this.elevatorR = null;
    this.rudder = null;

    // Engines
    this.fanL = null;
    this.fanR = null;

    this.fuselageGroup = null;
    this.wingGroup = null;
    this.tailGroup = null;
    this.empennageGroup = null;
    this.enginesGroup = null;
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
    // Materials
    const fuselageWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf4f7fa,
      roughness: 0.25,
      metalness: 0.15
    });

    const boeingBlueMat = new THREE.MeshStandardMaterial({
      color: 0x003366, // Classic Boeing deep blue
      roughness: 0.3,
      metalness: 0.25
    });

    const wingGreyMat = new THREE.MeshStandardMaterial({
      color: 0xc8d1dc,
      roughness: 0.45,
      metalness: 0.3
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.95
    });

    const darkEngineMat = new THREE.MeshStandardMaterial({
      color: 0x1f2429,
      roughness: 0.7,
      metalness: 0.5
    });

    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9
    });

    // 1. Fuselage
    this.buildFuselage(fuselageWhiteMat, boeingBlueMat, windowMat);

    // 2. Swept Wings & Winglets
    this.buildWings(wingGreyMat, boeingBlueMat, chromeMat);

    // 3. Tailfin (Vertical Stabilizer) & Horizontal Stabilizers
    this.buildEmpennage(fuselageWhiteMat, boeingBlueMat, wingGreyMat);

    // 4. Twin Turbofan Engines (CFM56 / LEAP)
    this.buildEngines(boeingBlueMat, chromeMat, darkEngineMat);

    // 5. Tricycle Landing Gear
    this.buildLandingGear();
    this.group.updateMatrixWorld(true);
    this.fitNoseDoorsToSkin(this.fuselageGroup);
    this.fitMainBaysToSkin(this.fuselageGroup);
    // Open the same bays in the procedural fallback; the loaded exterior is
    // cut separately once its aircraft-space transform has been established.
    for (const root of [this.fuselageGroup, this.wingGroup]) {
      root.traverse(mesh => { if (mesh.isMesh) cutGearBays(mesh, this.group, this.gearBayVolumes); });
    }

    // 6. Navigation, Strobe & Landing Lights
    this.buildLights();

    // Ensure all procedural exterior components cast and receive shadows
    [
      this.fuselageGroup,
      this.wingGroup,
      this.tailGroup,
      this.empennageGroup,
      this.enginesGroup,
      this.noseGearGroup,
      this.mainGearLGroup,
      this.mainGearRGroup
    ].forEach((grp) => {
      if (!grp) return;
      grp.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    });

    // Procedural shadow proxy for cockpit view (fuselage cylinder)
    const procShadowMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false
    });
    const procCabinGeo = new THREE.CylinderGeometry(1.88, 1.88, 24.0, 16);
    procCabinGeo.rotateX(Math.PI * 0.5);
    this.proceduralShadowProxy = new THREE.Mesh(procCabinGeo, procShadowMat);
    this.proceduralShadowProxy.name = 'Procedural_Shadow_Proxy';
    this.proceduralShadowProxy.castShadow = true;
    excludeFromDeckShadow(this.proceduralShadowProxy);
    this.proceduralShadowProxy.receiveShadow = false;
    this.proceduralShadowProxy.visible = false;
    this.group.add(this.proceduralShadowProxy);
    cutGearBays(this.proceduralShadowProxy, this.group, this.gearBayVolumes);

    // 7. Asynchronous High-Detail GLTF PBR Model Loading with Procedural Fallback
    this.loadGltfModel(`${import.meta.env?.BASE_URL ?? '/'}models/b737-800.glb`);
  }

  buildFuselage(whiteMat, blueMat, winMat) {
    this.fuselageGroup = new THREE.Group();

    // Main Cabin Cylinder (diameter ~3.76m, length ~26m)
    const cabinGeo = new THREE.CylinderGeometry(1.88, 1.88, 24.0, 32);
    cabinGeo.rotateX(Math.PI * 0.5);
    const cabin = new THREE.Mesh(cabinGeo, whiteMat);
    cabin.position.set(0, 0, 0);
    this.fuselageGroup.add(cabin);

    // Boeing Blue Belly Stripe
    const bellyGeo = new THREE.CylinderGeometry(1.89, 1.89, 24.0, 32, 1, false, Math.PI * 0.75, Math.PI * 0.5);
    bellyGeo.rotateX(Math.PI * 0.5);
    const belly = new THREE.Mesh(bellyGeo, blueMat);
    this.fuselageGroup.add(belly);

    // Aerodynamic Nose Cone (extends to z = -16.2m)
    const noseGeo = new THREE.ConeGeometry(1.88, 5.5, 32);
    noseGeo.rotateX(-Math.PI * 0.5);
    const nose = new THREE.Mesh(noseGeo, whiteMat);
    nose.position.set(0, -0.15, -14.75);
    nose.scale.set(1.0, 0.88, 1.0);
    this.fuselageGroup.add(nose);

    // Radome Tip (Black/Dark grey nose cap)
    const radomeGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const radome = new THREE.Mesh(radomeGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }));
    radome.position.set(0, -0.25, -17.4);
    radome.scale.set(0.9, 0.8, 1.4);
    this.fuselageGroup.add(radome);

    // Cockpit Windshield Windows Exterior Decal
    const windshieldGeo = new THREE.BoxGeometry(1.4, 0.45, 0.05);
    const windshieldExt = new THREE.Mesh(windshieldGeo, winMat);
    windshieldExt.position.set(0, 1.15, -13.5);
    windshieldExt.rotation.x = -0.55;
    this.fuselageGroup.add(windshieldExt);

    // Passenger Window Strips along both sides
    const winStripGeo = new THREE.BoxGeometry(0.04, 0.28, 19.5);
    const winStripL = new THREE.Mesh(winStripGeo, winMat);
    winStripL.position.set(-1.87, 0.35, -0.5);
    const winStripR = new THREE.Mesh(winStripGeo, winMat);
    winStripR.position.set(1.87, 0.35, -0.5);
    this.fuselageGroup.add(winStripL, winStripR);

    // Tail Cone (tapers back to APU exhaust at z = +18.5m)
    const tailConeGeo = new THREE.CylinderGeometry(0.35, 1.88, 7.5, 32);
    tailConeGeo.rotateX(Math.PI * 0.5);
    const tailCone = new THREE.Mesh(tailConeGeo, whiteMat);
    tailCone.position.set(0, 0.45, 15.75);
    this.fuselageGroup.add(tailCone);

    // APU Exhaust Hole
    const apuGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 16);
    apuGeo.rotateX(Math.PI * 0.5);
    const apu = new THREE.Mesh(apuGeo, new THREE.MeshStandardMaterial({ color: 0x111111 }));
    apu.position.set(0, 0.65, 19.5);
    this.fuselageGroup.add(apu);

    this.group.add(this.fuselageGroup);
  }

  buildWings(wingMat, blueMat, chromeMat) {
    this.wingGroup = new THREE.Group();
    this.wingGroup.position.set(0, -0.65, 0.5); // Wing root below cabin floor

    // Wingspan: 35.8m total (each wing ~17.5m from center)
    const halfSpan = 17.0;

    // Wing Shape Construction: Root chord ~7.2m, Tip chord ~1.8m, sweep ~25 deg, dihedral ~6 deg
    const makeWingHalf = (isRight) => {
      const sign = isRight ? 1 : -1;
      const wingHalf = new THREE.Group();

      // Main Wing Surface
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 3.2);       // Root trailing edge
      wingShape.lineTo(0, -4.0);      // Root leading edge
      wingShape.lineTo(halfSpan, -0.5); // Tip leading edge (swept)
      wingShape.lineTo(halfSpan, 1.8);  // Tip trailing edge
      wingShape.closePath();

      const extrudeSettings = { depth: 0.42, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.1, bevelThickness: 0.1 };
      const wingGeom = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
      wingGeom.rotateX(Math.PI * 0.5);
      const wingMesh = new THREE.Mesh(wingGeom, wingMat);

      // Wing root position and dihedral (+6 deg tilts wing upward)
      wingMesh.position.set(sign * 1.6, 0, 0);
      wingMesh.rotation.z = sign * THREE.MathUtils.degToRad(6.0); // Dihedral
      if (!isRight) wingMesh.scale.x = -1;

      // Blended Winglet attached directly to tip of wingMesh
      const wingletGeo = new THREE.BoxGeometry(0.12, 2.4, 1.4);
      const winglet = new THREE.Mesh(wingletGeo, blueMat);
      winglet.position.set(halfSpan, 1.2, 0.65);
      winglet.rotation.z = THREE.MathUtils.degToRad(-15.0);
      winglet.rotation.y = THREE.MathUtils.degToRad(8.0);
      wingMesh.add(winglet);

      wingHalf.add(wingMesh);
      return wingHalf;
    };

    this.wingGroup.add(makeWingHalf(false)); // Left wing
    this.wingGroup.add(makeWingHalf(true));  // Right wing

    // Articulated Control Surfaces: Ailerons, Flaps, Spoilers
    this.buildControlSurfaces(wingMat);

    this.group.add(this.wingGroup);
  }

  buildControlSurfaces(surfMat) {
    const aileronGeo = new THREE.BoxGeometry(4.2, 0.12, 0.7);
    const flapGeo = new THREE.BoxGeometry(5.8, 0.15, 0.95);
    const spoilerGeo = new THREE.BoxGeometry(1.2, 0.08, 0.65);

    // Left Aileron (Outboard)
    this.aileronL = new THREE.Mesh(aileronGeo, surfMat);
    this.aileronL.position.set(-13.2, 1.35, 1.2);
    this.aileronL.rotation.z = THREE.MathUtils.degToRad(-6.0);
    this.wingGroup.add(this.aileronL);

    // Right Aileron (Outboard)
    this.aileronR = new THREE.Mesh(aileronGeo, surfMat);
    this.aileronR.position.set(13.2, 1.35, 1.2);
    this.aileronR.rotation.z = THREE.MathUtils.degToRad(6.0);
    this.wingGroup.add(this.aileronR);

    // Left Flap (Inboard)
    this.flapL = new THREE.Mesh(flapGeo, surfMat);
    this.flapL.position.set(-6.8, 0.72, 2.4);
    this.flapL.rotation.z = THREE.MathUtils.degToRad(-6.0);
    this.wingGroup.add(this.flapL);

    // Right Flap (Inboard)
    this.flapR = new THREE.Mesh(flapGeo, surfMat);
    this.flapR.position.set(6.8, 0.72, 2.4);
    this.flapR.rotation.z = THREE.MathUtils.degToRad(6.0);
    this.wingGroup.add(this.flapR);

    // Spoilers (4 panels on each upper wing)
    this.spoilersL = [];
    this.spoilersR = [];
    for (let i = 0; i < 4; i++) {
      const spL = new THREE.Mesh(spoilerGeo, surfMat);
      spL.position.set(-4.5 - i * 1.5, 0.55 + i * 0.15, 1.5);
      spL.rotation.z = THREE.MathUtils.degToRad(-6.0);
      this.wingGroup.add(spL);
      this.spoilersL.push(spL);

      const spR = new THREE.Mesh(spoilerGeo, surfMat);
      spR.position.set(4.5 + i * 1.5, 0.55 + i * 0.15, 1.5);
      spR.rotation.z = THREE.MathUtils.degToRad(6.0);
      this.wingGroup.add(spR);
      this.spoilersR.push(spR);
    }
  }

  buildEmpennage(whiteMat, blueMat, greyMat) {
    this.tailGroup = new THREE.Group();
    this.empennageGroup = this.tailGroup;
    this.tailGroup.position.set(0, 0.8, 14.2);

    // 1. Vertical Stabilizer (Fin)
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0, 7.2);       // Fin tip height
    finShape.lineTo(-1.6, 7.2);    // Fin tip trailing edge
    finShape.lineTo(-5.2, 0);      // Base trailing edge
    finShape.closePath();

    const finExtrude = { depth: 0.32, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.05, bevelThickness: 0.05 };
    const finGeo = new THREE.ExtrudeGeometry(finShape, finExtrude);
    finGeo.rotateY(Math.PI * 0.5);
    const fin = new THREE.Mesh(finGeo, blueMat);
    fin.position.set(-0.16, 0.6, 0);
    this.tailGroup.add(fin);

    // Articulated Rudder
    const rudderGeo = new THREE.BoxGeometry(0.22, 5.8, 1.2);
    this.rudder = new THREE.Mesh(rudderGeo, blueMat);
    this.rudder.position.set(0, 3.8, 2.6);
    this.tailGroup.add(this.rudder);

    // 2. Horizontal Stabilizers (Left & Right)
    const hStabGeo = new THREE.BoxGeometry(5.2, 0.18, 2.4);
    hStabGeo.rotateX(THREE.MathUtils.degToRad(-15.0)); // Swept

    const hStabL = new THREE.Mesh(hStabGeo, greyMat);
    hStabL.position.set(-4.2, 0.8, 2.2);
    hStabL.rotation.z = THREE.MathUtils.degToRad(8.0); // Dihedral

    const hStabR = new THREE.Mesh(hStabGeo, greyMat);
    hStabR.position.set(4.2, 0.8, 2.2);
    hStabR.rotation.z = THREE.MathUtils.degToRad(-8.0);

    this.tailGroup.add(hStabL, hStabR);

    // Elevators
    const elevGeo = new THREE.BoxGeometry(4.8, 0.12, 0.7);
    this.elevatorL = new THREE.Mesh(elevGeo, greyMat);
    this.elevatorL.position.set(-4.2, 0.8, 3.4);
    this.elevatorR = new THREE.Mesh(elevGeo, greyMat);
    this.elevatorR.position.set(4.2, 0.8, 3.4);

    this.tailGroup.add(this.elevatorL, this.elevatorR);

    this.group.add(this.tailGroup);
  }

  buildEngines(blueMat, chromeMat, darkMat) {
    this.enginesGroup = new THREE.Group();

    const makeTurbofan = (xPos) => {
      const eng = new THREE.Group();
      eng.position.set(xPos, -1.95, -5.22); // Underwing pylon mount aligned with B737 CFM56 nacelle probes

      // Pylon (strut connecting underwing to CFM56 turbofan nacelle)
      const pylonGeo = new THREE.BoxGeometry(0.32, 1.6, 4.4);
      const pylon = new THREE.Mesh(pylonGeo, blueMat);
      pylon.position.set(0, 1.35, 1.4);
      eng.add(pylon);

      // Nacelle Outer Cowl (Length ~4.2m, Diameter ~2.1m)
      const cowlGeo = new THREE.CylinderGeometry(1.05, 1.05, 3.8, 24, 1, true);
      cowlGeo.rotateX(Math.PI * 0.5);
      const cowl = new THREE.Mesh(cowlGeo, blueMat);
      eng.add(cowl);

      // Chrome Intake Lip
      const lipGeo = new THREE.TorusGeometry(1.02, 0.08, 16, 32);
      const lip = new THREE.Mesh(lipGeo, chromeMat);
      lip.position.set(0, 0, -1.9);
      eng.add(lip);

      // Fan Rotor with Spinner & Blades
      const fanGroup = new THREE.Group();
      fanGroup.position.set(0, 0, -1.4);

      // Center Spiral Spinner Cone
      const spinnerGeo = new THREE.ConeGeometry(0.32, 0.7, 16);
      spinnerGeo.rotateX(-Math.PI * 0.5);
      const spinner = new THREE.Mesh(spinnerGeo, darkMat);
      fanGroup.add(spinner);

      // 18 Titanium Fan Blades
      const bladeGeo = new THREE.BoxGeometry(0.04, 0.65, 0.16);
      for (let b = 0; b < 18; b++) {
        const angle = (b / 18) * Math.PI * 2;
        const blade = new THREE.Mesh(bladeGeo, chromeMat);
        blade.position.set(Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, -0.05);
        blade.rotation.z = angle + Math.PI * 0.5;
        blade.rotation.y = 0.35; // Blade pitch angle
        fanGroup.add(blade);
      }
      eng.add(fanGroup);

      // Rear Exhaust Cone
      const exhaustGeo = new THREE.ConeGeometry(0.55, 1.2, 16);
      exhaustGeo.rotateX(Math.PI * 0.5);
      const exhaust = new THREE.Mesh(exhaustGeo, darkMat);
      exhaust.position.set(0, 0, 2.2);
      eng.add(exhaust);

      return { root: eng, fan: fanGroup };
    };

    const leftEngine = makeTurbofan(-5.06);
    const rightEngine = makeTurbofan(5.06);

    this.fanL = leftEngine.fan;
    this.fanR = rightEngine.fan;

    this.enginesGroup.add(leftEngine.root, rightEngine.root);
    this.group.add(this.enginesGroup);
  }

  buildLandingGear(profile = 'fallback') {
    this.gearProfile = profile;
    const loaded = profile === 'loaded';
    const noseY = loaded ? -1.75 : -0.80;
    const noseLength = -3.27 - noseY;
    const noseMinZ = loaded ? -14.55 : -13.0;
    const noseMaxZ = loaded ? -11.95 : -9.30;
    const noseCenterZ = (noseMinZ + noseMaxZ) / 2;
    // Keep deployed hubs at +/-3.2, -3.3 while placing stowed wheels
    // beneath the center belly, with their outer faces exposed (no wheel doors).
    this.mainMountX = loaded ? 2.85 : 3.20;
    this.mainMountY = loaded ? -1.12 : -0.65;
    this.mainStowedY = loaded ? -1.72 : -1.25;
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
      new THREE.Box3(new THREE.Vector3(-0.54, -4, noseMinZ), new THREE.Vector3(0.54, loaded ? -1.30 : -0.30, noseMaxZ))
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
    const n1Left = flightState.engine1 ? flightState.engine1.n1 : 22;
    const n1Right = flightState.engine2 ? flightState.engine2.n1 : 22;

    const rotSpeedL = (n1Left / 100.0) * 85.0 * dt;
    const rotSpeedR = (n1Right / 100.0) * 85.0 * dt;

    if (this.fanL) this.fanL.rotation.z += rotSpeedL;
    if (this.fanR) this.fanR.rotation.z += rotSpeedR;

    // 2. Control Surface Deflections
    updateGltfControlSurfaces(this.gltfControlSurfaces, flightState);
    // Ailerons (Roll)
    const aileronVal = flightState.aileron || 0;
    if (this.aileronL) this.aileronL.rotation.x = aileronVal * 0.35;
    if (this.aileronR) this.aileronR.rotation.x = -aileronVal * 0.35;

    // Flaps (Fractions 0° to 40°)
    const flapAngleRad = THREE.MathUtils.degToRad(flightState.flapDegree || 0);
    if (this.flapL) {
      this.flapL.rotation.x = flapAngleRad;
      this.flapL.position.y = 0.35 - Math.sin(flapAngleRad) * 0.4;
      this.flapL.position.z = 2.5 + Math.cos(flapAngleRad) * 0.3;
    }
    if (this.flapR) {
      this.flapR.rotation.x = flapAngleRad;
      this.flapR.position.y = 0.35 - Math.sin(flapAngleRad) * 0.4;
      this.flapR.position.z = 2.5 + Math.cos(flapAngleRad) * 0.3;
    }

    // Spoilers (Pop up on upper wing)
    const spoilerVal = flightState.spoilers || 0;
    const spAngle = spoilerVal * THREE.MathUtils.degToRad(-50.0);
    this.spoilersL.forEach(sp => { sp.rotation.x = spAngle; });
    this.spoilersR.forEach(sp => { sp.rotation.x = spAngle; });

    // Elevators (Pitch)
    const elevVal = flightState.elevator || 0;
    if (this.elevatorL) this.elevatorL.rotation.x = elevVal * 0.45;
    if (this.elevatorR) this.elevatorR.rotation.x = elevVal * 0.45;

    // Rudder (Yaw)
    const rudderVal = flightState.rudder || 0;
    if (this.rudder) this.rudder.rotation.y = rudderVal * 0.45;

    // 3. Landing Gear Retraction & Dynamic Suspension Compression Animation
    const gearState = flightState.gearState !== undefined ? flightState.gearState : 1.0;
    // Hold doors open before moving rigid legs. This mapping is reversible:
    // changing direction in transit retraces the same clearance-safe path.
    const extension = THREE.MathUtils.clamp(gearState, 0, 1);
    const legExtension = THREE.MathUtils.smoothstep(extension, 0.18, 0.88);
    const fold = (1 - legExtension) * Math.PI * 0.5;
    if (this.noseGearGroup) this.noseGearGroup.rotation.x = this.gearProfile === 'loaded' ? fold : -fold;
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
      group.rotation[axis] += sign * (damage[id] === 'collapsed' ? 1.1 : 0.15);
    }
    const doorOpen = THREE.MathUtils.smoothstep(extension, 0, 0.18);
    for (const item of this.gearDoors) item.obj.rotation[item.axis] = item.side * doorOpen * item.maxAngle;

    // Dynamic Oleo Strut Suspension Squat ("털썩" 하중 압축)
    if (gearState > 0.8 && flightState.compressions) {
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

    // 5. GLTF Turbine Fan Spin Animation
    if (this.gltfFans && this.gltfFans.length > 0 && flightState.engineN1) {
      const fanAngle = flightState.engineN1 * (Math.PI * 2.0) * 0.08;
      this.gltfFans.forEach(fan => {
        fan.rotation.x += fanAngle;
        fan.rotation.z += fanAngle;
      });
    }

    // 6. Update Cockpit Interior Controls
    this.cockpit.updateControls(flightState);
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
    if (typeof window === 'undefined') return;
    this.loadingGltf = true;

    // Suppress procedural exterior while primary GLTF asset is loading to prevent flash of old model
    if (this.fuselageGroup) this.fuselageGroup.visible = false;
    if (this.wingGroup) this.wingGroup.visible = false;
    if (this.tailGroup) this.tailGroup.visible = false;
    if (this.empennageGroup) this.empennageGroup.visible = false;
    if (this.enginesGroup) this.enginesGroup.visible = false;

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
          // The fallback nose is more tapered; it uses an aft bay. Build the
          // loaded profile only after successful loading, preserving fallback
          // geometry if loading fails and preserving the deployed contact datum.
          this.group.remove(this.gearGroup);
          this.buildLandingGear('loaded');
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
          applyKoreanAirLivery(this.gltfModel, this.group, this.gltfGroup);

          // Turbine fan blades
          this.gltfFans = [];
          const fan1 = this.gltfModel.getObjectByName('tur_01');
          const fan2 = this.gltfModel.getObjectByName('turbs');
          if (fan1) this.gltfFans.push(fan1);
          if (fan2) this.gltfFans.push(fan2);

          this.gltfGroup.visible = !this.isCockpit;
          this.modelLoaded = true;
          this.useGltf = true;

          // Setup airframe shadow proxy so realistic airframe shadows are cast in cockpit view
          // while preserving gltfGroup.visible = false contract in cockpit mode
          const b737Mesh = this.gltfModel.getObjectByName('B737');
          if (b737Mesh) {
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

          // Switch exterior visibility: hide procedural fuselage, wings and tail, keep landing gear & lights
          if (this.fuselageGroup) this.fuselageGroup.visible = false;
          if (this.wingGroup) this.wingGroup.visible = false;
          if (this.tailGroup) this.tailGroup.visible = false;
          if (this.empennageGroup) this.empennageGroup.visible = false;
          if (this.enginesGroup) this.enginesGroup.visible = false;
          if (this.proceduralShadowProxy) this.proceduralShadowProxy.visible = false;
        },
        undefined,
        (err) => {
          // Graceful fallback to procedural model
          console.warn('GLTF B737 model failed to load, falling back to procedural:', err);
          this.loadingGltf = false;
          this.useGltf = false;
          if (this.fuselageGroup) this.fuselageGroup.visible = !this.isCockpit;
          if (this.wingGroup) this.wingGroup.visible = !this.isCockpit;
          if (this.tailGroup) this.tailGroup.visible = !this.isCockpit;
          if (this.empennageGroup) this.empennageGroup.visible = !this.isCockpit;
          if (this.enginesGroup) this.enginesGroup.visible = !this.isCockpit;
        }
      );
    } catch (e) {
      this.loadingGltf = false;
      this.useGltf = false;
      if (this.fuselageGroup) this.fuselageGroup.visible = !this.isCockpit;
      if (this.wingGroup) this.wingGroup.visible = !this.isCockpit;
      if (this.tailGroup) this.tailGroup.visible = !this.isCockpit;
      if (this.empennageGroup) this.empennageGroup.visible = !this.isCockpit;
      if (this.enginesGroup) this.enginesGroup.visible = !this.isCockpit;
    }
  }

  setCockpitMode(isCockpit, showInterior = true) {
    this.isCockpit = isCockpit;
    if (this.useGltf && this.gltfGroup) {
      this.gltfGroup.visible = !isCockpit;
      if (this.gltfShadowProxy) {
        this.gltfShadowProxy.visible = isCockpit;
      }
    } else if (!this.loadingGltf) {
      if (this.fuselageGroup) this.fuselageGroup.visible = !isCockpit;
      if (this.proceduralShadowProxy) this.proceduralShadowProxy.visible = isCockpit;
      if (this.wingGroup) this.wingGroup.visible = !isCockpit;
      if (this.tailGroup) this.tailGroup.visible = !isCockpit;
      if (this.empennageGroup) this.empennageGroup.visible = !isCockpit;
      if (this.enginesGroup) this.enginesGroup.visible = !isCockpit;
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

    // Restore pristine wing geometry
    if (this.wingGroup && this.wingGroup.children.length >= 2) {
      this.wingGroup.children[0].rotation.z = 0;
      this.wingGroup.children[0].rotation.x = 0;
      this.wingGroup.children[1].rotation.z = 0;
      this.wingGroup.children[1].rotation.x = 0;
    }
  }
}
