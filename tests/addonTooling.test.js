import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADDON_KINDS, buildAddonStarter } from '../src/addons/addonStarter.js';
import { validateAddonManifest, validateCatalog } from '../src/addons/addonContract.js';
import { lintAddonSet } from '../src/addons/lintAddonSet.js';
import { profileShareParams } from '../src/addons/regionPackBinding.js';
import { buildCatalog } from '../scripts/addon-tooling.mjs';
import { listAddons, buildAddonProfileUrl, resolveSharedAddonPack, resolveCatalogUrl } from '../src/addons/addonCatalogBrowser.js';
import { AddonPicker } from '../src/ui/AddonPicker.js';
import {
  SAVED_ADDON_PROFILE_KEY, clearSavedAddonProfile, loadSavedAddonProfile,
  hasExplicitAddonParams, mergeSelectedAddons, removeSavedAddonPin,
  resolveAddonSearch, saveSelectedAddons,
  SAVED_ADDON_CATALOG_KEY, loadSavedAddonCatalogUrl, saveAddonCatalogUrl,
} from '../src/addons/savedAddonProfile.js';
import { installAddonPicker } from '../src/ui/installAddonPicker.js';

function createFakeElement(tagName) {
  const listeners = new Map();
  const el = {
    tagName: tagName.toUpperCase(),
    className: '',
    type: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    textContent: '',
    dataset: {},
    children: [],
    _innerHTML: '',
    set innerHTML(html) { this._innerHTML = html; },
    get innerHTML() { return this._innerHTML; },
    attributes: new Map(),
    _href: '',
    set href(value) { this._href = String(value); this.attributes.set('href', String(value)); },
    get href() { return this._href; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'href') this._href = String(value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    removeAttribute(name) { this.attributes.delete(name); if (name === 'href') this._href = ''; },
    appendChild(child) {
      el.children.push(child);
      if (child.className) (el._childrenBySelector ??= {})[`.${child.className.split(' ').join('.')}`] = [child];
      return child;
    },
    append(...nodes) {
      for (const child of nodes) {
        el.children.push(child);
        if (child.className) (el._childrenBySelector ??= {})[`.${child.className.split(' ').join('.')}`] = [child];
      }
    },
    replaceChildren(...nodes) { el.children = [...nodes]; el._childrenBySelector = {}; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ target: el, ...event });
    },
    querySelector(selector) {
      return el._slots?.[selector] ?? el._childrenBySelector?.[selector]?.[0] ?? null;
    },
    querySelectorAll(selector) {
      return el._slotLists?.[selector] ?? [];
    },
  };
  return el;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function withFakeDocument(fn) {
  const prevDocument = globalThis.document;
  const slots = {
    '.addon-catalog-url': createFakeElement('input'),
    '.addon-catalog-load': createFakeElement('button'),
    '.addon-catalog-clear': createFakeElement('button'),
    '.addon-picker-filters': createFakeElement('div'),
    '.addon-search': createFakeElement('input'),
    '.addon-list': createFakeElement('div'),
    '.addon-picker-status': createFakeElement('p'),
    '.addon-apply': createFakeElement('button'),
    '.addon-remove': createFakeElement('button'),
    '.addon-share': createFakeElement('button'),
    '.addon-share-actions': createFakeElement('div'),
    '.addon-share-link': createFakeElement('a'),
    '.addon-share-copy': createFakeElement('button'),
  };
  const kindButtons = ['all', 'region', 'aircraft', 'scenario'].map(kind => {
    const btn = createFakeElement('button');
    btn.dataset.kind = kind;
    return btn;
  });
  globalThis.document = {
    getElementById: () => null,
    createElement(tag) {
      const node = createFakeElement(tag);
      if (tag === 'section') {
        node._slots = slots;
        node._slotLists = { '.addon-kind': kindButtons };
      }
      return node;
    },
  };
  return Promise.resolve().then(() => fn({ parent: createFakeElement('div'), slots }))
    .finally(() => { globalThis.document = prevDocument; });
}

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

