import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve, relative } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sha256Hex, validateAddonManifest } from './addonContract.js';
import { aircraftPackFromProfile } from './aircraftPackBinding.js';
import { BODY_CONTACTS } from '../physics/groundContacts.js';
import { registerAddonAircraft, unregisterAddonAircraft } from '../config/aircraftConfigs.js';
import { createHeadlessSimulation } from '../core/HeadlessSimulation.js';
import { stepPhysics } from '../core/physicsTiming.js';
import { airportSpawnPlan } from '../config/airportSpawnPlan.js';
import { verifyAircraftPerformanceEnvelope } from './verifyAircraftEnvelope.js';

export const DEFAULT_MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_GLB_TRIANGLES = 250_000;

const CANONICAL_BODY_IDS = new Set(BODY_CONTACTS.map(point => point.id));
const SPAWN_AIRPORTS = ['RKPC', 'RKSI', 'VNLK'];
const SPAWN_SCENARIOS = ['runway', 'cruise', 'approach'];

function ensureFileReaderPolyfill() {
  if (typeof globalThis.FileReader !== 'undefined') return;
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

function isGlbMagic(bytes) {
  return bytes.byteLength >= 4
    && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}

function parseGlbBuffer(arrayBuffer) {
  ensureFileReaderPolyfill();
  const loader = new GLTFLoader();
  return new Promise((resolveGlb, rejectGlb) => {
    loader.parse(arrayBuffer, '', resolveGlb, rejectGlb);
  });
}

function collectDeclaredResources(manifest) {
  const byUrl = new Map();
  const push = (label, resource, { requiredNodeNames = [] } = {}) => {
    if (!resource?.url) return;
    const existing = byUrl.get(resource.url);
    if (existing) {
      if (existing.sha256 !== resource.sha256) {
        existing.conflictingDigest = true;
      }
      for (const name of requiredNodeNames) existing.requiredNodeNames.add(name);
      return;
    }
    byUrl.set(resource.url, {
      label,
      url: resource.url,
      sha256: resource.sha256,
      requiredNodeNames: new Set(requiredNodeNames),
      conflictingDigest: false,
    });
  };
  if (manifest.aircraft?.model) {
    const requiredNodes = new Set(Object.values(manifest.aircraft.controlBindings ?? {}));
    for (const binding of Object.values(manifest.aircraft.animation?.controls ?? {})) {
      if (binding?.node) requiredNodes.add(binding.node);
    }
    push('aircraft.model', manifest.aircraft.model, {
      requiredNodeNames: [...requiredNodes],
    });
  }
  if (manifest.aircraft?.cockpit) {
    push('aircraft.cockpit', manifest.aircraft.cockpit);
  }
  if (manifest.aircraft?.livery?.tailEmblem?.map) {
    push('aircraft.livery.tailEmblem.map', manifest.aircraft.livery.tailEmblem.map);
  }
  for (const [target, spec] of Object.entries(manifest.aircraft?.livery?.materials ?? {})) {
    if (spec?.map) push(`aircraft.livery.materials.${target}.map`, spec.map);
  }
  (manifest.region?.buildingOverrides ?? []).forEach((override, index) => {
    if (override?.model) push(`region.buildingOverrides[${index}].model`, override.model);
  });
  (manifest.assets ?? []).forEach((asset, index) => {
    push(`assets[${index}]`, asset);
  });
  return [...byUrl.values()].map(item => ({
    ...item,
    requiredNodeNames: [...item.requiredNodeNames],
  }));
}

async function resolveLocalResourcePath(addonDir, resourceUrl) {
  const root = resolve(addonDir);
  const candidates = [];
  let parsedPath = '';
  try {
    parsedPath = decodeURIComponent(new URL(resourceUrl).pathname);
  } catch {
    parsedPath = resourceUrl;
  }
  const cleanRel = parsedPath.replace(/^\/+/, '');
  if (cleanRel) {
    candidates.push(cleanRel);
    const parts = cleanRel.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index++) {
      candidates.push(parts.slice(index).join('/'));
    }
  }
  const fileName = basename(cleanRel || resourceUrl);
  if (fileName) {
    candidates.push(fileName, `assets/${fileName}`);
  }
  for (const candidate of candidates) {
    const candidatePath = resolve(root, candidate);
    const rel = relative(root, candidatePath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    try {
      const info = await stat(candidatePath);
      if (info.isFile()) return candidatePath;
    } catch {
      // Try next candidate path.
    }
  }
  return null;
}

async function inspectGlbResource(bytes, resource, { maxGlbTriangles, errors }) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let gltf;
  try {
    gltf = await parseGlbBuffer(buffer);
  } catch (error) {
    errors.push(`${resource.label}: failed to parse GLB (${error.message})`);
    return { meshes: 0, triangles: 0 };
  }
  const nodeNames = new Set();
  let meshes = 0;
  let triangles = 0;
  gltf.scene.traverse(node => {
    if (node.name) nodeNames.add(node.name);
    if (!node.isMesh) return;
    meshes += 1;
    const pos = node.geometry?.attributes?.position;
    if (!pos || pos.count === 0) {
      errors.push(`${resource.label}: mesh "${node.name || meshes}" has empty or missing position attribute`);
      return;
    }
    const indexAttr = node.geometry.index;
    triangles += indexAttr ? indexAttr.count / 3 : pos.count / 3;
    for (let i = 0; i < pos.count; i++) {
      if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
        errors.push(`${resource.label}: mesh "${node.name || meshes}" contains non-finite vertex positions`);
        break;
      }
    }
    const norm = node.geometry.attributes.normal;
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        if (!Number.isFinite(norm.getX(i)) || !Number.isFinite(norm.getY(i)) || !Number.isFinite(norm.getZ(i))) {
          errors.push(`${resource.label}: mesh "${node.name || meshes}" contains non-finite normals`);
          break;
        }
      }
    }
  });
  if (meshes === 0) errors.push(`${resource.label}: GLB contains zero meshes`);
  if (triangles > maxGlbTriangles) {
    errors.push(`${resource.label}: GLB triangle count ${Math.round(triangles)} exceeds budget ${maxGlbTriangles}`);
  }
  for (const nodeName of resource.requiredNodeNames ?? []) {
    if (!nodeNames.has(nodeName)) {
      errors.push(`${resource.label}: missing declared control node "${nodeName}" in GLB scene`);
    }
  }
  return { meshes, triangles: Math.round(triangles) };
}

