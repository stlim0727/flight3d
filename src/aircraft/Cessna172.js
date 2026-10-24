import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * Cessna 172 Skyhawk Single-Engine Aircraft
 *
 * High-wing general aviation aircraft with:
 * - High-wing airframe with diagonal lift struts and cambered wingtips
 * - Tricycle fixed landing gear with wheel pants / fairings
 * - Two-blade tractor propeller with dynamic spinning & RPM blur disk
 * - Articulated control surfaces: ailerons, flaps, elevator, rudder, and steerable nose gear
 * - Navigation, strobe, rotating beacon, and landing light systems
 * - PBR materials with optional GLTF model loading fallback
 */
export class Cessna172 {
  constructor(pfdCanvas = null, ndCanvas = null) {
    this.group = new THREE.Group();
    this.group.name = 'Aircraft_Cessna172';

    this.pfdCanvas = pfdCanvas;
    this.ndCanvas = ndCanvas;

    // Model and mode states
    this.useGltf = false;
    this.loadingGltf = false;
    this.modelLoaded = false;
    this.isCockpit = false;
    this.isCrashed = false;
    this.lightsOn = true;

    // GLTF references
    this.gltfModel = null;
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.name = 'GLTF_Cessna172';
    this.gltfGroup.visible = false;
    this.group.add(this.gltfGroup);
    this.gltfControlSurfaces = [];
    this.gltfPropellers = [];

    // Procedural hierarchy groups
    this.proceduralGroup = new THREE.Group();
    this.proceduralGroup.name = 'Procedural_Cessna172';
    this.group.add(this.proceduralGroup);

    this.fuselageGroup = new THREE.Group();
    this.wingGroup = new THREE.Group();
    this.tailGroup = new THREE.Group();
    this.gearGroup = new THREE.Group();
    this.propellerGroup = new THREE.Group();
    this.lightsGroup = new THREE.Group();

    this.proceduralGroup.add(this.fuselageGroup);
    this.proceduralGroup.add(this.wingGroup);
    this.proceduralGroup.add(this.tailGroup);
    this.proceduralGroup.add(this.gearGroup);
    this.proceduralGroup.add(this.propellerGroup);
    this.group.add(this.lightsGroup);

    // Control surfaces references
    this.aileronL = null;
    this.aileronR = null;
    this.flapL = null;
    this.flapR = null;
    this.elevatorL = null;
    this.elevatorR = null;
    this.rudder = null;
    this.noseFork = null;

    // Propeller elements
    this.propSpinner = null;
    this.propBlades = [];
    this.propBlurDisk = null;
    this.propAngle = 0;

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
      syncDaylight: () => {},
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

    // Build the procedural 3D model
    this.initProceduralModel();

    // Attempt to load GLTF if available
    this.loadGltfModel(`${import.meta.env?.BASE_URL ?? '/'}models/c172.glb`);
  }

