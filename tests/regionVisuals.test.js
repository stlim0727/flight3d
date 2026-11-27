import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { regionPackFromProfile } from '../src/addons/regionPackBinding.js';
import { addonMapBookmarks, applyRegionPalette, buildingOverrideAt, regionPaletteHex } from '../src/addons/regionVisuals.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';

const manifest = {
  schemaVersion: 1,
  id: 'poc/region/visual-bay',
  publisher: 'poc',
  version: '1.0.0',
  coreRange: { min: '1.0.0', maxExclusive: '2.0.0' },
  dependencies: [],
  license: 'CC0-1.0',
  attribution: 'Region visuals test pack',
  region: {
    bounds: { west: 25.36, south: 36.38, east: 25.48, north: 36.48 },
    origin: { latitude: 36.42, longitude: 25.43 },
    verticalDatum: 'EGM2008',
    tiles: {
      format: 'xyz-image',
      url: 'https://packs.example/visual-bay/tiles/{z}/{y}/{x}.png',
      checksum: 'd'.repeat(64),
      minZoom: 12,
      maxZoom: 16,
    },
    palette: {
      sea: { deepColor: '#0b3a63', shallowColor: '#3db8c9', roughness: 0.22, daylightScale: 1.45 },
      sky: { hazeColor: '#dcecf5' },
    },
    buildingOverrides: [{
      id: 'white-walls',
      bounds: { west: 25.36, south: 36.38, east: 25.48, north: 36.48 },
      material: { baseColor: '#f7f3ea', roofColor: '#2f6fb5' },
      collision: 'replace',
    }],
    bookmarks: [{
      id: 'visual-bay-view',
      label: 'Visual Bay · Viewpoint',
      latitude: 36.42,
      longitude: 25.43,
      headingDeg: 180,
      altitudeM: 900,
    }],
  },
};

function pinnedPack() {
  assert.equal(validateAddonManifest(manifest, { coreVersion: '1.0.0' }).ok, true);
  const profile = {
    schemaVersion: 1,
    coreVersion: '1.0.0',
    pins: [{ id: manifest.id, version: manifest.version, url: 'https://packs.example/visual-bay/addon.json', sha256: 'a'.repeat(64), manifest }],
  };
  return regionPackFromProfile(profile, manifest.id, { coreVersion: '1.0.0' });
}

test('a pinned region pack carries palette, building overrides and bookmarks', () => {
  const pack = pinnedPack();
  assert.equal(pack.id, 'poc/region/visual-bay');
  assert.ok(pack.urlTemplate.startsWith('https://packs.example/visual-bay/tiles/1.0.0/'));
  assert.deepEqual(regionPaletteHex(pack), {
    deepColor: '#0b3a63', shallowColor: '#3db8c9', roughness: 0.22, daylightScale: 1.45, hazeColor: '#dcecf5',
  });
  assert.equal(buildingOverrideAt(pack, 36.42, 25.43).material.baseColor, '#f7f3ea');
  assert.equal(addonMapBookmarks(pack)[0].latitude, 36.42);
  assert.equal(pack.cacheOptions.urlTemplate, pack.urlTemplate);
});

test('a pinned region palette reaches both ocean and sky uniforms', () => {
  const pack = pinnedPack();
  const water = new WaterOcean(1000, 4, { quality: 'ultraLow' });
  const sky = new SkyAtmosphere(new THREE.Scene(), null, water);
  applyRegionPalette(pack, { water, sky });
  assert.equal(water.material.uniforms.uDeepColor.value.getHexString(), '0b3a63');
  assert.equal(water.material.uniforms.uShallowColor.value.getHexString(), '3db8c9');
  assert.equal(water.material.uniforms.uRoughness.value, 0.22);
  assert.equal(water.material.uniforms.uDaylightScale.value, 1.45);
  assert.equal(sky.sky.material.uniforms.uHazeColor.value.getHexString(), 'dcecf5');
  assert.equal(sky.hazePalette.getHexString(), 'dcecf5');
  sky.updateSun();
  assert.equal(sky.sky.material.uniforms.uDeepColor.value.getHexString(), '0b3a63');
  assert.equal(sky.sky.material.uniforms.uRoughness.value, 0.22);
  assert.equal(sky.sky.material.uniforms.uDaylightScale.value, 1.45);

  applyRegionPalette(null, { water, sky });
  assert.equal(water.material.uniforms.uDeepColor.value.getHexString(), '0a284a');
  assert.equal(water.material.uniforms.uShallowColor.value.getHexString(), '136a8a');
  assert.equal(water.material.uniforms.uRoughness.value, 0.252);
  assert.equal(water.material.uniforms.uDaylightScale.value, 1.0);
  assert.equal(sky.hazePalette, null);

  water.geometry.dispose();
  water.material.dispose();
});
