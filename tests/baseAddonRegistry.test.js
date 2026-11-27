import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { validateAddonManifest } from '../src/addons/addonContract.js';
import { buildAddonStarter } from '../src/addons/addonStarter.js';
import { addonAircraftIds } from '../src/config/aircraftConfigs.js';
import { verifyAddonRuntime } from '../src/addons/verifyAddonRuntime.js';
import {
  BASE_ADDON_CATALOG_URL,
  buildAddonPackFromProfile,
  loadBaseAddonPrCatalog,
  loadDefaultBaseAddonCatalog,
  parseBaseAddonPrNumber,
  validatePrPreviewDocument,
} from '../src/addons/baseAddonRegistry.js';
import { resolveSharedAddonPack } from '../src/addons/addonCatalogBrowser.js';
import { hasExplicitAddonParams, SAVED_ADDON_PROFILE_KEY } from '../src/addons/savedAddonProfile.js';
import { AddonPicker } from '../src/ui/AddonPicker.js';
import { installAddonPicker } from '../src/ui/installAddonPicker.js';
import { gatherFeedbackDiagnostics } from '../src/analytics/feedbackReport.js';

const execFileAsync = promisify(execFile);

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(result => {
        this.result = result;
        this.onloadend?.();
      }, error => {
        this.error = error;
        this.onerror?.(error);
      });
    }
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildTestGlb(nodeNames = ['elevator_node']) {
  const scene = new THREE.Scene();
  for (const name of nodeNames) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.2, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xcccccc }),
    );
    mesh.name = name;
    scene.add(mesh);
  }
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise((resolveGlb, rejectGlb) => {
    exporter.parse(scene, resolveGlb, rejectGlb, { binary: true });
  });
  return new Uint8Array(arrayBuffer);
}

function createFakeElement(tag) {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    checked: false,
    value: '',
    textContent: '',
    href: '',
    attributes: new Map(),
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    setAttribute(key, value) { this.attributes.set(key, String(value)); },
    removeAttribute(key) { this.attributes.delete(key); this[key] = ''; },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    dispatch(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ target: this, currentTarget: this, ...event });
    },
    querySelector(selector) { return this._slots?.[selector] ?? null; },
    querySelectorAll(selector) { return this._slotLists?.[selector] ?? []; },
  };
}

