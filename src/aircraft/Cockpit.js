import { batchStaticCockpit } from './StaticCockpitBatch.js';
import { bindGltfYokes, updateGltfYokes, bindGltfEngineControls, updateGltfEngineControls } from './GltfCockpitControls.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MCPCanvas } from './MCPCanvas.js';
import { ISFDCanvas } from './ISFDCanvas.js';
import { CDUCanvas } from './CDUCanvas.js';

/**
 * 3D Virtual Cockpit for Boeing Airliner: the photoreal GLTF flight deck with
 * live glass-cockpit displays (PFD, ND, EICAS, ISFD, MCP, CDU) mounted onto the
 * asset's panel apertures, authentic A-pillar/window framing, and warm Boeing
 * amber floodlighting. Yokes, throttles and rudder pedals articulate from the
 * applied flight inputs. The interior streams in as an asynchronous asset;
 * `cockpitModelLoading` and `gltfCockpitLoaded` report its state to the camera.
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

    this.gltfCockpitGroup = new THREE.Group();
    this.gltfCockpitGroup.name = 'GLTF_Cockpit';
    this.group.add(this.gltfCockpitGroup);
    this.gltfCockpitModel = null;
    this.gltfCockpitLoaded = false;
    this.cockpitModelLoading = false;
    this.cockpitModelFailed = false;
    this.gltfDisplays = null;
    this.gltfCockpitFraming = null;
    this.gltfGlassPanels = [];
    this.gltfCeilingTrim = null;
    this.gltfCompassBracket = null;
    this.yokesVisible = true;

    // Cockpit eye viewpoint (Captain's seat eye position in local aircraft space)
    this.captainEyePos = new THREE.Vector3(-0.48, 0.94, -12.08);

    this.initCockpit();
  }

  initCockpit() {
    // Boeing flight-deck flood lighting, positioned for the GLTF interior.
    this.glareshieldFlood = new THREE.PointLight(0xffa84c, 1.2, 2.2);
    this.glareshieldFlood.position.set(0, 0.48, -12.45);
    this.group.add(this.glareshieldFlood);

    this.pedestalFlood = new THREE.PointLight(0xffb55e, 1.6, 2.2);
    this.pedestalFlood.position.set(0, 0.50, -12.05);
    this.group.add(this.pedestalFlood);

    this.cockpitLight = new THREE.PointLight(0xffeedd, 0.8, 3.5);
    this.cockpitLight.position.set(0, 1.15, -12.1);
    this.group.add(this.cockpitLight);

    this.loadCockpitModel();
  }

  /** Temporarily clear the instrument sightline without changing control input. */
  toggleYokes() {
    this.yokesVisible = !this.yokesVisible;
    for (const yoke of this.gltfYokes ?? []) yoke.visible = this.yokesVisible;
    return this.yokesVisible;
  }

  /** Animate cockpit controls from the applied flight inputs. */
  updateControls(flightState) {
    updateGltfYokes(this.gltfYokes, flightState);
    updateGltfEngineControls(this.gltfEngineControls, flightState);
  }

  /**
   * Asynchronously loads the high-detail 3D Boeing 737 cockpit GLTF model
   * and mounts live glass-cockpit flight displays.
   */
  loadCockpitModel(url = `${import.meta.env?.BASE_URL ?? '/'}models/b737-cockpit-medium.glb`) {
    if (typeof window === 'undefined') {
      // Non-browser / Node test environment: no interior is ever displayed.
      return;
    }

    try {
      this.cockpitModelLoading = true;
      this.cockpitModelFailed = false;

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

          // The interior is ready: reveal it in one step, after shader warmup.
          this.gltfCockpitGroup.visible = true;
          this.gltfCockpitLoaded = true;
          this.cockpitModelLoading = false;
          this.cockpitModelFailed = false;
          this.onModelReady?.();
        },
        undefined,
        (error) => {
          if (url !== `${import.meta.env?.BASE_URL ?? '/'}models/b737-cockpit-draco.glb`) {
            console.warn('Falling back to lite draco cockpit model:', error);
            this.loadCockpitModel(`${import.meta.env?.BASE_URL ?? '/'}models/b737-cockpit-draco.glb`);
            return;
          }
          console.warn('Failed to load 3D GLTF Cockpit model:', error);
          this.gltfCockpitGroup.visible = false;
          this.gltfCockpitLoaded = false;
          this.cockpitModelLoading = false;
          this.cockpitModelFailed = true;
        }
      );
    } catch (err) {
      console.warn('GLTFLoader initialization error:', err);
      this.gltfCockpitGroup.visible = false;
      this.gltfCockpitLoaded = false;
      this.cockpitModelLoading = false;
      this.cockpitModelFailed = true;
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
