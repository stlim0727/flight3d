import { batchStaticCockpit } from './StaticCockpitBatch.js';
import { bindGltfYokes, updateGltfYokes, bindGltfEngineControls, updateGltfEngineControls } from './GltfCockpitControls.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MCPCanvas } from './MCPCanvas.js';
import { ISFDCanvas } from './ISFDCanvas.js';
import { CDUCanvas } from './CDUCanvas.js';
import { CockpitChecklistCanvas } from './CockpitChecklistCanvas.js';

/**
 * Helper to safely load textures in both Browser and Node.js environments
 */
function loadTextureSafe(url) {
  if (typeof window === 'undefined') {
    return new THREE.Texture();
  }
  const loader = new THREE.TextureLoader();
  const tex = loader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 3D Virtual Cockpit for Boeing Airliner (Photorealistic PBR Enhanced)
 * Features high-resolution photo-based PBR textures, display unit bezels with rotary brightness knobs,
 * dual animated control yokes with approach chart clipboards, molded Boeing throttle quadrant with reverse latches,
 * speedbrake & gated flap selector, dual striped trim wheels, 3-green landing gear unit, flap dial,
 * authentic forward overhead panel with night illumination, windshield wipers, and warm Boeing amber floodlighting.
 */
export class Cockpit {
  constructor(pfdCanvas, ndCanvas, eicasCanvas, mcpCanvas = null, isfdCanvas = null, cduCanvas = null) {
    this.group = new THREE.Group();
    this.pfdCanvas = pfdCanvas;
    this.ndCanvas = ndCanvas;
    this.eicasCanvas = eicasCanvas;
    this.mcpCanvas = mcpCanvas || new MCPCanvas(1024, 128);
    this.isfdCanvas = isfdCanvas || new ISFDCanvas(256, 256);
    this.cduCanvas = cduCanvas || new CDUCanvas(512, 512);
    this.checklistCanvas = new CockpitChecklistCanvas(512, 768);

    // 3D GLTF Cockpit Asset group (primary) & Procedural Cockpit group (fallback)
    this.gltfCockpitGroup = new THREE.Group();
    this.gltfCockpitGroup.name = 'GLTF_Cockpit';
    this.group.add(this.gltfCockpitGroup);
    this.gltfCockpitModel = null;
    this.gltfCockpitLoaded = false;
    this.cockpitModelLoading = false;
    this.gltfDisplays = null;
    this.gltfCockpitFraming = null;
    this.gltfGlassPanels = [];
    this.gltfCeilingTrim = null;
    this.gltfCompassBracket = null;
    this.yokesVisible = true;

    this.proceduralCockpitGroup = new THREE.Group();
    this.proceduralCockpitGroup.name = 'Procedural_Cockpit';
    this.group.add(this.proceduralCockpitGroup);

    // Cockpit eye viewpoint (Captain's seat eye position in local aircraft space)
    this.captainEyePos = new THREE.Vector3(-0.48, 0.94, -12.08);

    // Dynamic instruments references
    this.gearLever = null;
    this.gearLights = [];
    this.gearLightMats = null;
    this.flapGaugeNeedle = null;

    // Control surfaces references
    this.captainYoke = null;
    this.foYoke = null;
    this.pedalLeft = null;
    this.pedalRight = null;
    this.throttle1 = null;
    this.throttle2 = null;
    this.flapLever = null;
    this.spoilerLever = null;
    this.trimWheelL = null;
    this.trimWheelR = null;

    this.initCockpit();
  }

  initCockpit() {
    // 1. High-Resolution Photorealistic PBR Textures
    this.overheadTex = loadTextureSafe(`${import.meta.env?.BASE_URL ?? '/'}textures/cockpit/b737_overhead.jpg`);
    this.mipTex = loadTextureSafe(`${import.meta.env?.BASE_URL ?? '/'}textures/cockpit/b737_mip.jpg`);
    this.pedestalTex = loadTextureSafe(`${import.meta.env?.BASE_URL ?? '/'}textures/cockpit/b737_pedestal.jpg`);
    this.yokeTex = loadTextureSafe(`${import.meta.env?.BASE_URL ?? '/'}textures/cockpit/b737_yoke.jpg`);
    this.mcpTex = loadTextureSafe(`${import.meta.env?.BASE_URL ?? '/'}textures/cockpit/b737_mcp.jpg`);

    // 2. High-Fidelity PBR Materials
    const darkInteriorMat = new THREE.MeshStandardMaterial({
      color: 0x161b22,
      roughness: 0.88,
      metalness: 0.15
    });

    const glareshieldMat = new THREE.MeshStandardMaterial({
      color: 0x12151a,
      roughness: 0.95,
      metalness: 0.05
    });

    const boeingGreyMat = new THREE.MeshStandardMaterial({
      color: 0x36404c,
      roughness: 0.55,
      metalness: 0.35
    });

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x82919e,
      roughness: 0.35,
      metalness: 0.85
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.12,
      metalness: 0.95
    });

    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x181c22,
      roughness: 0.90,
      metalness: 0.05
    });

    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x22272f,
      roughness: 0.45,
      metalness: 0.65
    });

    const knobMat = new THREE.MeshStandardMaterial({
      color: 0x2d3540,
      roughness: 0.35,
      metalness: 0.75
    });

    // Glass windshield material (clean non-refractive transparent material)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x90b8d0,
      transparent: true,
      opacity: 0.10,
      roughness: 0.06,
      metalness: 0.25,
      depthWrite: false
    });

    // 3. Cockpit Floor
    const floorGeo = new THREE.BoxGeometry(2.4, 0.08, 2.6);
    const floor = new THREE.Mesh(floorGeo, darkInteriorMat);
    floor.position.set(0, 0.04, -12.0);
    this.proceduralCockpitGroup.add(floor);

    // 4. Rear Bulkhead Wall & Door (behind pilot at z = -10.8)
    const bulkheadGeo = new THREE.BoxGeometry(2.4, 1.9, 0.08);
    const bulkhead = new THREE.Mesh(bulkheadGeo, darkInteriorMat);
    bulkhead.position.set(0, 0.95, -10.75);
    this.proceduralCockpitGroup.add(bulkhead);

    // 5. Glare Shield Hood (Sculpted sun visor brow sloping from base of windshield forward to MCP)
    const glareGeo = new THREE.BoxGeometry(2.14, 0.028, 0.22);
    const glareShield = new THREE.Mesh(glareGeo, glareshieldMat);
    glareShield.position.set(0, 0.65, -12.62);
    glareShield.rotation.x = 0.12;
    this.proceduralCockpitGroup.add(glareShield);

    // Glareshield front lip / beveled brow
    const browLip = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.045, 0.04), glareshieldMat);
    browLip.position.set(0, 0.61, -12.53);
    this.proceduralCockpitGroup.add(browLip);

    // MCP (Mode Control Panel) mounted on the front face of the glareshield brow
    const mcpBackGeo = new THREE.BoxGeometry(1.74, 0.10, 0.02);
    const mcpBackMesh = new THREE.Mesh(mcpBackGeo, darkInteriorMat);
    mcpBackMesh.position.set(0, 0.545, -12.56);
    mcpBackMesh.rotation.x = -0.15;
    this.proceduralCockpitGroup.add(mcpBackMesh);

    const mcpGeo = new THREE.PlaneGeometry(1.72, 0.098);
    const mcpMat = new THREE.MeshBasicMaterial({ map: this.mcpCanvas.texture });
    this.mcpMesh = new THREE.Mesh(mcpGeo, mcpMat);
    this.mcpMesh.position.set(0, 0.545, -12.548);
    this.mcpMesh.rotation.x = -0.15;
    this.proceduralCockpitGroup.add(this.mcpMesh);

    // 6. Main Instrument Panel (MIP)
    const mipGeo = new THREE.BoxGeometry(2.12, 0.40, 0.04);
    const mipMesh = new THREE.Mesh(mipGeo, boeingGreyMat);
    mipMesh.position.set(0, 0.30, -12.60);
    mipMesh.rotation.x = -0.10;
    this.proceduralCockpitGroup.add(mipMesh);

    // Photorealistic MIP Texture Faceplate Overlay (with subtle warm backlight)
    const mipPlateGeo = new THREE.PlaneGeometry(2.10, 0.395);
    const mipPlateMat = new THREE.MeshStandardMaterial({
      map: this.mipTex,
      roughness: 0.50,
      metalness: 0.30,
      emissive: 0xffffff,
      emissiveMap: this.mipTex,
      emissiveIntensity: 0.08
    });
    const mipPlate = new THREE.Mesh(mipPlateGeo, mipPlateMat);
    mipPlate.position.set(0, 0.30, -12.578);
    mipPlate.rotation.x = -0.10;
    this.proceduralCockpitGroup.add(mipPlate);

    // Windshield Pillars, Compass & Wipers
    this.buildWindshield(glassMat, darkInteriorMat, metalMat);

    // Flight Displays with High-Detail Bezel Frames & Knobs
    this.buildFlightDisplays(boeingGreyMat, bezelMat, knobMat, metalMat, chromeMat);

    // Center Console, CDUs & High-Detail Throttle Pedestal
    this.buildPedestal(boeingGreyMat, metalMat, chromeMat);

    // Dual Boeing Control Yokes (Captain & First Officer with Approach Chart Clipboards)
    this.buildYokes(boeingGreyMat, metalMat, chromeMat);

    // Rudder Pedals
    this.buildRudderPedals(metalMat);

    // Pilot & Copilot Seats
    this.buildSeats(leatherMat, boeingGreyMat);

    // High-Resolution Forward Overhead Panel (sloping over pilots)
    this.buildOverheadPanel(boeingGreyMat);

    // Boeing Authentic Flight Deck Lighting:
    // 1. Glareshield Underside Amber Integral Floodlight (illuminates MIP with authentic warm amber glow)
    this.glareshieldFlood = new THREE.PointLight(0xffa84c, 1.2, 2.2);
    this.glareshieldFlood.position.set(0, 0.48, -12.45);
    this.group.add(this.glareshieldFlood);

    // 2. Center Pedestal Floodlight (amber illumination for CDUs and throttle quadrant)
    this.pedestalFlood = new THREE.PointLight(0xffb55e, 1.6, 2.2);
    this.pedestalFlood.position.set(0, 0.50, -12.05);
    this.group.add(this.pedestalFlood);

    // 3. Cabin Overhead Fill Dome Light
    this.cockpitLight = new THREE.PointLight(0xffeedd, 0.8, 3.5);
    this.cockpitLight.position.set(0, 1.15, -12.1);
    this.group.add(this.cockpitLight);

    // 7. Asynchronous High-Detail 3D GLTF Cockpit Asset Loading with Live Instruments
    this.loadCockpitModel();
  }

  buildWindshield(glassMat, frameMat, metalMat) {
    // Left Front Windshield Glass
    const frontL = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.52), glassMat);
    frontL.position.set(-0.45, 0.95, -12.82);
    frontL.rotation.set(-0.38, 0.20, -0.06);
    this.proceduralCockpitGroup.add(frontL);

    // Right Front Windshield Glass
    const frontR = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.52), glassMat);
    frontR.position.set(0.45, 0.95, -12.82);
    frontR.rotation.set(-0.38, -0.20, 0.06);
    this.proceduralCockpitGroup.add(frontR);

    // Center Windshield Center Post (Mullion)
    const postCenter = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.65, 0.07), frameMat);
    postCenter.position.set(0, 0.95, -12.82);
    postCenter.rotation.x = -0.38;
    this.proceduralCockpitGroup.add(postCenter);

    // Standby Magnetic Compass mounted on Center Post
    const compassGroup = new THREE.Group();
    compassGroup.position.set(0, 1.05, -12.72);
    const compassBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.035, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e242c, roughness: 0.5 })
    );
    compassBody.rotation.x = Math.PI * 0.5;
    const compassFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.020, 16),
      new THREE.MeshBasicMaterial({ color: 0x0f172a })
    );
    compassFace.position.z = 0.018;
    compassGroup.add(compassBody, compassFace);
    this.proceduralCockpitGroup.add(compassGroup);

    // Left A-Pillar (angled windshield corner beam)
    const postLeft = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.68, 0.07), frameMat);
    postLeft.position.set(-0.88, 0.96, -12.72);
    postLeft.rotation.set(-0.32, 0.25, -0.20);
    this.proceduralCockpitGroup.add(postLeft);

    // Right A-Pillar (angled windshield corner beam)
    const postRight = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.68, 0.07), frameMat);
    postRight.position.set(0.88, 0.96, -12.72);
    postRight.rotation.set(-0.32, -0.25, 0.20);
    this.proceduralCockpitGroup.add(postRight);

    // Top Roof Windshield Header Beam
    const roofHeader = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.08, 0.12), frameMat);
    roofHeader.position.set(0, 1.22, -12.68);
    roofHeader.rotation.x = 0.05;
    this.proceduralCockpitGroup.add(roofHeader);

    // Lower Windshield Glareshield Sill Beam
    const sillBeam = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.06, 0.08), frameMat);
    sillBeam.position.set(0, 0.68, -12.72);
    this.proceduralCockpitGroup.add(sillBeam);

    // Windshield Wipers parked neatly along lower windshield sill
    const buildWiper = (xBase, isLeft) => {
      const wiperGroup = new THREE.Group();
      wiperGroup.position.set(xBase, 0.70, -12.70);
      wiperGroup.rotation.x = -0.38;

      // Motor pivot hub
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), metalMat);
      hub.rotation.x = Math.PI * 0.5;

      // Wiper articulated arm
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.26, 8), frameMat);
      arm.position.set(isLeft ? -0.12 : 0.12, 0.08, 0.01);
      arm.rotation.z = isLeft ? 1.15 : -1.15;

      // Rubber wiper blade
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, 0.32, 0.008),
        new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.9 })
      );
      blade.position.set(isLeft ? -0.18 : 0.18, 0.14, 0.015);
      blade.rotation.z = isLeft ? 1.15 : -1.15;

      wiperGroup.add(hub, arm, blade);
      return wiperGroup;
    };

    this.proceduralCockpitGroup.add(buildWiper(-0.25, true));
    this.proceduralCockpitGroup.add(buildWiper(0.25, false));

    // Left Side Window
    const sideL = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.48), glassMat);
    sideL.position.set(-0.95, 0.96, -12.5);
    sideL.rotation.set(-0.15, 1.05, 0);
    this.proceduralCockpitGroup.add(sideL);

    // Right Side Window
    const sideR = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.48), glassMat);
    sideR.position.set(0.95, 0.96, -12.5);
    sideR.rotation.set(-0.15, -1.05, 0);
    this.proceduralCockpitGroup.add(sideR);
  }

  /**
   * Builds high-detail Collins/Honeywell Display Unit (DU) bezels around flight screens
   */
  createDisplayBezel(width, height, bezelMat, knobMat, chromeMat) {
    const bezelGroup = new THREE.Group();
    const frameThick = 0.014;
    const depth = 0.012;

    // Top bezel bar
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(width + frameThick * 2, frameThick, depth), bezelMat);
    topBar.position.y = height * 0.5 + frameThick * 0.5;

    // Bottom bezel bar
    const botBar = new THREE.Mesh(new THREE.BoxGeometry(width + frameThick * 2, frameThick, depth), bezelMat);
    botBar.position.y = -(height * 0.5 + frameThick * 0.5);

    // Left bezel bar
    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, height, depth), bezelMat);
    leftBar.position.x = -(width * 0.5 + frameThick * 0.5);

    // Right bezel bar
    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, height, depth), bezelMat);
    rightBar.position.x = width * 0.5 + frameThick * 0.5;

    bezelGroup.add(topBar, botBar, leftBar, rightBar);

    // Corner mounting screws (4 chrome hex screws)
    const screwGeo = new THREE.CylinderGeometry(0.0028, 0.0028, 0.004, 8);
    screwGeo.rotateX(Math.PI * 0.5);
    const corners = [
      [-width * 0.5 - 0.004, height * 0.5 + 0.004],
      [width * 0.5 + 0.004, height * 0.5 + 0.004],
      [-width * 0.5 - 0.004, -height * 0.5 - 0.004],
      [width * 0.5 + 0.004, -height * 0.5 - 0.004]
    ];
    for (const [cx, cy] of corners) {
      const screw = new THREE.Mesh(screwGeo, chromeMat);
      screw.position.set(cx, cy, depth * 0.5 + 0.001);
      bezelGroup.add(screw);
    }

    // Rotary brightness knobs at bottom corners
    const knobGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 12);
    knobGeo.rotateX(Math.PI * 0.5);
    const knobL = new THREE.Mesh(knobGeo, knobMat);
    knobL.position.set(-width * 0.5 + 0.02, -height * 0.5 - frameThick * 0.5, depth * 0.5 + 0.003);
    const knobR = new THREE.Mesh(knobGeo, knobMat);
    knobR.position.set(width * 0.5 - 0.02, -height * 0.5 - frameThick * 0.5, depth * 0.5 + 0.003);
    bezelGroup.add(knobL, knobR);

    return bezelGroup;
  }

  buildFlightDisplays(boeingGreyMat, bezelMat, knobMat, metalMat, chromeMat) {
    const pfdMat = new THREE.MeshBasicMaterial({ map: this.pfdCanvas.texture });
    const ndMat = new THREE.MeshBasicMaterial({ map: this.ndCanvas.texture });
    const eicasMat = new THREE.MeshBasicMaterial({ map: this.eicasCanvas.texture });
    const isfdMat = new THREE.MeshBasicMaterial({ map: this.isfdCanvas.texture });

    const screenGeo = new THREE.PlaneGeometry(0.20, 0.20);
    const mipRotX = -0.10;
    const dispZ = -12.570;

    // Helper to add a screen along with its modeled 3D DU bezel
    const addDisplayWithBezel = (x, y, mat) => {
      const screenMesh = new THREE.Mesh(screenGeo, mat);
      screenMesh.position.set(x, y, dispZ);
      screenMesh.rotation.x = mipRotX;

      const bezel = this.createDisplayBezel(0.20, 0.20, bezelMat, knobMat, chromeMat);
      bezel.position.set(x, y, dispZ + 0.004);
      bezel.rotation.x = mipRotX;

      this.proceduralCockpitGroup.add(screenMesh, bezel);
      return screenMesh;
    };

    // 1. Captain PFD (Outboard left)
    this.pfdScreen = addDisplayWithBezel(-0.48, 0.32, pfdMat);

    // 2. Captain ND (Inboard left)
    this.ndScreen = addDisplayWithBezel(-0.24, 0.32, ndMat);

    // 3. Standby ISFD (Integrated Standby Flight Display, center-left)
    const isfdGeo = new THREE.PlaneGeometry(0.10, 0.10);
    this.isfdScreen = new THREE.Mesh(isfdGeo, isfdMat);
    this.isfdScreen.position.set(-0.06, 0.36, dispZ);
    this.isfdScreen.rotation.x = mipRotX;
    const isfdBezel = this.createDisplayBezel(0.10, 0.10, bezelMat, knobMat, chromeMat);
    isfdBezel.position.set(-0.06, 0.36, dispZ + 0.004);
    isfdBezel.rotation.x = mipRotX;
    this.proceduralCockpitGroup.add(this.isfdScreen, isfdBezel);

    // 4. Center Upper EICAS
    this.eicasScreen = addDisplayWithBezel(0.11, 0.32, eicasMat);

    // 5. Landing Gear Lever & 3-Green Annunciators on Center MIP (x = 0.27)
    const gearModuleGroup = new THREE.Group();
    gearModuleGroup.position.set(0.27, 0.37, dispZ + 0.006);
    gearModuleGroup.rotation.x = mipRotX;

    // Gear lever base plate
    const gearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.11, 0.012), boeingGreyMat);
    gearModuleGroup.add(gearPlate);

    // 3 Gear indicator lights (Nose, Left, Right)
    const lightMatGreen = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const lightMatAmber = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const lightMatOff = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    this.gearLightMats = { green: lightMatGreen, amber: lightMatAmber, off: lightMatOff };

    const noseLight = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 12), lightMatGreen);
    noseLight.position.set(0, 0.034, 0.007);
    const leftLight = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 12), lightMatGreen);
    leftLight.position.set(-0.018, 0.018, 0.007);
    const rightLight = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 12), lightMatGreen);
    rightLight.position.set(0.018, 0.018, 0.007);
    gearModuleGroup.add(noseLight, leftLight, rightLight);
    this.gearLights = [noseLight, leftLight, rightLight];

    // Landing Gear Handle (Translucent Wheel Knob on Chrome Rod)
    this.gearLever = new THREE.Group();
    this.gearLever.position.set(0, -0.012, 0.012);
    const leverRod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.045, 8), chromeMat);
    leverRod.position.y = -0.018;
    const leverWheelKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.011, 16),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.15, transparent: true, opacity: 0.88 })
    );
    leverWheelKnob.rotation.z = Math.PI * 0.5;
    leverWheelKnob.position.y = -0.040;
    this.gearLever.add(leverRod, leverWheelKnob);
    gearModuleGroup.add(this.gearLever);
    this.proceduralCockpitGroup.add(gearModuleGroup);

    // 6. Flap Position Indicator Gauge (below gear lever at x = 0.27, y = 0.265)
    const flapGaugeGroup = new THREE.Group();
    flapGaugeGroup.position.set(0.27, 0.265, dispZ + 0.006);
    flapGaugeGroup.rotation.x = mipRotX;

    const flapDialBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.033, 0.033, 0.008, 24),
      bezelMat
    );
    flapDialBezel.rotation.x = Math.PI * 0.5;

    const flapDial = new THREE.Mesh(
      new THREE.CircleGeometry(0.030, 24),
      new THREE.MeshBasicMaterial({ color: 0x090d14 })
    );
    flapDial.position.z = 0.005;

    const flapNeedle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.003, 0.024),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    flapNeedle.position.y = 0.010;
    this.flapGaugeNeedle = new THREE.Group();
    this.flapGaugeNeedle.add(flapNeedle);
    this.flapGaugeNeedle.position.z = 0.007;

    flapGaugeGroup.add(flapDialBezel, flapDial, this.flapGaugeNeedle);
    this.proceduralCockpitGroup.add(flapGaugeGroup);

    // 7. Autobrake Rotary Switch Module (to the left of gear unit at x = 0.19)
    const autobrakeGroup = new THREE.Group();
    autobrakeGroup.position.set(0.19, 0.35, dispZ + 0.006);
    autobrakeGroup.rotation.x = mipRotX;
    const abPlate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.008), boeingGreyMat);
    const abKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 12), knobMat);
    abKnob.rotation.x = Math.PI * 0.5;
    abKnob.position.z = 0.008;
    autobrakeGroup.add(abPlate, abKnob);
    this.proceduralCockpitGroup.add(autobrakeGroup);

    // 8. First Officer ND (Inboard right)
    this.foNdScreen = addDisplayWithBezel(0.42, 0.32, ndMat);

    // 9. First Officer PFD (Outboard right)
    this.foPfdScreen = addDisplayWithBezel(0.66, 0.32, pfdMat);
  }

  buildPedestal(pedMat, metalMat, chromeMat) {
    this.pedestalGroup = new THREE.Group();
    this.pedestalGroup.position.set(0, 0.16, -12.22);

    // 1. Pedestal Base Structure
    const baseGeo = new THREE.BoxGeometry(0.50, 0.38, 0.95);
    const baseMesh = new THREE.Mesh(baseGeo, pedMat);
    this.pedestalGroup.add(baseMesh);

    // Photorealistic Pedestal Top Plate
    const topPlateGeo = new THREE.PlaneGeometry(0.46, 0.50);
    const topPlateMat = new THREE.MeshStandardMaterial({
      map: this.pedestalTex,
      roughness: 0.50,
      metalness: 0.30,
      emissive: 0xffd59e,
      emissiveMap: this.pedestalTex,
      emissiveIntensity: 0.09
    });
    const topPlate = new THREE.Mesh(topPlateGeo, topPlateMat);
    topPlate.position.set(0, 0.191, -0.04);
    topPlate.rotation.x = -Math.PI * 0.5;
    this.pedestalGroup.add(topPlate);

    // Aft Radio Control Panels Plate
    const radioPlateGeo = new THREE.PlaneGeometry(0.44, 0.36);
    const radioPlate = new THREE.Mesh(radioPlateGeo, topPlateMat);
    radioPlate.position.set(0, 0.191, 0.28);
    radioPlate.rotation.x = -Math.PI * 0.5;
    this.pedestalGroup.add(radioPlate);

    // 2. Slanted FMC / CDU Mounting Bay (Transition between MIP and pedestal)
    const cduMountGeo = new THREE.BoxGeometry(0.48, 0.26, 0.04);
    const cduMountMesh = new THREE.Mesh(cduMountGeo, pedMat);
    cduMountMesh.position.set(0, 0.24, -0.32);
    cduMountMesh.rotation.x = -0.65; // Slanted 37 degrees toward pilots
    this.pedestalGroup.add(cduMountMesh);

    // Dual FMC / CDU Screens with Bezel Mountings
    const cduMat = new THREE.MeshBasicMaterial({ map: this.cduCanvas.texture });
    const cduGeo = new THREE.PlaneGeometry(0.20, 0.20);

    // Captain CDU (Left)
    this.cduScreenL = new THREE.Mesh(cduGeo, cduMat);
    this.cduScreenL.position.set(-0.13, 0.26, -0.30);
    this.cduScreenL.rotation.x = -0.65;
    this.pedestalGroup.add(this.cduScreenL);

    // FO CDU (Right)
    this.cduScreenR = new THREE.Mesh(cduGeo, cduMat);
    this.cduScreenR.position.set(0.13, 0.26, -0.30);
    this.cduScreenR.rotation.x = -0.65;
    this.pedestalGroup.add(this.cduScreenR);

    // 3. Throttle Quadrant Housing
    const tqGeo = new THREE.BoxGeometry(0.38, 0.18, 0.40);
    const tqMesh = new THREE.Mesh(tqGeo, new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.7 }));
    tqMesh.position.set(0, 0.22, 0.02);
    this.pedestalGroup.add(tqMesh);

    // Molded Boeing White Throttle Lever Handles with Reverser Latches
    this.throttleLevers = new THREE.Group();
    this.throttleLevers.position.set(0, 0.28, 0.02);

    const leverRodGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.18, 12);
    const whiteKnobMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.3, metalness: 0.1 });
    const revLatchMat = new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.4, metalness: 0.6 });

    // Helper to create molded Boeing thrust lever head
    const createThrustLever = (xPos) => {
      const leverGroup = new THREE.Group();
      leverGroup.position.x = xPos;

      // Chrome lever rod
      const rod = new THREE.Mesh(leverRodGeo, chromeMat);
      rod.position.y = 0.09;

      // Ergonomic cylindrical handle head
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.055, 16), whiteKnobMat);
      head.rotation.z = Math.PI * 0.5;
      head.position.set(0, 0.18, 0);

      // Reverse thrust piggyback latch handle in front
      const revLatch = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.05, 0.024), revLatchMat);
      revLatch.position.set(0, 0.19, -0.038);

      leverGroup.add(rod, head, revLatch);
      return leverGroup;
    };

    this.throttle1 = createThrustLever(-0.045);
    this.throttle2 = createThrustLever(0.045);
    this.throttleLevers.add(this.throttle1, this.throttle2);
    this.pedestalGroup.add(this.throttleLevers);

    // Flap Handle (to the right of throttles at x = 0.12)
    this.flapLever = new THREE.Group();
    this.flapLever.position.set(0.12, 0.28, 0.08);
    const flapRod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), chromeMat);
    flapRod.position.y = 0.07;
    const flapKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.035, 16),
      whiteKnobMat
    );
    flapKnob.rotation.z = Math.PI * 0.5;
    flapKnob.position.y = 0.14;
    this.flapLever.add(flapRod, flapKnob);
    this.pedestalGroup.add(this.flapLever);

    // Speedbrake / Spoiler Lever (to the left of throttles at x = -0.12)
    this.spoilerLever = new THREE.Group();
    this.spoilerLever.position.set(-0.12, 0.28, 0.04);
    const spRod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), chromeMat);
    spRod.position.y = 0.07;
    const spKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.045, 12),
      new THREE.MeshStandardMaterial({ color: 0x181a1f, roughness: 0.4 })
    );
    spKnob.rotation.z = Math.PI * 0.5;
    spKnob.position.y = 0.14;
    // White ARM band on speedbrake handle
    const spBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0165, 0.0165, 0.010, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    spBand.rotation.z = Math.PI * 0.5;
    spBand.position.y = 0.14;
    this.spoilerLever.add(spRod, spKnob, spBand);
    this.pedestalGroup.add(this.spoilerLever);

    // High-Contrast Dual Boeing Trim Wheels with Black & White Striped Spiral Rim
    const trimRadius = 0.125;
    const trimThickness = 0.038;
    const buildTrimWheel = (xPos) => {
      const trimGroup = new THREE.Group();
      trimGroup.position.set(xPos, 0.20, 0.02);

      const rimGeo = new THREE.CylinderGeometry(trimRadius, trimRadius, trimThickness, 32);
      rimGeo.rotateZ(Math.PI * 0.5);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181b20, roughness: 0.55 });
      const rim = new THREE.Mesh(rimGeo, wheelMat);
      trimGroup.add(rim);

      // High-visibility alternating white spiral stripes (4 dual segments)
      const stripeGeo = new THREE.BoxGeometry(trimThickness + 0.002, 0.018, trimRadius * 2 + 0.004);
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (let a = 0; a < 4; a++) {
        const str = new THREE.Mesh(stripeGeo, stripeMat);
        str.rotation.x = (Math.PI / 4) * a;
        trimGroup.add(str);
      }
      return trimGroup;
    };

    this.trimWheelL = buildTrimWheel(-0.25);
    this.trimWheelR = buildTrimWheel(0.25);
    this.pedestalGroup.add(this.trimWheelL, this.trimWheelR);

    // Dual Engine Fuel Cutoff Levers (below throttles)
    const fuelCutoffGroup = new THREE.Group();
    fuelCutoffGroup.position.set(0, 0.22, 0.16);
    const fcLeverGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.035, 8);
    const fcL = new THREE.Mesh(fcLeverGeo, chromeMat);
    fcL.position.x = -0.035;
    const fcR = new THREE.Mesh(fcLeverGeo, chromeMat);
    fcR.position.x = 0.035;
    fuelCutoffGroup.add(fcL, fcR);
    this.pedestalGroup.add(fuelCutoffGroup);

    // Parking Brake Handle (Red pull handle with chrome latch)
    const pbGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.08, 12);
    this.parkBrakeHandle = new THREE.Mesh(pbGeo, new THREE.MeshStandardMaterial({ color: 0xd92d20, roughness: 0.3 }));
    this.parkBrakeHandle.rotation.x = Math.PI * 0.25;
    this.parkBrakeHandle.position.set(0, 0.23, 0.24);
    this.pedestalGroup.add(this.parkBrakeHandle);

    this.proceduralCockpitGroup.add(this.pedestalGroup);
  }

  buildYokes(boeingGreyMat, metalMat, chromeMat) {
    this.captainYoke = this.createBoeingYoke(boeingGreyMat, metalMat, chromeMat);
    this.captainYoke.root.position.set(-0.48, 0.08, -12.35);
    this.proceduralCockpitGroup.add(this.captainYoke.root);

    this.foYoke = this.createBoeingYoke(boeingGreyMat, metalMat, chromeMat);
    this.foYoke.root.position.set(0.48, 0.08, -12.35);
    this.proceduralCockpitGroup.add(this.foYoke.root);
  }

  createBoeingYoke(yokeMat, metalMat, chromeMat) {
    const root = new THREE.Group();

    // Control Column (Floor mounting tube with rubber pivot boot)
    const columnGeo = new THREE.CylinderGeometry(0.030, 0.038, 0.50, 16);
    const columnMesh = new THREE.Mesh(columnGeo, metalMat);
    columnMesh.position.y = 0.25;
    root.add(columnMesh);

    // Rubber gaiter / boot at floor
    const boot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.95 })
    );
    boot.position.y = 0.04;
    root.add(boot);

    // Pitch Pivot Group (moves forward & aft with elevator pitch)
    const pitchGroup = new THREE.Group();
    pitchGroup.position.set(0, 0.50, 0);

    // Roll Handlebar Group (rotates with aileron roll)
    const handleGroup = new THREE.Group();

    // Boeing W-shaped handlebar center bridge
    const centerBlock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.085, 0.06), yokeMat);
    handleGroup.add(centerBlock);

    // Ergonomic Left and Right Grips (Sculpted with finger contouring)
    const gripGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.18, 16);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.85, metalness: 0.1 });

    const leftGrip = new THREE.Mesh(gripGeo, gripMat);
    leftGrip.position.set(-0.165, 0.06, 0);
    leftGrip.rotation.z = -0.35;

    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 12), metalMat);
    leftArm.position.set(-0.085, 0.02, 0);
    leftArm.rotation.z = Math.PI * 0.45;

    const rightGrip = new THREE.Mesh(gripGeo, gripMat);
    rightGrip.position.set(0.165, 0.06, 0);
    rightGrip.rotation.z = 0.35;

    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 12), metalMat);
    rightArm.position.set(0.085, 0.02, 0);
    rightArm.rotation.z = -Math.PI * 0.45;

    // Pitch trim dual thumb-switches on left horn
    const trimSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.022, 0.02), new THREE.MeshStandardMaterial({ color: 0x242830 }));
    trimSwitch.position.set(-0.175, 0.13, 0.02);

    // Autopilot Disconnect push-button (Prominent Red button on left horn)
    const apDiscBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 12), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    apDiscBtn.rotation.x = Math.PI * 0.5;
    apDiscBtn.position.set(-0.145, 0.11, 0.02);

    // Captain's Clipboard with High-Res Approach Plate & Checklist
    const clipBoardGeo = new THREE.PlaneGeometry(0.095, 0.138);
    const clipBoardMat = new THREE.MeshBasicMaterial({
      map: this.checklistCanvas.texture
    });
    const clipBoardMesh = new THREE.Mesh(clipBoardGeo, clipBoardMat);
    clipBoardMesh.position.set(0, 0.025, 0.033);

    // Top metal clamp clip
    const clampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.01), chromeMat);
    clampMesh.position.set(0, 0.09, 0.035);

    handleGroup.add(leftGrip, leftArm, rightGrip, rightArm, trimSwitch, apDiscBtn, clipBoardMesh, clampMesh);
    pitchGroup.add(handleGroup);
    root.add(pitchGroup);

    return {
      root,
      pitchGroup,
      handleGroup
    };
  }

  buildRudderPedals(metalMat) {
    this.pedalsGroup = new THREE.Group();
    this.pedalsGroup.position.set(-0.48, 0.08, -12.72);

    const pedalGeo = new THREE.BoxGeometry(0.10, 0.18, 0.025);
    const pedalMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.4 });

    this.pedalLeft = new THREE.Mesh(pedalGeo, pedalMat);
    this.pedalLeft.position.set(-0.14, 0.08, 0);
    this.pedalLeft.rotation.x = -0.35;

    this.pedalRight = new THREE.Mesh(pedalGeo, pedalMat);
    this.pedalRight.position.set(0.14, 0.08, 0);
    this.pedalRight.rotation.x = -0.35;

    this.pedalsGroup.add(this.pedalLeft, this.pedalRight);
    this.proceduralCockpitGroup.add(this.pedalsGroup);
  }

  buildSeats(leatherMat, frameMat) {
    const makeSeat = (x) => {
      const seatGroup = new THREE.Group();
      seatGroup.position.set(x, 0.18, -11.65);

      // Cushion
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.54), leatherMat);
      cushion.position.y = 0.22;

      // Backrest
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.68, 0.14), leatherMat);
      back.position.set(0, 0.62, 0.22);
      back.rotation.x = 0.1;

      // Headrest
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), leatherMat);
      head.position.set(0, 1.05, 0.26);

      // Armrests
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), frameMat);
      armL.position.set(-0.29, 0.42, 0.05);
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), frameMat);
      armR.position.set(0.29, 0.42, 0.05);

      seatGroup.add(cushion, back, head, armL, armR);
      return seatGroup;
    };

    this.proceduralCockpitGroup.add(makeSeat(-0.48)); // Captain
    this.proceduralCockpitGroup.add(makeSeat(0.48));  // First Officer
  }

  buildOverheadPanel(boeingGreyMat) {
    // Forward Overhead Panel sloping directly above cockpit windshield
    const overheadGeo = new THREE.BoxGeometry(1.05, 0.06, 1.15);
    const overhead = new THREE.Mesh(overheadGeo, boeingGreyMat);
    overhead.position.set(0, 1.48, -12.15);
    overhead.rotation.x = 0.36; // Slanted forward toward windshield header

    // High-Resolution Photorealistic Boeing 737 Forward Overhead Faceplate
    const subGeo = new THREE.PlaneGeometry(1.02, 1.12);
    const oMat = new THREE.MeshStandardMaterial({
      map: this.overheadTex,
      roughness: 0.55,
      metalness: 0.25,
      emissive: 0xffe2b8,
      emissiveMap: this.overheadTex,
      emissiveIntensity: 0.15
    });
    const oScreen = new THREE.Mesh(subGeo, oMat);
    oScreen.position.y = -0.031;
    oScreen.rotation.x = Math.PI * 0.5;
    overhead.add(oScreen);

    this.proceduralCockpitGroup.add(overhead);
  }

  /** Temporarily clear the instrument sightline without changing control input. */
  toggleYokes() {
    this.yokesVisible = !this.yokesVisible;
    for (const yoke of this.gltfYokes ?? []) yoke.visible = this.yokesVisible;
    for (const yoke of [this.captainYoke, this.foYoke]) {
      if (yoke?.root) yoke.root.visible = this.yokesVisible;
    }
    return this.yokesVisible;
  }

  /** Animate cockpit controls from the applied flight inputs. */
  updateControls(flightState) {
    updateGltfYokes(this.gltfYokes, flightState);
    updateGltfEngineControls(this.gltfEngineControls, flightState);
    // 1. Dual Control Yokes
    const pitchDeflect = (flightState.elevator || 0) * 0.18;
    if (this.captainYoke && this.captainYoke.pitchGroup) {
      this.captainYoke.pitchGroup.rotation.x = pitchDeflect;
    }
    if (this.foYoke && this.foYoke.pitchGroup) {
      this.foYoke.pitchGroup.rotation.x = pitchDeflect;
    }

    const rollDeflect = -(flightState.aileron || 0) * (Math.PI / 3.0);
    if (this.captainYoke && this.captainYoke.handleGroup) {
      this.captainYoke.handleGroup.rotation.z = rollDeflect;
    }
    if (this.foYoke && this.foYoke.handleGroup) {
      this.foYoke.handleGroup.rotation.z = rollDeflect;
    }

    // 2. Rudder Pedals
    const rudderDeflect = (flightState.rudder || 0) * 0.05;
    if (this.pedalLeft) this.pedalLeft.position.z = rudderDeflect;
    if (this.pedalRight) this.pedalRight.position.z = -rudderDeflect;

    // 3. Throttle Levers
    const throttleAngle = 0.35 - (flightState.throttle || 0) * 0.70;
    if (this.throttle1) this.throttle1.rotation.x = throttleAngle;
    if (this.throttle2) this.throttle2.rotation.x = throttleAngle;

    // 4. Flap Selector Lever & MIP Flap Dial Needle
    const flapFraction = (flightState.flapIndex || 0) / 6.0;
    if (this.flapLever) {
      this.flapLever.rotation.x = 0.25 - flapFraction * 0.65;
    }
    if (this.flapGaugeNeedle) {
      // Rotate needle from 0 deg (UP) to 220 deg (Flaps 40)
      this.flapGaugeNeedle.rotation.z = -flapFraction * 3.8;
    }

    // 5. Landing Gear Lever & 3-Green Annunciators
    const gearState = flightState.gearState !== undefined ? flightState.gearState : 1.0;
    if (this.gearLever) {
      // Lever tilted down when gear down, tilted up when gear up
      this.gearLever.rotation.x = gearState > 0.5 ? 0.35 : -0.35;
    }
    if (this.gearLights && this.gearLights.length === 3 && this.gearLightMats) {
      let targetMat = this.gearLightMats.off;
      if (gearState > 0.95) {
        targetMat = this.gearLightMats.green;
      } else if (gearState > 0.05) {
        targetMat = this.gearLightMats.amber; // Transit amber
      }
      for (const light of this.gearLights) {
        light.material = targetMat;
      }
    }

    // 6. Speedbrake / Spoiler Lever
    const spoilerVal = flightState.spoilers || 0;
    if (this.spoilerLever) {
      this.spoilerLever.rotation.x = -0.3 + spoilerVal * 0.6;
    }

    // 7. Pitch Trim Wheels
    if (flightState.pitchTrimRate) {
      if (this.trimWheelL) this.trimWheelL.rotation.x += flightState.pitchTrimRate * 0.1;
      if (this.trimWheelR) this.trimWheelR.rotation.x += flightState.pitchTrimRate * 0.1;
    }

    // 8. Parking Brake Handle
    if (this.parkBrakeHandle) {
      this.parkBrakeHandle.rotation.x = flightState.parkBrake ? 0.45 : 0.15;
    }
  }

  /**
   * Asynchronously loads the high-detail 3D Boeing 737 cockpit GLTF model
   * and mounts live glass-cockpit flight displays.
   */
  loadCockpitModel(url = `${import.meta.env?.BASE_URL ?? '/'}models/b737-cockpit-medium.glb`) {
    if (typeof window === 'undefined') {
      // In non-browser / Node.js test environment, keep procedural cockpit active
      return;
    }

    try {
      this.cockpitModelLoading = true;
      // The procedural cockpit is a load-failure fallback only. Leaving it
      // visible swaps interiors mid-view instead of waiting for the real one.
      this.proceduralCockpitGroup.visible = false;

      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(`${import.meta.env?.BASE_URL ?? '/'}draco/gltf/`);

      const gltfLoader = new GLTFLoader();
      gltfLoader.setDRACOLoader(dracoLoader);

      gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          this.gltfCockpitModel = model;
          model.name = 'B737_Cockpit_Model';

          // Calibrated alignment transform:
          // Raw model coordinates: Forward +Z, Captain -X. Eye at (-0.44, 2.25, 0.65).
          // Flight3D local space: Forward -Z, Captain -X. Eye at (-0.45, 0.85, -12.44).
          model.rotation.y = Math.PI;
          model.scale.set(1, 1, 1);
          model.position.set(0, -1.31, -11.43);

          // Boeing Cockpit PBR Finishes for Window Frames, Pillars, and Interior Shell
          const boeingFrameMat = new THREE.MeshStandardMaterial({
            color: 0x343d49, // Authentic Boeing Cockpit Grey / Charcoal
            roughness: 0.86,
            metalness: 0.16,
            side: THREE.DoubleSide
          });

          const boeingLiningMat = new THREE.MeshStandardMaterial({
            color: 0x586270, // Boeing interior lining slate
            roughness: 0.90,
            metalness: 0.10,
            side: THREE.DoubleSide
          });

          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              // Configure authentic Boeing cockpit materials for the native frame & fuselage meshes
              if (child.name === 'Body020_Material008_0') {
                child.visible = true;
                child.material = boeingFrameMat;
                return;
              }
              if (child.name.startsWith('Body006') || child.name.startsWith('Body002')) {
                child.visible = true;
                child.material = boeingLiningMat;
                return;
              }
              if (child.material) {
                // Single-layer shell and console surfaces must render inward too.
                // Body018 closes the native enclosure; keep it visible as well.
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const material of materials) material.side = THREE.DoubleSide;

                if (child.name.includes('Cube1061') || child.name.includes('Cube1060')) {
                  // Captain and FO side consoles
                  child.material.color.setHex(0x424b57);
                  child.material.roughness = 0.85;
                } else if (child.material.roughness !== undefined) {
                  child.material.roughness = Math.max(0.25, child.material.roughness);
                }
              }
            }
          });

          this.gltfYokes = bindGltfYokes(model);
          this.gltfEngineControls = bindGltfEngineControls(model);
          const movingParts = [
            ...this.gltfYokes, ...this.gltfEngineControls.throttles, ...this.gltfEngineControls.pedals
          ];
          // Each pivot can also batch its own surfaces without losing articulation.
          this.staticDrawCallsSaved = movingParts.reduce(
            (saved, pivot) => saved + batchStaticCockpit(pivot), 0
          ) + batchStaticCockpit(model, movingParts);
          for (const yoke of this.gltfYokes) yoke.visible = this.yokesVisible;
          this.gltfCockpitGroup.add(model);

          // Build authentic Boeing 737 windshield glass & ceiling enclosure trims
          this.setupGltfCockpitFraming();

          // Mount live 60 FPS flight displays onto the GLTF MIP & Pedestal
          this.setupGltfFlightDisplays();

          // Seamless transition: enable GLTF cockpit and disable procedural cockpit
          this.proceduralCockpitGroup.visible = false;
          this.gltfCockpitGroup.visible = true;
          this.gltfCockpitLoaded = true;
          this.cockpitModelLoading = false;
          this.onModelReady?.();
        },
        undefined,
        (error) => {
          if (url !== `${import.meta.env?.BASE_URL ?? '/'}models/b737-cockpit-draco.glb`) {
            console.warn('Falling back to lite draco cockpit model:', error);
            this.loadCockpitModel(`${import.meta.env?.BASE_URL ?? '/'}models/b737-cockpit-draco.glb`);
            return;
          }
          console.warn('Failed to load 3D GLTF Cockpit model, keeping procedural cockpit:', error);
          this.proceduralCockpitGroup.visible = true;
          this.gltfCockpitGroup.visible = false;
          this.gltfCockpitLoaded = false;
          this.cockpitModelLoading = false;
        }
      );
    } catch (err) {
      console.warn('GLTFLoader initialization error:', err);
      this.proceduralCockpitGroup.visible = true;
      this.gltfCockpitGroup.visible = false;
      this.gltfCockpitLoaded = false;
      this.cockpitModelLoading = false;
    }
  }

  /**
   * Mounts real-time dynamic flight instrument displays (PFD, ND, EICAS, ISFD, MCP, CDU)
   * precisely onto the 3D GLTF Main Instrument Panel (MIP) and Pedestal.
   */
  setupGltfFlightDisplays() {
    this.gltfDisplays = new THREE.Group();
    this.gltfDisplays.name = 'GLTF_Live_Displays';

    // Display materials referencing CanvasTextures with depth/polygonOffset to avoid Z-fighting
    const createDisplayMat = (canvas) => new THREE.MeshBasicMaterial({
      map: canvas.texture,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    const pfdMat = createDisplayMat(this.pfdCanvas);
    const ndMat = createDisplayMat(this.ndCanvas);
    const eicasMat = createDisplayMat(this.eicasCanvas);
    const isfdMat = createDisplayMat(this.isfdCanvas);
    const mcpMat = createDisplayMat(this.mcpCanvas);
    const cduMat = createDisplayMat(this.cduCanvas);

    // Measured LCD apertures in the shipped cockpit GLBs.
    const duGeo = new THREE.PlaneGeometry(0.101, 0.100);
    const mipZ = -12.882;
    const mipY = 0.569;

    // 1. Captain Outboard Primary Flight Display (PFD)
    this.gltfCaptainPfd = new THREE.Mesh(duGeo, pfdMat);
    this.gltfCaptainPfd.name = 'GLTF_Captain_PFD';
    this.gltfCaptainPfd.position.set(-0.322, mipY, mipZ);
    this.gltfDisplays.add(this.gltfCaptainPfd);

    // 2. Captain Inboard Navigation Display (ND)
    this.gltfCaptainNd = new THREE.Mesh(duGeo, ndMat);
    this.gltfCaptainNd.name = 'GLTF_Captain_ND';
    this.gltfCaptainNd.position.set(-0.199, mipY, mipZ);
    this.gltfDisplays.add(this.gltfCaptainNd);

    // 3. Integrated Standby Flight Display (ISFD)
    const isfdGeo = new THREE.PlaneGeometry(0.044, 0.044);
    this.gltfIsfd = new THREE.Mesh(isfdGeo, isfdMat);
    this.gltfIsfd.name = 'GLTF_Standby_ISFD';
    this.gltfIsfd.position.set(-0.103, 0.5946, mipZ);
    this.gltfDisplays.add(this.gltfIsfd);

    // 4. Center Upper EICAS (Engine Indications & Crew Alerting System)
    this.gltfUpperEicas = new THREE.Mesh(duGeo, eicasMat);
    this.gltfUpperEicas.name = 'GLTF_Upper_EICAS';
    this.gltfUpperEicas.position.set(-0.006, mipY, mipZ);
    this.gltfDisplays.add(this.gltfUpperEicas);

    // 5. First Officer Inboard Navigation Display (ND)
    this.gltfFoNd = new THREE.Mesh(duGeo, ndMat);
    this.gltfFoNd.name = 'GLTF_FO_ND';
    this.gltfFoNd.position.set(0.155, mipY, mipZ);
    this.gltfDisplays.add(this.gltfFoNd);

    // 6. First Officer Outboard Primary Flight Display (PFD)
    this.gltfFoPfd = new THREE.Mesh(duGeo, pfdMat);
    this.gltfFoPfd.name = 'GLTF_FO_PFD';
    this.gltfFoPfd.position.set(0.280, mipY, mipZ);
    this.gltfDisplays.add(this.gltfFoPfd);

    // Crop canvas UVs to the LCD content; retain the GLB's physical knobs/keys.
    const crop = (geometry, canvas, x, y, width, height) => {
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (x + uv.getX(i) * width) / canvas.width,
          1 - (y + (1 - uv.getY(i)) * height) / canvas.height);
      }
      return geometry;
    };

    // 7. Six digital MCP windows on the original 3D panel.
    // [asset X, aperture width, canvas X, canvas width], captain to FO.
    const windows = [
      [0.12388, 0.02057, 160, 68],
      [0.07227, 0.02324, 296, 82],
      [0.03099, 0.02074, 464, 82],
      [-0.00907, 0.02325, 600, 94],
      [-0.03829, 0.02325, 716, 86],
      [-0.10533, 0.02074, 960, 64]
    ];
    this.gltfMcpWindows = windows.map(([x, width, canvasX, canvasWidth], i) => {
      const geometry = crop(new THREE.PlaneGeometry(width, 0.00781),
        this.mcpCanvas, canvasX, 26, canvasWidth, 36);
      const mesh = new THREE.Mesh(geometry, mcpMat);
      mesh.name = `GLTF_MCP_Window_${i}`;
      mesh.position.set(-x, 0.75298, -12.8595);
      this.gltfDisplays.add(mesh);
      return mesh;
    });
    this.gltfMcp = this.gltfMcpWindows[0];

    // 8. FMC screen apertures. The canvas also draws a keypad, but the GLB
    // already supplies 3D keys, so only map its LCD region here.
    const cduGeo = crop(new THREE.PlaneGeometry(0.0684, 0.0508),
      this.cduCanvas, 32, 24, this.cduCanvas.width - 64, 216);
    this.gltfCaptainCdu = new THREE.Mesh(cduGeo, cduMat);
    this.gltfCaptainCdu.name = 'GLTF_Captain_CDU';
    this.gltfCaptainCdu.position.set(-0.1159, 0.4941, -12.8600);
    this.gltfCaptainCdu.rotation.x = -1.12;
    this.gltfDisplays.add(this.gltfCaptainCdu);

    this.gltfFoCdu = new THREE.Mesh(cduGeo, cduMat);
    this.gltfFoCdu.name = 'GLTF_FO_CDU';
    this.gltfFoCdu.position.set(0.09735, 0.4941, -12.8600);
    this.gltfFoCdu.rotation.x = -1.12;
    this.gltfDisplays.add(this.gltfFoCdu);

    this.gltfCockpitGroup.add(this.gltfDisplays);
  }

  /**
   * Constructs authentic Boeing 737 cockpit window framing, solid A-pillars,
   * center mullion post with magnetic compass, side sliding window frames,
   * interior sidewall liners, and seamless ceiling eyebrow enclosures.
   */
  setupGltfCockpitFraming() {
    this.gltfCockpitFraming = new THREE.Group();
    this.gltfCockpitFraming.name = 'GLTF_Cockpit_Framing';

    const boeingCharcoal = new THREE.MeshStandardMaterial({
      color: 0x22262e, // Authentic Boeing Cockpit Grey / Charcoal
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.DoubleSide
    });

    const boeingLiningSlate = new THREE.MeshStandardMaterial({
      color: 0x303640, // Boeing flight deck interior lining slate
      roughness: 0.88,
      metalness: 0.10,
      side: THREE.DoubleSide
    });

    // 1. Standby Magnetic Compass mounted flush on center post under the ceiling header
    this.gltfCompassBracket = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.035), boeingCharcoal);
    this.gltfCompassBracket.name = 'GLTF_Center_Post_Compass_Bracket';
    this.gltfCompassBracket.position.set(-0.01, 1.05, -12.68);
    this.gltfCompassBracket.rotation.x = -0.36;

    const compassGroup = new THREE.Group();
    compassGroup.name = 'GLTF_Compass_Group';
    compassGroup.position.set(-0.01, 1.05, -12.66);
    compassGroup.rotation.x = -0.36;
    const compassBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.034, 16),
      new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.5, metalness: 0.3 })
    );
    compassBody.rotation.x = Math.PI * 0.5;
    const compassFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.018, 16),
      new THREE.MeshBasicMaterial({ color: 0x080d14 })
    );
    compassFace.position.z = 0.018;
    compassGroup.add(compassBody, compassFace);

    this.gltfCenterPost = null;
    this.gltfAPillars = [];
    this.gltfSideFrames = [];
    this.gltfCockpitFraming.add(this.gltfCompassBracket, compassGroup);

    // 2. Seamless Ceiling Enclosure Fairings (bridges between Body006 and overhead panel)
    const roofFairing = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.04, 0.55), boeingLiningSlate);
    roofFairing.name = 'GLTF_Roof_Fairing';
    roofFairing.position.set(0, 1.25, -12.52);
    roofFairing.rotation.x = 0.22;

    const centerRoofFairing = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.05, 0.40), boeingCharcoal);
    centerRoofFairing.name = 'GLTF_Center_Roof_Fairing';
    centerRoofFairing.position.set(0, 1.22, -12.65);
    centerRoofFairing.rotation.x = 0.12;

    this.gltfCeilingTrim = new THREE.Group();
    this.gltfCeilingTrim.name = 'GLTF_Ceiling_Trim';
    this.gltfCeilingTrim.add(roofFairing, centerRoofFairing);
    this.gltfCockpitFraming.add(this.gltfCeilingTrim);

    // 3. Subtle Tinted Aviation Windshield Glass Panels
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88b0cc,
      transparent: true,
      opacity: 0.05,
      roughness: 0.06,
      metalness: 0.30,
      depthWrite: false
    });

    const glass1L = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.44), glassMat);
    glass1L.name = 'GLTF_Glass_1L';
    glass1L.position.set(-0.25, 0.83, -12.92);
    glass1L.rotation.set(-0.47, 0.22, -0.06);

    const glass1R = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.44), glassMat);
    glass1R.name = 'GLTF_Glass_1R';
    glass1R.position.set(0.25, 0.83, -12.92);
    glass1R.rotation.set(-0.47, -0.22, 0.06);

    const glass2L = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), glassMat);
    glass2L.name = 'GLTF_Glass_2L';
    glass2L.position.set(-0.85, 0.95, -12.45);
    glass2L.rotation.set(-0.12, 1.10, 0);

    const glass2R = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), glassMat);
    glass2R.name = 'GLTF_Glass_2R';
    glass2R.position.set(0.85, 0.95, -12.45);
    glass2R.rotation.set(-0.12, -1.10, 0);

    this.gltfGlassPanels = [glass1L, glass1R, glass2L, glass2R];
    this.gltfCockpitFraming.add(...this.gltfGlassPanels);

    this.gltfCockpitGroup.add(this.gltfCockpitFraming);
  }
}
