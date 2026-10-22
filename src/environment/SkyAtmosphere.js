import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { CloudLayer } from './CloudLayer.js';
import { CockpitSunShadow } from './CockpitSunShadow.js';

const OVERCAST_GREY = new THREE.Color(0.55, 0.57, 0.60);

/**
 * Atmospheric Sky, Sun, Dynamic Lighting & Cumulus Clouds
 * Features realistic Rayleigh & Mie scattering Sky shader, time-of-day presets (Dawn, Noon, Sunset, Night),
 * and instanced cumulus density volumes at 2,800–3,600m altitude.
 */
export class SkyAtmosphere {
  constructor(scene, renderer = null, water = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.water = water;

    // Atmospheric Exponential Height Fog parameters
    this.fogColor = new THREE.Color(0xc8def4);
    this.baseDensity = 0.00020;
    this.heightFalloff = 0.00068; // lambda: density drops to ~28% by 1,828m (6,000ft)
    this.currentDensity = 0.00020;
    this.currentExposure = 1.05;

    // Time of day (hours: 0.0 to 24.0, default 16.5 = Golden Hour Afternoon)
    this.timeOfDay = 16.8;

    // Cloud cover 0..1: fair-weather by default, attenuates direct sun and softens shadows
    this.cloudCover = 0;
    this.sunAttenuation = 1;
    this.shadowSoftening = 1;

    // Sunlight & Ambient lights
    this.sunLight = new THREE.DirectionalLight(0xfff4e5, 3.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 2000;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.02;
    const sCam = 120;
    this.sunLight.shadow.camera.left = -sCam;
    this.sunLight.shadow.camera.right = sCam;
    this.sunLight.shadow.camera.top = sCam;
    this.sunLight.shadow.camera.bottom = -sCam;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.ambientLight = new THREE.AmbientLight(0xdde8f5, 1.2);
    this.scene.add(this.ambientLight);

    // Sunlight admitted through the windshield, so that the flight deck reads the same
    // time of day, weather and heading as the exterior. Built here rather than on first
    // cockpit entry: adding a shadow-casting light later recompiles every lit material.
    this.cockpitSun = new CockpitSunShadow(this.scene);

    // Sky shader object
    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    this.scene.add(this.sky);

    this.sunPosition = new THREE.Vector3();

    // Fair-weather cumulus cloud layer
    this.cloudsGroup = new THREE.Group();
    this.initClouds();
    this.scene.add(this.cloudsGroup);

    this.updateSun();
    this.initEnvironmentMap();
  }

  initEnvironmentMap() {
    if (typeof window === 'undefined') return;
    try {
      const loader = new RGBELoader();
      loader.load(
        `${import.meta.env?.BASE_URL ?? '/'}textures/environment/sky_1k.hdr`,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.scene.environment = texture;
        },
        undefined,
        () => {
          // Fallback: generate PMREM from sky shader if HDR is unreachable
          if (this.renderer && this.sky) {
            try {
              const pmrem = new THREE.PMREMGenerator(this.renderer);
              this.scene.environment = pmrem.fromScene(this.sky).texture;
              pmrem.dispose();
            } catch (e) {
              // Ignore in headless / unsupported contexts
            }
          }
        }
      );
    } catch (e) {
      // Graceful fallback
    }
  }

  setRenderer(renderer) {
    this.renderer = renderer;
    if (this.renderer && this.currentExposure !== undefined) {
      this.renderer.toneMappingExposure = this.currentExposure;
    }
  }

  setWater(water) {
    this.water = water;
    if (this.water && typeof this.water.syncWithAtmosphere === 'function') {
      this.water.syncWithAtmosphere(this);
    }
  }

  setTimeOfDay(hours, targetPos = null, cameraPos = null) {
    this.timeOfDay = (hours + 24) % 24;
    this.updateSun(targetPos, cameraPos);
  }

  /**
   * Set cloud cover for the atmospheric gate: 0 is the shipped fair-weather sky, 1 is
   * featureless overcast. Takes effect on the next updateSun.
   */
  setCloudCover(value) {
    this.cloudCover = Math.min(1, Math.max(0, value));
  }

