import * as THREE from 'three';
import { Cockpit } from './Cockpit.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
    this.useGltf = false;
    this.loadingGltf = false;
    this.modelLoaded = false;
    this.isCockpit = false;

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

    // Lighting
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

    // 6. Navigation, Strobe & Landing Lights
    this.buildLights();

    // 7. Asynchronous High-Detail GLTF PBR Model Loading with Procedural Fallback
    this.loadGltfModel('/models/b737-800.glb');
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

      // Pylon
      const pylonGeo = new THREE.BoxGeometry(0.32, 1.8, 3.2);
      const pylon = new THREE.Mesh(pylonGeo, blueMat);
      pylon.position.set(0, 1.1, 0.2);
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

  buildLandingGear() {
    this.gearGroup = new THREE.Group();

    const strutMat = new THREE.MeshStandardMaterial({ color: 0x88929e, metalness: 0.8, roughness: 0.3 });
    const chromePistonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95, roughness: 0.1 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9, metalness: 0.1 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.7, roughness: 0.3 });

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

    // 1. Nose Gear Assembly (Center forward: x=0, y=-0.85m, z=-12.5m)
    this.noseGearGroup = new THREE.Group();
    this.noseGearGroup.position.set(0, -0.85, -12.5);

    // Outer stationary strut housing cylinder
    const nStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 12), strutMat);
    nStrut.position.y = -0.75;
    this.noseGearGroup.add(nStrut);

    // Movable Nose Truck (Sliding oleo chrome piston + dual wheels)
    this.noseTruck = new THREE.Group();
    const nPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.5, 12), chromePistonMat);
    nPiston.position.y = -1.65;
    this.noseTruck.add(nPiston);

    // Dual Nose Wheels
    const nWheelL = makeWheel(0.38, 0.22);
    nWheelL.position.set(-0.24, -2.42, 0);
    const nWheelR = makeWheel(0.38, 0.22);
    nWheelR.position.set(0.24, -2.42, 0);
    this.noseTruck.add(nWheelL, nWheelR);

    this.noseGearGroup.add(this.noseTruck);

    // 2. Main Gear Assembly (Left: x=-3.2, Right: x=3.2, z=1.8)
    const makeMainBogie = (xPos) => {
      const mainGear = new THREE.Group();
      mainGear.position.set(xPos, -0.9, 1.8);

      // Outer stationary strut housing cylinder
      const mStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.5, 12), strutMat);
      mStrut.position.y = -0.75;
      mainGear.add(mStrut);

      // Movable Main Truck (Sliding oleo chrome piston + 2-wheel bogie)
      const truck = new THREE.Group();
      const mPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 1.5, 12), chromePistonMat);
      mPiston.position.y = -1.65;
      truck.add(mPiston);

      const wL = makeWheel(0.48, 0.32);
      wL.position.set(-0.35, -2.40, 0);
      const wR = makeWheel(0.48, 0.32);
      wR.position.set(0.35, -2.40, 0);
      truck.add(wL, wR);

      mainGear.add(truck);
      return { root: mainGear, truck };
    };

    const mainL = makeMainBogie(-3.2);
    const mainR = makeMainBogie(3.2);

    this.mainGearLGroup = mainL.root;
    this.mainTruckL = mainL.truck;

    this.mainGearRGroup = mainR.root;
    this.mainTruckR = mainR.truck;

    this.gearGroup.add(this.noseGearGroup, this.mainGearLGroup, this.mainGearRGroup);
    this.group.add(this.gearGroup);
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

    this.group.add(this.lightsGroup);
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
    // Scale gear strut vertically & rotate into bays
    if (this.noseGearGroup) {
      this.noseGearGroup.scale.set(1.0, Math.max(0.01, gearState), 1.0);
      this.noseGearGroup.rotation.x = (1.0 - gearState) * (Math.PI * 0.5);
    }
    if (this.mainGearLGroup) {
      this.mainGearLGroup.scale.set(1.0, Math.max(0.01, gearState), 1.0);
      this.mainGearLGroup.rotation.z = -(1.0 - gearState) * (Math.PI * 0.5);
    }
    if (this.mainGearRGroup) {
      this.mainGearRGroup.scale.set(1.0, Math.max(0.01, gearState), 1.0);
      this.mainGearRGroup.rotation.z = (1.0 - gearState) * (Math.PI * 0.5);
    }

    // Dynamic Oleo Strut Suspension Squat ("털썩" 하중 압축)
    if (gearState > 0.8 && flightState.compressions) {
      const compNose = Math.min(0.9, Math.max(0, flightState.compressions.nose || 0));
      const compL = Math.min(0.9, Math.max(0, flightState.compressions.mainLeft || 0));
      const compR = Math.min(0.9, Math.max(0, flightState.compressions.mainRight || 0));

      if (this.noseTruck) this.noseTruck.position.y = compNose;
      if (this.mainTruckL) this.mainTruckL.position.y = compL;
      if (this.mainTruckR) this.mainTruckR.position.y = compR;
    } else {
      if (this.noseTruck) this.noseTruck.position.y = 0;
      if (this.mainTruckL) this.mainTruckL.position.y = 0;
      if (this.mainTruckR) this.mainTruckR.position.y = 0;
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
      });
    }

    // 6. Update Cockpit Interior Controls
    this.cockpit.updateControls(flightState);
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

          // Turbine fan blades
          this.gltfFans = [];
          const fan1 = this.gltfModel.getObjectByName('tur_01');
          const fan2 = this.gltfModel.getObjectByName('turbs');
          if (fan1) this.gltfFans.push(fan1);
          if (fan2) this.gltfFans.push(fan2);

          this.gltfGroup.add(this.gltfModel);
          this.gltfGroup.visible = !this.isCockpit;
          this.modelLoaded = true;
          this.useGltf = true;

          // Switch exterior visibility: hide procedural fuselage, wings and tail, keep landing gear & lights
          if (this.fuselageGroup) this.fuselageGroup.visible = false;
          if (this.wingGroup) this.wingGroup.visible = false;
          if (this.tailGroup) this.tailGroup.visible = false;
          if (this.empennageGroup) this.empennageGroup.visible = false;
          if (this.enginesGroup) this.enginesGroup.visible = false;
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
    } else if (!this.loadingGltf) {
      if (this.fuselageGroup) this.fuselageGroup.visible = !isCockpit;
      if (this.wingGroup) this.wingGroup.visible = !isCockpit;
      if (this.tailGroup) this.tailGroup.visible = !isCockpit;
      if (this.empennageGroup) this.empennageGroup.visible = !isCockpit;
      if (this.enginesGroup) this.enginesGroup.visible = !isCockpit;
    }
    if (this.cockpit && this.cockpit.group) {
      this.cockpit.group.visible = isCockpit && showInterior;
    }
  }

  triggerCrashVisuals(collisionType) {
    this.isCrashed = true;
    if (this.lightsGroup) this.lightsGroup.visible = false;

    if (this.gltfGroup) {
      this.gltfGroup.rotation.z = -0.18;
      this.gltfGroup.rotation.x = 0.12;
    }

    // Dislocate/damage wing structures upon catastrophic impact
    if (this.wingGroup && this.wingGroup.children.length >= 2) {
      this.wingGroup.children[0].rotation.z = -0.22;
      this.wingGroup.children[0].rotation.x = 0.15;
      this.wingGroup.children[1].rotation.z = 0.26;
      this.wingGroup.children[1].rotation.x = -0.18;
    }
  }

  resetCrashVisuals() {
    this.isCrashed = false;
    if (this.lightsGroup) this.lightsGroup.visible = this.lightsOn;

    if (this.gltfGroup) {
      this.gltfGroup.rotation.z = 0;
      this.gltfGroup.rotation.x = 0;
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
