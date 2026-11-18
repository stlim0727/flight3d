/**
 * @file build-pilot-assets.mjs
 * @description Procedural 3D GLB asset generator for military flight simulator pilots.
 * Generates public/models/pilot-f16.glb featuring:
 *  - ACES II ejection seat with 30° reclined backrest, headrest & canopy breaker pitot horns
 *  - CWU-27/P flight suit torso with PCU-15/P restraint harness & survival vest
 *  - CSU-13B/P anti-G suit trousers & combat flight boots on rudder pedals
 *  - Articulated HOTAS arms: right hand on F-16 sidestick, left hand on throttle
 *  - Articulated Pilot_Head group: HGU-55/P flight helmet, tinted mirror visor,
 *    MBU-12/P oxygen mask, and flexible corrugated breathing hose
 *  - Independent Pilot_Head node for seamless 1st-person cockpit view occlusion
 *    and future dynamic G-force head tilt / look-at tracking.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildF16PilotScene } from '../src/aircraft/pilotGeometry.js';
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
const OUTPUT_FILE = path.join(REPO_ROOT, 'public/models/pilot-f16.glb');

/**
 * Exports the scene to a binary GLB file.
 */
export async function exportPilotGlb(outputPath = OUTPUT_FILE) {
  const { root } = buildF16PilotScene();

  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(root, { binary: true });

  const nodeBuf = Buffer.from(glbBuffer);

  // Validate the generated GLB
  const validation = await validateGlbModel(glbBuffer, 'pilot-f16.glb');
  if (!validation.valid) {
    throw new Error(`Generated pilot GLB failed validation: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, nodeBuf);

  console.log(`Exported F-16 pilot GLB: ${outputPath} (${(nodeBuf.length / 1024).toFixed(1)} KB, ${validation.stats.triangles} triangles, ${validation.stats.meshes} meshes)`);
  return nodeBuf;
}

if (process.argv[1] && process.argv[1].endsWith('build-pilot-assets.mjs')) {
  exportPilotGlb().catch(err => {
    console.error('Failed to build pilot asset:', err);
    process.exit(1);
  });
}
