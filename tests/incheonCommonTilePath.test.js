import test from 'node:test';
import assert from 'node:assert/strict';
import { getInsetsForRegion } from '../src/config/terrainInsets.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';
import { INCHEON_PATCH } from '../src/geospatial/incheon.js';
import { wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';

test('Incheon uses the common anchor surface registry', () => {
  const config = REGION_SURFACES.incheon;
  assert.ok(config, 'Incheon surface config must be registered alongside Jeju');
  assert.equal(config.origin.latitude, INCHEON_PATCH.origin.latitude);
  assert.equal(config.origin.longitude, INCHEON_PATCH.origin.longitude);
  assert.deepEqual(config.precinctExtent, [-6000, -6000, 6000, 6000]);
  assert.equal(config.elevationM, 7);
});

test('RKSI inset is declared in the common tile inset registry', () => {
  const insets = getInsetsForRegion('incheon');
  assert.equal(insets.length, 1);
  assert.equal(insets[0].id, 'rksi');
  assert.equal(insets[0].minDetailLevel, 13);
  assert.equal(insets[0].maxDetailLevel, 14);
  assert.equal(insets[0].approachDistanceM, 8000);
  const tile = wgs84ToTile(INCHEON_PATCH.origin.latitude, INCHEON_PATCH.origin.longitude, 11);
  assert.ok(Number.isInteger(tile.x) && Number.isInteger(tile.y));
});
