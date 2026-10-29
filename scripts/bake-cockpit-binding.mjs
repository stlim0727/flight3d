import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Cockpit } from '../src/aircraft/Cockpit.js';
import { CockpitLightTransfer } from '../src/aircraft/CockpitLightTransfer.js';
import { loadCockpitGeometry } from './lib/load-cockpit-geometry.mjs';

// Binding depends on final procedural framing, split controls and static batches;
// source GLB attributes alone cannot describe that geometry. No ray tracing needed.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const variant of ['medium', 'draco']) {
  const base = `public/lighting/cockpit-${variant}`;
  const manifest = JSON.parse(fs.readFileSync(`${base}.json`));
  const cockpit = new Cockpit({}, {}, {}, {}, {}, {});
  cockpit.prepareModel(await loadCockpitGeometry(`public/models/b737-cockpit-${variant}.glb`));
  const transfer = new CockpitLightTransfer(manifest,
    new Float32Array(manifest.keys.length * manifest.columns));
  transfer.bind(cockpit.gltfCockpitGroup);
  if (transfer.coverage !== 1) throw Error(`Incomplete ${variant} vertex binding`);
  const meshes = [], arrays = [];
  cockpit.gltfCockpitGroup.traverse(mesh => {
    if (!transfer.isReceiver(mesh)) return;
    const attribute = mesh.geometry.attributes.deckTransferUV;
    meshes.push({ name: mesh.name, count: attribute.count });
    arrays.push(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  });
  const bytes = Buffer.concat(arrays), compressed = gzipSync(bytes, { level: 9 });
  const sources = Object.fromEntries([...Object.keys(manifest.sources),
    'src/aircraft/CockpitLightTransfer.js', 'scripts/bake-cockpit-binding.mjs']
    .map(file => [file, hash(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))]));
  fs.writeFileSync(`${base}-binding.uvpack`, compressed);
  fs.writeFileSync(`${base}-binding.json`, JSON.stringify({
    version: 1, meshes, values: bytes.length / 4, coverage: transfer.coverage,
    assetHash: manifest.assetHash, transferHash: manifest.dataHash,
    dataHash: hash(compressed), sources,
  }));
  transfer.dispose();
  console.log(`${variant}: ${bytes.length} UV bytes → ${compressed.length} gzip bytes`);
}