function assertFiniteSimulationState(sim, stage, errors) {
  const values = [
    sim.position.x, sim.position.y, sim.position.z,
    sim.linearVelocity.x, sim.linearVelocity.y, sim.linearVelocity.z,
    sim.quaternion.x, sim.quaternion.y, sim.quaternion.z, sim.quaternion.w,
    sim.telemetry?.altitudeFt, sim.telemetry?.iasKnots, sim.telemetry?.massKg,
  ];
  if (!values.every(Number.isFinite)) {
    errors.push(`aircraft runtime ${stage} produced non-finite physics/telemetry values`);
    return false;
  }
  return true;
}

function verifyStrictBodySupportPoints(raw, errors) {
  if (raw === undefined) return;
  const ids = Array.isArray(raw)
    ? raw.map(entry => entry?.id)
    : (raw && typeof raw === 'object' ? Object.entries(raw).map(([key, entry]) => entry?.id ?? key) : []);
  if (ids.length < 3) {
    errors.push('aircraft.physics.landingGear.bodySupportPoints must declare at least 3 support points');
    return;
  }
  for (const id of ids) {
    if (!CANONICAL_BODY_IDS.has(id)) {
      errors.push(
        `aircraft.physics.landingGear.bodySupportPoints contains non-canonical id "${id}" `
        + `(expected one of ${[...CANONICAL_BODY_IDS].join(', ')})`,
      );
    }
  }
}