test('scaffolding produces valid manifests and catalogs for every addon kind and core version', () => {
  for (const kind of ADDON_KINDS) {
    for (const coreVersion of ['1.8.0', '2.0.0']) {
      const result = buildAddonStarter({
        publisher: 'demo', name: `sample-${kind}`, kind,
        version: '1.0.0', coreVersion, title: `Sample ${kind}`,
      });
      assert.equal(result.ok, true, `${kind}@${coreVersion}: ${result.errors.join('; ')}`);
      const manifestCheck = validateAddonManifest(result.files['addon.json'], { coreVersion });
      assert.equal(manifestCheck.ok, true, `${kind}@${coreVersion} manifest invalid: ${manifestCheck.errors.join('; ')}`);
      const lintCheck = lintAddonSet([result.files['addon.json']], { coreVersion });
      assert.equal(lintCheck.ok, true, `${kind}@${coreVersion} lint failed: ${lintCheck.errors.join('; ')}`);
      const catalogCheck = validateCatalog(result.files['catalog.json']);
      assert.equal(catalogCheck.ok, true, `${kind}@${coreVersion} catalog invalid: ${catalogCheck.errors.join('; ')}`);
      assert.match(result.files['README.md'], /scripts\/addon-dev\.mjs catalog/);
      assert.doesNotMatch(result.files['README.md'], /scripts\/addon-contract\.mjs catalog/);
      assert.match(result.files['.github/workflows/validate-addon.yml'], /repository: stlim0727\/flight3d/);
      const usesLines = result.files['.github/workflows/validate-addon.yml']
        .split('\n')
        .map(line => line.match(/uses:\s*([^\s#]+)/)?.[1])
        .filter(Boolean);
      assert.ok(usesLines.length > 0);
      for (const ref of usesLines) {
        assert.match(ref, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `unpinned workflow action: ${ref}`);
      }
    }
  }
});

test('AddonPicker clears selection and stale share output on reload or failure and avoids innerHTML injection', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  const catalogA = {
    schemaVersion: 1,
    addons: [{ id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) }],
  };
  const catalogB = {
    schemaVersion: 1,
    addons: [{ id: 'demo/aircraft/jet', version: '2.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) }],
  };
  const responses = new Map([
    ['https://packs.example/a.json', { ok: true, json: async () => catalogA }],
    ['https://packs.example/b.json', { ok: true, json: async () => catalogB }],
    ['https://packs.example/bad.json', { ok: false, status: 404 }],
  ]);

  await withFakeDocument(async ({ parent, slots }) => {
    const trickyUrl = 'https://packs.example/a.json" data-injected="1';
    const picker = new AddonPicker({
      catalogUrl: trickyUrl,
      profileShareParams,
      validateCatalog,
      fetchImpl: async url => responses.get(url) ?? { ok: false, status: 404 },
    });
    const root = picker.mount(parent);
    assert.doesNotMatch(root.innerHTML, /data-injected/);
    assert.equal(slots['.addon-catalog-url'].value, trickyUrl);

    await picker.load('https://packs.example/a.json');
    picker.selected.add('demo/region/sky');
    const shared = picker.share();
    assert.match(shared, /pack=demo%2Fregion%2Fsky/);
    assert.equal(slots['.addon-share-actions'].hidden, false);
    assert.equal(slots['.addon-share-link'].getAttribute('href'), shared);

    await picker.load('https://packs.example/b.json');
    assert.equal(picker.selected.size, 0);
    assert.equal(slots['.addon-share'].hidden, true);
    assert.equal(slots['.addon-share-actions'].hidden, true);
    assert.equal(slots['.addon-share-link'].getAttribute('href'), null);
    assert.equal(slots['.addon-share-link'].textContent, '');
    assert.equal(picker.share(), '');

    picker.selected.add('demo/aircraft/jet');
    picker.share();
    await picker.load('https://packs.example/bad.json');
    assert.equal(picker.selected.size, 0);
    assert.equal(slots['.addon-share'].hidden, true);
    assert.equal(slots['.addon-share-actions'].hidden, true);
    assert.equal(slots['.addon-share-link'].getAttribute('href'), null);
    assert.equal(slots['.addon-share-link'].textContent, '');
  });
});

test('AddonPicker clear button removes the URL and saved addons', async () => {
  const catalog = {
    schemaVersion: 1,
    addons: [{ id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) }],
  };
  await withFakeDocument(async ({ parent, slots }) => {
    const storage = memoryStorage();
    saveSelectedAddons(catalog, ['demo/region/sky'], { storage });
    const picker = new AddonPicker({
      catalogUrl: 'https://packs.example/wrong-long-url.json',
      profileShareParams,
      validateCatalog,
      storage,
      fetchImpl: async () => ({ ok: true, json: async () => catalog }),
    });
    picker.mount(parent);
    await picker.load('https://packs.example/a.json');
    assert.equal(loadSavedAddonProfile(storage)?.pins.length, 1);

    slots['.addon-catalog-clear'].dispatch('click');
    assert.equal(slots['.addon-catalog-url'].value, '');
    assert.equal(picker.catalog, null);
    assert.equal(picker.selected.size, 0);
    assert.equal(slots['.addon-picker-filters'].hidden, true);
    assert.equal(slots['.addon-share'].hidden, true);
    assert.equal(loadSavedAddonProfile(storage), null);
    assert.equal(storage.getItem(SAVED_ADDON_PROFILE_KEY), null);
    assert.equal(slots['.addon-picker-status'].textContent, picker.labels.urlCleared);
  });
});

test('installAddonPicker fetches an initial catalogUrl only once', async () => {
  let fetchCount = 0;
  const catalog = {
    schemaVersion: 1,
    addons: [{ id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) }],
  };
  await withFakeDocument(async ({ parent }) => {
    installAddonPicker(parent, {
      catalogUrl: 'https://packs.example/catalog.json',
      fetchImpl: async () => {
        fetchCount += 1;
        return { ok: true, json: async () => catalog };
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fetchCount, 1);
  });
});

test('installAddonPicker surfaces a saved-addon startup failure in its status', async () => {
  const previous = globalThis.window?.addonStartupError;
  globalThis.window ??= {};
  globalThis.window.addonStartupError = 'checksum mismatch for demo/aircraft/skyhawk@1.0.0';
  try {
    await withFakeDocument(async ({ parent }) => {
      const picker = installAddonPicker(parent);
      assert.match(picker.status.textContent, /checksum mismatch/);
      assert.equal(picker.status.dataset.addonStartupError,
        'checksum mismatch for demo/aircraft/skyhawk@1.0.0');
    });
  } finally {
    if (previous === undefined) delete globalThis.window.addonStartupError;
    else globalThis.window.addonStartupError = previous;
  }
});

test('installAddonPicker opens and closes the separate detail dialog', async () => {
  await withFakeDocument(async ({ parent }) => {
    const dialog = createFakeElement('dialog');
    dialog.open = false;
    let shown = 0;
    let closed = 0;
    dialog.showModal = () => { dialog.open = true; shown += 1; };
    dialog.close = () => { dialog.open = false; closed += 1; };
    const openButton = createFakeElement('button');
    const closeButton = createFakeElement('button');
    const picker = installAddonPicker(parent, { dialog, openButton, closeButton });

    openButton.dispatch('click');
    assert.equal(dialog.open, true);
    assert.equal(shown, 1);
    closeButton.dispatch('click');
    assert.equal(dialog.open, false);
    assert.equal(closed, 1);

    picker.open();
    dialog.dispatch('click', { target: dialog });
    assert.equal(dialog.open, false);
    assert.equal(closed, 2);
  });
});

test('share URL round-trips through resolveSharedAddonPack for profile and legacy addonManifest links', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  globalThis.atob ??= b64 => Buffer.from(b64, 'base64').toString('binary');
  const regionManifest = buildAddonStarter({
    publisher: 'demo', name: 'sky', kind: 'region',
    version: '1.0.0', coreVersion: '1.8.0', title: 'Sky',
  }).files['addon.json'];
  const aircraftManifest = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft',
    version: '2.0.0', coreVersion: '1.8.0', title: 'Jet',
  }).files['addon.json'];

  const regionBytes = Buffer.from(JSON.stringify(regionManifest), 'utf8');
  const regionSha = createHash('sha256').update(regionBytes).digest('hex');
  const aircraftBytes = Buffer.from(JSON.stringify(aircraftManifest), 'utf8');
  const aircraftSha = createHash('sha256').update(aircraftBytes).digest('hex');

  const catalog = {
    schemaVersion: 1,
    addons: [
      { id: regionManifest.id, version: regionManifest.version, url: 'https://packs.example/sky.json', sha256: regionSha },
      { id: aircraftManifest.id, version: aircraftManifest.version, url: 'https://packs.example/jet.json', sha256: aircraftSha },
    ],
  };

  const fetchImpl = async url => {
    if (url === 'https://packs.example/sky.json') return { ok: true, arrayBuffer: async () => regionBytes };
    if (url === 'https://packs.example/jet.json') return { ok: true, arrayBuffer: async () => aircraftBytes };
    return { ok: false, status: 404 };
  };

  const shareUrl = buildAddonProfileUrl(catalog, [regionManifest.id], {
    baseUrl: 'https://flight.example/?',
    coreVersion: '1.8.0',
  });
  const boundPack = await resolveSharedAddonPack(new URL(shareUrl).search, { fetchImpl });
  assert.equal(boundPack.id, 'demo/region/sky');
  assert.equal(boundPack.version, '1.0.0');
  assert.equal(boundPack.sha256, regionSha);
  assert.match(boundPack.urlTemplate, /https:\/\/packs\.example\/demo\/sky\/1\.0\.0\/\{z\}\/\{y\}\/\{x\}\.png/);

  const aircraftUrl = buildAddonProfileUrl(catalog, [aircraftManifest.id], {
    baseUrl: 'https://flight.example/?',
    coreVersion: '1.8.0',
  });
  const boundAircraft = await resolveSharedAddonPack(new URL(aircraftUrl).search, { fetchImpl });
  assert.equal(boundAircraft.id, 'demo/aircraft/jet');
  assert.equal(boundAircraft.profile.pins.length, 1);

  await assert.rejects(
    resolveSharedAddonPack(new URL(shareUrl).search, {
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('{}') }),
    }),
    /checksum mismatch/,
  );

  const encodedLegacy = regionBytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const legacyPack = await resolveSharedAddonPack(
    `?addonManifest=${encodedLegacy}&addonSha256=${regionSha}`,
    { coreVersion: '1.8.0' },
  );
  assert.equal(legacyPack.id, 'demo/region/sky');
  assert.equal(await resolveSharedAddonPack(''), null);
});


