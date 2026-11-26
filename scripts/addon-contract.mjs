import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateAddonManifest, validateCatalog } from '../src/addons/addonContract.js';
import { lintAddonSet } from '../src/addons/lintAddonSet.js';

function usage() {
  console.error('Usage:');
  console.error('  node scripts/addon-contract.mjs validate <addon.json|catalog.json> [--core VERSION]');
  console.error('  node scripts/addon-contract.mjs lint-set <addon.json>... [--core VERSION]');
  process.exitCode = 2;
}

const [command, ...args] = process.argv.slice(2);
const coreIndex = args.indexOf('--core');
const coreVersion = coreIndex >= 0 ? args[coreIndex + 1] : undefined;
const files = args.filter((arg, index) => arg !== '--core' && (coreIndex < 0 || index !== coreIndex + 1));

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
} else {
  usage();
}