  initProceduralModel() {
    // 1. PBR Materials
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf4f5f7,
      roughness: 0.32,
      metalness: 0.12,
      name: 'C172_Paint_White'
    });

    const crimsonMat = new THREE.MeshStandardMaterial({
      color: 0x9b1b1b,
      roughness: 0.35,
      metalness: 0.18,
      name: 'C172_Paint_Stripe'
    });

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x121b24,
      roughness: 0.1,
      metalness: 0.85,
      transparent: true,
      opacity: 0.65,
      name: 'C172_Glass'
    });

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x181818,
      roughness: 0.82,
      metalness: 0.1,
      name: 'C172_DarkRubber'
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd8dcde,
      roughness: 0.2,
      metalness: 0.88,
      name: 'C172_Chrome'
    });

    this.buildFuselage(whiteMat, crimsonMat, glassMat);
    this.buildWings(whiteMat, crimsonMat);
    this.buildTail(whiteMat, crimsonMat);
    this.buildLandingGear(whiteMat, chromeMat, darkMat);
    this.buildPropeller(whiteMat, darkMat, chromeMat);
    this.buildLights();

    // Enable shadows across all procedural meshes
    this.proceduralGroup.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  buildFuselage(whiteMat, crimsonMat, glassMat) {
    // Cabin core (tapered box/cylinder)
    const cabinGeo = new THREE.BoxGeometry(1.05, 1.15, 2.2);
    const cabinMesh = new THREE.Mesh(cabinGeo, whiteMat);
    cabinMesh.position.set(0, 0.25, -0.2);
    this.fuselageGroup.add(cabinMesh);

    // Engine Cowling (nose section tapering forward to spinner)
    const cowlGeo = new THREE.CylinderGeometry(0.44, 0.52, 1.2, 16);
    cowlGeo.rotateX(Math.PI / 2);
    const cowlMesh = new THREE.Mesh(cowlGeo, whiteMat);
    cowlMesh.position.set(0, 0.15, -1.8);
    this.fuselageGroup.add(cowlMesh);

    // Front nose intake / grill
    const grillGeo = new THREE.CylinderGeometry(0.38, 0.44, 0.15, 16);
    grillGeo.rotateX(Math.PI / 2);
    const grillMesh = new THREE.Mesh(grillGeo, crimsonMat);
    grillMesh.position.set(0, 0.15, -2.4);
    this.fuselageGroup.add(grillMesh);

    // Windshield (angled forward glass)
    const windshieldGeo = new THREE.PlaneGeometry(0.95, 0.8);
    windshieldGeo.rotateX(-Math.PI / 3.2);
    const windshieldMesh = new THREE.Mesh(windshieldGeo, glassMat);
    windshieldMesh.position.set(0, 0.65, -1.15);
    this.fuselageGroup.add(windshieldMesh);

    // Side windows (pilot & copilot)
    const sideWinGeo = new THREE.PlaneGeometry(1.4, 0.45);
    const sideWinL = new THREE.Mesh(sideWinGeo, glassMat);
    sideWinL.rotation.y = -Math.PI / 2;
    sideWinL.position.set(-0.535, 0.45, -0.2);
    this.fuselageGroup.add(sideWinL);

    const sideWinR = sideWinL.clone();
    sideWinR.rotation.y = Math.PI / 2;
    sideWinR.position.set(0.535, 0.45, -0.2);
    this.fuselageGroup.add(sideWinR);

    // Rear fuselage / tailcone (tapers from cabin to tail)
    const tailconeGeo = new THREE.CylinderGeometry(0.18, 0.52, 3.2, 12);
    tailconeGeo.rotateX(Math.PI / 2);
    const tailconeMesh = new THREE.Mesh(tailconeGeo, whiteMat);
    tailconeMesh.position.set(0, 0.35, 2.4);
    this.fuselageGroup.add(tailconeMesh);

    // Decorative sport stripe running along fuselage
    const stripeGeo = new THREE.BoxGeometry(1.07, 0.10, 3.8);
    const stripeMesh = new THREE.Mesh(stripeGeo, crimsonMat);
    stripeMesh.position.set(0, 0.15, 0.5);
    this.fuselageGroup.add(stripeMesh);
  }

  buildWings(whiteMat, crimsonMat) {
    // High-wing main wing: span 11.0m, chord 1.45m, thickness 0.16m
    const wingGeo = new THREE.BoxGeometry(11.0, 0.14, 1.45);
    const wingMesh = new THREE.Mesh(wingGeo, whiteMat);
    wingMesh.position.set(0, 0.92, -0.3);
    this.wingGroup.add(wingMesh);

    // Wingtips with crimson color accents
    const tipGeo = new THREE.BoxGeometry(0.2, 0.13, 1.4);
    const tipL = new THREE.Mesh(tipGeo, crimsonMat);
    tipL.position.set(-5.5, 0.92, -0.3);
    this.wingGroup.add(tipL);

    const tipR = tipL.clone();
    tipR.position.set(5.5, 0.92, -0.3);
    this.wingGroup.add(tipR);

    // High-wing diagonal lift struts (Left and Right)
    const strutGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.5, 8);
    // Left strut
    const strutL = new THREE.Mesh(strutGeo, whiteMat);
    strutL.position.set(-1.6, 0.35, -0.3);
    strutL.rotation.z = 0.52; // Angled outward from cabin base to mid-wing
    this.wingGroup.add(strutL);

    // Right strut
    const strutR = new THREE.Mesh(strutGeo, whiteMat);
    strutR.position.set(1.6, 0.35, -0.3);
    strutR.rotation.z = -0.52;
    this.wingGroup.add(strutR);

    // Articulated Control Surfaces: Ailerons (outer trailing edges)
    const aileronGeo = new THREE.BoxGeometry(1.8, 0.05, 0.28);
    // Shift geometry so hinge pivot is along forward edge
    aileronGeo.translate(0, 0, 0.14);

    this.aileronL = new THREE.Mesh(aileronGeo, whiteMat);
    this.aileronL.position.set(-4.2, 0.91, 0.42);
    this.wingGroup.add(this.aileronL);

    this.aileronR = new THREE.Mesh(aileronGeo, whiteMat);
    this.aileronR.position.set(4.2, 0.91, 0.42);
    this.wingGroup.add(this.aileronR);

    // Flaps (inner trailing edges)
    const flapGeo = new THREE.BoxGeometry(1.9, 0.06, 0.32);
    flapGeo.translate(0, 0, 0.16);

    this.flapL = new THREE.Mesh(flapGeo, whiteMat);
    this.flapL.position.set(-1.8, 0.89, 0.42);
    this.wingGroup.add(this.flapL);

    this.flapR = new THREE.Mesh(flapGeo, whiteMat);
    this.flapR.position.set(1.8, 0.89, 0.42);
    this.wingGroup.add(this.flapR);
  }

  buildTail(whiteMat, crimsonMat) {
    // Vertical fin (swept back)
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.9, 0);
    finShape.lineTo(0.3, 1.45);
    finShape.lineTo(0.0, 1.45);
    finShape.closePath();

    const extrudeSettings = { depth: 0.08, bevelEnabled: false };
    const finGeo = new THREE.ExtrudeGeometry(finShape, extrudeSettings);
    finGeo.center();
    finGeo.rotateY(Math.PI / 2);

    const finMesh = new THREE.Mesh(finGeo, crimsonMat);
    finMesh.position.set(0, 1.15, 3.45);
    this.tailGroup.add(finMesh);

    // Rudder (hinged at trailing edge of fin)
    const rudderGeo = new THREE.BoxGeometry(0.06, 1.35, 0.35);
    rudderGeo.translate(0, 0, 0.17); // Pivot on forward edge

    this.rudder = new THREE.Mesh(rudderGeo, whiteMat);
    this.rudder.position.set(0, 1.15, 3.85);
    this.tailGroup.add(this.rudder);

    // Horizontal stabilizer (span 3.4m)
    const stabGeo = new THREE.BoxGeometry(3.4, 0.08, 0.75);
    const stabMesh = new THREE.Mesh(stabGeo, whiteMat);
    stabMesh.position.set(0, 0.52, 3.8);
    this.tailGroup.add(stabMesh);

    // Left and Right Elevators
    const elevGeo = new THREE.BoxGeometry(1.55, 0.05, 0.30);
    elevGeo.translate(0, 0, 0.15); // Pivot on leading edge

    this.elevatorL = new THREE.Mesh(elevGeo, whiteMat);
    this.elevatorL.position.set(-0.85, 0.52, 4.18);
    this.tailGroup.add(this.elevatorL);

    this.elevatorR = new THREE.Mesh(elevGeo, whiteMat);
    this.elevatorR.position.set(0.85, 0.52, 4.18);
    this.tailGroup.add(this.elevatorR);
  }

  buildLandingGear(whiteMat, chromeMat, darkMat) {
    // 1. Steerable Nose Gear Assembly (x: 0, y: -0.6 to -1.1, z: -1.5)
    this.noseFork = new THREE.Group();
    this.noseFork.position.set(0, -0.6, -1.5);
    this.gearGroup.add(this.noseFork);

    // Nose oleo strut
    const noseStrutGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8);
    const noseStrut = new THREE.Mesh(noseStrutGeo, chromeMat);
    noseStrut.position.set(0, -0.25, 0);
    this.noseFork.add(noseStrut);

    // Nose wheel pant / fairing
    const nosePantGeo = new THREE.BoxGeometry(0.18, 0.28, 0.5);
    const nosePant = new THREE.Mesh(nosePantGeo, whiteMat);
    nosePant.position.set(0, -0.5, 0);
    this.noseFork.add(nosePant);

    // Nose tire (partially exposed under fairing)
    const noseTireGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.10, 12);
    noseTireGeo.rotateZ(Math.PI / 2);
    const noseTire = new THREE.Mesh(noseTireGeo, darkMat);
    noseTire.position.set(0, -0.52, 0);
    this.noseFork.add(noseTire);

    // 2. Main Gear Legs (Fixed Spring Steel, Left & Right)
    const makeMainLeg = (isLeft) => {
      const legGroup = new THREE.Group();
      const sign = isLeft ? -1 : 1;

      // Spring steel strut extending outward & downward
      const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8);
      const legMesh = new THREE.Mesh(legGeo, whiteMat);
      legMesh.position.set(sign * 0.52, -0.65, 0.4);
      legMesh.rotation.z = sign * 0.58;
      legGroup.add(legMesh);

      // Aerodynamic wheel pant
      const pantGeo = new THREE.BoxGeometry(0.24, 0.35, 0.65);
      const pantMesh = new THREE.Mesh(pantGeo, whiteMat);
      pantMesh.position.set(sign * 1.05, -1.15, 0.4);
      legGroup.add(pantMesh);

      // Main tire
      const tireGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.14, 14);
      tireGeo.rotateZ(Math.PI / 2);
      const tireMesh = new THREE.Mesh(tireGeo, darkMat);
      tireMesh.position.set(sign * 1.05, -1.18, 0.4);
      legGroup.add(tireMesh);

      return legGroup;
    };

    this.gearGroup.add(makeMainLeg(true));
    this.gearGroup.add(makeMainLeg(false));
  }

  buildPropeller(whiteMat, darkMat, chromeMat) {
    // Spinner & propeller hub at front of nose cowl
    this.propellerGroup.position.set(0, 0.15, -2.48);

    // Polished conical spinner
    const spinnerGeo = new THREE.ConeGeometry(0.20, 0.42, 16);
    spinnerGeo.rotateX(-Math.PI / 2);
    this.propSpinner = new THREE.Mesh(spinnerGeo, chromeMat);
    this.propSpinner.position.set(0, 0, -0.2);
    this.propellerGroup.add(this.propSpinner);

    // Two pitched propeller blades (diameter ~1.9m)
    const bladeGeo = new THREE.BoxGeometry(0.12, 1.85, 0.02);
    const blade1 = new THREE.Mesh(bladeGeo, darkMat);
    blade1.rotation.y = 0.25; // Pitch angle
    this.propellerGroup.add(blade1);
    this.propBlades.push(blade1);

    // White tips on propeller blades for visibility
    const bladeTipGeo = new THREE.BoxGeometry(0.13, 0.15, 0.025);
    const tipTop = new THREE.Mesh(bladeTipGeo, whiteMat);
    tipTop.position.set(0, 0.85, 0);
    blade1.add(tipTop);

    const tipBtm = new THREE.Mesh(bladeTipGeo, whiteMat);
    tipBtm.position.set(0, -0.85, 0);
    blade1.add(tipBtm);

    // Propeller blur disk (activates at high RPM)
    const blurGeo = new THREE.RingGeometry(0.2, 0.95, 24);
    const blurMat = new THREE.MeshBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide
    });
    this.propBlurDisk = new THREE.Mesh(blurGeo, blurMat);
    this.propBlurDisk.position.set(0, 0, -0.05);
    this.propellerGroup.add(this.propBlurDisk);
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
    if (typeof window === 'undefined') return;
    this.loadingGltf = true;

    try {
      const dracoLoader = new DRACOLoader();
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
              node.castShadow = true;
              node.receiveShadow = true;

              const mat = node.material;
              const matName = Array.isArray(mat) ? mat.map(m => m.name).join(' ') : (mat?.name || '');

              // Occlude static ground parking / mooring artifacts
              if (matName.includes('Concrete') || matName.includes('remove_before_flight')) {
                node.visible = false;
              }
            }

            // Hide ground mooring / chock bar
            if (node.name === 'Circle.005_49' || node.name === 'Cube.010_50' ||
                node.name === 'Circle.002_32' || node.name === 'Plane.030_34' || node.name === 'Plane.031_35') {
              node.visible = false;
            }

            // Bind propeller components (spinner and blades)
            if (node.name === 'Plane_16' || node.name === 'Plane.011_13') {
              node.userData.initialRotZ = node.rotation.z;
              this.gltfPropellers.push(node);
            }
          });

          this.cockpit.gltfYokes = [];
          this.cockpit.cockpitModelFailed = false;
          this.cockpit.gltfCockpitGroup = this.gltfModel;

          // Mount live real-time flight displays onto the Garmin G1000 instrument panel
          if (this.pfdCanvas && this.ndCanvas) {
            const createDisplayMat = (canvas) => new THREE.MeshBasicMaterial({
              map: canvas.texture,
              toneMapped: false,
              polygonOffset: true,
              polygonOffsetFactor: -1.0,
              polygonOffsetUnits: -2.0
            });

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
          this.useGltf = true;
          this.modelLoaded = true;
          this.loadingGltf = false;
          this.gltfGroup.visible = true;
          this.proceduralGroup.visible = false;

          if (typeof this.cockpit.onModelReady === 'function') {
            this.cockpit.onModelReady();
          }
        },
        undefined,
        err => {
          // Fallback gracefully to high-detail procedural model
          console.warn('C172 GLTF model failed to load, falling back to procedural airframe:', err);
          this.useGltf = false;
          this.loadingGltf = false;
          this.modelLoaded = false;
          this.cockpit.cockpitModelFailed = true;
          this.gltfGroup.visible = false;
          this.proceduralGroup.visible = true;
        }
      );
    } catch (err) {
      this.useGltf = false;
      this.loadingGltf = false;
      this.modelLoaded = false;
      this.cockpit.cockpitModelFailed = true;
      this.gltfGroup.visible = false;
      this.proceduralGroup.visible = true;
    }
  }

  update(dt, flightState = {}) {
    if (this.isCrashed) return;

    const n1 = flightState.engine1?.n1 ?? flightState.engine1N1 ?? 25.0; // Piston engine RPM indicator
    const aileron = flightState.aileron ?? 0.0;
    const elevator = flightState.elevator ?? 0.0;
    const rudder = flightState.rudder ?? 0.0;
    const flapDeg = flightState.flapDegree ?? 0.0;
    const onGround = flightState.onGround ?? false;

    // 1. Propeller Rotation
    // Idle (~650 RPM) to TOGA (~2700 RPM) -> angular speed ~68 to 282 rad/s
    const rpmFraction = Math.max(0.2, n1 / 100.0);
    const angularSpeed = 70.0 + rpmFraction * 200.0;
    this.propAngle += angularSpeed * dt;

    if (this.useGltf && this.gltfPropellers.length > 0) {
      for (const prop of this.gltfPropellers) {
        prop.rotation.z = (prop.userData.initialRotZ ?? 0) + this.propAngle;
      }
    } else {
      this.propellerGroup.rotation.z = this.propAngle;

      // Propeller blur disk opacity
      if (this.propBlurDisk) {
        const blurMat = this.propBlurDisk.material;
        if (rpmFraction > 0.4) {
          blurMat.opacity = Math.min(0.35, (rpmFraction - 0.4) * 0.6);
          for (const b of this.propBlades) b.visible = rpmFraction < 0.85;
        } else {
          blurMat.opacity = 0.0;
          for (const b of this.propBlades) b.visible = true;
        }
      }

      // 2. Control Surface Deflections
      // Ailerons (opposite deflections, ~15 deg max)
      // Positive aileron input commands right roll: left aileron trailing edge down (+X), right aileron up (-X)
      const aileronRad = aileron * THREE.MathUtils.degToRad(16.0);
      if (this.aileronL) this.aileronL.rotation.x = aileronRad;
      if (this.aileronR) this.aileronR.rotation.x = -aileronRad;

      // Elevators (pitch control, ~20 deg max)
      const elevRad = -elevator * THREE.MathUtils.degToRad(20.0);
      if (this.elevatorL) this.elevatorL.rotation.x = elevRad;
      if (this.elevatorR) this.elevatorR.rotation.x = elevRad;

      // Rudder (yaw control, ~22 deg max)
      const rudderRad = -rudder * THREE.MathUtils.degToRad(22.0);
      if (this.rudder) this.rudder.rotation.y = rudderRad;

      // Flaps (deflects downward 0 to 30 deg)
      const flapRad = THREE.MathUtils.degToRad(flapDeg);
      if (this.flapL) this.flapL.rotation.x = flapRad;
      if (this.flapR) this.flapR.rotation.x = flapRad;

      // Nose Wheel Steering
      if (this.noseFork) {
        this.noseFork.rotation.y = onGround ? -rudder * THREE.MathUtils.degToRad(30.0) : 0.0;
      }
    }

    // 3. Flashing Beacon & Strobes
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
    if (this.useGltf && this.gltfGroup) {
      // The unified GLTF model contains both the exterior and 3D cockpit.
      // Keep it visible so the pilot sees instruments, yokes, engine cowl, and wings.
      this.gltfGroup.visible = true;
    } else {
      // In procedural model, hide fuselage outer shell to prevent camera clipping
      if (this.fuselageGroup) this.fuselageGroup.visible = !isCockpit;
    }
    if (this.cockpit && this.cockpit.group) {
      this.cockpit.group.visible = isCockpit && showInterior;
    }
  }

  triggerCrashVisuals(collisionType) {
    this.isCrashed = true;
    if (this.lightsGroup) this.lightsGroup.visible = false;
  }

  resetCrashVisuals() {
    this.isCrashed = false;
    if (this.lightsGroup) this.lightsGroup.visible = this.lightsOn;
    if (this.proceduralGroup) {
      this.proceduralGroup.visible = !this.useGltf;
    }
    if (this.gltfGroup) {
      this.gltfGroup.visible = this.useGltf;
    }
  }
}
