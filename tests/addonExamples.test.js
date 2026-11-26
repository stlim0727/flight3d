import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lintAddonSet } from '../src/addons/lintAddonSet.js';
import { validateAddonManifest } from '../src/addons/addonContract.js';

const packs = [
  'examples/packs/aircraft/addon.json',
  'examples/packs/buildings/addon.json',
  'examples/packs/palette/addon.json',
  'examples/packs/scenario/addon.json',
];

async function readPacks() {
  return Promise.all(packs.map(async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url)))));
}

test('all four example packs validate against the v1 schema', async () => {
  for (const manifest of await readPacks()) {
    const result = validateAddonManifest(manifest, { coreVersion: '1.8.0' });
    assert.equal(result.ok, true, `${manifest.id}: ${result.errors.join('; ')}`);
  }
});

test('the example set lints cleanly together', async () => {
  const result = lintAddonSet(await readPacks(), { coreVersion: '1.8.0' });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('lint rejects a scenario whose required aircraft is missing', async () => {
  const manifests = (await readPacks()).filter(manifest => !manifest.aircraft);
  const result = lintAddonSet(manifests, { coreVersion: '1.8.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => message.includes('is not pinned')));
});

test('lint rejects scripts and unsupported scenario events', async () => {
  const manifests = await readPacks();
  manifests[3].scenario.events.push({ trigger: 'on-time-elapsed', action: 'execute-script', script: 'evil.js' });
  const result = lintAddonSet(manifests, { coreVersion: '1.8.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => message.includes('scripts are forbidden')));
  assert.ok(result.errors.some(message => message.includes('action is unsupported')));
});

test('lint rejects cyclic dependencies and uses the addon ID type segment', async () => {
  const manifests = await readPacks();
  manifests[1].dependencies.push({ id: manifests[2].id, version: manifests[2].version });
  manifests[2].dependencies.push({ id: manifests[1].id, version: manifests[1].version });
  const cyclic = lintAddonSet(manifests, { coreVersion: '1.8.0' });
  assert.equal(cyclic.ok, false);
  assert.ok(cyclic.errors.some(message => message.includes('cyclic dependency')));

  const renamed = await readPacks();
  renamed[0] = { ...renamed[0], id: 'scenario/aircraft/sample-plane', publisher: 'scenario' };
  const typed = lintAddonSet([renamed[0]], { coreVersion: '1.8.0' });
  assert.equal(typed.ok, true);
});

test('lint requires scenario addons to be reachable through dependencies', async () => {
  const manifests = await readPacks();
  const scenario = manifests.find(item => item.id === 'studio/scenario/islander-coast-tour');
  scenario.dependencies = [];
  const result = lintAddonSet(manifests, { coreVersion: '1.8.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => message.includes('is not reachable')));
});
