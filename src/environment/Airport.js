import * as THREE from 'three';
import { AirportNightLighting } from './AirportNightLighting.js';
import { createPavementMaterial, setPavementUVs, createRunwayWearMaterial, createRunwayRepairs, createRunwaySurfaceWear } from './Pavement.js';
import { loadAirportKit, createAirportBuildings } from './AirportBuildings.js';
import { createRunwayMarkingMaterial } from './RunwayMarkings.js';

/**
 * International Airport Environment (Runway 09L/27R, Control Tower, Terminal, Hangars, Lighting)
 * Features complete runway markings, sequenced flashing approach strobes (ALS "rabbit"),
 * PAPI glidepath lights, runway edge lights, and 65m Control Tower with actively rotating radar.
 */
export class Airport {
  constructor() {
    this.group = new THREE.Group();
    this.elevation = 12.0;

    // Runway parameters: East-West orientation (X-axis)
    this.runwayLength = 3200; // meters
    this.runwayWidth = 60;   // meters
    this.runwayCenter = new THREE.Vector3(0, this.elevation, 0);

    // Dynamic objects: populated when the airport GLB kit loads.
    this.radarDish = null;
    this.towerGroup = null;
    this.terminalGroup = null;
    this.approachStrobes = [];
    this.beaconLights = [];

    // Collision metadata for control tower, terminal concourse, and maintenance hangars
    this.controlTowerData = {
      x: 120,
      y: this.elevation,
      z: 280,
      radius: 11.5,
      height: 85.0
    };

    this.terminalData = {
      x: -80,
      y: this.elevation,
      z: 340,
      width: 350,
      height: 22,
      depth: 70
    };

    this.hangarsData = [
      { x: -450, y: this.elevation, z: 310, width: 90, height: 35, depth: 70 },
      { x: -580, y: this.elevation, z: 310, width: 90, height: 35, depth: 70 }
    ];

    this.initAirport();
    this.nightLighting = new AirportNightLighting(this.group, [{
      start: [-this.runwayLength / 2, this.elevation, 0],
      end: [this.runwayLength / 2, this.elevation, 0], width: this.runwayWidth,
    }], [-400, -280, -160, -40, 80, 200, 320, 440].map(x => ({
      x, y: this.elevation, z: 275, height: 18,
      target: [x, this.elevation + 3, 225],
    })));
    this.nightLighting.illuminateWindows(this.group);
    this.buildingsReady = this.loadBuildings();
  }

  async loadBuildings(loadKit = loadAirportKit) {
    try {
      const kit = await loadKit();
      const buildings = createAirportBuildings(kit, this);
      buildings.beacon.visible = this.localLightsVisible !== false;
      this.beaconLights.push(buildings.beacon);
      this.towerGroup = buildings.tower;
      this.radarDish = buildings.radar;
      this.terminalGroup = null;
      this.buildings = buildings;
      this.group.add(buildings.group);
      this.nightLighting?.illuminateWindows(buildings.group);
      this.buildingsError = null;
      return true;
    } catch (error) {
      this.buildingsError = error;
      console.error('Airport building kit unavailable', error);
      return false;
    }
  }

  initAirport() {
    // Materials with hardware polygon offset to guarantee zero Z-fighting with terrain
    const asphaltMat = createPavementMaterial('asphalt');

    // 1. Runway Surface & Markings
    this.buildRunway(asphaltMat);

    // 2. Taxiway System & Apron
    this.buildTaxiways(asphaltMat, createPavementMaterial('concrete'));

    // 3. Airfield Lighting (Edge Lights, Threshold, ALS Strobes, PAPI)
    this.buildLighting();

  }