test('owner/repo catalog shorthand resolves without altering raw picker input', async () => {
  assert.equal(resolveCatalogUrl('owner/repo'), 'https://raw.githubusercontent.com/owner/repo/main/catalog.json');
  await withFakeDocument(async ({ parent, slots }) => {
    const requested = [];
    const catalog = { schemaVersion: 1, addons: [] };
    const picker = new AddonPicker({
      fetchImpl: async url => { requested.push(url); return { ok: true, json: async () => catalog }; },
      validateCatalog,
    });
    picker.mount(parent);
    slots['.addon-catalog-url'].value = 'owner/repo';
    slots['.addon-catalog-load'].dispatch('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(slots['.addon-catalog-url'].value, 'owner/repo');
    assert.deepEqual(requested, ['https://raw.githubusercontent.com/owner/repo/main/catalog.json']);
    assert.equal(picker.catalogUrl, 'https://raw.githubusercontent.com/owner/repo/main/catalog.json');
  });
});

test('saved addon profile applies selected pins to a plain URL and loads again', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  globalThis.atob ??= b64 => Buffer.from(b64, 'base64').toString('binary');
  const regionManifest = buildAddonStarter({
    publisher: 'demo', name: 'sky', kind: 'region',
    version: '1.0.0', coreVersion: '1.8.0', title: 'Sky',
  }).files['addon.json'];
  const aircraftManifest = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft',
    version: '1.0.0', coreVersion: '1.8.0', title: 'Jet',
  }).files['addon.json'];
  const bytes = new Map([
    ['https://packs.example/sky.json', Buffer.from(JSON.stringify(regionManifest), 'utf8')],
    ['https://packs.example/jet.json', Buffer.from(JSON.stringify(aircraftManifest), 'utf8')],
  ]);
  const catalog = { schemaVersion: 1, addons: [
    { id: regionManifest.id, version: regionManifest.version, url: 'https://packs.example/sky.json', sha256: createHash('sha256').update(bytes.get('https://packs.example/sky.json')).digest('hex') },
    { id: aircraftManifest.id, version: aircraftManifest.version, url: 'https://packs.example/jet.json', sha256: createHash('sha256').update(bytes.get('https://packs.example/jet.json')).digest('hex') },
  ] };
  const storage = memoryStorage();
  saveSelectedAddons(catalog, [regionManifest.id, aircraftManifest.id], { coreVersion: '1.8.0', storage });
  assert.equal(loadSavedAddonProfile(storage).pins.length, 2);

  const search = resolveAddonSearch('?quality=high', { storage });
  assert.equal(new URLSearchParams(search).get('quality'), 'high');
  assert.equal(new URLSearchParams(search).get('pack'), regionManifest.id);
  const bound = await resolveSharedAddonPack(search, {
    coreVersion: '1.8.0',
    fetchImpl: async url => ({ ok: bytes.has(url), arrayBuffer: async () => bytes.get(url) }),
  });
  assert.equal(bound.id, regionManifest.id);
  assert.equal(bound.version, regionManifest.version);
  assert.match(bound.urlTemplate, /https:\/\/packs\.example/);

  clearSavedAddonProfile(storage);
  assert.equal(storage.getItem(SAVED_ADDON_PROFILE_KEY), null);
  assert.equal(resolveAddonSearch('?quality=high', { storage }), '?quality=high');
  assert.equal(resolveAddonSearch('?pack=other%2Fregion%2Ftown', { storage }), '?pack=other%2Fregion%2Ftown');
  assert.equal(hasExplicitAddonParams('?pack=other%2Fregion%2Ftown'), true);
  assert.equal(hasExplicitAddonParams('?airport=jeju'), false);
});