function verifyAircraftPhysicsRuntime(manifest, { coreVersion, strict, errors, warnings, stats }) {
  if (strict) {
    verifyStrictBodySupportPoints(manifest.aircraft.physics?.landingGear?.bodySupportPoints, errors);
  }
  const effectiveCore = coreVersion ?? manifest.coreRange?.min ?? '1.8.0';
  const profile = {
    schemaVersion: 1,
    coreVersion: effectiveCore,
    pins: [{ id: manifest.id, version: manifest.version, sha256: '0'.repeat(64), manifest }],
  };
  let descriptor;
  try {
    descriptor = aircraftPackFromProfile(profile, manifest.id, { coreVersion: effectiveCore });
  } catch (error) {
    errors.push(`failed to build aircraft descriptor: ${error.message}`);
    return;
  }
  const points = descriptor.config.landingGear?.bodySupportPoints ?? [];
  if (!Array.isArray(points) || points.length < 3 || !points.every(point => CANONICAL_BODY_IDS.has(point.id))) {
    errors.push('normalized aircraft bodySupportPoints failed canonical BODY_CONTACTS verification');
    return;
  }

  registerAddonAircraft([descriptor]);
  try {
    const noopSmoke = {
      clear() {},
      spawnTouchdownSmoke() {},
      emitWaterSprayBurst() {},
      emitWaterRipples() {},
      emitSmokeBurst() {},
    };
    const sim = createHeadlessSimulation({ aircraftId: 'B738', airportId: 'coastal' });
    sim.tireSmokeSystem = noopSmoke;
    sim.setPreset('runway');
    for (let tick = 0; tick < 10; tick++) stepPhysics(sim);

    // Reproduce exact runtime aircraft switch path from built-in B738 to addon.
    sim.currentAircraftId = descriptor.id;
    sim.currentAircraftConfig = descriptor.config;
    sim.aero.loadConfig(descriptor.config);
    sim.engines.loadConfig(descriptor.config);
    sim.engines.bindMassProperties(sim.aero.massProperties);
    sim.gear.loadConfig(descriptor.config);
    sim.collisionDetector.loadAircraftConfig(descriptor.config);
    sim.engines.refuel(sim.aero);

    sim.setPreset('runway');
    for (let tick = 0; tick < 120; tick++) stepPhysics(sim);
    if (assertFiniteSimulationState(sim, 'runway settle', errors)) {
      if (sim.isCrashed) errors.push(`aircraft crashed while resting on runway (${sim.crashResult?.type ?? 'unknown'})`);
      if (!sim.telemetry.onGround) warnings.push('aircraft did not register onGround=true during runway settle');
    }

    sim.setPreset('cruise');
    const cruiseStart = sim.position.clone();
    for (let tick = 0; tick < 180; tick++) stepPhysics(sim);
    if (assertFiniteSimulationState(sim, 'cruise flight', errors)) {
      if (sim.isCrashed) errors.push(`aircraft crashed in cruise preset (${sim.crashResult?.type ?? 'unknown'})`);
      if (sim.position.distanceTo(cruiseStart) < 10) {
        errors.push('aircraft failed to advance in cruise preset');
      }
    }

    sim.setPreset('approach');
    for (let tick = 0; tick < 120; tick++) stepPhysics(sim);
    if (assertFiniteSimulationState(sim, 'approach flight', errors)) {
      if (sim.isCrashed) errors.push(`aircraft crashed in approach preset (${sim.crashResult?.type ?? 'unknown'})`);
      if (!(sim.telemetry.iasKnots > 20)) {
        errors.push(`aircraft approach IAS too low (${sim.telemetry.iasKnots})`);
      }
    }

    // Forced hull/ground contact must not throw on BODY_DAMAGE_LIMITS or NaN forces.
    sim.setPreset('runway');
    sim.position.y -= 1.5;
    for (let tick = 0; tick < 10; tick++) stepPhysics(sim);
    assertFiniteSimulationState(sim, 'forced body contact', errors);

    // Forced water contact must resolve cleanly without non-finite buoyancy/hydrodynamic state.
    const seaSim = createHeadlessSimulation({
      aircraftId: descriptor.id,
      airportId: 'coastal',
      terrain: { getHeight: () => -20, getNormal: () => new THREE.Vector3(0, 1, 0) },
    });
    seaSim.tireSmokeSystem = noopSmoke;
    seaSim.water = { waterLevel: 0, getWaveHeight: () => 0, update() {} };
    seaSim.position.set(3000, -0.3, 3000);
    seaSim.linearVelocity.set(22, -0.5, 0);
    for (let tick = 0; tick < 15; tick++) stepPhysics(seaSim);
    assertFiniteSimulationState(seaSim, 'water contact', errors);

    for (const code of SPAWN_AIRPORTS) {
      for (const scenario of SPAWN_SCENARIOS) {
        const plan = airportSpawnPlan(code, scenario, { aircraftId: descriptor.id });
        if (!plan) {
          errors.push(`airportSpawnPlan(${code}, ${scenario}) returned null for ${descriptor.id}`);
          continue;
        }
        if (![plan.x, plan.y, plan.z, plan.vx, plan.vy, plan.vz].every(Number.isFinite)
          || (plan.groundClearanceM !== undefined && (!Number.isFinite(plan.groundClearanceM) || plan.groundClearanceM <= 0))) {
          errors.push(`airportSpawnPlan(${code}, ${scenario}) returned invalid coordinates or ground clearance`);
        }
        if (scenario !== 'runway' && Math.hypot(plan.vx, plan.vz) <= 10) {
          errors.push(`airportSpawnPlan(${code}, ${scenario}) returned near-zero airspeed`);
        }
      }
    }

    const performanceEnvelope = descriptor.config.specs?.performanceEnvelope;
    if (performanceEnvelope) {
      const envelopeResult = verifyAircraftPerformanceEnvelope(descriptor.id, performanceEnvelope);
      if (stats) {
        stats.performanceEnvelope = {
          metric: envelopeResult.metric,
          spec: envelopeResult.spec,
          peak: envelopeResult.peak,
          ratio: envelopeResult.ratio,
          durationSec: envelopeResult.durationSec,
        };
      }
      if (!envelopeResult.ok) {
        errors.push(...envelopeResult.errors);
      }
    }
  } catch (error) {
    errors.push(`aircraft headless simulation threw: ${error.message}`);
  } finally {
    unregisterAddonAircraft(descriptor.id);
  }
}