  /**
   * Aim the flight deck sun at the windshield for this frame and return the daylight
   * factor used to dim the instrument floods.
   */
  updateCockpitSun({ position, quaternion, cockpitActive = false, dt = 0 }) {
    return this.cockpitSun.update({
      position,
      quaternion,
      sunDir: this.sunPosition,
      sunColor: this.sunLight.color,
      sunIntensity: this.sunLight.intensity,
      cockpitActive,
      dt,
    });
  }

  updateSun(targetPos = null, cameraPos = null) {
    // Map 24h to solar elevation and azimuth
    // 06:00 = Sunrise (elev 0°), 12:00 = Noon (elev 65°), 18:00 = Sunset (elev 0°), 24:00 = Midnight
    const hourRad = ((this.timeOfDay - 6.0) / 24.0) * Math.PI * 2.0;

    const elevation = Math.sin(hourRad) * 65.0; // degrees
    const azimuth = 180.0 + Math.cos(hourRad) * 45.0; // degrees
    const isMorning = Math.cos(hourRad) >= 0;

    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);

    this.sunPosition.setFromSphericalCoords(1, phi, theta);

    // Update Sky Shader uniforms (smooth continuous Rayleigh transition prevents sky flashing)
    const rayleighT = Math.max(0.0, Math.min(1.0, (elevation - 4.0) / 12.0));
    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = 8.0;
    uniforms['rayleigh'].value = 3.5 - 2.3 * rayleighT;
    uniforms['mieCoefficient'].value = 0.005;
    uniforms['mieDirectionalG'].value = 0.85;
    uniforms['sunPosition'].value.copy(this.sunPosition);

    // Update Sun Light direction & position following aircraft to eliminate shadow clipping popping
    if (targetPos) {
      this.sunLight.target.position.copy(targetPos);
      this.sunLight.position.copy(targetPos).addScaledVector(this.sunPosition, 600);
    } else {
      this.sunLight.position.copy(this.sunPosition).multiplyScalar(800);
    }

    // Determine observer altitude for exponential height fog
    const altitude = cameraPos ? Math.max(0, cameraPos.y) : (targetPos ? Math.max(0, targetPos.y) : 0);

    // 1. Time-of-Day Atmospheric Scattering, Light Colors & Base Fog Properties
    let exposure = 1.05;

    if (elevation > 5.0) {
      // Daylight / Noon (elevation 5° to 65°)
      const t = Math.min(1.0, (elevation - 5.0) / 25.0);
      this.sunLight.color.setRGB(1.0, 0.95 + t * 0.05, 0.88 + t * 0.12);
      this.sunLight.intensity = 2.0 + t * 1.5;
      this.ambientLight.color.setRGB(0.85, 0.92, 1.0);
      this.ambientLight.intensity = 0.85 + t * 0.45;

      this.baseDensity = 0.00021 - t * 0.00003; // 0.00018 at noon
      this.fogColor.setRGB(0.70 + t * 0.02, 0.82 + t * 0.04, 0.93 + t * 0.03); // Crisp Rayleigh sky-blue haze
      exposure = 1.04 - t * 0.06; // 0.98 at noon to eliminate white fuselage highlight blowout
    } else if (elevation > -4.0) {
      // Twilight / Golden Hour: Dawn/Sunrise (06:00) vs Sunset (18:00)
      const trans = (elevation + 4.0) / 9.0;
      if (isMorning) {
        // Dawn / Sunrise: soft rosy-peach & golden morning mist
        this.sunLight.color.setRGB(1.0, 0.65 * trans + 0.35, 0.40 * trans + 0.15);
        this.sunLight.intensity = Math.max(0.2, trans * 1.8);
        this.ambientLight.color.setRGB(0.65, 0.65, 0.78);
        this.ambientLight.intensity = 0.50 + trans * 0.35;

        this.fogColor.setRGB(0.88, 0.64 * trans + 0.30, 0.54 * trans + 0.25);
        this.baseDensity = 0.00023; // Richer low-level morning ground mist
        exposure = 1.08;
      } else {
        // Sunset / Golden Hour: warm amber, fiery crimson & golden glow
        this.sunLight.color.setRGB(1.0, 0.45 * trans + 0.25, 0.12 * trans + 0.08);
        this.sunLight.intensity = Math.max(0.2, trans * 1.6);
        this.ambientLight.color.setRGB(0.70, 0.52, 0.58);
        this.ambientLight.intensity = 0.48 + trans * 0.32;

        this.fogColor.setRGB(0.92, 0.54 * trans + 0.22, 0.32 * trans + 0.18);
        this.baseDensity = 0.00022;
        exposure = 1.06;
      }
    } else {
      // Night / Twilight (elevation < -4.0°)
      this.sunLight.intensity = 0.06;
      this.sunLight.color.setRGB(0.2, 0.3, 0.5); // Cool lunar moonlight
      this.ambientLight.color.setRGB(0.12, 0.16, 0.28);
      this.ambientLight.intensity = 0.34;

      this.fogColor.setRGB(0.03, 0.05, 0.10); // Deep midnight navy/indigo
      this.baseDensity = 0.00020;
      exposure = 1.15; // Preserves dark ground silhouettes and stars without muddy dark crushing
    }