test('saveSelectedAddons rejects unavailable storage and empty selection', () => {
  const catalog = { schemaVersion: 1, addons: [
    { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
  ] };
  assert.throws(() => saveSelectedAddons(catalog, ['demo/region/sky'], { storage: null }), /local storage unavailable/);
  assert.throws(() => saveSelectedAddons(catalog, [], { storage: memoryStorage() }), /select at least one addon/);
});

test('saved addon profile ignores corrupt and unreadable storage', () => {
  const corrupt = memoryStorage();
  corrupt.setItem(SAVED_ADDON_PROFILE_KEY, '{not json');
  assert.equal(loadSavedAddonProfile(corrupt), null);
  assert.equal(resolveAddonSearch('', { storage: corrupt }), '');

  const unreadable = {
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); },
    removeItem() { throw new Error('storage blocked'); },
  };
  assert.equal(loadSavedAddonProfile(unreadable), null);
  assert.equal(resolveAddonSearch('?airport=jeju', { storage: unreadable }), '?airport=jeju');
  assert.doesNotThrow(() => clearSavedAddonProfile(unreadable));
});

test('AddonPicker saves, restores, and removes the default-flight addons', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  globalThis.atob ??= b64 => Buffer.from(b64, 'base64').toString('binary');
  const catalog = { schemaVersion: 1, addons: [
    { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
    { id: 'demo/aircraft/jet', version: '1.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) },
  ] };
  const storage = memoryStorage();
  await withFakeDocument(async ({ parent, slots }) => {
    const picker = new AddonPicker({
      fetchImpl: async () => ({ ok: true, json: async () => catalog }),
      validateCatalog,
      storage,
    });
    picker.mount(parent);
    assert.equal(slots['.addon-remove'].hidden, true);
    await picker.load('https://packs.example/catalog.json');
    assert.equal(slots['.addon-apply'].hidden, true);
    assert.equal(slots['.addon-remove'].hidden, true);

    picker.selected.add('demo/region/sky');
    picker.selected.add('demo/aircraft/jet');
    picker.render();
    assert.equal(slots['.addon-apply'].hidden, false);
    assert.equal(picker.apply(), true);
    assert.match(slots['.addon-picker-status'].textContent, /기본 주소/);
    assert.equal(slots['.addon-remove'].hidden, false);

    const reopened = new AddonPicker({
      fetchImpl: async () => ({ ok: true, json: async () => catalog }),
      validateCatalog,
      storage,
    });
    reopened.mount(parent);
    await reopened.load('https://packs.example/catalog.json');
    assert.deepEqual([...reopened.selected], ['demo/region/sky', 'demo/aircraft/jet']);
    assert.equal(reopened.remove(), true);
    assert.equal(loadSavedAddonProfile(storage), null);
    assert.equal(reopened.removeBtn.hidden, true);

    saveSelectedAddons(catalog, ['demo/region/sky'], { storage });
    const offline = new AddonPicker({
      fetchImpl: async () => ({ ok: false, status: 503 }),
      validateCatalog,
      storage,
    });
    offline.mount(parent);
    assert.equal(offline.removeBtn.hidden, false);
    await offline.load('https://packs.example/unavailable.json');
    assert.equal(offline.removeBtn.hidden, false);
    assert.equal(offline.remove(), true);
    assert.equal(offline.removeBtn.hidden, true);
  });
});

test('incompatible saved pins are not restored into the picker', async () => {
  const catalog = { schemaVersion: 1, addons: [
    { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64), compatible: false },
  ] };
  const storage = memoryStorage();
  saveSelectedAddons(catalog, ['demo/region/sky'], { storage });
  await withFakeDocument(async ({ parent }) => {
    const picker = new AddonPicker({
      fetchImpl: async () => ({ ok: true, json: async () => catalog }),
      validateCatalog,
      storage,
    });
    picker.mount(parent);
    await picker.load('https://packs.example/catalog.json');
    assert.equal(picker.selected.size, 0);
  });
});

