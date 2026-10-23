import * as THREE from 'three';
import { createRunwayMarkingMaterial } from './RunwayMarkings.js';
import { createPavementMaterial, setPavementUVs, createRunwayWearMaterial, createRunwayRepairs } from './Pavement.js';

/**
 * Nepal Tenzing-Hillary Airport (Lukla, ICAO: VNLK)
 * Real-world 3D airport facility featuring:
 * - 527m x 30m asphalt Runway 06/24 with 11.7% gradient (elevation 2,805m to 2,867m)
 * - Runway markings: "06" threshold, centerline dashes, "24" upper threshold, piano keys
 * - Iconic 2-story white stone terminal with bright blue gabled roof
 * - Panoramic control tower cabin with communication mast and flashing beacon
 * - Sloped aircraft parking apron with yellow lead-in lines (4 aircraft stands)
 * - Twin circular helipads with "H" markings (Everest rescue base)
 * - Mountain windsock and low-intensity runway edge lights
 */
export class LuklaAirport {
  constructor() {
    this.group = new THREE.Group();

    // Geometric specs
    this.runwayLength = 527.0; // meters
    this.runwayWidth = 30.0;   // meters
    this.headingDeg = 58.0;
    this.headingRad = THREE.MathUtils.degToRad(58.0);
    this.gradient = 0.1176; // 11.76% (6.71° pitch)
    this.pitchRad = Math.atan(this.gradient);

    this.elevation06 = 2805.0; // SW threshold
    this.elevation24 = 2867.0; // NE threshold
    this.threshold24Elevation = this.elevation24;
    this.midElevation = 2836.0;

    // Vectors along and across runway
    this.sin58 = Math.sin(this.headingRad); // ~0.8480
    this.cos58 = Math.cos(this.headingRad); // ~0.5299

    // Dynamic objects
    this.beaconLights = [];
    this.windsock = null;

    // Terminal building dimensions and rotation (-58° + 90° = 32°)
    const termRotY = -this.headingRad + Math.PI * 0.5;
    const bodyW = 44;
    const bodyD = 24;
    const cosRot = Math.abs(Math.cos(termRotY));
    const sinRot = Math.abs(Math.sin(termRotY));
    const aabbW = bodyW * cosRot + bodyD * sinRot;
    const aabbD = bodyW * sinRot + bodyD * cosRot;

    // Collision metadata for terminal and tower (safely offset to the apron at w ≈ 48m)
    this.terminalData = {
      x: 76.3,
      y: 2844,
      z: 8.9,
      width: aabbW,
      height: 18,
      depth: aabbD,
      localWidth: bodyW,
      localDepth: bodyD,
      rotationY: termRotY
    };

    this.controlTowerData = {
      x: 83.1,
      y: 2855,
      z: 4.7,
      radius: 4.5,
      height: 16.0
    };

    // Upper retaining wall obstacle metadata at Runway 24 threshold (s = 265m)
    const wallX = 265 * this.sin58;
    const wallZ = -265 * this.cos58;
    this.retainingWallData = {
      x: wallX,
      y: this.elevation24,
      z: wallZ,
      width: 45,
      height: 6.0,
      depth: 3.5,
      localWidth: 45,
      localDepth: 3.5,
      rotationY: -this.headingRad
    };

    this.initAirport();
  }

  initAirport() {
    // 1. Runway 06/24 Surface & Markings
    this.buildSlopedRunway();

    // 2. Parking Apron (Ramp) & Helipads
    this.buildApronAndHelipads();

    // 3. Iconic Blue-Roofed Terminal & Control Tower
    this.buildTerminalAndTower();

    // 4. Windsock & Runway Lighting
    this.buildWindsock();
    this.buildRunwayLights();

    // 5. Cliff Edge Guardrail & Upper Mountain Retaining Wall
    this.buildRetainingWalls();
  }