  buildRunway(asphaltMat) {
    // Main Runway Tarmac Slab (subdivided along length so near-plane clipping never spans 3.2 km)
    const rwyGeo = new THREE.PlaneGeometry(this.runwayLength, this.runwayWidth, 32, 1);
    rwyGeo.rotateX(-Math.PI * 0.5);
    setPavementUVs(rwyGeo);
    const rwyMesh = new THREE.Mesh(rwyGeo, asphaltMat);
    rwyMesh.name = 'runway-pavement';
    rwyMesh.position.set(0, this.elevation + 0.06, 0);
    rwyMesh.receiveShadow = true;
    this.group.add(rwyMesh);

    const repairs = createRunwayRepairs(this.runwayWidth, this.runwayLength);
    const surfaceWear = createRunwaySurfaceWear(this.runwayWidth, this.runwayLength);
    if (surfaceWear) repairs.add(surfaceWear);
    repairs.rotation.y = Math.PI / 2;
    repairs.position.y = this.elevation + 0.06;
    this.group.add(repairs);
    const wearMat = createRunwayWearMaterial();
    if (wearMat) {
      const wearGeo = new THREE.PlaneGeometry(18, 360);
      wearGeo.rotateX(-Math.PI * 0.5);
      for (const end of [-1, 1]) {
        const wear = new THREE.Mesh(wearGeo, wearMat);
        wear.rotation.y = end * Math.PI * 0.5;
        wear.position.set(end * (this.runwayLength / 2 - 450), this.elevation + 0.07, 0);
        wear.receiveShadow = true;
        this.group.add(wear);
      }
    }

    const whiteMarkMat = createRunwayMarkingMaterial();
    const markingsGroup = new THREE.Group();
    markingsGroup.name = 'runway-markings';
    markingsGroup.position.set(0, this.elevation + 0.08, 0);

    // A. Dashed Centerline (30m stripes with 20m gaps)
    const stripeLen = 30;
    const gap = 20;
    const numStripes = Math.floor(this.runwayLength / (stripeLen + gap));
    const startX = -this.runwayLength * 0.5 + 80;

    for (let i = 0; i < numStripes - 3; i++) {
      const sx = startX + i * (stripeLen + gap);
      const stripeGeo = new THREE.PlaneGeometry(stripeLen, 1.8);
      stripeGeo.rotateX(-Math.PI * 0.5);
      const stripe = new THREE.Mesh(stripeGeo, whiteMarkMat);
      stripe.position.set(sx, 0, 0);
      markingsGroup.add(stripe);
    }

    // B. Threshold Piano Keys (16 stripes on each threshold)
    const makeThresholdKeys = (xEnd, isWest) => {
      const keysGroup = new THREE.Group();
      const numKeys = 16;
      const keyW = 1.8;
      const keyLen = 45;
      const spacing = 3.2;

      for (let k = 0; k < numKeys; k++) {
        const z = -((numKeys - 1) * 0.5 * spacing) + k * spacing;
        const keyGeo = new THREE.PlaneGeometry(keyLen, keyW);
        keyGeo.rotateX(-Math.PI * 0.5);
        const key = new THREE.Mesh(keyGeo, whiteMarkMat);
        key.position.set(xEnd + (isWest ? keyLen * 0.5 + 10 : -keyLen * 0.5 - 10), 0, z);
        keysGroup.add(key);
      }
      return keysGroup;
    };

    markingsGroup.add(makeThresholdKeys(-this.runwayLength * 0.5, true));  // West 09L
    markingsGroup.add(makeThresholdKeys(this.runwayLength * 0.5, false));  // East 27R

    // C. Aiming Point Markers (Large 45m x 10m white blocks at 300m and 450m)
    const makeAimingPoints = (xOffset, isWest) => {
      const aimGroup = new THREE.Group();
      const aimGeo = new THREE.PlaneGeometry(45, 8);
      aimGeo.rotateX(-Math.PI * 0.5);

      const sign = isWest ? 1 : -1;
      const px = -sign * (this.runwayLength * 0.5) + sign * xOffset;

      const aimL = new THREE.Mesh(aimGeo, whiteMarkMat);
      aimL.position.set(px, 0, -14);
      const aimR = new THREE.Mesh(aimGeo, whiteMarkMat);
      aimR.position.set(px, 0, 14);

      aimGroup.add(aimL, aimR);
      return aimGroup;
    };

    markingsGroup.add(makeAimingPoints(350, true));
    markingsGroup.add(makeAimingPoints(350, false));

    // E. Touchdown Zone (TDZ) Paired Bar Markings (FAA/ICAO standard)
    const makeTDZMarkings = (isWest) => {
      const tdzGroup = new THREE.Group();
      const sign = isWest ? 1 : -1;
      const originX = -sign * (this.runwayLength * 0.5);
      const stripeGeo = new THREE.PlaneGeometry(22, 1.8);
      stripeGeo.rotateX(-Math.PI * 0.5);

      // Distance stations from threshold: 150m (3 bars), 450m (2 bars), 600m (2 bars), 750m (1 bar), 900m (1 bar)
      const stations = [
        { dist: 150, bars: 3 },
        { dist: 450, bars: 2 },
        { dist: 600, bars: 2 },
        { dist: 750, bars: 1 },
        { dist: 900, bars: 1 }
      ];

      stations.forEach(s => {
        const px = originX + sign * s.dist;
        for (let side of [-1, 1]) {
          for (let b = 0; b < s.bars; b++) {
            const z = side * (12 + b * 2.8);
            const m = new THREE.Mesh(stripeGeo, whiteMarkMat);
            m.position.set(px, 0, z);
            tdzGroup.add(m);
          }
        }
      });
      return tdzGroup;
    };

    markingsGroup.add(makeTDZMarkings(true));
    markingsGroup.add(makeTDZMarkings(false));

    // D. Runway Numbers "09L" and "27R" Canvas Decals
    const makeRunwayNumberDecal = (text, x, rotY) => {
      const can = document.createElement('canvas');
      can.width = 256;
      can.height = 256;
      const c = can.getContext('2d');
      c.fillStyle = '#ffffff';
      c.font = 'bold 140px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, 128, 128);

      const tex = new THREE.CanvasTexture(can);
      const mat = createRunwayMarkingMaterial({
        map: tex,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        depthWrite: false,
        roughness: 0.8,
        metalness: 0.1
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), mat);
      mesh.rotation.set(-Math.PI * 0.5, 0, rotY);
      mesh.position.set(x, 0.01, 0);
      mesh.receiveShadow = true;
      return mesh;
    };

    markingsGroup.add(makeRunwayNumberDecal('09L', -this.runwayLength * 0.5 + 85, Math.PI * 0.5));
    markingsGroup.add(makeRunwayNumberDecal('27R', this.runwayLength * 0.5 - 85, -Math.PI * 0.5));

    markingsGroup.traverse(child => {
      if (child.isMesh) child.receiveShadow = true;
    });

    this.group.add(markingsGroup);
  }