function createPickerHarness(fn) {
  const prevDocument = globalThis.document;
  const slots = {
    '.addon-catalog-url': createFakeElement('input'),
    '.addon-catalog-load': createFakeElement('button'),
    '.addon-catalog-clear': createFakeElement('button'),
    '.addon-pr-number': createFakeElement('input'),
    '.addon-pr-load': createFakeElement('button'),
    '.addon-base-load': createFakeElement('button'),
    '.addon-picker-filters': createFakeElement('div'),
    '.addon-search': createFakeElement('input'),
    '.addon-list': createFakeElement('div'),
    '.addon-saved-list': createFakeElement('div'),
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

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('addonContract validates optional deep physics fields while remaining backwards compatible', () => {
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'glider', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  assert.equal(validateAddonManifest(starter, { coreVersion: '1.8.0' }).ok, true);

  const broken = structuredClone(starter);
  broken.aircraft.physics.massProperties = { emptyWeightKg: 900, maxTakeoffWeightKg: 600 };
  broken.aircraft.physics.aerodynamics = { oswaldEfficiency: 1.5 };
  broken.aircraft.physics.landingGear = {
    contacts: [{ id: 'only-one', localPos: { x: 0, y: -1, z: 0 }, wheelRadius: 0.2, restLength: 0.5, kSpring: 1000, cDamper: 100 }],
    bodySupportPoints: [],
  };
  const res = validateAddonManifest(broken, { coreVersion: '1.8.0' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(msg => msg.includes('emptyWeightKg must not exceed maxTakeoffWeightKg')));
  assert.ok(res.errors.some(msg => msg.includes('oswaldEfficiency must be in (0, 1]')));
  assert.ok(res.errors.some(msg => msg.includes('at least 3 gear struts')));
  assert.ok(res.errors.some(msg => msg.includes('bodySupportPoints must be a non-empty')));
});

test('verifyAddonRuntime validates headless physics, canonical bodySupportPoints, GLB assets, and unregisters cleanly', async () => {
  const beforeIds = addonAircraftIds();
  const starter = buildAddonStarter({
    publisher: 'demo', name: 'trainer', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];

  const passWithoutLocalFiles = await verifyAddonRuntime(starter, { coreVersion: '1.8.0' });
  assert.equal(passWithoutLocalFiles.ok, true, passWithoutLocalFiles.errors.join('; '));
  assert.deepEqual(addonAircraftIds(), beforeIds);

  const dir = await mkdtemp(join(tmpdir(), 'addon-runtime-'));
  try {
    const glbBytes = await buildTestGlb(['azimuth_node', 'elevator_node', 'rudder_node', 'flaps_node', 'gear_node']);
    const glbSha = sha256(glbBytes);
    await writeFile(join(dir, 'trainer.glb'), glbBytes);
    await writeFile(join(dir, 'cockpit.glb'), glbBytes);

    const localManifest = structuredClone(starter);
    localManifest.aircraft.model = { url: 'https://packs.example/demo/trainer/1.0.0/trainer.glb', sha256: glbSha };
    localManifest.aircraft.cockpit = { url: 'https://packs.example/demo/trainer/1.0.0/cockpit.glb', sha256: glbSha };
    localManifest.assets = [{ url: 'https://packs.example/demo/trainer/1.0.0/trainer.glb', sha256: glbSha }];

    const passLocal = await verifyAddonRuntime(localManifest, {
      coreVersion: '1.8.0',
      addonDir: dir,
      requireLocalAssets: true,
    });
    assert.equal(passLocal.ok, true, passLocal.errors.join('; '));
    assert.equal(passLocal.stats.checkedAssets, 2);
    assert.ok(passLocal.stats.glbModels.some(item => item.meshes >= 1 && item.triangles >= 12));

    const nonCanonical = structuredClone(localManifest);
    nonCanonical.aircraft.physics.landingGear = {
      bodySupportPoints: {
        nose: { x: 0, y: -1, z: -2 },
        mainLeft: { x: -1, y: -1, z: 0.5 },
        mainRight: { x: 1, y: -1, z: 0.5 },
      },
    };
    const strictFail = await verifyAddonRuntime(nonCanonical, { coreVersion: '1.8.0', strict: true });
    assert.equal(strictFail.ok, false);
    assert.ok(strictFail.errors.some(msg => msg.includes('non-canonical id "mainLeft"')));

    const nonStrictPass = await verifyAddonRuntime(nonCanonical, { coreVersion: '1.8.0', strict: false });
    assert.equal(nonStrictPass.ok, true, nonStrictPass.errors.join('; '));

    const missingNodeGlb = await buildTestGlb(['wrong_node']);
    await writeFile(join(dir, 'trainer.glb'), missingNodeGlb);
    const updatedSha = sha256(missingNodeGlb);
    const missingNodeManifest = structuredClone(localManifest);
    missingNodeManifest.aircraft.model.sha256 = updatedSha;
    missingNodeManifest.assets[0].sha256 = updatedSha;
    const nodeFail = await verifyAddonRuntime(missingNodeManifest, {
      coreVersion: '1.8.0',
      addonDir: dir,
    });
    assert.equal(nodeFail.ok, false);
    assert.ok(nodeFail.errors.some(msg => msg.includes('missing declared control node')));

    const budgetFail = await verifyAddonRuntime(missingNodeManifest, {
      coreVersion: '1.8.0',
      addonDir: dir,
      maxAssetBytes: 64,
    });
    assert.equal(budgetFail.ok, false);
    assert.ok(budgetFail.errors.some(msg => msg.includes('exceeds maxAssetBytes')));

    await writeFile(join(dir, 'trainer.glb'), glbBytes);
    await writeFile(join(dir, 'addon.json'), JSON.stringify(localManifest, null, 2));
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/addon-contract.mjs', 'verify-runtime', join(dir, 'addon.json'), '--core', '1.8.0', '--require-local-assets'],
      { cwd: process.cwd() },
    );
    assert.match(stdout, /^OK:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseBaseAddonPrNumber and validatePrPreviewDocument enforce CI gate and SHA pins', () => {
  assert.equal(parseBaseAddonPrNumber('42'), 42);
  assert.equal(parseBaseAddonPrNumber('#42'), 42);
  assert.equal(parseBaseAddonPrNumber('pr-42'), 42);
  assert.equal(parseBaseAddonPrNumber('https://github.com/stlim0727/flight3d-addons/pull/42/files'), 42);
  assert.equal(parseBaseAddonPrNumber('0'), null);
  assert.equal(parseBaseAddonPrNumber('-5'), null);
  assert.equal(parseBaseAddonPrNumber('abc'), null);

  const headSha = '1'.repeat(40);
  const validPreview = {
    schemaVersion: 1,
    prNumber: 42,
    headSha,
    ciPassed: true,
    checkName: 'validate-addons',
    catalog: {
      schemaVersion: 1,
      addons: [{
        id: 'demo/aircraft/glider',
        version: '1.0.0',
        url: `https://raw.githubusercontent.com/fork/flight3d-addons/${headSha}/addons/glider/addon.json`,
        sha256: 'a'.repeat(64),
      }],
    },
  };
  assert.equal(validatePrPreviewDocument(validPreview, 42).ciPassed, true);

  const ciFailed = { ...validPreview, ciPassed: false };
  assert.throws(() => validatePrPreviewDocument(ciFailed, 42), /has not passed CI check/);

  const unpinnedMain = structuredClone(validPreview);
  unpinnedMain.catalog.addons[0].url = 'https://raw.githubusercontent.com/fork/flight3d-addons/main/addons/glider/addon.json';
  assert.throws(() => validatePrPreviewDocument(unpinnedMain, 42), /SHA\/preview-pinned/);
});

test('loadBaseAddonPrCatalog gates on CI via static preview first and GitHub check-runs fallback', async () => {
  const headSha = '2'.repeat(40);
  const previewUrl = 'https://previews.example/pr-42.json';
  const manifest = buildAddonStarter({
    publisher: 'demo', name: 'glider', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const manifestSha = sha256(manifestBytes);

  // 1. Static preview fails closed when ciPassed === false (no fallback API bypass).
  let apiCalled = false;
  await assert.rejects(() => loadBaseAddonPrCatalog(42, {
    previewBaseUrl: 'https://previews.example',
    apiBaseUrl: 'https://api.example',
    fetchImpl: async url => {
      if (url === previewUrl) {
        return {
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            prNumber: 42,
            headSha,
            ciPassed: false,
            checkName: 'validate-addons',
            catalog: { schemaVersion: 1, addons: [] },
          }),
        };
      }
      apiCalled = true;
      return { ok: false, status: 500 };
    },
  }), /has not passed CI check/);
  assert.equal(apiCalled, false);

  // 2. Fallback to GitHub check-runs verifies completion + conclusion === success.
  const makeApiFetch = (status, conclusion) => async url => {
    if (url.endsWith('/pulls/42')) {
      return { ok: true, json: async () => ({ head: { sha: headSha, repo: { full_name: 'fork/flight3d-addons' } } }) };
    }
    if (url.endsWith(`/commits/${headSha}/check-runs?per_page=100`)) {
      return { ok: true, json: async () => ({ check_runs: [{ id: 10, name: 'validate-addons', status, conclusion }] }) };
    }
    if (url.endsWith('/pulls/42/files?per_page=100')) {
      return { ok: true, json: async () => [{ status: 'added', filename: 'addons/demo/aircraft/glider/addon.json' }] };
    }
    if (url === `https://raw.example/fork/flight3d-addons/${headSha}/addons/demo/aircraft/glider/addon.json`) {
      return { ok: true, arrayBuffer: async () => manifestBytes };
    }
    return { ok: false, status: 404 };
  };

  await assert.rejects(() => loadBaseAddonPrCatalog('#42', {
    previewBaseUrl: 'https://previews.example',
    apiBaseUrl: 'https://api.example',
    rawBaseUrl: 'https://raw.example',
    coreVersion: '1.8.0',
    fetchImpl: makeApiFetch('in_progress', null),
  }), /is in_progress/);

  await assert.rejects(() => loadBaseAddonPrCatalog(42, {
    previewBaseUrl: 'https://previews.example',
    apiBaseUrl: 'https://api.example',
    rawBaseUrl: 'https://raw.example',
    coreVersion: '1.8.0',
    fetchImpl: makeApiFetch('completed', 'failure'),
  }), /failed \(failure\)/);

  const apiVerified = await loadBaseAddonPrCatalog(42, {
    previewBaseUrl: 'https://previews.example',
    apiBaseUrl: 'https://api.example',
    rawBaseUrl: 'https://raw.example',
    coreVersion: '1.8.0',
    fetchImpl: makeApiFetch('completed', 'success'),
  });
  assert.equal(apiVerified.ciPassed, true);
  assert.equal(apiVerified.source, 'github-api');
  assert.equal(apiVerified.catalog.addons[0].sha256, manifestSha);
});

test('default pack prefers a published region over a demo region', () => {
  const demoRegion = buildAddonStarter({
    publisher: 'demo', name: 'kitchen', kind: 'region', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const publishedRegion = buildAddonStarter({
    publisher: 'med', name: 'island', kind: 'region', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const pack = buildAddonPackFromProfile({
    schemaVersion: 1,
    coreVersion: '1.8.0',
    pins: [demoRegion, publishedRegion].map(manifest => ({
      id: manifest.id, version: manifest.version, url: `https://packs.example/${manifest.id}.json`,
      sha256: '0'.repeat(64), manifest,
    })),
  }, { coreVersion: '1.8.0' });
  assert.equal(pack.id, publishedRegion.id);
});

test('loadDefaultBaseAddonCatalog fails open and ?addonPr resolves multi-aircraft + region packs safely', async () => {
  const missing = await loadDefaultBaseAddonCatalog({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(missing, null);

  const networkErr = await loadDefaultBaseAddonCatalog({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(networkErr, null);

  const validCatalog = { schemaVersion: 1, addons: [] };
  const okDefault = await loadDefaultBaseAddonCatalog({
    catalogUrl: BASE_ADDON_CATALOG_URL,
    fetchImpl: async url => (url === BASE_ADDON_CATALOG_URL ? { ok: true, json: async () => validCatalog } : { ok: false, status: 404 }),
  });
  assert.deepEqual(okDefault, validCatalog);

  assert.equal(hasExplicitAddonParams('?addonPr=42'), true);

  const regionManifest = buildAddonStarter({
    publisher: 'demo', name: 'coast', kind: 'region', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const planeA = buildAddonStarter({
    publisher: 'demo', name: 'planea', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const planeB = buildAddonStarter({
    publisher: 'demo', name: 'planeb', kind: 'aircraft', version: '1.0.0', coreVersion: '1.8.0',
  }).files['addon.json'];
  const bytesMap = new Map([
    ['https://stlim0727.github.io/flight3d-addons/previews/pr-42/coast.json', Buffer.from(JSON.stringify(regionManifest))],
    ['https://stlim0727.github.io/flight3d-addons/previews/pr-42/planea.json', Buffer.from(JSON.stringify(planeA))],
    ['https://stlim0727.github.io/flight3d-addons/previews/pr-42/planeb.json', Buffer.from(JSON.stringify(planeB))],
  ]);
  const headSha = '3'.repeat(40);
  const previewDoc = {
    schemaVersion: 1,
    prNumber: 42,
    headSha,
    ciPassed: true,
    checkName: 'validate-addons',
    catalog: {
      schemaVersion: 1,
      addons: [...bytesMap.entries()].map(([url, buf]) => {
        const m = JSON.parse(buf.toString('utf8'));
        return { id: m.id, version: m.version, url, sha256: sha256(buf) };
      }),
    },
  };
  const fetchImpl = async url => {
    if (url === 'https://stlim0727.github.io/flight3d-addons/previews/pr-42.json') {
      return { ok: true, json: async () => previewDoc };
    }
    if (bytesMap.has(url)) {
      return { ok: true, arrayBuffer: async () => bytesMap.get(url) };
    }
    return { ok: false, status: 404 };
  };

  const resolved = await resolveSharedAddonPack('?addonPr=42', { coreVersion: '1.8.0', fetchImpl });
  assert.equal(resolved.prNumber, 42);
  assert.equal(resolved.headSha, headSha);
  assert.equal(resolved.ciPassed, true);
  assert.equal(resolved.id, regionManifest.id);
  assert.equal(resolved.aircrafts.length, 2);
  assert.deepEqual(resolved.aircrafts.map(a => a.id), ['planea', 'planeb']);
});

test('AddonPicker supports Base default loading, PR #N CI-verified preview, and diagnostics reporting', async () => {
  const storage = memoryStorage();
  const baseCatalog = {
    schemaVersion: 1,
    addons: [{ id: 'demo/aircraft/basecraft', version: '1.0.0', url: 'https://packs.example/base.json', sha256: 'a'.repeat(64) }],
  };
  const prCatalog = {
    schemaVersion: 1,
    addons: [{ id: 'demo/aircraft/prcraft', version: '1.2.0', url: 'https://stlim0727.github.io/flight3d-addons/previews/pr-77/prcraft.json', sha256: 'b'.repeat(64) }],
  };
  const headSha = '4'.repeat(40);
  const fetchImpl = async url => {
    if (url === BASE_ADDON_CATALOG_URL) return { ok: true, json: async () => baseCatalog };
    return { ok: false, status: 404 };
  };

  await createPickerHarness(async ({ parent, slots }) => {
    const picker = installAddonPicker(parent, {
      defaultCatalogUrl: BASE_ADDON_CATALOG_URL,
      storage,
      fetchImpl,
      prLoader: async input => {
        const pr = parseBaseAddonPrNumber(input);
        if (pr === 99) throw new Error('PR #99 has not passed CI check "validate-addons"');
        return { prNumber: pr, headSha, ciPassed: true, checkName: 'validate-addons', catalog: prCatalog };
      },
    });
    assert.equal(slots['.addon-catalog-url'].value, BASE_ADDON_CATALOG_URL);
    await new Promise(resolveTick => setTimeout(resolveTick, 0));
    assert.equal(picker.catalog.addons[0].id, 'demo/aircraft/basecraft');

    slots['.addon-pr-number'].value = '#99';
    await picker.loadPr('#99');
    assert.match(slots['.addon-picker-status'].textContent, /has not passed CI check/);
    assert.equal(picker.catalog, null);

    slots['.addon-pr-number'].value = '#77';
    await picker.loadPr('#77');
    assert.equal(picker.catalog.addons[0].id, 'demo/aircraft/prcraft');
    assert.match(slots['.addon-picker-status'].textContent, /PR #77/);
    picker.selected.add('demo/aircraft/prcraft');
    assert.equal(picker.apply(), true);
    assert.match(storage.getItem(SAVED_ADDON_PROFILE_KEY), /demo\/aircraft\/prcraft/);

    await picker.loadBase();
    assert.equal(slots['.addon-catalog-url'].value, BASE_ADDON_CATALOG_URL);
    assert.equal(picker.catalog.addons[0].id, 'demo/aircraft/basecraft');
  });

  const diag = gatherFeedbackDiagnostics({
    activeAirport: 'coastal',
    currentAircraftId: 'prcraft',
    pinnedAddonPack: {
      id: 'demo/aircraft/prcraft',
      prNumber: 77,
      headSha,
      profile: { pins: [{ id: 'demo/aircraft/prcraft', version: '1.2.0' }] },
    },
    addonAircraftDescriptors: new Map([['prcraft', {}]]),
    lastRuntimeError: { message: 'NaN wing lift', aircraft: 'prcraft' },
  });
  assert.equal(diag.lastRuntimeError.message, 'NaN wing lift');
  assert.equal(diag.loadedAddons.prNumber, 77);
  assert.deepEqual(diag.loadedAddons.aircraftIds, ['prcraft']);
});