test('GitHub repository URL resolves to the catalog raw URL', () => {
  const raw = 'https://raw.githubusercontent.com/stlim0727/flight3d-skyhawk-addon/main/catalog.json';
  assert.equal(
    resolveCatalogUrl('https://github.com/stlim0727/flight3d-skyhawk-addon'),
    raw,
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/stlim0727/flight3d-skyhawk-addon/'),
    raw,
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/stlim0727/flight3d-skyhawk-addon/tree/main'),
    raw,
  );
  assert.equal(
    resolveCatalogUrl('https://raw.githubusercontent.com/owner/repo/main/catalog.json'),
    'https://raw.githubusercontent.com/owner/repo/main/catalog.json',
  );
});

test('GitHub branch and blob URLs preserve slash-separated refs', () => {
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo/tree/feat/addons'),
    'https://raw.githubusercontent.com/owner/repo/feat/addons/catalog.json',
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo/blob/feat/addons/catalog.json'),
    'https://raw.githubusercontent.com/owner/repo/feat/addons/catalog.json',
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo/blob/main/docs/catalog.json'),
    'https://raw.githubusercontent.com/owner/repo/main/docs/catalog.json',
  );
});

test('removing one saved addon keeps the remaining pin and selection', async () => {
  const catalog = { schemaVersion: 1, addons: [
    { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
    { id: 'demo/aircraft/jet', version: '2.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) },
  ] };
  const storage = memoryStorage();
  saveSelectedAddons(catalog, ['demo/region/sky', 'demo/aircraft/jet'], { coreVersion: '1.8.0', storage });
  await withFakeDocument(async ({ parent, slots }) => {
    slots['.addon-saved-list'] = createFakeElement('div');
    slots['.addon-saved-remove'] = createFakeElement('button');
    let fetchCount = 0;
    const picker = new AddonPicker({
      fetchImpl: async () => {
        fetchCount += 1;
        return { ok: true, json: async () => catalog };
      },
      validateCatalog,
      storage,
    });
    picker.mount(parent);
    await picker.load('https://packs.example/catalog.json');
    assert.deepEqual([...picker.selected], ['demo/region/sky', 'demo/aircraft/jet']);
    assert.equal(slots['.addon-saved-list'].children.length, 2);

    const firstRemove = slots['.addon-saved-list'].children[0].children[1];
    firstRemove.dispatch('click');
    const saved = loadSavedAddonProfile(storage);
    assert.equal(saved?.coreVersion, '1.8.0');
    assert.deepEqual(saved?.pins, [{
      id: 'demo/aircraft/jet', version: '2.0.0',
      url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64),
    }]);
    assert.deepEqual([...picker.selected], ['demo/aircraft/jet']);
    assert.equal(slots['.addon-saved-list'].children.length, 1);
    assert.equal(slots['.addon-remove'].hidden, false);
    assert.equal(fetchCount, 1);
  });
});

test('saved catalog URL restores selected addons in the picker after reload', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  globalThis.atob ??= b64 => Buffer.from(b64, 'base64').toString('binary');
  const catalog = { schemaVersion: 1, addons: [
    { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
  ] };
  const otherCatalog = { schemaVersion: 1, addons: [
    { id: 'demo/aircraft/jet', version: '1.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) },
  ] };
  const catalogUrl = 'https://packs.example/catalog.json';
  const otherCatalogUrl = 'https://other.example/catalog.json';
  const fetchImpl = async url => {
    if (url === catalogUrl) return { ok: true, json: async () => catalog };
    if (url === otherCatalogUrl) return { ok: true, json: async () => otherCatalog };
    return { ok: false, status: 404 };
  };
  const storage = memoryStorage();

  await withFakeDocument(async ({ parent }) => {
    const initial = installAddonPicker(parent, { storage, fetchImpl });
    await initial.load(catalogUrl);
    assert.equal(loadSavedAddonCatalogUrl(storage), null);
    initial.selected.add('demo/region/sky');
    assert.equal(initial.apply(), true);
    assert.equal(loadSavedAddonCatalogUrl(storage), catalogUrl);

    // Previewing another catalog without applying must not overwrite the saved catalog URL.
    await initial.load(otherCatalogUrl);
    assert.equal(loadSavedAddonCatalogUrl(storage), catalogUrl);
  });

  await withFakeDocument(async ({ parent, slots }) => {
    const reloaded = installAddonPicker(parent, { storage, fetchImpl });
    assert.equal(slots['.addon-catalog-url'].value, catalogUrl);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual([...reloaded.selected], ['demo/region/sky']);
    assert.equal(slots['.addon-apply'].hidden, false);
    assert.equal(slots['.addon-share'].hidden, false);
    assert.equal(slots['.addon-remove'].hidden, false);

    slots['.addon-catalog-clear'].dispatch('click');
    assert.equal(storage.getItem(SAVED_ADDON_PROFILE_KEY), null);
    assert.equal(storage.getItem(SAVED_ADDON_CATALOG_KEY), null);
  });

  storage.setItem(SAVED_ADDON_CATALOG_KEY, 'javascript:alert(1)');
  assert.equal(loadSavedAddonCatalogUrl(storage), null);

  const blocked = {
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); },
    removeItem() { throw new Error('storage blocked'); },
  };
  assert.equal(loadSavedAddonCatalogUrl(blocked), null);
  assert.doesNotThrow(() => saveAddonCatalogUrl(catalogUrl, { storage: blocked }));
  assert.doesNotThrow(() => saveAddonCatalogUrl('', { storage: blocked }));
});

