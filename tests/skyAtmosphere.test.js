import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';
import { Terrain } from '../src/environment/Terrain.js';

describe('SkyAtmosphere (Aerial Perspective Height Fog & Tone Mapping)', () => {
  it('should initialize with correct default exponential height fog parameters', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);

    assert.ok(sky.baseDensity >= 0.00018 && sky.baseDensity <= 0.00024, 'Base density should be in calibrated range (~0.00020)');
    assert.equal(sky.heightFalloff, 0.00068, 'Height falloff lambda should be 0.00068');
    assert.ok(scene.fog instanceof THREE.FogExp2, 'Scene fog should be initialized to THREE.FogExp2');
    assert.ok(sky.currentDensity > 0, 'Current density must be strictly positive');
    assert.ok(sky.currentExposure >= 0.95 && sky.currentExposure <= 1.20, 'Exposure should be in calibrated range');
  });

  it('should compute exponential density falloff with altitude: Density(y) = baseDensity * exp(-lambda * max(0, y))', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);

    // Test at sea level (y = 0m)
    sky.setTimeOfDay(12, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    const seaLevelDensity = sky.currentDensity;
    const baseDensity = sky.baseDensity;
    assert.ok(Math.abs(seaLevelDensity - baseDensity) < 1e-7, 'Sea level density must equal baseDensity');

    // Test at low altitude (100ft = 30.48m)
    const y100ft = 30.48;
    sky.setTimeOfDay(12, new THREE.Vector3(0, y100ft, 0), new THREE.Vector3(0, y100ft, 0));
    const expected100ft = baseDensity * Math.exp(-0.00068 * y100ft);
    assert.ok(Math.abs(sky.currentDensity - expected100ft) < 1e-7, 'Density at 100ft must match exponential decay formula');

    // Test at high altitude (6,000ft = 1828.8m)
    const y6000ft = 1828.8;
    sky.setTimeOfDay(12, new THREE.Vector3(0, y6000ft, 0), new THREE.Vector3(0, y6000ft, 0));
    const expected6000ft = baseDensity * Math.exp(-0.00068 * y6000ft);
    assert.ok(Math.abs(sky.currentDensity - expected6000ft) < 1e-7, 'Density at 6,000ft must match exponential decay formula');

    // High altitude density should drop to ~28% of sea level density
    const ratio = sky.currentDensity / baseDensity;
    assert.ok(ratio > 0.25 && ratio < 0.32, `6,000ft density ratio (${ratio}) should be ~28.8%`);
  });

  it('should calibrate ACESFilmic tone mapping exposure and fog color across 4 solar times', () => {
    const scene = new THREE.Scene();
    const mockRenderer = { toneMappingExposure: 1.0 };
    const sky = new SkyAtmosphere(scene, mockRenderer);

    // 1. Dawn / Sunrise (06:00)
    sky.setTimeOfDay(6.0, new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 10, 0));
    assert.equal(sky.currentExposure, 1.08, 'Dawn exposure should be 1.08 for soft morning glow');
    assert.equal(mockRenderer.toneMappingExposure, 1.08, 'Renderer exposure should sync with sky exposure');
    assert.equal(sky.baseDensity, 0.00023, 'Dawn base fog density should be 0.00023 for ground mist');
    assert.ok(sky.fogColor.r > sky.fogColor.b, 'Sunrise fog should have warm peach/rosy tone (R > B)');

    // 2. Noon (12:00)
    sky.setTimeOfDay(12.0, new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 10, 0));
    assert.equal(sky.currentExposure, 0.98, 'Noon exposure should be 0.98 to prevent highlight clipping on fuselage');
    assert.equal(mockRenderer.toneMappingExposure, 0.98);
    assert.ok(sky.baseDensity <= 0.00019, 'Noon base fog density should be lowest (~0.00018) for clear daytime skies');
    assert.ok(sky.fogColor.b > sky.fogColor.r, 'Noon fog should have Rayleigh sky-blue tone (B > R)');

    // 3. Sunset / Golden Hour (18:00)
    sky.setTimeOfDay(18.0, new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 10, 0));
    assert.equal(sky.currentExposure, 1.06, 'Sunset exposure should be 1.06');
    assert.equal(mockRenderer.toneMappingExposure, 1.06);
    assert.equal(sky.baseDensity, 0.00022, 'Sunset base fog density should be 0.00022');
    assert.ok(sky.fogColor.r > 0.85, 'Sunset fog red component should be fiery / amber');

    // 4. Night (23:00)
    sky.setTimeOfDay(23.0, new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 10, 0));
    assert.equal(sky.currentExposure, 0.90, 'Night exposure should keep terrain silhouettes dark');
    assert.equal(mockRenderer.toneMappingExposure, 0.90);
    assert.ok(sky.fogColor.r < 0.1 && sky.fogColor.g < 0.1 && sky.fogColor.b < 0.15, 'Night fog should be deep midnight navy');
  });

  it('keeps indirect light, clouds and overcast haze dark at night and restores daylight', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);
    sky.setTimeOfDay(12);
    const dayAmbient = sky.ambientLight.intensity;
    const dayCloud = sky.cloudLayer.material.uniforms.ambientColor.value.r;
    assert.equal(scene.environmentIntensity, 1);

    for (const airport of ['coastal', 'lukla']) {
      sky.setAirport(airport);
      sky.setTimeOfDay(0);
      const clearFog = sky.fogColor.clone();
      sky.setCloudCover(1);
      sky.updateSun();
      assert.ok(scene.environmentIntensity < 0.02, 'HDR reflections must not illuminate night surfaces');
      assert.ok(sky.ambientLight.intensity < dayAmbient * 0.1);
      assert.ok(sky.cloudLayer.material.uniforms.ambientColor.value.r < dayCloud * 0.05);
      assert.ok(sky.fogColor.equals(clearFog), 'Night overcast must not introduce daylight-grey haze');
      sky.setCloudCover(0);
    }

    sky.setAirport('coastal');
    sky.setTimeOfDay(12);
    assert.equal(scene.environmentIntensity, 1);
    assert.equal(sky.ambientLight.intensity, dayAmbient);
    assert.equal(sky.cloudLayer.material.uniforms.ambientColor.value.r, dayCloud);
    sky.cloudLayer.dispose();
  });

  it('strengthens Lukla daytime sun while retaining weather attenuation and night lighting', () => {
    const sky = new SkyAtmosphere(new THREE.Scene());
    sky.setAirport('coastal');
    sky.setTimeOfDay(12);
    const coastalSun = sky.sunLight.intensity;
    sky.setAirport('lukla');
    const luklaSun = sky.sunLight.intensity;
    assert.ok(luklaSun > coastalSun * 1.7);
    sky.setCloudCover(1);
    sky.updateSun();
    assert.ok(Math.abs(sky.sunLight.intensity / luklaSun - 0.15) < 1e-10);
    sky.setCloudCover(0);
    sky.setTimeOfDay(0);
    const luklaNight = sky.sunLight.intensity;
    sky.setAirport('coastal');
    assert.equal(sky.sunLight.intensity, luklaNight);
    sky.setTimeOfDay(12);
    assert.equal(sky.sunLight.intensity, coastalSun);
    sky.cloudLayer.dispose();
  });

  it('should apply high-altitude Rayleigh blue depth cueing during daytime ascent', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);

    // At low altitude (100m)
    sky.setTimeOfDay(12.0, new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 100, 0));
    const lowAltBlue = sky.fogColor.b;

    // At high altitude (2500m)
    sky.setTimeOfDay(12.0, new THREE.Vector3(0, 2500, 0), new THREE.Vector3(0, 2500, 0));
    const highAltFog = sky.fogColor.clone();

    // High altitude fog color should be shifted towards Rayleigh blue rgb(0.48, 0.64, 0.86)
    assert.ok(highAltFog.b > 0.80, 'High altitude fog must exhibit rich Rayleigh blue scattering');
  });

  it('should synchronize WaterOcean uniforms with SkyAtmosphere fog and sun lighting', () => {
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(scene);
    const water = new WaterOcean(36000);

    sky.setWater(water);
    sky.setTimeOfDay(18.0, new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 500, 0));

    const uniforms = water.material.uniforms;
    assert.ok(Math.abs(uniforms.uFogDensity.value - sky.currentDensity) < 1e-7, 'Water uFogDensity must match sky currentDensity');
    assert.equal(uniforms.uBaseFogDensity.value, sky.baseDensity, 'Water uBaseFogDensity must match sky baseDensity');
    assert.equal(uniforms.uFogHeightFalloff.value, sky.heightFalloff, 'Water uFogHeightFalloff must match sky heightFalloff');
    assert.ok(Math.abs(uniforms.uFogColor.value.r - sky.fogColor.r) < 1e-4, 'Water uFogColor.r must match sky fogColor.r');
    assert.ok(Math.abs(uniforms.uFogColor.value.g - sky.fogColor.g) < 1e-4, 'Water uFogColor.g must match sky fogColor.g');
    assert.ok(Math.abs(uniforms.uFogColor.value.b - sky.fogColor.b) < 1e-4, 'Water uFogColor.b must match sky fogColor.b');
    assert.ok(Math.abs(uniforms.uSunColor.value.r - sky.sunLight.color.r) < 1e-4, 'Water sun color must match directional sunlight');
  });

  it('should slope terrain perimeter edges down to ocean water (-18m) to eliminate 22km boundary cutoff', () => {
    const terrain = new Terrain(22000, 128);

    // Center area (airport region) should be above sea level
    const centerH = terrain.getHeight(0, 0);
    assert.ok(centerH >= terrain.airportElevation, 'Center elevation should match or exceed airport elevation');

    // Inside normal bounds (< 8,200m)
    const midH = terrain.getHeight(5000, 5000);
    assert.ok(typeof midH === 'number' && !isNaN(midH));

    // Outer edge at margin 10,800m should slope down smoothly to -18.0m
    const edgeH = terrain.getHeight(10800, 0);
    assert.equal(edgeH, -18.0, 'Perimeter edge at 10,800m must blend below sea level (-18m)');

    const cornerH = terrain.getHeight(10800, 10800);
    assert.equal(cornerH, -18.0, 'Perimeter corner at 10,800m must blend below sea level (-18m)');
  });
});