  /**
   * Build the 527m x 30m asphalt runway aligned with heading 058° and 11.7% grade
   */
  buildSlopedRunway() {
    const rwyGroup = new THREE.Group();
    rwyGroup.position.set(0, this.midElevation, 0);

    // Orientation: Heading 058° (yaw) and 6.71° incline (pitch uphill along 058°)
    // In Three.js: Rotate around Y by (Math.PI/2 - heading) or -heading
    // Along local -Z axis: let length run along Z
    const rwyGeom = new THREE.PlaneGeometry(this.runwayWidth, this.runwayLength, 4, 32);
    rwyGeom.rotateX(-Math.PI * 0.5);

    // Dark high-friction mountain asphalt
    const rwyMat = createPavementMaterial('asphalt', -2);

    // The marking overlay needs its original normalized UVs.
    const rwyMesh = new THREE.Mesh(setPavementUVs(rwyGeom.clone()), rwyMat);
    rwyMesh.name = 'runway-pavement';
    rwyMesh.receiveShadow = true;

    // Solid stone/rock embankment foundation beneath sloped runway to seal any cliff/canyon gaps
    const skirtGeom = new THREE.BoxGeometry(this.runwayWidth, 24, this.runwayLength);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x2e3338,
      roughness: 0.95,
      metalness: 0.05
    });
    const skirtMesh = new THREE.Mesh(skirtGeom, skirtMat);
    // Keep the foundation top below the asphalt instead of sharing its plane.
    skirtMesh.position.y = -12.5;
    skirtMesh.receiveShadow = true;

    // Transform: yaw heading 058°, pitch 11.7% (6.71° uphill towards NE)
    // Local forward (-Z) points along 058° (+X, -Z in world), rising to 2,867m at Threshold 24
    const euler = new THREE.Euler(this.pitchRad, -this.headingRad, 0, 'YXZ');
    rwyGroup.quaternion.setFromEuler(euler);
    rwyGroup.add(skirtMesh);
    rwyGroup.add(rwyMesh);

    rwyGroup.add(createRunwayRepairs(this.runwayWidth, this.runwayLength));
    const wearMat = createRunwayWearMaterial();
    if (wearMat) {
      const wearGeo = new THREE.PlaneGeometry(14, 95);
      wearGeo.rotateX(-Math.PI * 0.5);
      for (const end of [-1, 1]) {
        const wear = new THREE.Mesh(wearGeo, wearMat);
        wear.position.set(0, 0.015, end * (this.runwayLength / 2 - 95));
        wear.rotation.y = end < 0 ? Math.PI : 0;
        wear.receiveShadow = true;
        rwyGroup.add(wear);
      }
    }

    // Markings canvas texture (when running in browser DOM)
    if (typeof document !== 'undefined') {
      const markCanvas = document.createElement('canvas');
      markCanvas.width = 256;
      markCanvas.height = 1024;
      const ctx = markCanvas.getContext('2d');

      // Transparent background
      ctx.clearRect(0, 0, 256, 1024);

      // White threshold stripes (Piano Keys) at 06 (bottom of canvas)
      ctx.fillStyle = '#ffffff';
      const keyWidth = 12;
      const keyGap = 10;
      const numKeys = 8;
      const startX = (256 - (numKeys * keyWidth + (numKeys - 1) * keyGap)) / 2;

      for (let k = 0; k < numKeys; k++) {
        ctx.fillRect(startX + k * (keyWidth + keyGap), 940, keyWidth, 55);
      }

      // Number "06" at threshold
      ctx.font = 'bold 54px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('06', 128, 880);

      // Dashed centerline
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ffffff';
      for (let y = 140; y < 820; y += 70) {
        ctx.beginPath();
        ctx.moveTo(128, y);
        ctx.lineTo(128, y + 40);
        ctx.stroke();
      }

      // White threshold stripes at 24 (top of canvas)
      for (let k = 0; k < numKeys; k++) {
        ctx.fillRect(startX + k * (keyWidth + keyGap), 30, keyWidth, 55);
      }

      // Number "24" at top
      ctx.save();
      ctx.translate(128, 140);
      ctx.rotate(Math.PI);
      ctx.fillText('24', 0, 0);
      ctx.restore();

      // White edge border lines
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(18, 30);
      ctx.lineTo(18, 995);
      ctx.moveTo(238, 30);
      ctx.lineTo(238, 995);
      ctx.stroke();

      const markTex = new THREE.CanvasTexture(markCanvas);
      markTex.anisotropy = 4;

      const markMat = createRunwayMarkingMaterial({
        map: markTex,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        depthWrite: false,
        roughness: 0.85,
        metalness: 0.1
      });

      const markMesh = new THREE.Mesh(rwyGeom, markMat);
      markMesh.name = 'runway-markings';
      markMesh.receiveShadow = true;
      rwyGroup.add(markMesh);
    }

    this.group.add(rwyGroup);
  }

  /**
   * Aircraft parking apron (ramp) with 4 stands and twin helipads
   */
  buildApronAndHelipads() {
    const apronGroup = new THREE.Group();
    // Apron sits to the right of upper runway (s ≈ 60m, w ≈ 33m -> world x: 68.4, z: -4.1, y: 2843.5m)
    apronGroup.position.set(68.4, 2843.5, -4.1);

    // Concrete tarmac geometry: 36m wide (lateral across w) x 80m long (along s)
    const apronGeom = new THREE.PlaneGeometry(36, 80);
    apronGeom.rotateX(-Math.PI * 0.5);

    const apronMat = createPavementMaterial('concrete', -2);

    setPavementUVs(apronGeom);
    const apronMesh = new THREE.Mesh(apronGeom, apronMat);
    apronMesh.receiveShadow = true;

    // Solid stone terrace foundation beneath apron to prevent gaps over hillside
    const apronSkirtGeom = new THREE.BoxGeometry(36, 16, 80);
    const apronSkirtMat = new THREE.MeshStandardMaterial({
      color: 0x3a4048,
      roughness: 0.95,
      metalness: 0.05
    });
    const apronSkirtMesh = new THREE.Mesh(apronSkirtGeom, apronSkirtMat);
    // As on the runway, keep the foundation below the textured surface.
    apronSkirtMesh.position.y = -8.1;
    apronSkirtMesh.receiveShadow = true;

    // Aligned with runway heading and uphill slope using runway-local YXZ order
    const apronEuler = new THREE.Euler(this.pitchRad, -this.headingRad, 0, 'YXZ');
    apronGroup.quaternion.setFromEuler(apronEuler);
    apronGroup.add(apronSkirtMesh);
    apronGroup.add(apronMesh);

    // Helipads on the southwest side of the apron (local +Z)
    const heliMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });

    for (let h = 0; h < 2; h++) {
      const hx = -6 + h * 12;
      const hz = 20;

      // Outer yellow ring
      const ringGeom = new THREE.RingGeometry(4.8, 5.4, 32);
      ringGeom.rotateX(-Math.PI * 0.5);
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.position.set(hx, 0.05, hz);
      ringMesh.receiveShadow = true;
      apronGroup.add(ringMesh);

      // White "H" marking
      const barGeom1 = new THREE.PlaneGeometry(0.9, 4.8);
      barGeom1.rotateX(-Math.PI * 0.5);
      const barGeom2 = new THREE.PlaneGeometry(2.6, 0.9);
      barGeom2.rotateX(-Math.PI * 0.5);

      const hLeft = new THREE.Mesh(barGeom1, heliMat);
      hLeft.position.set(hx - 1.3, 0.06, hz);
      hLeft.receiveShadow = true;
      const hRight = new THREE.Mesh(barGeom1, heliMat);
      hRight.position.set(hx + 1.3, 0.06, hz);
      hRight.receiveShadow = true;
      const hMid = new THREE.Mesh(barGeom2, heliMat);
      hMid.position.set(hx, 0.06, hz);
      hMid.receiveShadow = true;

      apronGroup.add(hLeft, hRight, hMid);
    }

    this.group.add(apronGroup);
  }

  /**
   * Iconic Lukla 2-story terminal building with signature bright blue pitched roof
   * and observation control tower
   */
  buildTerminalAndTower() {
    const termGroup = new THREE.Group();
    termGroup.position.set(this.terminalData.x, this.terminalData.y, this.terminalData.z);
    termGroup.rotation.y = -this.headingRad + Math.PI * 0.5;

    // 1. Main terminal body (White stone Himalayan masonry)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.85,
      metalness: 0.05
    });

    const termW = this.terminalData.localWidth || 44;
    const termD = this.terminalData.localDepth || 24;
    const bodyGeom = new THREE.BoxGeometry(termW, 10, termD);
    const bodyMesh = new THREE.Mesh(bodyGeom, wallMat);
    bodyMesh.position.y = 5;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    termGroup.add(bodyMesh);

    // 2. Distinctive Blue Pitched Roof (Himalayan metal roofing)
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Vibrant Himalayan Blue
      roughness: 0.45,
      metalness: 0.25
    });

    // Gable triangular roof geometry
    const roofGeom = new THREE.ConeGeometry(termW * 0.65, 5.5, 4);
    roofGeom.rotateY(Math.PI * 0.25);
    roofGeom.scale(1.0, 1.0, termD / (termW * 0.65));
    const roofMesh = new THREE.Mesh(roofGeom, roofMat);
    roofMesh.position.y = 12.5;
    roofMesh.castShadow = true;
    termGroup.add(roofMesh);

    // 3. Control Tower Cabin on Roof
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.6
    });

    const towerGlassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.85,
      transparent: true,
      opacity: 0.8
    });

    const cabinGeom = new THREE.CylinderGeometry(4.2, 3.8, 4.5, 8);
    const cabinMesh = new THREE.Mesh(cabinGeom, towerGlassMat);
    cabinMesh.position.set(8, 14, 0);
    cabinMesh.castShadow = true;
    termGroup.add(cabinMesh);

    const cabinRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.0, 8), roofMat);
    cabinRoof.position.set(8, 17, 0);
    termGroup.add(cabinRoof);

    // Antenna Mast & Red Flashing Hazard Light
    const mastGeom = new THREE.CylinderGeometry(0.12, 0.15, 6.0, 6);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const mast = new THREE.Mesh(mastGeom, mastMat);
    mast.position.set(8, 20.5, 0);
    termGroup.add(mast);

    const beaconLight = new THREE.PointLight(0xff2222, 1.8, 120);
    beaconLight.position.set(8, 23.5, 0);
    termGroup.add(beaconLight);
    this.beaconLights.push(beaconLight);

    this.group.add(termGroup);
  }

  /**
   * Windsock situated alongside the runway
   */
  buildWindsock() {
    const sockGroup = new THREE.Group();
    // Position on the mountainside near runway midpoint
    sockGroup.position.set(28, 2842, 10);

    // Mast
    const poleGeom = new THREE.CylinderGeometry(0.1, 0.15, 7.5, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.y = 3.75;
    sockGroup.add(pole);

    // Cone (Orange & White striped cone fluttering downwind)
    const coneGeom = new THREE.ConeGeometry(0.55, 3.2, 12);
    coneGeom.rotateZ(-Math.PI * 0.45); // angled in wind
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7 });
    this.windsock = new THREE.Mesh(coneGeom, coneMat);
    this.windsock.position.set(0.8, 7.2, 0);
    sockGroup.add(this.windsock);

    this.group.add(sockGroup);
  }

  /**
   * Low-intensity mountain runway edge lights along 527m runway
   */
  buildRunwayLights() {
    const halfL = this.runwayLength * 0.5;
    const halfW = this.runwayWidth * 0.5 + 1.2;

    const lightGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 6);
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    const lightsGroup = new THREE.Group();

    // Place lights every 35 meters along both edges
    for (let s = -halfL; s <= halfL; s += 35.0) {
      const y = this.midElevation + s * this.gradient + 0.2;

      for (const side of [-1, 1]) {
        const w = side * halfW;
        // Transform (s, w) to world (x, z)
        const x = s * this.sin58 + w * this.cos58;
        const z = -s * this.cos58 + w * this.sin58;

        const fixture = new THREE.Mesh(lightGeom, fixtureMat);
        fixture.position.set(x, y, z);

        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), bulbMat);
        bulb.position.set(x, y + 0.25, z);

        lightsGroup.add(fixture, bulb);
      }
    }

    this.group.add(lightsGroup);
  }

  /**
   * Stone retaining wall at upper end (Runway 24) and cliff barricade at Runway 06
   */
  buildRetainingWalls() {
    // Upper stone wall at Runway 24 threshold (prevents sliding into mountain)
    const upperWallGeom = new THREE.BoxGeometry(45, 6, 3);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.95
    });

    const upperWall = new THREE.Mesh(upperWallGeom, wallMat);
    const p24X = 265 * this.sin58;
    const p24Z = -265 * this.cos58;
    upperWall.position.set(p24X, this.elevation24 + 3.0, p24Z);
    upperWall.rotation.y = -this.headingRad;
    upperWall.castShadow = true;
    this.upperWall = upperWall;
    this.group.add(upperWall);
  }

  /**
   * Determine if world coordinates fall within Lukla's sloped runway or apron tarmac
   */
  isOnRunway(x, z) {
    const s = x * this.sin58 - z * this.cos58;
    const w = x * this.cos58 + z * this.sin58;

    // Runway 06/24: 527m length (|s| <= 265m), 30m width (|w| <= 16m)
    const onRunway = Math.abs(s) <= 265.0 && Math.abs(w) <= 16.0;

    // Apron tarmac and helipads: s in [15, 105], w in [12, 52]
    const onApron = (s >= 15.0 && s <= 105.0 && w >= 12.0 && w <= 52.0);

    return onRunway || onApron;
  }

  /**
   * Frame update for windsock and hazard light flashing
   */
  update(dt, aircraftPos, simTime = 0) {
    // Accommodate both update(dt, simTime) and update(dt, aircraftPos, simTime)
    const time = (typeof aircraftPos === 'number') ? aircraftPos : simTime;

    // Flash red hazard beacon on control tower mast (1 Hz)
    const flash = (Math.sin(time * 6.28) > 0.0) ? 2.5 : 0.2;
    for (const b of this.beaconLights) {
      b.intensity = flash;
    }

    // Flutter windsock slightly
    if (this.windsock) {
      this.windsock.rotation.y = Math.sin(time * 2.5) * 0.15;
    }
  }
}