  buildTaxiways(asphaltMat, apronMat) {
    const taxiGroup = new THREE.Group();

    // Parallel Taxiway A (length 3200m, width 25m, offset z = 160m to North)
    const taxiGeo = new THREE.PlaneGeometry(this.runwayLength, 25, 32, 1);
    taxiGeo.rotateX(-Math.PI * 0.5);
    setPavementUVs(taxiGeo);
    const taxiMesh = new THREE.Mesh(taxiGeo, asphaltMat);
    taxiMesh.position.set(0, this.elevation + 0.04, 160);
    taxiMesh.receiveShadow = true;
    taxiGroup.add(taxiMesh);

    // Connector Taxiways linking runway to parallel taxiway (every 600m)
    for (let x = -1200; x <= 1200; x += 600) {
      const connGeo = new THREE.PlaneGeometry(24, 160, 1, 4);
      connGeo.rotateX(-Math.PI * 0.5);
      setPavementUVs(connGeo);
      const conn = new THREE.Mesh(connGeo, asphaltMat);
      conn.position.set(x, this.elevation + 0.04, 80);
      conn.receiveShadow = true;
      taxiGroup.add(conn);
    }

    // Apron / Ramp Area (z = 240m to 420m)
    const apronGeo = new THREE.PlaneGeometry(1400, 180, 14, 2);
    apronGeo.rotateX(-Math.PI * 0.5);
    setPavementUVs(apronGeo);
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.set(0, this.elevation + 0.03, 270);
    apron.receiveShadow = true;
    taxiGroup.add(apron);

    this.group.add(taxiGroup);
  }

  buildLighting() {
    this.lightingGroup = new THREE.Group();
    const halfL = this.runwayLength * 0.5;
    const halfW = this.runwayWidth * 0.5;

    // 1. Runway Edge Lights (High Intensity White lights along edges every 60m)
    const edgeLightGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.45, 8);
    const edgeLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    for (let x = -halfL; x <= halfL; x += 60) {
      // North edge
      const elN = new THREE.Mesh(edgeLightGeo, edgeLightMat);
      elN.position.set(x, this.elevation + 0.3, -halfW - 1.5);
      // South edge
      const elS = new THREE.Mesh(edgeLightGeo, edgeLightMat);
      elS.position.set(x, this.elevation + 0.3, halfW + 1.5);

      this.lightingGroup.add(elN, elS);
    }

