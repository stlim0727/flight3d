import * as THREE from 'three';

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
 * Boeing 737 Photorealistic 2D Cockpit Overlay (Photo Panel)
 * 
 * Provides an authentic, real-photo cockpit flight deck overlay:
 * 1. 100% photorealistic Boeing 737 captain flight deck with molded glare shield,
 *    MCP autopilot panel, window pillars, compass, and captain control yoke.
 * 2. Transparent windshield cutouts through which the real-time 3D runway, ALS lighting,
 *    terrain, sky, clouds, and Gimpo airport are visible without blocky 3D primitives.
 * 3. Live 60 FPS vector instrumentation (PFD, ND, Upper EICAS, ISFD) rendered inside
 *    display unit bezel cutouts with subpixel alignment.
 */
export class CockpitPhotoOverlay {
  constructor(pfdCanvas = null, ndCanvas = null, eicasCanvas = null, isfdCanvas = null) {
    this.pfdCanvas = pfdCanvas;
    this.ndCanvas = ndCanvas;
    this.eicasCanvas = eicasCanvas;
    this.isfdCanvas = isfdCanvas;

    this.enabled = true;
    this.panelWidth = 1376.0;
    this.panelHeight = 768.0;
    this.panelAspect = this.panelWidth / this.panelHeight;

    // Dedicated 2D Orthographic Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      -this.panelAspect,
      this.panelAspect,
      1.0,
      -1.0,
      0.1,
      10.0
    );
    this.camera.position.z = 5.0;

    // Root group for all overlay elements
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Subtle yoke articulation state
    this.yokeRollAngle = 0;

    this.initMeshes();
  }

  initMeshes() {
    const W = this.panelWidth;
    const H = this.panelHeight;
    const aspect = this.panelAspect;

    // Helper to calculate NDC coordinates for screen quads
    const getScreenNDC = (px, py, pw, ph) => {
      const u = px / W;
      const v = py / H;
      const uw = pw / W;
      const vh = ph / H;
      return {
        x: -aspect + (u + uw * 0.5) * (2.0 * aspect),
        y: 1.0 - (v + vh * 0.5) * 2.0,
        w: uw * 2.0 * aspect,
        h: vh * 2.0
      };
    };

    // 1. Live Flight Instrument Screen Displays (Render Order 1: behind photo bezels)
    const createScreenMesh = (canvas, px, py, pw, ph, name) => {
      const coords = getScreenNDC(px, py, pw, ph);
      const geo = new THREE.PlaneGeometry(coords.w, coords.h);
      const texture = canvas?.texture || new THREE.Texture();
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: false,
        depthTest: false,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.position.set(coords.x, coords.y, 0.5);
      mesh.renderOrder = 1;
      return mesh;
    };

    // Captain Primary Flight Display (PFD)
    this.pfdMesh = createScreenMesh(this.pfdCanvas, 605, 456, 131, 149, 'PFD_Screen');
    this.group.add(this.pfdMesh);

    // Captain Navigation Display (ND)
    this.ndMesh = createScreenMesh(this.ndCanvas, 768, 456, 132, 149, 'ND_Screen');
    this.group.add(this.ndMesh);

    // Integrated Standby Flight Display (ISFD)
    this.isfdMesh = createScreenMesh(this.isfdCanvas, 950, 458, 58, 87, 'ISFD_Screen');
    this.group.add(this.isfdMesh);

    // Upper Engine Indication and Crew Alerting System (EICAS)
    this.eicasMesh = createScreenMesh(this.eicasCanvas, 1034, 456, 132, 149, 'EICAS_Screen');
    this.group.add(this.eicasMesh);

    // 2. High-Resolution Real-Photo Cockpit Panel (Render Order 2: in front of screen displays)
    this.panelTexture = loadTextureSafe(`${import.meta.env?.BASE_URL ?? '/'}textures/cockpit/b737_cockpit_panel_overlay.png`);
    this.panelGeo = new THREE.PlaneGeometry(2.0 * aspect, 2.0);
    this.panelMat = new THREE.MeshBasicMaterial({
      map: this.panelTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    this.panelMesh = new THREE.Mesh(this.panelGeo, this.panelMat);
    this.panelMesh.name = 'Cockpit_Photo_Panel';
    this.panelMesh.position.set(0, 0, 1.0);
    this.panelMesh.renderOrder = 2;
    this.group.add(this.panelMesh);
  }

  /**
   * Resizes overlay camera and scales panel to seamlessly fit viewport
   */
  onResize(viewportWidth, viewportHeight) {
    if (!viewportWidth || !viewportHeight) return;

    const screenAspect = viewportWidth / viewportHeight;

    // Cover scaling: ensure photo panel fills the screen without black borders
    if (screenAspect >= this.panelAspect) {
      // Screen is wider than 16:9
      const scale = screenAspect / this.panelAspect;
      this.group.scale.set(scale, scale, 1);
    } else {
      // Screen is taller than 16:9 (tablet / mobile portrait / 4:3)
      // Slight vertical scale to keep instrument cluster comfortably centered
      this.group.scale.set(1.0, 1.0, 1.0);
    }

    this.camera.left = -screenAspect;
    this.camera.right = screenAspect;
    this.camera.top = 1.0;
    this.camera.bottom = -1.0;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Updates dynamic instrument textures and subtle animations
   */
  update(telemetry = {}) {
    if (!this.enabled) return;

    // Refresh dynamic canvas textures
    if (this.pfdCanvas?.texture) this.pfdCanvas.texture.needsUpdate = true;
    if (this.ndCanvas?.texture) this.ndCanvas.texture.needsUpdate = true;
    if (this.eicasCanvas?.texture) this.eicasCanvas.texture.needsUpdate = true;
    if (this.isfdCanvas?.texture) this.isfdCanvas.texture.needsUpdate = true;
  }

  /**
   * Renders the 2D photo cockpit overlay over the 3D scene
   */
  render(renderer) {
    if (!this.enabled || !renderer) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}