    // 1b. Cloud Cover: direct sun and shadow sharpness fall off continuously with
    // overcast, skylight and haze take over. Functions of the cloudCover state scalar,
    // never a clear/overcast mode switch.
    const cloud = Math.min(1, Math.max(0, this.cloudCover));
    const cloudRamp = cloud * cloud * (3 - 2 * cloud);
    this.sunAttenuation = 1 - 0.85 * cloudRamp;
    this.shadowSoftening = 1 - 0.65 * cloudRamp;
    this.sunLight.intensity *= this.sunAttenuation;
    this.sunLight.shadow.intensity = this.shadowSoftening;
    this.cockpitSun.light.shadow.intensity = this.shadowSoftening;
    this.ambientLight.intensity += 0.25 * cloudRamp;
    this.fogColor.lerp(OVERCAST_GREY, 0.35 * cloudRamp);

    // 2. High-Altitude Rayleigh Blue Depth Cueing
    // As aircraft ascends above 400m towards stratosphere (1,500m ~ 3,000m+),
    // aerosol turbidity gives way to pure Rayleigh blue scatter
    const altT = Math.min(1.0, Math.max(0.0, (altitude - 400.0) / 2200.0));
    if (elevation > 5.0) {
      this.fogColor.lerp(new THREE.Color(0.48, 0.64, 0.86), altT * 0.40);
    }

    // 3. Exponential Height Falloff: Density(y) = baseDensity * exp(-lambda * max(0, y))
    const heightFactor = Math.exp(-this.heightFalloff * Math.max(0, altitude));
    this.currentDensity = this.baseDensity * heightFactor;
    this.currentExposure = exposure;

    // 4. Update Three.js Scene Fog
    if (!this.scene.fog) {
      this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.currentDensity);
    } else {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = this.currentDensity;
    }

    // 5. Update ACESFilmic Tone Mapping Exposure
    if (this.renderer) {
      this.renderer.toneMappingExposure = exposure;
    }

    this.cloudLayer.syncLighting(this.sunLight, this.ambientLight);

    // 6. Synchronize Water Ocean Atmospheric Shaders
    if (this.water && typeof this.water.syncWithAtmosphere === 'function') {
      this.water.syncWithAtmosphere(this);
    }
  }

  initClouds() {
    this.cloudLayer = new CloudLayer();
    this.cloudsGroup.add(this.cloudLayer);
  }

  prepareRender(camera) {
    // Sort before renderer.render uploads instance buffers, including camera cuts.
    this.cloudLayer.sortForCamera(camera);
  }

  getSunDirection() {
    return this.sunPosition.clone().normalize();
  }

  /**
   * Adjust cloud base altitude depending on active airport
   * Coastal airport sits at sea level (12m), while Lukla sits at 2,845m in the Himalayas.
   */
  setAirport(airportId) {
    if (airportId === 'lukla') {
      // Elevate fair-weather cloud deck high above Himalayan peaks (base ~6,200m / 20,300 FT)
      this.cloudsGroup.position.y = 3400;
    } else {
      this.cloudsGroup.position.y = 0;
    }
  }
}
