#!/usr/bin/env node
// Decimate heavy GLB assets into gallery LOD variants.
//
// Every GLB under public/models at or above LOD_SIZE_THRESHOLD_BYTES is welded
// and simplified with meshoptimizer to LOD_RATIO of its triangles under a 1%
// error budget, then written to public/models/lod/<source path>. A variant is
// kept only when it cuts the payload by LOD_MIN_BYTE_GAIN: texture-bound models
// lose triangles but keep their bytes, so they gain nothing as gallery LODs.
// Draco-compressed sources stay Draco-compressed; nodes, materials, animations
// and attribute names are preserved, so a variant can be compared side by side
// with its source in assets.html.
//
// Regenerate: npm run build:lod
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const MODELS_DIRECTORY = path.join(ROOT_DIR, 'public', 'models');
export const LOD_DIRECTORY = path.join(MODELS_DIRECTORY, 'lod');
export const LOD_SIZE_THRESHOLD_BYTES = 1024 * 1024;
export const LOD_RATIO = 0.1;
export const LOD_ERROR = 0.01;
export const LOD_MIN_BYTE_GAIN = 0.15;

export function createGltfIO({ decoder, encoder } = {}) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (decoder || encoder) {
    io.registerDependencies({
      ...(decoder ? { 'draco3d.decoder': decoder } : {}),
      ...(encoder ? { 'draco3d.encoder': encoder } : {}),
    });
  }
  return io;
}

export function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      triangles += (indices ? indices.getCount() : position.getCount()) / 3;
    }
  }
  return Math.round(triangles);
}

async function listGlbFiles(directory, { skipDirectory = null } = {}) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.glb'))
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter(file => !skipDirectory || !file.startsWith(skipDirectory + path.sep))
    .sort();
}

export async function decimateGlbAssets({
  modelsDirectory = MODELS_DIRECTORY,
  lodDirectory = path.join(modelsDirectory, 'lod'),
  ratio = LOD_RATIO,
  error = LOD_ERROR,
  minByteGain = LOD_MIN_BYTE_GAIN,
  sizeThreshold = LOD_SIZE_THRESHOLD_BYTES,
  dryRun = false,
} = {}) {
  await MeshoptSimplifier.ready;
  const decoder = await draco3d.createDecoderModule({});
  const encoder = await draco3d.createEncoderModule({});
  const io = createGltfIO({ decoder, encoder });
  const kept = new Set();
  const report = [];

  for (const sourcePath of await listGlbFiles(modelsDirectory, { skipDirectory: lodDirectory })) {
    const sourceBytes = (await stat(sourcePath)).size;
    const entry = { source: path.relative(ROOT_DIR, sourcePath), sourceBytes, lod: null };
    report.push(entry);
    if (sourceBytes < sizeThreshold) {
      entry.status = 'below-threshold';
      continue;
    }

    const document = await io.read(sourcePath);
    entry.sourceTriangles = countTriangles(document);
    if (entry.sourceTriangles === 0) {
      entry.status = 'no-triangles';
      continue;
    }

    const usesDraco = document
      .getRoot()
      .listExtensionsUsed()
      .some(extension => extension.extensionName === 'KHR_draco_mesh_compression');
    await document.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    entry.lodTriangles = countTriangles(document);
    if (usesDraco) {
      document
        .createExtension(KHRDracoMeshCompression)
        .setRequired(true)
        .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
    }

    const lodPath = path.join(lodDirectory, path.relative(modelsDirectory, sourcePath));
    entry.lod = path.relative(ROOT_DIR, lodPath);
    const bytes = await io.writeBinary(document);
    entry.lodBytes = bytes.byteLength;
    entry.byteGain = 1 - entry.lodBytes / sourceBytes;
    if (entry.byteGain >= minByteGain) {
      kept.add(lodPath);
      entry.status = 'kept';
      if (!dryRun) {
        await mkdir(path.dirname(lodPath), { recursive: true });
        await writeFile(lodPath, bytes);
      }
    } else {
      entry.status = 'payload-gain-too-low';
      if (!dryRun) await rm(lodPath, { force: true });
    }
  }

  if (!dryRun) {
    for (const lodPath of await listGlbFiles(lodDirectory).catch(() => [])) {
      if (kept.has(lodPath)) continue;
      await rm(lodPath, { force: true });
      report.push({ status: 'removed-stale', lod: path.relative(ROOT_DIR, lodPath) });
    }
  }

  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === '--ratio') options.ratio = Number(next());
    else if (arg === '--error') options.error = Number(next());
    else if (arg === '--min-gain') options.minByteGain = Number(next());
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.ratio !== undefined && !(options.ratio > 0 && options.ratio <= 0.95)) {
    throw new Error(`Invalid --ratio: ${options.ratio} (expected 0 < ratio <= 0.95)`);
  }
  if (options.error !== undefined && !(options.error > 0 && options.error < 1)) {
    throw new Error(`Invalid --error: ${options.error} (expected 0 < error < 1)`);
  }
  if (options.minByteGain !== undefined && !(options.minByteGain >= 0 && options.minByteGain < 1)) {
    throw new Error(`Invalid --min-gain: ${options.minByteGain} (expected 0 <= gain < 1)`);
  }
  return options;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  const report = await decimateGlbAssets(options);
  for (const entry of report) {
    if (entry.status === 'below-threshold') continue;
    if (entry.status === 'removed-stale') {
      console.log(`${entry.status.padEnd(20)} ${entry.lod}`);
      continue;
    }
    const lod = entry.lodBytes == null
      ? 'no LOD'
      : `${formatBytes(entry.lodBytes)} / ${entry.lodTriangles} tris (${(entry.byteGain * 100).toFixed(1)}% smaller)`;
    console.log(`${entry.status.padEnd(20)} ${entry.source}: ${formatBytes(entry.sourceBytes)} / ${entry.sourceTriangles} tris -> ${lod}`);
  }
  const kept = report.filter(entry => entry.status === 'kept').length;
  console.log(`${kept} LOD variant(s) in ${path.relative(ROOT_DIR, LOD_DIRECTORY)}${options.dryRun ? ' (dry run)' : ''}`);
}
