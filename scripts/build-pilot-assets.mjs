/**
 * @file build-pilot-assets.mjs
 * @description Procedural 3D GLB asset generator for simulator pilots.
 * Generates public/models/pilot-f16.glb featuring:
 *  - ACES II ejection seat with 30° reclined backrest, headrest & canopy breaker pitot horns
 *  - CWU-27/P flight suit torso with PCU-15/P restraint harness & survival vest
 *  - CSU-13B/P anti-G suit trousers & combat flight boots on rudder pedals
 *  - Articulated HOTAS arms: right hand on F-16 sidestick, left hand on throttle
 *  - Articulated Pilot_Head group: HGU-55/P flight helmet, tinted mirror visor,
 *    MBU-12/P oxygen mask, and flexible corrugated breathing hose
 *  - Independent Pilot_Head node for seamless 1st-person cockpit view occlusion
 *    and future dynamic G-force head tilt / look-at tracking.
 * Also generates the Boeing 737 captain/first officer and Cessna 172 pilot GLBs,
 * with each seated yoke/pedal IK pose baked into their named limb nodes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildF16PilotScene } from '../src/aircraft/pilotGeometry.js';
import { createB737Pilots, createC172Pilot } from '../src/aircraft/civilPilotGeometry.js';
import { validateGlbModel } from './validate-glb-mesh.mjs';

// Polyfills required for Three.js GLTFExporter in Node.js
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(REPO_ROOT, 'public', 'models');
const OUTPUT_FILE = path.join(MODELS_DIR, 'pilot-f16.glb');
const CIVIL_PILOTS = [
  { pilot: 'captain', file: 'pilot-b737-captain.glb' },
  { pilot: 'firstOfficer', file: 'pilot-b737-first-officer.glb' },
  { pilot: 'c172', file: 'pilot-c172.glb' },
];

/**
 * Exports and validates one pilot scene, then writes it under public/models.
 */
async function exportGlb(root, fileName, outputPath) {
  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(root, { binary: true });

  const validation = await validateGlbModel(glbBuffer, fileName);
  if (!validation.valid) {
    throw new Error(`Generated ${fileName} failed validation: ${validation.errors.join('; ')}`);
  }

  const nodeBuf = Buffer.from(glbBuffer);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, nodeBuf);

  console.log(`Exported ${fileName}: ${outputPath} (${(nodeBuf.length / 1024).toFixed(1)} KB, ${validation.stats.triangles} triangles, ${validation.stats.meshes} meshes)`);
  return nodeBuf;
}

export async function exportPilotGlb(outputPath = OUTPUT_FILE) {
  return exportGlb(buildF16PilotScene().root, 'pilot-f16.glb', outputPath);
}

/** Exports the civil pilots in their seated cockpit poses. */
export async function exportCivilPilotGlbs() {
  const pilots = { ...createB737Pilots(), c172: createC172Pilot() };
  const results = {};
  for (const { pilot, file } of CIVIL_PILOTS) {
    results[pilot] = await exportGlb(
      pilots[pilot].userData.activeScene,
      file,
      path.join(MODELS_DIR, file),
    );
  }
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('build-pilot-assets.mjs')) {
  (async () => {
    await exportPilotGlb();
    await exportCivilPilotGlbs();
  })().catch(err => {
    console.error('Failed to build pilot assets:', err);
    process.exit(1);
  });
}
