import assert from 'node:assert/strict';
import test from 'node:test';
import { PbfWriter } from 'pbf';
import { buildGeographicBuildingTile, geographicBuildingHeight, GeographicBuildings } from '../src/environment/GeographicBuildings.js';

function buildingTile() {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, 'building');
    layer.writeVarintField(15, 2);
    layer.writeVarintField(5, 4096);
    layer.writeMessage(2, (_, feature) => {
      feature.writeVarintField(3, 3);
      // A clockwise square crosses the left boundary.
      feature.writePackedVarint(4, [9, 199, 200, 26, 800, 0, 0, 800, 799, 0, 15]);
    }, null);
  }, null);
  return writer.finish();
}

test('uses source heights, floors, and the shared default in order', () => {
  assert.equal(geographicBuildingHeight({ height: 36, num_floors: 7 }), 36);
  assert.ok(Math.abs(geographicBuildingHeight({ height: -1, num_floors: 7 }) - 22.4) < 1e-9);
  assert.equal(geographicBuildingHeight({ height: 0, num_floors: 0 }), 9);
});

test('clips building roofs to the tile and anchors meshes to the flight surface', () => {
  const project = (latitude, longitude) => [longitude * 100000, -latitude * 100000];
  const tile = { x: 8192, y: 8192 };
  const terrain = { getHeight: () => 44 };
  const data = buildingTile();
  const geometry = buildGeographicBuildingTile(data, tile, project, terrain);
  assert.ok(geometry);
  geometry.computeBoundingBox();
  assert.equal(geometry.boundingBox.min.x, 0);
  assert.equal(geometry.boundingBox.min.y, 44);
  assert.equal(geometry.boundingBox.max.y, 53);
  assert.equal(geometry.attributes.normal.getY(0), 1);
  assert.equal(buildGeographicBuildingTile(data, tile, project, terrain, () => true), null);
  assert.equal(buildGeographicBuildingTile(data, tile, project, { ...terrain, isWater: () => true }), null);
  geometry.dispose();
});

test('disposal aborts pending tile fetches and ignores their late results', async () => {
  let complete;
  const archive = {
    getZxy: (_zoom, _x, _y, signal) => new Promise(resolve => {
      complete = () => {
        assert.equal(signal.aborted, true);
        resolve({ data: buildingTile() });
      };
    }),
  };
  const layer = new GeographicBuildings({ archive, terrain: {}, project: () => [0, 0] });
  const load = layer.load({ key: '8192/8192', x: 8192, y: 8192 });
  layer.dispose();
  complete();
  await load;
  assert.equal(layer.group.children.length, 0);
  assert.equal(layer.tiles.size, 0);
});