    // 2. Threshold Lights (Green for landing threshold, Red for runway end)
    const greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });

    for (let z = -halfW; z <= halfW; z += 4) {
      // West threshold (09L): Green approach bar
      const gWest = new THREE.Mesh(edgeLightGeo, greenMat);
      gWest.position.set(-halfL - 2, this.elevation + 0.3, z);

      // East threshold (27R): Green approach bar
      const gEast = new THREE.Mesh(edgeLightGeo, greenMat);
      gEast.position.set(halfL + 2, this.elevation + 0.3, z);

      this.lightingGroup.add(gWest, gEast);
    }

    // 3. Sequenced Flashing Approach Lighting System (ALS "The Rabbit" & MALSR Crossbars)
    // 15 strobe stations extending 750m out to the West of Runway 09L threshold
    this.approachStrobes = [];
    const steadyWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const crossbarLightGeo = new THREE.SphereGeometry(0.25, 8, 8);
    // Keep one light in the shader throughout the sequence. Zero-intensity
    // PointLights still contribute to Three.js's compiled light count.
    this.approachLight = new THREE.PointLight(0xffffff, 8.0, 45);
    this.approachLight.position.set(-halfL - 750, this.elevation + 2.6, 0);
    this.lightingGroup.add(this.approachLight);

    for (let i = 1; i <= 15; i++) {
      const sx = -halfL - i * 50;
      // Stanchion mast
      const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6);
      const mast = new THREE.Mesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
      mast.position.set(sx, this.elevation + 1.25, 0);
      this.lightingGroup.add(mast);

      this.approachStrobes.push(new THREE.Vector3(sx, this.elevation + 2.6, 0));

      // MALSR Standard Horizontal Crossbars at 150m (i=3) and 300m (i=6) from threshold
      if (i === 3 || i === 6) {
        const barWidth = i === 6 ? 24 : 16;
        const barGeo = new THREE.BoxGeometry(0.2, 0.2, barWidth);
        const barMesh = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({ color: 0x555555 }));
        barMesh.position.set(sx, this.elevation + 2.5, 0);
        this.lightingGroup.add(barMesh);

        // Steady white lights on crossbar
        const count = i === 6 ? 9 : 5;
        for (let b = 0; b < count; b++) {
          const bz = -barWidth * 0.5 + (b / (count - 1)) * barWidth;
          const cLight = new THREE.Mesh(crossbarLightGeo, steadyWhiteMat);
          cLight.position.set(sx, this.elevation + 2.65, bz);
          this.lightingGroup.add(cLight);
        }
      }
    }

    // 4. Interactive PAPI (Precision Approach Path Indicator - 4 Units)
    // Located on left (North) side of runway 09L at touchdown zone (x = -halfL + 350m)
    this.papiLights = [];
    const papiGroup = new THREE.Group();
    const papiBoxGeo = new THREE.BoxGeometry(1.4, 0.7, 1.2);
    const papiHousingMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.8 });

    for (let p = 0; p < 4; p++) {
      const unitGroup = new THREE.Group();
      const pz = -halfW - 14 - p * 3.8;
      unitGroup.position.set(-halfL + 350, this.elevation + 0.5, pz);

      // Protective housing box
      const box = new THREE.Mesh(papiBoxGeo, papiHousingMat);
      unitGroup.add(box);

      // Emissive Lens facing approaching aircraft (-X West)
      const lensGeo = new THREE.PlaneGeometry(0.8, 0.45);
      lensGeo.rotateY(-Math.PI * 0.5);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const lensMesh = new THREE.Mesh(lensGeo, lensMat);
      lensMesh.position.set(-0.71, 0.05, 0);
      unitGroup.add(lensMesh);

      // High-intensity Point Light
      const pointLight = new THREE.PointLight(0xffffff, 8.0, 60);
      pointLight.position.set(-1.2, 0.1, 0);
      unitGroup.add(pointLight);

      papiGroup.add(unitGroup);
      this.papiLights.push({ lensMat, pointLight, box });
    }
    this.lightingGroup.add(papiGroup);

    this.group.add(this.lightingGroup);
  }


  getGazeTargets() {
    const targets = [];
    if (this.towerGroup) targets.push({ object: this.towerGroup, kind: 'tower' });
    if (this.terminalGroup) targets.push({ object: this.terminalGroup, kind: 'terminal' });
    if (this.buildings?.group) targets.push({ object: this.buildings.group, kind: 'building' });
    return targets;
  }

  updateRenderLights(cameraHeight, limitAirborneLights) {
    // Keep runway emitters and approach indications visible. Above the airfield,
    // local lights cannot reach the aircraft, but still enter every lit shader.
    const altitude = cameraHeight - this.elevation;
    const cutoff = this.localLightsVisible === false ? 400 : 500;
    const visible = !limitAirborneLights || altitude < cutoff;
    if (visible === this.localLightsVisible) return;
    this.localLightsVisible = visible;
    this.approachLight.visible = visible;
    for (const { pointLight } of this.papiLights) pointLight.visible = visible;
    for (const light of this.beaconLights) light.visible = visible;
    for (const { light } of this.nightLighting.lamps) light.visible = visible;
  }

  update(dt, aircraftPos = null) {
    // 1. Rotate Airport Radar Antenna (1 revolution every 3.5 seconds)
    if (this.radarDish) {
      this.radarDish.rotation.y += dt * 1.8;
    }

    // 2. Animate Approach Lighting System "Rabbit" (sequenced pulsing strobes)
    const now = performance.now() * 0.001;
    // Sequential flash running from station 15 towards station 1
    const rabbitCycle = (now * 1.6) % 1.0; // 1.6 cycles per second
    const activeIndex = 15 - Math.floor(rabbitCycle * 15);

    this.approachLight.position.copy(this.approachStrobes[activeIndex - 1]);

    // 3. Obstruction Beacon Flashing
    const beaconActive = (now % 1.0) < 0.2;
    this.beaconLights.forEach(b => {
      b.intensity = beaconActive ? 5.0 : 0.2;
    });

    // 4. Dynamic PAPI Glideslope Indicator Lights (Runway 09L Touchdown Zone)
    if (aircraftPos && this.papiLights && this.papiLights.length === 4) {
      // Touchdown point for Runway 09L: x = -1250, elevation = 12.0
      const dx = -1250 - aircraftPos.x;
      const dy = aircraftPos.y - this.elevation;

      // Only evaluate when aircraft is approaching from the west (dx > 40m)
      if (dx > 40) {
        const gsDeg = THREE.MathUtils.radToDeg(Math.atan2(dy, dx));
        // Real-world PAPI calibration for standard 3.0° Glideslope (ICAO Annex 14 / FAA AIM).
        // Unit 0 is nearest the runway (steepest angle, turns red first) and unit 3 is
        // farthest away (shallowest angle), displaying White-White-Red-Red left-to-right on 3.0°.
        const thresholds = [3.5, 3.2, 2.8, 2.5];
        this.papiLights.forEach((papi, idx) => {
          const isWhite = gsDeg >= thresholds[idx];
          const colorHex = isWhite ? 0xffffff : 0xff1a1a;
          papi.lensMat.color.setHex(colorHex);
          papi.pointLight.color.setHex(colorHex);
        });
      } else {
        // Passed threshold: default to 2 white (outer) 2 red (inner)
        this.papiLights[0].lensMat.color.setHex(0xff1a1a);
        this.papiLights[0].pointLight.color.setHex(0xff1a1a);
        this.papiLights[1].lensMat.color.setHex(0xff1a1a);
        this.papiLights[1].pointLight.color.setHex(0xff1a1a);
        this.papiLights[2].lensMat.color.setHex(0xffffff);
        this.papiLights[2].pointLight.color.setHex(0xffffff);
        this.papiLights[3].lensMat.color.setHex(0xffffff);
        this.papiLights[3].pointLight.color.setHex(0xffffff);
      }
    }
  }

  /**
   * Determine if world coordinates fall within Coastal Airport's runway tarmac area
   */
  isOnRunway(x, z) {
    const halfL = this.runwayLength * 0.5 + 50; // 1650m (runway + overrun pads)
    const halfW = this.runwayWidth * 0.5 + 6;   // 36m (runway 09L/27R + paved shoulders)
    const onRunway = Math.abs(x) <= halfL && Math.abs(z) <= halfW;

    // Paved parallel taxiway A, 5 connector taxiways, and terminal apron
    const onParallelTaxiway = Math.abs(x) <= halfL && Math.abs(z - 160) <= 16;
    const distToConnector = Math.min(Math.abs(x % 600), 600 - Math.abs(x % 600));
    const onConnector = Math.abs(x) <= 1250 && distToConnector <= 15 && z >= -5 && z <= 165;
    const onApron = Math.abs(x) <= 720 && z >= 170 && z <= 370;

    return onRunway || onParallelTaxiway || onConnector || onApron;
  }

  /**
   * Determine if world coordinates fall within Coastal Airport's graded safety area
   */
  isRunwaySafetyArea(x, z) {
    const rsaL = this.runwayLength * 0.5 + 150; // 1750m
    const rsaW = this.runwayWidth * 0.5 + 25;   // 55m
    const inRunwayRsa = Math.abs(x) <= rsaL && Math.abs(z) <= rsaW;
    const inTaxiwayRsa = Math.abs(x) <= rsaL && Math.abs(z - 160) <= 30;
    const distToConnector = Math.min(Math.abs(x % 600), 600 - Math.abs(x % 600));
    const inConnectorRsa = Math.abs(x) <= 1300 && distToConnector <= 25 && z >= -15 && z <= 175;
    const inApronRsa = Math.abs(x) <= 760 && z >= 150 && z <= 390;

    return inRunwayRsa || inTaxiwayRsa || inConnectorRsa || inApronRsa;
  }
}
