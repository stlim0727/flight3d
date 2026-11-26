import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAddonStarter } from '../src/addons/addonStarter.js';
import { buildCatalog } from '../scripts/addon-tooling.mjs';
import { listAddons, buildAddonProfileUrl } from '../src/addons/addonCatalogBrowser.js';

test('scaffolding creates a starter addon with catalog and CI workflow', () => {
  const result = buildAddonStarter({
    publisher: 'demo', name: 'santorini-sky', kind: 'region',
    version: '1.2.0', coreVersion: '1.8.0', title: 'Santorini sky',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.files).sort(), ['.github/workflows/validate-addon.yml', 'README.md', 'addon.json', 'catalog.json']);
  assert.equal(result.files['addon.json'].id, 'demo/region/santorini-sky');
  assert.equal(result.files['addon.json'].coreRange.min, '1.8.0');
  assert.match(result.files['.github/workflows/validate-addon.yml'], /validate addon\.json --core 1\.8\.0/);
});

test('scaffolding rejects invalid identifiers and kinds', () => {
  const result = buildAddonStarter({ publisher: 'Bad Name', name: 'x', kind: 'magic', version: '1.0.0', coreVersion: '1.8.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /publisher/);
  assert.match(result.errors.join(' '), /kind/);
});

test('catalog command computes the manifest checksum and exact URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'addon-tooling-'));
  const manifestPath = join(dir, 'addon.json');
  const manifest = { id: 'demo/region/sky', version: '1.0.0' };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const catalog = await buildCatalog(manifestPath, 'https://packs.example/demo/region/sky/');
  assert.equal(catalog.addons[0].url, 'https://packs.example/demo/region/sky/addon.json');
  const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
  assert.equal(catalog.addons[0].sha256, digest);
});

test('catalog browser filters and builds a share URL from selected pins', () => {
  const catalog = { schemaVersion: 1, addons: [
    { id: 'demo/region/sky', version: '1.0.0', title: 'Sky', publisher: 'demo', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
    { id: 'demo/aircraft/jet', version: '2.0.0', title: 'Jet', publisher: 'demo', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) },
  ] };
  assert.deepEqual(listAddons(catalog, { kind: 'aircraft' }).map(entry => entry.id), ['demo/aircraft/jet']);
  assert.deepEqual(listAddons(catalog, { search: 'sky' }).map(entry => entry.id), ['demo/region/sky']);
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  const url = buildAddonProfileUrl(catalog, ['demo/region/sky'], { baseUrl: 'https://flight.example/?' });
  const params = new URL(url).searchParams;
  assert.equal(params.get('pack'), 'demo/region/sky');
  assert.equal(params.get('version'), '1.0.0');
  assert.ok(params.get('profile'));
});