test('AddonPicker.removePin uses globalThis.localStorage when storage option is omitted', async () => {
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const ls = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: ls });
  try {
    const catalog = {
      schemaVersion: 1,
      addons: [
        { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
        { id: 'demo/aircraft/jet', version: '2.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) },
      ],
    };
    saveSelectedAddons(catalog, ['demo/region/sky', 'demo/aircraft/jet'], { coreVersion: '1.8.0' });
    await withFakeDocument(async ({ parent, slots }) => {
      slots['.addon-saved-list'] = createFakeElement('div');
      const picker = installAddonPicker(parent, {
        fetchImpl: async () => ({ ok: true, json: async () => catalog }),
      });
      await picker.load('https://packs.example/catalog.json');
      assert.equal(slots['.addon-saved-list'].children.length, 2);

      const firstRemove = slots['.addon-saved-list'].children[0].children[1];
      firstRemove.dispatch('click');
      assert.deepEqual(loadSavedAddonProfile()?.pins.map(pin => pin.id), ['demo/aircraft/jet']);
      assert.deepEqual([...picker.selected], ['demo/aircraft/jet']);

      assert.equal(picker.removePin('demo/aircraft/jet', '2.0.0'), true);
      assert.equal(loadSavedAddonProfile(), null);
      assert.equal(picker.selected.size, 0);
      assert.equal(slots['.addon-remove'].hidden, true);
    });

    saveSelectedAddons(catalog, ['demo/region/sky', 'demo/aircraft/jet']);
    const remaining = removeSavedAddonPin('demo/region/sky', '1.0.0');
    assert.deepEqual(remaining.map(pin => pin.id), ['demo/aircraft/jet']);
    assert.equal(removeSavedAddonPin('demo/aircraft/jet', '2.0.0'), null);
    assert.equal(loadSavedAddonProfile(), null);
  } finally {
    if (prevDesc) Object.defineProperty(globalThis, 'localStorage', prevDesc);
    else delete globalThis.localStorage;
  }
});