/**
 * Verify runtime invariants beyond JSON schema: strict canonical physics tables,
 * headless B738->addon switch/runway/cruise/approach/ground/water simulation,
 * spawn plans, asset size/SHA-256 budgets, and GLB mesh/control-node integrity.
 */
export async function verifyAddonRuntime(manifest, {
  coreVersion,
  addonDir = null,
  fetchImpl = globalThis.fetch,
  verifyRemoteAssets = false,
  requireLocalAssets = false,
  strict = true,
  maxAssetBytes = DEFAULT_MAX_ASSET_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxGlbTriangles = DEFAULT_MAX_GLB_TRIANGLES,
} = {}) {
  const errors = [];
  const warnings = [];
  const stats = { totalAssetBytes: 0, checkedAssets: 0, glbModels: [] };

  const schemaResult = validateAddonManifest(manifest, { coreVersion });
  if (!schemaResult.ok) {
    errors.push(...schemaResult.errors);
    return { ok: false, errors, warnings, stats };
  }

  if (manifest.aircraft) {
    verifyAircraftPhysicsRuntime(manifest, { coreVersion, strict, errors, warnings, stats });
  }

  const resources = collectDeclaredResources(manifest);
  for (const resource of resources) {
    if (resource.conflictingDigest) {
      errors.push(`${resource.label}: conflicting sha256 digests declared for ${resource.url}`);
      continue;
    }
    let bytes = null;
    let sourceLabel = null;
    if (addonDir) {
      const localPath = await resolveLocalResourcePath(addonDir, resource.url);
      if (localPath) {
        bytes = new Uint8Array(await readFile(localPath));
        sourceLabel = localPath;
      } else if (requireLocalAssets) {
        errors.push(`${resource.label}: local asset missing under ${addonDir} for ${resource.url}`);
        continue;
      }
    }
    if (!bytes && verifyRemoteAssets) {
      if (typeof fetchImpl !== 'function') {
        errors.push(`${resource.label}: fetch unavailable to verify ${resource.url}`);
        continue;
      }
      const response = await fetchImpl(resource.url);
      if (!response?.ok) {
        errors.push(`${resource.label}: asset fetch failed (${response?.status ?? 'network'}) at ${resource.url}`);
        continue;
      }
      bytes = new Uint8Array(await response.arrayBuffer());
      sourceLabel = resource.url;
    }
    if (!bytes) continue;

    stats.checkedAssets += 1;
    stats.totalAssetBytes += bytes.byteLength;
    if (bytes.byteLength === 0) {
      errors.push(`${resource.label}: asset is empty (${sourceLabel})`);
      continue;
    }
    if (bytes.byteLength > maxAssetBytes) {
      errors.push(`${resource.label}: size ${bytes.byteLength} bytes exceeds maxAssetBytes (${maxAssetBytes})`);
    }
    if (stats.totalAssetBytes > maxTotalBytes) {
      errors.push(`total verified asset bytes (${stats.totalAssetBytes}) exceeds maxTotalBytes (${maxTotalBytes})`);
    }
    const digest = await sha256Hex(bytes);
    if (digest !== resource.sha256) {
      errors.push(`${resource.label}: sha256 mismatch (expected ${resource.sha256}, got ${digest})`);
    }
    if (isGlbMagic(bytes) || /\.glb(?:$|\?)/i.test(resource.url)) {
      if (!isGlbMagic(bytes)) {
        errors.push(`${resource.label}: file is missing GLB binary header`);
      } else {
        const glbStats = await inspectGlbResource(bytes, resource, { maxGlbTriangles, errors });
        stats.glbModels.push({ label: resource.label, ...glbStats });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}
