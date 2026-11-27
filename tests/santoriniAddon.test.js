import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { regionPackFromProfile } from '../src/addons/regionPackBinding.js';
import { addonMapBookmarks, applyRegionPalette, buildingOverrideAt, regionPaletteHex } from '../src/addons/regionVisuals.js';
import { buildGeographicBuildingTile } from '../src/environment/GeographicBuildings.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';

async function santoriniPack() {
  const manifest = JSON.parse(await readFile(new URL('../examples/packs/santorini/addon.json', import.meta.url)));
  assert.equal(validateAddonManifest(manifest, { coreVersion: '1.8.0' }).ok, true);
  const profile = {
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [{ id: manifest.id, version: manifest.version, url: 'https://packs.example/santorini/addon.json', sha256: 'a'.repeat(64), manifest }],
  };
  return regionPackFromProfile(profile, manifest.id, { coreVersion: '1.8.0' });
}

test('Santorini pin carries the Aegean palette and whitewashed building overrides', async () => {
  const pack = await santoriniPack();
  assert.equal(pack.id, 'med/region/santorini');
  assert.equal(pack.version, '1.0.0');
  assert.ok(pack.urlTemplate.startsWith('https://packs.example/santorini/tiles/1.0.0/'));
  assert.deepEqual(regionPaletteHex(pack), {
    deepColor: '#0b3a63', shallowColor: '#3db8c9', roughness: 0.22, daylightScale: 1.45, hazeColor: '#dcecf5',
  });
  const override = buildingOverrideAt(pack, 36.42, 25.43);
  assert.equal(override.id, 'santorini-white-walls');
  assert.equal(override.material.baseColor, '#f7f3ea');
  assert.equal(buildingOverrideAt(pack, 37.5, 25.43), null);
});

test('pinned palette reaches both ocean and sky uniforms', async () => {
  const pack = await santoriniPack();
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
  water.geometry.dispose();
  water.material.dispose();
});

test('building override tints matching features without changing collision envelopes', async () => {
  const pack = await santoriniPack();
  const override = buildingOverrideAt(pack, 36.42, 25.43);
  assert.equal(override.collision, 'replace');
  assert.equal(override.material.baseColor, '#f7f3ea');
});

test('the pinned Santorini tile URL is injected into its cache options', async () => {
  const pack = await santoriniPack();
  assert.equal(pack.cacheOptions.urlTemplate, pack.urlTemplate);
  assert.equal(pack.cacheOptions.maxConcurrent, 4);
  assert.match(pack.urlTemplate, /^https:\/\/packs\.example\/santorini\/tiles\/1\.0\.0\/{z}\/{y}\/{x}\.png$/);
});

test('Santorini pack exposes lobby bookmarks for the caldera and Oia', async () => {
  const pack = await santoriniPack();
  const bookmarks = addonMapBookmarks(pack);
  assert.equal(bookmarks.length, 2);
  assert.equal(bookmarks[0].id, 'santorini-caldera');
  assert.equal(bookmarks[0].latitude, 36.42);
  assert.equal(bookmarks[0].longitude, 25.43);
  assert.equal(bookmarks[1].id, 'santorini-oia');
  assert.equal(bookmarks[1].label, 'Santorini · Oia');
});
