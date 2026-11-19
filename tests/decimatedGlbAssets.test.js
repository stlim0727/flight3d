import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import draco3d from 'draco3dgltf';
import {
  LOD_DIRECTORY,
  LOD_MIN_BYTE_GAIN,
  LOD_SIZE_THRESHOLD_BYTES,
  MODELS_DIRECTORY,
  countTriangles,
  createGltfIO,
} from '../scripts/decimate-glb-assets.mjs';

async function readDocument(io, file) {
  const document = await io.read(file);
  const root = document.getRoot();
  return {
    triangles: countTriangles(document),
    nodeNames: root.listNodes().map(node => node.getName()).sort(),
    materialNames: root.listMaterials().map(material => material.getName()).sort(),
  };
}

function listLods() {
  return readdir(LOD_DIRECTORY, { recursive: true, withFileTypes: true })
    .then(entries => entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.glb'))
      .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
      .sort())
    .catch(error => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
}

test('every gallery LOD is lighter than its source and keeps its structure', async () => {
  const lods = await listLods();
  assert.ok(lods.length > 0, 'expected generated LOD GLBs under public/models/lod');
  const io = createGltfIO({ decoder: await draco3d.createDecoderModule({}) });

  for (const lodPath of lods) {
    const relative = path.relative(LOD_DIRECTORY, lodPath);
    const sourcePath = path.join(MODELS_DIRECTORY, relative);
    const sourceBytes = (await stat(sourcePath)).size;
    const lodBytes = (await stat(lodPath)).size;

    assert.ok(sourceBytes >= LOD_SIZE_THRESHOLD_BYTES, `${relative} source is below the LOD size threshold`);
    assert.ok(
      1 - lodBytes / sourceBytes >= LOD_MIN_BYTE_GAIN,
      `${relative} LOD (${lodBytes} B) does not gain ${LOD_MIN_BYTE_GAIN * 100}% over its source (${sourceBytes} B)`,
    );

    const source = await readDocument(io, sourcePath);
    const lod = await readDocument(io, lodPath);
    assert.ok(lod.triangles > 0, `${relative} LOD has no triangles`);
    assert.ok(lod.triangles < source.triangles, `${relative} LOD has ${lod.triangles} triangles vs source ${source.triangles}`);
    assert.deepEqual(lod.nodeNames, source.nodeNames, `${relative} LOD changed node names`);
    assert.deepEqual(lod.materialNames, source.materialNames, `${relative} LOD changed material names`);
  }
});

test('texture-bound c172 is not duplicated as an LOD', async () => {
  const lods = await listLods();
  assert.equal(
    lods.some(lodPath => lodPath.endsWith(`${path.sep}c172.glb`)),
    false,
    'c172.glb is texture-bound; mesh decimation does not cut its payload enough to ship a duplicate',
  );
});