test('AddonPicker ignores stale load responses after clearUrl or a newer load', async () => {
  const catalogA = {
    schemaVersion: 1,
    addons: [{ id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) }],
  };
  const catalogB = {
    schemaVersion: 1,
    addons: [{ id: 'demo/aircraft/jet', version: '2.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) }],
  };
  const deferred = new Map();
  const fetchImpl = url => new Promise((resolve, reject) => deferred.set(url, { resolve, reject }));

  await withFakeDocument(async ({ parent, slots }) => {
    const picker = new AddonPicker({ fetchImpl, validateCatalog, storage: memoryStorage() });
    picker.mount(parent);

    const pendingCleared = picker.load('https://packs.example/slow-clear.json');
    picker.clearUrl();
    deferred.get('https://packs.example/slow-clear.json').resolve({ ok: true, json: async () => catalogA });
    await pendingCleared;
    assert.equal(picker.catalog, null);
    assert.equal(picker.selected.size, 0);
    assert.equal(slots['.addon-picker-filters'].hidden, true);
    assert.equal(slots['.addon-picker-status'].textContent, picker.labels.urlCleared);

    const slowLoad = picker.load('https://packs.example/slow.json');
    const fastLoad = picker.load('https://packs.example/fast.json');
    deferred.get('https://packs.example/fast.json').resolve({ ok: true, json: async () => catalogB });
    await fastLoad;
    deferred.get('https://packs.example/slow.json').reject(new Error('network timeout'));
    await slowLoad;
    assert.equal(picker.catalog, catalogB);
    assert.equal(picker.catalogUrl, 'https://packs.example/fast.json');
    assert.equal(slots['.addon-picker-filters'].hidden, false);
    assert.equal(slots['.addon-picker-status'].textContent, '');
  });
});

test('AddonPicker.apply keeps saved pins from another catalog while updating current catalog pins', async () => {
  const catalogA = {
    schemaVersion: 1,
    addons: [
      { id: 'demo/region/sky', version: '1.0.0', url: 'https://packs.example/sky.json', sha256: 'a'.repeat(64) },
      { id: 'demo/region/bay', version: '1.0.0', url: 'https://packs.example/bay.json', sha256: 'c'.repeat(64) },
    ],
  };
  const catalogB = {
    schemaVersion: 1,
    addons: [
      { id: 'demo/aircraft/jet', version: '2.0.0', url: 'https://packs.example/jet.json', sha256: 'b'.repeat(64) },
    ],
  };
  const urlA = 'https://packs.example/a/catalog.json';
  const urlB = 'https://packs.example/b/catalog.json';
  const storage = memoryStorage();
  const fetchImpl = async url => {
    if (url === urlA) return { ok: true, json: async () => catalogA };
    if (url === urlB) return { ok: true, json: async () => catalogB };
    return { ok: false, status: 404 };
  };

  await withFakeDocument(async ({ parent, slots }) => {
    slots['.addon-saved-list'] = createFakeElement('div');
    const picker = new AddonPicker({ fetchImpl, validateCatalog, storage, coreVersion: '1.8.0' });
    picker.mount(parent);

    await picker.load(urlA);
    picker.selected.add('demo/region/sky');
    picker.selected.add('demo/region/bay');
    assert.equal(picker.apply(), true);

    await picker.load(urlB);
    picker.selected.add('demo/aircraft/jet');
    assert.equal(picker.apply(), true);
    assert.deepEqual(
      loadSavedAddonProfile(storage)?.pins.map(pin => pin.id).sort(),
      ['demo/aircraft/jet', 'demo/region/bay', 'demo/region/sky'],
    );
    assert.equal(slots['.addon-saved-list'].children.length, 3);

    await picker.load(urlA);
    picker.selected.delete('demo/region/bay');
    assert.equal(picker.apply(), true);
    assert.deepEqual(
      loadSavedAddonProfile(storage)?.pins.map(pin => pin.id).sort(),
      ['demo/aircraft/jet', 'demo/region/sky'],
    );
  });

  const merged = mergeSelectedAddons(catalogB, ['demo/aircraft/jet'], { storage });
  assert.deepEqual(merged.pins.map(pin => pin.id).sort(), ['demo/aircraft/jet', 'demo/region/sky']);
});

test('resolveSharedAddonPack preserves region and aircraft pins together and supports aircraft and scenario addonManifest links', async () => {
  globalThis.btoa ??= binary => Buffer.from(binary, 'binary').toString('base64');
  globalThis.atob ??= b64 => Buffer.from(b64, 'base64').toString('binary');
  const regionManifest = buildAddonStarter({
    publisher: 'demo', name: 'sky', kind: 'region',
    version: '1.0.0', coreVersion: '1.8.0', title: 'Sky',
  }).files['addon.json'];
  const aircraftManifest = buildAddonStarter({
    publisher: 'demo', name: 'jet', kind: 'aircraft',
    version: '2.0.0', coreVersion: '1.8.0', title: 'Jet',
  }).files['addon.json'];
  const scenarioManifest = buildAddonStarter({
    publisher: 'demo', name: 'tour', kind: 'scenario',
    version: '1.1.0', coreVersion: '1.8.0', title: 'Tour',
  }).files['addon.json'];

  const regionBytes = Buffer.from(JSON.stringify(regionManifest), 'utf8');
  const regionSha = createHash('sha256').update(regionBytes).digest('hex');
  const aircraftBytes = Buffer.from(JSON.stringify(aircraftManifest), 'utf8');
  const aircraftSha = createHash('sha256').update(aircraftBytes).digest('hex');
  const scenarioBytes = Buffer.from(JSON.stringify(scenarioManifest), 'utf8');
  const scenarioSha = createHash('sha256').update(scenarioBytes).digest('hex');

  const catalog = {
    schemaVersion: 1,
    addons: [
      { id: regionManifest.id, version: regionManifest.version, url: 'https://packs.example/sky.json', sha256: regionSha },
      { id: aircraftManifest.id, version: aircraftManifest.version, url: 'https://packs.example/jet.json', sha256: aircraftSha },
    ],
  };
  const fetchImpl = async url => {
    if (url === 'https://packs.example/sky.json') return { ok: true, arrayBuffer: async () => regionBytes };
    if (url === 'https://packs.example/jet.json') return { ok: true, arrayBuffer: async () => aircraftBytes };
    return { ok: false, status: 404 };
  };

  const combinedUrl = buildAddonProfileUrl(catalog, [regionManifest.id, aircraftManifest.id], {
    baseUrl: 'https://flight.example/?',
    coreVersion: '1.8.0',
  });
  const combined = await resolveSharedAddonPack(new URL(combinedUrl).search, { fetchImpl });
  assert.equal(combined.id, regionManifest.id);
  assert.match(combined.urlTemplate, /https:\/\/packs\.example\/demo\/sky\/1\.0\.0\/\{z\}\/\{y\}\/\{x\}\.png/);
  assert.equal(combined.profile.pins.length, 2);
  assert.equal(combined.aircraft.packId, aircraftManifest.id);
  assert.equal(combined.aircrafts.length, 1);
  assert.equal(combined.aircrafts[0].id, aircraftManifest.aircraft.id);

  const encodeManifest = bytes => bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const aircraftLegacy = await resolveSharedAddonPack(
    `?addonManifest=${encodeManifest(aircraftBytes)}&addonSha256=${aircraftSha}`,
    { coreVersion: '1.8.0' },
  );
  assert.equal(aircraftLegacy.id, aircraftManifest.id);
  assert.equal(aircraftLegacy.version, aircraftManifest.version);
  assert.equal(aircraftLegacy.sha256, aircraftSha);
  assert.equal(aircraftLegacy.aircraft.packId, aircraftManifest.id);
  assert.equal(aircraftLegacy.aircrafts.length, 1);

  const scenarioLegacy = await resolveSharedAddonPack(
    `?addonManifest=${encodeManifest(scenarioBytes)}&addonSha256=${scenarioSha}`,
    { coreVersion: '1.8.0' },
  );
  assert.equal(scenarioLegacy.id, scenarioManifest.id);
  assert.equal(scenarioLegacy.version, scenarioManifest.version);
  assert.equal(scenarioLegacy.sha256, scenarioSha);
});

test('resolveCatalogUrl handles .git suffix and leaves non-catalog GitHub paths unchanged', () => {
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo.git'),
    'https://raw.githubusercontent.com/owner/repo/main/catalog.json',
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo.git/tree/main'),
    'https://raw.githubusercontent.com/owner/repo/main/catalog.json',
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo/issues/1'),
    'https://github.com/owner/repo/issues/1',
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo/pull/2'),
    'https://github.com/owner/repo/pull/2',
  );
  assert.equal(
    resolveCatalogUrl('https://github.com/owner/repo/blob/main/addon.json'),
    'https://github.com/owner/repo/blob/main/addon.json',
  );
});
