import test from 'node:test';
import assert from 'node:assert/strict';
import { getInsetsForRegion } from '../src/config/terrainInsets.js';
import { OpenWorldRegionSurface } from '../src/environment/OpenWorldRegionSurface.js';
import { buildOpenTerrainTile } from '../src/environment/OpenWorldTerrain.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';
import { INCHEON_PATCH } from '../src/geospatial/incheon.js';
import { IncheonFlightSurface } from '../src/geospatial/IncheonFlightSurface.js';
import { terrainGeometry } from '../src/previews/incheonGeometry.js';
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

test('Incheon common surface supplies a DSM mesh inside the protected area', () => {
  const config = REGION_SURFACES.incheon;
  const source = {
    getHeight: (x, z) => 7 + Math.hypot(x, z) / 100,
    getNaturalHeight: (x, z) => 7 + Math.hypot(x, z) / 100,
    isLand: () => true,
    coastline: { land: { type: 'Polygon', coordinates: [[[-6000, -6000], [6000, -6000], [6000, 6000], [-6000, 6000], [-6000, -6000]]] } },
  };
  const flightSurface = new IncheonFlightSurface(source);
  const localSurface = {
    size: 12000,
    segments: 240,
    geometry: terrainGeometry(12000, 240, (x, z) => source.getNaturalHeight(x, z)),
    getNaturalHeight: (x, z) => source.getNaturalHeight(x, z),
    getHeight: (x, z) => flightSurface.getHeight(x, z),
  };
  const surface = new OpenWorldRegionSurface({ ...config, fallback: {}, localSurface });
  assert.equal(surface.localSurface, localSurface);

  const raster = new Float32Array(256 * 256).fill(0);
  const project = (_lat, _lon) => [0, 0];
  const { geometry } = buildOpenTerrainTile({
    x: 1746, y: 793, raster,
    east: raster, south: raster, southeast: raster,
    water: new Uint8ClampedArray(256 * 256 * 4),
    project, localSurface,
    blendHeight: (_x, _z, height) => height,
  });
  assert.ok(geometry.index.count > 0, 'common tile must retain terrain without a protected hole');
  surface.dispose();
});
