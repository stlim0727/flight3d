import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateAddonManifest, validateCatalog } from '../src/addons/addonContract.js';
import { lintAddonSet } from '../src/addons/lintAddonSet.js';
import { verifyAddonRuntime } from '../src/addons/verifyAddonRuntime.js';

function usage() {
  console.error('Usage:');
  console.error('  node scripts/addon-contract.mjs validate <addon.json|catalog.json> [--core VERSION]');
  console.error('  node scripts/addon-contract.mjs lint-set <addon.json>... [--core VERSION]');
  console.error('  node scripts/addon-contract.mjs verify-runtime <addon.json> [--core VERSION] [--addon-dir DIR] [--non-strict] [--verify-remote] [--require-local-assets]');
  process.exitCode = 2;
}

const [command, ...args] = process.argv.slice(2);
const valueOption = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const coreVersion = valueOption('core');
const addonDirArg = valueOption('addon-dir');
const strict = !args.includes('--non-strict');
const verifyRemoteAssets = args.includes('--verify-remote');
const requireLocalAssets = args.includes('--require-local-assets');
const valueIndices = new Set();
for (const name of ['core', 'addon-dir']) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0) valueIndices.add(index + 1);
}
const files = args.filter((arg, index) => !arg.startsWith('--') && !valueIndices.has(index));

async function readDocuments(paths) {
  return Promise.all(paths.map(async file => ({
    file,
    document: JSON.parse(await readFile(resolve(file), 'utf8')),
  })));
}

if (command === 'validate' && files.length === 1) {
  const { file, document } = (await readDocuments(files))[0];
  try {
    const result = Array.isArray(document?.addons)
      ? validateCatalog(document)
      : validateAddonManifest(document, { coreVersion });
    if (!result.ok) throw new Error(result.errors.join('; '));
    console.log(`OK: ${file}`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
} else if (command === 'lint-set' && files.length > 0) {
  const documents = await readDocuments(files);
  const result = lintAddonSet(documents.map(({ document }) => document), { coreVersion });
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${files.length} addons linted with ${result.warnings.length} warning(s)`);
  }
} else if (command === 'verify-runtime' && files.length === 1) {
  const { file, document } = (await readDocuments(files))[0];
  const addonDir = resolve(addonDirArg ?? dirname(resolve(file)));
  const result = await verifyAddonRuntime(document, {
    coreVersion,
    addonDir,
    strict,
    verifyRemoteAssets,
    requireLocalAssets,
  });
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${file} runtime verified (${result.stats.checkedAssets} asset(s) checked, ${result.stats.glbModels.length} GLB)`);
  }
} else {
  usage();
}
